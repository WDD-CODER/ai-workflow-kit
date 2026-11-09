// Plan 068: after a gate env-fail, the environment check probes the failed command's own precondition; a command with
// none parks at once. The probe itself (the installed orch-preflight.mjs --env-only) runs here in a throw-away folder.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'path'
import { writeFileSync, mkdirSync, mkdtempSync, cpSync, rmSync, existsSync, readFileSync } from 'fs'
import { spawnSync } from 'child_process'
import { tmpdir } from 'os'
import { fileURLToPath, pathToFileURL } from 'url'
import { makeProject, toyPlan } from './lib/run-plans-fixture.mjs'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const root = process.env.ORCH_ROOT ? resolve(process.env.ORCH_ROOT) : kit

// The env check's answer, with the probe results the real preflight prints for each --probe command.
const preflight = (probes, problems = []) => (cmd) => (cmd.includes('orch-preflight.mjs --env-only')
  ? `ORCH_JSON ${JSON.stringify({ ok: problems.length === 0, problems, probes, ...(problems.length ? { envFailure: true } : {}) })}`
  : undefined)

// ---- the probe itself: the installed orch-preflight.mjs, run in a throw-away project folder ----------------------------
function probeProject({ modules = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'orch-probe-'))
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true }) // with scripts/node_modules: the libs import picomatch
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'p', scripts: { test: 'node -e 0' } }))
  if (modules) mkdirSync(join(dir, 'node_modules'))
  writeFileSync(join(dir, 'scripts', 'here.mjs'), '')
  return dir
}
const probeRunWith = (dir, extra, cmds) => spawnSync(process.execPath, [join(dir, 'scripts', 'orch-preflight.mjs'), '--env-only', ...extra, ...cmds.flatMap((c) => ['--probe', c])], { cwd: dir, encoding: 'utf8', env: { ...process.env, ORCH_FREE_GB: '999', DB_PORT: '' }, timeout: 60000 }).stdout
const probeRun = (dir, ...cmds) => probeRunWith(dir, [], cmds)
const probeRunIn = (dir, gateDir, ...cmds) => probeRunWith(dir, ['--probe-dir', gateDir], cmds)
const json = (out) => JSON.parse(/^ORCH_JSON (.*)$/m.exec(out)[1])
const drop = (dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })

test('probe: node <file> is OK when the file exists, FAIL with the path when it does not; other commands have no precondition', () => {
  const dir = probeProject()
  try {
    const missing = probeRun(dir, 'node scripts/missing.mjs')
    assert.match(missing, /^FAIL probe: node scripts\/missing\.mjs — scripts\/missing\.mjs not found in the root folder$/m)
    assert.equal(json(missing).probes[0].status, 'FAIL')
    assert.equal(json(missing).envFailure, true)
    assert.match(probeRun(dir, 'node scripts/here.mjs'), /^OK\s+probe node scripts\/here\.mjs$/m)
    const none = probeRun(dir, 'git status')
    assert.match(none, /^SKIP probe: no precondition — git status$/m)
    assert.deepEqual(json(none).probes, [{ command: 'git status', status: 'SKIP', why: 'no precondition' }])
    assert.match(probeRun(dir, 'node ../outside.mjs'), /^SKIP probe: no precondition/m, 'a path outside the root is never looked up')
  } finally {
    drop(dir)
  }
})

test('probe: npm|pnpm run <name> needs the script in package.json and node_modules', () => {
  const dir = probeProject()
  const bare = probeProject({ modules: false })
  try {
    assert.match(probeRun(dir, 'npm run test'), /^OK\s+probe npm run test$/m)
    assert.match(probeRun(dir, 'pnpm run test'), /^OK\s+probe pnpm run test$/m)
    assert.match(probeRun(dir, 'npm run nope'), /^FAIL probe: npm run nope — package\.json has no script nope$/m)
    assert.match(probeRun(bare, 'npm run test'), /^FAIL probe: npm run test — node_modules is missing/m)
    const two = json(probeRun(dir, 'npm run test', 'git status'))
    assert.deepEqual(two.probes.map((p) => p.status), ['OK', 'SKIP'])
  } finally {
    drop(dir)
    drop(bare)
  }
})

test('probe --probe-dir: node <file> is OK when the file exists only in the folder the gate ran in, FAIL when in neither', () => {
  const dir = probeProject()
  const gateDir = mkdtempSync(join(tmpdir(), 'orch-probe-gate-'))
  try {
    mkdirSync(join(gateDir, 'tools'))
    writeFileSync(join(gateDir, 'tools', 'x.mjs'), '')
    assert.match(probeRunIn(dir, gateDir, 'node tools/x.mjs'), /^OK\s+probe node tools\/x\.mjs$/m)
    assert.match(probeRun(dir, 'node tools/x.mjs'), /^FAIL probe: node tools\/x\.mjs — tools\/x\.mjs not found in the root folder$/m, 'without --probe-dir the root folder is searched')
    assert.match(probeRunIn(dir, gateDir, 'node tools/y.mjs'), /^FAIL probe: node tools\/y\.mjs — tools\/y\.mjs not found in the folder the gate ran in$/m)
    assert.match(probeRunIn(dir, 'relative/dir', 'node scripts/here.mjs'),/^OK\s+probe node scripts\/here\.mjs$/m, 'a relative folder falls back to the root folder')
  } finally {
    drop(dir)
    drop(gateDir)
  }
})

// ---- plan 103: ensure-env, the environment retry, state retries, git retries, git longpaths ----------------------------
const libUrl = (f) => pathToFileURL(join(root, 'scripts', 'lib', f)).href
const folders = await import(libUrl('orch-folders.mjs'))
const merge = await import(libUrl('plan-merge.mjs'))
const gate = await import(libUrl('plan-gate.mjs'))

// A scratch project: root, server/ and scripts/ each with a package.json and a lockfile.
function envProject() {
  const dir = mkdtempSync(join(tmpdir(), 'orch-env-'))
  for (const f of ['.', 'server', 'scripts']) {
    mkdirSync(join(dir, f), { recursive: true })
    writeFileSync(join(dir, f, 'package.json'), '{"name":"x"}')
    writeFileSync(join(dir, f, 'package-lock.json'), `{"lockfileVersion":3,"f":"${f}"}`)
  }
  return dir
}
// An install that works: it makes node_modules in the folder it runs in and is logged.
const fakeInstall = (log, status = 0) => (cwd, cmd, args) => {
  log.push({ cwd, cmd, args })
  if (status === 0) mkdirSync(join(cwd, 'node_modules'), { recursive: true })
  return { status, out: '', err: status ? 'npm ERR! boom' : '' }
}

test('103 (a) ensure-env installs the root, server/ and scripts/ when their packages are missing, and skips every tree whose lockfile hash is unchanged', () => {
  const dir = envProject()
  try {
    const log = []
    const first = folders.ensureEnv({ folder: dir, serverRoot: 'server/', runner: fakeInstall(log) })
    assert.equal(first.ok, true)
    assert.deepEqual(first.installed.sort(), ['.', 'scripts', 'server'])
    assert.ok(log.every((c) => c.cmd === 'npm' && c.args[0] === 'ci'), 'with the lockfile: npm ci')
    for (const m of ['.last-npm-install-hash', '.last-npm-install-hash-server', '.last-npm-install-hash-scripts']) assert.ok(existsSync(join(dir, '.claude', m)), m)
    const again = folders.ensureEnv({ folder: dir, serverRoot: 'server/', runner: fakeInstall(log) })
    assert.deepEqual(again.installed, [])
    assert.equal(log.length, 3, 'nothing installed twice')
    writeFileSync(join(dir, 'server', 'package-lock.json'), '{"lockfileVersion":3,"changed":true}')
    assert.deepEqual(folders.ensureEnv({ folder: dir, serverRoot: 'server/', runner: fakeInstall(log) }).installed, ['server'])
    rmSync(join(dir, 'node_modules'), { recursive: true })
    assert.deepEqual(folders.ensureEnv({ folder: dir, serverRoot: 'server/', runner: fakeInstall(log) }).installed, ['.'], 'packages gone: installed although the hash matches')
  } finally {
    drop(dir)
  }
})

test('103 (a) a failed install is reported; a project without server/ installs two trees', () => {
  const dir = envProject()
  try {
    const r = folders.ensureEnv({ folder: dir, serverRoot: '', runner: fakeInstall([], 1) })
    assert.equal(r.ok, false)
    assert.match(r.lines.join('\n'), /install in \. failed: npm ERR! boom/)
    const log = []
    folders.ensureEnv({ folder: dir, serverRoot: '', runner: fakeInstall(log) })
    assert.equal(log.length, 2, 'root and scripts/ only')
  } finally {
    drop(dir)
  }
})

test('103 (b) a gate command that fails with an environment error runs ensure-env (a clean reinstall of the failing tree) before its one retry', async () => {
  const dir = envProject()
  try {
    writeFileSync(join(dir, 'tree.mjs'), "import { existsSync } from 'node:fs'; if (existsSync('server/node_modules')) process.exit(0); console.error(\"'ng' is not recognized as an internal or external command (server/node_modules)\"); process.exit(1)\n")
    const log = []
    const seen = []
    const g = await gate.runGate({
      folder: dir, commands: ['node tree.mjs'], receipt: false,
      beforeRetry: (command, r) => {
        seen.push(command)
        const tree = folders.failingTree(r.out, ['.', 'server', 'scripts'])
        assert.equal(tree, 'server', 'the output names the failing tree')
        folders.ensureEnv({ folder: dir, serverRoot: 'server/', clean: true, only: [tree], runner: fakeInstall(log) })
      },
    })
    assert.deepEqual(seen, ['node tree.mjs'])
    assert.equal(g.status, 'pass', 'the retry passes after the reinstall')
    assert.deepEqual(g.flaky, ['node tree.mjs'])
    assert.deepEqual(log.map((c) => c.cwd), [join(dir, 'server')], 'only the failing tree was reinstalled')
    assert.match("'ng' is not recognized as an internal or external command", gate.ENV_FAIL_RE)
    const removed = []
    mkdirSync(join(dir, 'server', 'node_modules'), { recursive: true })
    folders.ensureEnv({ folder: dir, serverRoot: 'server/', clean: true, only: ['server'], runner: fakeInstall([]), remove: (p) => removed.push(p) })
    assert.deepEqual(removed, [join(dir, 'server', 'node_modules')], 'a clean reinstall removes node_modules first')
  } finally {
    drop(dir)
  }
})

test('103 (b) a clean reinstall deletes no tree for a failure that is not about packages, and a failed remove or install is reported, not thrown', () => {
  const trees = ['.', 'server', 'scripts']
  for (const out of ['getaddrinfo ENOTFOUND registry.npmjs.org', 'connect ECONNREFUSED 127.0.0.1:27017', 'listen EADDRINUSE: address already in use :::4200']) {
    assert.equal(folders.failingTree(out, trees), null, `no tree for: ${out}`)
  }
  // A database or port failure whose stack trace passes through node_modules is still not a package failure.
  assert.equal(folders.failingTree('MongoServerSelectionError: connect ECONNREFUSED 127.0.0.1:27017\n    at Topology (/p/server/node_modules/mongodb/lib/sdam/topology.js:1:1)', trees), null)
  assert.equal(folders.failingTree('Error: listen EADDRINUSE :::3000\n    at Server (/p/server/node_modules/express/lib/application.js:1:1)', trees), null)
  // The tree comes from the line that says packages are missing, not from a test name elsewhere in the output.
  assert.equal(folders.failingTree("not ok 1 - server/api.test.mjs\nError: Cannot find module 'picomatch'", trees), '.')
  assert.equal(folders.failingTree("Error: Cannot find module 'picomatch'", trees), '.')
  assert.equal(folders.failingTree("Cannot find package 'mongodb' imported from server/src/db.js", trees), 'server')
  const dir = envProject()
  try {
    mkdirSync(join(dir, 'server', 'node_modules'), { recursive: true })
    let r
    assert.doesNotThrow(() => {
      r = folders.ensureEnv({ folder: dir, serverRoot: 'server/', clean: true, only: ['server'], runner: fakeInstall([]), remove: () => { throw new Error('EBUSY: resource busy or locked, unlink esbuild.exe') } })
    })
    assert.equal(r.ok, false)
    assert.match(r.lines.join('\n'), /could not remove server node_modules: EBUSY/)
    assert.doesNotThrow(() => {
      r = folders.ensureEnv({ folder: dir, serverRoot: 'server/', clean: true, only: ['server'], runner: () => { throw new Error('spawn npm ENOENT') }, remove: () => {} })
    })
    assert.equal(r.ok, false)
    assert.match(r.lines.join('\n'), /install in server failed: .*ENOENT/)
  } finally {
    drop(dir)
  }
})

test('103 (b) the merge step calls ensure before its checks and, clean, before a check\'s retry', () => {
  const src = readFileSync(join(root, 'scripts', 'lib', 'plan-merge.mjs'), 'utf8')
  assert.match(src, /ensure\(false\)/)
  assert.match(src, /beforeRetry: ensure \? \(command, r\) => ensure\(true, command, r\)/)
})

test('103 (c) an orch-state answer without ORCH_JSON is asked again up to 3 times, 2 s apart, for read commands and commands safe to repeat; any other command fails at once', () => {
  const sleeps = []
  const mk = (answers) => {
    const calls = []
    return { calls, spawn: (argv) => { calls.push(argv); return answers[Math.min(calls.length - 1, answers.length - 1)] } }
  }
  const none = { status: 1, stdout: 'nothing', stderr: 'boom' }
  const good = { status: 0, stdout: `x\nORCH_JSON ${JSON.stringify({ ok: true, v: 7 })}\n`, stderr: '' }
  for (const cmd of ['order', 'scripts', 'context', 'plan-info', 'diff', 'set', 'touch']) {
    const m = mk([none, none, good])
    const r = merge.orchState('/r', [cmd, '--run=x'], { spawn: m.spawn, sleep: (ms) => sleeps.push(ms) })
    assert.equal(r.ok, true, cmd)
    assert.equal(r.v, 7)
    assert.equal(m.calls.length, 3, `${cmd}: the third run answers`)
  }
  assert.ok(sleeps.every((ms) => ms === 2000), '2 s apart')
  const m = mk([none])
  const r = merge.orchState('/r', ['order'], { spawn: m.spawn, sleep: () => {} })
  assert.equal(r.ok, false)
  assert.equal(m.calls.length, 3, 'three runs, then it fails')
  assert.match(r.error, /orch-state order gave no answer/)
  for (const cmd of ['init', 'finish', 'merge-verify', 'park', 'decisions', 'handoff']) {
    const one = mk([none, good])
    assert.equal(merge.orchState('/r', [cmd], { spawn: one.spawn, sleep: () => {} }).ok, false, cmd)
    assert.equal(one.calls.length, 1, `${cmd} fails as before`)
  }
  assert.equal(merge.stateRepeatable(['note', '--text=x']), false)
  assert.equal(merge.stateRepeatable(['note', '--id=5', '--text=x']), true)
})

test('103 (d) git fetch and git push are retried up to 3 times, 5 s apart, on a transient error; other errors and other commands run once', () => {
  const sleeps = []
  const run = (cmdArgs, errs) => {
    let n = 0
    const r = folders.retryGit('/w', cmdArgs, { exec: () => { const e = errs[Math.min(n, errs.length - 1)]; n++; return { status: e ? 1 : 0, out: '', err: e } }, sleep: (ms) => sleeps.push(ms) })
    return { r, n }
  }
  assert.equal(run(['fetch', 'origin'], ['error: incorrect old value provided', '']).n, 2)
  assert.equal(run(['push', 'origin', 'x'], ['cannot lock ref', 'cannot lock ref', '']).r.status, 0)
  assert.equal(run(['fetch'], ['fatal: unable to access https://x: Could not resolve host: github.com']).n, 3, 'three runs, then the last answer')
  assert.deepEqual([...new Set(sleeps)], [5000])
  assert.equal(run(['fetch'], ['fatal: bad object']).n, 1, 'not transient')
  assert.equal(run(['merge', 'x'], ['cannot lock ref']).n, 1, 'not fetch or push')
})

test('103 (d) a real push refused once with "cannot lock ref" is retried and lands on park/<run>-<NNN>', () => {
  const base = mkdtempSync(join(tmpdir(), 'orch-push-'))
  try {
    const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' })
    const origin = join(base, 'o.git')
    sh(base, 'init', '-q', '--bare', origin)
    const wk = join(base, 'w')
    sh(base, 'init', '-q', '-b', 'main', wk)
    sh(wk, 'config', 'user.name', 't')
    sh(wk, 'config', 'user.email', 't@e.invalid')
    writeFileSync(join(wk, 'a.txt'), 'a')
    sh(wk, 'add', '-A')
    sh(wk, 'commit', '-q', '-m', 'a')
    sh(wk, 'remote', 'add', 'origin', origin)
    const seen = join(base, 'seen').replace(/\\/g, '/')
    writeFileSync(join(origin, 'hooks', 'pre-receive'), `#!/bin/sh\nif [ ! -f "${seen}" ]; then : > "${seen}"; echo "cannot lock ref 'refs/heads/park/x-1'" >&2; exit 1; fi\nexit 0\n`, { mode: 0o755 })
    const r = folders.retryGit(wk, ['push', '--quiet', 'origin', 'HEAD:refs/heads/park/x-1'], { sleep: () => {} })
    assert.equal(r.status, 0, r.err)
    assert.match(sh(wk, 'ls-remote', 'origin', 'refs/heads/park/x-1').stdout, /refs\/heads\/park\/x-1/)
  } finally {
    drop(base)
  }
})

// ---- (h) git longpaths --------------------------------------------------------------------------------------------------
test('103 (h) git longpaths: repaired, already true, not Windows, and a failed set', () => {
  const dir = probeProject()
  const g = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' })
  g('init', '-q')
  const longRun = (platform) => spawnSync(process.execPath, [join(dir, 'scripts', 'orch-preflight.mjs'), '--env-only'], { cwd: dir, encoding: 'utf8', env: { ...process.env, ORCH_FREE_GB: '999', DB_PORT: '', ORCH_PLATFORM: platform }, timeout: 60000 }).stdout
  try {
    assert.match(longRun('win32'), /^OK\s+git longpaths \(set to true\)$/m)
    assert.equal(g('config', '--get', 'core.longpaths').stdout.trim(), 'true', 'the repository config holds it')
    assert.match(longRun('win32'), /^OK\s+git longpaths$/m)
    assert.match(longRun('linux'), /^SKIP\s+git longpaths: not Windows$/m)
    g('config', '--unset', 'core.longpaths')
    writeFileSync(join(dir, '.git', 'config.lock'), '') // git cannot write the config now
    const out = longRun('win32')
    assert.match(out, /^FAIL\s+git longpaths: run git config core\.longpaths true in .+$/m)
    assert.equal(json(out).ok, false)
  } finally {
    drop(dir)
  }
})

// ---- (f) end to end: each plan passes its own gate, the final gate on the run branch fails on one plan's file ---------
// scripts/final-check.mjs (the project's ciMirror) passes in a plan's folder and fails only in the run's merge folder
// (the final gate), so it stands for a check only the whole run branch breaks. Its output names one plan's file, so
// exactly one merged plan is blamed. Pair 801/802: it fails while src/801.txt holds a single round; the blamed plan's
// fix round adds a second round line, the re-merge passes the second final gate. Pair 811/812: it fails whatever the
// rounds, so the second final gate fails too and the run stops.
const FINAL_CHECK = [
  "import { existsSync, readFileSync } from 'node:fs'",
  "const inRunBranch = /-orch-merge-/.test(process.cwd().replace(/\\\\/g, '/'))",
  "const lines = (f) => readFileSync(f, 'utf8').trim().split('\\n').length",
  "if (inRunBranch && existsSync('src/801.txt') && existsSync('src/802.txt') && lines('src/801.txt') < 2) { console.error('final-check: src/801.txt holds one round only'); process.exit(1) }",
  "if (inRunBranch && existsSync('src/811.txt') && existsSync('src/812.txt')) { console.error('final-check: src/811.txt is not accepted'); process.exit(1) }",
  '',
].join('\n')

function finalFixProject() {
  const p = makeProject({ kit: root, config: { ciMirror: ['node scripts/final-check.mjs'] } })
  writeFileSync(join(p.proj, 'scripts', 'final-check.mjs'), FINAL_CHECK)
  for (const a of [['add', '--', 'scripts/final-check.mjs'], ['commit', '-q', '-m', 'final check'], ['push', '-q', 'origin', 'HEAD:main']]) {
    const r = p.git(p.proj, ...a)
    assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.err ?? r.out}`)
  }
  p.addPlans({ 801: toyPlan(801), 802: toyPlan(802), 811: toyPlan(811), 812: toyPlan(812) })
  return p
}

test('103 (f) a final-gate failure that names one merged plan\'s file gives that plan one fix round, a re-merge and a second final gate that passes', () => {
  const p = finalFixProject()
  try {
    const r = p.runPlans(['--run', 'ff', '--plans', '801,802'])
    assert.equal(r.status, 0, r.out)
    assert.equal(r.json?.finalGate?.ok, true, r.out)
    assert.match(r.out, /final gate failed on node scripts\/final-check\.mjs — plan 801 changed the file it names; one fix round for plan 801/)
    const s = p.status('ff')
    for (const n of ['801', '802']) assert.equal(s.plans[n].state, 'merged', `${n}: ${r.out}`)
    const builds = (n) => r.calls.filter((c) => c.role === 'builder' && c.plan === n)
    assert.equal(builds('801').length, 2, 'the blamed plan was built once more (its fix round)')
    assert.equal(builds('802').length, 1, 'the other plan was not rebuilt')
    assert.equal(builds('801')[1].findings, true, 'the fix round carries the final gate\'s findings')
    assert.equal(p.git(p.proj, 'show', 'origin/orch/ff:src/801.txt').out.trim().split('\n').length, 2, 'the fixed plan was merged again')
  } finally {
    p.cleanup()
  }
})

test('103 (f) a second final-gate failure after the fix round stops the run, and finalGate.blamed names the plan', () => {
  const p = finalFixProject()
  try {
    const r = p.runPlans(['--run', 'ff2', '--plans', '811,812'])
    assert.notEqual(r.status, 0, r.out)
    assert.equal(r.json?.finalGate?.ok, false, r.out)
    assert.equal(r.json?.finalGate?.blamed, '811', r.out)
    assert.match(String(r.json?.stopReason ?? ''), /^final gate failed: node scripts\/final-check\.mjs/)
    assert.equal(r.calls.filter((c) => c.role === 'builder' && c.plan === '811').length, 2, 'one fix round, not two')
  } finally {
    p.cleanup()
  }
})
