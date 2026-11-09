// V4 — missing packages repaired (plan 103). The sandbox app's tests import a local package (`toy-dep`, a file:
// dependency in package-lock.json, so `npm ci` needs no network). Plan A merges first, which installs the merge folder;
// while plan B builds, the case deletes node_modules in the run's merge folder. PASS only when B merged and a run note
// of B says the merge folder was installed again.
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const p0env = () => ({ ...process.env, npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' })
import { sandbox, start, statusOf, planState, notesOf, waitFor, runEvidence, runFiles, inputTokens, toyTask, runTail } from '../common.mjs'

const A = '904'
const B = '905'
const RUN = 'val-v4'
const DEP_CHECK = "import { value } from 'toy-dep'\nif (value !== 42) { console.log(`toy-dep value is ${value}`); process.exit(1) }\n"

export default {
  id: 'V4',
  title: 'missing packages repaired',
  plan: '103',
  calls: [`plan ${A}: builder, reviewer`, `plan ${B}: builder, reviewer`],
  async run(ctx) {
    const a = toyTask(A, 'Packages first')
    const b = toyTask(B, 'Packages second', { deps: A })
    const p = sandbox(ctx, {
      files: {
        'vendor/toy-dep/package.json': `${JSON.stringify({ name: 'toy-dep', version: '1.0.0', type: 'module', main: 'index.js' }, null, 2)}\n`,
        'vendor/toy-dep/index.js': 'export const value = 42\n',
        'dep-check.mjs': DEP_CHECK,
        [a.check[0]]: a.check[1],
        [b.check[0]]: b.check[1],
      },
      scripts: { test: 'node gate-check.mjs && node dep-check.mjs' },
      // The lockfile: npm install of the one local dependency, committed with the app (offline: a file: package).
      setup: (proj) => {
        const r = spawnSync('npm install --offline --no-audit --no-fund file:./vendor/toy-dep', { cwd: proj, shell: true, encoding: 'utf8', env: p0env() })
        if (r.status !== 0 || !existsSync(join(proj, 'package-lock.json'))) throw new Error(`npm install of the local package failed: ${`${r.stdout}${r.stderr}`.trim().split('\n').pop()}`)
      },
    })
    ctx.keepFiles(() => runFiles(p, RUN))
    ctx.tokens(() => inputTokens(p, RUN))
    p.addPlans({ [A]: { title: a.title, text: a.text }, [B]: { title: b.title, text: b.text } })
    const r = start(ctx, p, RUN, [A, B], { [A]: { builder: [{ editFiles: a.fakeEdit }] }, [B]: { builder: [{ sleepMs: 20_000, editFiles: b.fakeEdit }, { editFiles: b.fakeEdit }] } })
    const evidence = []
    await waitFor(ctx, () => {
      const st = statusOf(p, RUN)
      return planState(st, A) === 'merged' && ['building', 'gate', 'checking'].includes(planState(st, B))
    }, { what: `plan ${A} merged and plan ${B} building` })
    const mf = readdirSync(p.root).find((n) => n.includes('-orch-merge-'))
    if (!mf) return { verdict: 'FAIL', why: 'no merge folder next to the sandbox project after the first merge', evidence: readdirSync(p.root).map((n) => `sandbox: ${n}`) }
    const nm = join(p.root, mf, 'node_modules')
    const had = existsSync(join(nm, 'toy-dep'))
    rmSync(nm, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    evidence.push(`deleted ${mf}/node_modules while plan ${B} was ${planState(statusOf(p, RUN), B)} (toy-dep was there before: ${had}; there after: ${existsSync(nm)})`)
    await waitFor(ctx, () => r.child.exitCode !== null || r.child.signalCode !== null, { what: 'the run to end' })
    const st = statusOf(p, RUN)
    evidence.push(...runEvidence(p, RUN, [A, B]), ...runTail(r))
    const installed = notesOf(st, B).filter((x) => /merge.* was (re)?installed|ensure-env: (re)?installed/.test(x))
    if (planState(st, B) !== 'merged') return { verdict: 'FAIL', why: `plan ${B} is ${planState(st, B) ?? 'not in status.json'}, not merged: ${String(st?.plans?.[B]?.reason ?? '').slice(0, 200)}`, evidence }
    if (!installed.length) return { verdict: 'FAIL', why: `no run note of plan ${B} says the merge folder was installed again`, evidence }
    return { verdict: 'PASS', why: `the merge folder's packages were deleted; plan ${B}'s merge installed them again and merged: ${installed[0].slice(0, 120)}`, evidence }
  },
}
