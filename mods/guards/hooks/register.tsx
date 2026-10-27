import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GuardsPending, GuardsRole } from '../types'

// ---------------------------------------------------------------------------
// guards: the Planner-Worker edit guards, in process. One parse of the plan's
// scope per session (re-read when the plan file changes), no shells, no Python.
// Rules ported from scripts/branch-guard.sh, scope-guard.sh, plan-write-guard.sh
// and session-startup.sh; the shell scripts stay for Cursor and the kit.
// ---------------------------------------------------------------------------

const OPEN_PLAN_RE = /^(plans|plans\/design)\/[^/]+\.plan\.md$/
const PLAN_FILE_RE = /plans\/.+\.plan\.md$/
let HOTSPOTS: string[] = []
const GENERATED = ['docs/workflow-kit/kit-owned.json', 'docs/workflow-kit/manifest.json', 'docs/workflow-kit/manifest.md']
const BYPASS_RE = /--no-verif|core\.hooksPath/
const GITHUB_WRITE_TOOLS = new Set(['mcp__github__push_files', 'mcp__github__create_or_update_file', 'mcp__github__delete_file'])
/** A Bash command as git sees it: backslash-newlines joined, whitespace collapsed. */
const flatCommand = (c: string) => c.replace(/\\\r?\n/g, ' ').replace(/\s+/g, ' ')
/** True when any pipeline segment runs `git … push …` with a hook bypass anywhere in it. */
const isPushBypass = (command: string) =>
  flatCommand(command)
    .split(/[;&|]/)
    .some(seg => /\bgit\b/.test(seg) && /\bpush\b/.test(seg) && BYPASS_RE.test(seg))
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

const pending = atom({ plugin: 'guards', key: 'pending' } as const, null as GuardsPending | null)
const role = atom({ plugin: 'guards', key: 'role' } as const, 'unknown' as GuardsRole)

type Opts = { failOpen: boolean; hotspots: string }
let options: Opts = { failOpen: true, hotspots: '' }

type Ctx = {
  root: string
  isSlot: boolean
  branch: string
  planPath: string | null
  planMtime: number
  scope: RegExp[]
  kitOwned: Set<string>
}
let ctx: Ctx | null = null
/** The scope globs as pinned at the first load of the plan, plus what /approve added. A plan edit cannot widen them. */
let pinnedGlobs: string[] | null = null
let pinnedPlan: string | null = null
const approvedGlobs: string[] = []

// -- pure helpers -------------------------------------------------------------

const posix = (p: string) => p.replace(/\\/g, '/')
const lower = (p: string) => posix(p).toLowerCase()

/** Resolve `.` and `..` segments; a path that climbs above its start returns null. */
function normalizeSegments(p: string): string | null {
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length === 0) return null
      out.pop()
    } else out.push(seg)
  }
  return out.join('/')
}

/**
 * Repo-relative posix path after resolving `..`; `'outside'` for an absolute path in another
 * folder (another worktree judges its own files); `null` for a relative path that climbs above
 * the root, which nothing legitimate does.
 */
function relativeTo(root: string, file: string): string | 'outside' | null {
  const r = lower(root).replace(/\/+$/, '')
  const f = posix(file)
  if (/^([a-z]:)?\//i.test(f)) {
    const drive = f.match(/^[a-z]:/i)?.[0] ?? ''
    const body = normalizeSegments(f.slice(drive.length))
    if (body === null) return null
    const abs = `${drive}/${body}`
    if (!lower(abs).startsWith(r + '/')) return 'outside'
    return abs.slice(r.length + 1)
  }
  return normalizeSegments(f)
}

/** picomatch-like glob to RegExp: **, *, ?, {a,b}; dot files match (dot: true). */
function globToRegExp(glob: string): RegExp {
  let re = ''
  let i = 0
  while (i < glob.length) {
    const c = glob[i]!
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const slash = glob[i + 2] === '/'
        re += slash ? '(?:.*/)?' : '.*'
        i += slash ? 3 : 2
        continue
      }
      re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if (c === '{') {
      const end = glob.indexOf('}', i)
      if (end === -1) re += '\\{'
      else {
        re += '(?:' + glob.slice(i + 1, end).split(',').map(s => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|') + ')'
        i = end + 1
        continue
      }
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&')
    i += 1
  }
  return new RegExp(`^${re}$`)
}

function extractScopeGlobs(planText: string): string[] | null {
  const section = planText.split(/^## Read-Write Scope/m)[1]
  if (!section) return null
  const body = section.split(/^## /m)[0] ?? ''
  const fenced = body.match(/```scope[ \t]*\r?\n([\s\S]*?)```/) || body.match(/```[ \t]*\r?\n([\s\S]*?)```/)
  const bare = fenced ? null : body.match(/^scope[ \t]*\r?\n((?:[^\S\r\n]*\S[^\n]*(?:\n|$))+)/m)
  const text = fenced?.[1] ?? bare?.[1]
  if (!text) return null
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
}

// -- engine helpers (top level, as the validator requires) --------------------

async function git($: EngineInterface, argv: string[], cwd: string): Promise<string> {
  try {
    const ran = await $.process.run(['git', ...argv], { cwd, timeoutMs: 8000 })
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

async function mtime($: EngineInterface, path: string): Promise<number> {
  try {
    return (await $.fs.stat(path)).mtimeMs
  } catch {
    return 0
  }
}

// -- daily event log: <checkout>/.claude/mods-guards-YYYY-MM-DD.log (JSON lines; .claude/*.log is gitignored) --

let logChain: Promise<void> = Promise.resolve()

async function writeLog($: EngineInterface, kind: string, detail: Record<string, unknown>): Promise<void> {
  try {
    const cwd = ctx?.root ?? (await $.session.cwd())
    if (!(await $.fs.exists(`${cwd}/.claude`))) return
    const stamp = new Date(await $.clock.now()).toISOString()
    const file = `${cwd}/.claude/mods-guards-${stamp.slice(0, 10)}.log`
    const prev = (await $.fs.exists(file)) ? String(await $.fs.read(file)) : ''
    await $.fs.write(file, `${prev}${JSON.stringify({ t: stamp, mod: 'guards', kind, branch: ctx?.branch ?? null, plan: ctx?.planPath ?? null, ...detail })}\n`)
  } catch {
    /* logging never breaks a hook */
  }
}

/** Appends one event; calls are serialized so two in flight never drop a line. */
function logEvent($: EngineInterface, kind: string, detail: Record<string, unknown> = {}): Promise<void> {
  logChain = logChain.then(() => writeLog($, kind, detail))
  return logChain
}

/**
 * The project's append-only hotspots from its kit.config.json (paths.hotspots + project.i18nFile), used when the
 * hotspots option is empty. A folder entry (trailing slash) covers everything under it. No file / no keys = none.
 */
export function hotspotsFromKitConfig(text: string | null): string[] {
  if (!text) return []
  let cfg: { paths?: { hotspots?: unknown }; project?: { i18nFile?: unknown } }
  try {
    cfg = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    return []
  }
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(',') : [])
  return [...list(cfg.paths?.hotspots), ...list(cfg.project?.i18nFile)]
    .map(x => x.trim())
    .filter(Boolean)
    .map(x => (x.endsWith('/') ? `${x}**` : x))
}

/**
 * The hotspots the kit rendered into the project's scripts/scope-check.mjs (`const HOTSPOTS = [ '…', … ]`): the
 * resolved list, stack-pack defaults included, so guards allows exactly what /ship's scope check allows. [] when
 * the file or the block is missing.
 */
export function hotspotsFromScopeCheck(text: string | null): string[] {
  const block = (text ?? '').match(/const HOTSPOTS = \[([\s\S]*?)\]/)?.[1]
  if (!block) return []
  return [...block.matchAll(/'((?:[^'\\]|\\.)*)'/g)]
    .map(m => m[1]!.replace(/\\(.)/g, '$1').trim())
    .filter(Boolean)
    .map(x => (x.endsWith('/') ? `${x}**` : x))
}

async function loadContext($: EngineInterface): Promise<Ctx> {
  const root = await $.session.cwd()
  const isSlot = await $.fs.exists(`${root}/.worktree-port`)
  const branch = (await git($, ['branch', '--show-current'], root)) || ''
  const planRel = (await readText($, `${root}/.worktree-plan`))?.trim() || null
  const planPath = planRel && (await $.fs.exists(`${root}/${planRel}`)) ? planRel : null
  const kitOwned = new Set<string>()
  const kitJson = await readText($, `${root}/docs/workflow-kit/kit-owned.json`)
  if (kitJson) {
    try {
      for (const f of (JSON.parse(kitJson.replace(/^﻿/, '')) as { files?: string[] }).files ?? []) kitOwned.add(posix(f))
    } catch {
      /* a broken list fails open, as the shell guard does */
    }
  }
  let scope: RegExp[] = []
  let planMtime = 0
  if (planPath) {
    planMtime = await mtime($, `${root}/${planPath}`)
    const parsed = extractScopeGlobs((await readText($, `${root}/${planPath}`)) ?? '') ?? []
    let globs: string[]
    if (pinnedPlan !== planPath || pinnedGlobs === null) {
      // First sight of this plan in the session (start, or a take-plan claim): pin what the file says.
      pinnedPlan = planPath
      pinnedGlobs = parsed
      approvedGlobs.length = 0
      globs = parsed
    } else {
      globs = [...pinnedGlobs, ...approvedGlobs]
      const widened = parsed.filter(g => !globs.includes(g))
      if (widened.length) {
        $.ui.toast(`guards: ${planPath} scope gained ${widened.join(', ')} outside /approve — ignored this session`)
        void logEvent($, 'scope.widen-ignored', { added: widened })
      }
    }
    // The option, else the kit's rendered list, else the raw kit.config.json (a checkout without the kit scripts).
    const rendered = HOTSPOTS.length ? [] : hotspotsFromScopeCheck(await readText($, `${root}/scripts/scope-check.mjs`))
    const hotspots = HOTSPOTS.length ? HOTSPOTS : rendered.length ? rendered : hotspotsFromKitConfig(await readText($, `${root}/kit.config.json`))
    const always = [planPath, '.claude/sessions/**', '.worktree-*', 'docs/brain/**', ...hotspots, ...GENERATED]
    scope = [...always, ...globs].map(globToRegExp)
  }
  return { root, isSlot, branch, planPath, planMtime, scope, kitOwned }
}

async function freshContext($: EngineInterface): Promise<Ctx> {
  if (!ctx) ctx = await loadContext($)
  else if (ctx.planPath && (await mtime($, `${ctx.root}/${ctx.planPath}`)) !== ctx.planMtime) ctx = await loadContext($)
  else if (!ctx.planPath && (await $.fs.exists(`${ctx.root}/.worktree-plan`))) ctx = await loadContext($)
  return ctx
}

function roleOf(c: Ctx): GuardsRole {
  if (!c.isSlot) return 'planner'
  return c.planPath ? 'worker' : 'idle-slot'
}

async function similarPlans($: EngineInterface, root: string, rel: string): Promise<string | null> {
  if (!(await $.fs.exists(`${root}/scripts/plan-name-similarity.mjs`))) return null
  try {
    const ran = await $.process.run(['node', 'scripts/plan-name-similarity.mjs', `--file=${rel}`], { cwd: root, timeoutMs: 8000 })
    return /similar plan\(s\)/.test(ran.stdout) ? ran.stdout.trim() : null
  } catch {
    return null
  }
}

async function appendToScope($: EngineInterface, c: Ctx, path: string): Promise<string> {
  if (!c.planPath) return 'guards: no active plan in this slot; nothing to approve into.'
  const file = `${c.root}/${c.planPath}`
  const text = (await readText($, file)) ?? ''
  const m = text.match(/```scope[ \t]*\r?\n[\s\S]*?(```)/)
  if (!m || m.index === undefined) return `guards: ${c.planPath} has no \`\`\`scope block to append to.`
  const at = m.index + m[0].length - 3
  const nl = text.includes('\r\n') ? '\r\n' : '\n'
  const before = text.slice(0, at).replace(/\r?\n$/, '')
  const next = `${before}${nl}${path}${nl}${text.slice(at)}`
  await $.fs.write(file, next)
  approvedGlobs.push(path)
  await logEvent($, 'approve', { path })
  ctx = null
  await update($, pending, () => null)
  return `guards: approved — "${path}" appended to the Read-Write Scope of ${c.planPath}. Retry the edit.`
}

// -- the edit decision ---------------------------------------------------------

type EditArgs = { old_string?: string; new_string?: string; content?: string; replace_all?: boolean; edits?: { old_string: string; new_string: string; replace_all?: boolean }[] }

/** Apply the tool's edit to the plan text in memory and ask whether the parsed scope globs differ. */
async function scopeWouldChange($: EngineInterface, c: Ctx, tool: string, edit: EditArgs): Promise<boolean> {
  const before = (await readText($, `${c.root}/${c.planPath}`)) ?? ''
  let after = before
  if (tool === 'Write') after = edit.content ?? ''
  else {
    const edits = tool === 'MultiEdit' ? (edit.edits ?? []) : [{ old_string: edit.old_string ?? '', new_string: edit.new_string ?? '', replace_all: edit.replace_all }]
    for (const one of edits) {
      if (!one.old_string) continue
      after = one.replace_all ? after.split(one.old_string).join(one.new_string) : after.replace(one.old_string, () => one.new_string)
    }
  }
  const a = (extractScopeGlobs(before) ?? []).join('\n')
  const b = (extractScopeGlobs(after) ?? []).join('\n')
  return a !== b
}

type Verdict = { allow: true; note?: string } | { allow: false; reason: string; pending?: GuardsPending }

async function judgeEdit($: EngineInterface, tool: string, filePath: string, edit: EditArgs): Promise<Verdict> {
  const c = await freshContext($)
  const rel = relativeTo(c.root, filePath)
  if (rel === 'outside') return { allow: true, note: `guards: ${filePath} is outside this worktree — its own folder's session judges it.` }
  if (rel === null) return { allow: false, reason: `GUARDS: ${filePath} climbs above this worktree with "..". Use the real path.` }
  const relLc = rel.toLowerCase()
  if (rel === '.worktree-plan' || rel === '.worktree-port' || rel === '.worktree-root')
    return { allow: false, reason: `GUARDS: ${rel} is slot state written by take-plan.mjs / free-merged-slots.mjs, never by an edit.` }
  if (c.planPath && rel === c.planPath && (await scopeWouldChange($, c, tool, edit)))
    return { allow: false, reason: `SCOPE_GUARD: the Read-Write Scope of ${rel} changes only through the Human: "approved: <path>" or /approve <path>.` }
  const onMain = c.branch === 'main' || c.branch === 'master'

  // A new plan file anywhere: the name-similarity gate (plan-write-guard.sh) runs first.
  if (tool === 'Write' && PLAN_FILE_RE.test(rel) && !(await $.fs.exists(`${c.root}/${rel}`))) {
    const pend = await read($, pending)
    if (!(pend && pend.reason === 'similar-plan' && pend.path === rel)) {
      const similar = await similarPlans($, c.root, rel)
      if (similar)
        return {
          allow: false,
          reason: `PLAN_WRITE_GUARD: similar plan(s) exist — ask the Human: rewrite existing / save as new / cancel. On "save as new" run /approve ${rel}.\n${similar}`,
          pending: { path: rel, plan: c.planPath ?? '', reason: 'similar-plan' },
        }
    }
  }


  if (onMain) {
    if (OPEN_PLAN_RE.test(rel) || rel === '.claude/todo.md') return { allow: true, note: `BRANCH_GUARD: Planner admin bypass — ${rel} stays on main.` }
    if (!c.isSlot)
      return {
        allow: false,
        reason:
          'BRANCH_GUARD: the Planner folder stays on main — only plans/*.plan.md and .claude/todo.md are written here. Do code work in a wt-N slot (/take-plan NNN). If the Human explicitly wants it here, create a branch first (git switch -c <type>/<slug>) and tell them every session in this folder moves with it.',
      }
    return { allow: false, reason: 'BRANCH_GUARD: this slot is on main. Claim a plan first (/take-plan NNN) so the work lands on its branch.' }
  }

  const kitOwned = c.kitOwned.has(rel) || [...c.kitOwned].some(f => f.toLowerCase() === relLc)
  const r = roleOf(c)
  if (r !== 'worker') {
    if (kitOwned)
      return {
        allow: false,
        reason: `KIT_OWNED: ${rel} is owned by the workflow kit (ADR 0018). Change it in ../ai-workflow-kit first and bring the diff here as a patch on a chore/ branch, inside a plan whose scope lists it.`,
        pending: { path: rel, plan: '', reason: 'kit-owned' },
      }
    return { allow: true }
  }

  const inScope = c.scope.some(re => re.test(rel))
  if (inScope) {
    return kitOwned ? { allow: true, note: `SCOPE_GUARD: ${rel} is kit-owned but in this plan's scope — allowed. Back-port the change to the workflow kit at /ship.` } : { allow: true }
  }
  return {
    allow: false,
    reason: `SCOPE_GUARD: ${rel} is outside plan ${c.planPath}'s Read-Write Scope. Reading is fine; writing is not. STOP and tell the Human: file, exact change, why it can't be done in-scope. Wait for "approved: ${rel}" (or /approve ${rel}), then retry.`,
    pending: { path: rel, plan: c.planPath ?? '', reason: 'scope' },
  }
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

// -- register -------------------------------------------------------------------

export const register: Register = (on, rawOptions) => {
  options = { ...options, ...(rawOptions as Partial<Opts>) }
  HOTSPOTS = String(options.hotspots || '').split(',').map(x => x.trim()).filter(Boolean)
  ctx = null

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'approve', description: 'Approve a path into the active plan\'s Read-Write Scope (the "approved: <path>" protocol).', argumentHint: '<path>' })
    await $.command.register({ name: 'role', description: 'Which Planner-Worker role this folder has, and the active plan.' })
    const started = await next(e)
    const c = await freshContext($)
    const r = roleOf(c)
    await update($, role, () => r) // the mods dock shows it (no status line of its own)
    void logEvent($, 'session.start', { role: r, scopeGlobs: c.scope.length })
    if (r === 'planner' && c.branch && c.branch !== 'main') $.ui.toast(`guards: the Planner folder is on ${c.branch}, not main`)
    return started
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const c = await freshContext($)
    const r = roleOf(c)
    const head =
      r === 'planner' ? `PLANNER: this folder is the Planner (on ${c.branch || 'main'}). Write plans and .claude/todo.md only; code goes through a wt-N slot.` :
      r === 'worker' ? `WORKER: slot with active plan ${c.planPath} on ${c.branch}. Write only inside that plan's Read-Write Scope; outside it, STOP and ask for "approved: <path>".` :
      'IDLE SLOT: ask which plan to execute (/take-plan NNN).'
    return { sections: [...composed.sections, { id: 'guards:role', text: head, scope: 'session' }] }
  })

  on('tool.call', async ($, e, next) => {
    // Writes straight to main over the GitHub API skip git hooks entirely: same rule as --no-verify.
    if (GITHUB_WRITE_TOOLS.has(String(e.tool))) {
      const branch = String((e as unknown as { branch?: string }).branch ?? '')
      if (branch === 'main' || branch === 'master') {
        void logEvent($, 'deny', { tool: String(e.tool), rule: 'github-api-main' })
        return { deny: `guards: ${String(e.tool)} to ${branch} bypasses the pre-push hook; main changes go through a PR.` }
      }
      return next(e)
    }
    if (!EDIT_TOOLS.has(String(e.tool))) return next(e)
    const filePath = String((e as unknown as { file_path?: string; notebook_path?: string }).file_path ?? (e as unknown as { notebook_path?: string }).notebook_path ?? '')
    if (!filePath) return next(e)
    const edit = e as unknown as EditArgs
    const verdict = await judgeEdit($, String(e.tool), filePath, edit)
    if (verdict.allow) {
      if (verdict.note) {
        $.ui.toast(verdict.note)
        void logEvent($, 'allow.note', { tool: String(e.tool), file: filePath, note: verdict.note.slice(0, 200) })
      }
      return next(e)
    }
    if (verdict.pending) await update($, pending, () => verdict.pending ?? null)
    void logEvent($, 'deny', { tool: String(e.tool), file: filePath, rule: verdict.reason.split(':')[0], reason: verdict.reason.slice(0, 300) })
    return { deny: verdict.reason }
  }).catch(($, e, next) => {
    if (next.called) return next(e)
    const onMain = ctx?.branch === 'main' || ctx?.branch === 'master'
    if (GITHUB_WRITE_TOOLS.has(String(e.tool)) || !options.failOpen || onMain || !ctx) {
      void logEvent($, 'guard.error', { tool: String(e.tool), outcome: 'denied' })
      return { deny: 'guards: the guard failed before it could decide; refusing.' }
    }
    $.ui.toast('guards: scope check failed — /ship scope gate will verify')
    void logEvent($, 'guard.error', { tool: String(e.tool), outcome: 'allowed (failOpen)' })
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    if (!isPushBypass(e.command)) return next(e)
    void logEvent($, 'deny', { tool: 'Bash', rule: 'no-verify', command: String(e.command).slice(0, 200) })
    return { deny: 'guards: `git push --no-verify` (or a hooksPath override) is human-only (AGENTS.md). Ask the Human to run it themselves.' }
  }).catch(($, e, next) => (next.called ? next(e) : isPushBypass(String(e.command)) ? { deny: 'guards: --no-verify is human-only.' } : next(e)))

  on('command.run', { command: 'approve' }, async ($, e) => {
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return { text: 'guards: /approve is for the Human to run.' }
    const path = posix(e.args.trim().replace(/^approved:\s*/i, ''))
    if (!path) return { text: 'guards: usage — /approve <repo-relative path or glob>' }
    if (/[\r\n`]/.test(path) || path.startsWith('/') || /^[a-z]:/i.test(path) || normalizeSegments(path) === null) return { text: 'guards: a repo-relative path or glob on one line, please.' }
    const c = await freshContext($)
    if (roleOf(c) !== 'worker') return { text: 'guards: /approve only applies in a slot with an active plan.' }
    return { text: await appendToScope($, c, path) }
  })

  on('command.run', { command: 'role' }, async $ => {
    const c = await freshContext($)
    const r = roleOf(c)
    return {
      text: [
        `role: ${r}`,
        `folder: ${c.root}`,
        `branch: ${c.branch || '(detached)'}`,
        `plan: ${c.planPath ?? '-'}`,
        `scope globs: ${c.scope.length}`,
        `kit-owned files: ${c.kitOwned.size}`,
      ].join('\n'),
    }
  })

  // The "approved: <path>" protocol as a button on the PC.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const pend = await read($, pending)
    const r = await read($, role)
    if (e.props.hasSurvey) return below
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const planNo = ctx?.planPath?.match(/(\d{3})-/)?.[1]
    const where =
      r === 'planner' ? `planner · ${ctx?.branch || 'main'}` :
      r === 'worker' ? `plan ${planNo ?? ctx?.planPath ?? '?'} · ${ctx?.branch ?? ''}` :
      r === 'idle-slot' ? 'idle slot' : 'not a slot'
    const calm = <Text dimColor>{where}</Text>
    if (!pend || e.props.isWorking) return drawDock(ui, dockEntry(ui, 'guards', false, [calm], [calm]), below)
    const label = pend.reason === 'kit-owned' ? 'kit-owned' : pend.reason === 'similar-plan' ? 'similar plan exists' : `outside ${pend.plan} scope`
    const chip = <Text color="yellow">blocked {pend.path}</Text>
    const row = [
      <Text>blocked {pend.path} — {label}</Text>,
      <Box>
          {pend.reason !== 'kit-owned' && !/[*?{]/.test(pend.path) && (
            <Button
              key="approve"
              label={`Approve ${pend.path}`}
              hotkey="a"
              variant="primary"
              onPress={() =>
                void (async () => {
                  const c = await freshContext($)
                  const text = pend.reason === 'similar-plan' ? 'guards: save-as-new acknowledged; retry the Write.' : await appendToScope($, c, pend.path)
                  if (pend.reason === 'similar-plan') await update($, pending, () => ({ ...pend }))
                  $.ui.toast(text)
                })()
              }
            />
          )}
          <Text> </Text>
          <Button key="guards-dismiss" label="Dismiss" hotkey="d" role="dismiss" onPress={() => update($, pending, () => null)} />
      </Box>,
    ]
    return drawDock(ui, dockEntry(ui, 'guards', true, [chip], row), below)
  })
}
