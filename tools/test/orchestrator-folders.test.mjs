// Plan 028: the orchestrator's builder folders (scripts/lib/orch-folders.mjs, installed), the watch-mode check
// (scripts/lib/orch-run.mjs) and the config keys it added (tools/lib/kit.mjs). Scratch repositories only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { pathToFileURL, fileURLToPath } from 'url'
import { orchestratorProblems, commandProblems } from '../lib/kit.mjs'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const root = process.env.ORCH_ROOT ? resolve(process.env.ORCH_ROOT) : kit
const folders = await import(pathToFileURL(join(root, 'scripts', 'lib', 'orch-folders.mjs')).href)
const runLib = await import(pathToFileURL(join(root, 'scripts', 'lib', 'orch-run.mjs')).href)

const sh = (cwd, ...a) => {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'orch-folders-')))
function repo() {
  const dir = tmp()
  sh(dir, 'init', '-q', '-b', 'main')
  sh(dir, 'config', 'user.email', 't@t')
  sh(dir, 'config', 'user.name', 't')
  writeFileSync(join(dir, 'a.txt'), 'a\n')
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '-q', '-m', 'first')
  return dir
}
const slotOf = (main, n) => {
  const path = join(tmp(), `proj-wt-${n}`)
  sh(main, 'worktree', 'add', '-q', '--detach', path, 'main')
  return { slot: n, path, branch: null, detached: true, plan: null }
}

test('pnpm 10 "Ignored build scripts" is read into a WARN list; npm output and a clean pnpm install give none', () => {
  assert.deepEqual(folders.ignoredBuildScripts('Progress: resolved 1200\n╭ Warning ╮\n│ Ignored build scripts: @parcel/watcher, esbuild, lmdb, msgpackr-extract.\n│ Run "pnpm approve-builds"'), ['@parcel/watcher', 'esbuild', 'lmdb', 'msgpackr-extract'])
  assert.deepEqual(folders.ignoredBuildScripts('added 1200 packages in 40s'), [])
  assert.deepEqual(folders.ignoredBuildScripts(''), [])
})

test('watch mode: vitest and jest without a way out, and a project pattern, are named; exiting scripts are not', () => {
  assert.match(runLib.watchModeProblem('vitest'), /vitest/)
  assert.match(runLib.watchModeProblem('jest --watch'), /jest/)
  for (const ok of ['vitest run', 'vitest --run', 'jest --ci', 'jest --watch=false', 'node --test tests/', undefined, '']) {
    assert.equal(runLib.watchModeProblem(ok), null, String(ok))
  }
  // a project names its own framework's watch-mode command
  const pattern = 'tester\\s+serve(?!.*--once)'
  assert.match(runLib.watchModeProblem('tester serve', pattern), /watchTestPattern/)
  assert.equal(runLib.watchModeProblem('tester serve --once', pattern), null)
  assert.equal(runLib.watchModeProblem('tester serve', '(unbalanced'), null)
})

test('config: gateTimeoutMin, concurrency and useSlots are bounded; unset keys are fine', () => {
  assert.deepEqual(orchestratorProblems({ 'orchestrator.gateTimeoutMin': 15, 'orchestrator.concurrency': 2, 'orchestrator.useSlots': true }), [])
  assert.deepEqual(orchestratorProblems({}), [])
  for (const v of [0, 121, 1.5, '15']) assert.match(orchestratorProblems({ 'orchestrator.gateTimeoutMin': v }).join(), /gateTimeoutMin/)
  for (const v of [0, 4, '2']) assert.match(orchestratorProblems({ 'orchestrator.concurrency': v }).join(), /concurrency/)
  for (const v of ['yes', 1, null]) assert.match(orchestratorProblems({ 'orchestrator.useSlots': v }).join(), /useSlots/)
  assert.deepEqual(orchestratorProblems({ 'orchestrator.watchTestPattern': '' }), [])
  assert.deepEqual(orchestratorProblems({ 'orchestrator.watchTestPattern': 'tester\\s+serve' }), [])
  for (const v of ['(unbalanced', 3]) assert.match(orchestratorProblems({ 'orchestrator.watchTestPattern': v }).join(), /watchTestPattern/)
})

test('config: commands.testCi is a script name, project.packageManager is npm or pnpm, pnpm needs its own ci.install', () => {
  const models = Object.fromEntries(['mechanical', 'analysis', 'judgment', 'build', 'review'].map((k) => [`models.${k}`, 'sonnet']))
  const probs = (v) => commandProblems({ ...models, ...v })
  assert.deepEqual(probs({ 'commands.testCi': 'test:ci' }), [])
  assert.match(probs({ 'commands.testCi': 'npm run test:ci' }).join(), /commands\.testCi/)
  assert.deepEqual(probs({ 'project.packageManager': 'pnpm', 'ci.install': 'pnpm install --frozen-lockfile' }), [])
  assert.match(probs({ 'project.packageManager': 'yarn' }).join(), /project\.packageManager/)
  assert.match(probs({ 'project.packageManager': 'pnpm', 'ci.install': 'npm ci' }).join(), /ci\.install/)
  assert.deepEqual(probs({ 'project.packageManager': 'npm', 'ci.install': 'npm ci' }), [])
})

test('installCommand and lockFile follow the package manager', () => {
  assert.deepEqual(folders.installCommand('pnpm'), ['pnpm', ['install', '--frozen-lockfile']])
  assert.deepEqual(folders.installCommand('npm'), ['npm', ['ci', '--no-audit', '--no-fund']])
  assert.equal(folders.lockFile('pnpm'), 'pnpm-lock.yaml')
  assert.equal(folders.lockFile('npm'), 'package-lock.json')
})

test('slots: an idle slot is claimed for a plan, an occupied or dirty one never', () => {
  const main = repo()
  const a = slotOf(main, 1)
  const b = slotOf(main, 2)
  const c = slotOf(main, 3)
  writeFileSync(join(a.path, 'mine.txt'), 'a person is working here\n')
  const busy = { ...b, plan: 'plans/009-x.plan.md' }
  assert.equal(folders.idleSlot([a, busy, { ...c, detached: false, branch: 'feat/x' }]), null)
  assert.equal(folders.idleSlot([a, busy, c])?.slot, 3)
  assert.equal(folders.idleSlot([c], [c.path]), null)
  const claim = folders.claimSlot({ slot: c, branch: 'feat/001-x', base: 'main', planPath: 'plans/001-x.plan.md', branchExists: false })
  assert.equal(claim.ok, true)
  assert.equal(sh(c.path, 'branch', '--show-current'), 'feat/001-x')
  assert.equal(readFileSync(join(c.path, '.worktree-plan'), 'utf8').trim(), 'plans/001-x.plan.md')
})

test('slots: release detaches and removes the marker; uncommitted or unpushed work keeps the slot', () => {
  const main = repo()
  const s = slotOf(main, 1)
  const claim = () => folders.claimSlot({ slot: s, branch: 'feat/001-x', base: 'main', planPath: 'plans/001-x.plan.md', branchExists: sh(main, 'branch', '--list', 'feat/001-x') !== '' })
  assert.equal(claim().ok, true)
  // uncommitted file: kept
  writeFileSync(join(s.path, 'wip.txt'), 'x\n')
  assert.match(folders.releaseSlot({ path: s.path, branch: 'feat/001-x', target: 'main' }).why, /uncommitted/)
  // committed but neither pushed nor merged: kept
  sh(s.path, 'add', 'wip.txt')
  sh(s.path, 'commit', '-q', '-m', 'wip')
  assert.match(folders.releaseSlot({ path: s.path, branch: 'feat/001-x', target: 'main' }).why, /not pushed or merged/)
  assert.equal(sh(s.path, 'branch', '--show-current'), 'feat/001-x')
  // merged into the target: released
  sh(main, 'merge', '-q', '--no-ff', '-m', 'merge', 'feat/001-x')
  const r = folders.releaseSlot({ path: s.path, branch: 'feat/001-x', target: 'main' })
  assert.equal(r.released, true)
  assert.equal(sh(s.path, 'branch', '--show-current'), '')
  assert.equal(existsSync(join(s.path, '.worktree-plan')), false)
})

const withPackages = (dir) => {
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  for (const d of [dir, join(dir, 'scripts')]) {
    writeFileSync(join(d, 'package.json'), '{"name":"x"}\n')
    writeFileSync(join(d, 'package-lock.json'), '{"lockfileVersion":3}\n')
  }
}

test('deps: a folder that already has its packages (an idle slot) installs nothing', () => {
  const main = tmp()
  const slot = tmp()
  withPackages(main)
  withPackages(slot)
  mkdirSync(join(slot, 'node_modules', 'left-pad'), { recursive: true })
  mkdirSync(join(slot, 'scripts', 'node_modules', 'picomatch'), { recursive: true })
  const r = folders.ensureDeps({ mainRoot: main, dst: slot, pm: 'npm' })
  assert.deepEqual(r, { ok: true, lines: [] })
})

test('deps: a folder without packages installs, is never linked to the main folder, and a failed install is reported', () => {
  const main = tmp()
  const own = tmp()
  withPackages(main)
  mkdirSync(join(main, 'node_modules', 'left-pad'), { recursive: true })
  mkdirSync(join(main, 'scripts', 'node_modules', 'picomatch'), { recursive: true })
  withPackages(own)
  // package.json asks for a package the lock file does not list: `npm ci` refuses at once (no network), the failure to report
  for (const d of [own, join(own, 'scripts')]) writeFileSync(join(d, 'package.json'), '{"name":"x","dependencies":{"left-pad":"1.3.0"}}\n')
  const r = folders.ensureDeps({ mainRoot: main, dst: own, pm: 'npm' })
  assert.equal(r.ok, false)
  assert.equal(r.lines.filter((l) => /^install in .* failed/.test(l)).length, 2, r.lines.join('; '))
  assert.equal(existsSync(join(own, 'node_modules')), false)
  assert.equal(existsSync(join(own, 'scripts', 'node_modules')), false)
})

test('deps: a folder with no lock file is left as it is, said in one line', () => {
  const main = tmp()
  const own = tmp()
  withPackages(main)
  withPackages(own)
  rmSync(join(own, 'package-lock.json'))
  mkdirSync(join(own, 'scripts', 'node_modules', 'picomatch'), { recursive: true })
  const r = folders.ensureDeps({ mainRoot: main, dst: own, pm: 'npm' })
  assert.deepEqual(r, { ok: true, lines: ['no package-lock.json in .: nothing installed'] })
})
