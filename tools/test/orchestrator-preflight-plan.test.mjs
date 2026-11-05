// Plan 083: the preflight names a plan that will fail before any builder starts — code a commit guard refuses, a [ui]
// role with no login recipe, leftovers of earlier runs. The installed orch-preflight.mjs runs in a throw-away project.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const root = process.env.ORCH_ROOT ? resolve(process.env.ORCH_ROOT) : kit
const wfSource = readFileSync(join(root, '.claude', 'workflows', 'orchestrate.js'), 'utf8')

const sh = (cwd, ...a) => {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
const drop = (dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })

// A project folder with the installed scripts, the pack's security guard as an installed commit guard, and plans.
function project(plans, { guard = true, config = null, git = false } = {}) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'orch-plancheck-')))
  const dir = join(parent, 'main')
  mkdirSync(dir)
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true })
  if (guard) cpSync(join(kit, 'packs', 'angular', 'scripts', 'pre-commit-security-grep.mjs'), join(dir, 'scripts', 'pre-commit-security-grep.mjs'))
  mkdirSync(join(dir, 'plans'))
  for (const [nnn, text] of Object.entries(plans)) writeFileSync(join(dir, 'plans', `${nnn}-x.plan.md`), text)
  if (config) {
    mkdirSync(join(dir, '.kit'))
    writeFileSync(join(dir, '.kit', 'config.json'), JSON.stringify(config))
  }
  if (git) {
    sh(dir, 'init', '-q', '-b', 'main')
    sh(dir, 'config', 'user.email', 't@t')
    sh(dir, 'config', 'user.name', 't')
    writeFileSync(join(dir, '.git', 'info', 'exclude'), 'scripts/\n')
    sh(dir, 'add', '-A')
    sh(dir, 'commit', '-q', '-m', 'first')
  }
  return { dir, parent }
}
const preflight = (dir, ...a) => {
  const r = spawnSync(process.execPath, [join(dir, 'scripts', 'orch-preflight.mjs'), '--plan-checks', ...a], { cwd: dir, encoding: 'utf8', timeout: 60000 })
  const line = /^ORCH_JSON (.*)$/m.exec(r.stdout)
  assert.ok(line, `${r.stdout}${r.stderr}`)
  return { out: r.stdout, json: JSON.parse(line[1]) }
}
const plan = (body) => `# Plan — X\n\nStatus: draft\nDepends-on: none\n\n## Goals & Success Criteria\n\n- [auto] passes\n\n## Atomic Sub-tasks\n\n${body}\n`

test('plan guards: a plan that prescribes a PII log line is parked, naming the guard rule line and the plan line', () => {
  const p = project({
    101: plan('- [ ] S1: log it:\n\n```ts\nconsole.log(user.token)\n```\n'),
    102: plan('- [ ] S1: log it, marked: `console.log(user.token) // security-grep-allow: masked by the logger before output`'),
    103: plan('- [ ] S1: never log the token; keep `user.name` only'),
  })
  try {
    const { out, json } = preflight(p.dir, '--plans', '101,102,103')
    const guardSrc = readFileSync(join(p.dir, 'scripts', 'pre-commit-security-grep.mjs'), 'utf8').split(/\r?\n/)
    const ruleLine = guardSrc.findIndex((l) => l.includes('// RULE pii-log')) + 1
    assert.ok(ruleLine > 0)
    const planLine = readFileSync(join(p.dir, 'plans', '101-x.plan.md'), 'utf8').split('\n').findIndex((l) => l === 'console.log(user.token)') + 1
    assert.equal(json.parkPlans['101'], `guard pre-commit-security-grep.mjs line ${ruleLine}: log call references likely-PII name — plan line ${planLine}: console.log(user.token)`)
    assert.match(out, /^PARK plan 101: guard pre-commit-security-grep\.mjs line \d+: log call references likely-PII name/m)
    assert.equal(json.parkPlans['102'], undefined, 'the allow marker with a reason clears the prescribed line')
    assert.equal(json.parkPlans['103'], undefined, 'prose is never scanned')
    assert.equal(json.ok, true, 'a parked plan is not a FAIL: the run goes on')
  } finally {
    drop(p.parent)
  }
})

test('plan guards: no guard installed → SKIP, nothing parked', () => {
  const p = project({ 101: plan('```ts\nconsole.log(user.token)\n```') }, { guard: false })
  try {
    const { out, json } = preflight(p.dir, '--plans', '101')
    assert.match(out, /^SKIP plan guards: no commit guard exports scanGuardText$/m)
    assert.equal(json.parkPlans, undefined)
  } finally {
    drop(p.parent)
  }
})

// ---- L1: a [ui] card's role needs a login recipe in ui.logins --------------------------------------------------------
const uiPlan = (cards) => `# Plan — X\n\nStatus: draft\nDepends-on: none\n\n## Goals & Success Criteria\n\n${cards.map((c) => `- [ui] ${c}`).join('\n')}\n- [auto] passes\n\n## Atomic Sub-tasks\n\n- [ ] S1: x\n`
const recipe = (role) => ({ role, url: 'http://localhost:3000/api/login', userEnv: `ORCH_QA_${role.toUpperCase()}_USER`, passEnv: `ORCH_QA_${role.toUpperCase()}_PASSWORD` })

test('ui logins: a card for role admin with no recipe is flagged; a plan whose roles all have recipes is not', () => {
  const none = project({ 101: uiPlan(['Save works as the admin user on /settings']) }, { guard: false })
  const both = project({ 101: uiPlan(['Save works as the admin user on /settings', 'role: viewer — the list is read-only']) }, { guard: false, config: { ui: { logins: [recipe('admin'), recipe('viewer')] } } })
  try {
    const a = preflight(none.dir, '--plans', '101')
    assert.match(a.out, /^WARN ui login: no recipe for role admin \(plan 101 card 1\)$/m)
    assert.deepEqual(a.json.warnings, ['ui login: no recipe for role admin (plan 101 card 1)'])
    assert.equal(a.json.ok, true, 'a flag, not a FAIL')
    const b = preflight(both.dir, '--plans', '101')
    assert.equal(b.json.warnings, undefined, b.out)
    assert.match(b.out, /^OK\s+ui login recipes$/m)
  } finally {
    drop(none.parent)
    drop(both.parent)
  }
})

test('ui logins: with recipes set, a card that names no role is flagged; "as expected" is not a role', () => {
  const p = project({ 101: uiPlan(['The list loads as expected', 'Delete works as admin']) }, { guard: false, config: { ui: { logins: [recipe('admin')] } } })
  try {
    const { json } = preflight(p.dir, '--plans', '101')
    assert.deepEqual(json.warnings, ['ui login: no role named (plan 101 card 1) — write "as the <role> user" in the card'])
  } finally {
    drop(p.parent)
  }
})

test('ui logins: the --ui check with --role uses that role\'s recipe and fails for a role without one', () => {
  const p = project({}, { guard: false, config: { ui: { logins: [recipe('admin')] } } })
  try {
    const run = (...a) => spawnSync(process.execPath, [join(p.dir, 'scripts', 'orch-preflight.mjs'), '--ui', ...a], { cwd: p.dir, encoding: 'utf8', timeout: 60000 }).stdout
    assert.match(run('--role', 'viewer'), /^FAIL ui login: no login recipe for role viewer in ui\.logins/m)
    // admin's recipe URL is used (nothing answers on it here, so the login check fails on that URL, not on a missing recipe)
    assert.match(run('--role', 'admin'), /^FAIL ui login: .*localhost:3000\/api\/login/m)
  } finally {
    drop(p.parent)
  }
})

test('config: ui.logins holds role, url and the NAMES of the user and password variables only', async () => {
  const { orchestratorProblems } = await import(new URL('../lib/kit.mjs', import.meta.url).href)
  assert.deepEqual(orchestratorProblems({ 'ui.logins': [] }), [])
  assert.deepEqual(orchestratorProblems({ 'ui.logins': [recipe('admin'), recipe('viewer')] }), [])
  assert.match(orchestratorProblems({ 'ui.logins': {} }).join(), /must be a list/)
  assert.match(orchestratorProblems({ 'ui.logins': [{ ...recipe('admin'), password: 'x' }] }).join(), /unknown key\(s\) password/)
  assert.match(orchestratorProblems({ 'ui.logins': [{ ...recipe('admin'), passEnv: 'hunter2' }] }).join(), /passEnv "hunter2" must be the NAME/)
  assert.match(orchestratorProblems({ 'ui.logins': [recipe('admin'), recipe('admin')] }).join(), /role admin has a recipe already/)
  assert.match(orchestratorProblems({ 'ui.logins': [{ ...recipe('admin'), url: 'javascript:x' }] }).join(), /must be an http\(s\) URL/)
})

// ---- the workflow parks a preflight-named plan before any builder; the others go on ----------------------------------
async function runFlow(args, hooks = {}) {
  const calls = []
  const commands = []
  const plansIn = args.plans.map(String)
  const words = (cmd) => [...cmd.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2])
  const task = (prompt) => Object.fromEntries(String(prompt).split('\n').map((l) => /^([A-Z_]+): (.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]))
  const out = (o) => ({ exitCode: 0, output: `ORCH_JSON ${JSON.stringify(o)}` })
  const state = (w) => {
    const cmd = w[2]
    const f = Object.fromEntries(w.slice(3).map((x) => /^--([\w-]+)=(.*)$/.exec(x)).filter(Boolean).map((m) => [m[1], m[2]]))
    if (cmd === 'init') return { ok: true, mergeFolder: '/merge', startedAt: '2026-01-01T00:00:00.000Z' }
    if (cmd === 'order') {
      const named = String(f.plans ?? '').split(',').filter(Boolean)
      return { ok: true, waves: [hooks.orderAdds ? [...hooks.orderAdds, ...named] : named], waveLocks: [], edges: hooks.edges ?? [], skipped: [], plans: Object.fromEntries(plansIn.map((p) => [p, { path: `plans/${p}-x.plan.md` }])) }
    }
    if (cmd === 'plan-info') {
      const info = { ok: true, path: `plans/${f.plan}-x.plan.md`, branch: `feat/${f.plan}-x`, startTier: 'build', invariants: [], npmScripts: [], uiItems: [] }
      return f['with-worktree'] ? { ...info, wt: { ok: true, path: `/wt/${f.plan}` } } : info
    }
    if (cmd === 'finish') return { ok: true, merged: [], parked: [], report: 'r', local: 'l', reportCommitted: true }
    if (cmd === 'diff') return { ok: true, files: [], sensitive: false }
    return { ok: true }
  }
  async function agent(prompt, opts = {}) {
    const t = task(prompt)
    const type = opts.agentType ?? (/orch-builder\.md/.test(prompt) ? 'orch-builder' : undefined)
    calls.push({ type, label: opts.label, task: t })
    if (type === 'kit-runner') {
      const w = words(t.COMMAND)
      commands.push(t.COMMAND)
      if (w[1] === 'scripts/orch-preflight.mjs' && !t.COMMAND.includes('--env-only')) return out({ ok: true, problems: [], ...(hooks.preflight ?? {}) })
      return out(w[1] === 'scripts/orch-state.mjs' ? state(w) : { ok: true })
    }
    const base = { role: type, model: 'stub', effort: 'low' }
    if (type === 'orch-builder') return { ...base, status: 'built', branch: t.BRANCH, headSha: 'abc1234', summary: 's', evidence: ['e'], done: ['T1'], notDone: [], checksRun: [] }
    if (type === 'orch-gate') return { ...base, results: JSON.parse(t.COMMANDS).map((c) => ({ command: c, status: 'pass' })) }
    if (['orch-check-plan', 'orch-check-bugs', 'orch-check-rules', 'orch-security'].includes(type)) return { ...base, role: type, problems: [] }
    if (type === 'orch-verify') return { ...base, verdicts: [] }
    if (type === 'orch-merge') return { ...base, merged: true, sha: 'def5678' }
    if (type === 'orch-triage') return { ...base, items: [] }
    throw new Error(`stub: no agent for ${type} (${opts.label})`)
  }
  const parallel = (thunks) => Promise.all(thunks.map((th) => Promise.resolve().then(th)))
  const AsyncFunction = (async () => {}).constructor
  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow', 'require', 'process', wfSource.replace(/^export const meta\s*=/m, 'const meta ='))
  const result = await fn(agent, parallel, undefined, () => {}, () => {}, { mode: 'run', run: 'r1', root: '/main', pilot: false, ...args }, {}, undefined, undefined, undefined)
  return { result, calls, commands }
}
const builtPlans = (r) => r.calls.filter((c) => c.type === 'orch-builder').map((c) => /\/wt\/(\d+)|feat\/(\d+)/.exec(JSON.stringify(c.task))?.slice(1).find(Boolean))

test('workflow: a plan in the preflight parkPlans is parked with the reason before any builder; the others build and merge', async () => {
  const why = 'guard pre-commit-security-grep.mjs line 30: log call references likely-PII name — plan line 12: console.log(user.token)'
  const r = await runFlow({ plans: ['101', '102'] }, { preflight: { parkPlans: { 101: why }, warnings: ['ui login: no recipe for role admin (plan 102 card 1)'] } })
  const o = Object.fromEntries(r.result.outcomes.map((x) => [x.nnn, x]))
  assert.equal(o['101'].state, 'parked')
  assert.equal(o['101'].reason, `preflight: ${why}`)
  assert.equal(o['102'].state, 'merged')
  assert.deepEqual(builtPlans(r), ['102'], 'no builder for the parked plan')
  assert.ok(r.commands.some((c) => /orch-state\.mjs set/.test(c) && /--plan=?101/.test(c) && /parked/.test(c)), 'the park is recorded')
  assert.ok(!r.commands.some((c) => /orch-state\.mjs order/.test(c) && /101/.test(c)), 'the parked plan is not ordered')
})

test('workflow: a plan that depends on a preflight-parked plan is skipped, and plan-order cannot bring the parked one back', async () => {
  const r = await runFlow({ plans: ['101', '102'] }, { preflight: { parkPlans: { 101: 'guard x line 1: y' } }, orderAdds: ['101'], edges: [{ from: '101', to: '102' }] })
  const o = Object.fromEntries(r.result.outcomes.map((x) => [x.nnn, x]))
  assert.equal(o['101'].state, 'parked')
  assert.equal(o['102'].state, 'skipped')
  assert.deepEqual(builtPlans(r), [])
})
