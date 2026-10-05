/**
 * Next plan number — the one place a new plan's NNN comes from (save-plan Phase 1).
 *
 * A number is taken when any of these uses it: a plan file in this checkout, on
 * origin/{{git.mainBranch}}, or in the main worktree; or a local or remote branch named
 * <type>/NNN-<slug> (a Worker's open branch whose plan the Planner may not see yet).
 * Prints the zero-padded max + 1. Fetches first unless --no-fetch.
 *
 * Usage: node scripts/next-plan-number.mjs [--no-fetch]
 */
import { readdirSync, existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'

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
const listPlans = (dir) => (existsSync(join(dir, 'plans')) ? readdirSync(join(dir, 'plans')) : [])

take(listPlans(repoRoot), planRe)
take(git(['ls-tree', '-r', '--name-only', 'origin/{{git.mainBranch}}', '--', 'plans/']).split('\n'), planRe)
const mainWorktree = (git(['worktree', 'list', '--porcelain']).match(/^worktree (.+)$/m) || [])[1]
if (mainWorktree) take(listPlans(mainWorktree), planRe)
take(git(['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes/origin']).split('\n'), /\/(\d{3})-/)

const next = String((used.length ? Math.max(...used) : 0) + 1).padStart(3, '0')
console.log(next)
