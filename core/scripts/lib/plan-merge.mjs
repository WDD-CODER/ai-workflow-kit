/**
 * The merge of one checked plan into the run branch, by script (docs/agent/orchestrator.md "The run"):
 *
 *   import { mergePlan } from './lib/plan-merge.mjs'
 *   const m = await mergePlan({ root, run, nnn, branch, runBranch, mergeFolder, checks, timeoutMin })
 *   // m = { merged: true, sha } | { merged: false, why, pin?: { merged, checkedHead }, env? }
 *
 * In the run's merge folder: fetch, fast-forward to origin/<run branch>, `git merge --no-ff` origin/<plan branch> with
 * the anchored subject `Merge <plan branch> into <run branch> (plan NNN)`, then `orch-state.mjs merge-verify` (the merge
 * commit's second parent must be the plan's checkedHead; else the folder is reset to HEAD^ and the plan parks with both
 * shas), then the merge checks (orchestrator.mergeChecks: the build by default), then ONE push of the run branch. A
 * conflict or a failing check undoes the merge in the merge folder (abort, or reset to HEAD^); origin never moves.
 * The main branch is never touched. Callers run one merge at a time (one merge folder per run).
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { runGate } from './plan-gate.mjs'

const git = (cwd, ...a) => {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return { status: r.status ?? 1, out: String(r.stdout ?? '').trim(), err: String(r.stderr ?? '').trim() }
}
const lastLine = (s) => String(s ?? '').split('\n').filter(Boolean).pop() ?? ''

/** The run's state script: { ok, ...ORCH_JSON } or { ok: false, error }. */
export function orchState(root, argv) {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'orch-state.mjs'), ...argv], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60_000 })
  const line = String(r.stdout ?? '').split(/\r?\n/).reverse().find((l) => l.startsWith('ORCH_JSON '))
  if (!line) return { ok: false, error: `orch-state ${argv[0]} gave no answer (exit ${r.status}): ${lastLine(r.stderr) || lastLine(r.stdout)}`, lines: String(r.stdout ?? '') }
  try {
    return { ...JSON.parse(line.slice('ORCH_JSON '.length)), lines: String(r.stdout ?? '').split(/\r?\n/).filter((l) => l && !l.startsWith('ORCH_JSON ')) }
  } catch (e) {
    return { ok: false, error: `orch-state ${argv[0]}: unreadable answer: ${e.message}` }
  }
}

/** The anchored merge subject plan-order and `orch-state done` read back from git. */
export const mergeSubject = (branch, runBranch, nnn) => `Merge ${branch} into ${runBranch} (plan ${nnn})`

export async function mergePlan({ root, run, nnn, branch, runBranch, mergeFolder, checks = [], timeoutMin = 15, onResult = null }) {
  const mf = mergeFolder
  const undo = () => git(mf, 'reset', '--quiet', '--hard', 'HEAD^')
  const f = git(mf, 'fetch', '--quiet', 'origin')
  if (f.status !== 0) return { merged: false, env: true, why: `merge: git fetch origin failed: ${lastLine(f.err)}` }
  const ff = git(mf, 'merge', '--quiet', '--ff-only', `origin/${runBranch}`)
  if (ff.status !== 0) return { merged: false, why: `merge: the merge folder cannot fast-forward to origin/${runBranch}: ${lastLine(ff.err)}` }
  const m = git(mf, 'merge', '--no-ff', '--no-edit', '-m', mergeSubject(branch, runBranch, nnn), `origin/${branch}`)
  if (m.status !== 0) {
    const conflicted = git(mf, 'diff', '--name-only', '--diff-filter=U').out.split('\n').filter(Boolean)
    git(mf, 'merge', '--abort')
    return { merged: false, why: `merge: origin/${branch} does not merge into ${runBranch}${conflicted.length ? `: conflicts in ${conflicted.join(', ')}` : `: ${lastLine(m.err || m.out)}`}` }
  }
  const v = orchState(root, ['merge-verify', `--run=${run}`, `--plan=${nnn}`])
  if (!v.ok) {
    if (v.refused) return { merged: false, pin: { merged: v.merged, checkedHead: v.checkedHead }, why: `merge refused: ${v.error}` }
    undo()
    return { merged: false, why: `merge-verify: ${v.error}` }
  }
  if (checks.length) {
    const g = await runGate({ folder: mf, commands: checks, timeoutMin, receipt: false, onResult })
    if (g.status !== 'pass') {
      undo()
      const bad = g.results.find((x) => x.status !== 'pass')
      return { merged: false, env: g.status === 'env', why: `merge check failed on the merged tree: ${bad?.command} — ${lastLine(bad?.tail)}`, gate: g }
    }
  }
  const sha = git(mf, 'rev-parse', 'HEAD').out
  const p = git(mf, 'push', '--quiet', 'origin', `HEAD:refs/heads/${runBranch}`)
  if (p.status !== 0) {
    undo()
    return { merged: false, env: true, why: `merge: git push origin ${runBranch} failed: ${lastLine(p.err)}` }
  }
  git(mf, 'fetch', '--quiet', 'origin', runBranch)
  return { merged: true, sha, pinned: v.pinned !== false }
}
