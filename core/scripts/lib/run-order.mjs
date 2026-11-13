/**
 * The run order of a run's plans and what a park blocks (docs/agent/orchestrator.md "The run"):
 *
 *   import { runOrder, blockedBy, unitsOf } from './lib/run-order.mjs'
 *   const o = runOrder({ root, plans: ['451', '452'], runBranch: 'orch/x' })
 *   // o = { ok, waves, waveLocks, edges (unmet only), plans: { NNN: { path, title } }, skipped, error? }
 *
 * Waves and edges come from `scripts/plan-order.mjs --json` (with `--branch <run branch> --merged-from git` once the run
 * branch exists, so a relaunch leaves the merged plans out). The merged plans are read from origin/<run branch> after a
 * fetch; the local branch only when origin has none. A local branch that is not in origin's history gives `warning`. `blockedBy()` is the rule the old workflow runtime used (moved
 * here before the runtime was deleted): a parked plan skips the later plans that depend on it, or share its files, and
 * the plans that depend on those. `afterPark()` applies orchestrator.onPark ("dependents" or "all").
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const sha = (root, ref) => {
  const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root, encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : null
}

/**
 * The history the run's merged plans are read from: origin/<run branch> (fetched first) wins over a stale local branch
 * (`git worktree add -b` leaves one behind); the local branch only when origin has none. A local branch that is not in
 * origin's history (ahead or diverged) gives one warning line naming both SHAs.
 */
function mergedRef(root, runBranch) {
  spawnSync('git', ['fetch', '--quiet', 'origin'], { cwd: root })
  const local = sha(root, `refs/heads/${runBranch}`)
  const remote = sha(root, `refs/remotes/origin/${runBranch}`)
  if (!remote) return { ref: local ? runBranch : null, warning: null }
  const behind = !local || local === remote || spawnSync('git', ['merge-base', '--is-ancestor', local, remote], { cwd: root }).status === 0
  const warning = behind ? null : `RUN_ORDER: warning — local ${runBranch} ${local.slice(0, 12)} is not in origin/${runBranch} ${remote.slice(0, 12)}; reading the merged plans from origin/${runBranch}`
  return { ref: `origin/${runBranch}`, warning }
}

export function runOrder({ root, plans, runBranch = null }) {
  const { ref, warning } = runBranch ? mergedRef(root, runBranch) : { ref: null, warning: null }
  // --branch keeps the merge subjects naming the run branch; --ref is the history they are read from.
  const fromGit = ref ? ['--branch', runBranch, '--merged-from', 'git', '--ref', ref] : []
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'plan-order.mjs'), ...plans, '--json', ...fromGit], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  let j
  try {
    j = JSON.parse(r.stdout)
  } catch {
    return { ok: false, error: `plan-order exit ${r.status}: ${String(r.stderr || r.stdout).trim().split('\n').pop()}` }
  }
  if (r.status !== 0) return { ok: false, error: `plan-order exit ${r.status}: ${String(r.stderr ?? '').trim().split('\n').join(' | ')}` }
  return { ok: true, waves: j.waves ?? [], waveLocks: j.waveLocks ?? [], edges: (j.edges ?? []).filter((e) => !e.met), plans: j.plans ?? {}, skipped: j.skipped ?? [], done: j.done ?? {}, warning }
}

/**
 * The later plans a park blocks, from the order's unmet edges ({ from, to, reason, lock? }: `to` needs `from`; a `lock`
 * edge is a scope overlap, either way). Returns Map<nnn, reason>: first every later plan reachable over dependency edges
 * from a parked plan (`depends on parked <root>`), then every later plan with a lock edge to a parked plan (`shares
 * files with parked <NNN>`), then the plans that depend on those (`depends on parked <root>`).
 */
export function blockedBy(parkedNnns, laterNnns, edges) {
  const later = new Set(laterNnns)
  const out = new Map()
  const reach = (start, root) => {
    const seen = new Set([start])
    const todo = [start]
    while (todo.length) {
      const from = todo.shift()
      for (const e of edges) {
        if (e.lock || e.from !== from || seen.has(e.to)) continue
        seen.add(e.to)
        todo.push(e.to)
        if (later.has(e.to) && !out.has(e.to)) out.set(e.to, `depends on parked ${root}`)
      }
    }
  }
  for (const p of parkedNnns) reach(p, p)
  const shared = []
  for (const p of parkedNnns) {
    for (const e of edges) {
      if (!e.lock || (e.from !== p && e.to !== p)) continue
      const other = e.from === p ? e.to : e.from
      if (!later.has(other) || out.has(other)) continue
      out.set(other, `shares files with parked ${p}`)
      shared.push([other, p])
    }
  }
  for (const [n, p] of shared) reach(n, p)
  return out
}

/** The work units of a wave: each lock group (overlapping scope) is one unit run in order; every other plan is its own. */
export function unitsOf(wave, locks = []) {
  const groups = (locks ?? []).map((g) => (g.plans ?? []).filter((p) => wave.includes(p))).filter((g) => g.length)
  const grouped = new Set(groups.flat())
  return [...groups, ...wave.filter((p) => !grouped.has(p)).map((p) => [p])]
}

/**
 * What a park does to the later waves. onPark "dependents": the blocked plans (Map nnn → reason) are taken out and the
 * rest go on; "all" (or an order without edges): every later plan is blocked with `not started: <why>`.
 */
export function afterPark({ parked, laterWaves, edges, onPark = 'dependents', why = '' }) {
  const later = laterWaves.flat()
  if (onPark === 'dependents' && Array.isArray(edges)) {
    const blocked = blockedBy(parked, later, edges)
    return { blocked, waves: laterWaves.map((w) => w.filter((p) => !blocked.has(p))) }
  }
  return { blocked: new Map(later.map((p) => [p, `not started: ${why || `parked ${parked.join(', ')}`}`])), waves: laterWaves.map(() => []) }
}
