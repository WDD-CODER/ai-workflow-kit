/**
 * Isolated worktree of origin/main under <state>/wt/ — never the checkout the Human works in.
 */
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { stateDir } from './log.mjs'

export const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/** Create a fresh worktree + branch from origin/main. Returns { path, remove() }; remove() also drops the local branch. */
export function createWorktree({ repoRoot, branch, name }) {
  const wtRoot = join(stateDir(), 'wt')
  mkdirSync(wtRoot, { recursive: true })
  const path = join(wtRoot, name)
  git(repoRoot, 'fetch', '-q', 'origin', 'main')
  if (existsSync(path)) git(repoRoot, 'worktree', 'remove', '--force', path)
  try { git(repoRoot, 'branch', '-D', branch) } catch {}
  git(repoRoot, 'worktree', 'add', '-q', '-b', branch, path, 'origin/main')
  return {
    path,
    remove() {
      try { git(repoRoot, 'worktree', 'remove', '--force', path) } catch {}
      try { git(repoRoot, 'branch', '-D', branch) } catch {}
    },
  }
}
