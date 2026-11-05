// Plan 083 M1: `args.mode "merge"` resumes a run at the merge of a plan already built and checked — no builder, gate or
// checker; the final gate runs. A plan with no recorded checked head, or whose branch moved past it, is refused.
// Workflow part: the stub harness of tools/test/orchestrator-env-retry.test.mjs (copied: that file is not this plan's).
// Script part: the installed orch-state.mjs (set --checked-head, merge-ready) on a scratch repository with a bare origin.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, cpSync } from 'fs'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const root = process.env.ORCH_ROOT ? resolve(process.env.ORCH_ROOT) : kit
const wfSource = readFileSync(join(root, '.claude', 'workflows', 'orchestrate.js'), 'utf8')

// the full sha the state script's `diff` reports for the commit the builder reported as abc1234
const FULL = `abc1234${'0'.repeat(33)}`
async function runFlow(args, mergeReady) {
  const plansIn = args.plans.map(String)
  const words = (cmd) => [...cmd.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2])
  const task = (prompt) => Object.fromEntries(String(prompt).split('\n').map((l) => /^([A-Z_]+): (.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]))
  const calls = []
  const commands = []
  const state = (w) => {
    const cmd = w[2]
    const f = Object.fromEntries(w.slice(3).map((x) => /^--([\w-]+)=(.*)$/.exec(x)).filter(Boolean).map((m) => [m[1], m[2]]))
    if (cmd === 'init') return { ok: true, mergeFolder: '/merge', startedAt: '2026-01-01T00:00:00.000Z', attempt: 2 }
    if (cmd === 'order') return { ok: true, waves: [plansIn], waveLocks: [], skipped: [], plans: Object.fromEntries(plansIn.map((p) => [p, { path: `plans/${p}-x.plan.md` }])) }
    if (cmd === 'merge-ready') return mergeReady(f.plan)
    if (cmd === 'finish') return { ok: true, merged: [], parked: [], report: 'r', local: 'l', reportCommitted: true }
    if (cmd === 'plan-info') return { ok: true, path: `plans/${f.plan}-x.plan.md`, branch: `feat/${f.plan}-x`, startTier: 'build', invariants: [], npmScripts: [], uiItems: [], wt: { ok: true, path: `/wt/${f.plan}` } }
    if (cmd === 'diff') return { ok: true, files: [], sensitive: false, head: FULL }
    return { ok: true }
  }
  async function agent(prompt, opts = {}) {
    const t = task(prompt)
    const type = opts.agentType ?? (/orch-builder\.md/.test(prompt) ? 'orch-builder' : undefined)
    calls.push({ type, label: opts.label, task: t })
    if (type === 'kit-runner') {
      commands.push(t.COMMAND)
      const w = words(t.COMMAND)
      return { exitCode: 0, output: `ORCH_JSON ${JSON.stringify(w[1] === 'scripts/orch-state.mjs' ? state(w) : { ok: true })}` }
    }
    const base = { role: type, model: 'stub', effort: 'low' }
    if (type === 'orch-gate') return { ...base, results: JSON.parse(t.COMMANDS).map((c) => ({ command: c, status: 'pass' })) }
    if (type === 'orch-merge') return { ...base, merged: true, sha: 'def5678' }
    if (type === 'orch-triage') return { ...base, items: [] }
    if (type === 'orch-builder') return { ...base, status: 'built', branch: t.BRANCH, headSha: 'abc1234', summary: 's', evidence: ['e'], done: ['T1'], notDone: [], checksRun: [] }
    if (['orch-check-plan', 'orch-check-bugs', 'orch-check-rules', 'orch-security'].includes(type)) return { ...base, problems: [] }
    if (type === 'orch-verify') return { ...base, verdicts: [] }
    throw new Error(`stub: no agent for ${type} (${opts.label})`)
  }
  const parallel = (thunks) => Promise.all(thunks.map((th) => Promise.resolve().then(th)))
  const AsyncFunction = (async () => {}).constructor
  const src = wfSource.replace(/^export const meta\s*=/m, 'const meta =')
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow', 'require', 'process', src)
  const result = await fn(agent, parallel, undefined, () => {}, () => {}, { run: 'run-065', root: '/main', pilot: false, ...args }, {}, undefined, undefined, undefined)
  return { result, calls, commands }
}
const of = (r, type) => r.calls.filter((c) => c.type === type)

test('merge mode on a plan with its checked head: no builder, gate or checker, one merge, then the final gate', async () => {
  const r = await runFlow({ mode: 'merge', plans: ['065'] }, () => ({ ok: true, ready: true, branch: 'feat/065-x', head: FULL, checkedHead: FULL, round: 1, tier: 'build' }))
  assert.equal(r.result.outcomes[0].state, 'merged', JSON.stringify(r.result.outcomes))
  assert.equal(of(r, 'orch-builder').length, 0)
  assert.equal(['orch-check-plan', 'orch-check-bugs', 'orch-check-rules', 'orch-verify', 'orch-security', 'orch-ui'].reduce((n, t) => n + of(r, t).length, 0), 0)
  assert.equal(of(r, 'orch-merge').length, 1)
  assert.equal(of(r, 'orch-merge')[0].task.PLAN_BRANCH, 'feat/065-x')
  assert.equal(of(r, 'orch-merge')[0].task.PLAN_HEAD, FULL, 'the merge is pinned to the checked commit')
  assert.equal(r.commands.filter((c) => / (plan-info|worktree) /.test(c)).length, 0, 'no plan folder is made')
  const gates = of(r, 'orch-gate')
  assert.equal(gates.length, 1, 'the final gate only')
  assert.equal(gates[0].task.FOLDER, '/merge')
  assert.deepEqual(r.result.finalGate, { ok: true })
})

test('merge mode refuses a plan with no checked head, or whose branch moved past it: nothing is merged', async () => {
  for (const why of ['no checked head recorded for plan 065: its gate and checkers never passed in this run — relaunch it in a normal run', 'origin/feat/065-x is at 9999999, not the checked head abc1234 — the branch changed after its checks']) {
    const r = await runFlow({ mode: 'merge', plans: ['065'] }, () => ({ ok: true, ready: false, why }))
    const o = r.result.outcomes[0]
    assert.equal(o.state, 'parked')
    assert.equal(o.reason, `merge only refused: ${why}`)
    assert.equal(of(r, 'orch-merge').length, 0)
    assert.equal(of(r, 'orch-builder').length, 0)
    assert.equal(of(r, 'orch-gate').length, 0, 'nothing merged: no final gate')
  }
})

test('a normal run records the checked head when its gate and checkers passed, before the merge', async () => {
  const r = await runFlow({ mode: 'run', plans: ['065'] }, () => { throw new Error('run mode asked merge-ready') })
  assert.equal(r.result.outcomes[0].state, 'merged')
  const sets = r.commands.filter((c) => / set /.test(c) && /--plan[= ]065/.test(c))
  assert.ok(sets.length, r.commands.join('\n'))
  const checked = sets.findIndex((c) => c.includes(`--checked-head=${FULL}`) || c.includes(`--checked-head ${FULL}`))
  assert.ok(checked >= 0, sets.join('\n'))
  assert.ok(sets.findIndex((c) => /--state[= ]merging/.test(c)) > checked, 'recorded before the merge')
  assert.equal(of(r, 'orch-merge')[0].task.PLAN_HEAD, FULL, 'a normal merge is pinned too')
})

const sh = (cwd, ...a) => {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
test('merge-ready: ready at the checked head; refused with no checked head and after the branch moved', () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'orch-mo-')))
  const bare = realpathSync(mkdtempSync(join(tmpdir(), 'orch-mo-bare-')))
  try {
    const dir = join(parent, 'main')
    mkdirSync(join(dir, 'plans'), { recursive: true })
    sh(dir, 'init', '-q', '-b', 'main')
    sh(dir, 'config', 'user.email', 't@t')
    sh(dir, 'config', 'user.name', 't')
    writeFileSync(join(dir, 'plans', '065-x.plan.md'), '# Plan 065 — X\n\nStatus: active\nDepends-on: none\n')
    sh(dir, 'add', '-A')
    sh(dir, 'commit', '-q', '-m', 'plan')
    sh(bare, 'init', '-q', '--bare', '-b', 'main')
    sh(dir, 'remote', 'add', 'origin', bare)
    sh(dir, 'push', '-q', '-u', 'origin', 'main')
    cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true, dereference: true })
    writeFileSync(join(dir, '.git', 'info', 'exclude'), 'scripts/\n.claude/\n')
    const state = (...a) => {
      const r = spawnSync(process.execPath, [join(dir, 'scripts', 'orch-state.mjs'), ...a], { cwd: dir, encoding: 'utf8', timeout: 120000 })
      const line = String(r.stdout).split(/\r?\n/).reverse().find((l) => l.startsWith('ORCH_JSON '))
      assert.ok(line, `${a.join(' ')}: ${r.stdout}${r.stderr}`)
      return JSON.parse(line.slice('ORCH_JSON '.length))
    }
    const init = state('init', '--run=run-065')
    assert.equal(init.ok, true, JSON.stringify(init))
    const info = state('plan-info', '--run=run-065', '--plan=065')
    assert.equal(info.ok, true, JSON.stringify(info))
    // the plan branch on origin, one commit ahead
    sh(dir, 'switch', '-q', '-c', 'feat/065-x')
    writeFileSync(join(dir, 'a.txt'), 'a\n')
    sh(dir, 'add', 'a.txt')
    sh(dir, 'commit', '-q', '-m', 'work')
    sh(dir, 'push', '-q', 'origin', 'feat/065-x')
    const head = sh(dir, 'rev-parse', 'HEAD')
    const none = state('merge-ready', '--run=run-065', '--plan=065')
    assert.equal(none.ready, false)
    assert.match(none.why, /^no checked head recorded for plan 065/)
    const set = state('set', '--run=run-065', '--plan=065', '--state=parked', `--checked-head=${head}`)
    assert.equal(set.ok, true, JSON.stringify(set))
    const ok = state('merge-ready', '--run=run-065', '--plan=065')
    assert.deepEqual([ok.ready, ok.branch, ok.head], [true, 'feat/065-x', head], JSON.stringify(ok))
    writeFileSync(join(dir, 'a.txt'), 'b\n')
    sh(dir, 'commit', '-qam', 'more')
    sh(dir, 'push', '-q', 'origin', 'feat/065-x')
    const moved = state('merge-ready', '--run=run-065', '--plan=065')
    assert.equal(moved.ready, false)
    assert.match(moved.why, /not the checked head/)
  } finally {
    rmSync(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    rmSync(bare, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
