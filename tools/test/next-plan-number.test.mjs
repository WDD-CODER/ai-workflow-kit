// Plan 038: scripts/next-plan-number.mjs (installed) counts the plan files on every local and remote branch, not
// only the branches whose name carries a number. Scratch repositories only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'path'
import { spawnSync, execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, cpSync } from 'fs'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const root = process.env.ORCH_ROOT ? resolve(process.env.ORCH_ROOT) : kit

const sh = (cwd, ...a) => {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'next-plan-')))

/** A plan file committed on the current branch of dir. */
function plan(dir, rel, msg) {
  mkdirSync(join(dir, rel, '..'), { recursive: true })
  writeFileSync(join(dir, rel), `# ${rel}\n`)
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '-q', '-m', msg)
}

/** Scratch project with a bare origin: plans/001-a on main (pushed), a remote-only branch plan/two-plans holding
 *  040 and 041, and a local branch feat/012-x with no plan file. The installed scripts/ are copied in, so the
 *  script's repoRoot is the scratch root. */
function project() {
  const origin = join(tmp(), 'origin.git')
  spawnSync('git', ['init', '-q', '--bare', origin])
  const dir = tmp()
  sh(dir, 'init', '-q', '-b', 'main')
  sh(dir, 'config', 'user.email', 't@t')
  sh(dir, 'config', 'user.name', 't')
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true, dereference: true })
  writeFileSync(join(dir, '.gitignore'), 'scripts/\n')
  plan(dir, 'plans/001-a.plan.md', 'plan 001')
  sh(dir, 'remote', 'add', 'origin', origin)
  sh(dir, 'push', '-q', '-u', 'origin', 'main')
  // a branch without a number in its name, holding two plans, pushed and then dropped locally
  sh(dir, 'switch', '-q', '-c', 'plan/two-plans')
  plan(dir, 'plans/040-b.plan.md', 'plan 040')
  plan(dir, 'plans/041-c.plan.md', 'plan 041')
  sh(dir, 'push', '-q', '-u', 'origin', 'plan/two-plans')
  sh(dir, 'switch', '-q', 'main')
  sh(dir, 'branch', '-q', '-D', 'plan/two-plans')
  // a numbered local branch with no plan file
  sh(dir, 'branch', 'feat/012-x', 'main')
  return { dir, origin }
}

const next = (dir, ...args) => execFileSync(process.execPath, [join(dir, 'scripts', 'next-plan-number.mjs'), ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split(/\r?\n/).pop()

test('a plan file on a remote-only branch without a number in its name takes its number', () => {
  const { dir } = project()
  assert.equal(next(dir), '042')
  // without that branch the numbered branch name is the highest
  sh(dir, 'push', '-q', 'origin', '--delete', 'plan/two-plans')
  assert.equal(next(dir), '013')
  rmSync(dir, { recursive: true, force: true })
})

test('a plan filed under plans/done/ on a branch counts too — the max is what matters', () => {
  const { dir } = project()
  sh(dir, 'switch', '-q', '-c', 'chore/release-notes')
  plan(dir, 'plans/done/045-d.plan.md', 'file plan 045')
  sh(dir, 'switch', '-q', 'main')
  assert.equal(next(dir), '046')
  rmSync(dir, { recursive: true, force: true })
})

test('--no-fetch skips the fetch and still reads the remote-tracking refs the clone has', () => {
  const { dir } = project()
  // the remote gains a plan the local refs do not know about yet
  const other = tmp()
  sh(other, 'clone', '-q', sh(dir, 'remote', 'get-url', 'origin'), 'c')
  const clone = join(other, 'c')
  sh(clone, 'config', 'user.email', 't@t')
  sh(clone, 'config', 'user.name', 't')
  sh(clone, 'switch', '-q', '-c', 'plan/later')
  plan(clone, 'plans/050-e.plan.md', 'plan 050')
  sh(clone, 'push', '-q', '-u', 'origin', 'plan/later')
  assert.equal(next(dir, '--no-fetch'), '042', 'stale refs: 040/041 on plan/two-plans still count, 050 is unseen')
  assert.equal(next(dir), '051', 'a fetch sees plan/later')
  rmSync(dir, { recursive: true, force: true })
  rmSync(other, { recursive: true, force: true })
})
