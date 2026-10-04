/**
 * Slot dev-server processes — find, recognise, wait for and stop the servers a
 * slot runs on its dedicated ports. Shared by take-plan.mjs, slot-stop.mjs and
 * free-merged-slots.mjs (via slot-stop.mjs).
 *
 * "Ours" = a PID recorded in .claude/.slot-pids, or any descendant of one (a
 * watch-mode server restarts its child under a new PID). A slot's ports are
 * reserved for that slot, so a leftover dev server (node/npm/ng/vite) found on
 * them is treated as stale and stopped; any other program there is refused.
 *
 * Node built-ins only; Windows (netstat/taskkill/PowerShell) and POSIX (lsof/ps/kill).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { execFileSync } from 'child_process'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { ports } from './slot.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..', '..')
const isWin = process.platform === 'win32'
const pidsFile = join(repoRoot, '.claude', '.slot-pids')
const DEV_SERVER = /\b(node|nodemon|npm|npx|ng|vite|tsx|ts-node)(\.exe|\.cmd|\.js)?\b/i

const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return ''
  }
}

/** PID listening on a TCP port, or null. */
export function portOwnerPid(port) {
  if (isWin) {
    for (const line of run('netstat', ['-ano']).split(/\r?\n/)) {
      if (!/LISTENING/.test(line)) continue
      const cols = line.trim().split(/\s+/)
      if ((cols[1] || '').split(':').pop() === String(port)) return Number(cols[cols.length - 1])
    }
    return null
  }
  const pid = run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).trim().split(/\s+/)[0]
  return pid ? Number(pid) : null
}

/** Full command line of a process, or '' when unknown. */
export function commandLine(pid) {
  if (isWin) return run('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`]).trim()
  return run('ps', ['-o', 'args=', '-p', String(pid)]).trim()
}

function parentPid(pid) {
  const out = isWin
    ? run('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").ParentProcessId`])
    : run('ps', ['-o', 'ppid=', '-p', String(pid)])
  const n = Number(out.trim())
  return Number.isInteger(n) && n > 0 ? n : null
}

/** True when pid is one of `roots` or descends from one (up to 12 levels). */
export function isOursOrChild(pid, roots) {
  const set = new Set(roots.map(Number))
  let cur = Number(pid)
  for (let i = 0; cur && i < 12; i++) {
    if (set.has(cur)) return true
    cur = parentPid(cur)
  }
  return false
}

export const isDevServer = (cmd) => DEV_SERVER.test(cmd)

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

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** Poll until something listens on `port`; returns its PID or null after timeoutMs. */
export function waitForPort(port, timeoutMs) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const pid = portOwnerPid(port)
    if (pid) return pid
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

/** Last `n` lines of a log file ('' when missing). */
export function tail(file, n = 20) {
  if (!existsSync(file)) return ''
  return readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n').slice(-n).join('\n')
}

export function readSlotPids() {
  if (!existsSync(pidsFile)) return []
  try {
    return (JSON.parse(readFileSync(pidsFile, 'utf8')).pids || []).map(Number)
  } catch {
    return []
  }
}

export function writeSlotPids(pids) {
  mkdirSync(dirname(pidsFile), { recursive: true })
  writeFileSync(pidsFile, JSON.stringify({ pids: [...new Set(pids.map(Number))] }, null, 2))
}

/**
 * Classify what holds a slot port: { pid: null } free, { pid, ours: true }, { pid, stale: true, cmd } a leftover
 * dev server, or { pid, foreign: true, cmd } some other program.
 */
export function portState(port, recorded = readSlotPids()) {
  const pid = portOwnerPid(port)
  if (!pid) return { pid: null }
  if (recorded.length && isOursOrChild(pid, recorded)) return { pid, ours: true }
  const cmd = commandLine(pid)
  return isDevServer(cmd) || !cmd ? { pid, stale: true, cmd } : { pid, foreign: true, cmd }
}

/** Stop this slot's servers: every recorded PID tree, then any dev server left on the slot ports. Returns log lines. */
export function stopSlotServers() {
  const lines = []
  for (const pid of readSlotPids()) if (killTree(pid)) lines.push(`stopped recorded PID ${pid}`)
  const p = ports()
  if (p) {
    for (const port of [p.be, p.fe]) {
      const st = portState(port, [])
      if (st.pid && !st.foreign && killTree(st.pid)) lines.push(`stopped PID ${st.pid} on port ${port}${st.cmd ? ` (${st.cmd.slice(0, 80)})` : ''}`)
      else if (st.foreign) lines.push(`left PID ${st.pid} on port ${port} alone - not a dev server (${st.cmd.slice(0, 80)})`)
    }
  }
  if (existsSync(pidsFile)) unlinkSync(pidsFile)
  return lines
}
