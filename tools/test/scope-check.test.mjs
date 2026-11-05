// scope-check.mjs: a flag that needs a value stops with one usage line, and the reason a changed test file is refused
// names the missing test location. Runs the installed scripts/ (after `node tools/sync.mjs --target . --apply`) in a
// scratch repo.
//   node --test tools/test/scope-check.test.mjs
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, symlinkSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const { testLocationReason } = await import(pathToFileURL(join(kit, 'scripts', 'lib', 'plan-scope.mjs')).href)

let dir
const git = (...a) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8' })
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`)
}
const plan = (scope) => ['# Plan 001 — gate', '', 'Status: active', 'Depends-on: none', '', '## Read-Write Scope', '', '```scope', ...scope, '```', '', '## Atomic Sub-tasks', '- [ ] T1: x', ''].join('\n')
const scope = (...a) => spawnSync(process.execPath, ['scripts/scope-check.mjs', ...a], { cwd: dir, encoding: 'utf8' })

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'scope-check-'))
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
  git('add', '-A')
  git('commit', '-q', '-m', 'edit')
})
after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }))

test('--diff, --plan and --base without a value exit 2 with one usage line and no verdict', () => {
  for (const argv of [['--diff'], ['--diff='], ['--plan', 'plans/001-gate.plan.md', '--deps'], ['--arch', '--diff', 'main'], ['--base', '--diff=main']]) {
    const r = scope(...argv)
    assert.equal(r.status, 2, `${argv.join(' ')}: ${r.stdout}${r.stderr}`)
    const lines = r.stderr.split('\n').filter(Boolean)
    assert.equal(lines.length, 1, r.stderr)
    assert.match(lines[0], /^SCOPE_CHECK: --(diff|plan|base) needs a value: --(diff|plan|base)=</)
    assert.equal(r.stdout, '', 'no verdict printed')
    assert.doesNotMatch(r.stderr, /fatal|SCOPE: /)
  }
  // with values the same flags still work
  assert.equal(scope('--plan=plans/001-gate.plan.md', '--deps').status, 0)
})

test('a missing test location: the reason says no scope line names one, never that the scope does not cover the test files', () => {
  const r = scope('--diff=main', '--plan=plans/001-gate.plan.md')
  assert.equal(r.status, 1)
  assert.match(r.stdout, /^SCOPE: test-out tools\/test\/x\.test\.mjs$/m)
  assert.match(r.stdout, /tools\/test\/x\.test\.mjs: no scope line names a test location/)
  assert.doesNotMatch(r.stdout, /does not cover the test|outside the plan's scope/)
  const why = testLocationReason('src/a.test.ts')
  assert.match(why, /^src\/a\.test\.ts: no scope line names a test location/)
  assert.doesNotMatch(why, /does not cover the test files/)
})
