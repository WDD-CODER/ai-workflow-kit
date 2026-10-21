import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { ShipCheck, ShipPr, ShipProgress, ShipState, ShipStep } from '../types'

// ---------------------------------------------------------------------------
// ship-pilot: the branch's PR and checks as a band, the /ship merge-gate replies
// as buttons (each one submits the literal reply as the person, so /ship's own
// brain-capture and merge recipe run unchanged), a plan progress bar from the
// active plan's Atomic Sub-tasks, and /check N to tick one from the phone.
// ---------------------------------------------------------------------------

const DONE_WHEN_RE = /^## (Done[- ]?[Ww]hen|Success [Cc]riteria|Goals & Success Criteria|Definition of Done|Verify \/ Done when)/
const STEP_RE = /^(\s*)- \[( |x|X)\]\s*(.*)$/
const PR_FIELDS = 'number,url,title,state,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,headRefName'

const state = atom({ plugin: 'ship-pilot', key: 'state' } as const, {
  pr: null,
  progress: null,
  lastChecksKey: '',
  dismissedTurn: null,
  lastTurn: null,
  panelOpen: false,
  waiting: null,
  after: [],
  planStartedAt: null,
  stepStartedAt: null,
  stepId: null,
} as ShipState)

type Opts = { pollSeconds: number; mainBranch: string; pushUrl: string }
let options: Opts = { pollSeconds: 60, mainBranch: 'main', pushUrl: '' }
let root = ''
let branch = ''
let planPath: string | null = null
let planMtime = 0
let poller: Timer | null = null
let currentStep: string | null = null

// -- pure parsing ---------------------------------------------------------------

/**
 * The step's title: the text before the first " — " (save-plan's rule). An older plan with raw actions
 * there is cleaned up: code spans that look like paths, flags or commands go, other code spans keep
 * their words, and it stops at the first ";" or "(".
 */
export function titleOf(body: string): string {
  let t = body.split(/\s+—\s+/)[0] ?? body
  t = t.replace(/`([^`]*)`/g, (_m, code: string) => (/[\/<>{}=]|^-|\.\w{1,5}$|\s--?\w/.test(code) ? '' : code))
  t = t.split(/[;(]/)[0] ?? t
  t = t.replace(/\s*\+\s*(?=\+|$)/g, ' ').replace(/\s+/g, ' ').replace(/^[\s+,:–-]+|[\s+,:–-]+$/g, '').trim()
  return t || body.replace(/`/g, '').trim()
}

export function parsePlan(path: string, text: string): ShipProgress {
  const lines = text.split(/\r?\n/)
  const title = (lines.find(l => l.startsWith('# ')) ?? '# plan').slice(2).trim()
  const planNo = path.match(/(\d{3})-/)?.[1] ?? '---'
  // Atomic Sub-tasks are the steps; requirement boxes (Must/Should/Nice) count only in a plan that has none.
  const atomic: ShipStep[] = []
  const reqs: ShipStep[] = []
  const doneWhen: ShipProgress['doneWhen'] = []
  let section = ''
  let inDoneWhen = false
  for (const line of lines) {
    if (/^## /.test(line)) {
      section = line.slice(3).trim()
      inDoneWhen = DONE_WHEN_RE.test(line)
      continue
    }
    if (/^### /.test(line)) section = line.slice(4).trim()
    const m = line.match(STEP_RE)
    const isAtomic = section.startsWith('Atomic Sub-tasks')
    if (m && (isAtomic || /^(Must|Should|Nice)/.test(section))) {
      const into = isAtomic ? atomic : reqs
      const body = m[3] ?? ''
      const id = body.match(/^([A-Z]\d{1,2}[a-z]?|\d{1,2})\s*[:.)—-]/)?.[1] ?? `${into.length + 1}`
      const rest = body.replace(/^([A-Z]\d{1,2}[a-z]?|\d{1,2})\s*[:.)—-]\s*/, '')
      into.push({ id, text: titleOf(rest).slice(0, 90), done: m[2] !== ' ', section })
    } else if (inDoneWhen) {
      const d = line.match(/^\s*- (?:\[( |x)\]\s*)?(?:\[(auto|human)\]\s*)?(.+)$/)
      if (d) doneWhen.push({ tag: d[2] === 'auto' ? 'auto' : 'human', text: (d[3] ?? '').slice(0, 100) })
    }
  }
  const steps = atomic.length ? atomic : reqs
  const first = steps.find(s => !s.done)
  return { plan: path, planNo, title, steps, doneWhen, current: first ? `${first.id} ${first.text}` : null }
}

export function tickStep(text: string, which: string): { text: string; ticked: string | null } {
  const lines = text.split(/\r?\n/)
  const nl = text.includes('\r\n') ? '\r\n' : '\n'
  let seen = 0
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i]!.match(STEP_RE)
    if (!m || m[2] !== ' ') continue
    seen += 1
    const body = m[3] ?? ''
    const id = body.match(/^([A-Z]\d{1,2}[a-z]?|\d{1,2})\s*[:.)—-]/)?.[1]
    if (id === which || String(seen) === which) {
      lines[i] = `${m[1]}- [x] ${body}`
      return { text: lines.join(nl), ticked: body }
    }
  }
  return { text, ticked: null }
}

export function parseChecks(rollup: unknown): ShipCheck[] {
  if (!Array.isArray(rollup)) return []
  return rollup.map(r => {
    const row = r as { name?: string; context?: string; status?: string; conclusion?: string; state?: string }
    const name = row.name ?? row.context ?? 'check'
    const verdict = (row.conclusion ?? row.state ?? '').toUpperCase()
    const status = (row.status ?? '').toUpperCase()
    const st: ShipCheck['state'] =
      verdict === 'SUCCESS' ? 'pass' :
      verdict === 'SKIPPED' || verdict === 'NEUTRAL' ? 'skipped' :
      ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(verdict) ? 'fail' :
      status && status !== 'COMPLETED' ? 'pending' : verdict ? 'pending' : 'pending'
    return { name, state: st }
  })
}

export const bar = (done: number, total: number, width = 10) => {
  const filled = total ? Math.round((done / total) * width) : 0
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`
}

// -- plan panel (pure) -------------------------------------------------------------

/** Index of the step being worked on: the one the model's task names by id, else the first open one; -1 when all are done. */
export function nowIndex(p: ShipProgress): number {
  const id = p.current?.match(/^([A-Z]\d{1,2}|\d{1,2})\b/)?.[1]
  const byId = id ? p.steps.findIndex(s => s.id === id && !s.done) : -1
  return byId >= 0 ? byId : p.steps.findIndex(s => !s.done)
}

/** The [start, end) window of at most `max` steps, centred on `at`. */
export function stepWindow(total: number, at: number, max = 12): [number, number] {
  if (total <= max) return [0, total]
  const start = Math.min(Math.max(0, (at < 0 ? total : at) - Math.floor(max / 2)), total - max)
  return [start, start + max]
}

const ASK_APPROVED_RE = /approved:\s*`?[\w./*-]/i
const ASK_MERGE_RE = /\breply\s+[`"']?merge\b/i
const ASK_GO_RE = /\byour go\b|\bwait(?:ing)? for (?:your|the human'?s?) (?:go|ok|answer|reply|approval)|\breply\s+[`"']?(?:done|y|yes)\b/i

/** A short reason when the agent's last answer asks the Human for something; else null. */
export function waitingFrom(answer: string): string | null {
  const tail = answer.slice(-1200)
  if (ASK_APPROVED_RE.test(tail)) return 'an approved: <path> reply'
  if (ASK_MERGE_RE.test(tail)) return 'your merge reply'
  if (ASK_GO_RE.test(tail)) return 'your go / answer'
  return null
}

const AFTER_RE = /\b(?:must\s+)?runs?\s+after\s+plans?\s+#?(\d{1,3})\b|\buntil\s+(?:plan\s+)?#?(\d{1,3})\s+(?:is\s+)?(?:done|merged|shipped|complete)/gi

/** Plans that wait on `planNo`, then the ones waiting on those (one hop): the same wording take-plan.mjs reads. */
export function afterChain(planNo: string, plans: { no: string; text: string }[]): string[] {
  const waitsOn = (no: string) =>
    plans.filter(x => x.no !== no && [...x.text.matchAll(AFTER_RE)].some(m => Number(m[1] ?? m[2]) === Number(no))).map(x => x.no)
  const first = waitsOn(planNo)
  const second = first.flatMap(waitsOn).filter(n => n !== planNo && !first.includes(n))
  return [...new Set([...first, ...second])]
}

export const fmtDur = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / 60000))
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

const checksSummary = (checks: ShipCheck[]) => {
  const pass = checks.filter(c => c.state === 'pass' || c.state === 'skipped').length
  const fail = checks.filter(c => c.state === 'fail').length
  const pend = checks.filter(c => c.state === 'pending').length
  return { pass, fail, pend, total: checks.length, key: `${pass}/${fail}/${pend}/${checks.length}` }
}

const mergeBlockers = (pr: ShipPr | null): string[] => {
  if (!pr) return ['no PR for this branch yet']
  const out: string[] = []
  const s = checksSummary(pr.checks)
  if (s.fail) out.push(`${s.fail} check(s) failing`)
  if (s.pend) out.push(`${s.pend} check(s) still running`)
  if (pr.isDraft) out.push('PR is a draft')
  if (pr.mergeable === 'CONFLICTING') out.push('merge conflict with main')
  if (pr.state !== 'OPEN') out.push(`PR is ${pr.state.toLowerCase()}`)
  return out
}

// -- engine helpers --------------------------------------------------------------

// Daily event log: <checkout>/.claude/mods-ship-pilot-YYYY-MM-DD.log (JSON lines; .claude/*.log is gitignored).
let logChain: Promise<void> = Promise.resolve()

async function writeLog($: EngineInterface, kind: string, detail: Record<string, unknown>): Promise<void> {
  try {
    const cwd = root || (await $.session.cwd())
    if (!(await $.fs.exists(`${cwd}/.claude`))) return
    const stamp = new Date(await $.clock.now()).toISOString()
    const file = `${cwd}/.claude/mods-ship-pilot-${stamp.slice(0, 10)}.log`
    const prev = (await $.fs.exists(file)) ? String(await $.fs.read(file)) : ''
    await $.fs.write(file, `${prev}${JSON.stringify({ t: stamp, mod: 'ship-pilot', kind, branch: branch || null, plan: planPath, ...detail })}\n`)
  } catch {
    /* logging never breaks a hook */
  }
}

/** Appends one event; calls are serialized so two in flight never drop a line. */
function logEvent($: EngineInterface, kind: string, detail: Record<string, unknown> = {}): Promise<void> {
  logChain = logChain.then(() => writeLog($, kind, detail))
  return logChain
}

async function run($: EngineInterface, argv: string[], cwd: string, timeoutMs = 15000): Promise<string> {
  try {
    const ran = await $.process.run(argv, { cwd, timeoutMs })
    return ran.exitCode === 0 ? ran.stdout.trim() : ''
  } catch {
    return ''
  }
}

async function readText($: EngineInterface, path: string): Promise<string | null> {
  try {
    return (await $.fs.exists(path)) ? String(await $.fs.read(path)) : null
  } catch {
    return null
  }
}

async function loadPlan($: EngineInterface): Promise<void> {
  const rel = (await readText($, `${root}/.worktree-plan`))?.trim() || null
  planPath = rel && (await $.fs.exists(`${root}/${rel}`)) ? rel : null
  if (!planPath) {
    await update($, state, s => ({ ...s, progress: null }))
    return
  }
  try {
    planMtime = (await $.fs.stat(`${root}/${planPath}`)).mtimeMs
  } catch {
    planMtime = 0
  }
  const text = (await readText($, `${root}/${planPath}`)) ?? ''
  const progress = parsePlan(planPath, text)
  if (currentStep) progress.current = currentStep
  const after = await readAfter($, progress.planNo)
  await update($, state, s => ({ ...s, progress, after }))
  await trackStep($)
}

/** Open plans in plans/ and plans/design/ (read once per plan load, never per redraw). */
async function readAfter($: EngineInterface, planNo: string): Promise<string[]> {
  const plans: { no: string; text: string }[] = []
  for (const dir of ['plans', 'plans/design']) {
    let entries: { name: string; kind: string }[] = []
    try {
      entries = (await $.fs.list(`${root}/${dir}`)) as { name: string; kind: string }[]
    } catch {
      continue
    }
    for (const f of entries) {
      const no = f.kind === 'file' ? f.name.match(/^(\d{3})-.*\.plan\.md$/)?.[1] : undefined
      if (!no) continue
      const text = (await readText($, `${root}/${dir}/${f.name}`)) ?? ''
      if (!/^Status:\s*done/m.test(text)) plans.push({ no, text })
    }
  }
  return afterChain(planNo, plans)
}

/** Keeps plan and step start times in $.store so they survive restarts. */
async function trackStep($: EngineInterface): Promise<void> {
  const s = await read($, state)
  const p = s.progress
  if (!p || !planPath) return
  const i = nowIndex(p)
  const stepId = i >= 0 ? p.steps[i]!.id : null
  const key = `timing:${planPath}`
  const now = await $.clock.now()
  let t: { planStartedAt: number; stepId: string | null; stepStartedAt: number }
  try {
    t = ((await $.store.get(key)) as typeof t | undefined) ?? { planStartedAt: now, stepId, stepStartedAt: now }
    if (t.stepId !== stepId) t = { ...t, stepId, stepStartedAt: now }
    await $.store.set(key, t)
  } catch {
    t = { planStartedAt: s.planStartedAt ?? now, stepId, stepStartedAt: s.stepId === stepId ? (s.stepStartedAt ?? now) : now }
  }
  await update($, state, x => ({ ...x, planStartedAt: t.planStartedAt, stepId: t.stepId, stepStartedAt: t.stepStartedAt }))
}

async function planChanged($: EngineInterface): Promise<boolean> {
  if (!planPath) return await $.fs.exists(`${root}/.worktree-plan`)
  try {
    return (await $.fs.stat(`${root}/${planPath}`)).mtimeMs !== planMtime
  } catch {
    return true
  }
}

async function pollPr($: EngineInterface): Promise<ShipPr | null> {
  branch = (await run($, ['git', 'branch', '--show-current'], root, 8000)) || branch
  if (!branch || branch === options.mainBranch) {
    await update($, state, s => ({ ...s, pr: null }))
    return null
  }
  const json = await run($, ['gh', 'pr', 'view', branch, '--json', PR_FIELDS], root)
  if (!json) {
    await update($, state, s => ({ ...s, pr: null }))
    return null
  }
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
  const behind = Number(await run($, ['git', 'rev-list', '--count', `HEAD..origin/${options.mainBranch}`], root, 8000)) || 0
  const pr: ShipPr = {
    number: Number(raw.number) || 0,
    url: String(raw.url ?? ''),
    title: String(raw.title ?? ''),
    state: String(raw.state ?? 'OPEN'),
    isDraft: raw.isDraft === true,
    mergeable: String(raw.mergeable ?? 'UNKNOWN'),
    mergeState: String(raw.mergeStateStatus ?? ''),
    review: String(raw.reviewDecision ?? ''),
    checks: parseChecks(raw.statusCheckRollup),
    behindMain: behind,
    branch,
    fetchedAt: await $.clock.now(),
  }
  const before = await read($, state)
  const sum = checksSummary(pr.checks)
  await update($, state, s => ({ ...s, pr }))
  if (sum.total && sum.pend === 0 && before.lastChecksKey && before.lastChecksKey !== sum.key) {
    const text = sum.fail ? `PR #${pr.number}: ${sum.fail} check(s) failed` : `PR #${pr.number}: all ${sum.total} checks green`
    $.ui.toast(text)
    void logEvent($, 'checks.done', { pr: pr.number, pass: sum.pass, fail: sum.fail, total: sum.total })
    try {
      await $.ui.notify(text, { title: 'ship-pilot' })
    } catch {
      /* no channel */
    }
    const url = String(options.pushUrl || '')
    if (/^https:\/\//.test(url)) {
      try {
        await $.http.fetch(url, { method: 'POST', headers: { Title: 'ship-pilot' }, body: text })
      } catch {
        /* the phone is best effort */
      }
    }
  }
  if (sum.total) await update($, state, s => ({ ...s, lastChecksKey: sum.key }))
  return pr
}

function prLine(pr: ShipPr | null): string {
  if (!pr) return 'no PR for this branch'
  const s = checksSummary(pr.checks)
  const checks = s.total ? `${s.pass}/${s.total} checks${s.fail ? ` · ${s.fail} failing` : s.pend ? ` · ${s.pend} running` : ' ✓'}` : 'no checks'
  const merge = pr.mergeable === 'CONFLICTING' ? 'CONFLICT' : pr.mergeable === 'MERGEABLE' ? 'mergeable' : pr.mergeable.toLowerCase()
  return `PR #${pr.number} · ${checks} · ${merge}${pr.behindMain ? ` · ${pr.behindMain} behind ${options.mainBranch}` : ''}${pr.isDraft ? ' · draft' : ''}`
}

function progressLine(p: ShipProgress | null): string {
  if (!p) return ''
  const done = p.steps.filter(s => s.done).length
  const pct = p.steps.length ? Math.round((done / p.steps.length) * 100) : 0
  return `Plan ${p.planNo} · ${bar(done, p.steps.length)} ${pct}% · ${done}/${p.steps.length}${p.current ? ` · now: ${p.current}` : ''}`
}

async function submitReply($: EngineInterface, reply: string): Promise<void> {
  void logEvent($, 'gate.reply', { reply })
  await $.prompt.submit({ text: reply, asUser: true })
}

// -- mods dock ------------------------------------------------------------------
// fleet, guards and ship-pilot share one framed box above the prompt. Each mod
// draws its own entry (so its buttons stay its own), then gathers every entry
// already drawn below it into a fresh frame: whichever mod runs outermost draws
// the frame you see. Collapsed to one line until an entry asks for attention.
// KEEP THIS BLOCK IDENTICAL in fleet, guards and ship-pilot.

type DockNode = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
type DockUi = { Box: unknown; Text: unknown }
const DOCK_ORDER = ['fleet', 'guards', 'ship-pilot']
const DOCK_COLOR: Record<string, string> = { fleet: 'cyan', guards: 'yellow', 'ship-pilot': 'green' }
const DOCK_LABEL_WIDTH = 13

const dockKey = (n: unknown) => {
  const el = n as DockNode | null
  return el !== null && typeof el === 'object' && el.type === 'Box' ? String(el.props?.key ?? '') : ''
}

/** Moves each dock entry in `node` to `entries`; everything that is not the dock goes to `rest`, in order. */
const takeDock = (node: unknown, entries: DockNode[], rest: unknown[]) => {
  if (node === null || node === undefined || node === false || node === '') return
  if (Array.isArray(node)) {
    for (const c of node) takeDock(c, entries, rest)
    return
  }
  const k = dockKey(node)
  if (k.startsWith('mods-dock:')) entries.push(node as DockNode)
  else if (k === 'mods-dock-wrap') for (const c of (node as DockNode).children ?? []) takeDock(c, entries, rest)
  else if (k === 'mods-dock') for (const c of (node as DockNode).children ?? []) takeDock(c, entries, [])
  else rest.push(node)
}

const shown = (view: unknown, on: boolean) => {
  const el = view as DockNode
  return el && typeof el === 'object' ? { ...el, props: { ...el.props, display: on ? 'flex' : 'none' } } : view
}

/** One entry: `chip` is its part of the collapsed line, `row` its full row (state + buttons). */
const dockEntry = (ui: DockUi, mod: string, alert: boolean, chip: unknown[], row: unknown[]) => {
  const label = () => h(ui.Text as never, { color: DOCK_COLOR[mod] ?? 'text', bold: true }, `◆ ${mod}`)
  return h(
    ui.Box as never,
    { key: `mods-dock:${mod}:${alert ? 'alert' : 'calm'}`, flexDirection: 'column' },
    h(ui.Box as never, { key: `mods-dock-chip:${mod}` }, label(), h(ui.Text as never, {}, ' '), ...chip),
    h(ui.Box as never, { key: `mods-dock-row:${mod}` }, h(ui.Box as never, { width: DOCK_LABEL_WIDTH, flexShrink: 0 }, label()), h(ui.Box as never, { flexDirection: 'column', flexGrow: 1 }, ...row)),
  )
}

/** The dock with `mine` added to every entry found in `below`; the rest of `below` follows it. */
const drawDock = (ui: DockUi, mine: unknown, below: unknown) => {
  const entries: DockNode[] = []
  const rest: unknown[] = []
  takeDock(mine, entries, rest)
  takeDock(below, entries, rest)
  const rank = (n: DockNode) => {
    const i = DOCK_ORDER.indexOf(dockKey(n).split(':')[1] ?? '')
    return i < 0 ? DOCK_ORDER.length : i
  }
  entries.sort((a, b) => rank(a) - rank(b))
  const full = entries.some(n => dockKey(n).endsWith(':alert'))
  const items: unknown[] = []
  entries.forEach((n, i) => {
    const [chip, row] = n.children ?? []
    if (!full && i > 0) items.push(h(ui.Text as never, { dimColor: true }, '  ·  '))
    items.push({ ...n, children: [shown(chip, !full), shown(row, full)] })
  })
  const frame = h(
    ui.Box as never,
    { key: 'mods-dock', borderStyle: 'round', borderColor: full ? 'warning' : 'subtle', flexDirection: full ? 'column' : 'row', flexWrap: 'wrap', paddingX: 1 },
    ...items,
  )
  return h(ui.Box as never, { key: 'mods-dock-wrap', flexDirection: 'column' }, frame, ...rest) as Exclude<ReturnType<typeof h>, string | null | undefined>
}

// -- register ----------------------------------------------------------------------

export const register: Register = (on, rawOptions) => {
  options = { ...options, ...(rawOptions as Partial<Opts>) }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pr', description: "This branch's PR: checks, mergeable, behind main.", immediate: true })
    await $.command.register({ name: 'merge', description: 'Reply "merge" to the /ship merge gate — only when checks are green and the PR is mergeable.' })
    await $.command.register({ name: 'progress', description: "The active plan's progress bar and current step.", immediate: true })
    await $.command.register({ name: 'check', description: 'Tick an Atomic Sub-task of the active plan: /check A3 or /check 3.', argumentHint: '<id>' })
    const started = await next(e)
    root = await $.session.cwd()
    currentStep = null
    await loadPlan($)
    const pr = await pollPr($)
    void logEvent($, 'session.start', { pr: pr?.number ?? null })
    poller?.cancel()
    const every = Math.max(0, Number(options.pollSeconds) || 0)
    if (every) poller = $.clock.every(every * 1000, () => void pollPr($))
    return started
  })

  on('session.end', ($, e, next) => {
    poller?.cancel()
    poller = null
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    await update($, state, s => ({ ...s, lastTurn: started.turnId }))
    return started
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      const waiting = waitingFrom(e.answer ?? '')
      await update($, state, s => ({ ...s, waiting }))
    }
    if (await planChanged($)) await loadPlan($)
    $.clock.after(200, () => void pollPr($))
    return next(e)
  })

  // The model's own task tracking names the current step; a plan edit re-parses.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (tool === 'AskUserQuestion') {
      await update($, state, s => ({ ...s, waiting: 'an answer to the question above' }))
      try {
        return await next(e)
      } finally {
        await update($, state, s => ({ ...s, waiting: null }))
      }
    }
    const ran = await next(e)
    if (tool === 'TaskUpdate' || tool === 'TaskCreate') {
      const t = e as unknown as { status?: string; activeForm?: string; subject?: string }
      if (t.status === 'in_progress' || (tool === 'TaskCreate' && t.activeForm)) currentStep = (t.activeForm ?? t.subject ?? '').slice(0, 80) || currentStep
    } else if (tool === 'TodoWrite') {
      const t = e as unknown as { todos?: { status: string; activeForm?: string; content: string }[] }
      const active = t.todos?.find(x => x.status === 'in_progress')
      if (active) currentStep = (active.activeForm ?? active.content).slice(0, 80)
    } else if ((tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') && planPath) {
      const fp = String((e as unknown as { file_path?: string }).file_path ?? '').replace(/\\/g, '/')
      if (fp.endsWith(planPath)) {
        await loadPlan($)
        return ran
      }
    } else {
      return ran
    }
    if (currentStep) {
      await update($, state, s => (s.progress ? { ...s, progress: { ...s.progress, current: currentStep } } : s))
      await trackStep($)
    }
    return ran
  }).catch(($, e, next) => {
    void logEvent($, 'tracker.error', { tool: String(e.tool) })
    return next(e)
  })

  on('command.run', { command: 'pr' }, async $ => {
    const pr = await pollPr($)
    if (!pr) return { text: branch === options.mainBranch ? `ship-pilot: on ${options.mainBranch}; no PR to watch.` : `ship-pilot: no PR for ${branch || 'this branch'} yet (gh pr view found none).` }
    const lines = [prLine(pr), pr.url, '', 'checks:']
    for (const c of pr.checks) lines.push(`  ${c.state === 'pass' ? '✓' : c.state === 'fail' ? '✗' : c.state === 'skipped' ? '–' : '…'} ${c.name}`)
    const blockers = mergeBlockers(pr)
    lines.push('', blockers.length ? `merge blocked: ${blockers.join(', ')}` : 'merge: ready — reply "merge" to the gate or run /merge')
    return { text: lines.join('\n') }
  }).catch($ => {
    void logEvent($, 'pr.error')
    return { text: 'ship-pilot: could not read the PR (gh failed). Try `gh pr view` yourself.' }
  })

  on('command.run', { command: 'merge' }, async ($, e) => {
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return { text: 'ship-pilot: /merge is for the Human (it stands for the literal "merge" reply).' }
    const pr = await pollPr($)
    const blockers = mergeBlockers(pr)
    if (blockers.length) {
      void logEvent($, 'merge.refused', { pr: pr?.number ?? null, blockers })
      return { text: `ship-pilot: not merging — ${blockers.join(', ')}. Fix first (/fix-pr-checks) or reply "merge" yourself to override.` }
    }
    const reply = `merge${e.args.trim() ? ` ${e.args.trim()}` : ''}`
    $.clock.after(0, () => void submitReply($, reply)) // a command.run hook may not submit while it holds the turn
    return { text: `ship-pilot: sent "merge" as your reply to the gate for PR #${pr?.number}. /ship's merge procedure runs now (brain capture, slot-safe merge).` }
  })

  on('command.run', { command: 'progress' }, async $ => {
    if (await planChanged($)) await loadPlan($)
    const p = (await read($, state)).progress
    if (!p) return { text: 'ship-pilot: no active plan in this folder (.worktree-plan).' }
    const lines = [`${p.title}`, progressLine(p), '']
    for (const s of p.steps) lines.push(`  ${s.done ? '[x]' : '[ ]'} ${s.id}: ${s.text}`)
    if (p.doneWhen.length) {
      lines.push('', 'Done when:')
      for (const d of p.doneWhen) lines.push(`  [${d.tag}] ${d.text}`)
      lines.push('', '[human] items are validated by you (reply done / /done); [auto] by agent evidence.')
    }
    return { text: lines.join('\n') }
  })

  on('command.run', { command: 'check' }, async ($, e) => {
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return { text: 'ship-pilot: /check is for the Human to run.' }
    const which = e.args.trim().toUpperCase()
    if (!which) return { text: 'ship-pilot: usage — /check A3 (sub-task id) or /check 3 (the Nth open sub-task).' }
    if (!planPath || !(await $.fs.exists(`${root}/.worktree-port`))) return { text: 'ship-pilot: /check only ticks the plan file inside a wt-N slot with an active plan (never .claude/todo.md; the todo-sync Action does the ledger).' }
    const file = `${root}/${planPath}`
    const text = (await readText($, file)) ?? ''
    const { text: next, ticked } = tickStep(text, which)
    if (!ticked) return { text: `ship-pilot: no open sub-task "${which}" in ${planPath}.` }
    await $.fs.write(file, next)
    void logEvent($, 'check', { which, ticked: ticked.slice(0, 80) })
    await loadPlan($)
    const p = (await read($, state)).progress
    return { text: `ship-pilot: ticked [x] ${ticked.slice(0, 80)}\n${progressLine(p)}\n(uncommitted — it rides the next commit on this branch)` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const s = await read($, state)
    const dismissed = s.dismissedTurn !== null && s.dismissedTurn === s.lastTurn
    if (e.props.hasSurvey) return below
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const p = s.progress
    const done = p ? p.steps.filter(x => x.done).length : 0
    const pct = p && p.steps.length ? Math.round((done / p.steps.length) * 100) : 0
    const sum = s.pr ? checksSummary(s.pr.checks) : null
    const prShort = !s.pr || !sum ? 'no PR' : `PR #${s.pr.number} · ${sum.total ? (sum.pend ? `checks ${sum.pass}/${sum.total} running` : sum.fail ? `${sum.fail} check(s) failing` : 'checks ✓') : 'no checks'}`
    const ready = !!s.pr && s.pr.state === 'OPEN' && !!sum && sum.pend === 0
    const toggle = () => update($, state, x => ({ ...x, panelOpen: !x.panelOpen }))
    const open = !!p && s.panelOpen
    const planChip = (key: string, hotkey?: string) =>
      p ? [<Text dimColor> · </Text>, <Button key={key} hotkey={hotkey} onPress={() => void toggle()}>{`plan ${p.planNo} ${pct}% ${open ? '▴' : '▾'}`}</Button>] : []
    const waiting = s.waiting ?? (ready && !dismissed && sum && !sum.fail && s.pr?.mergeable !== 'CONFLICTING' ? `merge PR #${s.pr?.number} (checks green)` : null)
    const panel = open && p ? planPanel(ui, p, s, waiting, e.props.bodyColumns, e.props.maxRows, await $.clock.now()) : null
    const mine = (entry: unknown) => (panel ? [entry, panel] : entry)
    if (!ready || dismissed || e.props.isWorking) {
      const calm = [<Text dimColor>{prShort}</Text>, ...planChip('plan-panel', 'p')]
      const row = [<Text dimColor>{prShort}</Text>, ...(p ? [<Box>{planChip('plan-panel-row')}<Text dimColor> {progressLine(p)}</Text></Box>] : [])]
      return drawDock(ui, mine(dockEntry(ui, 'ship-pilot', false, calm, row)), below)
    }
    const chip = [<Text color="green">{prShort}</Text>, ...planChip('plan-panel', 'p')]
    const row = [
      <Text>{prLine(s.pr)}</Text>,
      ...(p ? [<Box>{planChip('plan-panel-row')}<Text dimColor> {progressLine(p)}</Text></Box>] : []),
      <Box>
            <Button
              key="merge"
              label="merge"
              hotkey="m"
              variant="primary"
              onPress={() =>
                void pollPr($).then(fresh => {
                  const now = mergeBlockers(fresh)
                  if (!now.length) return submitReply($, 'merge')
                  void logEvent($, 'merge.refused', { pr: fresh?.number ?? null, blockers: now, via: 'button' })
                  return $.ui.toast(`not merging: ${now.join(', ')}`)
                })
              }
            />
            <Text> </Text>
            <Button key="later" label="later" hotkey="l" onPress={() => void submitReply($, 'later')} />
            <Text> </Text>
            <Button key="pr-only" label="open-pr-only" hotkey="o" onPress={() => void submitReply($, 'open-pr-only')} />
            <Text> </Text>
            <Button key="hide" label="hide" hotkey="x" role="dismiss" onPress={() => update($, state, x => ({ ...x, dismissedTurn: x.lastTurn ?? 'none' }))} />
      </Box>,
    ]
    return drawDock(ui, mine(dockEntry(ui, 'ship-pilot', true, chip, row)), below)
  })
}

// -- plan panel (drawn) -------------------------------------------------------------
// Drawn under the dock frame (drawDock keeps non-dock nodes right after it). No model
// calls, nothing added to the prompt or transcript: it costs no tokens.

type ResolvedUi = ReturnType<EngineInterface['ui']['resolve']>

function planPanel(ui: ResolvedUi, p: ShipProgress, s: ShipState, waiting: string | null, cols: number, maxRows: number, now: number) {
  const { Box, Text } = ui
  const narrow = (cols || 120) < 80
  const done = p.steps.filter(x => x.done).length
  const total = p.steps.length
  const pct = total ? Math.round((done / total) * 100) : 0
  const at = nowIndex(p)
  const nextAt = at >= 0 ? p.steps.findIndex((x, i) => i > at && !x.done) : -1
  const max = Math.max(3, Math.min(12, (maxRows || 40) - 12))
  const [from, to] = stepWindow(total, at, max)
  const human = p.doneWhen.filter(d => d.tag === 'human').length
  const lines: unknown[] = [
    <Text bold wrap="truncate-end">{`Plan ${p.planNo} — ${p.title.replace(/^Plan\s+\d+\s*[—-]\s*/, '')}`}</Text>,
    <Box>
      <Text color="green">{bar(done, total, narrow ? 10 : 20)}</Text>
      <Text>{` ${pct}%  ${done}/${total} steps`}</Text>
      {!narrow && s.planStartedAt ? <Text dimColor>{` · ${fmtDur(now - s.planStartedAt)} on this plan`}</Text> : null}
    </Box>,
  ]
  if (from > 0) lines.push(<Text dimColor>{`  … ${from} more above`}</Text>)
  for (let i = from; i < to; i += 1) {
    const st = p.steps[i]!
    const isNow = i === at
    const mark = st.done ? '✓' : isNow ? '▶' : '○'
    const tag = isNow ? `  now${!narrow && s.stepStartedAt && s.stepId === st.id ? ` · ${fmtDur(now - s.stepStartedAt)}` : ''}` : i === nextAt ? '  next' : ''
    lines.push(
      <Box key={`plan-step:${st.id}`}>
        <Text color={st.done ? 'green' : isNow ? 'cyan' : undefined} dimColor={st.done} bold={isNow}>{`${mark} `}</Text>
        <Text dimColor={st.done} bold={isNow} wrap="truncate-end">{`${st.id} ${st.text}`}</Text>
        {tag ? <Text color={isNow ? 'cyan' : undefined} dimColor={!isNow}>{tag}</Text> : null}
      </Box>,
    )
  }
  if (to < total) lines.push(<Text dimColor>{`  … ${total - to} more below`}</Text>)
  if (waiting) lines.push(<Text key="plan-waiting" color="yellow" bold>{`⚠ Waiting on you: ${waiting}`}</Text>)
  if (human) lines.push(<Text dimColor>{`Your checks at the end: ${human} (/progress lists them)`}</Text>)
  if (!narrow && s.after.length) lines.push(<Text dimColor>{`After this: plan ${s.after.join(' → ')}`}</Text>)
  return h(Box as never, { key: 'plan-panel-frame', borderStyle: 'round', borderColor: waiting ? 'warning' : 'subtle', flexDirection: 'column', paddingX: 1 }, ...(lines as never[]))
}
