/**
 * Next plan number — the one place a new plan's NNN comes from (save-plan Phase 1).
 *
 * A number is taken when any of these uses it: a plan file in this checkout, on
 * origin/main, in the main worktree, or on any local or remote branch
 * (a plan/<slug> or release branch without a number carries plans too); or a local or
 * remote branch named <type>/NNN-<slug> (a Worker's open branch whose plan the Planner
 * may not see yet).
 * Prints the zero-padded max + 1. Fetches first unless --no-fetch.
 *
 * Usage: node scripts/next-plan-number.mjs [--no-fetch]
 */
import { execFileSync } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { listOpenPlans } from './lib/plan-paths.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

function git(cmdArgs) {
  try {
    return execFileSync('git', cmdArgs, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r?\n+$/, '')
  } catch {
    return ''
  }
}

if (!process.argv.includes('--no-fetch')) git(['fetch', 'origin', '--prune'])

// A running maximum, never an array spread into Math.max: hundreds of refs × hundreds of plan files overflow the stack.
let max = 0
const take = (names, re) => {
  for (const name of names) {
    const m = name.match(re)
    if (m) max = Math.max(max, Number(m[1]))
  }
}
const planRe = /(?:^|\/)(\d{3})-[^/]*\.plan\.md$/
// Open plans only (plans/ and plans/design/ …): a filed plan is on origin/main, which is read recursively.
const listPlans = (dir) => listOpenPlans(dir)

take(listPlans(repoRoot), planRe)
take(git(['ls-tree', '-r', '--name-only', 'origin/main', '--', 'plans/']).split('\n'), planRe)
const mainWorktree = (git(['worktree', 'list', '--porcelain']).match(/^worktree (.+)$/m) || [])[1]
if (mainWorktree) take(listPlans(mainWorktree), planRe)
const refRows = git(['for-each-ref', '--format=%(objectname) %(refname:short)', 'refs/heads', 'refs/remotes/origin']).split('\n').filter(Boolean)
  .map((l) => { const i = l.indexOf(' '); return { sha: l.slice(0, i), ref: l.slice(i + 1) } })
take(refRows.map((r) => r.ref), /\/(\d{3})-/)
// The plan files on every other ref: a branch need not carry a number in its name to hold plans. One ls-tree per
// commit: refs at the same commit (a branch and its origin copy, run branches at one tip) hold the same files.
const seen = new Set([git(['rev-parse', '--verify', '--quiet', 'origin/main'])])
for (const { sha, ref } of refRows) {
  if (ref === 'origin/HEAD' || ref === 'origin/main' || seen.has(sha)) continue
  seen.add(sha)
  take(git(['ls-tree', '-r', '--name-only', sha, '--', 'plans/']).split('\n'), planRe)
}

const next = String(max + 1).padStart(3, '0')
console.log(next)
