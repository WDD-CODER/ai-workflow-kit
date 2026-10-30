/**
 * Slot facts — single source of truth for the 3 permanent worktree slots
 * (wt-N (1..3)) in the Planner-Worker workflow. Shared by
 * scope-check.mjs, scope-guard.sh (via scope-check.mjs), ship-prep.mjs,
 * take-plan.mjs and session-startup.sh (via --describe).
 * See plans/326-planner-worker-workflow.plan.md.
 *
 * Usage:
 *   node scripts/lib/slot.mjs --describe
 *   node scripts/lib/slot.mjs --list
 *   node scripts/lib/slot.mjs --scoped-plan   the plan whose scope governs this folder (empty line: none)
 */
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs'
import { execFileSync } from 'child_process'
import { resolve, dirname, join, basename } from 'path'
import { fileURLToPath } from 'url'
import { findOpenPlan } from './plan-paths.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..', '..')

function git(cmdArgs, cwd) {
  try {
    return execFileSync('git', cmdArgs, { cwd: cwd || repoRoot, encoding: 'utf8' }).replace(/\r?\n+$/, '')
  } catch {
    return ''
  }
}

/** True when this working directory is one of the wt-N slots (has a port assignment). */
export function isSlot() {
  return existsSync(join(repoRoot, '.worktree-port'))
}

/** The N in wt-N, from the folder name, or null outside a slot. */
export function slotNumber() {
  const m = basename(repoRoot).match(/-wt-(\d+)$/)
  return m ? Number(m[1]) : null
}

/** { fe, be } ports for this slot (4200+N/3000+N), or null outside a slot. */
export function ports() {
  const n = slotNumber()
  if (!n) return null
  return { fe: 4200 + n, be: 3000 + n }
}

/** The plan a branch named <type>/NNN-<slug> works on (an open plans/…/NNN-*.plan.md in that checkout), or null. */
export function branchPlanPath(branch, cwd) {
  const m = (branch || '').match(/^[\w.-]+\/(\d{3})-/)
  if (!m) return null
  return findOpenPlan(cwd || repoRoot, m[1])
}

/**
 * The active plan, or null when idle / not a slot. .worktree-plan marks the slot as busy; when the
 * branch names a different plan (one saved inside the slot), or the recorded file has moved
 * (e.g. into plans/design/), the branch's plan wins.
 */
export function activePlanPath() {
  const p = join(repoRoot, '.worktree-plan')
  if (!existsSync(p)) return null
  const rel = readFileSync(p, 'utf8').replace(/\r?\n+$/, '').trim()
  if (!rel) return null
  const fromBranch = branchPlanPath(git(['branch', '--show-current']))
  const planNum = (f) => basename(f).slice(0, 'NNN-'.length)
  const stale = planNum(rel) !== planNum(fromBranch || '') || !existsSync(join(repoRoot, rel))
  return fromBranch && stale ? fromBranch : rel
}

/**
 * The plan whose Read-Write Scope governs this folder, or null: a slot's active plan; outside a slot, on a branch
 * other than main, the plan .worktree-plan names (a run's merge folder, e.g. orch/<run>), else the plan a
 * <type>/NNN-<slug> branch names. Shared by ship-prep.mjs (the /ship scope gate) and scripts/lib/guard.mjs (the hooks).
 */
export function scopedPlanPath(branch = git(['branch', '--show-current'])) {
  if (isSlot()) return activePlanPath()
  if (!branch || branch === 'main' || branch === 'master') return null
  // Same rule as guard.mjs scopedPlan: a .worktree-plan whose file is missing is ignored, never returned.
  const p = join(repoRoot, '.worktree-plan')
  const marked = existsSync(p) ? readFileSync(p, 'utf8').replace(/\r?\n+$/, '').trim() : ''
  if (marked && existsSync(join(repoRoot, marked))) return marked
  return branchPlanPath(branch)
}

/**
 * The "validating" marker of a slot folder (.worktree-validating: branch, ISO time, sha — one per line), or null.
 * A slot that serves a branch for the Human's validation is detached and has no .worktree-plan; the marker is what tells
 * every status view and every claimer that it is not idle.
 */
export function readValidating(path) {
  const file = join(path, '.worktree-validating')
  if (!existsSync(file)) return null
  const [branch, at, sha] = readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim())
  return branch ? { branch, at: at || null, sha: sha || null } : null
}

/** A branch name the validating state accepts: no leading dash, no "..", only safe characters (it reaches git). */
export function refProblem(branch) {
  const b = String(branch ?? '')
  if (!/^[A-Za-z0-9._/-]+$/.test(b) || b.startsWith('-') || b.includes('..')) return `branch "${b}" must match [A-Za-z0-9._/-]+, not start with "-" and not contain ".."`
  return null
}

/**
 * Serves a branch in an idle slot: fetch origin/<branch>, check it out detached, write .worktree-validating. Refuses a
 * busy slot (.worktree-plan), a slot that already validates, and a dirty one (`.worktree-*` files do not count).
 * Returns { ok, sha } or { ok: false, error }. `now` is the ISO time to record.
 */
export function startValidating({ path, branch, now = new Date().toISOString() }) {
  const bad = refProblem(branch)
  if (bad) return { ok: false, error: bad }
  const run = (...a) => {
    try {
      return { ok: true, out: execFileSync('git', a, { cwd: path, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\r?\n+$/, '') }
    } catch (e) {
      return { ok: false, out: String(e.stderr || e.message).trim().split('\n').pop() }
    }
  }
  if (existsSync(join(path, '.worktree-plan'))) return { ok: false, error: 'this slot is busy (.worktree-plan) - free it first, or use an idle slot' }
  const held = readValidating(path)
  if (held && held.branch !== branch) return { ok: false, error: `this slot is already validating ${held.branch} - run node scripts/slot-stop.mjs first` }
  const dirty = run('status', '--porcelain')
  if (!dirty.ok) return { ok: false, error: `git status: ${dirty.out}` }
  if (dirty.out.split('\n').filter((l) => l && !/^\?\? \.worktree-/.test(l) && !/^\?\? \.claude\/[^/]+\.log$/.test(l)).length) return { ok: false, error: 'this slot has uncommitted files - not touching it' }
  const f = run('fetch', '--quiet', 'origin', branch)
  if (!f.ok) return { ok: false, error: `git fetch origin ${branch}: ${f.out}` }
  const c = run('checkout', '--quiet', '--detach', `origin/${branch}`)
  if (!c.ok) return { ok: false, error: `git checkout --detach origin/${branch}: ${c.out}` }
  const sha = run('rev-parse', 'HEAD').out
  writeFileSync(join(path, '.worktree-validating'), `${branch}\n${now}\n${sha}\n`)
  return { ok: true, sha }
}

/** Ends validating: removes the marker. Returns the branch it named, or null when the slot was not validating. */
export function endValidating(path) {
  const held = readValidating(path)
  if (!held) return null
  try {
    unlinkSync(join(path, '.worktree-validating'))
  } catch { /* already gone */ }
  return held.branch
}

/** Every wt-N worktree: { slot, path, branch (null if detached), detached, plan, validating: { branch, at } | null }. */
export function listSlots() {
  const out = git(['worktree', 'list', '--porcelain'])
  const entries = []
  let cur = null
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur) entries.push(cur)
      cur = { path: line.slice('worktree '.length).replace(/\\/g, '/'), branch: null, detached: false }
    } else if (cur && line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).replace('refs/heads/', '')
    } else if (cur && line === 'detached') {
      cur.detached = true
    }
  }
  if (cur) entries.push(cur)

  return entries
    .map(e => {
      const m = basename(e.path).match(/-wt-(\d+)$/)
      if (!m) return null
      const planFile = join(e.path, '.worktree-plan')
      const plan = existsSync(planFile) ? readFileSync(planFile, 'utf8').replace(/\r?\n+$/, '').trim() || null : null
      const v = readValidating(e.path)
      return { slot: Number(m[1]), path: e.path, branch: e.detached ? null : e.branch, detached: e.detached, plan, validating: v ? { branch: v.branch, at: v.at } : null }
    })
    .filter(Boolean)
    .sort((a, b) => a.slot - b.slot)
}

function describe() {
  if (!isSlot()) {
    console.log('PLANNER: main folder — plans only; code goes through branches.')
    return
  }
  const plan = activePlanPath()
  console.log(plan ? `WORKER: plan=${plan}` : 'IDLE SLOT: ask the Human which plan to execute.')
}

function list() {
  const slots = listSlots()
  if (!slots.length) {
    console.log('SLOT: no wt-N worktrees found')
    return
  }
  for (const s of slots) {
    const where = s.detached ? 'detached' : `branch=${s.branch}`
    const fromBranch = s.plan && branchPlanPath(s.branch, s.path)
    const mismatch = fromBranch && fromBranch !== s.plan ? ` (branch works on ${fromBranch} - that plan is used)` : ''
    if (s.validating && !s.plan) {
      console.log(`wt-${s.slot}: detached validating ${s.validating.branch} since ${s.validating.at ?? '?'}`)
      continue
    }
    console.log(`wt-${s.slot}: ${where}${s.plan ? ` plan=${s.plan}${mismatch}` : ' idle'}`)
  }
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMainModule) {
  const arg = process.argv[2]
  if (arg === '--describe') describe()
  else if (arg === '--list') list()
  else if (arg === '--scoped-plan') console.log(scopedPlanPath() ?? '')
  else {
    console.error('SLOT: usage: node scripts/lib/slot.mjs --describe | --list | --scoped-plan')
    process.exit(1)
  }
}
