/**
 * Session-state path resolver — single source of truth for session-startup.sh,
 * handoff-check.sh and write-session-state.mjs, so all three resolve the same
 * path the same way. See plans/326-planner-worker-workflow.plan.md.
 *
 * Order: SESSION_STATE_PATH env -> .claude/.session-state-path pointer (ignored
 * when it names another branch's file) -> docs/session-state-<branch>.md. Falls back to docs/session-state.md only
 * when not in a slot and HEAD is detached. In a slot with no branch (idle,
 * detached at origin/main), prints the literal NONE — an explicit result,
 * not an empty string.
 *
 * Usage: node scripts/session-state-path.mjs
 * Prints one path (or NONE) and exits 0.
 */
import { existsSync, readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { isSlot } from './lib/slot.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const POINTER_PATH = join(repoRoot, '.claude', '.session-state-path')

function git(cmdArgs) {
  try {
    return execFileSync('git', cmdArgs, { cwd: repoRoot, encoding: 'utf8' }).replace(/\r?\n+$/, '')
  } catch {
    return ''
  }
}

function sanitizeBranch(branch) {
  return branch.replace(/[^a-zA-Z0-9]/g, '-')
}

export function resolveSessionStatePath() {
  if (process.env.SESSION_STATE_PATH) return process.env.SESSION_STATE_PATH

  const branch = git(['branch', '--show-current'])

  if (existsSync(POINTER_PATH)) {
    const pointed = readFileSync(POINTER_PATH, 'utf8').replace(/\r?\n+$/, '').trim()
    // A pointer left by an earlier branch (a slot moves from plan to plan) must not redirect this branch's notes.
    const pointedBranch = (pointed.match(/session-state-(.+)\.md$/) || [])[1]
    const stale = branch && pointedBranch && pointedBranch !== sanitizeBranch(branch)
    if (pointed && !stale) return pointed
  }

  if (branch) return `docs/session-state-${sanitizeBranch(branch)}.md`

  return isSlot() ? 'NONE' : 'docs/session-state.md'
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMainModule) {
  console.log(resolveSessionStatePath())
}
