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

// Plan 043: `main-try` runs a main-folder check once for a delegated readiness answer and records its exit;
// `main-tries` lists what passed in the last 2 hours. Only the shapes mainCheckProblem allows are run.
test('orch-state main-try runs a project script once and records its exit; main-tries lists only fresh exit-0 entries; refused shapes are never run', () => {
  const dir = join(tmp(), 'main')
  mkdirSync(dir)
  sh(dir, 'init', '-q', '-b', 'main')
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true, dereference: true })
  writeFileSync(join(dir, 'scripts', 'try-ok.mjs'), "import { appendFileSync } from 'fs'\nappendFileSync('ran.txt', 'ok\\n')\nconsole.log('all good')\n")
  writeFileSync(join(dir, 'scripts', 'try-bad.mjs'), "import { appendFileSync } from 'fs'\nappendFileSync('ran.txt', 'bad\\n')\nconsole.error('it broke')\nprocess.exit(3)\n")
  writeFileSync(join(dir, 'package.json'), '{"scripts":{"build":"echo hi"}}')
  const state = (...a) => {
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'orch-state.mjs'), ...a], { cwd: dir, encoding: 'utf8' })
    const line = String(r.stdout).split(/\r?\n/).reverse().find((l) => l.startsWith('ORCH_JSON '))
    assert.ok(line, `${a.join(' ')}: ${r.stdout}${r.stderr}`)
    return { ...JSON.parse(line.slice('ORCH_JSON '.length)), status: r.status, stdout: r.stdout }
  }
  const ran = () => (existsSync(join(dir, 'ran.txt')) ? readFileSync(join(dir, 'ran.txt'), 'utf8').trim().split('\n') : [])
  const ok = state('main-try', '--run=r', '--plan=001', '--cmd=node scripts/try-ok.mjs')
  assert.equal(ok.ok, true)
  assert.equal(ok.exit, 0)
  assert.match(ok.stdout, /MAIN_TRY: node scripts\/try-ok\.mjs exit 0/)
  assert.match(ok.stdout, /all good/, 'the last output lines are shown')
  const bad = state('main-try', '--run=r', '--plan=001', '--cmd=node scripts/try-bad.mjs')
  assert.equal(bad.exit, 3)
  assert.match(bad.stdout, /MAIN_TRY: node scripts\/try-bad\.mjs exit 3/)
  assert.deepEqual(ran(), ['ok', 'bad'])
  // Refused: nothing runs, exit 1, `main-try: <command>: <why>`.
  for (const cmd of ['npm run build', 'node --test x', 'node scripts/orch-state.mjs stop --run=r', 'node scripts/try-ok.mjs --write', 'node scripts/../try-ok.mjs', 'node scripts/try-ok.mjs --since=plan-start']) {
    const r = state('main-try', '--run=r', '--plan=001', `--cmd=${cmd}`)
    assert.equal(r.ok, false, cmd)
    assert.equal(r.status, 1, cmd)
    assert.ok(r.error.startsWith(`main-try: ${cmd}: `), r.error)
  }
  assert.deepEqual(ran(), ['ok', 'bad'], 'a refused command is not run')
  // Only the exit-0 entry is listed; an entry older than 2 hours is not.
  const file = join(dir, '.claude', 'orchestrator-runs', 'r', 'main-tries.json')
  const tries = JSON.parse(readFileSync(file, 'utf8'))
  assert.deepEqual(tries.map((t) => [t.plan, t.cmd, t.exit]), [['001', 'node scripts/try-ok.mjs', 0], ['001', 'node scripts/try-bad.mjs', 3]])
  assert.deepEqual(state('main-tries', '--run=r').passed, { '001': ['node scripts/try-ok.mjs'] })
  tries.push({ plan: '002', cmd: 'node scripts/old.mjs', exit: 0, at: new Date(Date.now() - 3 * 3600 * 1000).toISOString() })
  writeFileSync(file, JSON.stringify(tries))
  assert.deepEqual(state('main-tries', '--run=r').passed, { '001': ['node scripts/try-ok.mjs'] }, 'older than 2 hours: not listed')
  assert.deepEqual(state('main-tries', '--run=other').passed, {}, 'another run has no tries')
  // `scripts` gives the package.json bodies.
  assert.deepEqual(state('scripts').scripts, { build: 'echo hi' })
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
