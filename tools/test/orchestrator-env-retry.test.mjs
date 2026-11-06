// Plan 068: after a gate env-fail, the environment check probes the failed command's own precondition; a command with
// none parks at once. The workflow runs here with stub agents (the harness of tools/test/orchestrator.test.mjs, copied:
// that file is not edited by this plan).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'path'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, cpSync, rmSync } from 'fs'
import { spawnSync } from 'child_process'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const root = process.env.ORCH_ROOT ? resolve(process.env.ORCH_ROOT) : kit
const wfSource = readFileSync(join(root, '.claude', 'workflows', 'orchestrate.js'), 'utf8')

// hooks: gateEnv(folder, n, cmds) → a list of commands that report status env-fail on gate call n of that folder;
// lost(folder) → the gate returns no result at all; mergeEnvOnce → the first merge is an envFailure;
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
  const merged = {}
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
      if (hooks.lost?.(t.FOLDER)) return { ...base, results: [] }
      const envCmds = hooks.gateEnv?.(t.FOLDER, n, cmds) ?? []
      return { ...base, results: cmds.map((c) => (envCmds.includes(c) ? { command: c, status: 'env-fail', tail: 'Error: Cannot find module' } : { command: c, status: 'pass' })) }
    }
    if (['orch-check-plan', 'orch-check-bugs', 'orch-check-rules', 'orch-security'].includes(type)) return { ...base, role: type, problems: [] }
    if (type === 'orch-verify') return { ...base, verdicts: [] }
    if (type === 'orch-merge') {
      if (hooks.mergeEnvOnce && !merged.env) {
        merged.env = true
        return { ...base, merged: false, envFailure: true, reason: "'ng' is not recognized" }
      }
      return { ...base, merged: true, sha: 'def5678' }
    }
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
const envChecks = (r) => r.commands.filter((c) => c.includes('orch-preflight.mjs --env-only'))
// The env check's answer, with the probe results the real preflight prints for each --probe command.
const preflight = (probes, problems = []) => (cmd) => (cmd.includes('orch-preflight.mjs --env-only')
  ? `ORCH_JSON ${JSON.stringify({ ok: problems.length === 0, problems, probes, ...(problems.length ? { envFailure: true } : {}) })}`
  : undefined)

// A1 reproduced today's behaviour on main (the env check passed, the same command failed again, the plan parked after
// one retry). With the probe, the same failure — a script that does not exist — parks at once with the probe's message.
test('reproduction: a gate env-fail for a missing script parks at once with the probe message, no retry', async () => {
  const r = await runFlow({ plans: ['101'], checks: { 101: [CMD] } }, {
    gateEnv: (folder) => (folder === '/wt/101' ? [CMD] : []),
    runner: preflight([{ command: CMD, status: 'FAIL', why: 'scripts/x.mjs not found in the root folder' }], [`probe: ${CMD} — scripts/x.mjs not found in the root folder`]),
  })
  const o = r.result.outcomes[0]
  assert.equal(o.state, 'parked')
  assert.equal(o.reason, `environment: probe: ${CMD} — scripts/x.mjs not found in the root folder`)
  assert.equal(builders(r), 1, 'no retry: the plan is not built again')
  assert.equal(envChecks(r).length, 1)
  assert.ok(envChecks(r)[0].includes(`--probe "${CMD}"`), envChecks(r)[0])
})

test('a gate env-fail whose commands all have no precondition parks at once, naming them', async () => {
  // The stub env check answers SKIP for both (a real one says SKIP for any command that is neither `node <file>` nor
  // `npm|pnpm run <name>`; the gate only runs allowed check commands, so the stub stands in for that case).
  const cmds = ['npm run lint', 'npm run test']
  const r = await runFlow({ plans: ['101'], checks: { 101: cmds } }, {
    gateEnv: (folder) => (folder === '/wt/101' ? cmds : []),
    runner: preflight(cmds.map((c) => ({ command: c, status: 'SKIP', why: 'no precondition' }))),
  })
  const o = r.result.outcomes[0]
  assert.equal(o.state, 'parked')
  assert.equal(o.reason, 'environment: no precondition can be checked for npm run lint, npm run test')
  assert.equal(builders(r), 1)
})

test('a gate env-fail whose probe passes is retried once; the second failure parks and names the command', async () => {
  const r = await runFlow({ plans: ['101'], checks: { 101: ['npm run test'] } }, {
    gateEnv: (folder) => (folder === '/wt/101' ? ['npm run test'] : []),
    runner: preflight([{ command: 'npm run test', status: 'OK' }]),
  })
  const o = r.result.outcomes[0]
  assert.equal(o.state, 'parked')
  assert.equal(o.reason, 'environment, again after one retry: gate env-fail: npm run test')
  assert.equal(builders(r), 2, 'one retry')
  assert.equal(envChecks(r).length, 1)
})

test('a gate env-fail whose probe passes and whose retry passes merges', async () => {
  const r = await runFlow({ plans: ['101'], checks: { 101: ['npm run test'] } }, {
    gateEnv: (folder, n) => (folder === '/wt/101' && n === 1 ? ['npm run test'] : []),
    runner: preflight([{ command: 'npm run test', status: 'OK' }]),
  })
  assert.equal(r.result.outcomes[0].state, 'merged')
})

test('plan 084 A2: the env check after a gate env-fail probes in the folder the gate ran in', async () => {
  const r = await runFlow({ plans: ['101'], checks: { 101: [CMD] } }, {
    gateEnv: (folder, n) => (folder === '/wt/101' && n === 1 ? [CMD] : []),
    runner: preflight([{ command: CMD, status: 'OK' }]),
  })
  assert.equal(r.result.outcomes[0].state, 'merged')
  assert.equal(envChecks(r).length, 1)
  assert.match(envChecks(r)[0], /--probe-dir \/wt\/101 /, envChecks(r)[0])
})

test('a gate with lost results keeps today\'s path: the generic env check (no --probe), one retry', async () => {
  // Every gate call answers with no result at all: "returned no result, twice" carries no probeCmds.
  const lost = await runFlow({ plans: ['101'], checks: { 101: ['npm run test'] } }, { lost: (folder) => folder === '/wt/101' })
  assert.match(lost.result.outcomes[0].reason, /^environment, again after one retry: gate returned no result, twice, for: .*npm run test/)
  assert.ok(envChecks(lost).length === 1 && envChecks(lost).every((c) => !c.includes('--probe')), envChecks(lost).join(' | '))
  assert.equal(builders(lost), 2)
})

test('a merge envFailure keeps today\'s path: the generic env check, the merge retried on its own', async () => {
  const r = await runFlow({ plans: ['101'], checks: { 101: ['npm run test'] } }, { mergeEnvOnce: true })
  assert.equal(r.result.outcomes[0].state, 'merged')
  assert.ok(envChecks(r).length === 1 && !envChecks(r)[0].includes('--probe'), envChecks(r).join(' | '))
  assert.equal(builders(r), 1)
})

// ---- the probe itself: the installed orch-preflight.mjs, run in a throw-away project folder ----------------------------
function probeProject({ modules = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'orch-probe-'))
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true }) // with scripts/node_modules: the libs import picomatch
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'p', scripts: { test: 'node -e 0' } }))
  if (modules) mkdirSync(join(dir, 'node_modules'))
  writeFileSync(join(dir, 'scripts', 'here.mjs'), '')
  return dir
}
const probeRunWith = (dir, extra, cmds) => spawnSync(process.execPath, [join(dir, 'scripts', 'orch-preflight.mjs'), '--env-only', ...extra, ...cmds.flatMap((c) => ['--probe', c])], { cwd: dir, encoding: 'utf8', env: { ...process.env, ORCH_FREE_GB: '999', DB_PORT: '' }, timeout: 60000 }).stdout
const probeRun = (dir, ...cmds) => probeRunWith(dir, [], cmds)
const probeRunIn = (dir, gateDir, ...cmds) => probeRunWith(dir, ['--probe-dir', gateDir], cmds)
const json = (out) => JSON.parse(/^ORCH_JSON (.*)$/m.exec(out)[1])
const drop = (dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })

test('probe: node <file> is OK when the file exists, FAIL with the path when it does not; other commands have no precondition', () => {
  const dir = probeProject()
  try {
    const missing = probeRun(dir, 'node scripts/missing.mjs')
    assert.match(missing, /^FAIL probe: node scripts\/missing\.mjs — scripts\/missing\.mjs not found in the root folder$/m)
    assert.equal(json(missing).probes[0].status, 'FAIL')
    assert.equal(json(missing).envFailure, true)
    assert.match(probeRun(dir, 'node scripts/here.mjs'), /^OK\s+probe node scripts\/here\.mjs$/m)
    const none = probeRun(dir, 'git status')
    assert.match(none, /^SKIP probe: no precondition — git status$/m)
    assert.deepEqual(json(none).probes, [{ command: 'git status', status: 'SKIP', why: 'no precondition' }])
    assert.match(probeRun(dir, 'node ../outside.mjs'), /^SKIP probe: no precondition/m, 'a path outside the root is never looked up')
  } finally {
    drop(dir)
  }
})

test('probe: npm|pnpm run <name> needs the script in package.json and node_modules', () => {
  const dir = probeProject()
  const bare = probeProject({ modules: false })
  try {
    assert.match(probeRun(dir, 'npm run test'), /^OK\s+probe npm run test$/m)
    assert.match(probeRun(dir, 'pnpm run test'), /^OK\s+probe pnpm run test$/m)
    assert.match(probeRun(dir, 'npm run nope'), /^FAIL probe: npm run nope — package\.json has no script nope$/m)
    assert.match(probeRun(bare, 'npm run test'), /^FAIL probe: npm run test — node_modules is missing/m)
    const two = json(probeRun(dir, 'npm run test', 'git status'))
    assert.deepEqual(two.probes.map((p) => p.status), ['OK', 'SKIP'])
  } finally {
    drop(dir)
    drop(bare)
  }
})

test('probe --probe-dir: node <file> is OK when the file exists only in the folder the gate ran in, FAIL when in neither', () => {
  const dir = probeProject()
  const gateDir = mkdtempSync(join(tmpdir(), 'orch-probe-gate-'))
  try {
    mkdirSync(join(gateDir, 'tools'))
    writeFileSync(join(gateDir, 'tools', 'x.mjs'), '')
    assert.match(probeRunIn(dir, gateDir, 'node tools/x.mjs'), /^OK\s+probe node tools\/x\.mjs$/m)
    assert.match(probeRun(dir, 'node tools/x.mjs'), /^FAIL probe: node tools\/x\.mjs — tools\/x\.mjs not found in the root folder$/m, 'without --probe-dir the root folder is searched')
    assert.match(probeRunIn(dir, gateDir, 'node tools/y.mjs'), /^FAIL probe: node tools\/y\.mjs — tools\/y\.mjs not found in the folder the gate ran in$/m)
    assert.match(probeRunIn(dir, 'relative/dir', 'node scripts/here.mjs'),/^OK\s+probe node scripts\/here\.mjs$/m, 'a relative folder falls back to the root folder')
  } finally {
    drop(dir)
    drop(gateDir)
  }
})
