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
 * shas), then the merge checks (after `ensure`, the caller's ensure-env for the merge folder) (orchestrator.mergeChecks: the build by default), then ONE push of the run branch. A
 * conflict or a failing check undoes the merge in the merge folder (abort, or reset to HEAD^); origin never moves.
 * The main branch is never touched. Callers run one merge at a time (one merge folder per run).
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { runGate } from './plan-gate.mjs'
import { retryGit, sleepSync } from './orch-folders.mjs'

const rawGit = (cwd, ...a) => {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return { status: r.status ?? 1, out: String(r.stdout ?? '').trim(), err: String(r.stderr ?? '').trim() }
}
// fetch and push retry on a transient error (3 runs, 5 s apart); every other git call runs once.
const git = (cwd, ...a) => retryGit(cwd, a, { exec: (c, args) => rawGit(c, ...args) })
const lastLine = (s) => String(s ?? '').split('\n').filter(Boolean).pop() ?? ''

/** orch-state commands that only read, or that give the same state when run twice: an answer lost to a one-off failure is asked again. */
export const STATE_READ = new Set(['order', 'done', 'check-files', 'scripts', 'context', 'watch', 'disk', 'merge-ready', 'plan-info', 'diff', 'set', 'touch'])
/** Whether `orch-state <argv>` may be run again when it gave no readable ORCH_JSON (`note` only with an --id). */
export const stateRepeatable = (argv) => STATE_READ.has(argv[0]) || (argv[0] === 'note' && argv.some((a) => /^--id(=|$)/.test(a)))

/**
 * The run's state script: { ok, ...ORCH_JSON } or { ok: false, error }. An answer without a readable ORCH_JSON is asked
 * again up to 3 runs, 2 s apart, for a command in STATE_READ; any other command fails as before. `spawn(argv)` and
 * `sleep(ms)` are injectable for tests.
 */
export function orchState(root, argv, { spawn = null, sleep = sleepSync, tries = 3, delayMs = 2000 } = {}) {
  const call = spawn ?? ((a) => spawnSync(process.execPath, [join(root, 'scripts', 'orch-state.mjs'), ...a], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60_000 }))
  let fail = null
  for (let i = 0; i < (stateRepeatable(argv) ? tries : 1); i++) {
    if (i > 0) sleep(delayMs)
    const r = call(argv)
    const line = String(r.stdout ?? '').split(/\r?\n/).reverse().find((l) => l.startsWith('ORCH_JSON '))
    if (!line) {
      fail = { ok: false, error: `orch-state ${argv[0]} gave no answer (exit ${r.status}): ${lastLine(r.stderr) || lastLine(r.stdout)}`, lines: String(r.stdout ?? '') }
      continue
    }
    try {
      return { ...JSON.parse(line.slice('ORCH_JSON '.length)), lines: String(r.stdout ?? '').split(/\r?\n/).filter((l) => l && !l.startsWith('ORCH_JSON ')) }
    } catch (e) {
      fail = { ok: false, error: `orch-state ${argv[0]}: unreadable answer: ${e.message}` }
    }
  }
  return fail
}

/** The anchored merge subject plan-order and `orch-state done` read back from git. */
export const mergeSubject = (branch, runBranch, nnn) => `Merge ${branch} into ${runBranch} (plan ${nnn})`

/** A conflicted path the run branch's copy wins: only the plans' own files (the Planner's and the Human's, never the builder's). */
export const isPlanFile = (p) => /^plans\/.+\.plan\.md$/.test(String(p).replace(/\\/g, '/'))

/** The line added at the end of the plan's `## Execution Notes` section (the section is made when the plan has none). */
export function appendExecutionNote(text, line) {
  const crlf = text.includes('\r\n')
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const at = lines.findIndex((l) => /^##\s+Execution Notes\b/i.test(l))
  let out
  if (at < 0) out = [...lines.filter((l, i) => !(i === lines.length - 1 && l === '')), '', '## Execution Notes', line, '']
  else {
    let end = lines.findIndex((l, i) => i > at && /^##\s/.test(l))
    if (end < 0) end = lines.length
    while (end - 1 > at && lines[end - 1].trim() === '') end--
    out = [...lines.slice(0, end), line, ...lines.slice(end)]
  }
  const joined = out.join('\n')
  return crlf ? joined.replace(/\n/g, '\r\n') : joined
}

/**
 * The plan file as the run branch holds it now (HEAD of `cwd`), against the commit the plan's builder started from: null
 * when it did not change, else { commits: [{ sha, author, subject }], diff (cut to 40 lines), warnings }. Written from
 * git, never by a model.
 */
export function planChangeRecord(cwd, { path, startCommit }) {
  if (!startCommit || !path) return null
  const log = git(cwd, 'log', '--format=%h%x1f%an%x1f%s', `${startCommit}..HEAD`, '--', path).out.split('\n').filter(Boolean)
  if (!log.length) return null
  const commits = log.map((l) => {
    const [sha, author, subject] = l.split('\x1f')
    return { sha, author, subject }
  })
  const diff = git(cwd, 'diff', '--no-color', startCommit, 'HEAD', '--', path).out.split('\n').slice(0, 40).join('\n')
  const warnings = commits
    .filter((c) => {
      const m = /^plan\(\d+\):\s*(.*)$/.exec(c.subject)
      return m && m[1].trim().length < 10
    })
    .map((c) => `plan-file commit ${c.sha} has no reason ("${c.subject}"): the subject after plan(NNN): is shorter than 10 characters`)
  return { commits, diff, warnings }
}

export async function mergePlan({ root, run, nnn, branch, runBranch, mergeFolder, checks = [], timeoutMin = 15, onResult = null, plan = null, ensure = null }) {
  const mf = mergeFolder
  const undo = () => git(mf, 'reset', '--quiet', '--hard', 'HEAD^')
  const f = git(mf, 'fetch', '--quiet', 'origin')
  if (f.status !== 0) return { merged: false, env: true, why: `merge: git fetch origin failed: ${lastLine(f.err)}` }
  const ff = git(mf, 'merge', '--quiet', '--ff-only', `origin/${runBranch}`)
  if (ff.status !== 0) return { merged: false, why: `merge: the merge folder cannot fast-forward to origin/${runBranch}: ${lastLine(ff.err)}` }
  // The plan file as the run branch holds it, before the merge: a change since the builder started is recorded.
  const planChange = plan ? planChangeRecord(mf, plan) : null
  const m = git(mf, 'merge', '--no-ff', '--no-edit', '-m', mergeSubject(branch, runBranch, nnn), `origin/${branch}`)
  const planFiles = []
  if (m.status !== 0) {
    const conflicted = git(mf, 'diff', '--name-only', '--diff-filter=U').out.split('\n').filter(Boolean)
    // Only plans/** files in conflict: the run branch's copy wins (in the merge folder the run branch is HEAD = "ours").
    let resolved = conflicted.length > 0 && conflicted.every(isPlanFile)
    if (resolved) {
      for (const f of conflicted) {
        if (git(mf, 'checkout', '--ours', '--', f).status !== 0 || git(mf, 'add', '--', f).status !== 0) resolved = false
        else planFiles.push(f)
      }
      if (resolved && git(mf, 'commit', '--quiet', '-m', mergeSubject(branch, runBranch, nnn)).status !== 0) resolved = false
    }
    if (!resolved) {
      git(mf, 'merge', '--abort')
      return { merged: false, why: `merge: origin/${branch} does not merge into ${runBranch}${conflicted.length ? `: conflicts in ${conflicted.join(', ')}` : `: ${lastLine(m.err || m.out)}`}` }
    }
  }
  const v = orchState(root, ['merge-verify', `--run=${run}`, `--plan=${nnn}`])
  if (!v.ok) {
    if (v.refused) return { merged: false, pin: { merged: v.merged, checkedHead: v.checkedHead }, why: `merge refused: ${v.error}` }
    undo()
    return { merged: false, why: `merge-verify: ${v.error}` }
  }
  if (checks.length) {
    // ensure(clean, command, result): ensure-env in the merge folder; before the checks, and (clean) before a check's one retry.
    if (ensure) await ensure(false)
    const g = await runGate({ folder: mf, commands: checks, timeoutMin, receipt: false, onResult, beforeRetry: ensure ? (command, r) => ensure(true, command, r) : null })
    if (g.status !== 'pass') {
      undo()
      const bad = g.results.find((x) => x.status !== 'pass')
      return { merged: false, env: g.status === 'env', why: `merge check failed on the merged tree: ${bad?.command} — ${lastLine(bad?.tail)}`, gate: g }
    }
  }
  const sha = git(mf, 'rev-parse', 'HEAD').out
  // The record of a plan changed during the run: one line under the plan's Execution Notes, committed after the merge.
  let noted = false
  if (planChange && plan?.path) {
    const last = planChange.commits[0]
    const file = join(mf, plan.path)
    try {
      writeFileSync(file, appendExecutionNote(readFileSync(file, 'utf8'), `- ${new Date().toISOString().slice(0, 10)} changed during ${run} in ${last.sha}: ${last.subject}`))
      noted = git(mf, 'add', '--', plan.path).status === 0 && git(mf, 'commit', '--quiet', '-m', `plan(${nnn}): record the change made during ${run} (${last.sha})`).status === 0
    } catch { /* the record is a courtesy: the merge goes on without the line */ }
  }
  const p = git(mf, 'push', '--quiet', 'origin', `HEAD:refs/heads/${runBranch}`)
  if (p.status !== 0) {
    git(mf, 'reset', '--quiet', '--hard', noted ? 'HEAD~2' : 'HEAD^')
    return { merged: false, env: true, why: `merge: git push origin ${runBranch} failed: ${lastLine(p.err)}` }
  }
  git(mf, 'fetch', '--quiet', 'origin', runBranch)
  return { merged: true, sha, pinned: v.pinned !== false, ...(planFiles.length ? { planFiles } : {}), ...(planChange ? { planChange } : {}) }
}
