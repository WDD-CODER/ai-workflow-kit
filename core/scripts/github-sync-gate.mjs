/**
 * GitHub-sync gate — runs before the `github-sync` skill body is read (dynamic
 * context injection), so the once-per-day decision and the cheap facts are
 * computed instead of reasoned about.
 *
 * Prints:
 *   GATE: already-ran <date>   → the skill stops right there
 *   GATE: run                  → plus branch, dirty-file count, ahead/behind,
 *                                 and the .worktree-cleanup branch list if any
 *
 * Writing the daily marker is the skill's last step (after a successful sync),
 * not this script's — a failed sync must not count as "ran today".
 * Exit 0 always; `!` injection aborts a skill on non-zero.
 *
 * Usage: node scripts/github-sync-gate.mjs
 */
import { existsSync, readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const today = new Date().toISOString().slice(0, 10)
const marker = join(repoRoot, 'notes/github-sync', `${today}.md`)

const git = (args) => {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

if (existsSync(marker)) {
  console.log(`GATE: already-ran ${today} (${marker.replace(/\\/g, '/')})`)
  process.exit(0)
}

console.log('GATE: run')
console.log(`MARKER: notes/github-sync/${today}.md`)
console.log(`BRANCH: ${git(['branch', '--show-current']) || '(detached)'}`)
const dirty = git(['status', '--porcelain']).split('\n').filter(Boolean)
console.log(`DIRTY: ${dirty.length} file(s)`)
git(['fetch', '--prune', '--quiet'])
const ab = git(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])
console.log(`AHEAD/BEHIND upstream: ${ab || 'no upstream'}`)
console.log(`WORKTREE: ${existsSync(join(repoRoot, '.worktree-root')) ? 'slot' : 'main folder'}`)

const cleanup = join(repoRoot, '.worktree-cleanup')
if (existsSync(cleanup)) {
  const branches = readFileSync(cleanup, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  console.log(`CLEANUP (.worktree-cleanup): ${branches.length} remote branch(es) to delete`)
  for (const b of branches) console.log(`  ${b}`)
} else {
  console.log('CLEANUP: none')
}
