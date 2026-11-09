import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { FleetPlanView, FleetRunView, FleetRuns, FleetStep } from '../types'

// ---------------------------------------------------------------------------
// run progress (part of fleet): while an /orchestrate run is live in this
// checkout, a dock chip `run <name> NN%` that opens a panel: per plan a step bar
// (build · gate · review · merge) with each step's time and a clock that ticks
// on the running step, the model, round and tokens, the gate check running now
// and what the builder is doing. Read-only and token-free: it reads the run's
// status.json, calls.csv and live-<NNN>.json (written by scripts/run-plans.mjs),
// and runs `node scripts/orch-state.mjs watch` for the STUCK line. It never
// writes to a run, never starts or messages an agent.
// ---------------------------------------------------------------------------

/** Disk refresh period while a run is live (or a run may be starting). */
export const RUN_POLL_MS = 5_000
/** The watch command (a node process) runs at most this often per run. */
const WATCH_EVERY_MS = 30_000
/** The panel's clocks redraw this often while it is open (no disk read). */
export const TICK_MS = 1_000
/** After a command that starts a run, look for it this long even before its status.json exists. */
const STARTING_MS = 10 * 60_000
/** A status.json untouched this long is a crashed run, not a live one. */
const STALE_RUN_MS = 24 * 60 * 60_000
/** calls.csv and live files bigger than this are skipped (fs.read refuses over 4 MiB; these stay small). */
const MAX_SIDE_FILE_BYTES = 1024 * 1024
/** A run name as orch-state accepts it; anything else never reaches an argv. */
const RUN_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/
/** A Bash command that starts an orchestrator run (/orchestrate starts the supervisor; a direct run-plans call too). */
export const STARTS_RUN_RE = /\b(?:run-supervisor|run-plans)\.mjs\b/

export const runs = atom({ plugin: 'fleet', key: 'runs' } as const, { list: [], panelOpen: false, watchingUntil: 0, tick: 0 } as FleetRuns)

// -- pure ----------------------------------------------------------------------

type PlanStatus = {
  nnn?: string | number
  state?: string
  reason?: string
  round?: number
  models?: Record<string, { model?: string }>
  history?: { at?: string; state?: string }[]
}
export type RunStatus = { run?: string; phase?: string; startedAt?: string; plans?: Record<string, PlanStatus> }
export type LiveFile = {
  step?: string
  stepAt?: string
  gate?: { index?: number; total?: number; command?: string; startedAt?: string }
  builder?: { tools?: number; lastTool?: string; lastTarget?: string; tokensIn?: number; tokensOut?: number; at?: string }
}
export type CallRow = { plan: string; stage: string; model: string; seconds: number; input: number; output: number }

/** How far a plan is, 0..1, by its state. */
export const STAGE_WEIGHT: Record<string, number> = {
  queued: 0,
  building: 0.25,
  fixing: 0.25,
  'env-paused': 0.25,
  gate: 0.5,
  checking: 0.75,
  merging: 0.9,
  merged: 1,
  parked: 1,
  'left-run': 1,
  skipped: 1,
}

/** One plain line for the terminal: the live files are not trusted, so control characters (escapes) become spaces. */
export const plain = (s: unknown, max = 200): string => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

/** The four steps of the bar, and the plan states each one covers. */
export const STEPS: { name: string; states: string[] }[] = [
  { name: 'build', states: ['building', 'fixing', 'env-paused'] },
  { name: 'gate', states: ['gate'] },
  { name: 'review', states: ['checking'] },
  { name: 'merge', states: ['merging'] },
]

/** A plan's state in plain words. */
export function stageWords(p: PlanStatus): string {
  switch (p.state) {
    case 'queued': return 'waiting'
    case 'building': return 'building'
    case 'fixing': return `fixing${p.round ? ` (round ${p.round})` : ''}`
    case 'env-paused': return 'paused: environment'
    case 'gate': return 'checks'
    case 'checking': return 'reviewers'
    case 'merging': return 'merging'
    case 'merged': return 'merged ✓'
    case 'parked': return `parked${p.reason ? `: ${p.reason}` : ''}`
    case 'left-run': return 'left the run'
    case 'skipped': return 'skipped'
    default: return p.state ?? '?'
  }
}

/** (sum of stage weights) / plan count, as a whole percent; a gate counts its checks done. 0 with no plans. */
export function runPercent(status: RunStatus, live: Record<string, LiveFile> = {}): number {
  const plans = Object.entries(status.plans ?? {})
  if (plans.length === 0) return 0
  const sum = plans.reduce((n, [k, p]) => {
    const w = STAGE_WEIGHT[p.state ?? ''] ?? 0
    const g = p.state === 'gate' ? live[String(p.nnn ?? k)]?.gate : undefined
    const part = g && g.total ? 0.25 * Math.max(0, (Number(g.index) || 1) - 1) / g.total : 0
    return n + w + part
  }, 0)
  return Math.round((sum / plans.length) * 100)
}

/** Live: not finished or stopped, and its status.json changed within the last day. */
export function isLiveRun(status: RunStatus, statusMtimeMs: number, nowMs: number): boolean {
  if (status.phase === 'finished' || status.phase === 'stopped') return false
  return nowMs - statusMtimeMs < STALE_RUN_MS
}

/** '0:42', '12:05', '1:02:03' — a clock. */
export function clockText(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** '950', '210k', '1.1M' tokens. */
export function tokenText(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

/** calls.csv rows (plan,stage,model,seconds,input_tokens,output_tokens,exit); quoted cells allowed; junk skipped. */
export function parseCalls(csv: string): CallRow[] {
  const out: CallRow[] = []
  for (const line of csv.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue
    const cells: string[] = []
    let cur = ''
    let q = false
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i]!
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1 }
        else if (c === '"') q = false
        else cur += c
      } else if (c === '"') q = true
      else if (c === ',') { cells.push(cur); cur = '' }
      else cur += c
    }
    cells.push(cur)
    if (cells.length < 6) continue
    out.push({ plan: cells[0]!, stage: cells[1]!, model: cells[2]!, seconds: Number(cells[3]) || 0, input: Number(cells[4]) || 0, output: Number(cells[5]) || 0 })
  }
  return out
}

/** Each step's closed time (ms) and, for the running step, since when it runs — from the plan's state history. */
export function planSteps(p: PlanStatus, nowMs: number): FleetStep[] {
  const hist = (p.history ?? []).map(e => ({ state: e.state ?? '', t: Date.parse(e.at ?? '') })).filter(e => Number.isFinite(e.t))
  const steps: FleetStep[] = STEPS.map(s => ({ name: s.name, ms: 0, runningSince: null, seen: false }))
  const stepOf = (state: string) => STEPS.findIndex(s => s.states.includes(state))
  const final = (STAGE_WEIGHT[p.state ?? ''] ?? 0) >= 1
  for (let i = 0; i < hist.length; i += 1) {
    const at = stepOf(hist[i]!.state)
    if (at < 0) continue
    steps[at]!.seen = true
    const next = hist[i + 1]
    if (next) steps[at]!.ms += Math.max(0, next.t - hist[i]!.t)
    else if (!final && hist[i]!.state === p.state) steps[at]!.runningSince = hist[i]!.t
    else if (!final) steps[at]!.ms += Math.max(0, nowMs - hist[i]!.t)
  }
  // The running step's clock starts where its closed time left off: fold the closed part of this step into runningSince.
  for (const s of steps) {
    if (s.runningSince !== null && s.ms > 0) {
      s.runningSince -= s.ms
      s.ms = 0
    }
  }
  return steps
}

/** One plan as the panel draws it (times stay as numbers; the clocks are drawn from them at each tick). */
export function planView(key: string, p: PlanStatus, nowMs: number, calls: CallRow[], live: LiveFile | null): FleetPlanView {
  const nnn = String(p.nnn ?? key)
  const mine = calls.filter(c => c.plan === nnn)
  const callTokens = mine.reduce((n, c) => n + c.input + c.output, 0)
  const b = p.state === 'building' || p.state === 'fixing' ? live?.builder : undefined
  const g = p.state === 'gate' ? live?.gate : undefined
  const models = Object.values(p.models ?? {}).map(m => m?.model).filter(Boolean) as string[]
  const lastModel = [...mine].reverse().find(c => c.model && c.model !== '-')?.model ?? null
  return {
    nnn,
    state: p.state ?? '?',
    words: plain(stageWords(p)),
    final: (STAGE_WEIGHT[p.state ?? ''] ?? 0) >= 1,
    steps: planSteps(p, nowMs),
    model: plain(models[models.length - 1] ?? lastModel, 40) || null,
    round: Number(p.round) || 0,
    tokens: callTokens + (b ? (Number(b.tokensIn) || 0) + (Number(b.tokensOut) || 0) : 0),
    gate: g && g.command ? { index: Number(g.index) || 0, total: Number(g.total) || 0, command: plain(g.command, 160), startedAt: Date.parse(g.startedAt ?? '') || null } : null,
    builder: b ? { tools: Number(b.tools) || 0, lastTool: plain(b.lastTool, 40), lastTarget: plain(b.lastTarget, 60), tokens: (Number(b.tokensIn) || 0) + (Number(b.tokensOut) || 0), at: Date.parse(b.at ?? '') || null } : null,
  }
}

const ICON: Record<string, string> = { merged: '✓', parked: '✗', skipped: '–', 'left-run': '–', queued: '·' }

/** The step bar: `build 2:39 · gate ▶0:42 · review · merge`. */
export function stepBar(steps: FleetStep[], nowMs: number): string {
  return steps.map(s => {
    if (s.runningSince !== null) return `${s.name} ▶${clockText(nowMs - s.runningSince)}`
    return s.seen ? `${s.name} ${clockText(s.ms)}` : s.name
  }).join(' · ')
}

/** The panel's text for one run at `nowMs`: { text, dim } lines. Pure: the ticking clocks are drawn from here. */
export function runLines(run: FleetRunView, nowMs: number): { text: string; dim: boolean }[] {
  const out: { text: string; dim: boolean }[] = []
  const head = [`run ${run.name}`, `${run.percent}%`, run.startedAt ? clockText(nowMs - run.startedAt) : null, run.tokens ? `${tokenText(run.tokens)} tokens` : null]
  out.push({ text: head.filter(Boolean).join(' · '), dim: false })
  for (const p of run.plans) {
    const icon = ICON[p.state] ?? (p.final ? '✓' : '▶')
    if (p.state === 'queued') {
      out.push({ text: `  ${p.nnn} ${icon} ${p.words}`, dim: true })
      continue
    }
    if (p.state === 'parked' || p.state === 'skipped' || p.state === 'left-run') {
      out.push({ text: `  ${p.nnn} ${icon} ${p.words}`, dim: false })
      continue
    }
    const facts = [p.final ? null : p.model, p.final ? null : `round ${p.round}`, p.tokens ? `${tokenText(p.tokens)} tokens` : null].filter(Boolean)
    out.push({ text: `  ${p.nnn} ${icon} ${p.words}   ${stepBar(p.steps, nowMs)}${facts.length ? `   ${facts.join(' · ')}` : ''}`, dim: false })
    if (p.gate) out.push({ text: `      gate ${p.gate.index}/${p.gate.total}: ${p.gate.command}${p.gate.startedAt ? ` · ${clockText(nowMs - p.gate.startedAt)}` : ''}`, dim: true })
    if (p.builder) {
      const what = p.builder.lastTool ? `${p.builder.lastTool}${p.builder.lastTarget ? ` ${p.builder.lastTarget}` : ''}` : 'starting'
      const ago = p.builder.at ? ` · ${Math.max(0, Math.round((nowMs - p.builder.at) / 1000))} s ago` : ''
      out.push({ text: `      now: ${what} · ${p.builder.tools} tools · ${tokenText(p.builder.tokens)} tokens${ago}`, dim: true })
    }
  }
  if (run.finalGate) out.push({ text: `  final gate ${run.finalGate.index}/${run.finalGate.total}: ${run.finalGate.command}${run.finalGate.startedAt ? ` · ${clockText(nowMs - run.finalGate.startedAt)}` : ''}`, dim: true })
  return out
}

/** The watch command's line, from its stdout (the line itself, else ORCH_JSON's `line`). */
export function watchText(stdout: string): string {
  const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean)
  const plain = lines.find(l => !l.startsWith('ORCH_JSON '))
  if (plain) return plain
  const json = lines.find(l => l.startsWith('ORCH_JSON '))
  try {
    return json ? String((JSON.parse(json.slice(10)) as { line?: string }).line ?? '') : ''
  } catch {
    return ''
  }
}

// -- reading the disk ------------------------------------------------------------

const list = async ($: EngineInterface, path: string) => {
  try {
    return await $.fs.list(path)
  } catch {
    return []
  }
}

const readText = async ($: EngineInterface, path: string): Promise<string | null> => {
  try {
    return String(await $.fs.read(path)).replace(/^﻿/, '')
  } catch {
    return null
  }
}

const readJson = async <T,>($: EngineInterface, path: string): Promise<T | null> => {
  const text = await readText($, path)
  if (text === null) return null
  try {
    return JSON.parse(text) as T
  } catch {
    // A file another process is writing over: this read is skipped, the next poll reads it whole.
    return null
  }
}

const lastWatch = new Map<string, { at: number; line: string }>()

const watchRun = async ($: EngineInterface, cwd: string, run: string, nowMs: number): Promise<string> => {
  if (!RUN_NAME_RE.test(run)) return ''
  const prev = lastWatch.get(run)
  if (prev && nowMs - prev.at < WATCH_EVERY_MS) return prev.line
  let line = ''
  try {
    if (await $.fs.exists(`${cwd}/scripts/orch-state.mjs`)) {
      const ran = await $.process.run(['node', 'scripts/orch-state.mjs', 'watch', `--run=${run}`], { cwd, timeoutMs: 8000 })
      // Exit 1 is the STUCK answer, not an error.
      line = ran.exitCode === 0 || ran.exitCode === 1 ? watchText(ran.stdout) : ''
    }
  } catch {
    line = ''
  }
  lastWatch.set(run, { at: nowMs, line })
  return line
}

/** Every live run of this checkout, as the dock draws it. */
export async function scanRuns($: EngineInterface, cwd: string): Promise<FleetRunView[]> {
  const nowMs = await $.clock.now()
  const dir = `${cwd}/.claude/orchestrator-runs`
  const out: FleetRunView[] = []
  for (const e of await list($, dir)) {
    if (e.kind !== 'dir' || !RUN_NAME_RE.test(e.name)) continue
    const runDir = `${dir}/${e.name}`
    const path = `${runDir}/status.json`
    let mtime = 0
    try {
      mtime = (await $.fs.stat(path)).mtimeMs
    } catch {
      continue
    }
    const status = await readJson<RunStatus>($, path)
    if (!status || !isLiveRun(status, mtime, nowMs)) continue
    const files = await list($, runDir)
    const small = (name: string) => files.some(f => f.name === name && f.kind === 'file' && f.size <= MAX_SIDE_FILE_BYTES)
    const calls = small('calls.csv') ? parseCalls((await readText($, `${runDir}/calls.csv`)) ?? '') : []
    const live: Record<string, LiveFile> = {}
    for (const f of files) {
      const m = /^live-([A-Za-z0-9]+)\.json$/.exec(f.name)
      if (!m || !small(f.name)) continue
      const l = await readJson<LiveFile>($, `${runDir}/${f.name}`)
      if (l) live[m[1]!] = l
    }
    const plans = Object.entries(status.plans ?? {})
      .map(([k, p]) => planView(k, p, nowMs, calls, live[String(p.nnn ?? k)] ?? null))
      .sort((a, b) => Number(a.nnn) - Number(b.nnn) || a.nnn.localeCompare(b.nnn))
    const fg0 = live.final?.step === 'final-gate' ? live.final.gate : undefined
    const fg = fg0 ? { ...fg0, command: plain(fg0.command, 160) } : undefined
    const watch = await watchRun($, cwd, e.name, nowMs)
    out.push({
      name: e.name,
      percent: runPercent(status, live),
      stuck: /^STUCK\b/.test(watch),
      startedAt: Date.parse(status.startedAt ?? '') || null,
      tokens: calls.reduce((n, c) => n + c.input + c.output, 0) + plans.reduce((n, p) => n + (p.builder?.tokens ?? 0), 0),
      plans,
      finalGate: fg && fg.command ? { index: Number(fg.index) || 0, total: Number(fg.total) || 0, command: String(fg.command), startedAt: Date.parse(fg.startedAt ?? '') || null } : null,
      watch,
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

// -- refresh ---------------------------------------------------------------------

let timer: Timer | null = null
let ticker: Timer | null = null
let busy = false

/** Keeps the 1 s clock redraw only while the panel is open on a live run. */
async function syncTicker($: EngineInterface): Promise<void> {
  const r = await read($, runs)
  const want = r.panelOpen && r.list.length > 0
  if (want && !ticker) ticker = $.clock.every(TICK_MS, async () => {
    const now = await $.clock.now()
    await update($, runs, x => ({ ...x, tick: now }))
  })
  if (!want && ticker) {
    ticker.cancel()
    ticker = null
  }
}

/** Re-reads the runs; keeps a timer only while a run is live or a command may be starting one. */
export async function refreshRuns($: EngineInterface, cwd: string): Promise<void> {
  if (busy) return
  busy = true
  try {
    const list = await scanRuns($, cwd)
    const now = await $.clock.now()
    await update($, runs, r => ({ ...r, list, tick: now, panelOpen: list.length ? r.panelOpen : false }))
    const r = await read($, runs)
    const want = list.length > 0 || r.watchingUntil > now
    if (want && !timer) timer = $.clock.every(RUN_POLL_MS, () => void refreshRuns($, cwd))
    if (!want && timer) {
      timer.cancel()
      timer = null
    }
    await syncTicker($)
  } catch {
    /* a refresh never breaks a hook */
  } finally {
    busy = false
  }
}

/** The live runs as last read (the dock draws from this; it never reads the disk itself). */
export async function readRuns($: EngineInterface): Promise<FleetRuns> {
  return read($, runs)
}

export async function toggleRunPanel($: EngineInterface) {
  await update($, runs, r => ({ ...r, panelOpen: !r.panelOpen }))
  await syncTicker($)
}

/** Called from fleet's register. */
export const registerRunProgress: Register = on => {
  timer = null
  ticker = null
  busy = false
  lastWatch.clear()
  // /orchestrate starts the run with a Bash call (the supervisor) and returns: watch for its status.json a while.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const out = await next(e)
    if (STARTS_RUN_RE.test(String((e as { command?: unknown }).command ?? ''))) {
      const now = await $.clock.now()
      await update($, runs, r => ({ ...r, watchingUntil: now + STARTING_MS }))
      void refreshRuns($, await $.session.cwd())
    }
    return out
  })
}

// -- drawn -----------------------------------------------------------------------

type ResolvedUi = ReturnType<EngineInterface['ui']['resolve']>

/** One chip per live run, `run <name> NN% ▾`; the first carries the hotkey. */
export function runChips(ui: ResolvedUi, $: EngineInterface, r: FleetRuns, keyPrefix: string, hotkey?: string): unknown[] {
  const { Button, Text } = ui
  return r.list.flatMap((run, i) => [
    h(Text as never, { dimColor: true }, ' · '),
    h(
      Button as never,
      { key: `${keyPrefix}:${run.name}`, hotkey: i === 0 ? hotkey : undefined, onPress: () => void toggleRunPanel($) },
      `run ${run.name} ${run.percent}% ${r.panelOpen ? '▴' : '▾'}`,
    ),
    ...(run.stuck ? [h(Text as never, { color: 'warning', bold: true }, ' ⚠ stuck')] : []),
  ])
}

/** The panel under the dock: per run its lines at `nowMs` (the ticking clocks), then the watch line. */
export function runPanel(ui: ResolvedUi, r: FleetRuns, nowMs: number = r.tick): unknown {
  const { Box, Text } = ui
  const stuck = r.list.some(x => x.stuck)
  const lines: unknown[] = []
  for (const run of r.list) {
    runLines(run, nowMs).forEach((l, i) => {
      lines.push(h(Text as never, i === 0 ? { bold: true, color: run.stuck ? 'warning' : undefined, wrap: 'truncate-end' } : { dimColor: l.dim, wrap: 'truncate-end' }, l.text))
    })
    if (run.watch) lines.push(h(Text as never, { color: run.stuck ? 'warning' : undefined, dimColor: !run.stuck, wrap: 'truncate-end' }, run.watch))
  }
  return h(Box as never, { key: 'run-panel-frame', borderStyle: 'round', borderColor: stuck ? 'warning' : 'subtle', flexDirection: 'column', paddingX: 1 }, ...(lines as never[]))
}
