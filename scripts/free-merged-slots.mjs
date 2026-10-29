/**
 * Detaches any wt-N slot whose branch has already merged into origin/main back
 * to detached HEAD @ origin/main (idle), stops its dev servers and clears its .worktree-plan. Run as
 * part of the Planner's pull/sync sequence so finished slots don't sit occupied
 * after a Worker's branch merges. See plans/326-planner-worker-workflow.plan.md.
 * A slot a live orchestrator run holds (.claude/orchestrator-runs/<run>/status.json running, its slot path or plan
 * branch) is left alone whatever git says: the run gives it back itself (orch-state.mjs release, stop, finish).
 *
 * Usage:
 *   node scripts/free-merged-slots.mjs             # fetch first
 *   node scripts/free-merged-slots.mjs --no-fetch  # local refs only (session start: fast, no network)
 */
import { existsSync, rmSync, readdirSync, readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { listSlots } from './lib/slot.mjs'
import { stopSlotServers } from './lib/slot-procs.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
// A run counts as live while its status.json says running and was updated in the last two hours (orch-preflight's rule).
const LIVE_MS = 2 * 60 * 60 * 1000
const norm = (p) => String(p ?? '').replace(/\\/g, '/').replace(/\/+$/, '')

// The slots (by path) and plan branches a live orchestrator run holds: an orchestrator builder's branch starts equal
// to the run branch, so "merged into origin/main" says nothing about it until the run moves on. Never freed here.
function liveRunHolds() {
  const dir = join(repoRoot, '.claude', 'orchestrator-runs')
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir)) {
    try {
      const s = JSON.parse(readFileSync(join(dir, name, 'status.json'), 'utf8'))
      if (s.phase !== 'running' || Date.now() - Date.parse(s.updatedAt ?? 0) > LIVE_MS) continue
      for (const p of Object.values(s.plans ?? {})) out.push({ run: name, slot: p.slot ? norm(p.slot) : null, branch: p.branch ?? null })
    } catch { /* no status.json, or unreadable: not a live run */ }
  }
  return out
}

function git(cmdArgs, cwd) {
  return execFileSync('git', cmdArgs, { cwd: cwd || repoRoot, encoding: 'utf8' }).replace(/\r?\n+$/, '')
}

// Merged = an ancestor of origin/main (merge or fast-forward), or its pushed upstream is gone after a
// prune (a squash merge with --delete-branch is never an ancestor; the deleted remote branch is the signal).
function isMergedIntoOriginMain(branch) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', `refs/heads/${branch}`, 'origin/main'], {
      cwd: repoRoot,
      stdio: 'ignore',
    })
    return true
  } catch {
    try {
      return git(['for-each-ref', '--format=%(upstream:track)', `refs/heads/${branch}`]) === '[gone]'
    } catch {
      return false
    }
  }
}

// Server logs under .claude/ are runtime noise, not work.
function isClean(path) {
  return git(['status', '--porcelain'], path)
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/^\?\? \.claude\/[^/]+\.log$/.test(l.trim()))
    .length === 0
}

function main() {
  if (!process.argv.includes('--no-fetch')) git(['fetch', 'origin', '--prune'])

  const slots = listSlots()
  if (!slots.length) {
    console.log('FREE_SLOTS: no wt-N worktrees found')
    return
  }
  const live = liveRunHolds()

  for (const s of slots) {
    if (s.detached || !s.branch) {
      console.log(`wt-${s.slot}: idle — left alone`)
      continue
    }
    const held = live.find((h) => (h.slot && h.slot === norm(s.path)) || (h.branch && h.branch === s.branch))
    if (held) {
      console.log(`wt-${s.slot}: branch=${s.branch} claimed by live orchestrator run ${held.run} — left alone`)
      continue
    }
    // Only a slot claimed through take-plan.mjs (.worktree-plan present) is
    // ours to free. A hand-made branch (no recorded plan) is never touched,
    // even if its tip happens to already be an ancestor of origin/main —
    // that's trivially true for any branch that hasn't diverged yet, not
    // evidence the work shipped.
    if (!s.plan) {
      console.log(`wt-${s.slot}: branch=${s.branch}, no recorded plan — left alone`)
      continue
    }
    if (!isClean(s.path)) {
      console.log(`wt-${s.slot}: branch=${s.branch} has uncommitted changes — left alone`)
      continue
    }
    if (!isMergedIntoOriginMain(s.branch)) {
      console.log(`wt-${s.slot}: branch=${s.branch} not yet merged — left alone`)
      continue
    }
    // Servers are off unless a session needs them: a freed slot's servers are stopped.
    const stopped = stopSlotServers({ root: s.path, slotPorts: { fe: 4200 + s.slot, be: 3000 + s.slot } })
    git(['checkout', '--detach', 'origin/main'], s.path)
    const planFile = join(s.path, '.worktree-plan')
    if (existsSync(planFile)) rmSync(planFile)
    console.log(`wt-${s.slot}: freed (branch=${s.branch} merged) -> idle @ origin/main; servers stopped (${stopped.length} action(s))`)
  }
}

main()
