/**
 * run-supervisor — starts scripts/run-plans.mjs on its own, outside the Claude Code session, and brings the run back
 * after a death or a rate limit (docs/agent/orchestrator.md → The supervisor). No model call: it starts, watches and
 * relaunches run-plans.mjs, and decides nothing a plan's tiers decide (INV-1).
 *
 *   node scripts/run-supervisor.mjs --run <run> --plans <NNN,NNN> [any run-plans.mjs flag]
 *     → prints `SUPERVISOR_STARTED <pid>` and returns at once; the supervisor runs detached (its own process group,
 *       no window), its output and the run's appended to .claude/orchestrator-runs/<run>.console.log.
 *   node scripts/run-supervisor.mjs --free-mem   → the free memory in GB (the helper /orchestrate's second-run rule uses)
 *
 * At start and again when the run ends it sweeps what runs left (orphan-sweep.mjs, free-merged-slots.mjs, the kit-made
 * worktrees worktree-clean.mjs judges safe) and prints one line per folder it removed or kept. Per launch of run-plans.mjs:
 * - `finished`, or `stopped` with any reason but a rate limit, or a refusal before the start: the supervisor ends;
 * - a child that exits while status.json still says `running`: the death is written as a stop
 *   (`process died (exit <code>)`) and the same command is launched again (merged plans are left out, git is the
 *   ledger), at most MAX_RELAUNCHES times; the next death stops the run with
 *   `supervisor gave up after <n> relaunches: <cause>`;
 * - `stopped` with `rate-limit`: relaunched after the reset time the error names, else after
 *   orchestrator.rateLimitWaitMin minutes; these relaunches do not count against MAX_RELAUNCHES, and the waits
 *   together stop at 6 hours;
 * - before every relaunch, free memory below MIN_FREE_MEM_GB waits, re-checked every 2 minutes, up to 60 minutes,
 *   then the run stops with `low memory: <n> GB free`.
 * Writes .claude/orchestrator-runs/<run>/supervisor.json (pid, launches, relaunches, waits).
 * Tests only: RUN_SUPERVISOR_MAX_RELAUNCHES, RUN_SUPERVISOR_MIN_FREE_MEM_GB replace the two limits;
 * RUN_SUPERVISOR_RUN_PLANS replaces the run-plans.mjs path (a fake child).
 */
import { spawn, spawnSync } from 'node:child_process'
import { openSync, closeSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { freemem } from 'node:os'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freeMemGb, runNameProblem } from './lib/orch-run.mjs'
import { sweep as sweepWorktrees } from './worktree-clean.mjs'

const SELF = fileURLToPath(import.meta.url)
const ROOT = resolve(dirname(SELF), '..')
// Fixed in code, the way BUILDER_IDLE_MIN is in run-plans.mjs: no setting (size budget orchestratorKeys is full).
export const MAX_RELAUNCHES = 3
export const MIN_FREE_MEM_GB = 4
export const MEM_POLL_MIN = 2
export const MEM_WAIT_MAX_MIN = 60
export const RATE_LIMIT_CAP_MIN = 6 * 60
const RATE_LIMIT_WAIT_MIN = Number(30) >= 0 ? Number(30) : 30

const envNum = (k, d) => {
  const v = process.env[k]
  return v !== undefined && v !== '' && Number(v) >= 0 ? Number(v) : d
}
/** The two limits, with their test-only overrides. */
export const limits = () => ({ maxRelaunches: envNum('RUN_SUPERVISOR_MAX_RELAUNCHES', MAX_RELAUNCHES), minFreeMemGb: envNum('RUN_SUPERVISOR_MIN_FREE_MEM_GB', MIN_FREE_MEM_GB) })

const nowIso = () => new Date().toISOString()
export const runsDir = (root) => join(root, '.claude', 'orchestrator-runs')
export const consoleLogPath = (root, run) => join(runsDir(root), `${run}.console.log`)
const statusFile = (root, run) => join(runsDir(root), run, 'status.json')
const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

/**
 * The reset time a rate-limit message names, as epoch ms, or null: `…|1762606800` (epoch seconds, the CLI's usage
 * limit line), an ISO time, or `resets 3pm` / `reset at 15:30` (the next such local time). Past times give null.
 */
export function rateLimitResetMs(text, nowMs) {
  const s = String(text ?? '')
  let at = null
  const epoch = /\|\s*(\d{10})\b/.exec(s)
  const iso = /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)/.exec(s)
  const clock = /\bresets?\b(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(s)
  if (epoch) at = Number(epoch[1]) * 1000
  else if (iso && Number.isFinite(Date.parse(iso[1]))) at = Date.parse(iso[1])
  else if (clock && (clock[3] || clock[2])) {
    let h = Number(clock[1]) % (clock[3] ? 12 : 24)
    if (clock[3] && clock[3].toLowerCase() === 'pm') h += 12
    const d = new Date(nowMs)
    d.setHours(h, Number(clock[2] ?? 0), 0, 0)
    if (d.getTime() <= nowMs) d.setDate(d.getDate() + 1)
    at = d.getTime()
  }
  return at !== null && at > nowMs ? at : null
}

/**
 * What one launch of run-plans.mjs ended in, from status.json before and after it:
 * finished | stopped | rate-limit | refused (the launch never reached `init`) | died.
 */
export function classify(before, after, exit) {
  if (!after || (after.attempts ?? 0) <= (before?.attempts ?? 0)) return { kind: 'refused', reason: `run-plans.mjs ended before the run started (exit ${exit})` }
  if (after.phase === 'finished') return { kind: 'finished', reason: 'finished' }
  if (after.phase === 'stopped') {
    const reason = String(after.stopReason ?? 'stopped')
    return /^rate-limit/.test(reason) ? { kind: 'rate-limit', reason } : { kind: 'stopped', reason }
  }
  return { kind: 'died', reason: `process died (exit ${exit})` }
}

/**
 * The spawn options of a child that outlives its parent, stdout and stderr to an append-mode fd. `console: true` (the
 * run itself): on Windows not detached, so it gets its own hidden console that every git and node call it makes shares —
 * a detached Windows process has no console, and then each console program it starts opens a window of its own. A
 * Windows child is not ended with its parent, so the run still outlives the supervisor. Elsewhere: its own process group.
 */
export function detachedOptions(fd, { cwd, env = process.env, console: own = false, platform = process.platform } = {}) {
  return { cwd, env, detached: !(own && platform === 'win32'), windowsHide: true, stdio: ['ignore', fd, fd] }
}

/** Starts the supervisor detached and returns its pid; the caller can exit at once. */
export function launch({ root = ROOT, argv, env = process.env, script = SELF }) {
  const run = valueOf(argv, 'run')
  const log = consoleLogPath(root, run)
  mkdirSync(dirname(log), { recursive: true })
  const fd = openSync(log, 'a')
  const child = spawn(process.execPath, [script, '--supervise', ...argv], detachedOptions(fd, { cwd: root, env }))
  child.unref()
  closeSync(fd)
  return child.pid
}

function valueOf(argv, key) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${key}`) return argv[i + 1]
    if (argv[i].startsWith(`--${key}=`)) return argv[i].slice(key.length + 3)
  }
  return undefined
}

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms))

/** One launch of run-plans.mjs, detached too (a supervisor that dies leaves the run alive): resolves with its exit. */
function runChild({ root, runPlans, runArgs }) {
  return new Promise((done) => {
    const log = consoleLogPath(root, valueOf(runArgs, 'run'))
    mkdirSync(dirname(log), { recursive: true })
    const fd = openSync(log, 'a')
    const child = spawn(process.execPath, [runPlans, ...runArgs], detachedOptions(fd, { cwd: root, env: { ...process.env, RUN_SUPERVISOR_LOG: '1' }, console: true }))
    closeSync(fd)
    child.on('error', (e) => done({ exit: `spawn error: ${e.message}`, pid: null }))
    child.on('exit', (code, signal) => done({ exit: code ?? signal ?? 'unknown', pid: child.pid }))
  })
}

/** `orch-state.mjs stop --reason <reason>`: the stop is appended to status.json stops[] and the slots go back. */
function stopRun(root, run, reason) {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'orch-state.mjs'), 'stop', '--run', run, '--reason', reason], { cwd: root, encoding: 'utf8', windowsHide: true })
  return r.status === 0
}

/**
 * The supervisor loop. Everything outside the child is injectable for the tests: freeMem (GB), sleep, now, log.
 * Returns { outcome, reason, launches, relaunches, rateWaitMin }.
 */
export async function supervise({ root = ROOT, runArgs, runPlans = process.env.RUN_SUPERVISOR_RUN_PLANS || join(root, 'scripts', 'run-plans.mjs'), freeMem = () => freeMemGb(freemem()), sleep = sleepReal, now = Date.now, log = (l) => console.log(l), lim = limits(), rateLimitWaitMin = RATE_LIMIT_WAIT_MIN, sweep = true } = {}) {
  const run = valueOf(runArgs, 'run')
  const sup = { run, pid: process.pid, startedAt: nowIso(), args: runArgs, launches: [], relaunches: 0, waits: [], phase: 'supervising' }
  const save = () => {
    mkdirSync(join(runsDir(root), run), { recursive: true })
    writeFileSync(join(runsDir(root), run, 'supervisor.json'), `${JSON.stringify({ ...sup, updatedAt: nowIso() }, null, 2)}\n`)
  }
  const end = (outcome, reason) => {
    // The run is over (finished, stopped or given up): its merged folders go now, not at the next start.
    if (sweep) for (const l of sweepLeftovers({ root })) log(`SUPERVISOR_SWEEP: ${l}`)
    sup.phase = outcome
    sup.reason = reason
    save()
    log(`SUPERVISOR: ${outcome} — ${reason}`)
    return { outcome, reason, launches: sup.launches.length, relaunches: sup.relaunches, rateWaitMin: sup.waits.filter((w) => w.kind === 'rate-limit').reduce((a, w) => a + w.minutes, 0) }
  }
  const giveUp = (reason) => {
    stopRun(root, run, reason)
    return end('gave-up', reason)
  }
  // Written before anything else: until run-plans.mjs writes status.json (after its preflight and plan lint), this file
  // is how `orch-state.mjs watch` tells a run that is starting from one that does not exist.
  save()
  if (sweep) for (const l of sweepLeftovers({ root })) log(`SUPERVISOR_SWEEP: ${l}`)
  let rateWaitMs = 0
  for (;;) {
    const before = readJson(statusFile(root, run))
    log(`SUPERVISOR: launch ${sup.launches.length + 1} · ${nowIso()} · node ${runPlans.replace(/\\/g, '/')} ${runArgs.join(' ')}`)
    const r = await runChild({ root, runPlans, runArgs })
    const c = classify(before, readJson(statusFile(root, run)), r.exit)
    sup.launches.push({ at: nowIso(), pid: r.pid, exit: r.exit, kind: c.kind, reason: c.reason })
    save()
    if (['finished', 'stopped', 'refused'].includes(c.kind)) return end('done', `${c.kind}: ${c.reason}`)
    if (c.kind === 'died') {
      if (sup.relaunches >= lim.maxRelaunches) return giveUp(`supervisor gave up after ${lim.maxRelaunches} relaunches: ${c.reason}`)
      stopRun(root, run, c.reason)
      sup.relaunches++
      log(`SUPERVISOR: ${c.reason} — relaunch ${sup.relaunches} of ${lim.maxRelaunches}`)
    } else {
      const resetAt = rateLimitResetMs(c.reason, now())
      // One minute past a named reset; else the configured wait.
      const waitMs = resetAt ? resetAt - now() + 60_000 : rateLimitWaitMin * 60_000
      if (rateWaitMs + waitMs > RATE_LIMIT_CAP_MIN * 60_000) return giveUp(`supervisor gave up: the rate-limit waits would pass ${RATE_LIMIT_CAP_MIN / 60} hours (${Math.round(rateWaitMs / 60_000)} min waited, next ${Math.round(waitMs / 60_000)} min) — ${c.reason}`)
      rateWaitMs += waitMs
      sup.waits.push({ at: nowIso(), kind: 'rate-limit', minutes: Math.round(waitMs / 60_000), until: new Date(now() + waitMs).toISOString() })
      save()
      log(`SUPERVISOR: ${c.reason.slice(0, 200)} — waiting ${Math.round(waitMs / 60_000)} min${resetAt ? ' (the reset the error names)' : ''}, then the same command`)
      await sleep(waitMs)
    }
    // Free memory before every relaunch: wait while it is below the floor, re-checked every MEM_POLL_MIN minutes.
    let free = freeMem()
    let waited = 0
    while (free < lim.minFreeMemGb) {
      if (waited >= MEM_WAIT_MAX_MIN) {
        sup.waits.push({ at: nowIso(), kind: 'memory', minutes: waited })
        return giveUp(`low memory: ${free} GB free`)
      }
      log(`SUPERVISOR: ${free} GB free memory, ${lim.minFreeMemGb} GB needed — re-checking in ${MEM_POLL_MIN} min (${waited} of ${MEM_WAIT_MAX_MIN} min waited)`)
      await sleep(MEM_POLL_MIN * 60_000)
      waited += MEM_POLL_MIN
      free = freeMem()
    }
    if (waited) sup.waits.push({ at: nowIso(), kind: 'memory', minutes: waited })
  }
}

// ---- the leftover sweep -----------------------------------------------------------------------------------------

/**
 * What dead runs left, at a run's start and end: one line per folder removed or kept, with the reason.
 * orphan-sweep.mjs (orphaned dev processes) and free-merged-slots.mjs --no-fetch --no-sweep (slots on merged branches,
 * merge folders of merged runs) run as they are; then worktree-clean.mjs's sweep judges every kit-made worktree
 * (builders, merge and review folders, agent folders) by its rules: clean, merged or safe on origin, not parked, not in
 * a hand-off, run not live. `git worktree remove` without --force, the branch kept; a held Windows folder is a line.
 */
export function sweepLeftovers({ root = ROOT } = {}) {
  const lines = []
  for (const [script, args] of [['orphan-sweep.mjs', ['--quiet']], ['free-merged-slots.mjs', ['--no-fetch', '--no-sweep']]]) {
    const p = join(root, 'scripts', script)
    if (!existsSync(p)) continue
    const r = spawnSync(process.execPath, [p, ...args], { cwd: root, encoding: 'utf8', timeout: 5 * 60_000, windowsHide: true })
    for (const l of `${r.stdout ?? ''}`.split('\n').map((x) => x.trim()).filter(Boolean)) lines.push(`${script}: ${l}`)
    if (r.status !== 0) lines.push(`${script}: exit ${r.status} — ${String(r.stderr ?? '').trim().split('\n').pop() || 'no output'}`)
  }
  lines.push(...sweepWorktrees({ root }))
  if (!lines.length) lines.push('nothing left by earlier runs')
  return lines
}

// ---- command line -----------------------------------------------------------------------------------------------

const isMain = process.argv[1] && resolve(process.argv[1]) === SELF
if (isMain) {
  const argv = process.argv.slice(2)
  if (argv.includes('--free-mem')) {
    console.log(freeMemGb(freemem()))
    process.exit(0)
  }
  const supervising = argv[0] === '--supervise'
  const runArgs = supervising ? argv.slice(1) : argv
  const run = valueOf(runArgs, 'run')
  const problem = !run ? '--run is missing' : runNameProblem(run) ?? (!valueOf(runArgs, 'plans') ? '--plans is missing' : runArgs.includes('--dry-run') ? '--dry-run is run with run-plans.mjs itself' : null)
  if (problem) {
    console.error(`usage: node scripts/run-supervisor.mjs --run <run> --plans <NNN,NNN> [run-plans.mjs flags] — ${problem}`)
    process.exit(2)
  }
  if (!supervising) {
    console.log(`SUPERVISOR_STARTED ${launch({ argv: runArgs })}`)
    process.exit(0)
  }
  supervise({ runArgs }).then((r) => process.exit(r.outcome === 'done' ? 0 : 2), (e) => {
    console.error(`SUPERVISOR: crashed — ${e?.stack ?? e}`)
    process.exit(1)
  })
}
