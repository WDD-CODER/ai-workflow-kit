import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { FleetRunView, FleetRuns } from '../types'

// ---------------------------------------------------------------------------
// run progress (part of fleet): while an /orchestrate run is live in this
// checkout, a dock chip `run <name> NN%` that opens a panel with one plain line
// per plan. Read-only and token-free: it reads the run's status.json, the
// workflow's journal.jsonl, and runs `node scripts/orch-state.mjs watch` for the
// STUCK line. It never writes to a run, never starts or messages an agent.
// ---------------------------------------------------------------------------

/** Refresh period while a run is live (or a Workflow call just started one). */
export const RUN_POLL_MS = 30_000
/** After a Workflow tool call, look for a new run this long even before its status.json exists. */
const STARTING_MS = 10 * 60_000
/** A status.json untouched this long is a crashed run, not a live one. */
const STALE_RUN_MS = 24 * 60 * 60_000
/** fs.read refuses files over 4 MiB. */
const MAX_JOURNAL_BYTES = 4 * 1024 * 1024
/** How many recent sessions of this project to search for the run's workflow journal. */
const RECENT_SESSIONS = 6
/** A run name as orch-state accepts it; anything else never reaches an argv. */
const RUN_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/

export const runs = atom({ plugin: 'fleet', key: 'runs' } as const, { list: [], panelOpen: false, watchingUntil: 0 } as FleetRuns)

// -- pure ----------------------------------------------------------------------

type PlanStatus = { nnn?: string | number; state?: string; reason?: string; round?: number; history?: { at?: string; state?: string }[] }
export type RunStatus = { run?: string; phase?: string; plans?: Record<string, PlanStatus> }

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

/** (sum of stage weights) / plan count, as a whole percent; 0 with no plans. */
export function runPercent(status: RunStatus): number {
  const plans = Object.values(status.plans ?? {})
  if (plans.length === 0) return 0
  const sum = plans.reduce((n, p) => n + (STAGE_WEIGHT[p.state ?? ''] ?? 0), 0)
  return Math.round((sum / plans.length) * 100)
}

/** Live: not finished or stopped, and its status.json changed within the last day. */
export function isLiveRun(status: RunStatus, statusMtimeMs: number, nowMs: number): boolean {
  if (status.phase === 'finished' || status.phase === 'stopped') return false
  return nowMs - statusMtimeMs < STALE_RUN_MS
}

/** '<1 min', '3 min', '1 h 05 min'. */
export function durText(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000)
  if (m < 1) return '<1 min'
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}

/** '20 s ago', '4 min ago'. */
export function agoText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s} s ago` : `${Math.floor(s / 60)} min ago`
}

/** When the plan entered its current state: the first of the trailing history entries with that state. */
export function stateSince(p: PlanStatus): number | null {
  const hist = p.history ?? []
  let since: number | null = null
  for (let i = hist.length - 1; i >= 0; i -= 1) {
    const e = hist[i]!
    if (e.state !== p.state) break
    const t = Date.parse(e.at ?? '')
    if (Number.isFinite(t)) since = t
  }
  return since
}

export type OpenAgent = { label: string; agentId: string }

/** The last agent the journal started that has no result yet; null when none, or the text is not a journal. */
export function openAgent(journal: string): OpenAgent | null {
  const open = new Map<string, OpenAgent>()
  for (const line of journal.split('\n')) {
    if (!line.trim()) continue
    let row: { type?: string; key?: string; agentId?: string; label?: string }
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    const id = String(row.key ?? row.agentId ?? '')
    if (!id) continue
    if (row.type === 'started') {
      open.delete(id) // re-insert so the newest start is last
      open.set(id, { label: String(row.label ?? 'agent'), agentId: String(row.agentId ?? '') })
    } else if (row.type === 'result') open.delete(id)
  }
  return [...open.values()].pop() ?? null
}

/** Whether a journal names this run (as `run-506-506`, not as a prefix of a longer name). */
export function journalNamesRun(journal: string, run: string): boolean {
  const esc = run.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\w-])${esc}(?![\\w-])`).test(journal)
}

/** The project folder name Claude Code files a checkout's sessions under. */
export const projectSlug = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, '-')

/** The Claude configuration folder from a plugin's own root (…/<config>/plugins/…); null when it is not under one. */
export function configDirOf(pluginRoot: string): string | null {
  const p = pluginRoot.replace(/\\/g, '/')
  const at = p.lastIndexOf('/plugins/')
  return at > 0 ? p.slice(0, at) : null
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

export type AgentNow = { label: string; ageMs: number | null } | null

/** The panel's plan lines, in plan-number order; the agent's detail joins the plan its label names. */
export function planLines(status: RunStatus, nowMs: number, agent: AgentNow): { lines: string[]; agentLine: string | null } {
  const plans = Object.entries(status.plans ?? {})
    .map(([k, p]) => ({ ...p, nnn: String(p.nnn ?? k) }))
    .sort((a, b) => Number(a.nnn) - Number(b.nnn) || a.nnn.localeCompare(b.nnn))
  const detail = agent ? `${agent.label}${agent.ageMs !== null ? ` · ${agoText(agent.ageMs)}` : ''}` : ''
  let placed = false
  const lines = plans.map(p => {
    const since = stateSince(p)
    const final = (STAGE_WEIGHT[p.state ?? ''] ?? 0) >= 1
    const mine = !!agent && !final && new RegExp(`(^|\\D)${p.nnn}(\\D|$)`).test(agent.label)
    if (mine) placed = true
    return `${p.nnn} · ${stageWords(p)}${mine ? ` (${detail})` : ''}${!final && since !== null ? ` · ${durText(nowMs - since)}` : ''}`
  })
  return { lines, agentLine: agent && !placed ? `now: ${detail}` : null }
}

// -- reading the disk ------------------------------------------------------------

const list = async ($: EngineInterface, path: string) => {
  try {
    return await $.fs.list(path)
  } catch {
    return []
  }
}

const readJson = async <T,>($: EngineInterface, path: string): Promise<T | null> => {
  try {
    return JSON.parse(String(await $.fs.read(path)).replace(/^﻿/, '')) as T
  } catch {
    return null
  }
}

/** The run's workflow folder: the newest wf_* whose journal names the run, in this session's folder, then the newest others. */
const findWorkflow = async ($: EngineInterface, cwd: string, run: string): Promise<{ dir: string; journal: string } | null> => {
  let root: string | null = null
  try {
    root = configDirOf($.plugin.root)
  } catch {
    root = null
  }
  if (!root) return null
  const project = `${root}/projects/${projectSlug(cwd)}`
  let me = ''
  try {
    me = await $.session.id()
  } catch {
    /* no id: search the recent sessions only */
  }
  const recent = (await list($, project))
    .filter(e => e.kind === 'file' && e.name.endsWith('.jsonl'))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map(e => e.name.slice(0, -6))
    .filter(id => id !== me)
    .slice(0, RECENT_SESSIONS)
  for (const sid of [me, ...recent].filter(Boolean)) {
    const wfRoot = `${project}/${sid}/subagents/workflows`
    const folders = (await list($, wfRoot)).filter(e => e.kind === 'dir' && e.name.startsWith('wf_'))
    const found: { dir: string; journal: string; at: number }[] = []
    for (const f of folders) {
      const dir = `${wfRoot}/${f.name}`
      const j = (await list($, dir)).find(e => e.name === 'journal.jsonl' && e.kind === 'file')
      if (!j || j.size > MAX_JOURNAL_BYTES) continue
      let text = ''
      try {
        text = String(await $.fs.read(`${dir}/journal.jsonl`))
      } catch {
        continue
      }
      if (journalNamesRun(text, run)) found.push({ dir, journal: text, at: j.mtimeMs })
    }
    const newest = found.sort((a, b) => b.at - a.at)[0]
    if (newest) return { dir: newest.dir, journal: newest.journal }
  }
  return null
}

/** What the run's current agent is doing; null when the journal is missing or unreadable (never throws). */
const agentNow = async ($: EngineInterface, cwd: string, run: string, nowMs: number): Promise<AgentNow> => {
  try {
    const wf = await findWorkflow($, cwd, run)
    if (!wf) return null
    const open = openAgent(wf.journal)
    if (!open) return null
    const t = (await list($, wf.dir)).find(e => e.name === `agent-${open.agentId}.jsonl`)
    return { label: open.label, ageMs: t && t.mtimeMs ? nowMs - t.mtimeMs : null }
  } catch {
    return null
  }
}

const watchRun = async ($: EngineInterface, cwd: string, run: string): Promise<string> => {
  if (!RUN_NAME_RE.test(run)) return ''
  try {
    if (!(await $.fs.exists(`${cwd}/scripts/orch-state.mjs`))) return ''
    const ran = await $.process.run(['node', 'scripts/orch-state.mjs', 'watch', `--run=${run}`], { cwd, timeoutMs: 8000 })
    // Exit 1 is the STUCK answer, not an error.
    return ran.exitCode === 0 || ran.exitCode === 1 ? watchText(ran.stdout) : ''
  } catch {
    return ''
  }
}

/** Every live run of this checkout, as the dock draws it. */
export async function scanRuns($: EngineInterface, cwd: string): Promise<FleetRunView[]> {
  const nowMs = await $.clock.now()
  const dir = `${cwd}/.claude/orchestrator-runs`
  const out: FleetRunView[] = []
  for (const e of await list($, dir)) {
    if (e.kind !== 'dir' || !RUN_NAME_RE.test(e.name)) continue
    const path = `${dir}/${e.name}/status.json`
    let mtime = 0
    try {
      mtime = (await $.fs.stat(path)).mtimeMs
    } catch {
      continue
    }
    const status = await readJson<RunStatus>($, path)
    if (!status || !isLiveRun(status, mtime, nowMs)) continue
    const agent = await agentNow($, cwd, e.name, nowMs)
    const { lines, agentLine } = planLines(status, nowMs, agent)
    const watch = await watchRun($, cwd, e.name)
    out.push({ name: e.name, percent: runPercent(status), stuck: /^STUCK\b/.test(watch), plans: lines, agent: agentLine, watch })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

// -- refresh ---------------------------------------------------------------------

let timer: Timer | null = null
let busy = false

/** Re-reads the runs; keeps a timer only while a run is live or a Workflow call may be starting one. */
export async function refreshRuns($: EngineInterface, cwd: string): Promise<void> {
  if (busy) return
  busy = true
  try {
    const list = await scanRuns($, cwd)
    await update($, runs, r => ({ ...r, list, panelOpen: list.length ? r.panelOpen : false }))
    const r = await read($, runs)
    const now = await $.clock.now()
    const want = list.length > 0 || r.watchingUntil > now
    if (want && !timer) timer = $.clock.every(RUN_POLL_MS, () => void refreshRuns($, cwd))
    if (!want && timer) {
      timer.cancel()
      timer = null
    }
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

export function toggleRunPanel($: EngineInterface) {
  return update($, runs, r => ({ ...r, panelOpen: !r.panelOpen }))
}

/** Called from fleet's register. */
export const registerRunProgress: Register = on => {
  timer = null
  busy = false
  // A Workflow call may be an /orchestrate run whose status.json appears a moment later: watch for it a while.
  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    const out = await next(e)
    const now = await $.clock.now()
    await update($, runs, r => ({ ...r, watchingUntil: now + STARTING_MS }))
    void refreshRuns($, await $.session.cwd())
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

/** The panel under the dock: per run a header, one line per plan, the agent line, the watch line. */
export function runPanel(ui: ResolvedUi, r: FleetRuns): unknown {
  const { Box, Text } = ui
  const stuck = r.list.some(x => x.stuck)
  const lines: unknown[] = []
  for (const run of r.list) {
    lines.push(h(Text as never, { bold: true, color: run.stuck ? 'warning' : undefined }, `run ${run.name} · ${run.percent}%`))
    for (const l of run.plans) lines.push(h(Text as never, { wrap: 'truncate-end' }, `  ${l}`))
    if (run.agent) lines.push(h(Text as never, { dimColor: true, wrap: 'truncate-end' }, `  ${run.agent}`))
    if (run.watch) lines.push(h(Text as never, { color: run.stuck ? 'warning' : undefined, dimColor: !run.stuck, wrap: 'truncate-end' }, run.watch))
  }
  return h(Box as never, { key: 'run-panel-frame', borderStyle: 'round', borderColor: stuck ? 'warning' : 'subtle', flexDirection: 'column', paddingX: 1 }, ...(lines as never[]))
}
