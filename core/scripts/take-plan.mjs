/**
 * Take plan — claims a {{slots.nameFormat}} slot for a plan and starts its dev servers.
 * Ports the safety checks from the retired scripts/claim-parallel-slot.sh
 * into the 3-permanent-slot Planner-Worker model. See
 * plans/326-planner-worker-workflow.plan.md.
 *
 * Usage: node scripts/take-plan.mjs <NNN>
 *
 * Never deletes uncommitted work, never force-switches, never kills a
 * process it didn't start. Exit 1 + message on every refusal.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, openSync } from 'fs'
import { createHash } from 'crypto'
import { execFileSync, spawn } from 'child_process'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { isSlot, slotNumber, ports } from './lib/slot.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const GIT_BASH = '{{hooks.shellPath}}'

function fail(message) {
  console.error(`TAKE_PLAN: ${message}`)
  process.exit(1)
}

function git(cmdArgs) {
  return execFileSync('git', cmdArgs, { cwd: repoRoot, encoding: 'utf8' }).replace(/\r?\n+$/, '')
}

function tryGit(cmdArgs) {
  try {
    return git(cmdArgs)
  } catch {
    return ''
  }
}

function isAncestorOfMain(ref) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ref, 'origin/{{git.mainBranch}}'], { cwd: repoRoot, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function isDirty() {
  return tryGit(['status', '--porcelain']).trim().length > 0
}

function npmInstallIfChanged(dir, hashFileName) {
  const lockPath = join(dir, 'package-lock.json')
  if (!existsSync(lockPath)) return false
  const hashPath = join(repoRoot, '.claude', hashFileName)
  const newHash = createHash('sha256').update(readFileSync(lockPath)).digest('hex')
  const oldHash = existsSync(hashPath) ? readFileSync(hashPath, 'utf8').trim() : null
  if (newHash === oldHash) return false

  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install'], { cwd: dir, stdio: 'ignore', shell: process.platform === 'win32' })
  mkdirSync(dirname(hashPath), { recursive: true })
  writeFileSync(hashPath, newHash)
  return true
}

function portOwnerPid(port) {
  try {
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' })
    for (const line of out.split(/\r?\n/)) {
      if (!/LISTENING/.test(line)) continue
      const cols = line.trim().split(/\s+/)
      const localPort = (cols[1] || '').split(':').pop()
      if (localPort === String(port)) return cols[cols.length - 1]
    }
    return null
  } catch {
    return null
  }
}

function readSlotPids() {
  const p = join(repoRoot, '.claude', '.slot-pids')
  if (!existsSync(p)) return []
  try {
    return JSON.parse(readFileSync(p, 'utf8')).pids || []
  } catch {
    return []
  }
}

function writeSlotPids(pids) {
  mkdirSync(join(repoRoot, '.claude'), { recursive: true })
  writeFileSync(join(repoRoot, '.claude', '.slot-pids'), JSON.stringify({ pids }, null, 2))
}

function updateStatusActive(planAbsPath) {
  const text = readFileSync(planAbsPath, 'utf8')
  const updated = /^Status:\s*\S+\s*$/m.test(text)
    ? text.replace(/^Status:\s*\S+\s*$/m, 'Status: active')
    : text.replace(/^(# .+\r?\n)/, '$1\nStatus: active\n')
  writeFileSync(planAbsPath, updated)
}

function isIsolatedDb(planText) {
  const m = planText.match(/^Isolated DB:\s*(yes|no)/mi)
  return Boolean(m && m[1].toLowerCase() === 'yes')
}

function withDbName(uri, dbName) {
  return uri.replace(/\/([^/?]+)(\?|$)/, `/${dbName}$2`)
}

function seedIsolatedDbIfEmpty(dbName) {
  const backupDir = join(repoRoot, '..', '{{project.name}}-db-backups', `wt-seed-${dbName}-${Date.now()}`)
  try {
    execFileSync('node', ['{{commands.dbBackup}}', '--target=local', `--out=${backupDir}`], { cwd: repoRoot, stdio: 'pipe' })
  } catch (e) {
    return { seeded: false, error: `backup failed: ${String(e.stderr || e.message)}` }
  }
  try {
    execFileSync('node', ['{{commands.dbBackup}}', '--target=local', `--dir=${backupDir}`, `--db=${dbName}`], { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' })
    return { seeded: true }
  } catch (e) {
    const msg = String(e.stdout || e.stderr || e.message || '')
    if (/already has \d+ collection/.test(msg)) return { seeded: false, alreadySeeded: true }
    return { seeded: false, error: msg }
  }
}

function claimLock(dir) {
  const lockScript = join(repoRoot, 'scripts', 'session-lock.sh').replace(/\\/g, '/')
  const target = dir.replace(/\\/g, '/')
  for (const bash of [GIT_BASH, 'bash']) {
    try {
      execFileSync(bash, ['-c', `source "${lockScript}" && claim_lock "${target}"`], { stdio: 'ignore' })
      return true
    } catch {
      continue
    }
  }
  return false
}

function generateEnvironmentSlot(bePort) {
  const localPath = join(repoRoot, 'src', 'environments', 'environment.local.ts')
  const text = readFileSync(localPath, 'utf8')
  const withApi = text
    .replace(/apiUrl:\s*'[^']*'/, `apiUrl: 'http://localhost:${bePort}'`)
    .replace(/authApiUrl:\s*'[^']*'/, `authApiUrl: 'http://localhost:${bePort}'`)
  writeFileSync(join(repoRoot, 'src', 'environments', 'environment.slot.ts'), withApi)
}

// --- (a) not a slot -> refuse -------------------------------------------------
if (!isSlot()) fail('not a slot - run this only inside a {{slots.nameFormat}} worktree')

const nnn = process.argv[2]
if (!nnn) fail('usage: node scripts/take-plan.mjs <NNN>')

const n = slotNumber()
const { fe: fePort, be: bePort } = ports()

// --- (b) safety: refuse dirty, release a merged feat/* branch ---------------
if (isDirty()) {
  fail('uncommitted or untracked changes present in this slot - refusing to touch it; commit, stash, or ask the Human')
}

const currentBranch = tryGit(['branch', '--show-current'])
const worktreePlanPath = join(repoRoot, '.worktree-plan')

if (currentBranch && currentBranch.startsWith('feat/')) {
  if (isAncestorOfMain(currentBranch)) {
    git(['switch', '--detach', 'origin/{{git.mainBranch}}'])
    git(['branch', '-D', currentBranch])
    if (existsSync(worktreePlanPath)) unlinkSync(worktreePlanPath)
    console.log(`TAKE_PLAN: released ${currentBranch} (merged) - slot wt-${n} now idle`)
  } else {
    const heldPlan = existsSync(worktreePlanPath)
      ? readFileSync(worktreePlanPath, 'utf8').replace(/\r?\n+$/, '').trim()
      : currentBranch
    fail(`slot wt-${n} is busy with ${heldPlan} (branch ${currentBranch}, not yet merged) - refusing`)
  }
}

// --- (c) fetch + locate the plan on origin/{{git.mainBranch}} ------------------------------
git(['fetch', 'origin'])

const remotePlanRe = new RegExp(`^plans/${nnn}-[^/]+\\.plan\\.md$`)
const match = tryGit(['ls-tree', '-r', 'origin/{{git.mainBranch}}', '--name-only', '--', 'plans/'])
  .split('\n')
  .find(p => remotePlanRe.test(p))

if (!match) fail(`plans/${nnn}-*.plan.md not found on origin/{{git.mainBranch}}`)

const slug = match.replace(/^plans\/\d+-/, '').replace(/\.plan\.md$/, '')
const branchName = `feat/${nnn}-${slug}`

// --- (d) branch + .worktree-plan + Status: active ----------------------------
git(['switch', '-c', branchName, 'origin/{{git.mainBranch}}'])
writeFileSync(worktreePlanPath, `${match}\n`)

const planAbs = join(repoRoot, match)
updateStatusActive(planAbs)
git(['add', match])
git(['commit', '-m', `chore(plan ${nnn}): mark active in wt-${n}`])

// --- (e) npm install only if the lockfile changed -----------------------------
const rootInstalled = npmInstallIfChanged(repoRoot, '.last-npm-install-hash')
const serverInstalled = npmInstallIfChanged(join(repoRoot, 'server'), '.last-npm-install-hash-server')

// --- (f) environment.slot.ts --------------------------------------------------
generateEnvironmentSlot(bePort)

// --- (g) ports: keep this slot's own PIDs, refuse a foreign PID --------------
const mySlotPids = readSlotPids()
const newPids = []

for (const [label, port, isBackend] of [['be', bePort, true], ['fe', fePort, false]]) {
  const ownerPid = portOwnerPid(port)
  if (ownerPid && mySlotPids.includes(Number(ownerPid))) {
    newPids.push(Number(ownerPid))
    continue
  }
  if (ownerPid) fail(`port ${port} is held by PID ${ownerPid}, which this slot did not start - refusing`)

  const planText = readFileSync(planAbs, 'utf8')
  const logPath = join(repoRoot, '.claude', `${label}.log`)
  mkdirSync(join(repoRoot, '.claude'), { recursive: true })
  const logFd = openSync(logPath, 'a')

  let child
  if (isBackend) {
    let env = { ...process.env, PORT: String(bePort), ALLOWED_ORIGIN: `http://localhost:${fePort}` }
    if (isIsolatedDb(planText) && process.env.MONGO_LOCAL_URI) {
      env.MONGO_LOCAL_URI = withDbName(process.env.MONGO_LOCAL_URI, `{{slots.dbNameFormat}}`)
    }
    child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev:local'], {
      cwd: join(repoRoot, 'server'),
      shell: process.platform === 'win32',
      env,
      detached: true,
      stdio: ['ignore', logFd, logFd]
    })
  } else {
    child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['ng', 'serve', '-c', 'slot', '--port', String(fePort)], {
      cwd: repoRoot,
      shell: process.platform === 'win32',
      detached: true,
      stdio: ['ignore', logFd, logFd]
    })
  }
  child.unref()
  newPids.push(child.pid)
}

writeSlotPids(newPids)

// --- (h) isolated DB seed (advisory, best-effort) -----------------------------
const planTextForDb = readFileSync(planAbs, 'utf8')
let dbLabel = 'shared'
if (isIsolatedDb(planTextForDb)) {
  dbLabel = `{{slots.dbNameFormat}}`
  const result = seedIsolatedDbIfEmpty(dbLabel)
  if (result.seeded) console.log('TAKE_PLAN: db: seeded')
  else if (result.alreadySeeded) console.log('TAKE_PLAN: db: already seeded')
  else console.log(`TAKE_PLAN: db: seed skipped (${result.error})`)
}

// --- (i) claim liveness lock --------------------------------------------------
claimLock(repoRoot)

// --- (j) final report ----------------------------------------------------------
console.log(`OK plan=${nnn} branch=${branchName} fe=${fePort} be=${bePort} db=${dbLabel}`)
try {
  execFileSync('node', ['scripts/scope-check.mjs', '--drift', `--plan=${match}`], { cwd: repoRoot, stdio: 'inherit' })
} catch {
  // scope-check.mjs already printed REALITY: drift and exited 1 - not a take-plan failure.
}
