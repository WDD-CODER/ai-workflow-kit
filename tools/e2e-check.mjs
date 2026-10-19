/**
 * End-to-end proof — installs this kit into a fresh project and runs one plan through the whole
 * Planner-Worker cycle, the way a project uses it. Run from the kit root:
 *
 *   node tools/e2e-check.mjs [--keep]
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
 * SessionStart prints valid JSON on each branch (idle slot, worker without and with a session-state file).
 * Exit 0 = every case passed, 1 = failures (one line per case).
 */
import { writeFileSync, readFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

const kit = resolve(fileURLToPath(new URL('..', import.meta.url)))
const keep = process.argv.includes('--keep')
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

  // 4. Worker: slot, claim, guards, ship-prep, push.
  // Slot provisioning as the worktree-setup skill does it: root deps + the workflow scripts' own deps.
  const provision = (dir) => npm(dir, 'npm install --prefer-offline --no-audit --no-fund && npm install --prefix scripts --prefer-offline --no-audit --no-fund')
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
  writeFileSync(join(proj, plan2Rel), plan.replace('# Plan 001 — Hello Script', '# Plan 002 — Second Script')
    .replace(`Snapshot: ${snap}`, `Snapshot: ${git(proj, 'rev-parse', 'origin/main').out.trim()}`).replace('H1:', 'S1:'))
  git(proj, 'add', plan2Rel)
  git(proj, 'commit', '-q', '-m', 'plan(002): second script')
  const pp2 = git(proj, 'push', '-q', 'origin', 'main')
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
  check('after the rollback the same slot claims the plan normally', tpRetry.status === 0 && /OK plan=002 branch=feat\/002-second-script/.test(tpRetry.out), tail(tpRetry.out))

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
    commands: { build: 'build', lint: 'lint', test: 'test' },
    hooks: { shellPath: 'bash' },
    overrides: [{ path: '.gitignore', reason: 'e2e: the project keeps its own .gitignore' }],
  }, null, 2) + '\n')
  const ownInst = node(own, join(kit, 'tools', 'install.mjs'), '--target', own, '--source', kit)
  npm(own, 'npm install --prefix scripts --prefer-offline --no-audit --no-fund')
  mkdirSync(join(own, 'plans'), { recursive: true })
  writeFileSync(join(own, planRel), plan.replace(`Snapshot: ${snap}\n`, ''))
  git(own, 'add', '-A')
  git(own, 'commit', '-q', '-m', 'chore: install the workflow kit, plan 001')
  git(own, 'push', '-q', ownOrigin, 'main')
  sh('git', ['clone', '-q', ownOrigin, ownSlot], root)
  npm(ownSlot, 'npm install --prefix scripts --prefer-offline --no-audit --no-fund')
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
  // The installed script runs next to stubbed helpers, so each branch can be forced.
  const ssDir = join(root, 'session-start')
  mkdirSync(join(ssDir, 'scripts', 'lib'), { recursive: true })
  writeFileSync(join(ssDir, 'scripts', 'session-startup.sh'), readFileSync(join(proj, 'scripts', 'session-startup.sh'), 'utf8'))
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

try {
  main()
} catch (e) {
  check('e2e run', false, e.stack ?? String(e))
}
console.log(results.join('\n'))
if (keep) console.log(`E2E: kept ${root}`)
else {
  git(proj, 'worktree', 'remove', '--force', slot)
  git(proj, 'worktree', 'remove', '--force', slot2)
  try { rmSync(root, { recursive: true, force: true }) } catch { /* Windows may hold a file briefly */ }
}
const total = results.length
console.log(failed ? `E2E_CHECK: FAIL — ${failed} of ${total} cases failed` : `E2E_CHECK: ok — ${total} cases passed`)
process.exit(failed ? 1 : 0)
