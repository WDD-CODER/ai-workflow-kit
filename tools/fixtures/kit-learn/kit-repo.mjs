// A small kit repository for the regression tests (plan 046, K2): 4 commits, the fix of plan 040 merged in the third.
//   c1 chore: start          c2 feat(039): older work   <- `old`: a run on this kit does not have the fix
//   c3 Merge pull request #7 from o/feat/040-gate-slot-stamp   <- `fix` (tagged fix-040)
//   c4 feat(041): later work                              <- `current`: has the fix
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

export function makeKitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'kit-learn-repo-'))
  const git = (...args) => {
    const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
    return r.stdout.trim()
  }
  git('init', '-q')
  const commit = (message, file) => {
    writeFileSync(join(dir, file), message)
    git('add', '-A')
    git('commit', '-q', '-m', message)
    return git('rev-parse', 'HEAD')
  }
  commit('chore: start', 'a.txt')
  const old = commit('feat(039): older work', 'b.txt')
  const fix = commit('Merge pull request #7 from o/feat/040-gate-slot-stamp', 'c.txt')
  git('tag', 'fix-040')
  const current = commit('feat(041): later work', 'd.txt')
  return { dir, old, fix, current, short: (sha) => sha.slice(0, 12) }
}
