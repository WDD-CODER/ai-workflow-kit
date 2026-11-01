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
  for (const p of ['a.test.ts', 'src/a.spec.js', 'tools/test/x.mjs', 'x/tests/y.js', 'x/__tests__/y.js', 'e2e/a.js']) assert.ok(isTestPath(p), p)
  for (const p of ['src/a.ts', 'tools/latest.mjs', 'docs/testing.md']) assert.ok(!isTestPath(p), p)
})

test('a broad folder glob does not list the tests under it', () => {
  assert.deepEqual(testFilesOutOfScope(['tools/test/x.test.mjs', 'tools/a.mjs'], ['tools/**'], (g) => picomatch(g, { dot: true })), ['tools/test/x.test.mjs'])
  assert.deepEqual(testFilesOutOfScope(['tools/test/x.test.mjs'], ['tools/**', 'tools/test/**'], (g) => picomatch(g, { dot: true })), [])
})

test('scope-check --diff: test-out under tools/**, ok when the scope names the test', () => {
  const out = check()
  assert.equal(out.status, 1)
  assert.match(out.stdout, /^SCOPE: test-out tools\/test\/x\.test\.mjs$/m)
  writeFileSync(join(dir, 'plans', '001-gate.plan.md'), plan(['tools/**', 'tools/test/x.test.mjs']))
  const ok = check()
  assert.equal(ok.status, 0, ok.stdout + ok.stderr)
  assert.match(ok.stdout, /SCOPE: ok/)
})
