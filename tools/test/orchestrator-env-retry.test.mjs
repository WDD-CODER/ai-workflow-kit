// Plan 068: after a gate env-fail, the environment check probes the failed command's own precondition; a command with
// none parks at once. The probe itself (the installed orch-preflight.mjs --env-only) runs here in a throw-away folder.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'path'
import { writeFileSync, mkdirSync, mkdtempSync, cpSync, rmSync } from 'fs'
import { spawnSync } from 'child_process'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'

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
