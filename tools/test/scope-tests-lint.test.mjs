// The save-plan test-location lint (scope-check --tests): a plan whose scope names code and no test location gets a
// warning; docs-only plans and plans with a test line do not. Also the real-scripts test: the installed scope-check.mjs
// and orch-state.mjs (no stub) in a scratch repo with a bare origin, to show the lint and the gate agree.
// Runs the installed scripts/ (after `node tools/sync.mjs --target . --apply`).
//   node --test tools/test/scope-tests-lint.test.mjs
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, symlinkSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const { scopeTestsLint } = await import(pathToFileURL(join(kit, 'scripts', 'lib', 'scope-tests-lint.mjs')).href)

const plan = (scope, eol = '\n') => ['# Plan 001 — x', '', 'Status: active', 'Depends-on: none', '', '## Read-Write Scope', '', '```scope', ...scope, '```', '', '## Atomic Sub-tasks', '- [ ] T1: x', ''].join(eol)

test('warns when the scope names code and no test location', () => {
  const r = scopeTestsLint(plan(['src/**']))
  assert.equal(r.status, 'warn')
  assert.deepEqual(r.codeGlobs, ['src/**'])
})

test('no warning for a docs-only plan', () => {
  assert.equal(scopeTestsLint(plan(['docs/**', 'README.md', 'CHANGELOG.md', 'plans/*.plan.md', 'notes/x.txt'])).status, 'docs-only')
})

test('no warning when a scope line names a test location', () => {
  assert.equal(scopeTestsLint(plan(['src/**', 'src/a.test.ts'])).status, 'ok')
  assert.equal(scopeTestsLint(plan(['tools/**', 'tools/test/**'])).status, 'ok')
})

test('a plan whose only lines are test lines is ok; a test line does not count as code', () => {
  const r = scopeTestsLint(plan(['tools/test/**']))
  assert.equal(r.status, 'ok')
  assert.deepEqual(r.codeGlobs, [])
})

test('a docs line next to code does not hide the warning; CRLF text reads the same', () => {
  assert.equal(scopeTestsLint(plan(['src/**', 'docs/**'])).status, 'warn')
  assert.equal(scopeTestsLint(plan(['src/**'], '\r\n')).status, 'warn')
})

test('a plan with no scope block is skipped', () => {
  assert.equal(scopeTestsLint('# Plan 001 — x\n\nStatus: draft\n').status, 'no-scope')
})

test('the lint holds no test-path pattern of its own: it uses plan-scope.mjs', () => {
  const src = readFileSync(join(kit, 'scripts', 'lib', 'scope-tests-lint.mjs'), 'utf8').replace(/\/\*\*[\s\S]*?\*\//, '')
  assert.match(src, /import \{[^}]*testScopeGlobs[^}]*\} from '\.\/plan-scope\.mjs'/)
  assert.doesNotMatch(src, /__tests__|\.test\.|\.spec\.|e2e|cypress|playwright/)
})

test('the shipped instructions carry the rule, and save-plan runs --tests', () => {
  const read = (...p) => readFileSync(join(kit, 'core', '.claude', ...p), 'utf8').replace(/\s+/g, ' ')
  for (const f of [['commands', 'plan.md'], ['references', 'prd-template.md'], ['skills', 'save-plan', 'SKILL.md']]) {
    const t = read(...f)
    assert.match(t, /name the test location/, `${f.join('/')} says a scope line must name the test location`)
    assert.match(t, /does not cover the tests under it/, `${f.join('/')} says a code-folder glob does not cover the tests`)
  }
  const skill = read('skills', 'save-plan', 'SKILL.md')
  assert.equal((skill.match(/scope-check\.mjs --tests --plan=<path>/g) ?? []).length >= 2, true, 'checklist and Phase 2 both run --tests')
})

// FoodVibe 547 and 552: scope lines that are only a test's file name match nothing; the lint said ok.
test('fix sibling-test-scope: a scope line that is only a test file name is bad (547, 552)', () => {
  const r547 = scopeTestsLint(plan(['tab-chips.component.spec.ts', 'header.component.spec.ts', 'src/app/core/components/header/**', 'e2e/ui/547-1.spec.ts']))
  assert.equal(r547.status, 'bad')
  assert.deepEqual(r547.bare, ['tab-chips.component.spec.ts', 'header.component.spec.ts'])
  const r552 = scopeTestsLint(plan(['src/app/core/components/tab-chips/tab-chips.component.ts', 'requests.page.spec.ts']))
  assert.equal(r552.status, 'bad')
  assert.deepEqual(r552.bare, ['requests.page.spec.ts'])
  // A root file is a path from the repo root: never bare.
  assert.equal(scopeTestsLint(plan(['src/**', 'src/a.test.ts', 'package.json', 'CHANGELOG.md'])).status, 'ok')
})

// FoodVibe 580: the plan named test files the scope did not cover; the run's start check refused, the lint said ok.
test('fix sibling-test-scope: a test path the plan names that the run would refuse is a warn, with the line to add (580)', () => {
  const text = plan(['server/routes/ai.js', 'server/test/ai-menu.test.js'])
    .replace('- [ ] T1: x', '- [ ] A6: Test the menu route — server/test/ai-menu.test.js (pattern: server/test/ai-match-product-names.test.js; `captureLogs` from server/test/helpers/log-capture.js)')
  const r = scopeTestsLint(text)
  assert.equal(r.status, 'warn')
  assert.deepEqual(r.refused.map((x) => x.file), ['server/test/ai-match-product-names.test.js', 'server/test/helpers/log-capture.js'])
  assert.match(r.refused[0].reason, /no scope line names a test location/)
  // A test beside a scoped file, named in the plan, is in scope.
  const sib = plan(['src/app/x.component.ts', 'src/app/x.test.ts']).replace('- [ ] T1: x', '- [ ] T1: Update the test — src/app/x.component.spec.ts')
  assert.equal(scopeTestsLint(sib).status, 'ok')
})

test('save-plan eval 2 covers the code-folder-only plan', () => {
  const evals = JSON.parse(readFileSync(join(kit, 'core', '.claude', 'skills', 'save-plan', 'evals', 'evals.json'), 'utf8')).evals
  const e = evals.find((x) => x.id === 2)
  assert.ok(e, 'eval id 2 exists')
  assert.match(e.prompt, /src\/orders\/\*\*/)
  assert.ok(e.assertions.some((a) => /SCOPE_TESTS: warn/.test(a)))
})

// ---- the real scripts, no stubs ---------------------------------------------------------------------------------------
let dir, origin
const git = (cwd, ...a) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`)
  return r.stdout
}
const script = (name, ...a) => spawnSync(process.execPath, [join('scripts', name), ...a], { cwd: dir, encoding: 'utf8' })
// The orchestrator's own call (run-plans.mjs: state('diff', { run, plan })), read from its ORCH_JSON line.
const orchDiff = (nnn) => {
  const r = script('orch-state.mjs', 'diff', '--run', 'r', '--plan', nnn)
  const line = r.stdout.split('\n').find((l) => l.startsWith('ORCH_JSON '))
  assert.ok(line, `orch-state diff printed no ORCH_JSON: ${r.stdout} ${r.stderr}`)
  return { status: r.status, json: JSON.parse(line.slice('ORCH_JSON '.length)) }
}

before(() => {
  const root = mkdtempSync(join(tmpdir(), 'scope-tests-lint-'))
  dir = join(root, 'proj')
  origin = join(root, 'origin.git')
  mkdirSync(dir)
  git(root, 'init', '-q', '--bare', '-b', 'main', origin)
  cpSync(join(kit, 'scripts'), join(dir, 'scripts'), { recursive: true, filter: (s) => basename(s) !== 'node_modules' })
  symlinkSync(join(kit, 'scripts', 'node_modules'), join(dir, 'scripts', 'node_modules'), 'junction')
  mkdirSync(join(dir, 'plans'))
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n')
  // 001: scope names code only. 002: the same plus a test line.
  writeFileSync(join(dir, 'plans', '001-gate.plan.md'), plan(['src/**']))
  // The changed test lives in a test folder under the code glob: a test beside a scoped file (src/a.test.ts) needs no
  // line since the sibling-test rule, so only a test elsewhere (src/e2e/) shows the gate block.
  writeFileSync(join(dir, 'plans', '002-ok.plan.md'), plan(['src/**', 'src/e2e/a.spec.ts']).replace('Plan 001', 'Plan 002'))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'base')
  git(dir, 'remote', 'add', 'origin', origin)
  git(dir, 'push', '-q', 'origin', 'main')
  git(dir, 'push', '-q', 'origin', 'main:refs/heads/orch/r')
  for (const b of ['feat/001-gate', 'feat/002-ok']) {
    git(dir, 'switch', '-q', '-c', b, 'main')
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'a.ts'), 'export {}\n')
    mkdirSync(join(dir, 'src', 'e2e'), { recursive: true })
    writeFileSync(join(dir, 'src', 'e2e', 'a.spec.ts'), 'export {}\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', `edit ${b}`)
    git(dir, 'push', '-q', 'origin', b)
  }
  git(dir, 'switch', '-q', 'main')
})
after(() => { if (dir) rmSync(resolve(dir, '..'), { recursive: true, force: true }) })

test('real scripts: a plan the lint warns about is the plan the gate blocks', () => {
  const lint = script('scope-check.mjs', '--tests', '--plan=plans/001-gate.plan.md')
  assert.equal(lint.status, 0)
  assert.match(lint.stdout, /^SCOPE_TESTS: warn/)
  assert.match(lint.stdout, /src\/\*\*/)

  git(dir, 'switch', '-q', 'feat/001-gate')
  const gate = script('scope-check.mjs', '--diff=main', '--plan=plans/001-gate.plan.md')
  git(dir, 'switch', '-q', 'main')
  assert.equal(gate.status, 1, gate.stdout + gate.stderr)
  assert.match(gate.stdout, /SCOPE: test-out src\/e2e\/a\.spec\.ts/)

  const d = orchDiff('001')
  assert.equal(d.json.ok, true, JSON.stringify(d.json))
  assert.deepEqual(d.json.testsOutOfScope, ['src/e2e/a.spec.ts'])
})

test('real scripts: a plan the lint accepts passes the gate', () => {
  const lint = script('scope-check.mjs', '--tests', '--plan=plans/002-ok.plan.md')
  assert.equal(lint.status, 0)
  assert.match(lint.stdout, /^SCOPE_TESTS: ok/)

  git(dir, 'switch', '-q', 'feat/002-ok')
  const gate = script('scope-check.mjs', '--diff=main', '--plan=plans/002-ok.plan.md')
  git(dir, 'switch', '-q', 'main')
  assert.equal(gate.status, 0, gate.stdout + gate.stderr)
  assert.match(gate.stdout, /SCOPE: ok/)

  const d = orchDiff('002')
  assert.equal(d.json.ok, true, JSON.stringify(d.json))
  assert.deepEqual(d.json.testsOutOfScope, [])
})

test('real scripts: --tests needs --plan, exits 0 on ok or warn and 1 on a bare scope line', () => {
  assert.equal(script('scope-check.mjs', '--tests').status, 1)
  assert.equal(script('scope-check.mjs', '--tests', '--plan=plans/001-gate.plan.md').status, 0)
  writeFileSync(join(dir, 'plans', '003-bare.plan.md'), plan(['src/**', 'a.spec.ts']).replace('Plan 001', 'Plan 003'))
  const bad = script('scope-check.mjs', '--tests', '--plan=plans/003-bare.plan.md')
  rmSync(join(dir, 'plans', '003-bare.plan.md'))
  assert.equal(bad.status, 1, bad.stdout + bad.stderr)
  assert.match(bad.stdout, /^SCOPE_TESTS: bad/)
  assert.match(bad.stdout, /a\.spec\.ts: bare file name — write the path from the repo root/)
})
