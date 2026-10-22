/**
 * Take plan — claims a wt-N slot for a plan. It starts no dev servers: they are off unless a
 * step needs the running app (node scripts/slot-serve.mjs starts them on demand).
 * Ports the safety checks from the retired scripts/claim-parallel-slot.sh
 * into the 3-permanent-slot Planner-Worker model. See
 * plans/326-planner-worker-workflow.plan.md.
 *
 * Usage: node scripts/take-plan.mjs <NNN>
 *
 * Order matters: every check that can refuse (plan exists, scope block fenced,
 * clean tree, slot free, ports usable) runs BEFORE the claim (branch + commit),
 * so a refusal never leaves a half-claimed slot. A claim commit that fails (e.g. a pre-commit hook) is rolled
 * back: plan file restored, slot detached where it was, the new branch deleted. The claim is finished once the
 * branch is checked out; nothing after it (npm install, DB seed) can fail the claim. The runtime ignore rules
 * (scripts/local-excludes.mjs) are added to .git/info/exclude before the dirty check, so a fresh clone whose
 * .gitignore the project does not take from the kit is not refused for the slot's own runtime files.
 *
 * Never deletes uncommitted work and never force-switches. A branch is treated
 * as merged when it is an ancestor of main or its GitHub PR was merged
 * (squash merges included) with nothing added since; only then is it deleted
 * (with its old remote branch, so the fresh branch can be pushed). This slot's own
 * dev servers (orphaned watcher chains included) and any leftover dev server on the
 * slot's reserved ports are stopped before the claim; any other program there is refused.
 * Exit 1 + message on every refusal.
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'fs'
import { execFileSync } from 'child_process'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { isSlot, slotNumber, ports, listSlots } from './lib/slot.mjs'
import { extractScopeGlobs } from './lib/plan-scope.mjs'
import { findOpenPlanIn } from './lib/plan-paths.mjs'
import { parseInvariants, checkPlanArch } from './lib/invariants.mjs'
import { planDependencies, planTitle, planDoneReason, atomicStats } from './lib/plan-deps.mjs'
import { portState, waitForPortFree, stopSlotServers, npmInstallIfChanged, installReason, generateEnvironmentSlot, hasFrontend as projectHasFrontend, installDirs } from './lib/slot-procs.mjs'
import { ensureLocalExcludes } from './local-excludes.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const GIT_BASH = 'C:/Program Files/Git/bin/bash.exe'
// [backup script, restore script] for the isolated-DB seed. Empty = skip.
const DB_SCRIPTS = [''].filter(Boolean)

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
    execFileSync('git', ['merge-base', '--is-ancestor', ref, 'origin/main'], { cwd: repoRoot, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// gh and pushes use the stored login: a limited GITHUB_TOKEN in the env would shadow it.
const ghEnv = { ...process.env }
delete ghEnv.GITHUB_TOKEN

/**
 * PR number when the branch's work was merged on GitHub with nothing added since, else null. A squash
 * merge is never an ancestor of main, so this is the only reliable signal. null when gh is missing or offline.
 */
function mergedPrFor(branch) {
  try {
    const out = execFileSync('gh', ['pr', 'list', '--head', branch, '--state', 'merged', '--json', 'number,headRefOid', '--limit', '1'], { cwd: repoRoot, encoding: 'utf8', env: ghEnv, stdio: ['ignore', 'pipe', 'ignore'] })
    const [pr] = JSON.parse(out || '[]')
    return pr && pr.headRefOid === tryGit(['rev-parse', branch]) ? pr.number : null
  } catch {
    return null
  }
}

// Server logs under .claude/ are runtime noise, never work - they must not make the slot look dirty.
function isDirty() {
  return tryGit(['status', '--porcelain'])
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/^\?\? \.claude\/([^/]+\.log|\.slot-plan-start|logs\/)/.test(l.trim()))
    .length > 0
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

function seedIsolatedDbIfEmpty(dbName) {
  if (DB_SCRIPTS.length < 2) return { seeded: false, error: 'commands.dbBackup is not configured; skipping DB seed' }
  const [backupScript, restoreScript] = DB_SCRIPTS
  const backupDir = join(repoRoot, '..', 'ai_workflow_kit-db-backups', `wt-seed-${dbName}-${Date.now()}`)
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
const hasFrontend = projectHasFrontend() // commands.dev names a package.json script (see lib/slot-procs.mjs)

// --- (a) not a slot -> refuse, and say where to go ----------------------------
if (!isSlot()) {
  const free = listSlots().filter((s) => !s.plan)
  const where = free.length
    ? ` Free slots: ${free.map((s) => `wt-${s.slot} (${s.path})`).join(', ')}. Open the session in one of those folders and run it there.`
    : ' No free slot right now - ask the Human which slot to use.'
  fail(`not a slot - this checkout is not a wt-N worktree.${where}`)
}

const arg = process.argv[2]
if (!arg) fail('usage: node scripts/take-plan.mjs <NNN>')
const nnn = /^\d+$/.test(arg) ? arg.padStart(3, '0') : arg // 1 -> 001, matching plans/NNN-*.plan.md

const n = slotNumber()
const { fe: fePort, be: bePort } = ports()

// --- (b) fetch + locate and validate the plan on origin/main ----------------
git(['fetch', 'origin', '--prune'])

// Open plans live in plans/ or an open subfolder such as plans/design/ (lib/plan-paths.mjs).
const mainPlans = tryGit(['ls-tree', '-r', 'origin/main', '--name-only', '--', 'plans/']).split('\n')
const match = findOpenPlanIn(mainPlans, nnn)

if (!match) fail(`plans/${nnn}-*.plan.md not found on origin/main`)

const slug = match.replace(/^.*\/\d+-/, '').replace(/\.plan\.md$/, '')
const branchName = `feat/${nnn}-${slug}`

// Same parser as scope-check.mjs: without a readable scope every scope check fails after the claim.
const remotePlanText = tryGit(['show', `origin/main:${match}`])
if (!extractScopeGlobs(remotePlanText)) {
  fail(`${match} has no readable scope under "## Read-Write Scope" (need a \`\`\`scope block or a **Scope:** list of \`globs\`) - the Planner must fix the plan on main (see the save-plan skill). Nothing was claimed.`)
}

// Architecture gate (same check as `scope-check.mjs --arch --plan`), judged against origin/main so a stale
// slot checkout can't pass a plan that main's invariants registry would block. No registry -> no gate.
const registryText = tryGit(['show', 'origin/main:docs/brain/invariants.md'])
if (registryText) {
  const mainFiles = new Set(tryGit(['ls-tree', '-r', 'origin/main', '--name-only']).split('\n').filter(Boolean))
  const arch = checkPlanArch({
    planPath: match,
    planText: remotePlanText,
    scopeGlobs: extractScopeGlobs(remotePlanText),
    registry: parseInvariants(registryText),
    trackedFiles: [...mainFiles],
    adrExists: (p) => mainFiles.has(p)
  })
  if (!arch.ok) fail(`${match} fails the architecture gate - the Planner must fix its "## Architecture Impact" on main (see docs/brain/invariants.md). Nothing was claimed.\n${arch.lines.join('\n')}`)
}

// --- (c) safety, all before anything changes: dirty tree, plan order, the plan's branch, then this slot's branch
// The slot's runtime files (.worktree-*, logs, hashes) are never work, even when the project keeps its own .gitignore.
try {
  ensureLocalExcludes(repoRoot)
} catch (e) {
  console.log(`TAKE_PLAN: warning - could not update .git/info/exclude (${String(e.message).split('\n')[0]})`)
}
if (isDirty()) {
  fail('uncommitted or untracked changes present in this slot - refusing to touch it; commit, stash, or ask the Human')
}

// Plan order (scripts/lib/plan-deps.mjs, the parser plan-order and scope-check --deps use): the plan's "Depends-on:"
// line plus legacy prose ("Prerequisite: plan NNN merged", "must run after plan 7"). A dependency is merged when its
// plan is closed on main (moved out of the open folders), or lib/plan-deps.mjs planDoneReason says done there
// (Status: finished, or at least one sub-task [x] and none open — the rule plan-order uses). A Depends-on: plan with no file on main at all is not merged either; an unknown prose number is skipped.
const { deps } = planDependencies(remotePlanText, nnn)
if (!process.argv.includes('--ignore-order')) {
  for (const { nnn: p, reason } of deps) {
    const file = findOpenPlanIn(mainPlans, p)
    if (!file) {
      const closed = mainPlans.some((f) => f.endsWith('.plan.md') && f.split('/').pop().startsWith(`${p}-`))
      if (closed || reason !== 'Depends-on:') continue // closed (archived) = merged; an unknown prose number - nothing to judge
      fail(`NOT_READY: plan ${p} (no plans/${p}-*.plan.md on main) is not merged - plan ${nnn} depends on it (${reason}). Take another plan, or re-run with --ignore-order if the Human says so. Nothing was changed.`)
    }
    const prereqText = tryGit(['show', `origin/main:${file}`])
    if (planDoneReason(prereqText)) continue // the rule plan-order uses: Status: finished, or every sub-task [x]
    const st = atomicStats(prereqText)
    const left = st.open > 0 ? `${st.open} open sub-task(s)` : 'no sub-task ticked'
    fail(`NOT_READY: plan ${p} (${planTitle(prereqText) || file}) is not merged - plan ${nnn} depends on it (${reason}); ${left} on main in ${file}. Take another plan, or re-run with --ignore-order if the Human says so. Nothing was changed.`)
  }
}

const currentBranch = tryGit(['branch', '--show-current'])
const worktreePlanPath = join(repoRoot, '.worktree-plan')
const resuming = currentBranch === branchName

// The plan's own branch may already exist: taken by another slot, already merged, or left by an interrupted claim.
const holder = listSlots().find((s) => s.branch === branchName && s.slot !== n)
if (holder) fail(`plan ${nnn} is already taken by wt-${holder.slot} (branch ${branchName}) - pick another plan. Nothing was changed.`)
const leftover = !resuming && Boolean(tryGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branchName}`]))
const leftoverPr = leftover && !isAncestorOfMain(branchName) ? mergedPrFor(branchName) : null
const leftoverMerged = leftover && (Boolean(leftoverPr) || isAncestorOfMain(branchName))
if (leftoverMerged) {
  const doneWhy = planDoneReason(remotePlanText)
  if (doneWhy) fail(`plan ${nnn} is already done (${doneWhy} on main, branch ${branchName} merged) - pick another plan. Nothing was changed.`)
}

if (resuming) {
  console.log(`TAKE_PLAN: resuming ${branchName} (already claimed in this slot)`)
} else if (currentBranch) {
  const merged = isAncestorOfMain(currentBranch)
  const pr = merged ? null : mergedPrFor(currentBranch)
  // A squash merge is never an ancestor; a merged PR or a deleted remote branch is the signal.
  const upstreamGone = !merged && !pr && tryGit(['for-each-ref', '--format=%(upstream:track)', `refs/heads/${currentBranch}`]) === '[gone]'
  if (merged || pr || upstreamGone) {
    git(['switch', '--detach', 'origin/main'])
    if (merged || pr) git(['branch', '-D', currentBranch])
    if (existsSync(worktreePlanPath)) unlinkSync(worktreePlanPath)
    // An ancestor of main is merged work or an unused branch (no commits of its own) - the script cannot tell which.
    const why = pr ? `merged in PR #${pr}` : merged ? 'no commits outside main: merged or unused' : 'remote branch deleted, local branch kept'
    console.log(`TAKE_PLAN: released ${currentBranch} (${why}) - slot wt-${n} now idle`)
  } else {
    const heldPlan = existsSync(worktreePlanPath)
      ? readFileSync(worktreePlanPath, 'utf8').replace(/\r?\n+$/, '').trim()
      : currentBranch
    fail(`slot wt-${n} is busy with ${heldPlan} (branch ${currentBranch}, not yet merged) - refusing`)
  }
}

// --- (d) ports, before the claim: refuse a foreign program, then stop this slot's own servers -------
// Servers are off by default: a claim stops what this slot still runs, orphaned watchers included.
const halves = [['be', bePort, hasServer], ['fe', fePort, hasFrontend]].filter(([, , present]) => present)
for (const [, port] of halves) {
  const st = portState(port)
  if (st.foreign) fail(`port ${port} is held by PID ${st.pid} (${st.cmd.slice(0, 80)}), which is not a dev server - refusing; free the port and re-run`)
}
for (const l of stopSlotServers()) console.log(`TAKE_PLAN: ${l}`)
for (const [, port] of halves) {
  if (!waitForPortFree(port, 10000)) fail(`port ${port} is still busy after stopping this slot's servers - run node scripts/slot-stop.mjs, then re-run`)
}

// --- (e) claim: branch + .worktree-plan + Status: active ----------------------
const planAbs = join(repoRoot, match)
if (!resuming) {
  // Where the slot stood before the claim: a failed claim commit goes back here (detached), so a refusal never
  // leaves a half-claimed slot (a branch with the plan staged and no commit).
  const preClaimHead = git(['rev-parse', 'HEAD'])
  let createdBranch = false
  if (leftover && !leftoverMerged) {
    git(['switch', branchName])
    console.log(`TAKE_PLAN: reusing existing branch ${branchName} (it has commits not on main)`)
  } else {
    // Stale: nothing on it that main lacks (merged), so a failed claim below does not need it back.
    if (leftoverMerged) git(['branch', '-D', branchName])
    git(['switch', '-c', branchName, 'origin/main'])
    createdBranch = true
  }
  updateStatusActive(planAbs)
  git(['add', match])
  // The Planner may have saved the plan as "Status: active" already - then there is nothing to commit.
  if (tryGit(['diff', '--cached', '--name-only'])) {
    try {
      execFileSync('git', ['commit', '-m', `chore(plan ${nnn}): mark active in wt-${n}`], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      // Roll the claim back: unstage and restore the plan file, return to the pre-claim commit, drop the new branch.
      const why = `${e.stderr || ''}${e.stdout || ''}`.replace(/\r\n/g, '\n').trim().split('\n').slice(-5).join(' | ') || e.message
      const failed = []
      const step = (label, args) => {
        try {
          execFileSync('git', args, { cwd: repoRoot, stdio: 'ignore' })
        } catch {
          failed.push(label)
        }
      }
      step('unstage the plan file', ['reset', '-q', '--', match])
      step('restore the plan file', ['checkout', '-q', '--', match])
      step(`detach at ${preClaimHead.slice(0, 8)}`, ['switch', '-q', '--detach', preClaimHead])
      if (createdBranch) step(`delete branch ${branchName}`, ['branch', '-D', branchName])
      // Check the result instead of trusting the steps.
      const left = []
      if (tryGit(['branch', '--show-current'])) left.push(`still on branch ${tryGit(['branch', '--show-current'])}`)
      if (createdBranch && tryGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branchName}`])) left.push(`branch ${branchName} still exists`)
      if (tryGit(['status', '--porcelain', '--', match])) left.push(`${match} still changed`)
      if (left.length) {
        fail(`claim commit failed: ${why} - and the rollback is incomplete (${failed.length ? `failed: ${failed.join(', ')}; ` : ''}${left.join('; ')}). Fix by hand: git switch --detach ${preClaimHead}${createdBranch ? `, git branch -D ${branchName}` : ''}, then re-run.`)
      }
      fail(`claim commit failed: ${why} - slot wt-${n} is back to detached and idle${createdBranch ? `, branch ${branchName} removed` : ''}. Fix the hook error and re-run.`)
    }
  }
  // Only once the claim is committed: the old remote branch of a merged PR would reject the fresh branch's push.
  // GitHub keeps it restorable from the merged PR.
  if (leftoverPr && createdBranch) {
    let note = 'starting fresh'
    if (tryGit(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branchName}`])) {
      try {
        execFileSync('git', ['push', 'origin', '--delete', branchName], { cwd: repoRoot, env: ghEnv, stdio: 'ignore' })
        note = 'deleted its old remote branch, starting fresh'
      } catch {
        note = `starting fresh; its old remote branch is still there - delete it (git push origin --delete ${branchName}) before pushing`
      }
    }
    console.log(`TAKE_PLAN: ${branchName} was merged in PR #${leftoverPr} - ${note}`)
  }
}
const previousPlan = existsSync(worktreePlanPath) ? readFileSync(worktreePlanPath, 'utf8').trim() : ''
writeFileSync(worktreePlanPath, `${match}\n`)
// Records when the plan was taken, for log queries "since plan start". A resumed claim of the same plan keeps its original start.
const planStartPath = join(repoRoot, '.claude', '.slot-plan-start')
mkdirSync(join(repoRoot, '.claude'), { recursive: true })
if (previousPlan !== match || !existsSync(planStartPath)) writeFileSync(planStartPath, `${new Date().toISOString()}\n`)
// The session-state pointer belongs to the previous plan's branch; the next session start writes a fresh one.
const statePointer = join(repoRoot, '.claude', '.session-state-path')
if (existsSync(statePointer)) unlinkSync(statePointer)

// --- (f) after the claim, nothing can fail it: npm install if the lockfile changed or packages are missing
// + environment.slot.ts. A build needs the dependencies; a failed install is reported, never a refusal
// (slot-serve.mjs retries it).
for (const [dir, hashFile, label] of installDirs(repoRoot)) {
  try {
    const ran = npmInstallIfChanged(dir, hashFile)
    if (ran) console.log(`TAKE_PLAN: npm install ran in ${label} (${installReason(ran)})`)
  } catch (e) {
    const why = String(e.message).split('\n')[0]
    console.log(`TAKE_PLAN: warning - npm install failed in ${label} (${why}); slot-serve.mjs retries it`)
  }
}
generateEnvironmentSlot(bePort)

// --- (g) servers stay off -------------------------------------------------------
const planText = readFileSync(planAbs, 'utf8')
if (halves.length) console.log('TAKE_PLAN: servers: off — start them with node scripts/slot-serve.mjs')

// --- (h) isolated DB seed (advisory, best-effort) -----------------------------
let dbLabel = 'shared'
if (isIsolatedDb(planText)) {
  dbLabel = `ai_workflow_kit_wt${n}`
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
