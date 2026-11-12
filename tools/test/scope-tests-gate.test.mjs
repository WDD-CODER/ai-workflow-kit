// The test-file gate (plan 049): scope-check --diff names a changed test file that no scope line naming a test
// location lists. Runs the installed scripts/ (after `node tools/sync.mjs --target . --apply`) in a scratch repo.
//   node --test tools/test/scope-tests-gate.test.mjs
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, symlinkSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const { isTestPath, testFilesOutOfScope } = await import(pathToFileURL(join(kit, 'scripts', 'lib', 'plan-scope.mjs')).href)
const picomatch = (await import(pathToFileURL(join(kit, 'scripts', 'node_modules', 'picomatch', 'index.js')).href)).default

let dir
const git = (...a) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8' })
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`)
}
const plan = (scope) => ['# Plan 001 — gate', '', 'Status: active', 'Depends-on: none', '', '## Read-Write Scope', '', '```scope', ...scope, '```', '', '## Atomic Sub-tasks', '- [ ] T1: x', ''].join('\n')
const check = () => spawnSync('node', ['scripts/scope-check.mjs', '--diff=main', '--plan=plans/001-gate.plan.md'], { cwd: dir, encoding: 'utf8' })

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'scope-tests-gate-'))
  cpSync(join(kit, 'scripts'), join(dir, 'scripts'), { recursive: true, filter: (s) => basename(s) !== 'node_modules' })
  symlinkSync(join(kit, 'scripts', 'node_modules'), join(dir, 'scripts', 'node_modules'), 'junction')
  mkdirSync(join(dir, 'plans'))
  mkdirSync(join(dir, 'tools', 'test'), { recursive: true })
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n')
  writeFileSync(join(dir, 'plans', '001-gate.plan.md'), plan(['tools/**']))
  git('init', '-q', '-b', 'main')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  git('switch', '-q', '-c', 'feat/001-gate')
  writeFileSync(join(dir, 'tools', 'test', 'x.test.mjs'), 'export {}\n')
  writeFileSync(join(dir, 'tools', 'real.mjs'), 'export {}\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'edit')
})
after(() => rmSync(dir, { recursive: true, force: true }))

test('isTestPath names the test locations', () => {
  for (const p of ['a.test.ts', 'src/a.spec.js', 'tools/test/x.mjs', 'x/tests/y.js', 'x/__tests__/y.js', 'e2e/a.js',
    'src/Test/A.js', 'pkg/a_test.go', 'pkg/test_a.py', 'web/e2e/a.ts', 'web/cypress/a.js', 'x/spec/a.rb', 'x/__snapshots__/a.snap']) assert.ok(isTestPath(p), p)
  for (const p of ['src/a.ts', 'tools/latest.mjs', 'docs/testing.md', 'src/contest_x.js', 'src/attest.mjs']) assert.ok(!isTestPath(p), p)
})

test('a broad folder glob does not list the tests under it', () => {
  assert.deepEqual(testFilesOutOfScope(['tools/test/x.test.mjs', 'tools/a.mjs'], ['tools/**'], (g) => picomatch(g, { dot: true })), ['tools/test/x.test.mjs'])
  assert.deepEqual(testFilesOutOfScope(['tools/test/x.test.mjs'], ['tools/**', 'tools/test/**'], (g) => picomatch(g, { dot: true })), [])
})

test('scope-check --diff: test-out under tools/**, ok when the scope names the test', () => {
  const out = check()
  assert.equal(out.status, 1)
  assert.match(out.stdout, /^SCOPE: test-out tools\/test\/x\.test\.mjs$/m)
  // A builder adding the test line to its own copy of the plan does not approve its test edits: the base ref decides.
  writeFileSync(join(dir, 'plans', '001-gate.plan.md'), plan(['tools/**', 'tools/test/x.test.mjs']))
  const self = check()
  assert.equal(self.status, 1, 'the branch copy of the plan is not trusted')
  assert.match(self.stdout, /SCOPE: test-out tools\/test\/x\.test\.mjs/)
  // The Human's approval is a plan on the base that names the test: then it is ok.
  git('checkout', '-q', '--', 'plans')
  git('switch', '-q', 'main')
  writeFileSync(join(dir, 'plans', '001-gate.plan.md'), plan(['tools/**', 'tools/test/x.test.mjs']))
  git('commit', '-q', '-am', 'plan names the test')
  git('switch', '-q', 'feat/001-gate')
  git('merge', '-q', '--no-edit', 'main')
  const ok = check()
  assert.equal(ok.status, 0, ok.stdout + ok.stderr)
  assert.match(ok.stdout, /SCOPE: ok/)
})

test('scope-check --diff: a renamed test file still counts as a changed test file', () => {
  git('switch', '-q', 'main')
  writeFileSync(join(dir, 'plans', '001-gate.plan.md'), plan(['tools/**']))
  git('commit', '-q', '-am', 'back to a broad scope')
  git('switch', '-q', '-c', 'feat/001-rename')
  mkdirSync(join(dir, 'tools', 'test'), { recursive: true })
  writeFileSync(join(dir, 'tools', 'test', 'old.test.mjs'), 'export const a = 1\nexport const b = 2\nexport const c = 3\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'add old test')
  git('switch', '-q', '-c', 'feat/001-rename2')
  git('mv', 'tools/test/old.test.mjs', 'tools/moved.mjs')
  git('commit', '-q', '-m', 'move the test away')
  const r = spawnSync('node', ['scripts/scope-check.mjs', '--diff=feat/001-rename', '--plan=plans/001-gate.plan.md'], { cwd: dir, encoding: 'utf8' })
  assert.equal(r.status, 1)
  assert.match(r.stdout, /SCOPE: test-out tools\/test\/old\.test\.mjs/)
})

// Plan 101: the test file next to a scoped file needs no scope line of its own.
const pm = (g) => picomatch(g, { dot: true })

test('101 (a) a sibling test of a scoped file is allowed', () => {
  assert.deepEqual(testFilesOutOfScope(['src/app/x.component.spec.ts'], ['src/app/x.component.ts'], pm), [])
})

test('101 (b) a glob covering the source file covers its sibling test', () => {
  assert.deepEqual(testFilesOutOfScope(['src/app/feature/y.service.spec.ts'], ['src/app/feature/**'], pm), [])
  assert.deepEqual(testFilesOutOfScope(['pkg/a_test.go', 'src/app/feature/z_spec.rb'], ['pkg/a.go', 'src/app/feature/z.rb'], pm), [])
})

test('101 (c) a test that is not next to a scoped file is still refused', () => {
  assert.deepEqual(testFilesOutOfScope(['src/app/other.component.spec.ts', 'e2e/x.spec.ts'], ['src/app/x.component.ts'], pm), ['src/app/other.component.spec.ts', 'e2e/x.spec.ts'])
})

test('101 (d) same folder only; a __tests__ folder directly beneath counts as the same folder', () => {
  assert.deepEqual(testFilesOutOfScope(['src/app/sub/x.component.spec.ts'], ['src/app/x.component.ts'], pm), ['src/app/sub/x.component.spec.ts'])
  assert.deepEqual(testFilesOutOfScope(['src/app/__tests__/x.component.spec.ts'], ['src/app/x.component.ts'], pm), [])
  assert.deepEqual(testFilesOutOfScope(['src/app/__tests__/deep/x.component.spec.ts'], ['src/app/x.component.ts'], pm), ['src/app/__tests__/deep/x.component.spec.ts'])
})

// The gate takes no diff any more: a sibling test passes whatever its diff does to assertions (the real-script test
// below changes one).
test('fix sibling-test-scope: a sibling test is in scope (plans 547, 552)', () => {
  // FoodVibe 547: the header spec changed `toBe(4)` to `toBe(5)`; the scope had the header folder glob.
  const header = 'src/app/core/components/header/header.component.spec.ts'
  assert.deepEqual(testFilesOutOfScope([header], ['header.component.spec.ts', 'src/app/core/components/header/**'], pm), [])
  // FoodVibe 552: the tab-chips spec beside the scoped component file.
  const chips = 'src/app/core/components/tab-chips/tab-chips.component.spec.ts'
  assert.deepEqual(testFilesOutOfScope([chips], ['src/app/core/components/tab-chips/tab-chips.component.ts'], pm), [])
})

test('fix sibling-test-scope: scope-check --diff passes a sibling test whose assertions changed', () => {
  git('switch', '-q', 'main')
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'plans', '001-gate.plan.md'), plan(['src/a.ts']))
  writeFileSync(join(dir, 'src', 'a.spec.ts'), 'expect(a).toBe(1)\nconst k = 1\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'sibling base')
  git('switch', '-q', '-c', 'feat/001-sib')
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1\n')
  writeFileSync(join(dir, 'src', 'a.spec.ts'), 'const k = 1\nconst z = 2\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'change an assertion')
  const r = spawnSync('node', ['scripts/scope-check.mjs', '--diff=main', '--plan=plans/001-gate.plan.md'], { cwd: dir, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /SCOPE: ok/)
})
