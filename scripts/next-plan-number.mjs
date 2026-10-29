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

const used = []
const take = (names, re) => {
  for (const name of names) {
    const m = name.match(re)
    if (m) used.push(Number(m[1]))
  }
}
const planRe = /(?:^|\/)(\d{3})-[^/]*\.plan\.md$/
// Open plans only (plans/ and plans/design/ …): a filed plan is on origin/main, which is read recursively.
const listPlans = (dir) => listOpenPlans(dir)

take(listPlans(repoRoot), planRe)
take(git(['ls-tree', '-r', '--name-only', 'origin/main', '--', 'plans/']).split('\n'), planRe)
const mainWorktree = (git(['worktree', 'list', '--porcelain']).match(/^worktree (.+)$/m) || [])[1]
if (mainWorktree) take(listPlans(mainWorktree), planRe)
const refs = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes/origin']).split('\n').filter(Boolean)
take(refs, /\/(\d{3})-/)
// The plan files on every other ref: a branch need not carry a number in its name to hold plans. One ls-tree per ref.
for (const ref of refs) {
  if (ref === 'origin/HEAD' || ref === 'origin/main') continue
  take(git(['ls-tree', '-r', '--name-only', ref, '--', 'plans/']).split('\n'), planRe)
}

const next = String((used.length ? Math.max(...used) : 0) + 1).padStart(3, '0')
console.log(next)
