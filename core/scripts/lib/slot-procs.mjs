/**
 * Slot dev-server processes — find, recognise, start, wait for and stop the dev servers a checkout runs.
 * Shared by take-plan.mjs, slot-serve.mjs, slot-stop.mjs, orphan-sweep.mjs and free-merged-slots.mjs.
 *
 * A dev server is a process chain, e.g. `npm run dev:local` -> cmd.exe -> cross-env -> `node --watch index.js`
 * -> `node index.js` (the port owner). It is always stopped from the chain's ROOT, never from the process that
 * holds the port: killing only the port owner leaves the `node --watch` watcher alive and idle ("Waiting for
 * file changes before restarting") - the orphan leak. A start on a port that is already held
 * leaves the same orphan (the app dies on EADDRINUSE, the watcher stays), so a start is refused while the
 * port is held, and a start that never comes up is killed from its root.
 *
 * A chain belongs to a folder when one of its processes has that folder in its command line (on Linux also:
 * as its cwd). An orphan is a chain whose watcher has no child and that holds no port.
 *
 * .claude/.slot-pids records { pid, t } (t = process creation time), so a PID the OS has reused for another
 * program is never killed. PIDs in any other .claude/.*-pids file (e.g. a QA harness) belong to that harness:
 * a slot stop leaves those chains alone while they still serve a port.
 *
 * Node built-ins only; Windows (netstat/taskkill/PowerShell) and POSIX (lsof/ps/kill).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, readlinkSync, openSync, renameSync, statSync } from 'fs'
import { execFileSync, execSync, spawn } from 'child_process'
import { createHash } from 'crypto'
import { resolve, dirname, join, basename } from 'path'
import { fileURLToPath } from 'url'
import { ports } from './slot.mjs'
import { frontendCommand } from './fe-command.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(__dirname, '..', '..')
const isWin = process.platform === 'win32'
const pidsFileOf = (root) => join(root, '.claude', '.slot-pids')
const DEV_SERVER = /\b(node|nodemon|npm|npx|ng|vite|tsx|ts-node)(\.exe|\.cmd|\.js)?\b/i
// A process that can sit in a dev chain: npm/npx launchers, npm's cmd.exe/sh shell, cross-env, a watcher, a frontend dev server.
const CHAIN_CMD = /npm-cli\.js|npx-cli\.js|\bnpm(\.cmd)?\s|\bnpx(\.cmd)?\s|cross-env|--watch\b|\bng(\.js|\.cmd)?"?\s+serve\b|\bnodemon\b|\bvite\b|\bdev:local\b/i
// Never bash/powershell on Windows: the agent's own shell must not count as a chain root.
const CHAIN_NAME = isWin ? /^(node|cmd)\.exe$/i : /^(node|nodejs|npm|npx|sh|dash)$/i
const WATCHER = /--watch\b/

// --- the frontend dev server, from kit.config.json (rendered at install; a stack pack supplies the values) ---
// commands.dev     npm script that serves the frontend; no such script in package.json = no frontend.
// slots.feExec     optional: run this binary with `npm exec --` instead of the script (e.g. a framework CLI's serve).
// slots.fePortArgs args appended to the start command; {port} = this slot's frontend port. They must make the
//                  server FAIL when the port is taken, never move to the next port (e.g. a strict-port flag):
//                  "kept" detection and the refusal of a second start rely on the port.
// slots.feMatcher  regex (case-insensitive) that recognises the dev server's processes; default: `run <script>`.
// slots.feEnvFile  optional local environment file the frontend needs. When set and missing there is no
//                  frontend; before a start its slot copy (`.local` -> `.slot` in the name) is written with this
//                  slot's backend port.
// Rendered as JSON literals, so quotes, backslashes or backticks in a value cannot break this module.
const asList = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : String(v).split(',')).map((s) => String(s).trim()).filter(Boolean)
const FE_SCRIPT = String({{commands.dev|json}} || '')
const FE_EXEC = asList({{slots.feExec|json}})
const FE_PORT_ARGS = asList({{slots.fePortArgs|json}})
const FE_MATCHER_SRC = String({{slots.feMatcher|json}} || '')
const FE_ENV_FILE = String({{slots.feEnvFile|json}} || '')
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const FE_MATCHER = FE_MATCHER_SRC ? new RegExp(FE_MATCHER_SRC, 'i') : FE_SCRIPT ? new RegExp(`\\brun\\s+${escapeRe(FE_SCRIPT)}(\\s|"|$)`, 'i') : null

/** True when a command line is the frontend dev server (or a process of its chain). */
export const isFrontendCmd = (cmd) => Boolean(FE_MATCHER) && FE_MATCHER.test(cmd || '')

/** The project has a frontend dev server: commands.dev names a package.json script (and slots.feEnvFile exists, when set). */
export function hasFrontend(root = repoRoot) {
  if (!FE_SCRIPT) return false
  if (FE_ENV_FILE && !existsSync(join(root, FE_ENV_FILE))) return false
  try {
    return Boolean((JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts || {})[FE_SCRIPT])
  } catch {
    return false
  }
}

/** npm arguments that start the frontend dev server on `port` (built by fe-command.mjs, shared with the kit's report). */
export function frontendArgs(port) {
  return frontendCommand({ script: FE_SCRIPT, exec: FE_EXEC, portArgs: FE_PORT_ARGS, port })
}

const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })
  } catch {
    return ''
  }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

// --- process table -------------------------------------------------------------------

/** Every process: Map pid -> { pid, ppid, name, cmd, t, children: [pid] }. One OS call. */
export function processTable() {
  const table = new Map()
  if (isWin) {
    const ps = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,@{n='T';e={$_.CreationDate.ToFileTimeUtc()}} | ConvertTo-Json -Compress"
    let rows = []
    try {
      rows = JSON.parse(run('powershell', ['-NoProfile', '-Command', ps]) || '[]')
    } catch {
      rows = []
    }
    for (const r of [].concat(rows)) {
      table.set(r.ProcessId, { pid: r.ProcessId, ppid: r.ParentProcessId, name: r.Name || '', cmd: r.CommandLine || '', t: Number(r.T) || 0, children: [] })
    }
  } else {
    for (const line of run('ps', ['-axo', 'pid=,ppid=,args=']).split('\n')) {
      const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)
      if (!m) continue
      const cmd = m[3]
      const name = (cmd.split(/\s+/)[0] || '').split('/').pop()
      table.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), name, cmd, t: 0, children: [] })
    }
  }
  for (const p of table.values()) {
    const parent = parentOf(table, p)
    if (parent) parent.children.push(p.pid)
  }
  return table
}

/** The parent, unless its PID was reused by a process started after the child. */
function parentOf(table, p) {
  const parent = table.get(p.ppid)
  if (!parent || parent === p || p.ppid === 0) return null
  return parent.t <= p.t ? parent : null
}

/** pid -> [ports] for every TCP listener. */
export function listeners() {
  const map = new Map()
  const add = (pid, port) => map.set(pid, [...(map.get(pid) || []), port])
  if (isWin) {
    for (const line of run('netstat', ['-ano']).split(/\r?\n/)) {
      if (!/LISTENING/.test(line)) continue
      const cols = line.trim().split(/\s+/)
      add(Number(cols[cols.length - 1]), Number((cols[1] || '').split(':').pop()))
    }
  } else {
    let pid = null
    for (const line of run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pn']).split('\n')) {
      if (line[0] === 'p') pid = Number(line.slice(1))
      else if (line[0] === 'n' && pid) add(pid, Number(line.split(':').pop()))
    }
  }
  return map
}

export const isChainProc = (p) => Boolean(p) && CHAIN_NAME.test(p.name) && (CHAIN_CMD.test(p.cmd) || isFrontendCmd(p.cmd))
export const isDevServer = (cmd) => DEV_SERVER.test(cmd)

/** This process and its ancestors: never part of a chain we kill. */
function selfLine(table) {
  const set = new Set()
  let cur = table.get(process.pid)
  for (let i = 0; cur && i < 64; i++) {
    set.add(cur.pid)
    cur = parentOf(table, cur)
  }
  set.add(process.pid)
  return set
}

/** Topmost chain process above `pid` (pid itself when its parent is not part of a dev chain). */
export function chainRoot(table, pid, self = selfLine(table)) {
  let cur = table.get(pid)
  if (!cur) return pid
  for (let i = 0; i < 16; i++) {
    const parent = parentOf(table, cur)
    if (!parent || self.has(parent.pid) || !isChainProc(parent)) break
    cur = parent
  }
  return cur.pid
}

/** pid and all its descendants. */
export function subtree(table, pid) {
  const out = []
  const stack = [pid]
  while (stack.length) {
    const cur = stack.pop()
    if (out.includes(cur)) continue
    out.push(cur)
    stack.push(...((table.get(cur) || {}).children || []))
  }
  return out
}

const norm = (s) => (isWin ? s.replace(/\//g, '\\').toLowerCase() : s)
const folderKey = (folder) => norm(resolve(folder)).replace(/[\\/]+$/, '') + (isWin ? '\\' : '/')

function procInFolder(p, key) {
  // Trailing separator: the main folder never matches a slot folder whose name starts with it.
  if (norm(p.cmd).includes(key)) return true
  if (process.platform !== 'linux') return false
  try {
    return (readlinkSync(`/proc/${p.pid}/cwd`) + '/').startsWith(key)
  } catch {
    return false
  }
}

/**
 * Dev chains that belong to `folder`: [{ root, pids, cmd, ports, watcher, orphan }].
 * orphan = it runs a watcher with no child and none of its processes listens on a port.
 */
export function devChains(folder, table = processTable(), lst = listeners()) {
  const key = folderKey(folder)
  const self = selfLine(table)
  const roots = new Set()
  for (const p of table.values()) {
    if (self.has(p.pid) || !isChainProc(p)) continue
    if (procInFolder(p, key)) roots.add(chainRoot(table, p.pid, self))
  }
  // A root inside another root's tree is the same chain.
  const trees = [...roots].map((root) => ({ root, pids: subtree(table, root) }))
  return trees
    .filter((c) => !trees.some((o) => o.root !== c.root && o.pids.includes(c.root)))
    .filter((c) => !c.pids.some((pid) => self.has(pid)))
    .map((c) => {
      const procs = c.pids.map((pid) => table.get(pid)).filter(Boolean)
      const held = c.pids.flatMap((pid) => lst.get(pid) || [])
      const watchers = procs.filter((p) => /^node/i.test(p.name) && WATCHER.test(p.cmd))
      const idle = watchers.some((w) => w.children.length === 0)
      return { ...c, cmd: (table.get(c.root) || {}).cmd || '', ports: held, watcher: watchers.length > 0, orphan: idle && held.length === 0 }
    })
}

// --- killing ---------------------------------------------------------------------------

/** Kill a process and its children. Returns true when the kill command ran. */
export function killTree(pid) {
  try {
    if (isWin) execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    else {
      try { process.kill(-Number(pid), 'SIGTERM') } catch { process.kill(Number(pid), 'SIGTERM') }
    }
    return true
  } catch {
    return false
  }
}

/** Kill the whole chain a pid belongs to, from its root (POSIX: the root's descendants first). */
export function killChain(table, pid) {
  const root = chainRoot(table, pid)
  if (!isWin) for (const child of subtree(table, root).reverse()) killTree(child)
  killTree(root)
  return root
}

const short = (cmd) => (cmd || '').replace(/"[^"]*[\\/]([^\\/"]+)"/g, '$1').replace(/\s+/g, ' ').trim().slice(0, 80)

// --- ports -----------------------------------------------------------------------------

/** PID listening on a TCP port, or null. */
export function portOwnerPid(port) {
  for (const [pid, held] of listeners()) if (held.includes(Number(port))) return pid
  return null
}

/** Full command line of a process, or '' when unknown. */
export function commandLine(pid) {
  if (isWin) return run('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`]).trim()
  return run('ps', ['-o', 'args=', '-p', String(pid)]).trim()
}

/** Poll until something listens on `port`; returns its PID or null after timeoutMs (or once `alive()` turns false). */
export function waitForPort(port, timeoutMs, alive = () => true) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const pid = portOwnerPid(port)
    if (pid) return pid
    if (!alive()) return null
    sleep(1000)
  }
  return null
}

/** Poll until nothing listens on `port`; true when free within timeoutMs. */
export function waitForPortFree(port, timeoutMs) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (!portOwnerPid(port)) return true
    sleep(500)
  }
  return !portOwnerPid(port)
}

/**
 * What holds `port`: { pid: null } free, { pid, ours: true, root } a dev chain of `root`'s folder,
 * { pid, stale: true, cmd, root } a dev server from somewhere else, or { pid, foreign: true, cmd } another program.
 */
export function portState(port, { root = repoRoot, table, lst, retried = false } = {}) {
  lst = lst || listeners()
  let pid = null
  for (const [p, held] of lst) if (held.includes(Number(port))) pid = p
  if (!pid) return { pid: null }
  table = table || processTable()
  // A watcher restarting its app: the old owner is already gone from the table. Look again once.
  if (!table.has(pid) && !retried) {
    sleep(1500)
    return portState(port, { root, retried: true })
  }
  const chain = devChains(root, table, lst).find((c) => c.pids.includes(pid))
  if (chain) return { pid, ours: true, root: chain.root }
  const cmd = (table.get(pid) || {}).cmd || commandLine(pid)
  return isDevServer(cmd) || !cmd ? { pid, stale: true, cmd, root: chainRoot(table, pid) } : { pid, foreign: true, cmd }
}

// --- recorded PIDs -----------------------------------------------------------------------

/** [{ pid, t }] from .claude/.slot-pids (t = 0 for an entry in the old format). */
export function readSlotPids(root = repoRoot) {
  const file = pidsFileOf(root)
  if (!existsSync(file)) return []
  try {
    return (JSON.parse(readFileSync(file, 'utf8')).pids || []).map((e) => (typeof e === 'object' ? { pid: Number(e.pid), t: Number(e.t) || 0 } : { pid: Number(e), t: 0 }))
  } catch {
    return []
  }
}

/** Record chain roots with their creation time, so a reused PID is never mistaken for ours. */
export function writeSlotPids(pids, root = repoRoot, table = processTable()) {
  const seen = new Set()
  const entries = []
  for (const pid of pids.map(Number)) {
    const p = table.get(pid)
    if (!p || seen.has(pid)) continue
    seen.add(pid)
    entries.push({ pid, t: p.t })
  }
  mkdirSync(dirname(pidsFileOf(root)), { recursive: true })
  writeFileSync(pidsFileOf(root), JSON.stringify({ pids: entries }, null, 2))
}

/** PIDs recorded by another harness in this folder (.claude/.<name>-pids other than .slot-pids). */
function otherHarnessPids(root) {
  const dir = join(root, '.claude')
  const out = new Set()
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir)) {
    if (!/^\..+-pids$/.test(f) || f === '.slot-pids') continue
    try {
      for (const e of JSON.parse(readFileSync(join(dir, f), 'utf8')).pids || []) out.add(Number(typeof e === 'object' ? e.pid : e))
    } catch {
      continue
    }
  }
  return out
}

// --- stop / sweep --------------------------------------------------------------------------

/**
 * Stop a slot's servers: recorded chains (still the same process), any dev server on the slot's own ports,
 * and every other dev chain in the slot folder - orphans included. Another harness's chain that still
 * serves a port is left alone. Every kill is from the chain root. Returns log lines.
 */
export function stopSlotServers({ root = repoRoot, slotPorts = ports() } = {}) {
  const lines = []
  const table = processTable()
  const lst = listeners()
  const self = selfLine(table)
  const chains = devChains(root, table, lst)
  const harness = otherHarnessPids(root)
  const targets = new Map() // chain root -> why

  const add = (pid, why) => {
    const r = chainRoot(table, pid, self)
    if (self.has(r) || [...targets.keys()].some((k) => subtree(table, k).includes(r))) return
    for (const k of [...targets.keys()]) if (subtree(table, r).includes(k)) targets.delete(k)
    targets.set(r, why)
  }

  for (const rec of readSlotPids(root)) {
    const p = table.get(rec.pid)
    if (!p) continue
    const same = rec.t ? p.t === rec.t : chains.some((c) => c.pids.includes(rec.pid))
    if (same) add(rec.pid, 'recorded')
  }
  if (slotPorts) {
    for (const port of [slotPorts.be, slotPorts.fe]) {
      const st = portState(port, { root, table, lst })
      if (!st.pid) continue
      if (st.foreign) lines.push(`left PID ${st.pid} on port ${port} alone - not a dev server (${short(st.cmd)})`)
      else add(st.pid, `port ${port}`)
    }
  }
  for (const c of chains) {
    const isHarness = c.pids.some((pid) => harness.has(pid))
    if (isHarness && !c.orphan) continue
    add(c.root, c.orphan ? 'orphan' : 'in this folder')
  }

  for (const [r, why] of targets) {
    const cmd = (table.get(r) || {}).cmd
    if (killTree(r)) lines.push(`stopped PID ${r} (${why}: ${short(cmd)})`)
  }
  if (existsSync(pidsFileOf(root))) unlinkSync(pidsFileOf(root))
  return lines
}

/**
 * Kill orphan dev chains of `folder` only: a watcher with no child, holding no port. Safe in the main
 * folder: a server that holds a port is never touched. Returns log lines.
 */
export function sweepOrphans(folder = repoRoot) {
  const table = processTable()
  const lines = []
  for (const c of devChains(folder, table).filter((x) => x.orphan)) {
    if (killTree(c.root)) lines.push(`stopped orphan chain PID ${c.root} (${short(c.cmd)})`)
  }
  return lines
}

// --- start ------------------------------------------------------------------------------------

/** Last `n` lines of a log file ('' when missing). */
export function tail(file, n = 20) {
  if (!existsSync(file)) return ''
  return readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n').slice(-n).join('\n')
}

// On Windows a detached process started through cmd.exe (shell: true) loses its stdio handles, so the
// slot logs stayed empty. Run npm's own CLI under node directly instead; npm.cmd + shell is the fallback.
const NPM_CLI = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')

export function spawnNpm(args, opts) {
  const base = { ...opts, detached: true, windowsHide: true }
  if (isWin && existsSync(NPM_CLI)) return spawn(process.execPath, [NPM_CLI, ...args], base)
  return spawn(isWin ? 'npm.cmd' : 'npm', args, { ...base, shell: isWin })
}

/**
 * Start one dev server unless its port is held, then wait until it listens. A start that does not come up
 * (or whose port was taken by someone else meanwhile) is killed from its root, so it never leaves a watcher.
 * Returns { ok: true, root } or { ok: false, message }.
 */
export function startServer({ label, port, cwd, args, env, logPath, timeoutMs }) {
  const holder = portOwnerPid(port)
  if (holder) return { ok: false, message: `${label} not started: port ${port} is already held by PID ${holder} (${short(commandLine(holder))}). A second start would leave an idle watcher behind. Run node scripts/slot-stop.mjs if it is a leftover, then re-run.` }
  mkdirSync(dirname(logPath), { recursive: true })
  // Keep the previous run's log as <dir>/logs/<name>-<YYYYMMDD-HHmmss>.log instead of truncating it
  if (existsSync(logPath) && statSync(logPath).size > 0) {
    const stamp = new Date(statSync(logPath).mtimeMs).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
    const keepDir = join(dirname(logPath), 'logs')
    mkdirSync(keepDir, { recursive: true })
    try { renameSync(logPath, join(keepDir, `${basename(logPath, '.log')}-${stamp}.log`)) } catch { /* still held by a dying server: truncated below */ }
  }
  const logFd = openSync(logPath, 'w')
  const child = spawnNpm(args, { cwd, env: env || process.env, stdio: ['ignore', logFd, logFd] })
  child.unref()
  // The wait below blocks the event loop, so an 'exit' event would never fire: probe the PID instead.
  const alive = () => {
    try {
      process.kill(child.pid, 0)
      return true
    } catch {
      return false
    }
  }
  const owner = waitForPort(port, timeoutMs, alive)
  const table = processTable()
  if (!owner || !subtree(table, child.pid).includes(owner)) {
    killTree(child.pid)
    const why = owner ? `port ${port} was taken by PID ${owner}, not by this start` : `not listening on port ${port} after ${timeoutMs / 1000}s`
    return { ok: false, message: `${label} server ${why} - stopped what it started. Last lines of ${logPath}:\n${tail(logPath) || '(log is empty)'}` }
  }
  return { ok: true, root: child.pid }
}

// --- setup steps shared by take-plan.mjs and slot-serve.mjs --------------------------------------

/**
 * The folders whose dependencies a slot keeps installed: [dir, hash file under .claude/, label]. The root, the
 * workflow scripts' own package (scripts/package.json, kit-managed) and the backend when there is one.
 */
export function installDirs(root = repoRoot) {
  const out = [[root, '.last-npm-install-hash', '.']]
  if (existsSync(join(root, 'scripts', 'package.json'))) out.push([join(root, 'scripts'), '.last-npm-install-hash-scripts', 'scripts'])
  if (existsSync(join(root, 'server', 'package.json'))) out.push([join(root, 'server'), '.last-npm-install-hash-server', 'server'])
  return out
}

const lockHash = (lockPath) => createHash('sha256').update(readFileSync(lockPath)).digest('hex')

/**
 * Whether `dir` needs an npm install, without side effects: null (no lockfile, or the lockfile is unchanged since
 * the last install and the packages are there), 'changed' (no hash file at `hashPath`, or the lockfile's hash
 * differs) or 'missing' (hash matches, the lockfile lists packages, but <dir>/node_modules does not hold them: no
 * .package-lock.json there and, for npm 6 which writes none, a top-level package missing - a stale hash must not hide
 * packages that were never installed or were removed).
 */
export function installNeed(dir, hashPath) {
  const lockPath = join(dir, 'package-lock.json')
  if (!existsSync(lockPath)) return null
  const oldHash = existsSync(hashPath) ? readFileSync(hashPath, 'utf8').trim() : null
  if (lockHash(lockPath) !== oldHash) return 'changed'
  if (lockHasDeps(lockPath) && !packagesInstalled(dir, lockPath)) return 'missing'
  return null
}

/**
 * Whether <dir>/node_modules holds the lockfile's packages: npm 7+ writes node_modules/.package-lock.json; npm 6 does
 * not, so without it every top-level package the lockfile lists (optional ones aside) must have its package.json.
 */
function packagesInstalled(dir, lockPath) {
  if (existsSync(join(dir, 'node_modules', '.package-lock.json'))) return true
  let names = []
  try {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
    if (lock.packages && typeof lock.packages === 'object') {
      names = Object.entries(lock.packages)
        .filter(([k, v]) => /^node_modules\/(?:@[^/]+\/)?[^/]+$/.test(k) && !v?.optional)
        .map(([k]) => k.slice('node_modules/'.length))
    } else if (lock.dependencies && typeof lock.dependencies === 'object') {
      names = Object.entries(lock.dependencies).filter(([, v]) => !v?.optional).map(([k]) => k)
    }
  } catch {
    return false
  }
  return names.length > 0 && names.every((n) => existsSync(join(dir, 'node_modules', n, 'package.json')))
}

/**
 * Whether a package-lock.json lists any package besides the root: v2/v3 `packages` keys other than "", or v1
 * `dependencies`. npm never creates node_modules for a lockfile with none, so 'missing' would repeat forever.
 * An unreadable lockfile counts as having packages (the install then reports the real problem).
 */
function lockHasDeps(lockPath) {
  try {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
    if (lock.packages && typeof lock.packages === 'object') return Object.keys(lock.packages).some((k) => k !== '')
    return Boolean(lock.dependencies && Object.keys(lock.dependencies).length)
  } catch {
    return true
  }
}

/** The words for an installNeed reason in the install messages. */
export const installReason = (need) => (need === 'missing' ? 'packages missing' : 'lockfile changed')

/**
 * npm install when installNeed says so. Returns the reason ('changed' | 'missing', truthy) when it ran, else false.
 * A failed install throws an Error whose first line names the exact command to run by hand.
 */
export function npmInstallIfChanged(dir, hashFileName, root = repoRoot) {
  const hashPath = join(root, '.claude', hashFileName)
  const need = installNeed(dir, hashPath)
  if (!need) return false

  try {
    // Windows: npm.cmd needs a shell, and a shell must get one command string, not an args array (DEP0190).
    if (isWin) execSync('npm install', { cwd: dir, stdio: 'ignore' })
    else execFileSync('npm', ['install'], { cwd: dir, stdio: 'ignore' })
  } catch (e) {
    throw new Error(`${String(e.message).split('\n')[0]} - run \`npm install\` in ${dir} by hand`)
  }
  mkdirSync(dirname(hashPath), { recursive: true })
  writeFileSync(hashPath, lockHash(join(dir, 'package-lock.json')))
  return need
}

/**
 * The slot copy of slots.feEnvFile (environment.local.ts -> environment.slot.ts) with this slot's backend port.
 * No-op when the key is unset, the file is missing or its name has no `.local` part.
 */
export function generateEnvironmentSlot(bePort) {
  if (!FE_ENV_FILE) return
  const envLocalPath = join(repoRoot, FE_ENV_FILE)
  const slotName = basename(envLocalPath).replace(/\.local(\.[^.]+)$/, '.slot$1')
  if (!existsSync(envLocalPath) || slotName === basename(envLocalPath)) return
  const text = readFileSync(envLocalPath, 'utf8')
  // Rewrites only the localhost port on the apiUrl / authApiUrl lines, so the remote-link
  // branch (e.g. `viaRemote ? '' : <localhost url>`) survives into the slot file.
  const withApi = text.replace(
    /^(\s*(?:apiUrl|authApiUrl):[^\n]*?)'http:\/\/localhost:\d+'/gm,
    (_, lead) => `${lead}'http://localhost:${bePort}'`
  )
  const slotPath = join(dirname(envLocalPath), slotName)
  // Same content -> no write, so a running frontend dev server is not poked into a rebuild.
  if (existsSync(slotPath) && readFileSync(slotPath, 'utf8') === withApi) return
  writeFileSync(slotPath, withApi)
}
