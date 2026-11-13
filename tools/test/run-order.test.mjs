// run-order: the run reads its merged plans from origin/<run branch>, not from a stale local branch (K4, batch-3 dry run).
//   node --test tools/test/run-order.test.mjs
// Runs the installed scripts of the kit repo (scripts/, after `node tools/sync.mjs --target . --apply` and
// `npm ci --prefix scripts`), copied into a scratch project with a local bare origin.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const { runOrder } = await import(pathToFileURL(join(kit, 'scripts', 'lib', 'run-order.mjs')).href)

const scratch = []
after(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true })
})

function gitIn(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=run-order-test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}

const plan = (nnn, deps) => [
  `# Plan ${nnn} — Plan ${nnn} fixture`, '', 'Status: draft', `Depends-on: ${deps}`, '',
  '## Prerequisites', '- none.', '',
  '## Read-Write Scope', '', '```scope', `src/p${nnn}/**`, '```', '',
  '## Atomic Sub-tasks', `- [ ] T1: Do the work of plan ${nnn} — src`, '',
].join('\n')

// A project with plans 001 and 002 (002 needs 001), run branch orch/x pushed to origin. A second clone pushes the
// merge marker of plan 001 onto origin/orch/x; the project fetches, so its local orch/x stays behind origin.
function project() {
  const root = mkdtempSync(join(tmpdir(), 'run-order-'))
  scratch.push(root)
  const origin = join(root, 'origin.git')
  const proj = join(root, 'proj')
  const other = join(root, 'other')
  gitIn(root, 'init', '-q', '--bare', '-b', 'main', origin)
  mkdirSync(join(proj, 'plans'), { recursive: true })
  cpSync(join(kit, 'scripts'), join(proj, 'scripts'), { recursive: true })
  writeFileSync(join(proj, 'plans', '001-p001.plan.md'), plan('001', 'none'))
  writeFileSync(join(proj, 'plans', '002-p002.plan.md'), plan('002', '001'))
  writeFileSync(join(proj, '.gitignore'), 'scripts/\n')
  gitIn(proj, 'init', '-q', '-b', 'main')
  gitIn(proj, 'add', '-A')
  gitIn(proj, 'commit', '-q', '-m', 'plans')
  gitIn(proj, 'remote', 'add', 'origin', origin)
  gitIn(proj, 'push', '-q', '-u', 'origin', 'main')
  gitIn(proj, 'branch', 'orch/x')
  gitIn(proj, 'push', '-q', 'origin', 'orch/x')
  gitIn(root, 'clone', '-q', '-b', 'orch/x', origin, other)
  gitIn(other, 'commit', '-q', '--allow-empty', '-m', 'Merge feat/001-p001 into orch/x (plan 001)')
  gitIn(other, 'push', '-q', 'origin', 'orch/x')
  gitIn(proj, 'fetch', '-q', 'origin')
  return { proj }
}

test('run-order: a local run branch behind origin does not hide plans merged on origin', () => {
  const { proj } = project()
  const o = runOrder({ root: proj, plans: ['001', '002'], runBranch: 'orch/x' })
  assert.equal(o.ok, true, o.error)
  assert.deepEqual(o.waves, [['002']])
  assert.match(String(o.done['001']), /merged into orch\/x/)
  assert.equal(o.warning ?? null, null, 'a local branch only behind origin is no warning')
})

test('run-order: a local run branch that is not in origin\'s history gets one warning line naming both SHAs', () => {
  const { proj } = project()
  gitIn(proj, 'switch', '-q', 'orch/x')
  gitIn(proj, 'commit', '-q', '--allow-empty', '-m', 'local only')
  gitIn(proj, 'switch', '-q', 'main')
  const local = gitIn(proj, 'rev-parse', 'orch/x')
  const remote = gitIn(proj, 'rev-parse', 'origin/orch/x')
  const o = runOrder({ root: proj, plans: ['001', '002'], runBranch: 'orch/x' })
  assert.equal(o.ok, true, o.error)
  assert.deepEqual(o.waves, [['002']], 'origin still wins')
  assert.ok(o.warning && !o.warning.includes('\n'), 'one warning line')
  assert.ok(o.warning.includes(local.slice(0, 12)) && o.warning.includes(remote.slice(0, 12)), o.warning)
})

test('run-order: with no origin run branch the local branch is read', () => {
  const { proj } = project()
  gitIn(proj, 'branch', 'orch/y', 'origin/orch/x')
  const o = runOrder({ root: proj, plans: ['001', '002'], runBranch: 'orch/y' })
  assert.equal(o.ok, true, o.error)
  assert.deepEqual(o.waves, [['002']])
  assert.match(String(o.done['001']), /merged into orch\/x/)
})
