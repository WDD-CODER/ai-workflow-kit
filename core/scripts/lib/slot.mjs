/**
 * Slot facts — single source of truth for the 3 permanent worktree slots
 * ({{slots.nameFormat}} (1..{{slots.count}})) in the Planner-Worker workflow. Shared by session-state-path.mjs,
 * scope-check.mjs, scope-guard.sh (via scope-check.mjs), ship-prep.mjs,
 * take-plan.mjs and session-startup.sh (via --describe).
 * See plans/326-planner-worker-workflow.plan.md.
 *
 * Usage:
 *   node scripts/lib/slot.mjs --describe
 *   node scripts/lib/slot.mjs --list
 */
import { readFileSync, existsSync, readdirSync } from 'fs'
import { execFileSync } from 'child_process'
import { resolve, dirname, join, basename } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..', '..')

function git(cmdArgs, cwd) {
  try {
    return execFileSync('git', cmdArgs, { cwd: cwd || repoRoot, encoding: 'utf8' }).replace(/\r?\n+$/, '')
  } catch {
    return ''
  }
}

/** True when this working directory is one of the {{slots.nameFormat}} slots (has a port assignment). */
export function isSlot() {
  return existsSync(join(repoRoot, '.worktree-port'))
}

/** The N in {{slots.nameFormat}}, from the folder name, or null outside a slot. */
export function slotNumber() {
  const m = basename(repoRoot).match(/-wt-(\d+)$/)
  return m ? Number(m[1]) : null
}

/** { fe, be } ports for this slot ({{slots.fePorts}}+N/{{slots.bePorts}}+N), or null outside a slot. */
export function ports() {
  const n = slotNumber()
  if (!n) return null
  return { fe: {{slots.fePorts}} + n, be: {{slots.bePorts}} + n }
}

/** The plan a branch named <type>/NNN-<slug> works on (plans/NNN-*.plan.md in that checkout), or null. */
export function branchPlanPath(branch, cwd) {
  const m = (branch || '').match(/^[\w.-]+\/(\d{3})-/)
  if (!m) return null
  const dir = join(cwd || repoRoot, 'plans')
  if (!existsSync(dir)) return null
  const f = readdirSync(dir).find(name => name.startsWith(`${m[1]}-`) && name.endsWith('.plan.md'))
  return f ? `plans/${f}` : null
}

/**
 * The active plan, or null when idle / not a slot. .worktree-plan marks the slot as busy; when the
 * branch names a different plan (one saved inside the slot), the branch's plan wins.
 */
export function activePlanPath() {
  const p = join(repoRoot, '.worktree-plan')
  if (!existsSync(p)) return null
  const rel = readFileSync(p, 'utf8').replace(/\r?\n+$/, '').trim()
  if (!rel) return null
  const fromBranch = branchPlanPath(git(['branch', '--show-current']))
  return fromBranch && !rel.startsWith(fromBranch.slice(0, 'plans/NNN-'.length)) ? fromBranch : rel
}

/** Every {{slots.nameFormat}} worktree: { slot, path, branch (null if detached), detached, plan }. */
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
      return { slot: Number(m[1]), path: e.path, branch: e.detached ? null : e.branch, detached: e.detached, plan }
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
  console.log(plan ? `WORKER: plan=${plan}` : 'IDLE SLOT: ask Dandan which plan to execute.')
}

function list() {
  const slots = listSlots()
  if (!slots.length) {
    console.log('SLOT: no {{slots.nameFormat}} worktrees found')
    return
  }
  for (const s of slots) {
    const where = s.detached ? 'detached' : `branch=${s.branch}`
    const fromBranch = s.plan && branchPlanPath(s.branch, s.path)
    const mismatch = fromBranch && fromBranch !== s.plan ? ` (branch works on ${fromBranch} - that plan is used)` : ''
    console.log(`wt-${s.slot}: ${where}${s.plan ? ` plan=${s.plan}${mismatch}` : ' idle'}`)
  }
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMainModule) {
  const arg = process.argv[2]
  if (arg === '--describe') describe()
  else if (arg === '--list') list()
  else {
    console.error('SLOT: usage: node scripts/lib/slot.mjs --describe | --list')
    process.exit(1)
  }
}
