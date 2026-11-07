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
    // the bad line quoted where the plan describes the fault or its check, never prescribed
    // a prohibition in a sub-task, and a bare name in a span, are not prescribed statements
    105: plan('- [ ] S1: never bind `[innerHTML]` to user text; do not call `console.log(user.token)` anywhere'),
    104: `# Plan — X\n\nStatus: draft\n\n## Problem Statement\n\nToday \`console.log(user.token)\` leaks.\n\n## Goals & Success Criteria\n\n- [auto] a plan with \`console.log(user.token)\` is parked\n\n## Atomic Sub-tasks\n\n- [ ] S1: mask it\n`,
  })
  try {
    const { out, json } = preflight(p.dir, '--plans', '101,102,103,104,105')
    assert.equal(json.parkPlans['105'], undefined, 'a prohibition is not prescribed code')
    assert.equal(json.parkPlans['104'], undefined, 'code quoted in Problem Statement or Goals is not prescribed')
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

// ---- S1: leftovers of earlier runs ------------------------------------------------------------------------------------
test('leftovers: an unmerged feat/NNN branch, a park branch and an occupied slot are listed one line each; a clean repo lists none', () => {
  const p = project({ 101: plan('- [ ] S1: x') }, { guard: false, git: true })
  const bare = realpathSync(mkdtempSync(join(tmpdir(), 'orch-plancheck-origin-')))
  try {
    sh(bare, 'init', '-q', '--bare', '-b', 'main')
    sh(p.dir, 'remote', 'add', 'origin', bare)
    sh(p.dir, 'push', '-q', '-u', 'origin', 'main')
    const clean = preflight(p.dir, '--plans', '101', '--run', 'r2')
    assert.equal(clean.json.warnings, undefined, clean.out)
    assert.match(clean.out, /^OK\s+leftovers$/m)
    // an earlier run's branch of plan 101 with a commit main does not have, and a park branch
    sh(p.dir, 'switch', '-q', '-c', 'feat/101-x')
    writeFileSync(join(p.dir, 'w.txt'), 'w\n')
    sh(p.dir, 'add', 'w.txt')
    sh(p.dir, 'commit', '-q', '-m', 'work')
    sh(p.dir, 'branch', 'park/r1-101')
    sh(p.dir, 'switch', '-q', 'main')
    // a branch of a plan that is not in this run is not listed
    sh(p.dir, 'branch', 'feat/205-other', 'feat/101-x')
    // an occupied slot beside the main folder
    const slot = join(p.parent, 'main-wt-1')
    sh(p.dir, 'worktree', 'add', '-q', '--detach', slot, 'main')
    writeFileSync(join(slot, '.worktree-plan'), 'plans/101-x.plan.md\n')
    const { json, out } = preflight(p.dir, '--plans', '101', '--run', 'r2')
    assert.deepEqual(json.warnings.map((w) => w.replace(/ \(local\)| \(origin\)/, '')).sort(), [
      'leftover: branch feat/101-x of plan 101 is not in origin/main — an earlier run\'s work; the run reuses it',
      'leftover: park branch park/r1-101 holds work saved when an earlier run parked a plan',
      `leftover: slot ${slot.replace(/\\/g, '/')} is occupied (plan plans/101-x.plan.md)`,
    ].sort(), out)
    assert.equal(json.ok, true, 'leftovers are named, never a FAIL')
  } finally {
    drop(p.parent)
    drop(bare)
  }
})

// ---- the workflow parks a preflight-named plan before any builder; the others go on ----------------------------------

