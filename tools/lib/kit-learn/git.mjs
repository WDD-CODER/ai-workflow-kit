/**
 * Git questions the ledger asks of the kit repository (plan 046): did a run's kit contain a fix, which commit is a plan's
 * merge. Node built-ins and the git CLI only.
 */
import { spawnSync } from 'node:child_process'

const git = (repo, args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', timeout: 30000 })

/** true / false when git can tell, null when it cannot (an unknown commit, a missing repository). */
export function isAncestor(repo, ancestor, descendant) {
  if (!ancestor || !descendant || descendant === 'unknown') return null
  const r = git(repo, ['merge-base', '--is-ancestor', ancestor, descendant])
  if (r.status === 0) return true
  if (r.status === 1) return false
  return null
}

const refExists = (repo, ref) => git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).status === 0

/**
 * The commit that brought plan `nnn` into `ref` (default origin/main; the first of origin/main, main, HEAD that exists):
 * the merge commit `Merge pull request #<n> from <owner>/<type>/<NNN>-<slug>` first (--first-parent), else the newest
 * commit whose subject is `<type>(<NNN>): …` or ends `(plan <NNN>)`. Returns { sha, how } or null.
 */
export function fixCommitFor(repo, nnn, ref = 'origin/main') {
  const n = String(nnn).padStart(3, '0')
  const base = [ref, 'main', 'HEAD'].find((r) => refExists(repo, r))
  if (!base) return null
  const find = (pattern) => {
    const r = git(repo, ['log', '--first-parent', '--extended-regexp', `--grep=${pattern}`, '--format=%H', base])
    return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : []
  }
  const merge = find(`^Merge pull request #[0-9]+ from [^ ]*/${n}-`)
  if (merge.length) return { sha: merge[0], how: 'merge' }
  const subject = find(`^[a-z]+\\(${n}\\)|\\(plan ${n}\\)`)
  if (subject.length) return { sha: subject[0], how: 'subject' }
  return null
}
