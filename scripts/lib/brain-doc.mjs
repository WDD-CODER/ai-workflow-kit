/**
 * Kit brain documents — turns a run's `status.json`, the grade rows and the Planner's toil lines into the documents the
 * kit's private store keeps (core/docs/agent/kit-brain.md §Schema). No network and no model call: scripts/brain.mjs sends
 * what this file builds, and tools/brain-query.mjs reads it back.
 *
 *   import { digestRun, gradeDocs, toilDocs, lessonDoc, signature, redact, tokensForRun } from './lib/brain-doc.mjs'
 *
 * Every document is deterministic: the same `status.json` gives the same `_id` and the same fields (no wall clock),
 * so a second send of the same run is a no-op in the store (E11000 = already there). Every string passes through
 * `redact` first. Node built-ins only; no placeholders (tools import it).
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { hostname, homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PATTERNS } from '../pre-commit-secret-scan.mjs'

export const SCHEMA = 1
export const COLLECTIONS = ['runs', 'plans', 'grades', 'events', 'toil', 'lessonsIn']
export const EVENT_KINDS = ['park', 'timeout', 'env-fail', 'flake', 'runner-retry', 'model-fallback', 'main-check-dropped', 'stuck', 'final-gate-fail']
export const PHASES = ['readiness', 'building', 'gate', 'checks', 'ui', 'merge', 'finalGate']
const MAX_STRING = 2000
const sha = (s, n = 8) => createHash('sha256').update(String(s)).digest('hex').slice(0, n)

// ---------------------------------------------------------------------------------------------------- redaction

// The secret patterns of the pre-commit scan (scripts/pre-commit-secret-scan.mjs, imported — one list), made global so
// every match is replaced, plus a bearer token of any length from 8 characters (the scan's own floor is 20).
export const SECRET_PATTERNS = [
  ...PATTERNS.map(({ name, re }) => ({ name, re: new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`) })),
  { name: 'bearer-token', re: /Bearer\s+[A-Za-z0-9\-_.=]{8,}/g },
]

const FENCE = '`'.repeat(3)

/**
 * Code out of a text: a fenced block keeps its first line of code and `[code cut]`; a diff hunk (`@@ … @@` up to the
 * next blank line) keeps its header line and `[code cut]`. An unterminated fence is cut to the end.
 */
export function cutCode(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trimStart().startsWith(FENCE)) {
      let j = i + 1
      const first = lines[j] !== undefined && !lines[j].trimStart().startsWith(FENCE) ? lines[j] : ''
      while (j < lines.length && !lines[j].trimStart().startsWith(FENCE)) j++
      out.push(`${first.trim()} [code cut]`.trim())
      i = j
    } else if (/^@@ .* @@/.test(line)) {
      let j = i
      while (j + 1 < lines.length && lines[j + 1].trim() !== '') j++
      out.push(`${line.trim()} [code cut]`)
      i = j
    } else out.push(line)
  }
  return out.join('\n')
}

/** A text with its code cut and every secret replaced by `[redacted:<pattern name>]`. */
export function redact(text) {
  let t = cutCode(text)
  for (const { name, re } of SECRET_PATTERNS) t = t.replace(re, `[redacted:${name}]`)
  return t.length > MAX_STRING ? `${t.slice(0, MAX_STRING)}…` : t
}

/** A value with every string in it redacted (arrays and plain objects are walked). */
export function deepRedact(v) {
  if (typeof v === 'string') return redact(v)
  if (Array.isArray(v)) return v.map(deepRedact)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepRedact(x)]))
  return v
}

// ---------------------------------------------------------------------------------------------------- signature

/**
 * A problem's text with what changes from run to run taken out, so the same failure in two runs or two projects has
 * the same signature: lower-case; quoted strings, ISO times, dates, hex ids of 7+ characters holding a digit,
 * `wt-<n>` slots, paths (absolute, under the project root, or relative with two slashes or a file extension) and
 * numbers become `<s> <t> <d> <h> <slot> <p> <n>`; spaces collapse; at most 120 characters. The script a command runs
 * (`node scripts/x.mjs`) stays: it names what failed.
 */
export function signature(text, { projectRoot } = {}) {
  // Secrets and code are cut first: a signature is stored and compared across projects, so it must never carry either.
  let t = redact(text).toLowerCase()
  if (projectRoot) {
    const r = String(projectRoot).toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '')
    if (r.length > 3) t = t.split(r).join('<p>').split(r.replace(/\//g, '\\')).join('<p>')
  }
  t = t
    .replace(/"[^"\n]*"|'[^'\n]*'|`[^`\n]*`/g, '<s>')
    .replace(/\d{4}-\d{2}-\d{2}t[\d:.]+z?/g, '<t>')
    .replace(/\d{4}-\d{2}-\d{2}/g, '<d>')
    .replace(/(?<![\w.\-])(?:[a-z]:[\\/]|\/)[^\s"'`,;()<>]*[\\/][^\s"'`,;()<>]*/g, '<p>')
    // A relative path (two or more slashes, or a file name with an extension) is a path too, so two reasons that differ
    // only in it match — except the script a command runs (`node scripts/x.mjs`): that names what failed.
    .replace(/(?<![\w.\-/<@:])[\w.\-@]+(?:\/[\w.\-@]*)+/g, (m, off, str) => {
      if (/\bnode $/.test(str.slice(Math.max(0, off - 5), off))) return m
      return (m.match(/\//g) ?? []).length >= 2 || /\.\w+$/.test(m) ? '<p>' : m
    })
    .replace(/\bwt-\d+\b/g, '<slot>')
    .replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{7,}\b/g, '<h>')
    .replace(/\b\d+(?:\.\d+)?\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
  return t.slice(0, 120)
}

/** The event kind of a run note, or null when the note is not one of the kinds. */
export function noteKind(text) {
  const t = String(text ?? '')
  if (/^model fallback/i.test(t)) return 'model-fallback'
  if (/^runner retry/i.test(t)) return 'runner-retry'
  if (/^(main-folder check dropped|check command dropped|ci-mirror check dropped)/i.test(t)) return 'main-check-dropped'
  if (/^environment failure/i.test(t)) return 'env-fail'
  if (/\bstuck\b/i.test(t)) return 'stuck'
  return null
}

/** The event kind of a park reason: a timeout, an environment failure or a plain park. */
export function parkKind(reason) {
  const t = String(reason ?? '')
  if (/timed out|timeout/i.test(t)) return 'timeout'
  if (/environment failure|env-fail/i.test(t)) return 'env-fail'
  return 'park'
}

// ---------------------------------------------------------------------------------------------------- identity

/** First 8 hex characters of the host name's hash: tells machines apart without naming them. */
export const machineId = (host = hostname()) => sha(host, 8)

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** { project, kitVersion, kitCommit, enabled } from the project's kit config and `.kit/install.json`. */
export function projectInfo(root) {
  const cfg = readJson(join(root, '.kit', 'config.json')) ?? readJson(join(root, 'kit.config.json')) ?? {}
  const install = readJson(join(root, '.kit', 'install.json')) ?? {}
  const slug = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return {
    project: slug(cfg.brain?.projectId) || slug(cfg.project?.repoName) || slug(basename(resolve(root))) || 'project',
    kitVersion: String(install.kit?.version ?? 'unknown'),
    kitCommit: String(install.commit ?? 'unknown').slice(0, 12),
    enabled: cfg.brain?.enabled !== false,
  }
}

const minutesBetween = (a, b) => {
  const x = Date.parse(a)
  const y = Date.parse(b)
  return Number.isFinite(x) && Number.isFinite(y) && y >= x ? Math.round(((y - x) / 60000) * 10) / 10 : null
}

// ---------------------------------------------------------------------------------------------------- the documents

const STATE_PHASE = { queued: 'readiness', building: 'building', fixing: 'building', gate: 'gate', checking: 'checks', merging: 'merge' }
const TERMINAL = new Set(['merged', 'parked', 'left-run', 'skipped'])

/**
 * Minutes per phase from a plan's `history[].at`: the time between a state's entry and the next entry belongs to that
 * state's phase (queued → readiness; building and fixing → building; gate; checking → checks; merging → merge;
 * env-paused → envPaused). The last entry runs to `endAt` (the run's finish) unless its state is final. The workflow
 * records no state for the `[ui]` check or the final gate, so those two stay null, as does any phase with no timestamps.
 */
export function phaseMinutes(history, endAt) {
  const out = Object.fromEntries([...PHASES, 'envPaused'].map((p) => [p, null]))
  const h = Array.isArray(history) ? history.filter((e) => e && typeof e.at === 'string') : []
  for (let i = 0; i < h.length; i++) {
    const phase = STATE_PHASE[h[i].state] ?? (h[i].state === 'env-paused' ? 'envPaused' : null)
    if (!phase) continue
    const next = h[i + 1]?.at ?? (TERMINAL.has(h[i].state) ? null : endAt)
    const m = next ? minutesBetween(h[i].at, next) : null
    if (m !== null) out[phase] = Math.round(((out[phase] ?? 0) + m) * 10) / 10
  }
  return out
}

const idOf = (project, run, kind, key) => `${project}:${run}:${kind}:${key}`

/** The common head of every document. */
function head(ctx, kind, key) {
  return { _id: idOf(ctx.project, ctx.run, kind, key), schema: SCHEMA, project: ctx.project, run: ctx.run, machine: ctx.machine, kitVersion: ctx.kitVersion, kitCommit: ctx.kitCommit }
}

/** The events of a run: parks, timeouts, env-fails, flakes, runner retries, model fallbacks, dropped main checks, stuck, final-gate fail. */
export function eventDocs(status, ctx) {
  const out = []
  const push = (kind, nnn, text, at, extra = {}) => {
    const raw = String(text ?? '')
    out.push({
      ...head(ctx, 'event', `${kind}-${nnn || 'run'}-${sha(`${kind}|${nnn}|${at ?? ''}|${raw}`, 8)}`),
      kind, plan: nnn || null, signature: signature(raw, { projectRoot: ctx.projectRoot }), text: redact(raw).slice(0, 300), at: at ?? null, ...extra,
    })
  }
  for (const p of Object.values(status.plans ?? {})) {
    const attempts = [...(p.earlier ?? []), p]
    for (const a of attempts) {
      if (a.state === 'parked' || a.state === 'left-run') push(parkKind(a.reason), p.nnn, a.reason ?? a.state, null, { round: a.round ?? null, tier: a.tier ?? null })
    }
    for (const f of p.flakes ?? []) push('flake', p.nnn, f.text ?? f.command, f.at ?? null, { round: f.round ?? null })
    for (const g of p.gateEvents ?? []) {
      const kind = /^timed out/i.test(g) ? 'timeout' : /^env-fail/i.test(g) ? 'env-fail' : null
      if (kind) push(kind, p.nnn, g, null)
    }
  }
  for (const f of status.flakes ?? []) push('flake', null, f.text ?? f.command, f.at ?? null)
  for (const n of status.notes ?? []) {
    const kind = noteKind(n.text)
    if (kind) push(kind, n.plan ?? null, n.text, n.at ?? null)
  }
  if (/fail/i.test(String(ctx.finalGate ?? ''))) push('final-gate-fail', null, `final gate: ${ctx.finalGate}`, status.finishedAt ?? null)
  return out
}

/** One document per plan: its state, rounds, tier, the models each role ran on and the minutes per phase. */
export function planDocs(status, ctx) {
  return Object.values(status.plans ?? {}).map((p) => ({
    ...head(ctx, 'plan', p.nnn),
    nnn: p.nnn, title: redact(p.title ?? '').slice(0, 200), state: p.state ?? null, round: p.round ?? 0, tier: p.tier ?? null,
    reason: p.reason ? redact(p.reason).slice(0, 300) : null, signature: p.reason ? signature(p.reason, { projectRoot: ctx.projectRoot }) : null,
    models: Object.fromEntries(Object.entries(p.models ?? {}).map(([role, m]) => [role, typeof m === 'object' && m ? { model: m.model ?? null, effort: m.effort ?? null } : { model: String(m), effort: null }])),
    humanItems: Array.isArray(p.humanItems) ? p.humanItems.length : 0,
    attempts: (p.earlier?.length ?? 0) + 1, flakes: p.flakes?.length ?? 0,
    verify: p.verify ? { candidates: p.verify.candidates ?? null, refuted: p.verify.refuted ?? null } : null,
    minutes: phaseMinutes(p.history, status.finishedAt),
  }))
}

/** The run document: totals the trend reads (plans, parked, fix rounds, flakes, decisions, minutes) and the tokens, if any. */
export function runDoc(status, ctx, tokens = null, tokensNote = null) {
  const plans = Object.values(status.plans ?? {})
  const count = (state) => plans.filter((p) => p.state === state).length
  const parked = plans.filter((p) => p.state === 'parked' || p.state === 'left-run').length
  return {
    ...head(ctx, 'run', '-'),
    branch: status.branch ?? null, base: status.base ?? null, startedAt: status.startedAt ?? null, finishedAt: status.finishedAt ?? null, phase: status.phase ?? null,
    attempts: status.attempts ?? 1, finalGate: ctx.finalGate ?? null,
    minutes: minutesBetween(status.startedAt, status.finishedAt),
    counts: {
      plans: plans.length, merged: count('merged'), parked, skipped: count('skipped'),
      fixRounds: plans.reduce((n, p) => n + (p.round ?? 0), 0),
      flakes: plans.reduce((n, p) => n + (p.flakes?.length ?? 0), 0) + (status.flakes?.length ?? 0),
      decisions: Array.isArray(status.decisions) ? status.decisions.length : 0,
      notes: status.notes?.length ?? 0,
    },
    tokens,
    tokensNote,
  }
}

/** { ctx, docs: { runs, plans, events } } for a run's status — everything `send --run` puts in the store. */
export function digestRun(status, { root, run, finalGate = null, tokens = null, tokensNote = null, host } = {}) {
  const info = projectInfo(root)
  const ctx = { ...info, run: run ?? status.run, machine: machineId(host), projectRoot: root, finalGate }
  return { ctx, docs: { runs: [runDoc(status, ctx, tokens, tokensNote)], plans: planDocs(status, ctx), events: eventDocs(status, ctx) } }
}

/** One document per grade row of `docs/brain/decision-grades.jsonl` (rows of `run` only, or all rows when run is null). */
export function gradeDocs(rows, { root, run = null, host } = {}) {
  const info = projectInfo(root)
  return rows.filter((r) => r && r.id && (run === null || r.run === run)).map((r) => {
    const ctx = { ...info, run: r.run, machine: machineId(host) }
    return {
      ...head(ctx, 'grade', r.id),
      plan: r.plan ?? null, id: r.id, type: r.type ?? null, kind: r.kind ?? null, text: redact(r.text ?? '').slice(0, 400),
      triageVerdict: r.triageVerdict ?? 'none', triageRecommendation: redact(r.triageRecommendation ?? '').slice(0, 200), confidence: r.confidence ?? null,
      humanVerdict: r.humanVerdict ?? null, humanChoice: redact(r.humanChoice ?? '').slice(0, 300), date: r.date ?? null,
      kitVersion: r.kitVersion ?? info.kitVersion,
    }
  })
}

/** The Planner's by-hand lines after a run (at most 8): { step, minutes, script: "yes"|"no" }. */
export function toilDocs(lines, { root, run, host } = {}) {
  const ctx = { ...projectInfo(root), run, machine: machineId(host) }
  return (Array.isArray(lines) ? lines : []).slice(0, 8).map((l, i) => ({
    ...head(ctx, 'toil', i),
    step: redact(l?.step ?? '').slice(0, 200), minutes: Number.isFinite(l?.minutes) ? l.minutes : null,
    script: /^(yes|true)$/i.test(String(l?.script ?? l?.couldScript ?? '')) ? 'yes' : 'no',
  }))
}

/** One lesson for the kit (`lessonsIn`): { role, title, text, why }. The `_id` follows the title and text. */
export function lessonDoc(lesson, { root, host } = {}) {
  const info = projectInfo(root)
  const text = redact(lesson?.text ?? '')
  const title = redact(lesson?.title ?? '').slice(0, 200)
  return {
    _id: `${info.project}:lesson:${sha(`${title}|${text}`, 12)}`, schema: SCHEMA, project: info.project, machine: machineId(host), kitVersion: info.kitVersion, kitCommit: info.kitCommit,
    role: lesson?.role ? redact(String(lesson.role)).slice(0, 40) : null, title, text, why: redact(lesson?.why ?? '').slice(0, 500),
  }
}

// ---------------------------------------------------------------------------------------------------- tokens (B11)

/**
 * How many roles a run's agents had in each `workflowPhase` of the workflow runtime (since deleted; its
 * transcripts can still be read). Tokens are summed twice: per `workflowPhase` (`byPhase`, always) and per role
 * (`byRole`). The role is the meta file's `agentType` (`orch-builder`, …: set by the runtime, not free text); an agent
 * whose `agentType` is missing or the generic `workflow-subagent` falls back to its phase, keyed `phase:<Phase>`. `Build`
 * is the phase that matters: the builder, the checkers and the `[ui]` checker all ran in it, so the `Build` total alone
 * is the whole plan's cost — use `byRole` to split it. `mixedRoles: true` on a phase means its total holds more than one
 * role: more than one distinct `agentType` was seen in it, or some of its agents fell back to the phase and this table
 * counts more than one role for it. Tokens of a fallback agent are never assigned to a guessed role. (`description` is
 * free text and is never read.)
 */
export const PHASE_ROLE_COUNT = { Start: 1, Readiness: 2, Build: 10, Report: 2 }

const zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0, agents: 0 })

/** The folder Claude Code keeps a project's transcripts in: the path with every non-alphanumeric character a dash. */
export const transcriptDir = (root, home = homedir()) => join(home, '.claude', 'projects', resolve(root).replace(/[^A-Za-z0-9]/g, '-'))

/**
 * Tokens of one run, summed per `workflowPhase` and per role (see PHASE_ROLE_COUNT), from the transcripts Claude Code keeps of a Workflow's agents
 * (`<transcriptDir>/<session>/subagents/workflows/wf_<id>/agent-*.jsonl` + `.meta.json`). A workflow folder belongs to
 * the run when its agent files were last written between the run's `startedAt` and a minute after `finishedAt`.
 * Assistant lines carry `message.usage` and `message.id`; a message id counts once. The format is not an official
 * contract: anything this reader does not know — no folder, a meta file without a string `workflowPhase`, an
 * unreadable file — gives `{ tokens: null, note }`, and it never throws.
 */
export function tokensForRun({ root, startedAt, finishedAt, home = homedir() }) {
  try {
    const from = Date.parse(startedAt)
    const to = Date.parse(finishedAt) + 60_000
    if (!Number.isFinite(from) || !Number.isFinite(to)) return { tokens: null, note: 'tokens: the run has no start or finish time' }
    const base = transcriptDir(root, home)
    if (!existsSync(base)) return { tokens: null, note: 'tokens: no transcript folder for this project on this machine' }
    const wfDirs = []
    for (const s of readdirSync(base, { withFileTypes: true })) {
      const wf = join(base, s.name, 'subagents', 'workflows')
      if (!s.isDirectory() || !existsSync(wf)) continue
      for (const d of readdirSync(wf, { withFileTypes: true })) if (d.isDirectory() && d.name.startsWith('wf_')) wfDirs.push(join(wf, d.name))
    }
    const byPhase = {}
    const byRole = {}
    const total = zero()
    const seen = new Set()
    let used = 0
    for (const dir of wfDirs) {
      const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
      if (!files.length) continue
      const last = Math.max(...files.map((f) => statSync(join(dir, f)).mtimeMs))
      if (last < from || last > to) continue
      used++
      for (const f of files) {
        const meta = readJson(join(dir, f.replace(/\.jsonl$/, '.meta.json')))
        if (!meta || typeof meta.workflowPhase !== 'string' || !meta.workflowPhase) return { tokens: null, note: `tokens: ${f} has no workflowPhase — format not recognised` }
        const agentType = typeof meta.agentType === 'string' && /^[\w:.-]{1,60}$/.test(meta.agentType) && meta.agentType !== 'workflow-subagent' ? meta.agentType : null
        const bucket = (byPhase[meta.workflowPhase] ??= { ...zero(), roles: [], fallback: 0 })
        const roleKey = agentType ?? `phase:${meta.workflowPhase}`
        const roleBucket = (byRole[roleKey] ??= { ...zero(), phases: [] })
        if (!roleBucket.phases.includes(meta.workflowPhase)) roleBucket.phases.push(meta.workflowPhase)
        if (agentType) {
          if (!bucket.roles.includes(agentType)) bucket.roles.push(agentType)
        } else bucket.fallback++
        bucket.agents++
        roleBucket.agents++
        total.agents++
        for (const line of readFileSync(join(dir, f), 'utf8').split(/\r?\n/)) {
          if (!line.includes('"usage"')) continue
          let o
          try {
            o = JSON.parse(line)
          } catch {
            continue
          }
          const m = o?.message
          const u = m?.usage
          if (!u || typeof u !== 'object') continue
          const id = m.id ?? o.uuid
          if (!id || seen.has(id)) continue
          seen.add(id)
          for (const [k, field] of [['input', 'input_tokens'], ['output', 'output_tokens'], ['cacheRead', 'cache_read_input_tokens'], ['cacheCreation', 'cache_creation_input_tokens']]) {
            const n = Number.isFinite(u[field]) ? u[field] : 0
            bucket[k] += n
            roleBucket[k] += n
            total[k] += n
          }
        }
      }
    }
    if (!used) return { tokens: null, note: 'tokens: no workflow transcripts for this run' }
    for (const [phase, b] of Object.entries(byPhase)) {
      b.roles.sort()
      b.mixedRoles = b.roles.length > 1 || (b.fallback > 0 && (PHASE_ROLE_COUNT[phase] ?? 0) > 1)
    }
    return { tokens: { byPhase, byRole, total, source: 'workflow transcripts' }, note: null }
  } catch (e) {
    return { tokens: null, note: `tokens: transcripts not read (${String(e?.message ?? e).split('\n')[0].slice(0, 100)})` }
  }
}

// ---------------------------------------------------------------------------------------------------- driver

/** The brain's folder on this machine: queue and driver live here, outside every project. */
export const brainHome = (home = process.env.KIT_BRAIN_HOME || homedir()) => join(home, '.kit-brain')

/**
 * The database driver's `MongoClient`: from a stub module (`driverPath`, tests) or from `<brainHome>/node_modules/mongodb`
 * (installed once per machine by `brain.mjs setup`). Nothing else is loaded, so a machine without the setup never
 * touches a driver.
 */
export async function loadDriver({ driverPath, home } = {}) {
  if (driverPath) {
    const mod = await import(pathToFileURL(resolve(driverPath)).href)
    return mod.MongoClient ?? mod.default?.MongoClient ?? mod.default
  }
  const req = createRequire(join(brainHome(home), 'package.json'))
  return req('mongodb').MongoClient
}
