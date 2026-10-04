/**
 * Take plan — claims a {{slots.nameFormat}} slot for a plan and starts its dev servers.
 * Ports the safety checks from the retired scripts/claim-parallel-slot.sh
 * into the 3-permanent-slot Planner-Worker model. See
 * plans/326-planner-worker-workflow.plan.md.
 *
 * Usage: node scripts/take-plan.mjs <NNN>
 *
 * Order matters: every check that can refuse (plan exists, scope block fenced,
 * clean tree, slot free, ports usable) runs BEFORE the claim (branch + commit),
 * so a refusal never leaves a half-claimed slot. A failure after the claim
 * (prepare step, server start) is resumable: re-run with the same NNN.
 *
 * Never deletes uncommitted work and never force-switches. This slot's own
 * servers keep running from plan to plan (they reload as files change) and are
 * restarted only when an npm install ran. Unrecorded leftover dev servers on the
 * slot's reserved ports are stopped; any other program there is refused.
 * Exit 1 + message on every refusal.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, openSync } from 'fs'
import { createHash } from 'crypto'
import { execFileSync, spawn } from 'child_process'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { isSlot, slotNumber, ports, listSlots } from './lib/slot.mjs'
import { extractScopeGlobs } from './lib/plan-scope.mjs'
import { portState, killTree, waitForPort, waitForPortFree, tail, readSlotPids, writeSlotPids, stopSlotServers } from './lib/slot-procs.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const GIT_BASH = '{{hooks.shellPath}}'
const isWin = process.platform === 'win32'
// Optional npm script run before the servers start (e.g. code generation the backend imports). Empty = skip.
const SLOT_PREPARE = '{{commands.slotPrepare}}'
// [backup script, restore script] for the isolated-DB seed. Empty = skip.
const DB_SCRIPTS = [{{commands.dbBackup|quoted}}].filter(Boolean)
const START_TIMEOUT_MS = { be: 90000, fe: 180000 }

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

// Server logs under .claude/ are runtime noise, never work - they must not make the slot look dirty.
function isDirty() {
  return tryGit(['status', '--porcelain'])
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/^\?\? \.claude\/[^/]+\.log$/.test(l.trim()))
    .length > 0
}

function npmInstallIfChanged(dir, hashFileName) {
  const lockPath = join(dir, 'package-lock.json')
  if (!existsSync(lockPath)) return false
  const hashPath = join(repoRoot, '.claude', hashFileName)
  const newHash = createHash('sha256').update(readFileSync(lockPath)).digest('hex')
  const oldHash = existsSync(hashPath) ? readFileSync(hashPath, 'utf8').trim() : null
  if (newHash === oldHash) return false

  execFileSync(isWin ? 'npm.cmd' : 'npm', ['install'], { cwd: dir, stdio: 'ignore', shell: isWin })
  mkdirSync(dirname(hashPath), { recursive: true })
  writeFileSync(hashPath, newHash)
  return true
}

// Any existing Status: line (even an empty one) becomes "Status: active"; otherwise one is added under the title.
function updateStatusActive(planAbsPath) {
  const text = readFileSync(planAbsPath, 'utf8')
  const updated = /^Status:.*$/m.test(text)
    ? text.replace(/^Status:.*$/m, 'Status: active')
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
  if (DB_SCRIPTS.length < 2) return { seeded: false, error: 'commands.dbBackup is not configured; skipping DB seed' }
  const [backupScript, restoreScript] = DB_SCRIPTS
  const backupDir = join(repoRoot, '..', '{{project.name}}-db-backups', `wt-seed-${dbName}-${Date.now()}`)
  try {
    execFileSync('node', [backupScript, '--target=local', `--out=${backupDir}`], { cwd: repoRoot, stdio: 'pipe' })
  } catch (e) {
    return { seeded: false, error: `backup failed: ${String(e.stderr || e.message)}` }
  }
  try {
    execFileSync('node', [restoreScript, '--target=local', `--dir=${backupDir}`, `--db=${dbName}`], { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' })
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

// Project shape: dev-server steps run only for the parts this project has.
const hasServer = existsSync(join(repoRoot, 'server', 'package.json'))
const envLocalPath = join(repoRoot, 'src', 'environments', 'environment.local.ts')
const hasFrontend = existsSync(envLocalPath) // the per-slot frontend config is what the dev server runs against

function generateEnvironmentSlot(bePort) {
  const localPath = envLocalPath
  const text = readFileSync(localPath, 'utf8')
  const withApi = text
    .replace(/apiUrl:\s*'[^']*'/, `apiUrl: 'http://localhost:${bePort}'`)
    .replace(/authApiUrl:\s*'[^']*'/, `authApiUrl: 'http://localhost:${bePort}'`)
  writeFileSync(join(repoRoot, 'src', 'environments', 'environment.slot.ts'), withApi)
}

// --- (a) not a slot -> refuse, and say where to go ----------------------------
if (!isSlot()) {
  const free = listSlots().filter((s) => !s.plan)
  const where = free.length
    ? ` Free slots: ${free.map((s) => `wt-${s.slot} (${s.path})`).join(', ')}. Open the session in one of those folders and run it there.`
    : ' No free slot right now - ask the Human which slot to use.'
  fail(`not a slot - this checkout is not a {{slots.nameFormat}} worktree.${where}`)
}

const arg = process.argv[2]
if (!arg) fail('usage: node scripts/take-plan.mjs <NNN>')
const nnn = /^\d+$/.test(arg) ? arg.padStart(3, '0') : arg // 1 -> 001, matching plans/NNN-*.plan.md

const n = slotNumber()
const { fe: fePort, be: bePort } = ports()

// --- (b) fetch + locate and validate the plan on origin/{{git.mainBranch}} ----------------
git(['fetch', 'origin', '--prune'])

const remotePlanRe = new RegExp(`^plans/${nnn}-[^/]+\\.plan\\.md$`)
const match = tryGit(['ls-tree', '-r', 'origin/{{git.mainBranch}}', '--name-only', '--', 'plans/'])
  .split('\n')
  .find(p => remotePlanRe.test(p))

if (!match) fail(`plans/${nnn}-*.plan.md not found on origin/{{git.mainBranch}}`)

const slug = match.replace(/^plans\/\d+-/, '').replace(/\.plan\.md$/, '')
const branchName = `feat/${nnn}-${slug}`

// Same parser as scope-check.mjs: without a readable scope every scope check fails after the claim.
const remotePlanText = tryGit(['show', `origin/{{git.mainBranch}}:${match}`])
if (!extractScopeGlobs(remotePlanText)) {
  fail(`${match} has no readable scope under "## Read-Write Scope" (need a \`\`\`scope block or a **Scope:** list of \`globs\`) - the Planner must fix the plan on {{git.mainBranch}} (see the save-plan skill). Nothing was claimed.`)
}

// --- (c) safety: refuse dirty; resume our own claim; release a merged feat/* branch
if (isDirty()) {
  fail('uncommitted or untracked changes present in this slot - refusing to touch it; commit, stash, or ask the Human')
}

const currentBranch = tryGit(['branch', '--show-current'])
const worktreePlanPath = join(repoRoot, '.worktree-plan')
const resuming = currentBranch === branchName

if (resuming) {
  console.log(`TAKE_PLAN: resuming ${branchName} (already claimed in this slot)`)
} else if (currentBranch && currentBranch.startsWith('feat/')) {
  const merged = isAncestorOfMain(currentBranch)
  // A squash merge is never an ancestor; its deleted remote branch is the signal. Keep the local branch then.
  const upstreamGone = !merged && tryGit(['for-each-ref', '--format=%(upstream:track)', `refs/heads/${currentBranch}`]) === '[gone]'
  if (merged || upstreamGone) {
    // The slot's own servers keep running: they reload as the branch's files change (restarted below only when deps changed).
    git(['switch', '--detach', 'origin/{{git.mainBranch}}'])
    if (merged) git(['branch', '-D', currentBranch])
    if (existsSync(worktreePlanPath)) unlinkSync(worktreePlanPath)
    console.log(`TAKE_PLAN: released ${currentBranch} (${merged ? 'merged' : 'remote branch deleted, local branch kept'}) - slot wt-${n} now idle`)
  } else {
    const heldPlan = existsSync(worktreePlanPath)
      ? readFileSync(worktreePlanPath, 'utf8').replace(/\r?\n+$/, '').trim()
      : currentBranch
    fail(`slot wt-${n} is busy with ${heldPlan} (branch ${currentBranch}, not yet merged) - refusing`)
  }
}

// --- (d) ports, before the claim: keep this slot's own servers, stop leftovers, refuse others
const halves = [['be', bePort, hasServer], ['fe', fePort, hasFrontend]].filter(([, , present]) => present)
const running = new Set()
for (const [label, port] of halves) {
  const st = portState(port, readSlotPids())
  if (st.ours) {
    running.add(label)
    continue
  }
  if (st.foreign) fail(`port ${port} is held by PID ${st.pid} (${st.cmd.slice(0, 80)}), which is not a dev server - refusing; free the port and re-run`)
  if (st.stale) {
    killTree(st.pid)
    console.log(`TAKE_PLAN: stopped leftover dev server PID ${st.pid} on port ${port}`)
  }
  if (!waitForPortFree(port, 10000)) fail(`port ${port} is still busy after stopping its leftover server - run node scripts/slot-stop.mjs, then re-run`)
}

// --- (e) claim: branch + .worktree-plan + Status: active ----------------------
const planAbs = join(repoRoot, match)
if (!resuming) {
  git(['switch', '-c', branchName, 'origin/{{git.mainBranch}}'])
  updateStatusActive(planAbs)
  git(['add', match])
  // The Planner may have saved the plan as "Status: active" already - then there is nothing to commit.
  if (tryGit(['diff', '--cached', '--name-only'])) git(['commit', '-m', `chore(plan ${nnn}): mark active in wt-${n}`])
}
writeFileSync(worktreePlanPath, `${match}\n`)

// --- (f) npm install only if the lockfile changed -----------------------------
const rootInstalled = npmInstallIfChanged(repoRoot, '.last-npm-install-hash')
const serverInstalled = hasServer && npmInstallIfChanged(join(repoRoot, 'server'), '.last-npm-install-hash-server')

// Kept servers run on the old dependencies after an install: restart them.
if ((rootInstalled || serverInstalled) && running.size) {
  for (const l of stopSlotServers()) console.log(`TAKE_PLAN: dependencies changed - ${l}`)
  for (const [, port] of halves) waitForPortFree(port, 10000)
  running.clear()
}

// --- (g) environment.slot.ts + optional prepare step --------------------------
if (existsSync(envLocalPath)) generateEnvironmentSlot(bePort)

const resumeHint = `The slot is claimed; fix the cause and re-run: node scripts/take-plan.mjs ${nnn}`
if (SLOT_PREPARE) {
  try {
    execFileSync(isWin ? 'npm.cmd' : 'npm', ['run', SLOT_PREPARE], { cwd: repoRoot, stdio: 'pipe', shell: isWin, encoding: 'utf8' })
    console.log(`TAKE_PLAN: prepare: npm run ${SLOT_PREPARE} ok`)
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`.replace(/\r\n/g, '\n').trimEnd().split('\n').slice(-20).join('\n')
    fail(`prepare step "npm run ${SLOT_PREPARE}" failed - servers not started.\n${out}\n${resumeHint}`)
  }
}

// --- (h) start what is not running, then wait until each port listens --------
const planText = readFileSync(planAbs, 'utf8')
const pids = readSlotPids() // kept servers stay recorded
const started = []
mkdirSync(join(repoRoot, '.claude'), { recursive: true })

for (const [label, port] of halves) {
  if (running.has(label)) continue
  const logPath = join(repoRoot, '.claude', `${label}.log`)
  const logFd = openSync(logPath, 'w')
  let child
  if (label === 'be') {
    const env = { ...process.env, PORT: String(bePort), ALLOWED_ORIGIN: `http://localhost:${fePort}` }
    if (isIsolatedDb(planText) && process.env.MONGO_LOCAL_URI) {
      env.MONGO_LOCAL_URI = withDbName(process.env.MONGO_LOCAL_URI, `{{slots.dbNameFormat}}`)
    }
    child = spawn(isWin ? 'npm.cmd' : 'npm', ['run', 'dev:local'], {
      cwd: join(repoRoot, 'server'),
      shell: isWin,
      env,
      detached: true,
      stdio: ['ignore', logFd, logFd]
    })
  } else {
    child = spawn(isWin ? 'npx.cmd' : 'npx', ['ng', 'serve', '-c', 'slot', '--port', String(fePort)], {
      cwd: repoRoot,
      shell: isWin,
      detached: true,
      stdio: ['ignore', logFd, logFd]
    })
  }
  child.unref()
  pids.push(child.pid)
  started.push([label, port, logPath])
}
writeSlotPids(pids)

for (const [label, port, logPath] of started) {
  const owner = waitForPort(port, START_TIMEOUT_MS[label])
  if (!owner) {
    fail(`${label} server is not listening on port ${port} after ${START_TIMEOUT_MS[label] / 1000}s. Last lines of ${logPath}:\n${tail(logPath) || '(log is empty)'}\n${resumeHint}`)
  }
  pids.push(owner) // the real port owner, so a later run recognises it even if the launcher shell is gone
}
writeSlotPids(pids)
if (started.length) console.log(`TAKE_PLAN: servers listening: ${started.map(([l, p]) => `${l}=${p}`).join(' ')}`)

// --- (i) isolated DB seed (advisory, best-effort) -----------------------------
let dbLabel = 'shared'
if (isIsolatedDb(planText)) {
  dbLabel = `{{slots.dbNameFormat}}`
  const result = seedIsolatedDbIfEmpty(dbLabel)
  if (result.seeded) console.log('TAKE_PLAN: db: seeded')
  else if (result.alreadySeeded) console.log('TAKE_PLAN: db: already seeded')
  else console.log(`TAKE_PLAN: db: seed skipped (${result.error})`)
}

// --- (j) claim liveness lock --------------------------------------------------
claimLock(repoRoot)

// --- (k) final report ----------------------------------------------------------
console.log(`OK plan=${nnn} branch=${branchName} fe=${fePort} be=${bePort} db=${dbLabel}`)
try {
  execFileSync('node', ['scripts/scope-check.mjs', '--drift', `--plan=${match}`], { cwd: repoRoot, stdio: 'inherit' })
} catch {
  // scope-check.mjs already printed REALITY: drift and exited 1 - not a take-plan failure.
}
