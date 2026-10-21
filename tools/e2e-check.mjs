/**
 * End-to-end proof — installs this kit into a fresh project and runs one plan through the whole
 * Planner-Worker cycle, the way a project uses it. Run from the kit root:
 *
 *   node tools/e2e-check.mjs [--keep]
 *   node tools/e2e-check.mjs --project <path> [--keep] [--skip-serve] [--skip-build]
 *
 * --project runs the same cycle on a scratch copy of a real installed project (its HEAD), so it proves the workflow as
 * installed and adapted there; it only reads that checkout. In a temp folder: a bare `origin` (= the project's HEAD),
 * a bare `upstream` (= its upstream/<main branch>, when it has one), a Planner clone with core.hooksPath=.husky (no husky
 * needed), and two Worker slots that borrow the project's node_modules (root and scripts/) through directory junctions
 * (symlinks on POSIX). The junctions are removed with `rmdir` (never their contents) before the temp folder is deleted,
 * and the run asserts the project's own node_modules are still there; an interrupted run (Ctrl+C, a kill, a timeout)
 * removes them from its exit and signal handlers. Never delete a kit-e2e-* temp folder recursively while it still
 * holds a node_modules link (PowerShell 5 Remove-Item -Recurse follows junctions). The slot dev server writes its
 * dependency cache (Vite: node_modules/.vite) through the link into the project's node_modules, the same cache the
 * project's own dev server uses; --skip-serve avoids it. Nothing reaches GitHub; nothing uses --no-verify.
 * Before anything is cloned, the run stops with "install dependencies in <path> first" when the project (or its
 * scripts/) has no node_modules, or one that lacks most declared packages (an interrupted install): the slots could not
 * start anything. A few missing packages are only a NOTE. The backend's env file
 * (<paths.serverRoot>.env, when the project's git ignores it) is copied into each scratch slot, as the slot setup
 * (worktree-setup) does for a
 * real slot; when the project has none, the slot dev server cases are reported SKIP with the reason, not FAIL.
 * Cases: the plan commit runs the hooks; pre-push refuses code on main; claim, second claim refused, scope guard
 * (in scope, out of scope, a hotspot, an upstream-owned path); the frontend dev server from config (started, kept,
 * freed); ship-prep, build gate, Worker push; server merge, ledger sync, plan close-out; a Planner close-out push into
 * a range folder; /pull-copy (rebase replays our commits, the force-push without --no-verify is refused, a conflict
 * aborts to the old head) when there is an upstream; drift-check; the maintenance scripts exit 0; SessionStart JSON.
 *
 * A local bare repository stands in for GitHub and a plain clone of it plays the server (it merges the
 * PR and runs the todo-sync Action's scripts). Needs git, bash, python and npm (network for the
 * devDependencies). --keep leaves the temp folder for inspection.
 *
 * Cases: install + first push; Planner saves plan 001 (number, similarity, first todo.md, arch gate,
 * push to main); pre-push refuses code on main; branch guard denies code on main and allows the plan;
 * slot claim (take-plan, REALITY: clean); a second claim of the same plan is refused; scope guard allows
 * in-scope and denies out-of-scope; ship-prep scope ok; Worker push; server merge; ledger sync, plan
 * close-out, archive and slot release; drift-check ok and a no-op kit-sync afterwards; the workflow scripts'
 * own dependencies (scripts/package.json) installed by install and take-plan; the frontend dev server from
 * config (slot-serve started, kept, slot-stop frees the port); .kit/install.json always in scope; a claim commit
 * refused by a pre-commit hook rolls back (slot detached, idle, no branch) and a retry claims; a fresh clone of a
 * project that keeps its own .gitignore claims a plan (runtime files in .git/info/exclude); pre-push accepts a
 * closed plan in a range folder and refuses code; a project without
 * husky (core.hooksPath=.husky only) runs the hooks: the first commit passes, a staged fake key is refused;
 * SessionStart prints valid JSON on each branch (idle slot, worker without and with a session-state file);
 * plan order (plan 011): tools/test/plan-order.test.mjs against the installed scripts, plan-order adds an open
 * dependency to the order, take-plan refuses a plan whose Depends-on: plan is not merged (NOT_READY) and takes one
 * whose dependency is closed.
 * Exit 0 = every case passed, 1 = failures (one line per case).
 */
import { writeFileSync, readFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync, realpathSync, symlinkSync, lstatSync, copyFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve, dirname, basename } from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'
import { resolveConfig, readJson, globToRegExp } from './lib/kit.mjs'

const kit = resolve(fileURLToPath(new URL('..', import.meta.url)))
const argv = process.argv.slice(2)
const keep = argv.includes('--keep')
const projectArg = argv.includes('--project') ? argv[argv.indexOf('--project') + 1] : null
if (argv.includes('--project') && !projectArg) {
  console.error('E2E_CHECK: FAIL — --project <path> needs a path')
  process.exit(1)
}
// Long path: on Windows tmpdir() can be an 8.3 short name (RUNNER~1) while git reports the long one.
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'kit-e2e-')))
const proj = join(root, 'e2e-app')
const slot = join(root, 'e2e-app-wt-1')
const slot2 = join(root, 'e2e-app-wt-2')
const origin = join(root, 'origin.git')
const server = join(root, 'server')
const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'kit-e2e', GIT_AUTHOR_EMAIL: 'kit-e2e@example.invalid',
  GIT_COMMITTER_NAME: 'kit-e2e', GIT_COMMITTER_EMAIL: 'kit-e2e@example.invalid',
  GIT_TERMINAL_PROMPT: '0',
}

const FE_BASE = 47200
// Stand-in frontend dev server (the project's `dev` script): listens on --port and fails when the port is taken,
// as a strict-port dev server must. Like a real dev server binary, the listening process carries its absolute
// path in its command line (slot-procs recognises a slot's processes by their folder).
const DEV_SERVER = `import { createServer } from 'http'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
const args = process.argv.slice(2)
if (!args.includes('--serve')) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--serve', ...args], { stdio: 'inherit' })
  child.on('exit', (code) => process.exit(code ?? 1))
} else {
  const port = Number(args[args.indexOf('--port') + 1])
  createServer((req, res) => res.end('ok'))
    .on('error', (e) => { console.error(e.message); process.exit(1) })
    .listen(port, () => console.log('dev server on ' + port))
}
`
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const results = []
let failed = 0
let skipped = 0
const sh = (cmd, args, cwd, input) => {
  const r = spawnSync(cmd, args, { cwd, env, input, encoding: 'utf8', shell: false })
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? r.error.message : ''}` }
}
const git = (cwd, ...args) => sh('git', args, cwd)
const node = (cwd, ...args) => sh(process.execPath, args, cwd)
const npm = (cwd, cmd) => spawnSync(cmd, { cwd, env, encoding: 'utf8', shell: true })
const tail = (s) => s.trim().split(/\r?\n/).slice(-3).join(' | ')
// True when nothing listens on `port` (a listen attempt succeeds); retried while a stop settles.
const portFree = (port) => {
  for (let i = 0; i < 20; i++) {
    const r = spawnSync(process.execPath, ['-e', `require('net').createServer().once('error', () => process.exit(1)).listen(${port}, () => process.exit(0))`], { encoding: 'utf8' })
    if (r.status === 0) return true
    sleep(500)
  }
  return false
}
function check(name, ok, evidence) {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — ${evidence}`}`)
  if (!ok) failed++
  return ok
}
// A case this environment cannot run (not a workflow failure): reported with the reason, not counted as failed.
function skip(name, reason) {
  results.push(`SKIP  ${name} — ${reason}`)
  skipped++
}
// A PreToolUse hook call, as Claude Code makes it: JSON on stdin, decision JSON on stdout.
const hook = (cwd, script, file) => {
  const r = sh('bash', [join(cwd, 'scripts', script)], cwd, JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(cwd, file) } }))
  const m = r.out.match(/"permission":"(allow|deny)"/)
  return { decision: m ? m[1] : `unparsed (${tail(r.out)})`, out: r.out }
}

function main() {
  // 1. Install the kit into a fresh project, set up hooks, first push to an empty remote.
  sh('git', ['init', '-q', '--bare', '-b', 'main', origin], root)
  sh('git', ['init', '-q', '-b', 'main', proj], root)
  writeFileSync(join(proj, 'package.json'), JSON.stringify({
    name: 'e2e-app', version: '0.0.0', private: true, type: 'module',
    scripts: { build: 'node -e "console.log(\'build ok\')"', lint: 'node -e ""', test: 'node -e ""', dev: 'node dev-server.mjs', prepare: 'husky' },
  }, null, 2) + '\n')
  // The frontend dev server comes from config (commands.dev + slots.fe*), the way a stack pack supplies it.
  // Unusual base ports, so a dev server already running on this machine is never in the way.
  writeFileSync(join(proj, 'kit.config.json'), JSON.stringify({
    project: { name: 'e2e-app', repoName: 'e2e-app' },
    stack: { packs: [] }, // the stack-neutral core, named explicitly (no stack named = install detects one)
    commands: { build: 'build', lint: 'lint', test: 'test', dev: 'dev' },
    slots: { fePorts: FE_BASE, bePorts: FE_BASE + 100, fePortArgs: ['--port', '{port}', '--strictPort'], feMatcher: 'dev-server\\.mjs' },
    hooks: { shellPath: 'bash' },
  }, null, 2) + '\n')
  writeFileSync(join(proj, 'dev-server.mjs'), DEV_SERVER)
  const inst = node(proj, join(kit, 'tools', 'install.mjs'), '--target', proj, '--source', kit, '--install-deps')
  if (!check('install from the kit into a fresh project', inst.status === 0 && /KIT_INSTALL: ok/.test(inst.out), tail(inst.out))) return
  check('install lists no Node built-in as a devDependency', !/npm install -D [^\n]*\bnet\b/.test(inst.out), tail(inst.out))
  check('install --install-deps installs the workflow scripts\' own dependencies (scripts/package.json)',
    /installed the workflow scripts' dependencies/.test(inst.out) && existsSync(join(proj, 'scripts', 'package-lock.json')) && !/npm install -D [^\n]*\bpicomatch\b/.test(inst.out), tail(inst.out))
  // Plan order (plan 011): the unit and fixture tests, run against this project's installed scripts/.
  const pot = spawnSync(process.execPath, ['--test', '--test-reporter=tap', join(kit, 'tools', 'test', 'plan-order.test.mjs')], { cwd: proj, env: { ...env, PLAN_ORDER_ROOT: proj }, encoding: 'utf8' })
  check('plan-order tests pass against the installed scripts (node --test tools/test/plan-order.test.mjs)', pot.status === 0 && /# fail 0/.test(`${pot.stdout}`), tail(`${pot.stdout}${pot.stderr}`))
  npm(proj, 'npm run -s prepare')
  git(proj, 'add', '-A')
  const c0 = git(proj, 'commit', '-q', '-m', 'chore: install the workflow kit')
  git(proj, 'remote', 'add', 'origin', origin)
  const p0 = git(proj, 'push', '-u', 'origin', 'main')
  check('first commit (hooks run) and first push to an empty remote', c0.status === 0 && p0.status === 0 && !/fatal/.test(p0.out), tail(c0.out + p0.out))

  // 2. Planner: save plan 001 the way save-plan does.
  const num = node(proj, 'scripts/next-plan-number.mjs')
  check('next-plan-number gives 001', num.out.trim().split(/\r?\n/).pop() === '001', tail(num.out))
  const sim = node(proj, 'scripts/plan-name-similarity.mjs', '--name=Hello Script')
  check('name-similarity finds nothing in a fresh project', sim.status === 0, tail(sim.out))
  const snap = git(proj, 'rev-parse', 'origin/main').out.trim()
  const planRel = 'plans/001-hello-script.plan.md'
  const task = '- [ ] H1: Add a hello script — `scripts/hello.mjs` prints `hello e2e`; npm script `hello` — `scripts/hello.mjs`, `package.json`'
  const plan = [
    '# Plan 001 — Hello Script', '', 'Status: draft', 'Track: code — here (not design)', `Snapshot: ${snap}`, '',
    '## Problem Statement', 'End-to-end proof of the workflow kit.', '',
    '## Goals & Success Criteria', '- [auto] `npm run -s hello` prints `hello e2e`.', '',
    '## Read-Write Scope', '', '```scope', 'scripts/hello.mjs', 'package.json', '```', '',
    '## Architecture Impact', '', '- INV-none: preserves — a new standalone script.', '',
    '## Atomic Sub-tasks', task, '',
  ].join('\n')
  const bg = hook(proj, 'branch-guard.sh', 'src/x.mjs')
  check('branch guard denies code on main in the Planner folder', bg.decision === 'deny', bg.decision)
  const bgPlan = hook(proj, 'branch-guard.sh', planRel)
  check('branch guard allows a plan file on main', bgPlan.decision === 'allow', bgPlan.decision)
  mkdirSync(join(proj, 'plans'), { recursive: true })
  writeFileSync(join(proj, planRel), plan)
  const sec = join(root, 'section.md')
  writeFileSync(sec, `### Plan 001 — Hello Script (\`${planRel}\`)\n\n${task}\n`)
  const ap = node(proj, 'scripts/todo-query.mjs', 'append', '--from', sec)
  check('todo-query append starts .claude/todo.md', ap.status === 0 && existsSync(join(proj, '.claude/todo.md')), tail(ap.out))
  const arch = node(proj, 'scripts/scope-check.mjs', '--arch', `--plan=${planRel}`)
  check('architecture gate passes INV-none', arch.status === 0 && /ARCH: (ok|skipped)/.test(arch.out), tail(arch.out))
  git(proj, 'add', planRel, '.claude/todo.md')
  const cp = git(proj, 'commit', '-q', '-m', 'plan(001): hello script')
  const pp = git(proj, 'push', 'origin', 'main')
  check('Planner commits and pushes the plan to main', cp.status === 0 && pp.status === 0, tail(cp.out + pp.out))

  // 3. pre-push refuses code on main.
  writeFileSync(join(proj, 'README.md'), '# e2e-app\n')
  git(proj, 'add', 'README.md')
  git(proj, 'commit', '-q', '-m', 'docs: readme on main')
  const bad = git(proj, 'push', 'origin', 'main')
  check('pre-push refuses a code change on main', bad.status !== 0 && /PRE_PUSH: refusing/.test(bad.out), tail(bad.out))
  git(proj, 'reset', '-q', '--hard', 'origin/main')

  // 3b. Solo work in the Planner folder: a numbered plan branch (no slot) is still held to its plan's scope at /ship;
  // a branch that names no plan gets no scope gate.
  git(proj, 'switch', '-q', '-c', 'feat/001-hello-solo')
  writeFileSync(join(proj, 'notes.md'), 'outside plan 001\n')
  git(proj, 'add', 'notes.md')
  git(proj, 'commit', '-q', '--no-verify', '-m', 'chore: a file outside the plan scope')
  const solo = node(proj, 'scripts/ship-prep.mjs')
  check('outside a slot, ship-prep holds a numbered plan branch to its plan scope', /scope: out/.test(solo.out) && /- notes\.md/.test(solo.out), tail(solo.out))
  git(proj, 'switch', '-q', '-c', 'chore/solo-no-plan')
  const noPlan = node(proj, 'scripts/ship-prep.mjs')
  check('outside a slot, a branch that names no plan has no scope gate', noPlan.status === 0 && !/scope: /.test(noPlan.out), tail(noPlan.out))
  git(proj, 'switch', '-q', 'main')
  git(proj, 'branch', '-q', '-D', 'feat/001-hello-solo', 'chore/solo-no-plan')

  // 4. Worker: slot, claim, guards, ship-prep, push.
  // Slot provisioning as the worktree-setup skill does it: root deps + the workflow scripts' own deps.
  const scriptsInstall = (dir) => npm(join(dir, 'scripts'), 'npm install --prefer-offline --no-audit --no-fund')
  const provision = (dir) => { npm(dir, 'npm install --prefer-offline --no-audit --no-fund'); scriptsInstall(dir) }
  git(proj, 'worktree', 'add', '-q', '--detach', slot, 'origin/main')
  provision(slot)
  writeFileSync(join(slot, '.worktree-root'), proj)
  writeFileSync(join(slot, '.worktree-port'), String(FE_BASE + 1))
  const tp = node(slot, 'scripts/take-plan.mjs', '001')
  check('take-plan 001 claims slot wt-1 with REALITY: clean', tp.status === 0 && /OK plan=001 branch=feat\/001-hello-script/.test(tp.out) && /REALITY: clean/.test(tp.out), tail(tp.out))
  check('take-plan installs the scripts/ dependencies when their lockfile is new to the slot', /npm install ran in scripts/.test(tp.out), tail(tp.out))

  // Frontend dev server from config: started, kept on a re-run, stopped (port freed) by slot-stop.
  const fePort = FE_BASE + 1
  const sv1 = node(slot, 'scripts/slot-serve.mjs')
  check(`slot-serve starts the frontend from commands.dev (fe=${fePort} started)`, sv1.status === 0 && new RegExp(`fe=${fePort} started`).test(sv1.out), tail(sv1.out))
  const sv2 = node(slot, 'scripts/slot-serve.mjs')
  check(`slot-serve again keeps it (fe=${fePort} kept)`, sv2.status === 0 && new RegExp(`fe=${fePort} kept`).test(sv2.out), tail(sv2.out))
  const stop = node(slot, 'scripts/slot-stop.mjs')
  check('slot-stop stops it and frees the port', stop.status === 0 && /SLOT_STOP: ok/.test(stop.out) && portFree(fePort), tail(stop.out))
  const genOk = node(slot, 'scripts/scope-check.mjs', '--file=.kit/install.json')
  check('scope-check always allows .kit/install.json (kit-sync re-records it)', genOk.status === 0, tail(genOk.out))

  git(proj, 'worktree', 'add', '-q', '--detach', slot2, 'origin/main')
  writeFileSync(join(slot2, '.worktree-root'), proj)
  writeFileSync(join(slot2, '.worktree-port'), String(FE_BASE + 2))
  provision(slot2)
  const tp2 = node(slot2, 'scripts/take-plan.mjs', '001')
  check('a second slot cannot take a plan that is already active', tp2.status !== 0 && git(slot2, 'branch', '--show-current').out.trim() === '', tail(tp2.out))

  const inScope = hook(slot, 'scope-guard.sh', 'scripts/hello.mjs')
  check('scope guard allows a file in the plan scope', inScope.decision === 'allow' && !/check failed/.test(inScope.out), tail(inScope.out))
  const outScope = hook(slot, 'scope-guard.sh', 'README.md')
  check('scope guard denies a file outside the plan scope', outScope.decision === 'deny' && /outside this plan's Read-Write Scope/.test(outScope.out), tail(outScope.out))

  writeFileSync(join(slot, 'scripts/hello.mjs'), "console.log('hello e2e')\n")
  const pkg = JSON.parse(readFileSync(join(slot, 'package.json'), 'utf8'))
  pkg.scripts.hello = 'node scripts/hello.mjs'
  writeFileSync(join(slot, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  writeFileSync(join(slot, planRel), readFileSync(join(slot, planRel), 'utf8').replace('- [ ] H1:', '- [x] H1:'))
  const hello = npm(slot, 'npm run -s hello')
  check('Done-when: npm run -s hello prints hello e2e', (hello.stdout ?? '').trim() === 'hello e2e', `${hello.stdout}${hello.stderr}`)
  const prep = node(slot, 'scripts/ship-prep.mjs')
  check('ship-prep classifies the lane and reports scope: ok', /Lane: /.test(prep.out) && /scope: ok/.test(prep.out), tail(prep.out))
  const base = node(slot, 'scripts/ship-prep.mjs', '--check-baseline')
  check('ship-prep --check-baseline OK', /status: OK/.test(base.out) && /scope: ok/.test(base.out), tail(base.out))
  const build = npm(slot, 'npm run -s build')
  const ledger = node(slot, 'scripts/plan-ledger-check.mjs')
  check('build gate and plan ledger pass', build.status === 0 && ledger.status === 0, tail(`${build.stdout}${ledger.out}`))
  git(slot, 'add', 'scripts/hello.mjs', 'package.json', planRel)
  const wc = git(slot, 'commit', '-q', '-m', 'feat(001): hello script')
  const ss = node(slot, 'scripts/write-session-state.mjs', '--summary', 'plan 001 done', '--next', 'none')
  git(slot, 'add', 'docs')
  git(slot, 'commit', '-q', '--amend', '--no-edit')
  const wp = git(slot, 'push', '-q', '-u', 'origin', 'HEAD')
  check('Worker commits (hooks run), writes session state and pushes the branch', wc.status === 0 && ss.status === 0 && wp.status === 0, tail(wc.out + ss.out + wp.out))

  // 5. Server: merge the PR, then run the todo-sync Action's scripts.
  sh('git', ['clone', '-q', '-b', 'main', origin, server], root)
  const mg = git(server, 'merge', '-q', '--no-ff', 'origin/feat/001-hello-script', '-m', 'Merge feat/001-hello-script')
  const ms = git(server, 'push', '-q', 'origin', 'main')
  check('server merges the PR', mg.status === 0 && ms.status === 0, tail(mg.out + ms.out))
  const sync = node(server, 'scripts/todo-query.mjs', 'sync', '--merged')
  const arc = node(server, 'scripts/todo-archive.mjs')
  const close = node(server, 'scripts/plan-close.mjs')
  git(server, 'add', '-A', '.claude/todo.md', '.claude/todo-archive', 'plans')
  git(server, 'commit', '-q', '-m', 'chore(todo): sync ledger and close finished plans')
  git(server, 'push', '-q', 'origin', 'main')
  const closed = existsSync(join(server, 'plans/1-100/001-hello-script.plan.md')) && !existsSync(join(server, planRel))
  const archived = existsSync(join(server, '.claude/todo-archive')) && readdirSync(join(server, '.claude/todo-archive')).length > 0
  check('after merge: ledger synced, plan closed to plans/1-100/, section archived', sync.status === 0 && closed && archived, tail(sync.out + arc.out + close.out))

  // 6. Planner pulls; the slot is released; the project still matches the kit.
  git(proj, 'pull', '-q', '--ff-only')
  const free = node(proj, 'scripts/free-merged-slots.mjs')
  const list = node(proj, 'scripts/lib/slot.mjs', '--list')
  check('free-merged-slots releases wt-1 to idle', /wt-1: freed/.test(free.out) && /wt-1: detached idle/.test(list.out), tail(free.out + list.out))
  const drift = node(proj, join(kit, 'tools', 'drift-check.mjs'), '--target', proj)
  check('drift-check ok after the full cycle', drift.status === 0 && /KIT_DRIFT: ok/.test(drift.out), tail(drift.out))
  const ks = node(proj, join(kit, 'tools', 'sync.mjs'), '--target', proj)
  check('kit-sync dry-run is a no-op', /0 new, 0 kit-update, 0 conflicts/.test(ks.out), tail(ks.out))

  // A claim commit that a pre-commit hook refuses leaves the slot as it was: detached, idle, no branch, clean.
  const plan2Rel = 'plans/002-second-script.plan.md'
  // Plan order (plan 011): 002 depends on 001 (closed above); 003 depends on 004, which still has an open sub-task.
  const snap2 = git(proj, 'rev-parse', 'origin/main').out.trim()
  const planN = (n, title, dep) => plan.replace('# Plan 001 — Hello Script', `# Plan ${n} — ${title}`)
    .replace(`Snapshot: ${snap}`, `Snapshot: ${snap2}`).replace('Status: draft', `Status: draft\nDepends-on: ${dep}`).replace('H1:', `S${n}:`)
  writeFileSync(join(proj, plan2Rel), planN('002', 'Second Script', '001'))
  writeFileSync(join(proj, 'plans/003-third-script.plan.md'), planN('003', 'Third Script', '004'))
  writeFileSync(join(proj, 'plans/004-fourth-script.plan.md'), planN('004', 'Fourth Script', 'none'))
  git(proj, 'add', 'plans')
  git(proj, 'commit', '-q', '-m', 'plan(002,003,004): second, third and fourth script')
  const pp2 = git(proj, 'push', '-q', 'origin', 'main')
  const po = node(proj, 'scripts/plan-order.mjs', '002', '003')
  check('plan-order: 002 and the open dependency 004 first, then 003 (001 is closed)',
    po.status === 0 && /^WAVE 1: 002, 004\b/m.test(po.out) && /^WAVE 2: 003$/m.test(po.out) && /^ADDED: 004 /m.test(po.out) && /^DONE: 001 \(closed: /m.test(po.out), tail(po.out))
  const notReady = node(slot2, 'scripts/take-plan.mjs', '003')
  check('take-plan refuses 003 by name: NOT_READY: plan 004 (Fourth Script) is not merged; the slot stays idle',
    notReady.status !== 0 && /NOT_READY: plan 004 \(Fourth Script\) is not merged/.test(notReady.out) && git(slot2, 'branch', '--show-current').out.trim() === '', tail(notReady.out))
  const failHooks = join(root, 'failing-hooks')
  mkdirSync(failHooks, { recursive: true })
  writeFileSync(join(failHooks, 'pre-commit'), '#!/bin/sh\necho "pre-commit: refused by the e2e fixture" >&2\nexit 1\n', { mode: 0o755 })
  const hookEnv = { ...env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: failHooks.replace(/\\/g, '/') }
  const tpFail = spawnSync(process.execPath, ['scripts/take-plan.mjs', '002'], { cwd: slot2, env: hookEnv, encoding: 'utf8' })
  const failOut = `${tpFail.stdout}${tpFail.stderr}`
  const idle = git(slot2, 'branch', '--show-current').out.trim() === '' && git(slot2, 'branch', '--list', 'feat/002-*').out.trim() === ''
  const clean = git(slot2, 'status', '--porcelain').out.trim() === '' && !existsSync(join(slot2, '.worktree-plan'))
  check('a refused claim commit rolls back: slot detached and idle, no branch left, clean tree',
    pp2.status === 0 && tpFail.status !== 0 && /TAKE_PLAN: claim commit failed: /.test(failOut) && idle && clean, tail(failOut))
  const tpRetry = node(slot2, 'scripts/take-plan.mjs', '002')
  check('after the rollback the same slot claims the plan normally (its Depends-on: 001 is closed, so it is ready)', tpRetry.status === 0 && /OK plan=002 branch=feat\/002-second-script/.test(tpRetry.out), tail(tpRetry.out))

  // A fresh plain clone of a project that keeps its own .gitignore (an override): the slot's runtime files go to
  // .git/info/exclude, so take-plan is not refused for them.
  const own = join(root, 'owned-app')
  const ownOrigin = join(root, 'owned-origin.git')
  const ownSlot = join(root, 'owned-app-wt-1')
  sh('git', ['init', '-q', '--bare', '-b', 'main', ownOrigin], root)
  sh('git', ['init', '-q', '-b', 'main', own], root)
  writeFileSync(join(own, 'package.json'), JSON.stringify({
    name: 'owned-app', version: '0.0.0', private: true, scripts: { build: 'node -e ""', lint: 'node -e ""', test: 'node -e ""' },
  }, null, 2) + '\n')
  writeFileSync(join(own, '.gitignore'), 'node_modules/\n')
  writeFileSync(join(own, 'kit.config.json'), JSON.stringify({
    project: { name: 'owned-app', repoName: 'owned-app' },
    stack: { packs: [] }, // the stack-neutral core, named explicitly (no stack named = install detects one)
    commands: { build: 'build', lint: 'lint', test: 'test' },
    hooks: { shellPath: 'bash' },
    overrides: [{ path: '.gitignore', reason: 'e2e: the project keeps its own .gitignore' }],
  }, null, 2) + '\n')
  const ownInst = node(own, join(kit, 'tools', 'install.mjs'), '--target', own, '--source', kit)
  scriptsInstall(own)
  mkdirSync(join(own, 'plans'), { recursive: true })
  writeFileSync(join(own, planRel), plan.replace(`Snapshot: ${snap}\n`, ''))
  git(own, 'add', '-A')
  git(own, 'commit', '-q', '-m', 'chore: install the workflow kit, plan 001')
  git(own, 'push', '-q', ownOrigin, 'main')
  sh('git', ['clone', '-q', ownOrigin, ownSlot], root)
  scriptsInstall(ownSlot)
  writeFileSync(join(ownSlot, '.worktree-root'), own)
  writeFileSync(join(ownSlot, '.worktree-port'), String(FE_BASE + 1))
  const ownTp = node(ownSlot, 'scripts/take-plan.mjs', '001')
  check('fresh clone with its own .gitignore: take-plan claims (runtime files in .git/info/exclude)',
    /SKIP-OVERRIDE \.gitignore/.test(ownInst.out) && ownTp.status === 0 && /OK plan=001/.test(ownTp.out) &&
    git(ownSlot, 'status', '--porcelain').out.trim() === '' && node(ownSlot, 'scripts/local-excludes.mjs', '--check').status === 0, tail(ownInst.out + ownTp.out))

  // pre-push accepts a closed plan in a range folder and still refuses code. A plain clone has no
  // hooks configured, so the commits are made there and the project's hook is run on them directly.
  const pc = join(root, 'pre-push-clone')
  sh('git', ['clone', '-q', '-b', 'main', origin, pc], root)
  const remoteSha = git(pc, 'rev-parse', 'origin/main').out.trim()
  const prePush = (sha) => sh('sh', [join(proj, '.husky', 'pre-push'), 'origin', origin], pc, `refs/heads/main ${sha} refs/heads/main ${remoteSha}\n`)
  mkdirSync(join(pc, 'plans', '300-400'), { recursive: true })
  writeFileSync(join(pc, 'plans', '300-400', 'x.plan.md'), '# Plan 300 — x\n')
  git(pc, 'add', 'plans')
  git(pc, 'commit', '-q', '-m', 'plan: close 300')
  const rangeOk = prePush(git(pc, 'rev-parse', 'HEAD').out.trim())
  check('pre-push accepts a push touching only plans/300-400/x.plan.md', rangeOk.status === 0, tail(rangeOk.out))
  mkdirSync(join(pc, 'src'), { recursive: true })
  writeFileSync(join(pc, 'src', 'x.ts'), 'export {}\n')
  git(pc, 'add', 'src')
  git(pc, 'commit', '-q', '-m', 'feat: x')
  const srcBad = prePush(git(pc, 'rev-parse', 'HEAD').out.trim())
  check('pre-push still refuses src/x.ts', srcBad.status !== 0 && /src\/x\.ts/.test(srcBad.out), tail(srcBad.out))

  // 7. A project without husky: core.hooksPath=.husky alone must run the hooks (on Windows git needs the shebang).
  const nh = join(root, 'nohusky-app')
  sh('git', ['init', '-q', '-b', 'main', nh], root)
  writeFileSync(join(nh, 'package.json'), JSON.stringify({
    name: 'nohusky-app', version: '0.0.0', private: true, type: 'module',
    scripts: { build: 'node -e ""', lint: 'node -e ""', test: 'node -e ""' },
  }, null, 2) + '\n')
  writeFileSync(join(nh, 'kit.config.json'), JSON.stringify({
    project: { name: 'nohusky-app', repoName: 'nohusky-app' },
    stack: { packs: [] }, // the stack-neutral core, named explicitly (no stack named = install detects one)
    commands: { build: 'build', lint: 'lint', test: 'test' },
    hooks: { shellPath: 'bash' },
  }, null, 2) + '\n')
  const nhInst = node(nh, join(kit, 'tools', 'install.mjs'), '--target', nh, '--source', kit)
  const modes = git(nh, 'ls-files', '-s', '--', '.husky').out.trim().split(/\r?\n/).filter(Boolean)
  check('install stages every git hook as 100755', nhInst.status === 0 && modes.length > 0 && modes.every((l) => l.startsWith('100755')), tail(nhInst.out + modes.join(' | ')))
  git(nh, 'config', 'core.hooksPath', '.husky')
  git(nh, 'add', '-A')
  const nc = git(nh, 'commit', '-q', '-m', 'chore: install the workflow kit')
  check('no husky: the first commit runs the pre-commit hook and passes', nc.status === 0 && !/cannot spawn/.test(nc.out), tail(nc.out))
  writeFileSync(join(nh, 'config.mjs'), `export const key = '${'AKIA'}${'Q'.repeat(16)}'\n`)
  git(nh, 'add', 'config.mjs')
  const nk = git(nh, 'commit', '-q', '-m', 'feat: config')
  check('no husky: the pre-commit hook refuses a staged fake key', nk.status !== 0 && /secret-scan: blocked config\.mjs/.test(nk.out), tail(nk.out))

  // 8. SessionStart output is valid JSON with additionalContext under hookSpecificOutput, on every branch.
  sessionStartCases(join(proj, 'scripts', 'session-startup.sh'))
}

// The installed SessionStart script runs next to stubbed helpers, so each branch can be forced; each output must be
// valid JSON with additionalContext (a string) under hookSpecificOutput, also with quotes and newlines in the state file.
function sessionStartCases(script) {
  const ssDir = join(root, 'session-start')
  mkdirSync(join(ssDir, 'scripts', 'lib'), { recursive: true })
  writeFileSync(join(ssDir, 'scripts', 'session-startup.sh'), readFileSync(script, 'utf8'))
  writeFileSync(join(ssDir, 'scripts', 'lib', 'slot.mjs'), 'console.log(process.env.STUB_DESCRIBE)\n')
  writeFileSync(join(ssDir, 'scripts', 'session-state-path.mjs'), 'console.log(process.env.STUB_RESOLVED)\n')
  writeFileSync(join(ssDir, 'scripts', 'free-merged-slots.mjs'), '')
  writeFileSync(join(ssDir, 'scripts', 'orphan-sweep.mjs'), '')
  const nasty = 'quote " backslash \\ backtick ` dollar $HOME\nsecond line'
  writeFileSync(join(ssDir, 'state.md'), `# State\n\n## Session Summary\n${nasty}\n\n## Next Steps\n- go\n`)
  const branches = [
    ['idle slot', { STUB_DESCRIBE: 'IDLE SLOT: wt-1 is idle', STUB_RESOLVED: 'NONE' }, 'IDLE SLOT: wt-1'],
    ['worker without state', { STUB_DESCRIBE: 'WORKER: plan=001', STUB_RESOLVED: 'missing.md' }, 'No previous session state'],
    ['worker with a state file', { STUB_DESCRIBE: 'WORKER: plan=001', STUB_RESOLVED: 'state.md' }, nasty],
  ]
  for (const [name, stub, expect] of branches) {
    const r = spawnSync('bash', [join(ssDir, 'scripts', 'session-startup.sh')], { cwd: ssDir, env: { ...env, ...stub }, encoding: 'utf8' })
    let ctx
    try { ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext } catch (e) { ctx = undefined }
    check(`SessionStart JSON parses (${name})`, typeof ctx === 'string' && ctx.includes(expect), tail(`${r.stdout}${r.stderr}`))
  }
}

// ---------------------------------------------------------------------------------------------------------------
// --project <path>: the cycle on a scratch copy of a real installed project.
const isWin = process.platform === 'win32'
const junctions = []
const P = {} // project-mode folders, for the cleanup
// A directory junction (Windows) or symlink (POSIX) at `path` pointing at `target`. False when there is no target.
function link(target, path) {
  if (!existsSync(target)) return false
  mkdirSync(dirname(path), { recursive: true })
  if (isWin) sh('cmd', ['/c', 'mklink', '/J', path, target], root)
  else symlinkSync(target, path, 'dir')
  junctions.push(path)
  return existsSync(path)
}
// Remove every junction itself, never what it points at: `rmdir` on Windows, unlink on POSIX. True when all are gone.
// Synchronous and idempotent (the links that are gone leave the list), so the exit and signal handlers can call it.
function unlinkAll() {
  for (const p of [...junctions].reverse()) {
    try {
      if (!lstatSync(p, { throwIfNoEntry: false })) continue
      if (isWin) spawnSync('cmd', ['/c', 'rmdir', p], { cwd: tmpdir(), encoding: 'utf8' })
      else rmSync(p)
    } catch { /* checked below */ }
  }
  const left = junctions.filter((p) => lstatSync(p, { throwIfNoEntry: false }))
  junctions.splice(0, junctions.length, ...left)
  return left.length === 0
}
// An interrupted run (Ctrl+C, a CI timeout, a kill) still removes the links: a later recursive delete of the temp
// folder (PowerShell 5 `Remove-Item -Recurse` follows junctions) would otherwise empty the project's node_modules.
// Secrets copied into the scratch slots (the backend env file): deleted when the run ends, however it ends.
const envCopies = []
function dropEnvCopies() {
  const left = []
  for (const f of envCopies.splice(0)) {
    try { rmSync(f, { force: true }) } catch { /* reported below */ }
    if (existsSync(f)) left.push(f)
  }
  if (left.length) console.error(`E2E: could not delete the copied env file(s) ${left.join(', ')} — delete them by hand`)
}
process.on('exit', () => {
  dropEnvCopies()
  if (junctions.length && !unlinkAll()) console.error(`E2E: junctions still in ${root}: ${junctions.join(', ')} — remove each with rmdir before deleting the folder`)
})
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  try {
    process.on(sig, () => {
      unlinkAll()
      const hadEnv = envCopies.length > 0
      dropEnvCopies()
      console.error(`E2E: interrupted (${sig}); node_modules links removed${junctions.length ? ` except ${junctions.join(', ')}` : ''}${hadEnv ? '; the copied env files (secrets) were deleted' : ''}. Scratch folder: ${root}`)
      process.exit(130)
    })
  } catch { /* signal not supported on this platform */ }
}
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

function projectMain(here) {
  if (!existsSync(join(here, '.kit', 'install.json')) || git(here, 'rev-parse', 'HEAD').status !== 0) {
    check('--project is a kit-installed git checkout', false, `${here}: no .kit/install.json or no commit`)
    return
  }
  P.here = here
  P.had = ['.', 'scripts'].filter((sub) => existsSync(join(here, sub, 'node_modules')))
  // Pre-flight: the slots borrow the project's node_modules, so a folder that declares dependencies needs them
  // installed first (else the slot dev server fails with "'vite' is not recognized" or the like).
  // No node_modules, or a broken install that lacks most declared packages (an interrupted npm ci), stops the run. A few
  // missing packages are only noted: the cycle may not need them.
  const declared = (sub) => {
    try {
      const pj = readJson(join(here, sub, 'package.json'))
      return Object.keys({ ...pj.dependencies, ...pj.devDependencies })
    } catch { return [] }
  }
  const lacking = ['.', 'scripts']
    .map((sub) => [sub, declared(sub).filter((name) => !existsSync(join(here, sub, 'node_modules', name, 'package.json')))])
    .filter(([, missing]) => missing.length)
  const noDeps = lacking.filter(([sub, missing]) => !existsSync(join(here, sub, 'node_modules')) || missing.length * 2 > declared(sub).length)
  for (const [sub, missing] of lacking.filter((l) => !noDeps.includes(l))) {
    console.log(`E2E: NOTE ${sub === '.' ? here : join(here, sub)} lacks ${missing.length} declared package(s): ${missing.join(', ')} (npm ci installs them)`)
  }
  if (noDeps.length) {
    for (const [sub, missing] of noDeps) {
      const at = sub === '.' ? here : join(here, sub)
      const which = `${missing.length} of ${declared(sub).length} declared packages missing, e.g. ${missing.slice(0, 3).join(', ')}`
      check(`dependencies installed in ${at}`, false, `install dependencies in ${at} first (npm ci): the scratch slots borrow its node_modules; ${which}`)
    }
    return
  }
  console.log(`E2E: scratch folder ${root} — its slots LINK to ${here}'s node_modules. While this run is alive or if it was ` +
    'killed, do NOT delete that folder recursively (Remove-Item -Recurse / rm -rf follow the links): remove each ' +
    'node_modules link with rmdir first. The run removes them itself when it ends or is interrupted.')
  const inst = readJson(join(here, '.kit', 'install.json'))
  const cfg = existsSync(join(here, 'kit.config.json')) ? readJson(join(here, 'kit.config.json')) : {}
  const vals = resolveConfig({ kitRoot: kit, project: cfg, packs: inst.packs ?? [], layers: inst.layers ?? [], target: here })
  const main = vals['git.mainBranch'] || 'main'
  const repo = vals['project.repoName'] || basename(here)
  const feBase = Number(vals['slots.fePorts']) || 4200
  const asList = (v) => (Array.isArray(v) ? v : v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : [])
  const hotspot = asList(vals['paths.hotspots']).find((h) => !/[*?]/.test(h) && existsSync(join(here, h)))
  const upstreamOwned = asList(vals['ownership.upstreamPaths']).find((p) => !/[*?]/.test(p) && !p.endsWith('/') && existsSync(join(here, p)))
  let pkg = {}
  try { pkg = readJson(join(here, 'package.json')) } catch { /* no package.json */ }
  const devScript = vals['commands.dev'] && pkg.scripts?.[vals['commands.dev']]
  const buildScript = vals['commands.build'] && pkg.scripts?.[vals['commands.build']]
  const origin = join(root, 'origin.git')
  const upstream = join(root, 'upstream.git')
  const proj = P.proj = join(root, repo)
  const slot = P.slot = join(root, `${repo}-wt-2`)
  const slot2 = P.slot2 = join(root, `${repo}-wt-3`)
  const server = join(root, 'server')
  const friend = join(root, 'friend')
  delete env.GITHUB_TOKEN // nothing here may reach GitHub
  delete env.GH_TOKEN
  // The backend env file the slot setup copies into every real slot (worktree-setup): ignored by git, so the clone lacks
  // it. Only a file git ignores is copied (an untracked file that is not ignored is not the slot setup's env file).
  const serverRoot = String(vals['paths.serverRoot'] ?? '').replace(/\\/g, '/')
  const envFiles = serverRoot && existsSync(join(here, serverRoot, 'package.json')) ? [`${serverRoot}.env`] : []
  const untracked = envFiles.filter((f) => git(here, 'ls-files', '--error-unmatch', f).status !== 0)
  const envCopy = untracked.filter((f) => existsSync(join(here, f)) && git(here, 'check-ignore', '-q', f).status === 0)
  const envMissing = untracked.filter((f) => !existsSync(join(here, f)))
  if (envCopy.length) console.log(`E2E: copying ${envCopy.join(', ')} from ${here} into the scratch slots, as the slot setup does for a real slot; the copies are deleted when the run ends.`)
  // A slot borrows the project's installed dependencies; a recorded lockfile hash tells take-plan not to reinstall.
  const prepareSlot = (dir, n) => {
    writeFileSync(join(dir, '.worktree-root'), proj)
    writeFileSync(join(dir, '.worktree-port'), String(feBase + n))
    mkdirSync(join(dir, '.claude'), { recursive: true })
    for (const f of envCopy) {
      copyFileSync(join(here, f), join(dir, f))
      envCopies.push(join(dir, f))
    }
    for (const [sub, hashName] of [['.', '.last-npm-install-hash'], ['scripts', '.last-npm-install-hash-scripts']]) {
      if (link(join(here, sub, 'node_modules'), join(dir, sub, 'node_modules')) && existsSync(join(dir, sub, 'package-lock.json'))) {
        writeFileSync(join(dir, '.claude', hashName), sha(join(dir, sub, 'package-lock.json')))
      }
    }
  }

  // 0. Stand-ins for GitHub (origin) and the upstream repo, and the Planner folder.
  const head = git(here, 'rev-parse', 'HEAD').out.trim()
  // The upstream's own default branch (refs/remotes/upstream/HEAD), else the same name as ours.
  const upBranch = git(here, 'symbolic-ref', '--short', 'refs/remotes/upstream/HEAD').out.trim().replace(/^upstream\//, '') || main
  const upRef = git(here, 'rev-parse', '--verify', '-q', `upstream/${upBranch}`).out.trim()
  for (const [bare, ref, branch] of [[origin, head, main], ...(upRef ? [[upstream, upRef, upBranch]] : [])]) {
    git(root, 'clone', '-q', '--bare', '--no-tags', here, bare)
    git(bare, 'update-ref', `refs/heads/${branch}`, ref)
    git(bare, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`)
  }
  const cl = git(root, 'clone', '-q', '-b', main, origin, proj)
  git(proj, 'config', 'core.hooksPath', '.husky') // hooks on, as in the real Planner folder (husky or not)
  // On POSIX the borrowed node_modules are symlinks, which a `node_modules/` ignore rule (directories only) does not
  // match: exclude the link paths themselves, for this scratch clone and its slots (shared git dir).
  const exclude = resolve(proj, git(proj, 'rev-parse', '--git-common-dir').out.trim(), 'info', 'exclude')
  mkdirSync(dirname(exclude), { recursive: true })
  writeFileSync(exclude, `${existsSync(exclude) ? readFileSync(exclude, 'utf8') : ''}\n/node_modules\n/scripts/node_modules\n`)
  if (upRef) {
    git(proj, 'remote', 'add', 'upstream', upstream)
    git(proj, 'fetch', '-q', 'upstream')
  }
  link(join(here, 'scripts', 'node_modules'), join(proj, 'scripts', 'node_modules'))
  if (!check(`scratch Planner folder = clone of the project HEAD with git hooks on (${repo})`, cl.status === 0 && existsSync(join(proj, '.kit', 'install.json')), tail(cl.out))) return

  // 1. Planner saves a plan the way save-plan does; the plan commit runs the pre-commit hook (no --no-verify).
  const num = node(proj, 'scripts/next-plan-number.mjs', '--no-fetch').out.trim().split(/\r?\n/).pop()
  check('next-plan-number gives the next free number', /^\d{3}$/.test(num), num)
  const sim = node(proj, 'scripts/plan-name-similarity.mjs', '--name=E2E Hello Script')
  check('plan-name-similarity runs', sim.status === 0, tail(sim.out))
  const snap = git(proj, 'rev-parse', `origin/${main}`).out.trim()
  const slug = 'e2e-hello-script'
  const planRel = `plans/${num}-${slug}.plan.md`
  const task = '- [ ] H1: Add an e2e hello script — `scripts/e2e/hello.mjs` prints `hello e2e` — `scripts/e2e/hello.mjs`'
  const plan = [
    `# Plan ${num} — E2E Hello Script`, '', 'Status: draft', `Snapshot: ${snap}`, '',
    '## Problem Statement', 'Scratch-only end-to-end proof of the workflow on this project.', '',
    '## Goals & Success Criteria', '- [auto] `node scripts/e2e/hello.mjs` prints `hello e2e`.', '',
    '## Read-Write Scope', '', '```scope', 'scripts/e2e/hello.mjs', '```', '',
    '## Architecture Impact', '', '- INV-none: preserves — a standalone script.', '',
    '## Atomic Sub-tasks', task, '',
  ].join('\n')
  const codePath = hotspot ?? 'src/e2e-probe.ts'
  const bg = hook(proj, 'branch-guard.sh', codePath)
  check('branch guard denies code on main in the Planner folder', bg.decision === 'deny', bg.decision)
  const bgPlan = hook(proj, 'branch-guard.sh', planRel)
  check('branch guard allows a plan file on main', bgPlan.decision === 'allow', bgPlan.decision)
  mkdirSync(join(proj, 'plans'), { recursive: true })
  writeFileSync(join(proj, planRel), plan)
  const sec = join(root, 'section.md')
  writeFileSync(sec, `### Plan ${num} — E2E Hello Script (\`${planRel}\`)\n\n${task}\n`)
  const ap = node(proj, 'scripts/todo-query.mjs', 'append', '--from', sec)
  check('todo-query append adds the plan section to .claude/todo.md', ap.status === 0 && readFileSync(join(proj, '.claude/todo.md'), 'utf8').includes(planRel), tail(ap.out))
  const arch = node(proj, 'scripts/scope-check.mjs', '--arch', `--plan=${planRel}`)
  check('architecture gate passes the plan', arch.status === 0 && /ARCH: (ok|skipped)/.test(arch.out), tail(arch.out))
  const ledger0 = node(proj, 'scripts/plan-ledger-check.mjs')
  check('plan-ledger-check passes with the new plan', ledger0.status === 0, tail(ledger0.out))
  git(proj, 'add', planRel, '.claude/todo.md')
  const cp = git(proj, 'commit', '-q', '-m', `plan(${num}): e2e hello script`)
  const pp = git(proj, 'push', '-q', 'origin', main)
  check('the plan commit runs the hooks (no --no-verify) and pre-push lets the plan reach main',
    cp.status === 0 && !/cannot spawn/.test(cp.out) && pp.status === 0, tail(cp.out + pp.out))

  // 2. pre-push refuses code on main; main goes back without reset --hard.
  writeFileSync(join(proj, 'e2e-code.txt'), 'code on main\n')
  git(proj, 'add', 'e2e-code.txt')
  git(proj, 'commit', '-q', '-m', 'chore: code on main')
  const bad = git(proj, 'push', 'origin', main)
  check('pre-push refuses a code change on main', bad.status !== 0 && /PRE_PUSH: refusing/.test(bad.out), tail(bad.out))
  git(proj, 'reset', '-q', '--soft', `origin/${main}`)
  git(proj, 'rm', '-q', '--cached', 'e2e-code.txt')
  rmSync(join(proj, 'e2e-code.txt'))

  // 3. Worker slot: claim, a second claim refused, the scope guard.
  git(proj, 'worktree', 'add', '-q', '--detach', slot, `origin/${main}`)
  prepareSlot(slot, 2)
  const tp = node(slot, 'scripts/take-plan.mjs', num)
  const branch = `feat/${num}-${slug}`
  check(`take-plan ${num} claims wt-2 with REALITY: clean (the claim commit runs the hooks)`, tp.status === 0 && tp.out.includes(`OK plan=${num} branch=${branch}`) && /REALITY: clean/.test(tp.out), tail(tp.out))
  git(proj, 'worktree', 'add', '-q', '--detach', slot2, `origin/${main}`)
  prepareSlot(slot2, 3)
  const tp2 = node(slot2, 'scripts/take-plan.mjs', num)
  check('a second slot cannot take a plan that is already active', tp2.status !== 0 && git(slot2, 'branch', '--show-current').out.trim() === '', tail(tp2.out))
  const inScope = hook(slot, 'scope-guard.sh', 'scripts/e2e/hello.mjs')
  check('scope guard allows a file in the plan scope', inScope.decision === 'allow' && !/check failed/.test(inScope.out), tail(inScope.out))
  const outScope = hook(slot, 'scope-guard.sh', 'e2e-outside.txt')
  check('scope guard denies a file outside the plan scope', outScope.decision === 'deny' && /outside this plan's Read-Write Scope/.test(outScope.out), tail(outScope.out))
  if (hotspot && !asList(vals['ownership.upstreamPaths']).some((g) => globToRegExp(g).test(hotspot))) {
    const hot = hook(slot, 'scope-guard.sh', hotspot)
    check(`scope guard allows the append-only hotspot (${hotspot})`, hot.decision === 'allow', tail(hot.out))
  }
  if (upstreamOwned) {
    const up = hook(slot, 'scope-guard.sh', upstreamOwned)
    check(`scope guard denies an upstream-owned path (${upstreamOwned}), not an approved: decision`, up.decision === 'deny' && /upstream-owned/.test(up.out), tail(up.out))
  }

  // 4. The slot's frontend dev server, from config (commands.dev + slots.fe*).
  if (devScript && !argv.includes('--skip-serve') && envMissing.length) {
    skip('slot-serve starts, keeps and stops the slot dev servers', `${envMissing.map((f) => join(here, f)).join(', ')} is missing: the slot setup copies it into every slot and the backend cannot start without it`)
  } else if (devScript && !argv.includes('--skip-serve')) {
    const port = feBase + 2
    const s1 = node(slot, 'scripts/slot-serve.mjs')
    check(`slot-serve starts the frontend on the slot port (fe=${port} started)`, s1.status === 0 && new RegExp(`fe=${port} started`).test(s1.out), tail(s1.out))
    const s2 = node(slot, 'scripts/slot-serve.mjs')
    check(`slot-serve again keeps it (fe=${port} kept)`, s2.status === 0 && new RegExp(`fe=${port} kept`).test(s2.out), tail(s2.out))
    const st = node(slot, 'scripts/slot-stop.mjs')
    check('slot-stop stops it and frees the port', st.status === 0 && /SLOT_STOP: ok/.test(st.out) && portFree(port), tail(st.out))
  }

  // 5. The Worker does the task and ships.
  mkdirSync(join(slot, 'scripts', 'e2e'), { recursive: true })
  writeFileSync(join(slot, 'scripts/e2e/hello.mjs'), "console.log('hello e2e')\n")
  writeFileSync(join(slot, planRel), readFileSync(join(slot, planRel), 'utf8').replace('- [ ] H1:', '- [x] H1:'))
  const hello = node(slot, 'scripts/e2e/hello.mjs')
  check('Done-when: the script prints hello e2e', hello.out.trim() === 'hello e2e', hello.out)
  const prep = node(slot, 'scripts/ship-prep.mjs')
  check('ship-prep classifies the lane and reports scope: ok', /Lane: /.test(prep.out) && /scope: ok/.test(prep.out), tail(prep.out))
  const base = node(slot, 'scripts/ship-prep.mjs', '--check-baseline')
  check('ship-prep --check-baseline OK', /status: OK/.test(base.out), tail(base.out))
  if (buildScript && !argv.includes('--skip-build')) {
    const build = npm(slot, `npm run -s ${vals['commands.build']}`)
    check(`build gate passes in the slot (npm run ${vals['commands.build']})`, build.status === 0, tail(`${build.stdout}${build.stderr}`))
  }
  git(slot, 'add', 'scripts/e2e/hello.mjs', planRel)
  const wc = git(slot, 'commit', '-q', '-m', `feat(${num}): e2e hello script`)
  const ss = node(slot, 'scripts/write-session-state.mjs', '--summary', 'e2e plan done', '--next', 'none')
  git(slot, 'add', 'docs')
  git(slot, 'commit', '-q', '--amend', '--no-edit')
  const wp = git(slot, 'push', '-q', '-u', 'origin', 'HEAD')
  check('Worker commits (hooks run), writes session state and pushes its branch', wc.status === 0 && ss.status === 0 && wp.status === 0, tail(wc.out + ss.out + wp.out))

  // 6. "GitHub": merge, then the todo-sync workflow's scripts.
  git(root, 'clone', '-q', '-b', main, origin, server)
  const mg = git(server, 'merge', '-q', '--no-ff', `origin/${branch}`, '-m', `Merge ${branch}`)
  const ms = git(server, 'push', '-q', 'origin', main)
  check('server merges the PR', mg.status === 0 && ms.status === 0, tail(mg.out + ms.out))
  const sync = node(server, 'scripts/todo-query.mjs', 'sync', '--merged')
  const arc = node(server, 'scripts/todo-archive.mjs')
  const close = node(server, 'scripts/plan-close.mjs')
  git(server, 'add', '-A', '.claude/todo.md', '.claude/todo-archive', 'plans')
  git(server, 'commit', '-q', '-m', 'chore(todo): sync ledger and close finished plans')
  git(server, 'push', '-q', 'origin', main)
  const closedDir = readdirSync(join(server, 'plans')).find((d) => /^\d+-\d+$/.test(d) && existsSync(join(server, 'plans', d, `${num}-${slug}.plan.md`)))
  check('after merge: ledger synced, plan closed into its range folder, section archived', sync.status === 0 && arc.status === 0 && !!closedDir && !existsSync(join(server, planRel)), tail(sync.out + arc.out + close.out))

  // 7. Planner pulls; the slot is released; a Planner close-out push into a range folder is accepted.
  const pl = git(proj, 'pull', '-q', '--ff-only')
  const free = node(proj, 'scripts/free-merged-slots.mjs')
  check('Planner pulls and free-merged-slots releases wt-2 to idle', pl.status === 0 && /wt-2: freed/.test(free.out), tail(pl.out + free.out))
  mkdirSync(join(proj, 'plans', '900-1000'), { recursive: true })
  writeFileSync(join(proj, 'plans', '900-1000', '999-e2e-closed.plan.md'), '# Plan 999 — E2E Closed\n\nStatus: done\n')
  git(proj, 'add', 'plans')
  git(proj, 'commit', '-q', '-m', 'chore(plans): file a closed plan')
  const mv = git(proj, 'push', 'origin', main)
  check('pre-push accepts a Planner close-out push into a range folder', mv.status === 0, tail(mv.out))

  // 8. /pull-copy against the scratch upstream: a new upstream commit, our commits replayed on top.
  if (upRef) {
    git(root, 'clone', '-q', '-b', upBranch, upstream, friend)
    writeFileSync(join(friend, 'e2e-upstream-change.txt'), 'upstream change\n')
    git(friend, 'add', 'e2e-upstream-change.txt')
    git(friend, 'commit', '-q', '-m', 'upstream: new change')
    git(friend, 'push', '-q', 'origin', upBranch)
    git(proj, 'fetch', '-q', 'upstream')
    const incoming = git(proj, 'rev-list', '--count', `HEAD..upstream/${upBranch}`).out.trim()
    // A rebase replays commits, not merges: PR merge commits collapse, so count non-merge commits.
    const ours = git(proj, 'rev-list', '--count', '--no-merges', `upstream/${upBranch}..HEAD`).out.trim()
    const rb = git(proj, 'rebase', `upstream/${upBranch}`)
    const onTop = git(proj, 'rev-list', '--count', '--no-merges', `upstream/${upBranch}..HEAD`).out.trim()
    check('/pull-copy: the rebase onto upstream replays every one of our commits on top', rb.status === 0 && incoming === '1' && onTop === ours && existsSync(join(proj, 'e2e-upstream-change.txt')), `incoming=${incoming} ours=${ours} onTop=${onTop} ${tail(rb.out)}`)
    const fp = git(proj, 'push', '--force-with-lease', 'origin', main)
    check('/pull-copy: the force-push without --no-verify is refused by pre-push (the Human runs it)', fp.status !== 0 && /PRE_PUSH: refusing/.test(fp.out), tail(fp.out))
    // Conflict path: upstream adds a file our commits also add (CLAUDE.md): the rebase stops, --abort restores the head.
    writeFileSync(join(friend, 'CLAUDE.md'), '# upstream\n')
    git(friend, 'add', 'CLAUDE.md')
    git(friend, 'commit', '-q', '-m', 'upstream: add CLAUDE.md')
    git(friend, 'push', '-q', 'origin', upBranch)
    const before = git(proj, 'rev-parse', 'HEAD').out.trim()
    git(proj, 'fetch', '-q', 'upstream')
    const rb2 = git(proj, 'rebase', `upstream/${upBranch}`)
    const conflicts = git(proj, 'diff', '--name-only', '--diff-filter=U').out.trim()
    const ab = git(proj, 'rebase', '--abort')
    check('/pull-copy conflict path: the rebase stops on CLAUDE.md and --abort restores the old head', rb2.status !== 0 && /CLAUDE\.md/.test(conflicts) && ab.status === 0 && git(proj, 'rev-parse', 'HEAD').out.trim() === before, `conflicts=${conflicts} ${tail(rb2.out)}`)
  }

  // 9. The scratch project still matches the kit; the maintenance scripts run.
  const localSource = /^local:/.test(inst.source ?? '')
  const drift = node(proj, join(kit, 'tools', 'drift-check.mjs'), '--target', proj, ...(localSource || !inst.source ? ['--source', kit] : []))
  check('drift-check ok after the full cycle', drift.status === 0 && /KIT_DRIFT: ok/.test(drift.out), tail(drift.out))
  const runs = [
    ['github-sync-gate', node(proj, 'scripts/github-sync-gate.mjs')],
    ['orphan-sweep', node(proj, 'scripts/orphan-sweep.mjs')],
    ['prune-merged-worktrees (dry run)', sh('bash', ['scripts/prune-merged-worktrees.sh'], proj)],
    ['prune-old-sessions (dry run)', sh('bash', ['scripts/prune-old-sessions.sh'], proj)],
    ['session-lock claim/release', sh('bash', ['-c', `source scripts/session-lock.sh && claim_lock "${proj.replace(/\\/g, '/')}" && release_lock "${proj.replace(/\\/g, '/')}"`], proj)],
    ['brain-review-check --scope=full', node(proj, 'scripts/brain-review-check.mjs', '--scope=full')],
    ['brain-capture-comment', node(proj, 'scripts/brain-capture-comment.mjs')],
    ['plan-ledger-check', node(proj, 'scripts/plan-ledger-check.mjs')],
    ['workflow-link-check (the kit tool on the project)', node(proj, join(kit, 'tools', 'workflow-link-check.mjs'), '--target', proj)],
  ]
  for (const [name, r] of runs) check(`${name} exits 0`, r.status === 0, tail(r.out))

  // 10. SessionStart JSON from the project's own script.
  sessionStartCases(join(proj, 'scripts', 'session-startup.sh'))
}

let rootRemovable = true
try {
  if (projectArg) projectMain(resolve(projectArg))
  else main()
} catch (e) {
  check('e2e run', false, e.stack ?? String(e))
}
if (projectArg) {
  for (const s of [P.slot, P.slot2]) if (s && existsSync(join(s, 'scripts', 'slot-stop.mjs'))) node(s, 'scripts/slot-stop.mjs')
  // Junctions first, with rmdir: deleting the temp folder must never reach the project's own node_modules.
  rootRemovable = unlinkAll()
  if (!rootRemovable) check('every node_modules junction removed before cleanup', false, `still there: ${junctions.join(', ')}`)
  for (const sub of P.had ?? []) {
    const dir = join(P.here, sub, 'node_modules')
    if (!existsSync(dir) || readdirSync(dir).length === 0) check(`the project's ${sub === '.' ? '' : `${sub}/`}node_modules is intact after cleanup`, false, `${dir} is gone or empty — reinstall it`)
  }
}
console.log(results.join('\n'))
if (envCopies.length) {
  dropEnvCopies()
  if (keep || !rootRemovable) console.log(`E2E: the scratch folder held copies of the backend env file (secrets); they were deleted.`)
}
if (keep) console.log(`E2E: kept ${root}`)
else if (!rootRemovable) console.log(`E2E: left ${root} in place (a junction is still there; remove it with rmdir, then the folder)`)
else {
  const p = projectArg ? P.proj : proj
  if (p && existsSync(p)) {
    git(p, 'worktree', 'remove', '--force', projectArg ? P.slot : slot)
    git(p, 'worktree', 'remove', '--force', projectArg ? P.slot2 : slot2)
  }
  try { rmSync(root, { recursive: true, force: true }) } catch { console.log(`E2E: could not delete ${root} (a file is still held) — delete it by hand`) }
}
const total = results.length - skipped
const skipNote = skipped ? `, ${skipped} skipped` : ''
console.log(failed ? `E2E_CHECK: FAIL — ${failed} of ${total} cases failed${skipNote}` : `E2E_CHECK: ok — ${total} cases passed${skipNote}`)
process.exit(failed ? 1 : 0)
