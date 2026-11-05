// Plan 028: the orchestrator's builder folders (scripts/lib/orch-folders.mjs, installed), the watch-mode check
// (scripts/lib/orch-run.mjs) and the config keys it added (tools/lib/kit.mjs). Scratch repositories only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve, dirname, basename } from 'path'
import { spawnSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync, cpSync, symlinkSync } from 'fs'
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
  // commands.devRemote (plan 058): an npm script name like the other commands.* script keys
  assert.deepEqual(probs({ 'commands.devRemote': 'dev:remote' }), [])
  assert.deepEqual(probs({ 'commands.devRemote': '' }), [])
  assert.match(probs({ 'commands.devRemote': 'npm run dev:remote' }).join(), /commands\.devRemote is "npm run dev:remote" — commands\.\* take npm script names, not commands: set it to "dev:remote"/)
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

test('samePath: one folder in two spellings (alias, slashes, trailing slash, 8.3 short name) is one; different or empty are not', () => {
  const dir = tmp()
  const real = join(dir, 'proj-wt-1')
  mkdirSync(real)
  const link = join(tmp(), 'alias')
  symlinkSync(dir, link, 'junction')
  assert.equal(folders.samePath(real, join(link, 'proj-wt-1')), true, 'alias')
  assert.equal(folders.samePath(real, real.replace(/\\/g, '/') + '/'), true, 'slashes and trailing slash')
  assert.equal(folders.samePath(real, join(dir, 'proj-wt-2')), false, 'different folder')
  assert.equal(folders.samePath(real, ''), false)
  assert.equal(folders.samePath(undefined, undefined), false)
  assert.equal(folders.samePath(join(dir, 'gone'), join(dir, 'gone') + '/'), true, 'not on disk: plain spelling')
  if (process.platform === 'win32') {
    // the CI runner's RUNNER~1: the 8.3 form of this folder, when the volume keeps short names
    const r = spawnSync('powershell', ['-NoProfile', '-Command', `(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${real}').ShortPath`], { encoding: 'utf8' })
    const short = r.stdout.trim()
    if (short && existsSync(short) && short.toLowerCase() !== real.toLowerCase()) assert.equal(folders.samePath(real, short), true, `8.3 ${short}`)
  }
})

test('run slots: stop and finish give every held slot back through releaseRunSlots; a dirty slot is kept and says why', () => {
  const main = repo()
  const a = slotOf(main, 1)
  const b = slotOf(main, 2)
  for (const [s, n] of [[a, '001'], [b, '002']]) assert.equal(folders.claimSlot({ slot: s, branch: `feat/${n}-x`, base: 'main', planPath: `plans/${n}-x.plan.md`, branchExists: false }).ok, true)
  writeFileSync(join(b.path, 'wip.txt'), 'x\n')
  // plan 001 records its slot through an alias of the folder (a junction/symlink to its parent), as a short 8.3 name
  // (RUNNER~1) or another spelling would: still the same folder, so it is released and not forgotten.
  const aliasSlot = (path) => {
    const link = join(tmp(), 'alias')
    symlinkSync(dirname(path), link, 'junction')
    return join(link, basename(path)).replace(/\\/g, '/')
  }
  const status = { plans: { '001': { nnn: '001', branch: 'feat/001-x', slot: aliasSlot(a.path) }, '002': { nnn: '002', branch: 'feat/002-x', slot: b.path }, '003': { nnn: '003', branch: 'feat/003-x' } } }
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

// ---- plan 044: a plan closes once by script, merged runs leave no merge folder, a slot can serve a branch ------------
const planClose = await import(pathToFileURL(join(root, 'scripts', 'plan-close.mjs')).href)
const doneWhen = await import(pathToFileURL(join(root, 'scripts', 'lib', 'done-when.mjs')).href)
const slotLib = await import(pathToFileURL(join(root, 'scripts', 'lib', 'slot.mjs')).href)
const copyScripts = (dir) => cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true, dereference: true, filter: (src) => !/node_modules/.test(src) })
// GITHUB_ACTIONS is cleared: in CI plan-close.mjs skips its origin check by design, and these tests exercise that check.
const node = (cwd, script, ...a) => spawnSync(process.execPath, [join(cwd, 'scripts', script), ...a], { cwd, encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '' } })
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
  // git prints the long form of a folder; the test's own path may be a short 8.3 one (RUNNER~1) on Windows
  const at = (run) => r.stdout.split(/\r?\n/).find((l) => { const m = /^merge folder (.+?): (?:left alone|removed)/.exec(l); return m && m[1].replace(/\\/g, '/').split('/').pop() === basename(folderOf(run)) })
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

test('orch-state brain-commit commits docs/brain in the merge folder and pushes the run branch; a second call has nothing to commit; init returns the recorded decisions', () => {
  const parent = tmp()
  const dir = join(parent, 'main')
  mkdirSync(dir)
  sh(dir, 'init', '-q', '-b', 'main')
  sh(dir, 'config', 'user.email', 't@t')
  sh(dir, 'config', 'user.name', 't')
  writeFileSync(join(dir, 'a.txt'), 'a\n')
  const bare = tmp()
  sh(bare, 'init', '-q', '--bare', '-b', 'main')
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '-q', '-m', 'first')
  sh(dir, 'remote', 'add', 'origin', bare)
  sh(dir, 'push', '-q', '-u', 'origin', 'main')
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true, dereference: true })
  writeFileSync(join(dir, '.git', 'info', 'exclude'), 'scripts/\n.claude/\n')
  const state = (...a) => {
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'orch-state.mjs'), ...a], { cwd: dir, encoding: 'utf8' })
    const line = String(r.stdout).split(/\r?\n/).reverse().find((l) => l.startsWith('ORCH_JSON '))
    assert.ok(line, `${a.join(' ')}: ${r.stdout}${r.stderr}`)
    return { json: JSON.parse(line.slice('ORCH_JSON '.length)), out: r.stdout }
  }
  const init = state('init', '--run=b').json
  assert.equal(init.ok, true, JSON.stringify(init))
  assert.deepEqual(init.priorDecisions, [])
  const merge = init.mergeFolder
  assert.equal(state('brain-commit', '--run=b').out.includes('BRAIN: nothing to commit'), true, 'no docs/brain yet')
  assert.equal(state('decision', '--run=b', '--plan=001', '--id=D1', '--text=behaviour: a — reverse: b').json.ok, true)
  assert.equal(state('init', '--run=b').json.priorDecisions[0].id, 'D1', 'a relaunch gets the earlier decisions')
  mkdirSync(join(merge, 'docs', 'brain'), { recursive: true })
  writeFileSync(join(merge, 'docs', 'brain', 'decision-grades.jsonl'), '{"id":"D1"}\n')
  writeFileSync(join(merge, 'other.txt'), 'not brain\n')
  const first = state('brain-commit', '--run=b')
  assert.equal(first.json.ok, true, first.out)
  assert.match(first.out, /BRAIN: committed 1 file\(s\) on orch\/b/)
  assert.equal(sh(merge, 'log', '-1', '--format=%s'), 'orch(b): decision grades')
  assert.equal(sh(merge, 'show', '--name-only', '--format=', 'HEAD'), 'docs/brain/decision-grades.jsonl', 'only docs/brain is committed')
  assert.equal(sh(dir, 'rev-parse', 'origin/orch/b'), sh(merge, 'rev-parse', 'HEAD'), 'the run branch is pushed')
  assert.match(state('brain-commit', '--run=b').out, /BRAIN: nothing to commit/)
})

// ---- plan 058: the preflight starts the main folder's servers itself (slot-serve.mjs --main, slot-stop.mjs --main) ------
const { resolveConfig, render, applyConditionals } = await import(pathToFileURL(join(kit, 'tools', 'lib', 'kit.mjs')).href)
const net = await import('node:net')
const freePort = () => new Promise((done) => {
  const s = net.createServer()
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address()
    s.close(() => done(port))
  })
})
const answers = (port) => new Promise((done) => {
  const s = net.connect({ port, host: '127.0.0.1' })
  s.setTimeout(2000, () => { s.destroy(); done(false) })
  s.once('connect', () => { s.destroy(); done(true) })
  s.once('error', () => done(false))
})
const until = async (fn, ms = 20000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}
// A stub server: listens on <port>, writes what it saw (argv mode, PORT env) to <out> and stays up.
const STUB = "const [port, out, mode] = process.argv.slice(2); require('fs').writeFileSync(out, JSON.stringify({ mode: mode || '', PORT: process.env.PORT ?? null })); require('net').createServer(() => {}).listen(Number(port), '127.0.0.1')\n"
/** A scratch main folder (git repo on main, no .worktree-port) with the core scripts rendered for a frontend and a backend. */
async function mainFolder({ feScript = 'node fe.js', lockWithDeps = false } = {}) {
  const dir = repo()
  const fe = await freePort()
  const be = await freePort()
  copyScripts(dir)
  const vals = resolveConfig({ kitRoot: kit, project: { project: { name: 'scratch' }, commands: { dev: 'start' }, slots: { fePorts: fe, bePorts: be } }, packs: [], target: dir })
  for (const f of ['slot-serve.mjs', 'slot-stop.mjs', 'orch-preflight.mjs', 'lib/slot-procs.mjs', 'lib/done-when.mjs']) {
    writeFileSync(join(dir, 'scripts', f), render(applyConditionals(readFileSync(join(kit, 'core', 'scripts', f), 'utf8'), vals), vals).text)
  }
  mkdirSync(join(dir, '.kit'), { recursive: true })
  writeFileSync(join(dir, '.kit', 'config.json'), JSON.stringify({ commands: { dev: 'start' }, slots: { fePorts: fe, bePorts: be } }))
  writeFileSync(join(dir, 'stub.js'), STUB)
  writeFileSync(join(dir, 'fe.js'), `require('./stub.js')\n`)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'scratch', private: true, scripts: { start: feScript.replace('fe.js', `stub.js ${fe} fe.json`) } }))
  if (lockWithDeps) writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/left-pad': { version: '1.3.0' } } }))
  mkdirSync(join(dir, 'server'))
  writeFileSync(join(dir, 'server', 'package.json'), JSON.stringify({ name: 'server', private: true, scripts: { 'dev:local': `node ../stub.js ${be} be.json local`, 'dev:remote': `node ../stub.js ${be} be.json remote` } }))
  return { dir, fe, be, serve: (...a) => node(dir, 'slot-serve.mjs', '--main', ...a), stop: () => node(dir, 'slot-stop.mjs', '--main') }
}

test('slot-serve --main starts the frontend in the main folder, keeps it on a second run, and slot-stop --main stops only what it started', async () => {
  const m = await mainFolder({ lockWithDeps: true })
  let hand
  try {
    const r = m.serve('--servers', 'fe')
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, new RegExp(`^SLOT_SERVE: main fe=${m.fe} started$`, 'm'))
    assert.ok(await answers(m.fe), 'the frontend answers on the base port')
    const pids = JSON.parse(readFileSync(join(m.dir, '.claude', '.main-serve-pids'), 'utf8')).pids
    assert.equal(pids.length, 1)
    const again = m.serve('--servers', 'fe')
    assert.match(again.stdout, new RegExp(`^SLOT_SERVE: main fe=${m.fe} kept$`, 'm'), again.stdout + again.stderr)
    assert.equal(JSON.parse(readFileSync(join(m.dir, '.claude', '.main-serve-pids'), 'utf8')).pids.length, 1, 'no second process')
    // no install, no prepare, no environment.slot in the main folder
    assert.equal(existsSync(join(m.dir, 'node_modules')), false, 'no package install ran')
    assert.equal(existsSync(join(m.dir, '.claude', '.last-npm-install-hash')), false)
    // a backend the Human started by hand in this folder survives slot-stop --main
    // `npm run dev:local` by hand: npm's own CLI under node, detached, no pipes held (spawnSync would wait on them).
    const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    const { spawn } = await import('node:child_process')
    hand = existsSync(npmCli)
      ? spawn(process.execPath, [npmCli, 'run', 'dev:local'], { cwd: join(m.dir, 'server'), detached: true, stdio: 'ignore', windowsHide: true })
      : spawn('npm', ['run', 'dev:local'], { cwd: join(m.dir, 'server'), detached: true, stdio: 'ignore', shell: process.platform === 'win32' })
    hand.unref()
    assert.ok(await until(() => answers(m.be)), 'the hand-started backend is up')
    const stopped = m.stop()
    assert.match(stopped.stdout, /^SLOT_STOP: stopped PID \d+ \(recorded: /m, stopped.stdout + stopped.stderr)
    assert.ok(await until(async () => !(await answers(m.fe))), 'the recorded frontend is stopped')
    assert.ok(await answers(m.be), 'the hand-started backend is left alone')
    assert.equal(existsSync(join(m.dir, '.claude', '.main-serve-pids')), false)
  } finally {
    // the hand-started backend: stopped through a recorded start of our own is not possible, so by its port
    const procs = await import(pathToFileURL(join(m.dir, 'scripts', 'lib', 'slot-procs.mjs')).href)
    const pid = procs.portOwnerPid(m.be)
    if (pid) procs.killChain(procs.processTable(), pid)
    if (hand?.pid) procs.killTree(hand.pid)
    m.stop()
  }
})

test('slot-serve --main: the backend runs dev:local (or dev:remote with --db remote) in server/ with the environment unchanged', async () => {
  const m = await mainFolder()
  try {
    const r = m.serve('--servers', 'be')
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, new RegExp(`^SLOT_SERVE: main be=${m.be} started \\(local database\\)$`, 'm'))
    assert.deepEqual(JSON.parse(readFileSync(join(m.dir, 'server', 'be.json'), 'utf8')), { mode: 'local', PORT: null }, 'no PORT set by the kit')
    m.stop()
    assert.ok(await until(async () => !(await answers(m.be))))
    const remote = m.serve('--servers', 'be', '--db', 'remote')
    assert.match(remote.stdout, /be=\d+ started \(remote database\)/, remote.stdout + remote.stderr)
    assert.equal(JSON.parse(readFileSync(join(m.dir, 'server', 'be.json'), 'utf8')).mode, 'remote')
    assert.equal(m.serve('--servers', 'be', '--db', 'cloud').status, 1, 'an unknown --db is refused')
  } finally { m.stop() }
})

test('slot-serve --main refuses in a slot and refuses a port another program holds, naming it and never stopping it', async () => {
  const m = await mainFolder()
  const holder = (await import('node:child_process')).spawn(process.execPath, ['-e', `require('net').createServer(()=>{}).listen(${m.fe},'127.0.0.1')`], { stdio: 'ignore' })
  try {
    assert.ok(await until(() => answers(m.fe)))
    const r = m.serve('--servers', 'fe')
    assert.equal(r.status, 1)
    assert.match(r.stderr, new RegExp(`fe not started: port ${m.fe} is held by PID ${holder.pid} \\(`), r.stderr)
    assert.ok(await answers(m.fe), 'the holder still runs')
    writeFileSync(join(m.dir, '.worktree-port'), '1\n')
    const inSlot = m.serve('--servers', 'fe')
    assert.equal(inSlot.status, 1)
    assert.match(inSlot.stderr, /SLOT_SERVE: --main is for the main folder/)
    assert.match(node(m.dir, 'slot-stop.mjs', '--main').stderr, /SLOT_STOP: --main is for the main folder/)
  } finally { holder.kill() }
})

test('a pnpm or dev:remote chain is a dev chain, so a failed start is killed and slot-stop --main can stop it', async () => {
  const procs = await import(pathToFileURL(join(kit, 'scripts', 'lib', 'slot-procs.mjs')).href)
  for (const cmd of ['"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\pnpm\\bin\\pnpm.cjs" run start', 'pnpm run dev:remote', 'pnpm.cmd run start', 'npm run dev:local', 'cmd /d /s /c "npm run dev:remote"']) assert.ok(procs.isChainCmd(cmd), cmd)
  for (const cmd of ['node server.js', 'git status', 'node dev:localish.js']) assert.ok(!procs.isChainCmd(cmd), cmd)
  // a recorded root: same creation time where the OS gives one; with none (POSIX ps, t = 0) a live dev-chain process
  const npmRoot = { pid: 7, name: process.platform === 'win32' ? 'node.exe' : 'npm', cmd: 'npm run start', t: 0 }
  assert.ok(procs.isRecordedChain({ pid: 7, t: 0 }, npmRoot), 'POSIX: no creation time, a dev-chain process')
  assert.ok(!procs.isRecordedChain({ pid: 7, t: 0 }, { ...npmRoot, cmd: 'vim notes.txt' }), 'POSIX: a reused PID that is not a dev chain')
  assert.ok(procs.isRecordedChain({ pid: 7, t: 5 }, { ...npmRoot, t: 5 }))
  assert.ok(!procs.isRecordedChain({ pid: 7, t: 5 }, { ...npmRoot, t: 6 }), 'Windows: another process under the same PID')
  assert.ok(!procs.isRecordedChain({ pid: 7, t: 5 }, undefined), 'gone')
})

test('preflight starts a missing frontend and says OK; the backend only for a plan with an open [auto:main] item; a failed start is a FAIL with the log tail', async () => {
  const m = await mainFolder()
  cpSync(join(root, 'scripts', 'node_modules'), join(m.dir, 'scripts', 'node_modules'), { recursive: true, dereference: true }) // the preflight imports picomatch
  const pre = (...a) => spawnSync(process.execPath, [join(m.dir, 'scripts', 'orch-preflight.mjs'), ...a], { cwd: m.dir, encoding: 'utf8' })
  try {
    const first = pre()
    assert.match(first.stdout, /^OK {3}dev server$/m, first.stdout)
    assert.match(first.stdout, /^SKIP backend: no plan needs it$/m)
    assert.ok(!/start the dev server/.test(first.stdout), 'never asks the Human to start it')
    assert.ok(await answers(m.fe))
    mkdirSync(join(m.dir, 'plans'))
    writeFileSync(join(m.dir, 'plans', '001-x.plan.md'), '# Plan 001 — x\n\nStatus: draft\n\n## Goals & Success Criteria\n- [ ] [auto:main] node scripts/check-db.mjs exits 0\n\n## Atomic Sub-tasks\n- [ ] A1: x\n')
    writeFileSync(join(m.dir, 'plans', '002-y.plan.md'), '# Plan 002 — y\n\nStatus: draft\n\n## Goals & Success Criteria\n- [ ] [auto] npm test\n\n## Atomic Sub-tasks\n- [ ] A1: y\n')
    assert.match(pre('--plans', '002').stdout, /^SKIP backend: no plan needs it$/m)
    const withMain = pre('--plans', '001,002', '--db', 'remote')
    assert.match(withMain.stdout, /^OK {3}backend$/m, withMain.stdout)
    assert.equal(JSON.parse(readFileSync(join(m.dir, 'server', 'be.json'), 'utf8')).mode, 'remote')
    // a backend already answering is kept; with --db remote the preflight says it cannot tell its database
    assert.match(pre('--plans', '001', '--db', 'remote').stdout, /^WARN backend: a backend already answers on port \d+ and was kept as it is/m)
    assert.match(pre('--plans', '001').stdout, /^OK {3}backend$/m)
    m.stop()
    assert.ok(await until(async () => !(await answers(m.be))))
    // an [auto:main] plan in a folder with no backend to start: FAIL now, not a failed check after builder rounds
    rmSync(join(m.dir, 'server'), { recursive: true, force: true })
    assert.match(pre('--plans', '001').stdout, /^FAIL backend: plan 001 has an open \[auto:main\] item, but this folder has no server\/package\.json/m)
    m.stop() // that preflight started the frontend again
    assert.ok(await until(async () => !(await answers(m.fe)) && !(await answers(m.be))))
    // a frontend script that dies at once: FAIL with its log, envFailure kept
    writeFileSync(join(m.dir, 'package.json'), JSON.stringify({ name: 'scratch', private: true, scripts: { start: "node -e \"console.error('boom: the build failed'); process.exit(1)\"" } }))
    const failed = pre()
    assert.match(failed.stdout, /^FAIL dev server: nothing answered on http:\/\/localhost:\d+\/; scripts\/slot-serve\.mjs did not start it \(exit 1: /m, failed.stdout)
    assert.match(failed.stdout, /run by node scripts\/slot-serve\.mjs --main --servers fe/)
    assert.match(failed.stdout, /boom: the build failed/, 'the server log tail is in the message')
    assert.match(failed.stdout, /The command was: npm run start/)
    assert.match(failed.stdout, /"envFailure":true/)
  } finally { m.stop() }
})

// ---- plan 059: orch-state.mjs prepare and the orchestrator.prepare config shape ----------------------------------------
test('orch-state.mjs prepare: present runs nothing, absent runs the script, a script that makes nothing fails with the tail and the entry', () => {
  const dir = tmp()
  try {
    cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true, dereference: true })
    mkdirSync(join(dir, 'sub'), { recursive: true })
    const stub = (body) => `node -e "${body}"`
    writeFileSync(join(dir, 'sub', 'package.json'), JSON.stringify({ name: 's', private: true, scripts: {
      gen: stub("require('fs').mkdirSync('../gen/out',{recursive:true});require('fs').writeFileSync('../ran.txt','x')"),
      nothing: stub("console.log('line-one');console.error('boom: no output made');process.exit(3)"),
    } }))
    const prep = (...a) => spawnSync(process.execPath, [join(dir, 'scripts', 'orch-state.mjs'), 'prepare', ...a], { cwd: dir, encoding: 'utf8' })
    // absent: runs the script in --in, then the path exists
    let r = prep('--missing', 'gen/out', '--script', 'gen', '--in', 'sub')
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /^PREPARE: ok \(generated\)$/m)
    assert.ok(existsSync(join(dir, 'gen', 'out')))
    // present: nothing runs
    rmSync(join(dir, 'ran.txt'))
    r = prep('--missing', 'gen/out', '--script', 'gen', '--in', 'sub')
    assert.equal(r.status, 0)
    assert.match(r.stdout, /^PREPARE: ok \(present\)$/m)
    assert.ok(!existsSync(join(dir, 'ran.txt')), 'a present path runs no script')
    // still missing: exit 1, the last lines of output, the entry
    r = prep('--missing', 'never/made', '--script', 'nothing', '--in', 'sub')
    assert.equal(r.status, 1)
    assert.match(r.stdout, /boom: no output made/)
    assert.match(r.stdout, /PREPARE: FAIL — never\/made is missing after `npm run nothing` in sub \(exit \d+\); repeat by hand: \{ "missing": "never\/made", "script": "nothing", "in": "sub" \}/)
    // a scoped package path is accepted (present here, so nothing runs)
    mkdirSync(join(dir, 'node_modules', '@prisma', 'client'), { recursive: true })
    r = prep('--missing', 'node_modules/@prisma/client', '--script', 'gen')
    assert.equal(r.status, 0, r.stdout)
    assert.match(r.stdout, /^PREPARE: ok \(present\)$/m)
    // refused shapes run nothing
    for (const bad of [['--missing', '/abs/x', '--script', 'gen'], ['--missing', '../x', '--script', 'gen'], ['--missing', 'x', '--script', 'npm run gen'], ['--missing', 'x', '--script', 'gen', '--in', '..'], ['--missing', 'x', '--script', 'gen', '--pm', 'yarn']]) {
      r = prep(...bad)
      assert.equal(r.status, 1, bad.join(' '))
      assert.match(r.stdout, /^ORCH_STATE: FAIL — prepare: /m)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('config: orchestrator.prepare must be a list of { missing, script, in? } with repo-relative paths and one script name', () => {
  assert.deepEqual(orchestratorProblems({ 'orchestrator.prepare': [] }), [])
  assert.deepEqual(orchestratorProblems({ 'orchestrator.prepare': [{ missing: 'server/generated/schemas', script: 'build:schemas', in: 'server' }, { missing: 'gen', script: 'gen' }] }), [])
  assert.deepEqual(orchestratorProblems({ 'orchestrator.prepare': [{ missing: 'node_modules/@prisma/client', script: 'gen' }] }), [], 'a scoped package path is allowed')
  assert.match(orchestratorProblems({ 'orchestrator.prepare': [{ missing: 'a b', script: 'gen' }] })[0], /letters, digits and _ \. \/ @ - only/, 'the refusal names the allowed characters')
  assert.match(orchestratorProblems({ 'orchestrator.prepare': 'gen' })[0], /^orchestrator\.prepare is "gen" — it must be a list/)
  const bad = orchestratorProblems({ 'orchestrator.prepare': [{ missing: '/abs/x', script: 'gen' }, { missing: 'C:/x', script: 'gen' }, { missing: '../x', script: 'gen' }, { missing: 'a/../x', script: 'gen' }, { missing: 'x', script: 'npm run gen' }, { missing: 'x', script: 'gen', in: '..' }, { missing: 'x', script: 'gen', extra: 1 }, 'gen', { script: 'gen' }] })
  assert.equal(bad.length, 9, bad.join('\n'))
  assert.match(bad.join('\n'), /unknown field "extra"/)
  assert.match(bad.join('\n'), /"script" must be one npm script name, not a command/)
})

// ---- plan 061: a plan branch never tracks the run branch; a rerun resolves a conflict in the plan's own file only -----
const PLAN_061 = '# Plan 001 — X\n\nStatus: active\nDepends-on: none\n\n## Read-Write Scope\n\n```scope\nwork/**\n```\n\n## Atomic Sub-tasks\n\n- [ ] A1: first\n- [ ] A2: second\n\n## Execution Notes\n- Source: test.\n'
// A main folder with a bare origin, one plan and the installed scripts (no slots: the kit's own config).
function orchRepo() {
  const parent = tmp()
  const dir = join(parent, 'main')
  mkdirSync(join(dir, 'plans'), { recursive: true })
  sh(dir, 'init', '-q', '-b', 'main')
  sh(dir, 'config', 'user.email', 't@t')
  sh(dir, 'config', 'user.name', 't')
  writeFileSync(join(dir, 'a.txt'), 'a\n')
  writeFileSync(join(dir, 'plans', '001-x.plan.md'), PLAN_061)
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '-q', '-m', 'plan')
  const bare = tmp()
  sh(bare, 'init', '-q', '--bare', '-b', 'main')
  sh(dir, 'remote', 'add', 'origin', bare)
  sh(dir, 'push', '-q', '-u', 'origin', 'main')
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true, dereference: true })
  writeFileSync(join(dir, '.git', 'info', 'exclude'), 'scripts/\n.claude/\n')
  const state = (...a) => {
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'orch-state.mjs'), ...a], { cwd: dir, encoding: 'utf8', timeout: 120000 })
    const line = String(r.stdout).split(/\r?\n/).reverse().find((l) => l.startsWith('ORCH_JSON '))
    assert.ok(line, `${a.join(' ')}: ${r.stdout}${r.stderr}`)
    return JSON.parse(line.slice('ORCH_JSON '.length))
  }
  const upstream = (cwd, branch) => spawnSync('git', ['config', '--get', `branch.${branch}.merge`], { cwd, encoding: 'utf8' }).status
  return { parent, dir, bare, state, upstream }
}

test('a plan branch made by worktree or by a slot claim has no upstream; a reused branch that inherited the run branch loses it', () => {
  const t = orchRepo()
  try {
    assert.equal(t.state('init', '--run=r').ok, true)
    const wt = t.state('worktree', '--run=r', '--plan=001')
    assert.equal(wt.ok, true, JSON.stringify(wt))
    assert.equal(t.upstream(t.dir, 'feat/001-x'), 1, 'no branch.feat/001-x.merge')
    // a branch from an earlier run that took the run branch as upstream (git's default before the fix)
    sh(t.dir, 'config', 'branch.feat/001-x.remote', 'origin')
    sh(t.dir, 'config', 'branch.feat/001-x.merge', 'refs/heads/orch/r')
    assert.equal(t.state('worktree', '--run=r', '--plan=001').ok, true)
    assert.equal(t.upstream(t.dir, 'feat/001-x'), 1, 'the inherited run-branch upstream is removed')
    // an upstream that is the plan's own remote branch is kept
    sh(t.dir, 'config', 'branch.feat/001-x.remote', 'origin')
    sh(t.dir, 'config', 'branch.feat/001-x.merge', 'refs/heads/feat/001-x')
    assert.equal(t.state('worktree', '--run=r', '--plan=001').ok, true)
    assert.equal(t.upstream(t.dir, 'feat/001-x'), 0)
    // a slot claim from a remote-tracking base
    sh(t.dir, 'fetch', '-q', 'origin')
    const slot = join(tmp(), 'proj-wt-1')
    sh(t.dir, 'worktree', 'add', '-q', '--detach', slot, 'main')
    assert.equal(folders.claimSlot({ slot: { slot: 1, path: slot }, branch: 'feat/002-y', base: 'origin/orch/r', planPath: 'plans/002-y.plan.md', branchExists: false }).ok, true)
    assert.equal(t.upstream(t.dir, 'feat/002-y'), 1, 'no upstream on a slot branch')
  } finally {
    rmSync(t.parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    rmSync(t.bare, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('the builder is told to push with -u to its own remote branch', () => {
  const builderDoc = readFileSync(join(root, '.claude', 'agents', 'orch-builder.md'), 'utf8')
  assert.match(builderDoc, /git push -u origin <branch>/)
  const wf = readFileSync(join(root, '.claude', 'workflows', 'orchestrate.js'), 'utf8')
  assert.match(wf, /git push -u origin \$\{ctx\.info\.branch\}/)
})

test('rerun of a parked plan under a new run: a conflict in the plan file only is resolved (run text, builder ticks and notes kept); any other conflict still parks', () => {
  const t = orchRepo()
  try {
    // run r1: the builder ticks A1, adds a note and pushes; the plan parks
    assert.equal(t.state('init', '--run=r1').ok, true)
    const wt = t.state('worktree', '--run=r1', '--plan=001')
    assert.equal(wt.ok, true, JSON.stringify(wt))
    const planIn = (p) => join(p, 'plans', '001-x.plan.md')
    writeFileSync(planIn(wt.path), readFileSync(planIn(wt.path), 'utf8').replace('- [ ] A1:', '- [x] A1:') + '- decision: builder note from r1.\n')
    mkdirSync(join(wt.path, 'work'), { recursive: true })
    writeFileSync(join(wt.path, 'work', 'x.txt'), 'built\n')
    sh(wt.path, 'add', '-A', 'plans', 'work')
    sh(wt.path, 'commit', '-q', '-m', 'build A1')
    sh(wt.path, 'push', '-q', 'origin', 'feat/001-x')
    // meanwhile main gets a newer plan text (a readiness answer, a status change), pushed
    writeFileSync(planIn(t.dir), readFileSync(planIn(t.dir), 'utf8').replace('Status: active', 'Status: active (re-run)') + '- Orchestrator readiness (2026-11-05): q → a\n')
    sh(t.dir, 'commit', '-qam', 'plan(r2): readiness answers')
    sh(t.dir, 'push', '-q', 'origin', 'main')
    // a relaunch under a new run name: a fresh run branch from the newer main, the old plan branch reused
    sh(wt.path, 'switch', '-q', '--detach')
    rmSync(wt.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    sh(t.dir, 'worktree', 'prune')
    assert.equal(t.state('init', '--run=r2').ok, true)
    const again = t.state('worktree', '--run=r2', '--plan=001')
    assert.equal(again.ok, true, JSON.stringify(again))
    const text = readFileSync(planIn(again.path), 'utf8')
    assert.match(text, /Status: active \(re-run\)/, 'the run branch text is the base')
    assert.match(text, /- \[x\] A1: first/, 'the builder tick is kept')
    assert.match(text, /- \[ \] A2: second/)
    assert.match(text, /- Orchestrator readiness \(2026-11-05\): q → a/)
    assert.match(text, /- decision: builder note from r1\./, 'the builder note is kept')
    assert.doesNotMatch(text, /<<<<<<<|>>>>>>>/)
    assert.equal(sh(again.path, 'status', '--porcelain'), '', 'the merge is committed')
    assert.equal(sh(again.path, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ').length, 3, 'HEAD is the merge commit')
    assert.equal(readFileSync(join(again.path, 'work', 'x.txt'), 'utf8'), 'built\n')
  } finally {
    rmSync(t.parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    rmSync(t.bare, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('rerun with a conflict in another file still parks, naming the conflicted paths', () => {
  const t = orchRepo()
  try {
    assert.equal(t.state('init', '--run=r1').ok, true)
    const wt = t.state('worktree', '--run=r1', '--plan=001')
    writeFileSync(join(wt.path, 'a.txt'), 'builder\n')
    sh(wt.path, 'commit', '-qam', 'builder a')
    sh(wt.path, 'push', '-q', 'origin', 'feat/001-x')
    writeFileSync(join(t.dir, 'a.txt'), 'main\n')
    sh(t.dir, 'commit', '-qam', 'main a')
    sh(t.dir, 'push', '-q', 'origin', 'main')
    sh(wt.path, 'switch', '-q', '--detach')
    rmSync(wt.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    sh(t.dir, 'worktree', 'prune')
    assert.equal(t.state('init', '--run=r2').ok, true)
    const again = t.state('worktree', '--run=r2', '--plan=001')
    assert.equal(again.ok, false)
    assert.match(again.error, /merging origin\/orch\/r2 into feat\/001-x conflicts.*a\.txt/)
  } finally {
    rmSync(t.parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    rmSync(t.bare, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('mergePlanFile: the run text with the builder ticks and its new Execution Notes lines', () => {
  const ours = PLAN_061.replace('- [ ] A2:', '- [x] A2:') + '- decision: mine.\n'
  const theirs = PLAN_061.replace('Status: active', 'Status: closed') + '- Orchestrator readiness: q → a\n'
  const out = runLib.mergePlanFile({ ours, theirs })
  assert.match(out, /Status: closed/)
  assert.match(out, /- \[ \] A1: first/)
  assert.match(out, /- \[x\] A2: second/)
  assert.match(out, /- Orchestrator readiness: q → a\n- decision: mine\.\n$/)
  assert.equal(runLib.mergePlanFile({ ours: theirs, theirs }), theirs, 'nothing of ours to add: the run text as it is')
})
