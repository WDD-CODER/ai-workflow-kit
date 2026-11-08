/**
 * Builder folders of an orchestrator run (docs/agent/orchestrator.md): which idle permanent slot a plan can use,
 * how it is claimed and released, and how a folder that is not a slot gets its packages. Used by
 * scripts/orch-state.mjs (`worktree`, `release`); every function takes its folders and commands as arguments, so tests
 * can run them in a scratch repository.
 */
import { existsSync, writeFileSync, unlinkSync, realpathSync, readFileSync, mkdirSync, rmSync } from 'fs'
import { createHash } from 'crypto'
import { spawnSync } from 'child_process'
import { join } from 'path'

const run = (cwd, cmd, args) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' && cmd !== 'git' })
  return { status: r.status ?? 1, out: (r.stdout ?? '').replace(/\r?\n+$/, ''), err: (r.stderr ?? '').trim() }
}
const git = (cwd, ...a) => run(cwd, 'git', a)

export const lockFile = (pm) => (pm === 'pnpm' ? 'pnpm-lock.yaml' : 'package-lock.json')

/** The install a folder without packages gets: [command, args]. */
export function installCommand(pm) {
  return pm === 'pnpm' ? ['pnpm', ['install', '--frozen-lockfile']] : ['npm', ['ci', '--no-audit', '--no-fund']]
}

/** pnpm 10 skips dependency build scripts unless package.json pnpm.onlyBuiltDependencies lists them: the names it skipped. */
export function ignoredBuildScripts(out) {
  const m = /Ignored build scripts:\s*([^\n]+)/.exec(String(out ?? ''))
  return m ? m[1].split(',').map((s) => s.trim().replace(/\.$/, '')).filter(Boolean) : []
}

/** The folders (relative to a project root) that hold their own package.json: the root, scripts/ and the backend. */
export function depFolders(mainRoot, serverRoot = '') {
  const server = String(serverRoot ?? '').replace(/[\\/]+$/, '')
  return ['.', 'scripts', ...(server ? [server] : [])].filter((f) => existsSync(join(mainRoot, f, 'package.json')))
}

/**
 * Makes sure `dst` (a builder folder) has its packages: a folder that already has node_modules (an idle slot, which is
 * provisioned once) is left alone, any other installs with the package manager (with pnpm every folder shares one
 * store, so this is quick). Packages are never linked from the main folder: git removes a worktree through a Windows
 * junction and would delete the main folder's packages with it. Returns { ok, lines }; ok is false when scripts/
 * still lacks picomatch (the scope guard refuses every edit without it).
 */
export function ensureDeps({ mainRoot, dst, serverRoot = '', pm = 'npm' }) {
  const lines = []
  for (const f of depFolders(mainRoot, serverRoot)) {
    const to = join(dst, f)
    if (!existsSync(join(to, 'package.json')) || existsSync(join(to, 'node_modules'))) continue
    // scripts/ is kit-managed and keeps an npm lock file whatever the project uses.
    const fpm = f === 'scripts' ? 'npm' : pm
    // A frozen install needs a lock file. A project folder without one (a project that keeps none) is left as it is;
    // scripts/ holds only the workflow's own few packages and is the one the guard needs, so it installs without one.
    const hasLock = existsSync(join(to, lockFile(fpm)))
    if (!hasLock && f !== 'scripts') {
      lines.push(`no ${lockFile(fpm)} in ${f}: nothing installed`)
      continue
    }
    // Without a lock file the install writes none either: a new package-lock.json would make the folder dirty (the
    // merge folder must stay clean for `clean` and `finish`).
    const [cmd, a] = hasLock ? installCommand(fpm) : ['npm', ['install', '--no-audit', '--no-fund', '--no-package-lock']]
    const r = run(to, cmd, a)
    lines.push(r.status === 0 ? `installed the ${f === '.' ? 'root' : f} packages (${cmd} ${a[0]})` : `install in ${f} failed: ${(r.err || r.out).split('\n').pop()}`)
    const skipped = ignoredBuildScripts(`${r.out}\n${r.err}`)
    if (skipped.length) lines.push(`WARN ${f === '.' ? 'root' : f}: pnpm ignored build scripts (${skipped.join(', ')}) — list them in package.json pnpm.onlyBuiltDependencies, or they never compile`)
  }
  const ok = !existsSync(join(dst, 'scripts', 'package.json')) || existsSync(join(dst, 'scripts', 'node_modules', 'picomatch'))
  return { ok, lines }
}

// ---- ensure-env: the one function every step calls before it runs code in a folder --------------------------------------

/** The marker of a tree's last install (the files scripts/lib/slot-procs.mjs writes under .claude/). */
const markerOf = (f) => (f === '.' ? '.last-npm-install-hash' : `.last-npm-install-hash-${f === 'scripts' ? 'scripts' : 'server'}`)
const lockHashOf = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

/**
 * Makes sure `folder` has its packages before code runs there: an install with the lockfile in the root, in the backend
 * (`serverRoot`, when it has a package.json) and in scripts/. A tree is skipped when node_modules is there and its
 * lockfile's hash equals the marker `.claude/.last-npm-install-hash*`. `clean` reinstalls from scratch (node_modules
 * removed first), only the trees in `only` (the failing tree of an environment failure; default every tree).
 * `runner(cwd, cmd, args)` is injectable for tests. Returns { ok, lines, installed: [tree…] }; ok is false when an
 * install failed.
 */
export function ensureEnv({ folder, serverRoot = '', pm = 'npm', clean = false, only = null, runner = run, remove = (p) => rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) }) {
  const lines = []
  const installed = []
  let ok = true
  for (const f of depFolders(folder, serverRoot)) {
    if (only && !only.includes(f)) continue
    const to = join(folder, f)
    const fpm = f === 'scripts' ? 'npm' : pm
    const lock = join(to, lockFile(fpm))
    const hasLock = existsSync(lock)
    if (!hasLock && f !== 'scripts') {
      lines.push(`ensure-env: no ${lockFile(fpm)} in ${f}: nothing installed`)
      continue
    }
    const marker = join(folder, '.claude', markerOf(f))
    const hash = hasLock ? lockHashOf(lock) : null
    let seen = null
    try {
      seen = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : null
    } catch { /* no marker */ }
    const there = existsSync(join(to, 'node_modules'))
    if (!clean && there && (!hasLock || hash === seen)) continue
    // A failed remove or install is reported (ok: false), never thrown: a throw here would escape the gate or the merge
    // before it undoes its work.
    if (clean && there) {
      try {
        // The marker goes first: a tree half-deleted by a failed remove is then reinstalled by the next ensure-env.
        rmSync(marker, { force: true })
        remove(join(to, 'node_modules'))
      } catch (e) {
        ok = false
        lines.push(`ensure-env: could not remove ${f === '.' ? 'root' : f} node_modules: ${String(e?.message ?? e).split('\n')[0]}`)
        continue
      }
    }
    const [cmd, a] = hasLock ? installCommand(fpm) : ['npm', ['install', '--no-audit', '--no-fund', '--no-package-lock']]
    let r
    try {
      r = runner(to, cmd, a)
    } catch (e) {
      r = { status: 1, out: '', err: String(e?.message ?? e) }
    }
    if (r.status === 0) {
      installed.push(f)
      lines.push(`ensure-env: ${clean ? 'reinstalled' : 'installed'} the ${f === '.' ? 'root' : f} packages (${cmd} ${a[0]})`)
      if (hash) {
        try {
          mkdirSync(join(folder, '.claude'), { recursive: true })
          writeFileSync(marker, `${hash}\n`)
        } catch { /* the next call installs again */ }
      }
    } else {
      ok = false
      lines.push(`ensure-env: install in ${f} failed: ${(r.err || r.out).split('\n').pop()}`)
    }
  }
  return { ok, lines, installed }
}

/** Output that says packages are missing or broken (the only environment failure a clean reinstall can repair). */
export const PACKAGE_FAIL_RE = /Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|is not recognized as an internal or external command|command not found/

/**
 * Which tree an environment failure's output names — or null when no line says packages are missing (a network, port
 * or database failure, even with node_modules in its stack trace: no tree is deleted). Only the lines that say so are
 * read: the backend or scripts/ when such a line shows its path, else the root.
 */
export function failingTree(out, folders) {
  const lines = String(out ?? '').replace(/\\/g, '/').split('\n').filter((l) => PACKAGE_FAIL_RE.test(l))
  if (!lines.length) return null
  const text = lines.join('\n')
  return folders.filter((f) => f !== '.').find((f) => text.includes(`${f}/`)) ?? '.'
}

// ---- retried git calls ------------------------------------------------------------------------------------------------

/** A git failure that is gone the next time: a lock or ref race, or the network. */
export const TRANSIENT_GIT_RE = /incorrect old value|cannot lock ref|unable to access|could not resolve host|connection (?:reset|timed out|refused)|early eof|remote end hung up|network is unreachable|operation timed out/i

/** Sleeps `ms` without a promise (the synchronous callers of git). */
export const sleepSync = (ms) => {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * `git fetch` and `git push` retried: up to `tries` runs, `delayMs` apart, only while the error is transient
 * (TRANSIENT_GIT_RE). Any other command, or any other error, is answered by its first run. `exec(cwd, args)` and
 * `sleep(ms)` are injectable for tests. Returns the last { status, out, err }.
 */
export function retryGit(cwd, args, { exec = (c, a) => git(c, ...a), sleep = sleepSync, tries = 3, delayMs = 5000 } = {}) {
  const retryable = args[0] === 'fetch' || args[0] === 'push'
  let r = exec(cwd, args)
  for (let i = 1; retryable && r.status !== 0 && i < tries && TRANSIENT_GIT_RE.test(`${r.err}\n${r.out}`); i++) {
    sleep(delayMs)
    r = exec(cwd, args)
  }
  return r
}

// The slot's own runtime files (.worktree-root, -port, -plan) are not work, even where a project did not exclude them.
const dirty = (path) => git(path, 'status', '--porcelain').out.split('\n').filter((l) => l && !/^\?\? \.worktree-/.test(l)).length > 0

/**
 * The first slot that is idle: detached, no .worktree-plan marker, not validating a branch for the Human
 * (.worktree-validating), nothing uncommitted. `slots` is listSlots() output.
 */
export function idleSlot(slots, skip = []) {
  for (const s of slots) {
    if (skip.includes(s.path) || !s.detached || s.plan || s.validating) continue
    if (dirty(s.path)) continue
    return s
  }
  return null
}

/** Claims a slot for a plan: the plan branch (new from `base`, or the existing one) is checked out and .worktree-plan names the plan. */
export function claimSlot({ slot, branch, base, planPath, branchExists }) {
  // --no-track: a plan branch never takes the run branch as its upstream (a bare push would go there).
  const s = branchExists ? git(slot.path, 'switch', '--quiet', branch) : git(slot.path, 'switch', '--quiet', '--no-track', '-c', branch, base)
  if (s.status !== 0) return { ok: false, error: `git switch in ${slot.path}: ${s.err.split('\n').pop()}` }
  writeFileSync(join(slot.path, '.worktree-plan'), `${planPath}\n`)
  return { ok: true }
}

const slashed = (p) => String(p ?? '').replace(/\\/g, '/').replace(/\/+$/, '')

/** A folder's canonical form: real path (symlinks, junctions and Windows 8.3 names like RUNNER~1 resolved), slashes, no trailing slash. */
export function canonicalPath(p) {
  let out = slashed(p)
  if (!out) return ''
  try {
    out = slashed(realpathSync.native(out))
  } catch { /* not on disk: the plain spelling */ }
  return process.platform === 'win32' ? out.toLowerCase() : out
}

/** True when two spellings name the same folder (git prints the long form, a status file may hold a short or aliased one). */
export const samePath = (a, b) => Boolean(slashed(a) && slashed(b)) && canonicalPath(a) === canonicalPath(b)

/**
 * Every slot a run still holds (status.plans[n].slot, the path `worktree` recorded) is given back through releaseSlot
 * when the run stops or finishes; a released slot loses its `slot` field. `slots` is listSlots() output. Returns
 * { lines, released }: one line per slot — `plan NNN: slot wt-n released` or `… kept — <why>`.
 */
export function releaseRunSlots({ status, slots, target }) {
  const lines = []
  let released = 0
  for (const p of Object.values(status?.plans ?? {})) {
    if (!p.slot) continue
    const slot = (slots ?? []).find((s) => samePath(s.path, p.slot))
    if (!slot) {
      lines.push(`plan ${p.nnn}: slot ${p.slot} is no longer a worktree`)
      delete p.slot
      continue
    }
    const r = releaseSlot({ path: slot.path, branch: p.branch ?? slot.branch ?? '', target })
    if (r.released) {
      released++
      delete p.slot
      lines.push(`plan ${p.nnn}: slot wt-${slot.slot} released`)
    } else lines.push(`plan ${p.nnn}: slot wt-${slot.slot} kept — ${r.why}`)
  }
  return { lines, released }
}

/**
 * Gives a slot back: detached at `target`, marker removed. Kept as it is (never discarded) when it has uncommitted files,
 * or when its branch has commits that are neither on origin nor in `target`.
 */
export function releaseSlot({ path, branch, target }) {
  if (dirty(path)) return { released: false, why: 'uncommitted files in the slot' }
  const here = git(path, 'branch', '--show-current').out
  if (here && here === branch) {
    const pushed = git(path, 'rev-parse', '--verify', '--quiet', `origin/${branch}`).status === 0 && git(path, 'rev-list', '--count', `origin/${branch}..${branch}`).out === '0'
    const merged = git(path, 'merge-base', '--is-ancestor', branch, target).status === 0
    if (!pushed && !merged) return { released: false, why: `${branch} has commits that are not pushed or merged` }
  }
  const d = git(path, 'switch', '--quiet', '--detach', target)
  if (d.status !== 0) return { released: false, why: `git switch --detach ${target}: ${d.err.split('\n').pop()}` }
  try {
    unlinkSync(join(path, '.worktree-plan'))
  } catch { /* no marker */ }
  return { released: true }
}
