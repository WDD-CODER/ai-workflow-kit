// Plan 068: after a gate env-fail, the environment check probes the failed command's own precondition; a command with
// none parks at once. The workflow runs here with stub agents (the harness of tools/test/orchestrator.test.mjs, copied:
// that file is not edited by this plan).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'path'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const root = process.env.ORCH_ROOT ? resolve(process.env.ORCH_ROOT) : kit
const wfSource = readFileSync(join(root, '.claude', 'workflows', 'orchestrate.js'), 'utf8')

// hooks: gateEnv(folder, n, cmds) → a list of commands that report status env-fail on gate call n of that folder;
// runner(command, n, output) → a string that replaces the runner's output for that call.
async function runFlow(args, hooks = {}) {
  const calls = []
  const commands = []
  const runnerSeen = {}
  const plansIn = args.plans.map(String)
  const words = (cmd) => [...cmd.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2])
  const task = (prompt) => Object.fromEntries(String(prompt).split('\n').map((l) => /^([A-Z_]+): (.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]))
  const out = (o) => ({ exitCode: 0, output: `ORCH_JSON ${JSON.stringify(o)}` })
  const state = (w) => {
    const cmd = w[2]
    const f = Object.fromEntries(w.slice(3).map((x) => /^--([\w-]+)=(.*)$/.exec(x)).filter(Boolean).map((m) => [m[1], m[2]]))
    if (cmd === 'init') return { ok: true, mergeFolder: '/merge', startedAt: '2026-01-01T00:00:00.000Z' }
    if (cmd === 'order') return { ok: true, waves: [plansIn], waveLocks: [], skipped: [], plans: Object.fromEntries(plansIn.map((p) => [p, { path: `plans/${p}-x.plan.md` }])) }
    if (cmd === 'plan-info') {
      const info = { ok: true, path: `plans/${f.plan}-x.plan.md`, branch: `feat/${f.plan}-x`, startTier: 'build', invariants: [], npmScripts: [], uiItems: [] }
      return f['with-worktree'] ? { ...info, wt: { ok: true, path: `/wt/${f.plan}` } } : info
    }
    if (cmd === 'worktree') return { ok: true, path: `/wt/${f.plan}` }
    if (cmd === 'check-files') return { ok: true, nnn: f.plan, missing: [] }
    if (cmd === 'finish') return { ok: true, merged: [], parked: [], report: 'r', local: 'l', reportCommitted: true }
    if (cmd === 'diff') return { ok: true, files: [], sensitive: false }
    return { ok: true }
  }
  const gateCount = {}
  async function agent(prompt, opts = {}) {
    const t = task(prompt)
    const type = opts.agentType ?? (/orch-builder\.md/.test(prompt) ? 'orch-builder' : undefined)
    calls.push({ type, label: opts.label, task: t })
    if (type === 'kit-runner') {
      const w = words(t.COMMAND)
      commands.push(t.COMMAND)
      const r = out(w[1] === 'scripts/orch-state.mjs' ? state(w) : { ok: true })
      const n = (runnerSeen[t.COMMAND] = (runnerSeen[t.COMMAND] ?? 0) + 1)
      const replaced = hooks.runner?.(t.COMMAND, n, r.output)
      return replaced === undefined ? r : { exitCode: 0, output: replaced }
    }
    const base = { role: type, model: 'stub', effort: 'low' }
    if (type === 'orch-builder') return { ...base, status: 'built', branch: t.BRANCH, headSha: 'abc1234', summary: 's', evidence: ['e'], done: ['T1'], notDone: [], checksRun: [] }
    if (type === 'orch-gate') {
      const cmds = JSON.parse(t.COMMANDS)
      const n = (gateCount[t.FOLDER] = (gateCount[t.FOLDER] ?? 0) + 1)
      const envCmds = hooks.gateEnv?.(t.FOLDER, n, cmds) ?? []
      return { ...base, results: cmds.map((c) => (envCmds.includes(c) ? { command: c, status: 'env-fail', tail: 'Error: Cannot find module' } : { command: c, status: 'pass' })) }
    }
    if (['orch-check-plan', 'orch-check-bugs', 'orch-check-rules', 'orch-security'].includes(type)) return { ...base, role: type, problems: [] }
    if (type === 'orch-verify') return { ...base, verdicts: [] }
    if (type === 'orch-merge') return { ...base, merged: true, sha: 'def5678' }
    if (type === 'orch-triage') return { ...base, items: [] }
    if (type === 'orch-readiness') return { ...base, plans: [{ plan: t.PLAN, state: 'ready', questions: [], envNeeds: [], commands: [] }] }
    throw new Error(`stub: no agent for ${type} (${opts.label})`)
  }
  const parallel = (thunks) => Promise.all(thunks.map((th) => Promise.resolve().then(th)))
  const AsyncFunction = (async () => {}).constructor
  const src = wfSource.replace(/^export const meta\s*=/m, 'const meta =')
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow', 'require', 'process', src)
  const result = await fn(agent, parallel, undefined, () => {}, () => {}, { mode: 'run', run: 'r1', root: '/main', pilot: false, ...args }, {}, undefined, undefined, undefined)
  return { result, calls, commands }
}

const CMD = 'node scripts/x.mjs'
const builders = (r) => r.calls.filter((c) => c.type === 'orch-builder').length

test('reproduction: a gate env-fail for a missing script is retried once after a passing environment check, then parks', async () => {
  const r = await runFlow({ plans: ['101'], checks: { 101: [CMD] } }, { gateEnv: (folder) => (folder === '/wt/101' ? [CMD] : []) })
  const o = r.result.outcomes[0]
  assert.equal(o.state, 'parked')
  assert.match(o.reason, /^environment, again after one retry: gate env-fail: node scripts\/x\.mjs/)
  assert.equal(builders(r), 2, 'the plan was built again after the environment check')
  assert.equal(r.commands.filter((c) => c.includes('orch-preflight.mjs --env-only')).length, 1, 'one environment check')
})
