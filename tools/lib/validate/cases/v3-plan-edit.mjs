// V3 — a plan file edited mid-run (plan 102). While the plan's builder works, the "Human" commits a one-line note to
// that plan's file on the run branch and pushes it; the builder adds its own note to the same file, so the merge meets
// a conflict in the plan file. PASS only when the plan merged with no park and the run recorded the change (a run note
// naming the plan file, or the report's "## Plans changed during the run").
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sandbox, start, statusOf, planState, notesOf, waitFor, runEvidence, runFiles, inputTokens, toyTask, planFile, runTail } from '../common.mjs'

const N = '903'
const TITLE = 'Edited midway'
const RUN = 'val-v3'

export default {
  id: 'V3',
  title: 'a plan file edited mid-run',
  plan: '102',
  calls: [`plan ${N}: builder, reviewer`],
  async run(ctx) {
    const t = toyTask(N, TITLE)
    const p = sandbox(ctx, { files: { [t.check[0]]: t.check[1] } })
    ctx.keepFiles(() => runFiles(p, RUN))
    ctx.tokens(() => inputTokens(p, RUN))
    p.addPlans({ [N]: { title: TITLE, text: t.text } })
    const file = planFile(N, TITLE)
    const step = { sleepMs: 20_000, editFiles: t.fakeEdit, appendFiles: { [file]: `- builder: wrote src/${N}.txt\n` } }
    const r = start(ctx, p, RUN, [N], { [N]: { builder: [step, step] } })
    await waitFor(ctx, () => planState(statusOf(p, RUN), N) === 'building', { what: `plan ${N} to build` })
    // The Human's edit: a clone of the sandbox origin, one line added to the plan file, pushed to the run branch.
    const clone = join(p.root, 'human')
    const evidence = []
    let pushed = null
    for (let i = 0; i < 4 && !pushed; i++) {
      if (existsSync(clone)) p.git(clone, 'fetch', '-q', 'origin')
      else p.git(p.root, 'clone', '-q', p.origin, clone)
      p.git(clone, 'checkout', '-q', '-B', 'edit', `origin/orch/${RUN}`)
      appendFileSync(join(clone, file), '- Human: the toy line stays exactly as the task says.\n')
      p.git(clone, 'commit', '-q', '-am', `plan(${N}): the toy line stays exactly as the task says`)
      const push = p.git(clone, 'push', '-q', 'origin', `HEAD:refs/heads/orch/${RUN}`)
      if (push.status === 0) pushed = p.git(clone, 'log', '-1', '--format=%h %s').out.trim()
    }
    evidence.push(pushed ? `pushed to orch/${RUN} while plan ${N} was building: ${pushed}` : `could not push the plan edit to orch/${RUN}`)
    if (!pushed) return { verdict: 'FAIL', why: 'the staged plan edit could not be pushed', evidence }
    evidence.push(`state of plan ${N} right after the push: ${planState(statusOf(p, RUN), N)}`)
    await waitFor(ctx, () => r.child.exitCode !== null || r.child.signalCode !== null, { what: 'the run to end' })
    const st = statusOf(p, RUN)
    evidence.push(...runEvidence(p, RUN, [N]), ...runTail(r))
    const reportFile = join(p.proj, '.claude', 'orchestrator-runs', `${RUN}.md`)
    const reportText = existsSync(reportFile) ? readFileSync(reportFile, 'utf8') : ''
    const section = /## Plans changed during the run[\s\S]*?(?=\n## |$)/.exec(reportText)?.[0] ?? ''
    if (section) evidence.push(`report: ${section.split('\n').slice(0, 4).join(' | ').slice(0, 300)}`)
    const named = notesOf(st, N).filter((x) => x.includes(file) || /changed during the run/.test(x))
    const parked = (st?.stops ?? []).length || /park/i.test(String(st?.plans?.[N]?.reason ?? ''))
    if (planState(st, N) !== 'merged') return { verdict: 'FAIL', why: `plan ${N} is ${planState(st, N) ?? 'not in status.json'}, not merged: ${String(st?.plans?.[N]?.reason ?? '').slice(0, 200)}`, evidence }
    if (parked) return { verdict: 'FAIL', why: 'the plan merged only after a park or a stop', evidence }
    if (!named.length && !section.includes(file)) return { verdict: 'FAIL', why: 'no run note and no report section names the edited plan file', evidence }
    return { verdict: 'PASS', why: `plan ${N} merged with no park; the run recorded the edit: ${(named[0] ?? 'report: ## Plans changed during the run').slice(0, 160)}`, evidence }
  },
}
