// Plan 028: the orchestrator's builder folders (scripts/lib/orch-folders.mjs, installed), the watch-mode check
// (scripts/lib/orch-run.mjs) and the config keys it added (tools/lib/kit.mjs). Scratch repositories only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync, cpSync } from 'fs'
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

test('run slots: stop and finish give every held slot back through releaseRunSlots; a dirty slot is kept and says why', () => {
  const main = repo()
  const a = slotOf(main, 1)
  const b = slotOf(main, 2)
  for (const [s, n] of [[a, '001'], [b, '002']]) assert.equal(folders.claimSlot({ slot: s, branch: `feat/${n}-x`, base: 'main', planPath: `plans/${n}-x.plan.md`, branchExists: false }).ok, true)
  writeFileSync(join(b.path, 'wip.txt'), 'x\n')
  const status = { plans: { '001': { nnn: '001', branch: 'feat/001-x', slot: a.path.replace(/\\/g, '/') }, '002': { nnn: '002', branch: 'feat/002-x', slot: b.path }, '003': { nnn: '003', branch: 'feat/003-x' } } }
  const slots = [{ ...a, plan: 'plans/001-x.plan.md', branch: 'feat/001-x', detached: false }, { ...b, plan: 'plans/002-x.plan.md', branch: 'feat/002-x', detached: false }]
  const r = folders.releaseRunSlots({ status, slots, target: 'main' })
  assert.deepEqual(r.lines, ['plan 001: slot wt-1 released', 'plan 002: slot wt-2 kept — uncommitted files in the slot'])
  assert.equal(r.released, 1)
  assert.equal(status.plans['001'].slot, undefined, 'a released slot leaves the plan')
  assert.equal(status.plans['002'].slot, b.path, 'a kept slot stays recorded')
  assert.equal(sh(a.path, 'branch', '--show-current'), '')
  assert.equal(existsSync(join(a.path, '.worktree-plan')), false)
  assert.equal(sh(b.path, 'branch', '--show-current'), 'feat/002-x')
  // the installed command: `stop` on a run whose plan holds a clean slot prints the line and detaches the slot
  const dir = tmp()
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true, dereference: true })
  sh(dir, 'init', '-q', '-b', 'main')
  sh(dir, 'config', 'user.email', 't@t')
  sh(dir, 'config', 'user.name', 't')
  writeFileSync(join(dir, 'a.txt'), 'a\n')
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '-q', '-m', 'first')
  const slot = join(tmp(), 'proj-wt-1')
  sh(dir, 'worktree', 'add', '-q', '-b', 'feat/001-x', slot, 'main')
  writeFileSync(join(slot, '.worktree-plan'), 'plans/001-x.plan.md\n')
  const runs = join(dir, '.claude', 'orchestrator-runs', 's')
  mkdirSync(runs, { recursive: true })
  writeFileSync(join(runs, 'status.json'), `${JSON.stringify({ run: 's', phase: 'running', plans: { '001': { nnn: '001', branch: 'feat/001-x', state: 'building', slot: slot.replace(/\\/g, '/') } }, notes: [] })}\n`)
  const stop = spawnSync(process.execPath, [join(dir, 'scripts', 'orch-state.mjs'), 'stop', '--run=s', '--reason=env'], { cwd: dir, encoding: 'utf8' })
  assert.equal(stop.status, 0, stop.stdout + stop.stderr)
  assert.match(stop.stdout, /^plan 001: slot wt-1 released$/m)
  assert.equal(sh(slot, 'branch', '--show-current'), '', 'the slot is detached')
  assert.equal(existsSync(join(slot, '.worktree-plan')), false)
  const st = JSON.parse(readFileSync(join(runs, 'status.json'), 'utf8'))
  assert.equal(st.phase, 'stopped')
  assert.equal(st.plans['001'].slot, undefined)
  assert.ok(st.notes.some((n) => /^slots given back when the run stopped: plan 001: slot wt-1 released/.test(n.text)), JSON.stringify(st.notes))
})

test('free-merged-slots leaves alone a slot a live orchestrator run holds; a stopped run frees it', () => {
  const dir = tmp()
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true, dereference: true })
  const origin = join(tmp(), 'origin.git')
  sh(dir, 'init', '-q', '--bare', '-b', 'main', origin)
  sh(dir, 'init', '-q', '-b', 'main')
  sh(dir, 'config', 'user.email', 't@t')
  sh(dir, 'config', 'user.name', 't')
  writeFileSync(join(dir, 'a.txt'), 'a\n')
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '-q', '-m', 'first')
  sh(dir, 'remote', 'add', 'origin', origin)
  sh(dir, 'push', '-q', '-u', 'origin', 'main')
  writeFileSync(join(dir, '.git', 'info', 'exclude'), '.worktree-*\n') // as a real project's .gitignore does
  const slot = join(tmp(), 'proj-wt-1')
  // the race: a builder branch just cut from a run branch equal to origin/main is an ancestor of it
  sh(dir, 'worktree', 'add', '-q', '-b', 'feat/001-x', slot, 'main')
  writeFileSync(join(slot, '.worktree-plan'), 'plans/001-x.plan.md\n')
  const runs = join(dir, '.claude', 'orchestrator-runs', 'live')
  mkdirSync(runs, { recursive: true })
  const status = (phase) => writeFileSync(join(runs, 'status.json'), `${JSON.stringify({ run: 'live', phase, updatedAt: new Date().toISOString(), plans: { '001': { nnn: '001', branch: 'feat/001-x', state: 'building', slot: slot.replace(/\\/g, '/') } }, notes: [] })}\n`)
  const free = () => spawnSync(process.execPath, [join(dir, 'scripts', 'free-merged-slots.mjs'), '--no-fetch'], { cwd: dir, encoding: 'utf8' })
  status('running')
  let r = free()
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /^wt-1: branch=feat\/001-x claimed by live orchestrator run live — left alone$/m)
  assert.equal(sh(slot, 'branch', '--show-current'), 'feat/001-x')
  status('stopped')
  r = free()
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /^wt-1: freed/m)
  assert.equal(sh(slot, 'branch', '--show-current'), '')
})

test('preflight refuses a second run that names a plan of a live run or a plan whose scope overlaps one of its plans', () => {
  const dir = tmp()
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true, dereference: true })
  sh(dir, 'init', '-q', '-b', 'main')
  sh(dir, 'config', 'user.email', 't@t')
  sh(dir, 'config', 'user.name', 't')
  mkdirSync(join(dir, 'plans'), { recursive: true })
  mkdirSync(join(dir, 'src', 'a'), { recursive: true })
  writeFileSync(join(dir, 'src', 'a', 'x.ts'), '1\n')
  const plan = (nnn, scope) => writeFileSync(join(dir, 'plans', `${nnn}-p.plan.md`), `# Plan ${nnn} — p\n\nStatus: active\n\n## Read-Write Scope\n\n\`\`\`scope\n${scope}\n\`\`\`\n`)
  plan('001', 'src/a/**')
  plan('002', 'src/a/x.ts')
  plan('003', 'docs/**')
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '-q', '-m', 'plans')
  const runs = join(dir, '.claude', 'orchestrator-runs', 'other')
  mkdirSync(runs, { recursive: true })
  writeFileSync(join(runs, 'status.json'), `${JSON.stringify({ run: 'other', phase: 'running', updatedAt: new Date().toISOString(), plans: { '001': { nnn: '001', state: 'building' } }, notes: [] })}\n`)
  const pre = (...a) => spawnSync(process.execPath, [join(dir, 'scripts', 'orch-preflight.mjs'), '--run', 'new', ...a], { cwd: dir, encoding: 'utf8' }).stdout
  assert.match(pre('--plans', '001'), /^FAIL run: plan 001 already in live run "other"/m)
  assert.match(pre('--plans', '002,003'), /^FAIL run: scope overlap with live run "other": plan 002 and its plan 001 both write src\/a\/x\.ts/m)
  assert.match(pre('--plans', '003'), /^OK {3}run$/m)
  assert.match(pre(), /^OK {3}run$/m, 'no --plans: only the run name is checked')
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

// Plan 033: the workflow may run a state command twice (a retried copy). `worktree` for a plan that already has its
// folder returns that folder: one worktree, one path, nothing claimed twice.
test('orch-state worktree twice for the same plan returns the same path and makes one folder', () => {
  // The repo sits in a folder of its own: orch-state puts the merge and builder folders beside the main folder, named
  // after the configured repo, so two test runs sharing the temp folder would meet in one merge folder.
  const parent = tmp()
  const dir = join(parent, 'main')
  mkdirSync(dir)
  sh(dir, 'init', '-q', '-b', 'main')
  sh(dir, 'config', 'user.email', 't@t')
  sh(dir, 'config', 'user.name', 't')
  writeFileSync(join(dir, 'a.txt'), 'a\n')
  const bare = tmp()
  sh(bare, 'init', '-q', '--bare', '-b', 'main')
  mkdirSync(join(dir, 'plans'))
  writeFileSync(join(dir, 'plans', '001-x.plan.md'), '# Plan 001 — X\n\nStatus: active\nDepends-on: none\n\n## Read-Write Scope\n\n```scope\nwork/001.txt\n```\n')
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '-q', '-m', 'plan')
  sh(dir, 'remote', 'add', 'origin', bare)
  sh(dir, 'push', '-q', '-u', 'origin', 'main')
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true, dereference: true })
  writeFileSync(join(dir, '.git', 'info', 'exclude'), 'scripts/\n.claude/\n')
  const state = (...a) => {
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'orch-state.mjs'), ...a], { cwd: dir, encoding: 'utf8' })
    const line = String(r.stdout).split(/\r?\n/).reverse().find((l) => l.startsWith('ORCH_JSON '))
    assert.ok(line, `${a.join(' ')}: ${r.stdout}${r.stderr}`)
    return JSON.parse(line.slice('ORCH_JSON '.length))
  }
  const init = state('init', '--run=r')
  assert.equal(init.ok, true, JSON.stringify(init))
  const pushed = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'origin/orch/r'], { cwd: dir, encoding: 'utf8' })
  assert.equal(pushed.status, 0, `init did not leave origin/orch/r behind: ${JSON.stringify(init)} ${pushed.stderr}`)
  const first = state('worktree', '--run=r', '--plan=001')
  const second = state('worktree', '--run=r', '--plan=001')
  assert.equal(first.ok, true, JSON.stringify(first))
  assert.equal(second.ok, true, JSON.stringify(second))
  assert.equal(second.path, first.path)
  assert.equal(second.branch, first.branch)
  const trees = sh(dir, 'worktree', 'list', '--porcelain').split('\n').filter((l) => /^worktree .*orch-r-001/.test(l))
  assert.equal(trees.length, 1, trees.join('\n'))
})

// ---- plan 044: a plan closes once by script, merged runs leave no merge folder, a slot can serve a branch ------------
const planClose = await import(pathToFileURL(join(root, 'scripts', 'plan-close.mjs')).href)
const doneWhen = await import(pathToFileURL(join(root, 'scripts', 'lib', 'done-when.mjs')).href)
const slotLib = await import(pathToFileURL(join(root, 'scripts', 'lib', 'slot.mjs')).href)
const copyScripts = (dir) => cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true, dereference: true, filter: (src) => !/node_modules/.test(src) })
const node = (cwd, script, ...a) => spawnSync(process.execPath, [join(cwd, 'scripts', script), ...a], { cwd, encoding: 'utf8' })
const PLAN_DONE = '# Plan 001 — x\n\nStatus: active\n\n## Goals & Success Criteria\n- [x] [auto] node x.mjs exits 0\n- [human] open the page\n\n## Atomic Sub-tasks\n- [x] A1: do it\n'

test('plan-close: a fully ticked plan with no todo section closes when no [auto] Done-when item is open; an open todo section still blocks', () => {
  assert.deepEqual(doneWhen.openAutoItems('## Goals & Success Criteria\n- [ ] [auto] a\n- [ ] [auto:main] b\n- [x] [auto] c\n- [auto] no box\n- [ ] [human] h\n\n## Notes\n- [ ] [auto] not a Done-when item\n'), ['a', 'b'])
  const texts = {
    'plans/001-a.plan.md': PLAN_DONE,
    'plans/002-b.plan.md': PLAN_DONE.replace('- [x] [auto]', '- [ ] [auto]'),
    'plans/003-c.plan.md': PLAN_DONE.replace('- [x] [auto]', '- [auto]'),
    'plans/004-d.plan.md': PLAN_DONE.replace('- [x] A1', '- [ ] A1'),
    'plans/005-e.plan.md': PLAN_DONE,
    'plans/006-f.plan.md': PLAN_DONE.replace('- [x] [auto]', '- [ ] [auto]'),
  }
  const found = planClose.findClosable({ files: Object.keys(texts), openNums: new Set(['005']), archivedNums: new Set(['006']), readPlan: (f) => texts[f] })
  assert.deepEqual(found.map((x) => x.nnn), ['001', '003', '006'], 'no todo section: 001 and 003 (a box-less item has no state); archived 006 closes as before; open section 005 and open sub-task 004 and open [auto] 002 do not')
})

test('plan-close: a plan already gone from origin/<main> is skipped with the sha that closed it; the CLI fetches first and a failed fetch closes nothing', () => {
  const lines = (closedOnOrigin) => {
    const dir = tmp()
    mkdirSync(join(dir, 'plans'))
    writeFileSync(join(dir, 'plans', '001-x.plan.md'), PLAN_DONE)
    return { dir, out: planClose.closePlans(dir, { closedOnOrigin }) }
  }
  const skipped = lines((f) => (f === 'plans/001-x.plan.md' ? 'abc1234' : null))
  assert.deepEqual(skipped.out, ['PLAN_CLOSE: skipped plans/001-x.plan.md — already closed on origin/main by abc1234'])
  assert.equal(existsSync(join(skipped.dir, 'plans', '001-x.plan.md')), true, 'the file stays where it is')
  const closed = lines(() => null)
  assert.match(closed.out[0], /^PLAN_CLOSE: closed plans\/001-x\.plan\.md → plans\/1-100\/001-x\.plan\.md$/)
  // The CLI, in a scratch repository with a bare origin: the "bot" clone closes the plan on origin, this clone has not pulled.
  const dir = tmp()
  const origin = join(tmp(), 'origin.git')
  sh(dir, 'init', '-q', '--bare', '-b', 'main', origin)
  sh(dir, 'init', '-q', '-b', 'main')
  sh(dir, 'config', 'user.email', 't@t')
  sh(dir, 'config', 'user.name', 't')
  copyScripts(dir)
  mkdirSync(join(dir, 'plans'))
  writeFileSync(join(dir, 'plans', '001-x.plan.md'), PLAN_DONE)
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '-q', '-m', 'first')
  sh(dir, 'remote', 'add', 'origin', origin)
  sh(dir, 'push', '-q', '-u', 'origin', 'main')
  const bot = join(tmp(), 'bot')
  sh(tmp(), 'clone', '-q', origin, bot)
  sh(bot, 'config', 'user.email', 't@t')
  sh(bot, 'config', 'user.name', 'bot')
  mkdirSync(join(bot, 'plans', '1-100'), { recursive: true })
  sh(bot, 'mv', 'plans/001-x.plan.md', 'plans/1-100/001-x.plan.md')
  sh(bot, 'commit', '-q', '-m', 'plan(001): close')
  sh(bot, 'push', '-q', 'origin', 'main')
  const closer = sh(bot, 'rev-parse', '--short=7', 'HEAD')
  const withFetch = node(dir, 'plan-close.mjs')
  assert.equal(withFetch.status, 0, withFetch.stdout + withFetch.stderr)
  assert.equal(withFetch.stdout.trim(), 'PLAN_CLOSE: skipped plans/001-x.plan.md — already closed on origin/main by ' + closer.slice(0, 7))
  assert.equal(existsSync(join(dir, 'plans', '001-x.plan.md')), true)
  // A plan that was never pushed (no history on origin/<main>) is not "closed on origin".
  writeFileSync(join(dir, 'plans', '002-y.plan.md'), PLAN_DONE.replace('Plan 001', 'Plan 002'))
  assert.match(node(dir, 'plan-close.mjs', '--dry-run').stdout, /^PLAN_CLOSE: would close plans\/002-y\.plan\.md → plans\/1-100\/002-y\.plan\.md$/m)
  // The fetch fails: nothing is closed, exit 0.
  sh(dir, 'remote', 'set-url', 'origin', join(tmp(), 'no-such-origin.git'))
  const broken = node(dir, 'plan-close.mjs')
  assert.equal(broken.status, 0)
  assert.match(broken.stdout, /^PLAN_CLOSE: could not fetch origin\/main \(.+\) — nothing closed$/m)
  assert.equal(existsSync(join(dir, 'plans', '002-y.plan.md')), true)
  // --no-fetch is the old behaviour: the local plan closes.
  assert.match(node(dir, 'plan-close.mjs', '--no-fetch').stdout, /^PLAN_CLOSE: closed plans\/001-x\.plan\.md/m)
})

test('free-merged-slots removes the clean merge folder of a merged run; a live, dirty or unmerged one stays, with the reason', () => {
  const repoName = /const repo = '([^']*)'/.exec(readFileSync(join(root, 'scripts', 'free-merged-slots.mjs'), 'utf8'))?.[1] || 'proj'
  const parent = tmp()
  const dir = join(parent, repoName)
  mkdirSync(dir)
  const origin = join(tmp(), 'origin.git')
  sh(dir, 'init', '-q', '--bare', '-b', 'main', origin)
  sh(dir, 'init', '-q', '-b', 'main')
  sh(dir, 'config', 'user.email', 't@t')
  sh(dir, 'config', 'user.name', 't')
  copyScripts(dir)
  writeFileSync(join(dir, '.git', 'info', 'exclude'), 'scripts/\n.claude/\n.worktree-*\n')
  writeFileSync(join(dir, 'a.txt'), 'a\n')
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '-q', '-m', 'first')
  sh(dir, 'remote', 'add', 'origin', origin)
  sh(dir, 'push', '-q', '-u', 'origin', 'main')
  const folderOf = (run) => join(parent, repoName + '-orch-merge-' + run)
  const makeRun = (run, { merged }) => {
    sh(dir, 'branch', '--no-track', 'orch/' + run, 'main')
    sh(dir, 'worktree', 'add', '-q', folderOf(run), 'orch/' + run)
    sh(folderOf(run), 'config', 'user.email', 't@t')
    sh(folderOf(run), 'config', 'user.name', 't')
    writeFileSync(join(folderOf(run), run + '.txt'), run + '\n')
    sh(folderOf(run), 'add', '-A')
    sh(folderOf(run), 'commit', '-q', '-m', 'orch(' + run + '): work')
    if (merged) {
      sh(dir, 'merge', '-q', '--no-ff', '-m', 'merge ' + run, 'orch/' + run)
      sh(dir, 'push', '-q', 'origin', 'main')
    }
  }
  makeRun('done', { merged: true })
  makeRun('live', { merged: true })
  makeRun('dirty', { merged: true })
  makeRun('open', { merged: false })
  writeFileSync(join(folderOf('dirty'), 'scratch.txt'), 'uncommitted\n')
  const runs = join(dir, '.claude', 'orchestrator-runs', 'live')
  mkdirSync(runs, { recursive: true })
  writeFileSync(join(runs, 'status.json'), JSON.stringify({ run: 'live', phase: 'running', updatedAt: new Date().toISOString(), plans: {}, notes: [] }) + '\n')
  const r = node(dir, 'free-merged-slots.mjs')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const at = (run) => r.stdout.split(/\r?\n/).find((l) => l.startsWith('merge folder ' + folderOf(run)) || l.replace(/\\/g, '/').startsWith('merge folder ' + folderOf(run).replace(/\\/g, '/')))
  assert.match(at('done'), /: removed \(run branch orch\/done merged; local branch kept\)$/)
  assert.equal(existsSync(folderOf('done')), false, 'the merged run\'s folder is gone')
  assert.equal(sh(dir, 'branch', '--list', 'orch/done').includes('orch/done'), true, 'the local branch is kept')
  assert.match(at('live'), /: left alone — run live is live$/)
  assert.match(at('dirty'), /: left alone — it has uncommitted files$/)
  assert.match(at('open'), /: left alone — run branch orch\/open is not merged into origin\/main$/)
  for (const run of ['live', 'dirty', 'open']) assert.equal(existsSync(folderOf(run)), true, run + ' stays')
  assert.ok(!/orch-merge/.test(r.stdout.split(/\r?\n/).filter((l) => /done/.test(l) && /left alone/.test(l)).join('')), 'the removed folder is not also reported as left alone')
})

test('slot-serve --ref: an idle slot checks out the branch detached and is marked validating; every view and claimer respects it; slot-stop ends it', () => {
  const parent = tmp()
  const dir = join(parent, 'main')
  mkdirSync(dir)
  const origin = join(tmp(), 'origin.git')
  sh(dir, 'init', '-q', '--bare', '-b', 'main', origin)
  sh(dir, 'init', '-q', '-b', 'main')
  sh(dir, 'config', 'user.email', 't@t')
  sh(dir, 'config', 'user.name', 't')
  copyScripts(dir)
  writeFileSync(join(dir, '.git', 'info', 'exclude'), '.worktree-*\n.claude/\n')
  writeFileSync(join(dir, 'a.txt'), 'a\n')
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '-q', '-m', 'first')
  sh(dir, 'remote', 'add', 'origin', origin)
  sh(dir, 'push', '-q', '-u', 'origin', 'main')
  sh(dir, 'switch', '-q', '-c', 'orch/r1')
  writeFileSync(join(dir, 'b.txt'), 'b\n')
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '-q', '-m', 'run work')
  sh(dir, 'push', '-q', 'origin', 'orch/r1')
  const tip = sh(dir, 'rev-parse', 'HEAD')
  sh(dir, 'switch', '-q', 'main')
  const slot = join(parent, 'proj-wt-1')
  sh(dir, 'worktree', 'add', '-q', '--detach', slot, 'main')
  writeFileSync(join(slot, '.worktree-port'), '1\n')
  const marker = join(slot, '.worktree-validating')
  // refused: a bad branch name, a busy slot, a dirty slot
  assert.match(node(slot, 'slot-serve.mjs', '--ref=--evil').stderr, /SLOT_SERVE: branch "--evil" must match/)
  writeFileSync(join(slot, '.worktree-plan'), 'plans/001-x.plan.md\n')
  assert.match(node(slot, 'slot-serve.mjs', '--ref', 'orch/r1').stderr, /SLOT_SERVE: this slot is busy/)
  rmSync(join(slot, '.worktree-plan'))
  writeFileSync(join(slot, 'dirty.txt'), 'x\n')
  assert.match(node(slot, 'slot-serve.mjs', '--ref', 'orch/r1').stderr, /SLOT_SERVE: this slot has uncommitted files/)
  rmSync(join(slot, 'dirty.txt'))
  assert.equal(existsSync(marker), false, 'a refusal writes no marker')
  // the serve: checkout + marker + the line (the scratch project has no dev servers, so the serve itself ends there)
  const served = node(slot, 'slot-serve.mjs', '--ref', 'orch/r1')
  assert.match(served.stdout, new RegExp('^SLOT_SERVE: wt-1 validating orch/r1 @ ' + tip.slice(0, 7) + '$', 'm'), served.stdout + served.stderr)
  assert.equal(sh(slot, 'rev-parse', 'HEAD'), tip)
  assert.equal(sh(slot, 'branch', '--show-current'), '', 'detached')
  const [branch, at, sha] = readFileSync(marker, 'utf8').trim().split(/\r?\n/)
  assert.equal(branch, 'orch/r1')
  assert.ok(!Number.isNaN(Date.parse(at)), at)
  assert.equal(sha, tip)
  const listed = node(slot, 'lib/slot.mjs', '--list')
  assert.match(listed.stdout, new RegExp('^wt-1: detached validating orch/r1 since ' + at.replace(/[.+]/g, '\\$&') + '$', 'm'), listed.stdout + listed.stderr)
  // idleSlot never returns it; the same slot without the marker is idle
  const plain = { slot: 1, path: slot, branch: null, detached: true, plan: null, validating: null }
  assert.equal(folders.idleSlot([plain]), plain)
  assert.equal(folders.idleSlot([{ ...plain, validating: { branch: 'orch/r1', at } }]), null)
  assert.deepEqual(slotLib.readValidating(slot), { branch: 'orch/r1', at, sha: tip })
  // free-merged-slots leaves it alone; take-plan refuses it
  assert.match(node(dir, 'free-merged-slots.mjs', '--no-fetch').stdout, /^wt-1: validating orch\/r1 — left alone$/m)
  cpSync(join(root, 'scripts', 'node_modules'), join(slot, 'scripts', 'node_modules'), { recursive: true, dereference: true }) // take-plan imports picomatch
  assert.match(node(slot, 'take-plan.mjs', '001').stderr, /slot wt-1 is validating orch\/r1 - run node scripts\/slot-stop\.mjs first/)
  // slot-stop ends it
  const stopped = node(slot, 'slot-stop.mjs')
  assert.match(stopped.stdout, /^SLOT_STOP: validating orch\/r1 ended$/m, stopped.stdout + stopped.stderr)
  assert.equal(existsSync(marker), false)
  assert.match(node(slot, 'lib/slot.mjs', '--list').stdout, /^wt-1: detached idle$/m)
})
