/**
 * run-plans — the orchestrator as one script (docs/agent/orchestrator.md; the kit's ADR 0017). Builds,
 * gates, reviews and merges saved plans into the run branch `<orchestrator.runBranchPrefix><run>`; never the main branch.
 *
 *   node scripts/run-plans.mjs --run <name> --plans <NNN,NNN> [--concurrency 1|2] [--db local|remote] [--reviewer-mode gate|advisory]
 *   node scripts/run-plans.mjs --dry-run [--run <name>] --plans <NNN,NNN>
 *
 * Only two steps are model calls, each one headless `claude -p` (scripts/lib/claude-run.mjs): the builder
 * (.claude/agents/orch-builder.md, models.build; cwd = the plan's own folder) and the reviewer
 * (.claude/agents/plan-reviewer.md, its own model line; cwd = a read-only review folder at the checked head, no write
 * tool). Everything else is code: the readiness lint, the preflight, the run state (scripts/orch-state.mjs), the gate
 * (lib/plan-gate.mjs), the merge and its pin (lib/plan-merge.mjs, `orch-state.mjs merge-verify`), the order and what a
 * park blocks (lib/run-order.mjs), the park teardown (`orch-state.mjs park` → plan-park.mjs) and the report
 * (`orch-state.mjs finish`).
 *
 * Per plan: builder → gate → review → merge. A failed gate or an enforced review STOP gets one fix round on the same
 * tier with the findings; a second failure with a new reason gets `handoff --reset-base` and one fresh judgment-tier
 * builder (INV-1); the same reason twice, or a failure after that, asks (orchestrator.maxFixRounds counts those rounds,
 * default 2). An ask — those, a builder's question, a review that could not run twice — is one file
 * (.claude/orchestrator-runs/<run>/asks/<NNN>-<n>.json): only its plan waits, and what it blocks is held; once the rest
 * ended the run polls for answers (ASK_WAIT_MIN), resumes an answered plan, and parks an unanswered one. A park skips
 * only the later plans that depend on it or share its files
 * (orchestrator.onPark "dependents"); the run goes on. A call that hits a rate or usage limit pauses the run
 * (env-paused), waits orchestrator.rateLimitWaitMin minutes and retries once; a second hit stops the run with
 * `stopped: rate-limit`, and scripts/run-supervisor.mjs relaunches it after the reset.
 *
 * --dry-run prints the waves, each plan's readiness lint, the preflight result and the commands the run would run, and
 * calls no model (nothing is created). --concurrency 2 runs two plans of one wave at once (default 1). --reviewer-mode
 * overrides orchestrator.reviewerMode for one run. RUN_PLANS_CLAUDE (or --claude <bin>) replaces the `claude` command: tests pass a fake.
 * Writes .claude/orchestrator-runs/<run>/status.json (through orch-state.mjs, so `orch-state.mjs watch` works) and
 * calls.csv (one row per model call and per gate command). Last line: `RUN_PLANS_JSON {…}`.
 * Exit 0 = every plan merged, 2 = some parked or skipped, 1 = refused before the start (nothing was built).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, rmSync, readdirSync, renameSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { extractScopeGlobs, testRefusals, removedLinesByFile, isTestPath } from './lib/plan-scope.mjs'
import { readAgent, claudeArgs, runAgent, parseResult, passedModel } from './lib/claude-run.mjs'
import { isSensitive } from './ship-prep.mjs'
import { gateCommands, runGate, scopeCheck, scopeMarker } from './lib/plan-gate.mjs'
import { review, blocking, problemLine } from './lib/plan-review.mjs'
import { mergePlan, orchState } from './lib/plan-merge.mjs'
import { runOrder, unitsOf, afterPark, blockedBy } from './lib/run-order.mjs'
import { planBranch, planBranchProblem, runNameProblem, startTier, humanOnlyAsk, ASK_KINDS, askCard, ASK_ID_RE } from './lib/orch-run.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const MODELS = { build: {{models.build|json}}, judgment: {{models.judgment|json}} }
const RUN_PREFIX = {{orchestrator.runBranchPrefix|json}}
const PM = {{project.packageManager|json}} === 'pnpm' ? 'pnpm' : 'npm'
const COMMANDS = { build: {{commands.build|json}}, lint: {{commands.lint|json}}, test: {{commands.test|json}}, testCi: {{commands.testCi|json}} }
const PREPARE = {{orchestrator.prepare|json}}
const CI_MIRROR = {{orchestrator.ciMirror|json}}
const MERGE_CHECKS_MODE = {{orchestrator.mergeChecks|json}}
const GATE_TIMEOUT_MIN = Number({{orchestrator.gateTimeoutMin|json}}) || 15
// A builder has no wall-clock limit: it is stopped only after this many minutes in which no file in its folder changed
// (lib/claude-run.mjs spawnClaude). A fixed value, not a setting (the orchestrator settings are capped in size-budget.json).
export const BUILDER_IDLE_MIN = 15
// RUN_PLANS_BUILDER_IDLE_MS and RUN_PLANS_BUILDER_POLL_MS (tests only) replace them, like RUN_PLANS_CLAUDE replaces claude.
const BUILDER_IDLE_MS = Number(process.env.RUN_PLANS_BUILDER_IDLE_MS) > 0 ? Number(process.env.RUN_PLANS_BUILDER_IDLE_MS) : BUILDER_IDLE_MIN * 60_000
const BUILDER_POLL_MS = Number(process.env.RUN_PLANS_BUILDER_POLL_MS) > 0 ? Number(process.env.RUN_PLANS_BUILDER_POLL_MS) : 30_000
// A plan that asks waits, once every other plan of the run has ended, this many minutes for its answer (polled every
// 30 s); then it parks with its question in the report. Fixed like BUILDER_IDLE_MIN, not a setting.
export const ASK_WAIT_MIN = 180
// RUN_PLANS_ASK_WAIT_MS and RUN_PLANS_ASK_POLL_MS (tests only) replace them.
const ASK_WAIT_MS = Number(process.env.RUN_PLANS_ASK_WAIT_MS) > 0 ? Number(process.env.RUN_PLANS_ASK_WAIT_MS) : ASK_WAIT_MIN * 60_000
const ASK_POLL_MS = Number(process.env.RUN_PLANS_ASK_POLL_MS) > 0 ? Number(process.env.RUN_PLANS_ASK_POLL_MS) : 30_000
// A plan asks at most this many times in one run; the next question parks it (an answer loop never runs forever).
const ASK_MAX = 3
const MAIN = '{{git.mainBranch}}'
// One plan at a time unless --concurrency 2 is given (goal decision: more builders on one machine made specs time
// out); orchestrator.concurrency stays the workflow's setting.
const CONCURRENCY = 1
const ON_PARK = {{orchestrator.onPark|json}}
const MAX_FIX_ROUNDS = Number({{orchestrator.maxFixRounds|json}}) || 2
// Unset or anything but advisory: gate (a STOP parks after its fix round).
const REVIEWER_MODE = {{orchestrator.reviewerMode|json}} === 'advisory' ? 'advisory' : 'gate'
const REVIEWER_MODEL = {{orchestrator.reviewerModel|json}}
const RATE_LIMIT_WAIT_MIN = Number({{orchestrator.rateLimitWaitMin|json}}) >= 0 ? Number({{orchestrator.rateLimitWaitMin|json}}) : 30
const STALE_MIN = Number({{orchestrator.staleMin|json}}) || 10
// What every plan may touch and what none may (the same lists scope-check.mjs renders), for the trusted scope check.
const HOTSPOTS = [
  {{project.i18nFile|quoted}},
  {{paths.hotspots|quoted}}
].filter(Boolean)
const UPSTREAM = [].concat({{ownership.upstreamPaths|json}}).filter(Boolean)
const REVIEW_TIMEOUT_MIN = 10
const MAX_CONCURRENCY = 2

// ---- check commands (the same allowlist as the workflow's checkProblem) ------------------------------------------
const DENY = /\brm\s+-[a-z]*[rf]|reset\s+--hard|push\s+(?:[^\n]*\s)?(?:--force|-f\b|--force-with-lease)|git\s+clean|branch\s+-D|stash\s+clear|filter-branch/
const SAFE_ARG = /^[A-Za-z0-9_./=:,@+-]+$/
// The kit's own scripts that push, start a run, write run/plan/slot state or install files are never a check.
const NOT_A_CHECK = new Set([
  'kit-feedback', 'orch-state', 'decision-log', 'take-plan', 'slot-serve', 'slot-stop', 'todo-query',
  'todo-archive', 'plan-close', 'free-merged-slots', 'orphan-sweep', 'local-excludes', 'brain-capture-comment', 'sync', 'install', 'kit-sync',
  'run-plans', 'plan-park',
])
export function checkProblem(cmd, scripts = null) {
  const c = String(cmd ?? '').trim()
  if (DENY.test(c)) return `${c}: on the deny list`
  const npm = /^(?:npm|pnpm) run ([A-Za-z0-9:_-]+)$/.exec(c)
  if (npm) return scripts && !scripts.includes(npm[1]) ? `${c}: no script ${npm[1]} in package.json` : null
  const w = c.split(/ +/)
  const safe = (ws) => ws.every((x) => SAFE_ARG.test(x) && !x.includes('..'))
  if (w[0] === 'node' && /^(tools|scripts)\/[A-Za-z0-9_./-]+\.m?js$/.test(w[1] ?? '') && safe(w.slice(1))) {
    const name = w[1].split('/').pop().toLowerCase().replace(/\.m?js$/, '')
    if (NOT_A_CHECK.has(name)) return `${c}: ${name} changes state or pushes, it is not a check`
    const writes = w.slice(2).find((x) => /^--(write|apply|fix|update)(=.*)?$/.test(x))
    return writes ? `${c}: ${writes.split('=')[0]} writes files, it is not a check` : null
  }
  if (w[0] === 'node' && w[1] === '--test' && safe(w.slice(2)) && w.slice(2).every((x) => !x.startsWith('-') || /^--test-[a-z-]+(=[\w.,-]+)?$/.test(x))) return null
  return `${c}: not an allowed check (${PM} run <package.json script>, node tools/… or scripts/…, node --test <files>)`
}
/** The project files a check command names (node tools/x.mjs → that file; node --test a b → a and b). */
export function checkFilesOf(cmd) {
  const w = String(cmd ?? '').trim().split(/ +/)
  if (w[0] !== 'node') return []
  if (w[1] === '--test') return w.slice(2).filter((x) => !x.startsWith('-') && SAFE_ARG.test(x) && !x.includes('..'))
  return /^(tools|scripts)\/[A-Za-z0-9_./-]+\.m?js$/.test(w[1] ?? '') ? [w[1]] : []
}
const collapse = (s) => String(s ?? '').trim().replace(/\s+/g, ' ')

// ---- plan text --------------------------------------------------------------------------------------------------
const DONE_WHEN_SECTION_RE = /^##\s+.*(?:success criteria|done[- ]when)/i
/** The commands (backticked) of the plan's open [auto] Done-when items — not [auto:main], not a ticked item. */
export function autoCommands(planText) {
  const out = []
  let inSection = false
  for (const line of String(planText).replace(/\r\n/g, '\n').split('\n')) {
    if (/^#{1,6}\s/.test(line)) {
      inSection = DONE_WHEN_SECTION_RE.test(line)
      continue
    }
    if (!inSection) continue
    const m = /^\s*[-*]\s+(?:\[( |x|X)\]\s+)?\[auto\]\s*(.*)$/.exec(line)
    if (!m || /x/i.test(m[1] ?? '')) continue
    for (const span of m[2].matchAll(/`([^`]+)`/g)) {
      const c = collapse(span[1])
      if (/^(node|npm run|pnpm run|npx) /.test(c) && !out.includes(c)) out.push(c)
    }
  }
  return out
}
/** Every `Q:` of `## Critical Questions` with its number and answer ('' when none): [{ n, question, answer }]. */
export function criticalQuestions(planText) {
  const lines = String(planText).replace(/\r\n/g, '\n').split('\n')
  const at = lines.findIndex((l) => /^##\s+Critical Questions\b/i.test(l))
  if (at < 0) return []
  const out = []
  for (let i = at + 1; i < lines.length && !/^##\s/.test(lines[i]); i++) {
    const q = /^\s*[-*]?\s*(?:\*\*)?Q(\d+)?(?:\*\*)?\s*[:.]\s*(.*)$/.exec(lines[i])
    if (!q) continue
    const inline = /\bA\s*:\s*(.*)$/.exec(q[2])
    let answer = inline ? inline[1] : null
    const question = (inline ? q[2].slice(0, inline.index) : q[2]).trim()
    if (answer === null) {
      const next = lines.slice(i + 1).find((l) => l.trim() !== '')
      const a = next ? /^\s*[-*]?\s*(?:\*\*)?A(?:\d+)?(?:\*\*)?\s*:\s*(.*)$/.exec(next) : null
      answer = a ? a[1] : ''
    }
    out.push({ n: q[1] ?? String(out.length + 1), question, answer: answer.trim() })
  }
  return out
}
const isOpen = (answer) => !answer || /^open\b/i.test(answer)
/** The open questions of `## Critical Questions`: a `Q:` whose answer says `A: open` (or has no answer). */
export function openQuestions(planText) {
  return criticalQuestions(planText).filter((q) => isOpen(q.answer)).map((q) => q.question)
}

// ---- the Human's decisions and the two hard limits ---------------------------------------------------------------
/** Given to every builder, word for word (docs/brain/human-decisions.md, section 4). */
export const HARD_LIMITS = [
  'Never choose more autonomy or more spend than the plan asks for.',
  'Never treat a database or folder as production without an explicit Human answer.',
]
/** D01, d1 and D1 are one decision: `D` and the number without leading zeros. */
const decisionId = (id) => `D${Number(String(id).slice(1))}`
/** id → status of the `## 1. Decisions` table of human-decisions.md (read-only); null text → null (no file). */
export function decisionStatuses(text) {
  if (text === null || text === undefined) return null
  const out = new Map()
  const lines = String(text).replace(/\r\n/g, '\n').split('\n')
  const at = lines.findIndex((l) => /^##\s+(?:\d+\.\s*)?Decisions\b/i.test(l))
  if (at < 0) return out
  let col = -1
  for (let i = at + 1; i < lines.length && !/^##\s/.test(lines[i]); i++) {
    if (!lines[i].trim().startsWith('|')) continue
    const cells = lines[i].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
    if (col < 0) {
      col = cells.findIndex((c) => /^status$/i.test(c))
      continue
    }
    if (/^D\d+$/i.test(cells[0]) && cells[col] !== undefined) out.set(decisionId(cells[0]), cells[col])
  }
  return out
}
/** An answer marked as the Human's own: `A: (Human, <date>) …` or `A: Human …`. */
const isHumanAnswer = (answer) => /^\(?\s*Human\b/i.test(answer)
/** `A: default per D<n>` stands only while D<n> is `in force`; anything else (or no file) goes back to the Human. */
export function decisionProblems(planText, statuses) {
  const out = []
  for (const q of criticalQuestions(planText)) {
    if (isHumanAnswer(q.answer)) continue
    for (const m of q.answer.matchAll(/\bdefault per (D\d+)\b/gi)) {
      const id = m[1].toUpperCase()
      const status = statuses === null ? 'unknown (no docs/brain/human-decisions.md)' : statuses.get(decisionId(id)) ?? 'not recorded'
      if (!/^in force\b/i.test(status)) out.push(`default per ${id}: decision is ${status} — ask the Human (Q${q.n})`)
    }
  }
  return out
}
const PROD_WORD = /\b(?:production|prod|live)\b/i
const PLACE_WORD = /\b(?:databases?|dbs?|clusters?|atlas|folders?|servers?)\b/i
/** A production question (a production word and a database/folder word) needs the Human's own answer. */
export function productionProblems(nnn, planText) {
  return criticalQuestions(planText)
    .filter((q) => !isOpen(q.answer) && PROD_WORD.test(q.question) && PLACE_WORD.test(q.question) && !isHumanAnswer(q.answer))
    .map((q) => `production needs an explicit Human answer (plan ${nnn} Q${q.n})`)
}
/** What the plan asks for: only the lines of its `## Execution Mode`, case-insensitive, exact value. */
export function executionAsks(planText) {
  const lines = String(planText).replace(/\r\n/g, '\n').split('\n')
  const at = lines.findIndex((l) => /^##\s+Execution Mode\b/i.test(l))
  const section = []
  for (let i = at + 1; at >= 0 && i < lines.length && !/^##\s/.test(lines[i]); i++) section.push(lines[i])
  const asks = { concurrentPlans: [], reviewerAdvisory: false, dbRemote: false }
  const end = '\\s*(?:[.;,]|$)'
  for (const l of section) {
    const c = /\bConcurrent plans:\s*([^.;\n]*)/i.exec(l)
    if (c) asks.concurrentPlans.push(...(c[1].match(/\b\d{1,4}\b/g) ?? []).map((n) => n.padStart(3, '0')))
    if (new RegExp(`\\bReviewer:\\s*advisory${end}`, 'i').test(l)) asks.reviewerAdvisory = true
    if (new RegExp(`\\bDatabase:\\s*remote${end}`, 'i').test(l)) asks.dbRemote = true
  }
  return asks
}
/**
 * The run options against what plan `nnn` asks for: more autonomy or spend than it asks is refused. A config default
 * of advisory review (no --reviewer-mode flag) is never refused: that plan's review is enforced (gate) instead.
 */
export function optionProblems({ nnn, planText, opts, runPlans }) {
  const asks = executionAsks(planText)
  const problems = []
  const notes = []
  let reviewerMode = opts.reviewerMode
  if (opts.concurrency > 1 && !asks.concurrentPlans.some((p) => p !== nnn && runPlans.includes(p))) problems.push(`more autonomy than plan ${nnn} asks for: --concurrency ${opts.concurrency}`)
  if (opts.reviewerMode === 'advisory' && !asks.reviewerAdvisory) {
    if (opts.reviewerModeSet) problems.push(`more autonomy than plan ${nnn} asks for: --reviewer-mode advisory`)
    else {
      reviewerMode = 'gate'
      notes.push(`reviewer gate for plan ${nnn}: the plan has no Reviewer: advisory line (config default advisory not used)`)
    }
  }
  if (opts.db === 'remote' && !asks.dbRemote) problems.push(`more spend/risk than plan ${nnn} asks for: --db remote`)
  return { problems, reviewerMode, notes }
}

// ---- small helpers ----------------------------------------------------------------------------------------------
const nowIso = () => new Date().toISOString()
// A real run appends every line it prints to .claude/orchestrator-runs/<run>.console.log (consoleLog below), so the
// run keeps its own log: a relaunch adds to it, a kill keeps every line up to the kill.
let CONSOLE_LOG = null
export function consoleLogPath(root, run) {
  return join(root, '.claude', 'orchestrator-runs', `${run}.console.log`)
}
const say = (line) => {
  console.log(line)
  if (!CONSOLE_LOG) return
  try {
    appendFileSync(CONSOLE_LOG, `${line}\n`)
  } catch { /* the log is a convenience; the run goes on */ }
}
const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const lastLine = (s) => String(s ?? '').split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? ''
const git = (cwd, ...a) => {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  return { status: r.status ?? 1, out: String(r.stdout ?? '').trim(), err: String(r.stderr ?? '').trim() }
}
const node = (script, args, cwd = ROOT, timeoutMs = 10 * 60_000) => {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...args], { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 })
  return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, stdout: String(r.stdout ?? '') }
}
const orchJson = (out) => {
  const line = String(out).split(/\r?\n/).reverse().find((l) => l.startsWith('ORCH_JSON '))
  try {
    return line ? JSON.parse(line.slice('ORCH_JSON '.length)) : null
  } catch {
    return null
  }
}
const state = (cmd, flags = {}) => orchState(ROOT, [cmd, ...Object.entries(flags).filter(([, v]) => v !== undefined && v !== null && v !== false).map(([k, v]) => (v === true ? `--${k}` : `--${k}=${v}`))])

// ---- arguments --------------------------------------------------------------------------------------------------
function parseArgs(argv) {
  const o = { run: null, plans: [], dryRun: false, concurrency: Math.min(CONCURRENCY, MAX_CONCURRENCY), db: 'local', claude: process.env.RUN_PLANS_CLAUDE || 'claude', reviewerMode: REVIEWER_MODE }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const [k, inline] = a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined]
    const val = () => (inline !== undefined ? inline : argv[++i])
    if (k === '--run') o.run = val()
    else if (k === '--plans') o.plans = String(val() ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    else if (k === '--dry-run') o.dryRun = true
    else if (k === '--concurrency') o.concurrency = Number(val())
    else if (k === '--db') o.db = val()
    else if (k === '--claude') o.claude = val()
    else if (k === '--reviewer-mode') {
      o.reviewerMode = val()
      o.reviewerModeSet = true
    }
    else return { problem: `unknown argument ${a}` }
  }
  if (!o.run && o.dryRun) o.run = 'dry-run'
  if (!o.run) return { problem: '--run <name> is required' }
  const why = runNameProblem(o.run)
  if (why) return { problem: why }
  if (!o.plans.length || !o.plans.every((p) => /^\d{1,4}$/.test(p))) return { problem: '--plans takes plan numbers, comma-separated' }
  if (!Number.isInteger(o.concurrency) || o.concurrency < 1 || o.concurrency > MAX_CONCURRENCY) return { problem: `--concurrency takes 1 or ${MAX_CONCURRENCY}` }
  if (!['local', 'remote'].includes(o.db)) return { problem: '--db takes local or remote' }
  if (!['gate', 'advisory'].includes(o.reviewerMode)) return { problem: '--reviewer-mode takes gate or advisory' }
  o.plans = o.plans.map((p) => p.padStart(3, '0'))
  return { opts: o }
}

// ---- readiness lint (script only) -------------------------------------------------------------------------------
let scriptBodies = null
function npmScripts() {
  if (scriptBodies === null) {
    const s = state('scripts')
    scriptBodies = s.ok && s.scripts && typeof s.scripts === 'object' ? s.scripts : {}
  }
  return scriptBodies
}
function lintPlan(nnn, path, runBranch, { statuses = null, opts = null, runPlans = [] } = {}) {
  const lines = []
  const problems = []
  const notes = []
  const text = readFileSync(join(ROOT, path), 'utf8')
  // The Human's decisions and the two hard limits: a stale default, a production default or a run option
  // above the plan's own Execution Mode lines makes the plan not ready.
  const opt = opts ? optionProblems({ nnn, planText: text, opts, runPlans }) : { problems: [], reviewerMode: null, notes: [] }
  const decided = [...decisionProblems(text, statuses), ...productionProblems(nnn, text), ...opt.problems]
  problems.push(...decided)
  lines.push(`decisions: ${decided.length ? `${decided.length} problem(s)` : 'ok'}${opt.notes.length ? ` · ${opt.notes.join(' · ')}` : ''}`)
  for (const mode of ['deps', 'arch', 'tags']) {
    const r = node('scope-check.mjs', [`--${mode}`, `--plan=${path}`])
    const line = lastLine(r.out) || `exit ${r.status}`
    lines.push(`${mode}: ${line}`)
    if (r.status !== 0) problems.push(`scope-check --${mode}: ${line}`)
  }
  const branch = planBranch(path, nnn)
  const bp = planBranchProblem(branch)
  if (bp) problems.push(bp)
  const questions = openQuestions(text)
  for (const q of questions) problems.push(`open question (A: open): ${q}`)
  lines.push(`questions: ${questions.length ? questions.map((q) => `OPEN ${q}`).join(' | ') : 'none open'}`)
  // [auto] commands: an npx check becomes the package.json script that runs it; anything not allowed is dropped.
  const mapped = []
  const dropped = []
  const extra = []
  for (const c of autoCommands(text)) {
    let cmd = c
    if (/^npx /.test(c)) {
      const bodies = npmScripts()
      const name = Object.keys(bodies).find((n) => collapse(bodies[n]) === c.replace(/^npx /, '') || collapse(bodies[n]) === c)
      if (!name) {
        dropped.push(`${c}: no package.json script runs "${c.replace(/^npx /, '')}"`)
        continue
      }
      cmd = `${PM} run ${name}`
      mapped.push(`${c} → ${cmd}`)
    }
    const why = checkProblem(cmd, Object.keys(npmScripts()))
    if (why) dropped.push(why)
    else extra.push(cmd)
  }
  const files = [...new Set(extra.flatMap(checkFilesOf))]
  let missing = []
  if (files.length) {
    const cf = state('check-files', { plan: nnn, files: files.join(',') })
    missing = cf.ok ? cf.missing ?? [] : []
    if (!cf.ok) notes.push(`check-files: ${cf.error}`)
  }
  for (const f of missing) problems.push(`check file ${f} does not exist and the plan does not create it`)
  lines.push(`check files: ${files.length ? (missing.length ? `missing ${missing.join(', ')}` : `ok (${files.length})`) : 'none named'}`)
  if (mapped.length) lines.push(`npx: ${mapped.join('; ')}`)
  // A check the plan's author wrote that the runner cannot run is a readiness problem, never a dropped note: the plan
  // would merge without it.
  for (const d of dropped) problems.push(`check command the runner cannot run: ${d}`)
  // The plan branch an earlier run left: one not built on this run's base would be reused and fail at once.
  const base = git(ROOT, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${runBranch}`).status === 0 ? `origin/${runBranch}` : `origin/${MAIN}`
  const stale = staleBranchProblem({ root: ROOT, branch, base, run: runBranch.slice(RUN_PREFIX.length), nnn })
  // Not a refusal: the run renames it to park/stale-<NNN> at the plan's start and cuts a fresh branch (orch-state plan-info).
  if (stale) lines.push(stale)
  // The gate's test-file check, on what the builder will change: a check file the plan creates, and what an existing
  // plan branch already changed.
  const created = files.filter((f) => !existsSync(join(ROOT, f)) && !missing.includes(f))
  const onBranch = !stale && git(ROOT, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).status === 0 ? git(ROOT, 'diff', '--name-only', '--no-renames', `${base}...${branch}`).out.split('\n').filter(Boolean) : []
  const removed = onBranch.length ? removedLinesByFile(git(ROOT, 'diff', '-U0', '--no-color', '--no-renames', `${base}...${branch}`).out) : {}
  const gateFiles = [...new Set([...created, ...onBranch, ...plannedTestPaths(text)])].filter((f) => f !== path && !f.startsWith('.claude/sessions/'))
  const outOfScope = testsOutOfScope(text, gateFiles, removed)
  for (const r of outOfScope) problems.push(`test file gate: ${r.reason}${r.reason.startsWith('sibling test weakened') ? '' : `; add this line to the scope block: ${r.file}`}`)
  lines.push(`test files: ${outOfScope.length ? `outside the scope ${outOfScope.map((r) => r.file).join(', ')}` : 'ok'}`)
  const checks = gateCommands({ prepare: PREPARE, pm: PM, ...COMMANDS, kitRoot: ROOT, manifest: existsSync(join(ROOT, 'scripts', 'kit-manifest-check.mjs')) && existsSync(join(ROOT, 'docs', 'workflow-kit', 'manifest.json')), scope: { base: `origin/${runBranch}`, plan: path }, extra: extra.filter((c) => !missing.some((f) => checkFilesOf(c).includes(f))) })
  return { nnn, path, title: (/^#\s+(.*)$/m.exec(text)?.[1] ?? '').trim(), branch, lines, problems, notes, dropped, checks, start: startTier(text), reviewerMode: opt.reviewerMode, ready: problems.length === 0 }
}

/**
 * A builder ESCALATE (or blocked) about the scope — a file outside the Read-Write Scope, an `approved:` path, a scope
 * extension: only a plan edit fixes it. A db-write ask is not one (it goes to the Human as a question).
 */
export function isScopeEscalation(result) {
  if (!result || !['ESCALATE', 'blocked'].includes(String(result.status ?? ''))) return false
  const text = `${result.blocker ?? ''} ${result.planChange?.why ?? ''}`
  if (/^\s*ESCALATE: db-write/i.test(String(result.blocker ?? ''))) return false
  return /\bapproved:\s*\S|outside (?:of )?(?:the |its |this plan's |the plan's )?(?:read-write )?scope|scope extended|SCOPE_GUARD|not in (?:the |its )?(?:read-write )?scope/i.test(text)
}

// ---- asks (docs/agent/orchestrator.md "Asks") -------------------------------------------------------------------
const PARK_OPTION = 'park: leave the plan parked for the Human to replan'
/**
 * The question in a builder's result: its kind (`ask.kind`, else an `ESCALATE: <kind>` blocker), the question, the
 * options and the recommendation (1-based). No kind stated: a scope escalation is kind `scope`, anything else
 * `unstated`, and both are Human-only. null for a result that is neither ESCALATE nor blocked.
 */
export function builderAsk(result) {
  if (!result || !['ESCALATE', 'blocked'].includes(String(result.status ?? ''))) return null
  const a = result.ask && typeof result.ask === 'object' ? result.ask : {}
  const blocker = String(result.blocker ?? '').trim()
  const pre = /^ESCALATE:\s*([a-z-]+)\b/i.exec(blocker)
  const named = String(a.kind ?? (pre ? pre[1] : '')).toLowerCase()
  const stated = ASK_KINDS.includes(named)
  const kind = stated ? named : isScopeEscalation(result) ? 'scope' : 'unstated'
  const options = (Array.isArray(a.options) ? a.options : []).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 300)).slice(0, 6)
  const rec = Number(a.recommendation)
  return {
    kind, stated, humanOnly: humanOnlyAsk(kind, stated), question: String(a.question ?? '').trim().slice(0, 600) || blocker.slice(0, 600) || 'the builder stopped without a question',
    options, recommendation: Number.isInteger(rec) && rec >= 1 && rec <= options.length ? rec : null,
  }
}
/**
 * The ask a file holds: the recommended option first (number 1) and a `park:` option always there. `recommendation`
 * is the 1-based number in `options`, else the kind's default: the park for the run's own code, the first option else.
 */
export function askOptions({ kind, options = [], recommendation = null, paths = [] }) {
  let opts = [...options]
  if (!opts.length && kind === 'scope' && paths.length) opts.push(`approved: ${paths.join(', ')}`)
  if (!opts.length && kind === 'review') opts.push('review again: the gate and the review run again on the saved commits')
  if (kind === 'technical' && !options.length) opts.push('retry: a fresh judgment-tier builder with the hand-off and this answer')
  if (!opts.some((o) => /^park:/i.test(o))) opts.push(PARK_OPTION)
  const park = opts.find((o) => /^park:/i.test(o))
  const rec = recommendation ? opts[recommendation - 1] : kind === 'technical' ? park : options.length || ['scope', 'review'].includes(kind) ? opts[0] : park
  opts = [rec, ...opts.filter((o) => o !== rec)]
  return { options: opts, recommendation: 1 }
}
/** The project paths an answer text names (`approved: a, b` or bare paths): a token with a `/` or a file extension. */
export function scopePaths(text) {
  return [...new Set(String(text ?? '').split(/[\s,;`'"()]+/).map((t) => t.replace(/[.:]+$/, '')).filter((t) => !/^[a-z]+:/i.test(t) && !t.includes('..') && /^[\w@.\-*]+(?:\/[\w@.\-*]+)+$|^[\w@\-]+\.[A-Za-z0-9]{1,8}$/.test(t)))]
}
/** The plan text with `paths` added at the end of its ```scope block (a path already there is left out): { text, added }. */
export function withScopeLines(planText, paths) {
  const lines = String(planText).split('\n')
  const at = lines.findIndex((l) => /^```scope\s*$/.test(l.trim()))
  const end = at < 0 ? -1 : lines.findIndex((l, i) => i > at && /^```\s*$/.test(l.trim()))
  if (end < 0) return { text: planText, added: [] }
  const have = new Set(lines.slice(at + 1, end).map((l) => l.trim()))
  const added = paths.filter((x) => !have.has(x))
  lines.splice(end, 0, ...added)
  return { text: lines.join('\n'), added }
}
/** The plan's goal line: the first line under `## Goals` (or the title). */
function goalLine(planText) {
  const lines = String(planText).replace(/\r\n/g, '\n').split('\n')
  const at = lines.findIndex((l) => /^##\s+Goals?\b/i.test(l))
  return (at >= 0 ? lines.slice(at + 1).find((l) => l.trim() && !/^#/.test(l)) : lines.find((l) => /^#\s/.test(l)))?.trim().slice(0, 300) ?? ''
}
/** Writes asks/<NNN>-<n>.json in the run's folder (n: the plan's next ask) and returns the ask. */
export function writeAsk(runDir, { nnn, kind, humanOnly, question, options, recommendation, context }) {
  const dir = join(runDir, 'asks')
  mkdirSync(dir, { recursive: true })
  const n = 1 + Math.max(0, ...asksOf(runDir, nnn).map((id) => Number(id.split('-')[1])))
  const ask = { id: `${nnn}-${n}`, plan: nnn, kind, question, options, recommendation, humanOnly, context }
  writeFileSync(join(dir, `${ask.id}.json`), `${JSON.stringify(ask, null, 2)}\n`)
  return ask
}
/** The ask ids of one plan in a run's folder. */
function asksOf(runDir, nnn) {
  const dir = join(runDir, 'asks')
  return existsSync(dir) ? readdirSync(dir).map((f) => f.replace(/\.json$/, '')).filter((id) => ASK_ID_RE.test(id) && id.startsWith(`${nnn}-`)) : []
}
/**
 * The answer to an ask: null (none yet), { refused, by } (moved aside to <id>.refused-<time>.json: an answer not by the
 * Human on a Human-only ask, or an unreadable file — the ask stays open), or { by, choice, option, text }.
 */
export function readAnswer(runDir, ask) {
  const file = join(runDir, 'asks', `${ask.id}.answer.json`)
  if (!existsSync(file)) return null
  let a = null
  try {
    a = JSON.parse(readFileSync(file, 'utf8'))
  } catch { /* unreadable: refused below */ }
  const by = ['human', 'advisor'].includes(a?.by) ? a.by : null
  const answer = String(a?.option ?? a?.text ?? '').trim()
  if (!by || !answer || (ask.humanOnly && by !== 'human')) {
    renameSync(file, join(runDir, 'asks', `${ask.id}.refused-${Date.now()}.json`))
    return { refused: true, by: by ?? 'unknown', why: !by || !answer ? 'the answer file has no by: human|advisor or no answer' : `only the Human answers a ${ask.kind} question` }
  }
  return { by, choice: a.choice ?? null, option: a.option ?? null, text: a.text ?? null, answer: answer.slice(0, 2000) }
}

/**
 * The gate's test-file check (lib/plan-scope.mjs testFilesOutOfScope, the function `orch-state.mjs diff` runs) on the
 * files a plan will change: the test files no scope line naming a test location lists.
 */
export function testsOutOfScope(planText, files, removed) {
  const picomatch = createRequire(import.meta.url)('picomatch')
  return testRefusals(files, extractScopeGlobs(String(planText).replace(/\r\n/g, '\n')) ?? [], (g) => picomatch(g, { dot: true }), removed)
}

/**
 * The test paths a plan's sub-tasks and Done-when items name (a path ending in a file extension that isTestPath):
 * readiness checks each against the scope, so a missing scope line is found before any builder runs.
 */
export function plannedTestPaths(planText) {
  const out = new Set()
  let inSection = false
  for (const line of String(planText).replace(/\r\n/g, '\n').split('\n')) {
    if (/^#{1,6}\s/.test(line)) {
      inSection = DONE_WHEN_SECTION_RE.test(line) || /^##\s+Atomic Sub-tasks/i.test(line)
      continue
    }
    if (!inSection) continue
    for (const raw of line.split(/[\s`,;()]+/)) {
      const t = raw.replace(/^[.'"]+(?=[\w@])/, '').replace(/[.:'"]+$/, '')
      if (/^[\w@.\-/]+\.[A-Za-z0-9]+$/.test(t) && !/\*/.test(t) && isTestPath(t)) out.add(t)
    }
  }
  return [...out]
}
/**
 * A plan branch (local or on origin) an earlier run left that is not built on `base`: neither holds the other. The run
 * renames it to park/stale-<NNN> at the plan's start and cuts a fresh one (the line returned says WILL RENAME). A
 * relaunch of the same run (its status.json holds the plan) is not stale.
 */
export function staleBranchProblem({ root, branch, base, run, nnn }) {
  const statusFile = join(root, '.claude', 'orchestrator-runs', run, 'status.json')
  try {
    if (existsSync(statusFile) && JSON.parse(readFileSync(statusFile, 'utf8')).plans?.[nnn]) return null
  } catch { /* unreadable: checked as a new run */ }
  const anc = (a, b) => spawnSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: root }).status === 0
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    if (git(root, 'rev-parse', '--verify', '--quiet', ref).status !== 0) continue
    if (anc(base, ref) || anc(ref, base)) continue
    return `WILL RENAME ${ref.replace(/^refs\/(heads|remotes)\//, '')} → park/stale-${nnn}: an earlier run left it and it is not built on ${base}; a fresh ${branch} is cut at the plan's start`
  }
  return null
}

/** A stop that was the plan's own code: never resumed this way (it stays parked, as today). */
export const OWN_CODE_STOP_RE = /same reason twice|fix rounds used|replan needed|needs the Human/i
/** A stop that was not the plan's code: a death, a time limit, the environment, a rate limit, an answered question. */
export const OUTSIDE_STOP_RE = /process died|timed out|builder stopped|environment|rate[- ]limit|answered/i

/**
 * Does a relaunch continue this plan from its saved commits? `prev` is the plan's record in the run's status.json (the
 * stopped attempt), `hasPark` a park/<run>-<NNN> branch on origin, `hasBuilt` a feat/<NNN> based on the run branch that
 * holds commits the run branch does not. 'built': the next step is the gate on those commits; 'park': a plan branch is
 * cut from the park branch; null: start from round 0 as before.
 */
export function resumeKind({ prev, hasPark, hasBuilt, answered = false }) {
  if (!prev || prev.state === 'merged' || prev.state === 'skipped') return null
  // An answered ask: the plan continues from the work its ask saved, whatever stop raised the question.
  if (answered) return hasPark ? 'park' : null
  const reason = `${prev.reason ?? ''} ${prev.park?.reason ?? ''}`
  if (OWN_CODE_STOP_RE.test(reason)) return null
  const stopped = prev.state === 'parked' && OUTSIDE_STOP_RE.test(reason)
  if (hasBuilt && (stopped || ['gate', 'checking', 'merging'].includes(prev.state))) return 'built'
  if (stopped && hasPark) return 'park'
  return null
}

/** The resume of a plan this run already knew (a relaunch under the same run name): { kind, prev, parkBranch } or null. */
function resumeOf({ root, run, runBranch, nnn, branch, answered = false }) {
  let prev = null
  try {
    prev = JSON.parse(readFileSync(join(root, '.claude', 'orchestrator-runs', run, 'status.json'), 'utf8')).plans?.[nnn] ?? null
  } catch { /* no status: a new run */ }
  if (!prev) return null
  git(root, 'fetch', '--quiet', 'origin')
  const parkBranch = `park/${run}-${nnn}`
  const has = (ref) => git(root, 'rev-parse', '--verify', '--quiet', ref).status === 0
  const base = `origin/${runBranch}`
  const feat = [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`].find(has)
  // This run's own plan branch (its status.json holds the plan): cut from this run branch, which may have moved on since
  // (merges, the report), so it need not contain the run branch's tip — it holds commits the run branch does not.
  const hasBuilt = Boolean(feat && has(base) && git(root, 'merge-base', base, feat).status === 0 && Number(git(root, 'rev-list', '--count', `${base}..${feat}`).out) > 0)
  const kind = resumeKind({ prev, hasPark: has(`refs/remotes/origin/${parkBranch}`), hasBuilt, answered })
  return kind ? { kind, prev, parkBranch } : null
}

/**
 * The builder call — the one code path the dry run prints and the real run makes (INV-1): the tier's model, why the
 * builder runs on that tier, and the options claudeArgs()/runAgent() build the argv from. Only the system-prompt file
 * (a temp file per call) differs between the two.
 */
export function builderCall({ agent, tier, reason, settings = null, models = MODELS }) {
  const t = tier === 'judgment' ? 'judgment' : 'build'
  const model = models[t]
  return { tier: t, model, reason, opts: { agent, model, allow: true, settings } }
}

// ---- the run ----------------------------------------------------------------------------------------------------
class RunStop extends Error {}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed.problem) {
    say(`RUN_PLANS: refused — ${parsed.problem}`)
    say('usage: node scripts/run-plans.mjs --run <name> --plans <NNN,NNN> [--concurrency 1|2] | --dry-run [--run <name>] --plans <NNN,NNN>')
    say(`RUN_PLANS_JSON ${JSON.stringify({ ok: false, refused: parsed.problem })}`)
    return 1
  }
  const o = parsed.opts
  const RUN = o.run
  const RUN_BRANCH = `${RUN_PREFIX}${RUN}`
  if (!o.dryRun) {
    // Under scripts/run-supervisor.mjs the run's stdout already goes to the console log (appended): one writer.
    CONSOLE_LOG = process.env.RUN_SUPERVISOR_LOG === '1' ? null : consoleLogPath(ROOT, RUN)
    mkdirSync(dirname(consoleLogPath(ROOT, RUN)), { recursive: true })
    mkdirSync(dirname(CONSOLE_LOG), { recursive: true })
    say(`RUN_PLANS: launch ${nowIso()} · ${process.argv.slice(2).join(' ')}`)
  }
  const agentsDir = join(ROOT, '.claude', 'agents')
  const builderAgent = readAgent(join(agentsDir, 'orch-builder.md'))
  const reviewerAgent = readAgent(join(agentsDir, 'plan-reviewer.md'))
  // orchestrator.reviewerModel, passed as --model (the agent file's own model: line follows the tiers, models.review).
  const REVIEW_MODEL = REVIEWER_MODEL || reviewerAgent.model

  const order = runOrder({ root: ROOT, plans: o.plans, runBranch: RUN_BRANCH })
  if (!order.ok) {
    say(`RUN_PLANS: refused — plan order: ${order.error}`)
    say(`RUN_PLANS_JSON ${JSON.stringify({ ok: false, refused: order.error })}`)
    return 1
  }
  const all = order.waves.flat()
  say(`RUN_PLANS: ${o.dryRun ? 'dry run of' : 'run'} ${RUN} → ${RUN_BRANCH} · ${all.length} plan(s) in ${order.waves.length} wave(s) · concurrency ${o.concurrency} · reviewer ${REVIEW_MODEL} (${o.reviewerMode})`)
  order.waves.forEach((w, i) => say(`WAVE ${i + 1}: ${w.join(', ')}`))
  if (order.skipped.length) say(`DONE already (left out): ${order.skipped.join(', ')}`)
  // docs/brain/human-decisions.md is read once, never written; no file = every `default per D<n>` goes back to the Human.
  const decisionsFile = join(ROOT, 'docs', 'brain', 'human-decisions.md')
  const statuses = existsSync(decisionsFile) ? decisionStatuses(readFileSync(decisionsFile, 'utf8')) : null
  // The builder runs only with the project's guard hooks (claude-run allowedTools() throws without them).
  const guardFile = builderSettings(join(ROOT, '.claude', 'orchestrator-runs', RUN), { write: false })
  const unguarded = guardFile ? null : 'no PreToolUse hooks in .claude/settings.json — a builder never runs without guard hooks'
  const lint = {}
  for (const nnn of all) {
    const l = lintPlan(nnn, order.plans[nnn]?.path, RUN_BRANCH, { statuses, opts: o, runPlans: all })
    lint[nnn] = l
    say(`PLAN ${nnn} ${l.ready ? 'ready' : 'NOT READY'} — ${l.title} (${l.branch})`)
    for (const line of l.lines) say(`  ${line}`)
    for (const p of l.problems) say(`  PROBLEM ${p}`)
    if (o.dryRun) {
      say('  gate commands:')
      for (const c of l.checks) say(`    ${c}`)
      const show = (argv, cwd) => `claude ${argv.join(' ')}  (cwd ${cwd})`
      const call = builderCall({ agent: builderAgent, ...l.start, settings: guardFile })
      say(`  tier: ${call.tier} (${call.reason})`)
      if (guardFile) {
        const argv = claudeArgs({ ...call.opts, systemPromptFile: '<temp>/system.md' })
        l.builder = { tier: call.tier, model: call.model, reason: call.reason, argv }
        say(`  builder: ${show(argv, `<repo>-orch-${RUN}-${nnn}`)}`)
      } else say(`  builder: refused — ${unguarded}`)
      say(`  reviewer: ${show(claudeArgs({ agent: reviewerAgent, model: REVIEW_MODEL, systemPromptFile: '<temp>/system.md', allow: true }), `<repo>-orch-review-${RUN}-${nnn}`)}`)
      say(`  merge: git merge --no-ff origin/${l.branch} into ${RUN_BRANCH}, merge-verify, ${mergeChecksOf(l.checks).join(', ') || 'no check'}, git push origin ${RUN_BRANCH}`)
    }
  }
  const pre = node('orch-preflight.mjs', ['--run', RUN, '--plans', all.length ? all.join(',') : o.plans.join(','), ...(o.db === 'remote' ? ['--db', 'remote'] : [])])
  const preJson = orchJson(pre.out) ?? { ok: pre.status === 0, problems: [lastLine(pre.out)] }
  for (const line of pre.out.split(/\r?\n/).filter((l) => /^(OK|FAIL|SKIP|WARN|PARK)\b/.test(l.trim()))) say(`PREFLIGHT ${line.trim()}`)
  const notReady = all.filter((n) => !lint[n].ready)
  const refusal = !all.length ? null : unguarded ? unguarded : notReady.length ? `plan(s) not ready: ${notReady.join(', ')}` : preJson.ok !== true ? `preflight: ${(preJson.problems ?? []).join('; ')}` : null
  if (o.dryRun) {
    say(`WOULD START: ${refusal ? `no — ${refusal}` : all.length ? 'yes' : 'no — nothing to build'}`)
    say(`RUN_PLANS_JSON ${JSON.stringify({ ok: true, dryRun: true, run: RUN, waves: order.waves, skipped: order.skipped, plans: Object.fromEntries(all.map((n) => [n, { ready: lint[n].ready, problems: lint[n].problems, checks: lint[n].checks, builder: lint[n].builder }])), preflight: { ok: preJson.ok === true, problems: preJson.problems ?? [] }, wouldStart: !refusal && all.length > 0, modelCalls: 0 })}`)
    return 0
  }
  if (refusal) {
    say(`RUN_PLANS: refused before the start — ${refusal}`)
    say(`RUN_PLANS_JSON ${JSON.stringify({ ok: false, refused: refusal, plans: Object.fromEntries(notReady.map((n) => [n, lint[n].problems])), preflight: preJson })}`)
    return 1
  }
  if (!all.length) {
    say('RUN_PLANS: nothing to build — every plan is already done')
    say(`RUN_PLANS_JSON ${JSON.stringify({ ok: true, run: RUN, merged: [], parked: [], skipped: order.skipped })}`)
    return 0
  }

  // ---- start ----
  const init = state('init', { run: RUN })
  if (!init.ok) {
    say(`RUN_PLANS: refused — init: ${init.error}`)
    say(`RUN_PLANS_JSON ${JSON.stringify({ ok: false, refused: `init: ${init.error}` })}`)
    return 1
  }
  const mergeFolder = init.mergeFolder
  const runDir = join(ROOT, '.claude', 'orchestrator-runs', RUN)
  const guardSettings = builderSettings(runDir)
  const csv = join(runDir, 'calls.csv')
  mkdirSync(runDir, { recursive: true })
  if (!existsSync(csv)) writeFileSync(csv, 'plan,stage,model,seconds,input_tokens,output_tokens,exit\n')
  const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const csvRow = (plan, stage, model, seconds, input, output, exit) => appendFileSync(csv, `${[plan, stage, model, seconds, input, output, exit ?? ''].map(cell).join(',')}\n`)
  const ctxLearn = state('context', { run: RUN })
  const LESSONS = ctxLearn.ok ? [...(ctxLearn.kitLessons?.builder ?? []), ...(ctxLearn.lessons?.builder ?? [])] : []
  const pendingCalls = {}
  const setPlan = (nnn, fields = {}) => {
    const calls = pendingCalls[nnn] ?? []
    pendingCalls[nnn] = []
    const r = state('set', { run: RUN, plan: nnn, ...fields, ...(calls.length ? { 'calls-b64': b64(JSON.stringify(calls)) } : {}) })
    if (!r.ok) say(`RUN_PLANS: set ${nnn} failed — ${r.error}`)
    return r
  }
  const note = (text, nnn) => state('note', { run: RUN, plan: nnn, text: String(text).slice(0, 400) })
  const decisions = []
  const priorTop = Math.max(0, ...(init.priorDecisions ?? []).map((d) => Number(String(d.id).slice(1)) || 0))
  // The heartbeat: a builder may work for many minutes; `watch` must still read RUNNING.
  const beat = setInterval(() => state('touch', { run: RUN }), Math.max(15_000, Math.min(60_000, (STALE_MIN * 60_000) / 3)))
  let stopReason = null
  let mergeChain = Promise.resolve()
  const serial = (fn) => {
    const p = mergeChain.then(fn, fn)
    mergeChain = p.then(() => undefined, () => undefined)
    return p
  }

  /** The plan's ask when status.json still says it is asking (a relaunch of the same run), else null. */
  const pendingAsk = (nnn) => {
    let prev = null
    try {
      prev = JSON.parse(readFileSync(join(runDir, 'status.json'), 'utf8')).plans?.[nnn] ?? null
    } catch { /* no status */ }
    if (prev?.state !== 'asking') return null
    const id = asksOf(runDir, nnn).sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1])).at(-1)
    try {
      return id ? JSON.parse(readFileSync(join(runDir, 'asks', `${id}.json`), 'utf8')) : null
    } catch {
      return null
    }
  }

  /** One model call with the rate-limit pause: { r } or throws RunStop on a second limit. */
  const modelCall = async (nnn, stage, fn, { model: planned = null, tier = null } = {}) => {
    for (let attempt = 1; ; attempt++) {
      if (stopReason) throw new RunStop(stopReason)
      // status.json says which model this call runs on while it runs: plans.<NNN>.models.<stage>.
      if (planned) setPlan(nnn, { role: stage, model: planned, ...(tier ? { 'model-tier': tier } : {}) })
      const r = await fn()
      // The model passed after --model on this call, never one the answer names.
      const model = passedModel(r.argv, r.model ?? '')
      pendingCalls[nnn] = [...(pendingCalls[nnn] ?? []), { stage, model, seconds: r.seconds, input: r.tokens?.input ?? 0, output: r.tokens?.output ?? 0, exit: r.exit, ...(r.error ? { error: r.error } : {}) }]
      csvRow(nnn, stage, model, r.seconds, r.tokens?.input ?? 0, r.tokens?.output ?? 0, r.exit)
      if (!r.rateLimited) return r
      if (attempt >= 2) {
        stopReason = stopReason ?? `rate-limit: ${String(r.error ?? '').slice(0, 200)}`
        throw new RunStop(stopReason)
      }
      setPlan(nnn, { state: 'env-paused', reason: `rate limit — waiting ${RATE_LIMIT_WAIT_MIN} min, then one retry: ${String(r.error ?? '').slice(0, 200)}` })
      say(`RUN_PLANS: plan ${nnn} ${stage}: rate limit — waiting ${RATE_LIMIT_WAIT_MIN} min, then one retry`)
      await sleep(RATE_LIMIT_WAIT_MIN * 60_000)
    }
  }

  const runPlan = async (nnn, { answer = null } = {}) => {
    const l = lint[nnn]
    // A relaunch finds the plan still waiting on its ask: it waits again, nothing is built.
    if (!answer) {
      const waiting = pendingAsk(nnn)
      if (waiting) return { nnn, state: 'asking', ask: waiting, reason: String(waiting.context?.reason ?? '') }
    }
    // A relaunch continues a plan that stopped for a reason that was not its own code (or an answered ask): from the saved work.
    const resume = resumeOf({ root: ROOT, run: RUN, runBranch: RUN_BRANCH, nnn, branch: l.branch, answered: Boolean(answer) })
    const info = state('plan-info', { run: RUN, plan: nnn, 'with-worktree': 'yes', 'from-branch': resume?.kind === 'park' ? resume.parkBranch : undefined })
    if (!info.ok) return { nnn, state: 'parked', reason: `plan-info: ${info.error}` }
    const ctx = { nnn, info, wt: info.wt, tier: l.start.tier, tierReason: l.start.reason, round: 0, escalated: false, findings: [], lastWhy: null, mode: 'first' }
    if (resume) {
      // The round counter and the tier continue where the stopped attempt left them.
      ctx.round = Number(resume.prev.round) || 0
      if (resume.prev.tier === 'judgment') {
        ctx.tier = 'judgment'
        ctx.tierReason = 'resumed on the tier the stopped attempt ran on'
        ctx.escalated = ctx.round > 0
      }
      ctx.mode = resume.kind === 'park' ? 'resume' : 'first'
      ctx.skipBuild = resume.kind === 'built'
    }
    if (answer) {
      ctx.answer = { id: answer.ask.id, kind: answer.ask.kind, question: answer.ask.question, answer: answer.answer, by: answer.by }
      // "review again": the saved commits go back through the gate and the review, no builder.
      if (resume?.kind === 'park' && /^review again:/i.test(answer.answer)) ctx.skipBuild = true
    }
    // The plan file the builder starts from (the run branch's commit that last changed it): a later change is recorded.
    let planStart = null
    const park = (reason, { teardown = true, quiet = false } = {}) => {
      setPlan(nnn, { state: 'parked', round: ctx.round, tier: ctx.tier, reason: String(reason).slice(0, 380) })
      if (teardown && ctx.wt?.ok) {
        const s = state('park', { run: RUN, plan: nnn, 'reason-b64': b64(String(reason).slice(0, 2000)) })
        const saved = (s.steps ?? []).find((x) => x?.step === 'save')
        if (saved) note(`parked: ${String(saved.what ?? '').slice(0, 200)}`, nnn)
        else if (!s.ok) note(`park teardown not done: ${String(s.error ?? '').slice(0, 300)}`, nnn)
      }
      if (!quiet) say(`RUN_PLANS: plan ${nnn} parked — ${reason}`)
      return { nnn, state: 'parked', reason, round: ctx.round }
    }
    /**
     * A question only this plan waits on: the park's teardown (the work saved on park/<run>-<NNN>, the folder freed),
     * then one ask file and the state `asking`; the run goes on with the rest. `q` is builderAsk()'s shape or the
     * run's own { kind, question, options? }.
     */
    const ask = (reason, q, extra = {}) => {
      if (asksOf(runDir, nnn).length >= ASK_MAX) return park(`${reason} (asked ${ASK_MAX} times in this run)`)
      const files = info?.branch ? git(ROOT, 'diff', '--name-only', `origin/${RUN_BRANCH}...${info.branch}`).out.split('\n').filter(Boolean).slice(0, 30) : []
      park(reason, { quiet: true })
      const stated = q.stated !== false
      const o = askOptions({ kind: q.kind, options: q.options ?? [], recommendation: q.recommendation ?? null, paths: q.kind === 'scope' ? scopePaths(`${q.question} ${reason}`) : [] })
      const context = { reason: String(reason).slice(0, 600), at: nowIso(), goal: goalLine(readFileSync(join(ROOT, l.path), 'utf8')), files, ...extra }
      const a = writeAsk(runDir, { nnn, kind: q.kind, humanOnly: q.humanOnly ?? humanOnlyAsk(q.kind, stated), question: q.question, ...o, context })
      setPlan(nnn, { state: 'asking', round: ctx.round, tier: ctx.tier, reason: `asking ${a.id}: ${reason}`.slice(0, 380) })
      note(`ask ${a.id} (${a.kind}, ${a.humanOnly ? 'only the Human answers' : 'the Human or the advisor answers'}): ${a.question}`, nnn)
      say(`RUN_PLANS: plan ${nnn} asks ${a.id} — it waits; the run goes on with the plans it does not block`)
      for (const line of askCard(a, RUN)) say(line)
      return { nnn, state: 'asking', ask: a, reason, round: ctx.round }
    }
    if (!ctx.wt?.ok) {
      if (ctx.wt?.envFailure) {
        const env = node('orch-preflight.mjs', ['--env-only', '--run', RUN])
        if (env.status === 0) ctx.wt = state('worktree', { run: RUN, plan: nnn })
      }
      if (!ctx.wt?.ok) return park(`worktree: ${ctx.wt?.error ?? 'no folder'}`, { teardown: false })
    }
    const wt = ctx.wt.path
    planStart = git(ROOT, 'log', '-1', '--format=%H', `origin/${RUN_BRANCH}`, '--', l.path).out || null
    if (resume) {
      const rel = `.claude/sessions/orch-${RUN}/handoff-${nnn}.md`
      if (existsSync(join(ROOT, rel))) ctx.handoff = rel
      else {
        const h = state('handoff', { run: RUN, plan: nnn, step: `resumed after: ${String(resume.prev.reason ?? '').slice(0, 150)}`, tried: `${resume.prev.tier ?? 'build'} builder, round ${ctx.round}`, replan: 'no' })
        if (h.ok) ctx.handoff = h.path
      }
      note(resume.kind === 'park' ? `resumed from ${resume.parkBranch}: round ${ctx.round}, tier ${ctx.tier}, after: ${String(resume.prev.reason ?? '').slice(0, 160)}` : `resumed from the built ${info.branch}: the gate runs on its existing commits (round ${ctx.round}, tier ${ctx.tier})`, nnn)
    }
    if (ctx.tier === 'judgment') note(`starts on the judgment tier: ${ctx.tierReason}`, nnn)
    for (;;) {
      if (stopReason) return park(`stopped: ${stopReason}`, { teardown: false })
      // ---- builder ----
      const stage = ctx.mode === 'first' || ctx.mode === 'resume' ? 'builder' : ctx.mode === 'handoff' ? 'judgment builder' : 'builder fix'
      let b = { ok: true, text: '' }
      let result = null
      if (ctx.skipBuild) {
        // The run died after the build: the branch has its commits, so the next step is the gate on them, no new builder.
        ctx.skipBuild = false
        say(`RUN_PLANS: plan ${nnn} resumes at the gate on the existing commits of ${info.branch} (round ${ctx.round})`)
      } else {
        setPlan(nnn, { state: ctx.round ? 'fixing' : 'building', round: ctx.round, tier: ctx.tier })
        const call = builderCall({ agent: builderAgent, tier: ctx.tier, reason: ctx.tierReason, settings: guardSettings })
        const prompt = builderPrompt({ RUN, RUN_BRANCH, ctx, l, LESSONS })
        say(`RUN_PLANS: plan ${nnn} ${stage} (${call.model}, tier ${call.tier}: ${call.reason}, round ${ctx.round})`)
        // No wall clock for a builder: only the idle limit (BUILDER_IDLE_MIN) on its folder's file changes.
        b = await modelCall(nnn, stage, () => runAgent({ ...call.opts, cwd: wt, prompt, timeoutMs: 0, idleMs: BUILDER_IDLE_MS, watchDir: wt, pollMs: BUILDER_POLL_MS, bin: o.claude }), { model: call.model, tier: call.tier })
        try {
          result = b.ok ? parseResult(b.text) : null
        } catch { /* an unreadable receipt: the gate decides */ }
        for (const d of (Array.isArray(result?.decisions) ? result.decisions : []).filter((x) => typeof x === 'string' && /^(behaviour|seen|removes):/i.test(x.trim()))) decisions.push({ plan: nnn, text: d.trim().slice(0, 380) })
        if (Array.isArray(result?.notDone) && result.notDone.length) note(`builder left undone (round ${ctx.round}): ${result.notDone.slice(0, 5).join('; ').slice(0, 300)}`, nnn)
      }
      let failure = null
      // An idle stop parks with the work kept: the park saves it to park/<run>-<NNN> (never a reset to the base, never a
      // second builder on the same problem).
      if (!b.ok && b.timedOut) return park(`builder stopped: ${b.error} — the work is kept on park/${RUN}-${nnn}`)
      // A question in the builder's result is an ask: a scope problem only a plan edit fixes (no
      // judgment-tier builder: it cannot widen the scope either), a db-write, a plan that cannot hold, any ESCALATE that
      // names its kind, and a judgment-tier ESCALATE. A build-tier ESCALATE with no kind still gets the judgment builder.
      const q = b.ok ? builderAsk(result) : null
      const proposal = result?.planChange?.why ? { proposal: String(result.planChange.why).slice(0, 600) } : {}
      if (q && isScopeEscalation(result)) return ask(`replan needed: ${String(result.blocker ?? result.planChange?.why ?? '').slice(0, 300) || 'a file outside the scope'}`, q, proposal)
      if (!b.ok) failure = { why: `builder: ${b.error}`, escalate: true }
      else if (result && ctx.tier === 'judgment' && result.planChange?.needed === true) return ask(`replan needed: ${String(result.planChange.why ?? '').slice(0, 240) || '(no reason given)'}`, q ?? { kind: 'unstated', stated: false, question: String(result.planChange.why ?? 'the plan cannot hold as written') }, proposal)
      else if (q && q.kind === 'db-write') return ask(`ask: ${result.blocker}`, q, proposal)
      else if (q && (q.stated || (result.status === 'ESCALATE' && ctx.tier === 'judgment'))) return ask(`ESCALATE ${q.kind}: ${String(result.blocker ?? '').slice(0, 300)}`, q, proposal)
      else if (result && result.status && result.status !== 'built') failure = { why: `builder ${result.status}: ${String(result.blocker ?? '').slice(0, 300)}`, escalate: true }
      if (!failure) failure = landBranch(wt, info.branch, RUN_BRANCH)
      let checkedHead = null
      let receipt = null
      // ---- gate ----
      if (!failure) {
        setPlan(nnn, { state: 'gate', round: ctx.round, tier: ctx.tier, sha: git(wt, 'rev-parse', 'HEAD').out })
        const onResult = (row) => csvRow(nnn, `gate: ${row.command}`, '-', row.seconds, 0, 0, row.exit)
        // The scope check runs here, from this folder's code, on the plan text as the run branch holds it.
        const base = `origin/${RUN_BRANCH}`
        const onBase = git(ROOT, 'show', `${base}:${l.path}`)
        const planText = onBase.status === 0 ? onBase.out : readFileSync(join(ROOT, l.path), 'utf8')
        const builtins = { [scopeMarker(base, l.path)]: () => scopeCheck({ folder: wt, base, planText, planPath: l.path, hotspots: HOTSPOTS, upstream: UPSTREAM }) }
        let g = await runGate({ folder: wt, commands: l.checks, timeoutMin: GATE_TIMEOUT_MIN, onResult, builtins })
        if (g.status === 'env') {
          setPlan(nnn, { state: 'env-paused', round: ctx.round, reason: `gate env-fail: ${g.failed.join(', ')}` })
          const env = node('orch-preflight.mjs', ['--env-only', '--run', RUN, '--probe-dir', wt, ...g.failed.flatMap((c) => ['--probe', c])])
          if (env.status !== 0) return park(`environment: ${(orchJson(env.out)?.problems ?? [lastLine(env.out)]).join('; ')}`)
          note(`environment failure (gate env-fail: ${g.failed.join(', ')}); the environment check passed, the gate runs once more without a fix round`, nnn)
          g = await runGate({ folder: wt, commands: l.checks, timeoutMin: GATE_TIMEOUT_MIN, onResult, builtins })
          if (g.status === 'env') return park(`environment, again after one retry: gate env-fail: ${g.failed.join(', ')}`)
        }
        for (const c of g.flaky) state('flake', { run: RUN, plan: nnn, command: c, round: ctx.round, via: 'rerun', where: 'gate', sha: g.head ?? undefined })
        receipt = g
        if (g.status === 'fail') {
          const bad = g.results.filter((x) => x.status !== 'pass')
          const why = `gate: ${bad.map((x) => x.command).join(', ') || 'no check ran'}`
          failure = { why, fingerprint: `${why} :: ${lastLine(bad[0]?.tail)}`, check: bad[0]?.command, tail: bad[0]?.tail,
            findings: bad.map((x, i) => ({ id: `gate-${i + 1}`, file: x.command, line: 1, rule: 'check fails', reasoning: String(x.tail ?? '').split('\n').slice(-20).join('\n'), severity: 'blocker' })) }
        } else checkedHead = g.head
      }
      // ---- review ----
      if (!failure) {
        setPlan(nnn, { state: 'checking', round: ctx.round })
        const diff = state('diff', { run: RUN, plan: nnn, 'no-notes': true })
        if (!diff.ok) failure = { why: `diff: ${diff.error}` }
        else if (diff.head !== checkedHead) failure = { why: `origin/${info.branch} is at ${String(diff.head).slice(0, 7)}, not the commit the gate ran on (${String(checkedHead).slice(0, 7)})` }
        else if (Array.isArray(diff.testsOutOfScope) && diff.testsOutOfScope.length) {
          const findings = diff.testsOutOfScope.map((f, i) => ({ id: `scope-${i + 1}`, severity: 'blocker', file: f, line: 1, rule: 'no scope line names a test location', reasoning: `${f} is a test file no line of the plan's Read-Write Scope names; revert it or ask the Human for approved: ${f}` }))
          failure = { why: `scope: ${diff.testsOutOfScope.join(', ')}`, fingerprint: `scope: ${diff.testsOutOfScope.join(',')}`, findings }
        } else {
          const reviewOnce = () => reviewStep({ nnn, RUN, RUN_BRANCH, branch: info.branch, checkedHead, reviewPath: diff.reviewPath, receipt, reviewerAgent, REVIEW_MODEL, bin: o.claude, modelCall, mode: l.reviewerMode ?? o.reviewerMode })
          let r = await reviewOnce()
          // An enforced review that could not run gets one retry, then it is a question (kind review).
          if (r.error && !r.refused && r.mode === 'gate') {
            note(`review could not run: ${String(r.error).slice(0, 200)} — one retry`, nnn)
            r = await reviewOnce()
          }
          if (r.note) note(r.note, nnn)
          if (r.error) {
            // A branch that brings its own local settings into the review is parked in either mode.
            if (r.refused) return park(`review ${r.error}`)
            if (r.mode === 'gate') return ask(`review could not run: ${r.error}`, { kind: 'review', question: `The review of plan ${nnn} could not run twice (${String(r.error).slice(0, 200)}). Run it again, or leave the plan parked?` }, { check: 'review', tail: String(r.error).slice(0, 600) })
            note(`review could not run (advisory, not enforced): ${r.error}`, nnn)
          } else if (r.enforced) {
            const kept = blocking(r.problems)
            const why = `review STOP: ${kept.map(problemLine).join('; ').slice(0, 300)}`
            failure = { why, fingerprint: `review: ${kept.map((p) => `${p.file}|${String(p.rule).split(':')[0]}`).sort().join(',')}`, findings: kept, check: 'review', tail: why }
          }
        }
      }
      // ---- merge ----
      if (!failure) {
        setPlan(nnn, { state: 'merging', round: ctx.round, 'checked-head': checkedHead })
        const m = await serial(() => mergePlan({ root: ROOT, run: RUN, nnn, branch: info.branch, runBranch: RUN_BRANCH, mergeFolder, checks: mergeChecksOf(l.checks), timeoutMin: GATE_TIMEOUT_MIN, plan: { path: l.path, startCommit: planStart }, onResult: (row) => csvRow(nnn, `merge check: ${row.command}`, '-', row.seconds, 0, 0, row.exit) }))
        if (m.merged) {
          // The records, written from git by the merge step: the plan-file conflicts it resolved, and a plan changed during the run.
          for (const f of m.planFiles ?? []) note(`merge: ${f} conflicted — the run branch's copy was taken`, nnn)
          if (m.planChange) {
            const c = m.planChange.commits[0]
            state('plan-changed', { run: RUN, plan: nnn, commit: c.sha, author: c.author, subject: c.subject, 'diff-b64': b64(m.planChange.diff), ...(m.planChange.warnings.length ? { 'warning-b64': b64(m.planChange.warnings.join('\n')) } : {}) })
          }
          setPlan(nnn, { state: 'merged', round: ctx.round, tier: ctx.tier, sha: m.sha })
          say(`RUN_PLANS: plan ${nnn} merged into ${RUN_BRANCH} (${m.sha.slice(0, 7)})`)
          return { nnn, state: 'merged', sha: m.sha, round: ctx.round }
        }
        if (m.pin) return park(m.why)
        if (m.env) return park(`environment: ${m.why}`)
        failure = { why: m.why, findings: [{ id: 'merge-1', file: RUN_BRANCH, line: 1, rule: 'merge into the run branch', reasoning: `${m.why} — merge origin/${RUN_BRANCH} into your branch, resolve, rerun the checks`, severity: 'blocker' }] }
      }
      // ---- a failure: a fix round, the judgment builder, or a park ----
      const why = String(failure.fingerprint ?? failure.why).trim().slice(0, 240)
      setPlan(nnn, { round: ctx.round, 'round-cause': `round ${ctx.round + 1}: ${String(failure.why).slice(0, 280)}` })
      // The run's own technical questions: the park is recommended, a retry is the other option.
      const evidence = { check: String(failure.check ?? failure.why).slice(0, 200), tail: String(failure.tail ?? failure.why).split(/\r?\n/).slice(-20).join('\n').slice(0, 2000), ...(result?.planChange?.why ? { proposal: String(result.planChange.why).slice(0, 600) } : {}) }
      if (why === ctx.lastWhy) return ask(`same reason twice: ${String(failure.why).slice(0, 300)}`, { kind: 'technical', question: `Plan ${nnn} failed twice for the same reason (${String(failure.why).slice(0, 200)}). Leave it parked, or retry it?` }, evidence)
      ctx.lastWhy = why
      if (ctx.escalated || ctx.round + 1 > MAX_FIX_ROUNDS) return ask(`${failure.why} (fix rounds used: ${ctx.round} of ${MAX_FIX_ROUNDS}) — needs the Human`, { kind: 'technical', question: `Plan ${nnn} used its fix rounds (${ctx.round} of ${MAX_FIX_ROUNDS}) and still fails: ${String(failure.why).slice(0, 200)}. Leave it parked, or retry it?` }, evidence)
      ctx.round += 1
      ctx.findings = failure.findings ?? []
      if (failure.escalate || ctx.round >= 2) {
        const h = state('handoff', {
          run: RUN, plan: nnn, 'reset-base': true, step: `round ${ctx.round}`, check: String(failure.check ?? failure.why).slice(0, 200),
          tail: String(failure.tail ?? failure.why).split(/\r?\n/).slice(-5).join(' / ').slice(0, 390), tried: `${ctx.tier} builder, mode ${ctx.mode}`,
          failed: [`${failure.check ?? failure.why}`, ...ctx.findings.slice(0, 10).map((f) => `${f.id} ${f.file}:${f.line ?? '?'} ${f.rule ?? ''}`)].join(' | ').slice(0, 390),
          replan: result?.planChange?.needed === true ? 'yes' : 'no', 'replan-why': String(result?.planChange?.why ?? 'the builder gave no planChange').slice(0, 240),
        })
        if (!h.ok) return park(`hand-off file: ${h.error}`)
        ctx.handoff = h.path
        ctx.tier = 'judgment'
        ctx.tierReason = `escalated after round ${ctx.round}`
        ctx.escalated = true
        ctx.mode = 'handoff'
        note(`escalated to a fresh judgment-tier builder (round ${ctx.round}): ${failure.why}`, nnn)
      } else ctx.mode = 'fix'
    }
  }

  // ---- waves ----
  const outcomes = []
  const early = preJson.parkPlans && typeof preJson.parkPlans === 'object' ? preJson.parkPlans : {}
  let waves = order.waves.map((w) => [...w])
  const parkedRoots = []
  for (const nnn of all.filter((p) => typeof early[p] === 'string' && early[p])) {
    setPlan(nnn, { state: 'parked', reason: `preflight: ${early[nnn]}`.slice(0, 380) })
    outcomes.push({ nnn, state: 'parked', reason: `preflight: ${early[nnn]}` })
    parkedRoots.push(nnn)
  }
  const skip = (blocked) => {
    for (const [nnn, reason] of blocked) {
      setPlan(nnn, { state: 'skipped', reason })
      outcomes.push({ nnn, state: 'skipped', reason })
      say(`RUN_PLANS: plan ${nnn} skipped — ${reason}`)
    }
  }
  if (parkedRoots.length) {
    waves = waves.map((w) => w.filter((p) => !parkedRoots.includes(p)))
    const a = afterPark({ parked: parkedRoots, laterWaves: waves, edges: order.edges, onPark: ON_PARK })
    skip(a.blocked)
    waves = a.waves
  }
  // ---- asks: an asking plan blocks exactly what a park would, but holds those plans instead of skipping them ----
  const asking = new Map() // nnn → { ask, reason, deadline }
  const held = new Map() // nnn → Map(root → the skip reason should the root park)
  const rank = (n) => all.indexOf(n)
  const hold = (nnn, root, reason) => {
    if (!held.has(nnn)) held.set(nnn, new Map())
    held.get(nnn).set(root, reason)
    setPlan(nnn, { state: 'queued', reason: `waits on the answer to ask ${asking.get(root)?.ask.id ?? `of plan ${root}`}` })
  }
  /** A root ended: parked → the plans it held are skipped; merged → the ones it alone held are returned to run. */
  const release = (root, merged) => {
    const freed = []
    for (const [n, by] of [...held]) {
      if (!by.has(root)) continue
      if (!merged) {
        held.delete(n)
        skip(new Map([[n, by.get(root)]]))
        continue
      }
      by.delete(root)
      if (!by.size) {
        held.delete(n)
        freed.push(n)
      }
    }
    return freed.sort((a, b) => rank(a) - rank(b))
  }
  /** A plan's result: asking waits, held waits on its root, anything else is an outcome (and ends what it held). */
  const settle = async (x) => {
    if (x.state === 'asking') return void asking.set(x.nnn, { ask: x.ask, reason: x.reason, deadline: null })
    if (x.state === 'held') return hold(x.nnn, x.by, x.reason)
    outcomes.push(x)
    if (x.state === 'parked') parkedRoots.push(x.nnn)
    if (x.state !== 'parked' && x.state !== 'merged') return
    for (const n of release(x.nnn, x.state === 'merged')) await runFreed(n)
  }
  const runOne = async (nnn, opts) => {
    let res
    try {
      res = await runPlan(nnn, opts)
    } catch (e) {
      const why = e instanceof RunStop ? `stopped: ${e.message}` : `the plan stopped with an error: ${String(e?.message ?? e).slice(0, 300)}`
      setPlan(nnn, { state: 'parked', reason: why.slice(0, 380) })
      res = { nnn, state: 'parked', reason: why }
    }
    state('release', { run: RUN, plan: nnn })
    return res
  }
  /** A plan its root's merge freed: a park or another ask may still block it. */
  const runFreed = async (nnn) => {
    for (const root of parkedRoots) {
      const why = blockedBy([root], [nnn], order.edges ?? []).get(nnn)
      if (why) return skip(new Map([[nnn, why]]))
    }
    for (const root of asking.keys()) {
      const why = blockedBy([root], [nnn], order.edges ?? []).get(nnn)
      if (why) return hold(nnn, root, why)
    }
    if (stopReason) return skip(new Map([[nnn, `not started: ${stopReason}`]]))
    await settle(await runOne(nnn))
  }
  /** An ask that ends without a resume: the plan parks with its question in the run notes (and so the report). */
  const endAsk = async (nnn, a, how) => {
    const reason = `${a.reason} — ask ${a.ask.id} ${how}`
    setPlan(nnn, { state: 'parked', reason: reason.slice(0, 380) })
    note(`ask ${a.ask.id} ${how} — plan ${nnn} parked; the question was: ${a.ask.question}`, nnn)
    say(`RUN_PLANS: plan ${nnn} parked — ${reason}`)
    await settle({ nnn, state: 'parked', reason, ask: a.ask.id })
  }
  /** One answer: a park option parks; a scope answer that names paths adds them to the plan's scope first; else resume. */
  const answered = async (nnn, a, ans) => {
    note(`ask ${a.ask.id} answered by the ${ans.by}: ${ans.answer}`.slice(0, 400), nnn)
    say(`RUN_PLANS: plan ${nnn} — ask ${a.ask.id} answered by the ${ans.by}: ${ans.answer}`)
    if (/^park:/i.test(ans.answer)) return endAsk(nnn, a, `answered: park (by the ${ans.by})`)
    const paths = a.ask.kind === 'scope' ? scopePaths(ans.answer) : []
    if (paths.length) {
      const s = await serial(() => extendScope({ mergeFolder, runBranch: RUN_BRANCH, planPath: lint[nnn].path, paths, id: a.ask.id, run: RUN, nnn }))
      if (!s.ok) return endAsk(nnn, a, `answered, but the scope could not be extended: ${s.error}`)
      if (s.added.length) note(`scope of plan ${nnn} extended on ${RUN_BRANCH} by the answer to ${a.ask.id}: ${s.added.join(', ')}`, nnn)
    }
    await settle(await runOne(nnn, { answer: { ...ans, ask: a.ask } }))
  }
  /** Once every other plan has ended: poll the answers every ASK_POLL_MS, each ask for up to ASK_WAIT_MS. */
  const waitForAnswers = async () => {
    if (asking.size) say(`RUN_PLANS: waiting for ${asking.size} answer(s), up to ${ASK_WAIT_MIN} min each — node scripts/orch-state.mjs watch --run ${RUN} prints them`)
    while (asking.size && !stopReason) {
      let moved = false
      for (const [nnn, a] of [...asking]) {
        a.deadline ??= Date.now() + ASK_WAIT_MS
        const ans = readAnswer(runDir, a.ask)
        if (ans?.refused) note(`ask ${a.ask.id}: an answer by the ${ans.by} was refused: ${ans.why}; the ask stays open`, nnn)
        if (!ans || ans.refused) continue
        asking.delete(nnn)
        await answered(nnn, a, ans)
        moved = true
        break
      }
      if (moved) continue
      for (const [nnn, a] of [...asking]) {
        if (Date.now() < a.deadline) continue
        asking.delete(nnn)
        await endAsk(nnn, a, `not answered in ${Math.round(ASK_WAIT_MS / 60000)} min`)
      }
      if (asking.size) await sleep(ASK_POLL_MS)
    }
    for (const [nnn, a] of [...asking]) {
      asking.delete(nnn)
      await endAsk(nnn, a, `not answered: the run stopped (${stopReason})`)
    }
  }

  let finalGate = null
  try {
    for (let w = 0; w < waves.length; w++) {
      const wave = waves[w]
      if (!wave.length) continue
      if (stopReason) break
      say(`RUN_PLANS: wave ${w + 1}: ${wave.join(', ')}`)
      const units = unitsOf(wave, order.waveLocks?.[w])
      const done = new Array(units.length).fill(undefined)
      const queue = units.map((u, i) => [u, i])
      await Promise.all(Array.from({ length: Math.min(o.concurrency, units.length) }, async () => {
        while (queue.length) {
          const [unit, i] = queue.shift()
          const out = []
          for (const nnn of unit) {
            const before = out.find((x) => x.state === 'parked' || x.state === 'asking' || x.state === 'held')
            if (before) {
              const root = before.state === 'held' ? before.by : before.nnn
              // After an asking plan (or one it holds) the rest of its lock group waits on the same answer.
              if (before.state !== 'parked') out.push({ nnn, state: 'held', by: root, reason: `shares files with parked ${root}` })
              else {
                setPlan(nnn, { state: 'skipped', reason: `shares files with parked ${before.nnn}` })
                out.push({ nnn, state: 'skipped', reason: `shares files with parked ${before.nnn}` })
              }
              continue
            }
            out.push(await runOne(nnn))
          }
          done[i] = out
        }
      }))
      const flat = done.flat().filter(Boolean)
      for (const x of flat) {
        if (['asking', 'held'].includes(x.state)) await settle(x)
        else outcomes.push(x)
      }
      const parked = flat.filter((x) => x.state === 'parked').map((x) => x.nnn)
      const askedNow = flat.filter((x) => x.state === 'asking').map((x) => x.nnn)
      const later = waves.slice(w + 1)
      if (stopReason) {
        skip(new Map(later.flat().map((p) => [p, `not started: ${stopReason}`])))
        break
      }
      // Every park is a root, also when no later wave is left: a plan an ask holds is checked against it when freed.
      if (parked.length) parkedRoots.push(...parked)
      if (parked.length && later.flat().length) {
        const a = afterPark({ parked: parkedRoots, laterWaves: later, edges: order.edges, onPark: ON_PARK, why: `wave ${w + 1} parked ${parked.join(', ')}` })
        skip(a.blocked)
        for (let k = 0; k < later.length; k++) waves[w + 1 + k] = a.waves[k]
        const goOn = a.waves.flat().length
        note(`wave ${w + 1} parked ${parked.join(', ')} — skipped ${[...a.blocked.keys()].join(', ') || 'none'}; ${goOn} later plan(s) go on`)
      }
      // An asking plan holds what a park would skip; the rest of the later waves go on.
      for (const root of askedNow) {
        const rest = waves.slice(w + 1)
        if (!rest.flat().length) break
        const a = afterPark({ parked: [root], laterWaves: rest, edges: order.edges, onPark: ON_PARK, why: `plan ${root} asks ${asking.get(root)?.ask.id}` })
        for (const [n, why] of a.blocked) hold(n, root, why)
        for (let k = 0; k < rest.length; k++) waves[w + 1 + k] = a.waves[k]
        if (a.blocked.size) note(`plan ${root} asks ${asking.get(root)?.ask.id} — ${[...a.blocked.keys()].join(', ')} wait on the answer; the rest go on`)
      }
    }
    // ---- the answers: once every other plan has ended ----
    await waitForAnswers()
    // ---- the final gate on the run branch ----
    const merged = outcomes.filter((x) => x.state === 'merged')
    const finalChecks = [...new Set([...gateCommands({ prepare: PREPARE, pm: PM, ...COMMANDS, manifest: init.kitManifest === true }), ...(Array.isArray(CI_MIRROR) ? CI_MIRROR : []).filter((c) => !checkProblem(c, init.npmScripts ?? null)).map((c) => String(c).trim())])]
    if ((merged.length || order.skipped.length) && finalChecks.length && !stopReason) {
      say(`RUN_PLANS: final gate on ${RUN_BRANCH} (${finalChecks.length} command(s))`)
      git(mergeFolder, 'fetch', '--quiet', 'origin')
      git(mergeFolder, 'merge', '--quiet', '--ff-only', `origin/${RUN_BRANCH}`)
      const g = await runGate({ folder: mergeFolder, commands: finalChecks, timeoutMin: GATE_TIMEOUT_MIN, receipt: false, onResult: (row) => csvRow('final', `final gate: ${row.command}`, '-', row.seconds, 0, 0, row.exit) })
      const bad = g.results.find((x) => x.status !== 'pass')
      finalGate = g.status === 'pass' ? { ok: true } : { ok: false, command: bad?.command ?? '', tail: bad?.tail ?? '' }
      if (!finalGate.ok) {
        stopReason = `final gate failed: ${finalGate.command} — ${String(finalGate.tail).split('\n').slice(-3).join(' / ')}`.slice(0, 380)
        state('stop', { run: RUN, reason: stopReason })
      }
    }
  } catch (e) {
    stopReason = stopReason ?? `run stopped with an error: ${String(e?.message ?? e).slice(0, 300)}`
  } finally {
    clearInterval(beat)
  }
  if (stopReason && !/^final gate failed/.test(stopReason)) state('stop', { run: RUN, reason: stopReason })
  // ---- decisions, then the report (orch-state.mjs finish writes it, unchanged) ----
  const rows = decisions.map((d, i) => ({ plan: d.plan, id: `D${priorTop + i + 1}`, text: d.text }))
  if (rows.length) state('decisions', { run: RUN, b64: b64(JSON.stringify(rows)) })
  const fin = state('finish', {
    run: RUN, 'final-gate': finalGate ? (finalGate.ok ? 'ok' : 'failed') : 'none',
    ...(finalGate && !finalGate.ok && finalGate.command ? { 'final-gate-command-b64': b64(finalGate.command), 'final-gate-tail-b64': b64(String(finalGate.tail).slice(-2000)) } : {}),
  })
  const mergedList = outcomes.filter((x) => x.state === 'merged').map((x) => x.nnn)
  const parkedList = outcomes.filter((x) => x.state === 'parked').map((x) => x.nnn)
  const skippedList = outcomes.filter((x) => x.state === 'skipped').map((x) => x.nnn)
  say(`RUN_PLANS: ${stopReason ? `stopped (${stopReason})` : 'finished'} — merged ${mergedList.join(', ') || 'none'}; parked ${parkedList.join(', ') || 'none'}; skipped ${skippedList.join(', ') || 'none'}`)
  say(`RUN_PLANS: report ${fin.report ?? '(not committed)'} · local copy ${fin.local ?? '?'} · calls ${csv.replace(/\\/g, '/')}`)
  say(`RUN_PLANS_JSON ${JSON.stringify({ ok: !stopReason && !parkedList.length && !skippedList.length, run: RUN, branch: RUN_BRANCH, merged: mergedList, parked: parkedList, skipped: skippedList, outcomes, stopReason, ...(stopReason && /^rate-limit/.test(stopReason) ? { stopped: 'rate-limit' } : {}), finalGate, report: fin.report ?? null, local: fin.local ?? null, calls: csv.replace(/\\/g, '/') })}`)
  return mergedList.length === all.length && !stopReason ? 0 : 2
}

/**
 * The builder's guard hooks in headless mode: `--setting-sources local` loads no project settings, so the project's
 * PreToolUse hooks (branch guard, plan-write guard, scope guard, the write guard) come from a file the script writes
 * outside the builder's folder — the hooks block of this folder's `.claude/settings.json`, with `${CLAUDE_PROJECT_DIR}`
 * replaced by this folder's path (the same hooks, run from the same place, as the workflow's builder had). A guard that
 * judges a file in the builder's folder hands it to that folder's own guard (scripts/lib/guard.mjs, like any other
 * worktree); the gate's trusted scope check is the backstop. Returns the file, or null when there are no such hooks
 * (the run then refuses to start: a builder never runs unguarded). `write` false: the path only (the dry run).
 */
export function builderSettings(runDir, { write = true } = {}) {
  let s
  try {
    s = JSON.parse(readFileSync(join(ROOT, '.claude', 'settings.json'), 'utf8'))
  } catch {
    return null
  }
  const pre = s?.hooks?.PreToolUse
  if (!Array.isArray(pre) || !pre.length) return null
  const file = join(runDir, 'builder-settings.json')
  if (!write) return file
  const root = ROOT.replace(/\\/g, '/')
  const text = JSON.stringify(pre).split('${CLAUDE_PROJECT_DIR}').join(root).split('$CLAUDE_PROJECT_DIR').join(root)
  mkdirSync(runDir, { recursive: true })
  writeFileSync(file, `${JSON.stringify({ hooks: { PreToolUse: JSON.parse(text) } }, null, 2)}\n`)
  return file
}

/** The merge step's checks (orchestrator.mergeChecks): "build" = the build plus the scope check, "full" = the plan's gate. */
function mergeChecksOf(checks) {
  if (MERGE_CHECKS_MODE === 'full') return checks.filter((c) => !/kit-manifest-check|^scope-check \(kit copy\)/.test(c))
  const build = typeof COMMANDS.build === 'string' && COMMANDS.build ? `${PM} run ${COMMANDS.build}` : null
  return build ? [build] : []
}

/**
 * A scope answer's paths, added to the plan's ```scope block on the run branch before the plan resumes: one commit in
 * the merge folder, pushed (the gate reads the scope from the run branch; plan-info merges it into the plan branch).
 */
function extendScope({ mergeFolder, runBranch, planPath, paths, id, run, nnn }) {
  git(mergeFolder, 'fetch', '--quiet', 'origin')
  const ff = git(mergeFolder, 'merge', '--quiet', '--ff-only', `origin/${runBranch}`)
  if (ff.status !== 0) return { ok: false, error: `the merge folder does not fast-forward to origin/${runBranch}: ${lastLine(ff.err)}` }
  const file = join(mergeFolder, planPath)
  if (!existsSync(file)) return { ok: false, error: `${planPath} is not on ${runBranch}` }
  const { text, added } = withScopeLines(readFileSync(file, 'utf8'), paths)
  if (!added.length) return { ok: true, added }
  writeFileSync(file, text)
  for (const step of [['add', '--', planPath], ['commit', '--quiet', '-m', `plan(${nnn}): scope + ${added.join(', ')} — the answer to ask ${id} of run ${run}`], ['push', '--quiet', 'origin', `HEAD:refs/heads/${runBranch}`]]) {
    const r = git(mergeFolder, ...step)
    if (r.status !== 0) return { ok: false, error: `git ${step[0]}: ${lastLine(r.err || r.out)}` }
  }
  return { ok: true, added }
}

/** After the builder: no uncommitted file, at least one commit beyond the run branch, and the branch on origin. */
function landBranch(wt, branch, runBranch) {
  const dirty = git(wt, 'status', '--porcelain').out.split('\n').filter((l) => l && !/^\?\? \.worktree-/.test(l) && !l.endsWith('.claude/gate-receipt.json'))
  if (dirty.length) return { why: `builder left uncommitted files: ${dirty.map((l) => l.slice(3)).slice(0, 5).join(', ')}`, findings: [{ id: 'commit-1', file: dirty[0].slice(3), line: 1, rule: 'uncommitted work', reasoning: 'commit the files you changed (named paths) or remove them', severity: 'blocker' }] }
  const ahead = Number(git(wt, 'rev-list', '--count', `origin/${runBranch}..HEAD`).out) || 0
  if (!ahead) return { why: 'builder committed nothing', escalate: true }
  const p = git(wt, 'push', '--quiet', '-u', 'origin', branch)
  if (p.status !== 0) return { why: `git push -u origin ${branch} failed: ${lastLine(p.err)}` }
  return null
}

/** The builder's task, in the workflow's KEY: value shape, with the Human's two hard limits. */
export function builderPrompt({ RUN, RUN_BRANCH, ctx, l, LESSONS }) {
  const task = (o) => Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n')
  return [
    `Build plan ${ctx.nnn} of orchestrator run ${RUN} (mode: ${ctx.mode}). Follow your instructions (.claude/agents/orch-builder.md) and docs/agent/agent-roles.md.`,
    task({
      PLAN: l.path, BRANCH: ctx.info.branch, WORKTREE: ctx.wt.path, RUN_BRANCH, MODE: ctx.mode, TIER: ctx.tier, ROUND: ctx.round, CHECKS: l.checks,
      FINDINGS: ctx.mode === 'fix' && ctx.findings.length ? ctx.findings : undefined, HANDOFF: ctx.mode === 'handoff' || ctx.mode === 'resume' ? ctx.handoff : undefined, LESSONS,
      ANSWER: ctx.answer ?? undefined,
    }),
    ctx.answer ? `Your plan's question ${ctx.answer.id} was answered by the ${ctx.answer.by}: follow ANSWER.answer. It settles the stop that raised the question; the plan, its scope and the hard limits still hold.` : '',
    `HARD LIMITS (the Human's; an open choice that would break one is a blocker, not a default): ${HARD_LIMITS.join(' ')}`,
    `Push with git push -u origin ${ctx.info.branch} — never a bare git push (the branch tracks its own remote branch, never the run branch).`,
    ctx.mode === 'fix' ? 'Fix exactly the FINDINGS, rerun the checks, commit and push your branch.' : '',
    ctx.mode === 'handoff' ? 'You are a fresh builder: the folder is back at the plan branch\'s base. Read the HANDOFF file and the plan, rerun the failing check first, and re-implement the plan from the base.' : '',
    ctx.mode === 'resume' ? 'You continue an attempt that stopped (not for its own code): the branch holds its saved commits and the packages are installed. Read the HANDOFF file and git diff against the run branch, tick the plan\'s sub-tasks they finish, and continue from there.' : '',
    ctx.mode === 'first' && ctx.wt.resumed ? `The branch already has ${ctx.wt.resumed} commit(s) from an earlier attempt, and the packages are installed: read git diff against the run branch, tick the plan's sub-tasks they finish, and continue from there.` : '',
    'Return only your JSON result.',
  ].filter(Boolean).join('\n\n')
}

/** The review: a detached review folder at the checked head, one reviewer call in it, the folder removed after. */
async function reviewStep({ nnn, RUN, RUN_BRANCH, branch, checkedHead, reviewPath, receipt, reviewerAgent, REVIEW_MODEL, bin, modelCall, mode: asked }) {
  // A sensitive diff (ship-prep's own check, security.sensitivePaths included) is reviewed as gate whatever the plan's
  // Reviewer: line or --reviewer-mode says: a STOP gets a fix round, then parks, and a review that cannot run parks.
  const { mode, note: sensitiveNote } = reviewModeFor({ asked, files: diffFiles(`origin/${RUN_BRANCH}...${checkedHead}`) })
  const r = await reviewIn({ nnn, RUN, RUN_BRANCH, branch, checkedHead, reviewPath, receipt, reviewerAgent, REVIEW_MODEL, bin, modelCall, mode })
  return { ...r, mode, note: [sensitiveNote, r.note].filter(Boolean).join(' · ') || undefined }
}

/** The files a diff range touches (git diff --name-only; renames listed by their new path). */
function diffFiles(range) {
  return git(ROOT, 'diff', '--name-only', '--no-renames', range).out.split(/\r?\n/).map((f) => f.trim()).filter(Boolean)
}

/**
 * The review mode of one plan's diff: the asked mode (the plan's own, from optionProblems), except that a diff that
 * touches a sensitive path is always gate. Returns { mode, sensitive, note }.
 */
export function reviewModeFor({ asked, files, sensitive = isSensitive }) {
  const hits = files.filter(sensitive)
  if (asked === 'gate' || !hits.length) return { mode: asked, sensitive: hits, note: null }
  const shown = hits.slice(0, 3).join(', ') + (hits.length > 3 ? ` and ${hits.length - 3} more` : '')
  return { mode: 'gate', sensitive: hits, note: `reviewer gate: the diff touches a sensitive path (${shown}) — advisory never applies to a sensitive diff` }
}

async function reviewIn({ nnn, RUN, RUN_BRANCH, branch, checkedHead, reviewPath, receipt, reviewerAgent, REVIEW_MODEL, bin, modelCall, mode }) {
  const repo = ROOT.split(/[\\/]/).pop()
  const folder = join(dirname(ROOT), `${repo}-orch-review-${RUN}-${nnn}`)
  if (existsSync(folder)) {
    git(ROOT, 'worktree', 'remove', '--force', folder)
    rmSync(folder, { recursive: true, force: true })
  }
  const add = git(ROOT, 'worktree', 'add', '--quiet', '--detach', folder, checkedHead)
  if (add.status !== 0) return { error: `review folder: git worktree add: ${lastLine(add.err)}` }
  try {
    const diffText = git(ROOT, 'diff', '--no-color', `origin/${RUN_BRANCH}...${checkedHead}`).out
    const planText = reviewPath && existsSync(join(ROOT, reviewPath)) ? readFileSync(join(ROOT, reviewPath), 'utf8') : ''
    let callAnswer = null
    const r = await review({
      agentFile: reviewerAgent.file, model: REVIEW_MODEL, cwd: folder, nnn, run: RUN, planText, base: `origin/${RUN_BRANCH}`, branch: `origin/${branch}`, diffText, receipt, mode,
      call: async (args) => {
        // allow: the reviewer is read-only, so only its read tools are pre-approved (no Bash); trustCwdSettings false: the
        // folder is the branch under review, and a .claude/settings.local.json in it refuses the call.
        callAnswer = await modelCall(nnn, 'reviewer', () => runAgent({ ...args, agent: reviewerAgent, timeoutMs: REVIEW_TIMEOUT_MIN * 60_000, bin, allow: true, trustCwdSettings: false }), { model: REVIEW_MODEL })
        return callAnswer
      },
    })
    if (!r.call.ok) return { error: r.call.error, refused: r.call.refused === true }
    say(`RUN_PLANS: plan ${nnn} review ${r.verdict}${r.verdict === 'STOP' && !r.enforced ? ' (advisory, not enforced)' : ''}`)
    return r
  } finally {
    git(ROOT, 'worktree', 'remove', '--force', folder)
    if (existsSync(folder)) rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().then((code) => process.exit(code), (e) => {
    console.error(`RUN_PLANS: crashed — ${e?.stack ?? e}`)
    process.exit(1)
  })
}
