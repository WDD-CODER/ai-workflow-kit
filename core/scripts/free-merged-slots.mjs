/**
 * Detaches any {{slots.nameFormat}} slot whose branch has already merged into origin/{{git.mainBranch}} back
 * to detached HEAD @ origin/{{git.mainBranch}} (idle), and clears its .worktree-plan. Run as
 * part of the Planner's pull/sync sequence so finished slots don't sit occupied
 * after a Worker's branch merges. See plans/326-planner-worker-workflow.plan.md.
 *
 * Usage:
 *   node scripts/free-merged-slots.mjs
 */
import { existsSync, rmSync } from 'fs'
import { execFileSync } from 'child_process'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { listSlots } from './lib/slot.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

function git(cmdArgs, cwd) {
  return execFileSync('git', cmdArgs, { cwd: cwd || repoRoot, encoding: 'utf8' }).replace(/\r?\n+$/, '')
}

function isMergedIntoOriginMain(branch) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', `refs/heads/${branch}`, 'origin/{{git.mainBranch}}'], {
      cwd: repoRoot,
    })
    return true
  } catch {
    return false
  }
}

function isClean(path) {
  return git(['status', '--porcelain'], path) === ''
}

function main() {
  git(['fetch', 'origin', '{{git.mainBranch}}'])

  const slots = listSlots()
  if (!slots.length) {
    console.log('FREE_SLOTS: no {{slots.nameFormat}} worktrees found')
    return
  }

  for (const s of slots) {
    if (s.detached || !s.branch) {
      console.log(`wt-${s.slot}: idle — left alone`)
      continue
    }
    // Only a slot claimed through take-plan.mjs (.worktree-plan present) is
    // ours to free. A hand-made branch (no recorded plan) is never touched,
    // even if its tip happens to already be an ancestor of origin/{{git.mainBranch}} —
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
    git(['checkout', '--detach', 'origin/{{git.mainBranch}}'], s.path)
    const planFile = join(s.path, '.worktree-plan')
    if (existsSync(planFile)) rmSync(planFile)
    console.log(`wt-${s.slot}: freed (branch=${s.branch} merged) -> idle @ origin/{{git.mainBranch}}`)
  }
}

main()
