/**
 * worktree-clean — removes the worktree folders the kit and its agents made, once they are safe to remove, so no agent
 * has to delete a folder itself (a model's delete is refused by deny lists and the auto-mode classifier; a node script
 * is one allowed call). It judges what `git worktree list` shows, never a folder by name alone.
 *
 *   node scripts/worktree-clean.mjs --sweep [--dry-run]     every kit-made worktree beside the project and in .claude/worktrees
 *   node scripts/worktree-clean.mjs --path <folder>         one folder, the same rules (also: remove <folder>)
 *   node scripts/worktree-clean.mjs add <name> --branch <b> [--from <ref>] | --detach <ref>
 *       makes <repo>-<name> beside the project; <name> starts with review-, fix- or scratch-. Prints WORKTREE_ADD: <path>.
 *
 * Kit-made: <repo>-orch-<run>-<NNN> (builders), <repo>-orch-merge-<run>, <repo>-orch-review-<run>-<NNN>, and
 * <repo>-review-*, -fix-*, -scratch-*, -kit-*, -sync-*, plus <root>/.claude/worktrees/*. Never the main folder, a
 * permanent slot (<repo>{{slots.folderSuffix}}) or any other sibling (the Human's own folders).
 * Removed only when: git lists it, it is not locked, it has no uncommitted file (server logs .claude/*.log aside),
 * its run is not live, no hand-off names it, it is not on park/…, and its work is safe elsewhere:
 *   a branch merged into origin/<main> or (a builder) origin/<run branch>, or whose upstream is gone (squash merge);
 *   (a merge folder stays until its run branch is merged: the run's grade and lessons still work in it);
 *   a detached folder: its commit is on an origin branch.
 * A sweep also keeps a non-orchestrator folder made in the last two hours (an agent may still use it).
 * Removal: `git worktree remove` without --force, 3 tries; then (Windows "Directory not empty", a held file) a
 * recursive delete with retries, renamed aside when even that fails. The local branch is always kept. Each folder
 * gives one line `<path>: removed — <why>` or `<path>: kept — <why>`; the exit code is 0 whatever was kept.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { resolve, dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { removeFolder } from './lib/orch-folders.mjs'

const SELF = fileURLToPath(import.meta.url)
const ROOT = resolve(dirname(SELF), '..')
const RUN_PREFIX = {{orchestrator.runBranchPrefix|json}}
const MAIN = '{{git.mainBranch}}'
const REPO = '{{project.repoName}}'
const SLOT_SUFFIX = '{{slots.folderSuffix}}'
// A run counts as live while its status.json says running and was updated in the last two hours (free-merged-slots).
const LIVE_MS = 2 * 60 * 60 * 1000
const YOUNG_MS = 2 * 60 * 60 * 1000
const AGENT_KINDS = ['review', 'fix', 'scratch', 'kit', 'sync']

const norm = (p) => String(p ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
const same = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase()
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function gitIn(cwd, ...a) {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8', windowsHide: true })
  return { status: r.status ?? 1, out: String(r.stdout ?? '').trim(), err: String(r.stderr ?? '').trim() }
}

const readJson = (p) => {
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null }
}

/** The runs whose status.json says running and was updated in the last two hours. */
export function liveRuns(root, now = Date.now()) {
  const dir = join(root, '.claude', 'orchestrator-runs')
  const out = new Set()
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const s = readJson(join(dir, name, 'status.json'))
    if (s && s.phase === 'running' && now - Date.parse(s.updatedAt ?? 0) <= LIVE_MS) out.add(name)
  }
  return out
}

/** Every hand-off file's text (.claude/sessions/orch-<run>/handoff-<NNN>.md): a folder it names is never removed. */
export function handoffTexts(root) {
  const dir = join(root, '.claude', 'sessions')
  const out = []
  if (!existsSync(dir)) return out
  for (const d of readdirSync(dir)) {
    const p = join(dir, d)
    try {
      if (!d.startsWith('orch-') || !statSync(p).isDirectory()) continue
      for (const f of readdirSync(p)) if (/^handoff-\d+\.md$/.test(f)) out.push(norm(readFileSync(join(p, f), 'utf8')))
    } catch { /* unreadable: nothing named */ }
  }
  return out
}

/** git worktree list, parsed: [{ path, branch, detached, locked, head }]. */
export function listWorktrees(root) {
  const out = []
  let cur = null
  for (const line of gitIn(root, 'worktree', 'list', '--porcelain').out.split('\n')) {
    if (line.startsWith('worktree ')) out.push(cur = { path: norm(line.slice(9).trim()), branch: null, detached: false, locked: false, head: '' })
    else if (!cur) continue
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).trim().replace('refs/heads/', '')
    else if (line.startsWith('HEAD ')) cur.head = line.slice(5).trim()
    else if (line.trim() === 'detached') cur.detached = true
    else if (line.startsWith('locked')) cur.locked = true
  }
  return out
}

/**
 * What kind of kit folder `path` is, or null (not the kit's: never touched).
 * { kind: 'builder'|'merge'|'orch-review'|<agent kind>|'claude', run? }
 */
export function kitKind(path, { root, repo }) {
  const p = norm(path)
  const claudeDir = `${norm(root)}/.claude/worktrees/`
  if (p.toLowerCase().startsWith(claudeDir.toLowerCase())) return { kind: 'claude' }
  if (!same(dirname(p), dirname(norm(root)))) return null
  const name = basename(p)
  if (same(p, root)) return null
  const slot = new RegExp(`^${esc(repo)}${esc(SLOT_SUFFIX).replace('N', '\\d+')}$`, 'i')
  if (SLOT_SUFFIX && slot.test(name)) return null
  if (!name.toLowerCase().startsWith(`${repo.toLowerCase()}-`)) return null
  const rest = name.slice(repo.length + 1).replace(/-stale-\d+$/, '')
  let m
  if ((m = /^orch-merge-(.+)$/.exec(rest))) return { kind: 'merge', run: m[1] }
  if ((m = /^orch-review-(.+)-(\d{1,4})$/.exec(rest))) return { kind: 'orch-review', run: m[1] }
  if ((m = /^orch-(.+)-(\d{1,4})$/.exec(rest))) return { kind: 'builder', run: m[1] }
  const agent = AGENT_KINDS.find((k) => rest.startsWith(`${k}-`))
  return agent ? { kind: agent } : null
}

// Uncommitted files, server logs under .claude/ aside (runtime noise, not work): [] when clean, null when unreadable.
function changes(path) {
  const r = gitIn(path, 'status', '--porcelain')
  if (r.status !== 0) return null
  return r.out.split(/\r?\n/).filter((l) => l.trim() && !/^\?\? \.claude\/[^/]+\.log$/.test(l.trim()))
}

const refOk = (root, ref) => gitIn(root, 'rev-parse', '--verify', '--quiet', ref).status === 0
const ancestor = (root, a, b) => gitIn(root, 'merge-base', '--is-ancestor', a, b).status === 0

/** Why `wt` must stay, or null when its work is safe elsewhere (and the reason it is). Returns { keep } or { why }. */
export function judge(wt, kind, { root, live, handoffs, now = Date.now(), youngMs = YOUNG_MS }) {
  const name = basename(wt.path)
  if (kind.run && live.has(kind.run)) return { keep: `run ${kind.run} is live` }
  if (handoffs.some((t) => t.includes(wt.path) || t.includes(name))) return { keep: 'a parked plan\'s hand-off names it' }
  if (wt.locked) return { keep: 'git has it locked (git worktree unlock it first)' }
  if (!existsSync(wt.path)) return { keep: 'the folder is gone; git worktree prune clears the record' }
  if (wt.branch?.startsWith('park/')) return { keep: `it is on ${wt.branch}` }
  const ch = changes(wt.path)
  if (ch === null) return { keep: 'git cannot read its status' }
  if (ch.length) return { keep: 'it has uncommitted files' }
  if (youngMs > 0 && !['builder', 'merge', 'orch-review'].includes(kind.kind)) {
    let born = 0
    try {
      const st = statSync(wt.path)
      born = st.birthtimeMs || st.ctimeMs
    } catch { /* unreadable: treated as old */ }
    if (born && now - born < youngMs) return { keep: `made less than ${Math.round(youngMs / 60_000)} minutes ago; an agent may still use it` }
  }
  if (!wt.branch) {
    const head = wt.head || gitIn(wt.path, 'rev-parse', 'HEAD').out
    const on = gitIn(root, 'for-each-ref', '--count=1', '--format=%(refname:short)', '--contains', head, 'refs/remotes').out
    return on ? { why: `its commit is on ${on} (detached)` } : { keep: 'it is on no branch and its commit is on no origin branch' }
  }
  const b = `refs/heads/${wt.branch}`
  const into = [`origin/${MAIN}`, ...(kind.run && kind.kind === 'builder' ? [`origin/${RUN_PREFIX}${kind.run}`] : [])]
    .find((ref) => refOk(root, ref) && ancestor(root, b, ref))
  if (into) return { why: `${wt.branch} is merged into ${into} (branch kept)` }
  if (gitIn(root, 'for-each-ref', '--format=%(upstream:track)', b).out === '[gone]') return { why: `${wt.branch} was merged and its remote branch deleted (branch kept)` }
  // A merge folder stays until its run branch is merged: grade, lessons, finish and clean still work in it.
  if (kind.kind === 'merge') return { keep: `${wt.branch} is not merged into origin/${MAIN} (the run's grade and lessons still use this folder)` }
  return { keep: `${wt.branch} is not merged` }
}

/**
 * Removes one worktree folder the rules allowed: `git worktree remove` without --force (3 tries), then a recursive
 * delete with retries (renamed aside when that fails too). Returns { ok, note }.
 */
export function removeWorktree(root, path, { tries = 3, waitMs = 1000, git = gitIn, rmFolder = removeFolder } = {}) {
  for (const f of readdirSafe(join(path, '.claude'))) if (/\.log$/.test(f)) {
    try { unlinkSync(join(path, '.claude', f)) } catch { /* held by a server: the delete below retries */ }
  }
  let err = ''
  for (let i = 1; i <= tries; i++) {
    const r = git(root, 'worktree', 'remove', path)
    if (r.status === 0 && !existsSync(path)) return { ok: true, note: '' }
    err = String(r.err || 'the folder is still there').split('\n').pop()
    if (i < tries) pause(waitMs)
  }
  // git refused or left the folder half-deleted (Windows: node_modules, a held file). It was clean when judged; a
  // change made since (anything but git's own deletions) keeps it.
  const now = existsSync(path) ? changes(path) : []
  if (now && now.some((l) => !/^(?: D|D |DD) /.test(l))) return { ok: false, note: `git worktree remove failed (${err}) and the folder has new changes since it was judged` }
  const gone = rmFolder(path)
  git(root, 'worktree', 'prune')
  if (gone.ok) return { ok: true, note: ` (git worktree remove failed: ${err}; deleted by script)` }
  if (gone.aside) return { ok: true, note: ` (a running program holds it: moved aside to ${norm(gone.aside)}, deleted by a later sweep)` }
  return { ok: false, note: `could not remove: ${err}; ${gone.error} — a server, editor or shell may still hold it` }
}

function readdirSafe(p) {
  try { return readdirSync(p) } catch { return [] }
}

/** One folder: { line, removed }. */
export function cleanOne(root, wt, { repo, live, handoffs, now, youngMs, dryRun = false, remove = removeWorktree } = {}) {
  const kind = kitKind(wt.path, { root, repo })
  if (!kind) return { line: `${wt.path}: kept — not a folder the kit or its agents made`, removed: false }
  const j = judge(wt, kind, { root, live, handoffs, now, youngMs })
  if (j.keep) return { line: `${wt.path}: kept — ${j.keep}`, removed: false }
  if (dryRun) return { line: `${wt.path}: would remove — ${j.why}`, removed: false }
  const r = remove(root, wt.path)
  return r.ok ? { line: `${wt.path}: removed — ${j.why}${r.note}`, removed: true } : { line: `${wt.path}: kept — ${r.note}`, removed: false }
}

/** Every kit-made worktree of `root`: one line each (nothing to judge → one line saying so). */
export function sweep({ root = ROOT, now = Date.now(), youngMs = YOUNG_MS, dryRun = false, remove = removeWorktree } = {}) {
  const here = norm(root)
  if (!dryRun) gitIn(here, 'worktree', 'prune')
  const listed = listWorktrees(here)
  // Run state, hand-offs and .claude/worktrees live in the main checkout (git lists it first), also when this runs in a slot.
  root = mainCheckout(here, listed)
  const repo = REPO || basename(root)
  const live = liveRuns(root, now)
  const handoffs = handoffTexts(root)
  const lines = []
  for (const wt of listed) {
    if (same(wt.path, root) || same(wt.path, here) || !kitKind(wt.path, { root, repo })) continue
    lines.push(cleanOne(root, wt, { repo, live, handoffs, now, youngMs, dryRun, remove }).line)
  }
  // Kit-named folders git does not list: an earlier delete's aside copy is removed; anything else is only reported.
  const parent = dirname(root)
  for (const name of readdirSafe(parent)) {
    const path = norm(join(parent, name))
    if (listed.some((w) => same(w.path, path)) || !kitKind(path, { root, repo })) continue
    try { if (!statSync(path).isDirectory()) continue } catch { continue }
    if (/-stale-\d+$/.test(name)) {
      if (dryRun) { lines.push(`${path}: would remove — an earlier removal moved it aside`); continue }
      const r = removeFolder(path)
      lines.push(r.ok ? `${path}: removed — an earlier removal moved it aside` : `${path}: kept — still held (${r.error})`)
    } else lines.push(`${path}: kept — git does not list it as a worktree, so its content cannot be checked`)
  }
  if (!lines.length) lines.push('no worktree folder to clean')
  return lines
}

/** The main checkout: the first worktree git lists (`listed` = listWorktrees(root), or read here). */
export function mainCheckout(root, listed = listWorktrees(root)) {
  return norm(listed[0]?.path || root)
}

/** Makes <repo>-<name> beside the project. Returns { ok, path, error }. */
export function addWorktree(root, name, { branch, from, detach } = {}) {
  root = mainCheckout(norm(root))
  const repo = REPO || basename(root)
  if (!/^(review|fix|scratch)-[A-Za-z0-9._-]+$/.test(name ?? '')) return { ok: false, error: 'the name starts with review-, fix- or scratch- and has letters, digits, dots, dashes only' }
  const path = norm(join(dirname(root), `${repo}-${name}`))
  if (existsSync(path)) return { ok: false, error: `${path} exists already (node scripts/worktree-clean.mjs --path ${path} removes it when safe)` }
  let r
  if (detach) r = gitIn(root, 'worktree', 'add', '--quiet', '--detach', path, detach)
  else if (branch && refOk(root, `refs/heads/${branch}`)) r = gitIn(root, 'worktree', 'add', '--quiet', path, branch)
  else if (branch) r = gitIn(root, 'worktree', 'add', '--quiet', '-b', branch, path, from || `origin/${MAIN}`)
  else return { ok: false, error: 'give --branch <name> or --detach <ref>' }
  return r.status === 0 ? { ok: true, path } : { ok: false, error: `git worktree add: ${r.err.split('\n').pop()}` }
}

// ---- command line -----------------------------------------------------------------------------------------------

const isMain = process.argv[1] && resolve(process.argv[1]) === SELF
if (isMain) {
  const argv = process.argv.slice(2)
  const val = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined)
  const dryRun = argv.includes('--dry-run')
  const say = (l) => console.log(`WORKTREE_CLEAN: ${l}`)
  if (argv[0] === 'add') {
    const r = addWorktree(ROOT, argv[1], { branch: val('--branch'), from: val('--from'), detach: val('--detach') })
    if (!r.ok) { console.log(`WORKTREE_ADD: refused — ${r.error}`); process.exit(1) }
    console.log(`WORKTREE_ADD: ${r.path}`)
    process.exit(0)
  }
  const one = argv[0] === 'remove' ? argv[1] : val('--path')
  if (one) {
    const want = norm(resolve(one))
    const listed = listWorktrees(ROOT)
    const main = mainCheckout(ROOT, listed)
    const wt = listed.find((w) => same(w.path, want))
    if (!wt) say(`${want}: kept — git does not list it as a worktree, so its content cannot be checked`)
    else if (same(wt.path, main) || same(wt.path, ROOT)) say(`${want}: kept — it is the folder this runs in`)
    else say(cleanOne(main, wt, { repo: REPO || basename(main), live: liveRuns(main), handoffs: handoffTexts(main), youngMs: 0, dryRun }).line)
    process.exit(0)
  }
  if (argv.includes('--sweep')) {
    for (const l of sweep({ dryRun })) say(l)
    process.exit(0)
  }
  console.error('Usage: node scripts/worktree-clean.mjs --sweep [--dry-run] | --path <folder> | remove <folder> | add <review-|fix-|scratch-name> --branch <b> [--from <ref>] | --detach <ref>')
  process.exit(2)
}
