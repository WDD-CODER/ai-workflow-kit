/**
 * Orchestrator run — the pure rules of an orchestrator run (docs/agent/orchestrator.md), shared by
 * scripts/orch-state.mjs and scripts/orch-preflight.mjs. No file system, no git, no clock: callers pass text and
 * values in, so every rule here is tested on its own.
 */
import { parseArchImpact } from './invariants.mjs'

/** A run name: lower-case letters, digits and dashes, 1-40 characters, starting with a letter or digit. */
export const RUN_NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/

/** Why a run name cannot be used, or null. */
export function runNameProblem(name) {
  if (typeof name !== 'string' || !RUN_NAME_RE.test(name)) return `run name ${JSON.stringify(name ?? '')} — use lower-case letters, digits and dashes (1-40), e.g. "batch-1"`
  return null
}

/** The states a plan moves through in a run; status.json refuses any other. */
export const PLAN_STATES = ['queued', 'building', 'gate', 'checking', 'fixing', 'env-paused', 'asking', 'merging', 'merged', 'parked', 'left-run', 'skipped']

/** The only shape a plan branch may have: it reaches git commands and agent prompts. */
export const PLAN_BRANCH_RE = /^feat\/\d+-[a-z0-9-]+$/

/** The plan branch of a run: feat/NNN-<first four words of the file slug>, lower-case letters, digits and dashes only
 *  (any other character of the file name becomes a word break). */
export function planBranch(planPath, nnn) {
  const file = String(planPath).replace(/\\/g, '/').split('/').pop()
  const slug = file.replace(/\.plan\.md$/, '').replace(/^\d+-/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').split('-').filter(Boolean).slice(0, 4).join('-')
  return `feat/${nnn}-${slug || 'plan'}`
}

/** Why a plan branch cannot be used, or null. */
export function planBranchProblem(branch) {
  return typeof branch === 'string' && PLAN_BRANCH_RE.test(branch) ? null : `plan branch ${JSON.stringify(branch ?? '')} does not match feat/<NNN>-<lower-case words with dashes>`
}

/**
 * Files whose added lines match `codeRe`, from `git diff -U0` output — or `failed` (the caller treats the diff as
 * sensitive) when git failed or its output was cut off: a diff the check could not read is never a clean one.
 * diff: { status, out, truncated }. Files in `skip` are already sensitive by path.
 */
export function addedCodeFiles(diff, codeRe, skip = []) {
  if (!diff || diff.status !== 0 || diff.truncated) return { failed: true, files: [] }
  const files = []
  let cur = null
  for (const l of String(diff.out).split('\n')) {
    if (l.startsWith('+++ ')) cur = l.replace(/^\+\+\+ (b\/)?/, '')
    else if (cur && l.startsWith('+') && codeRe.test(l) && !files.includes(cur) && !skip.includes(cur)) files.push(cur)
  }
  return { failed: false, files }
}

/** A screenshot path a [ui] card may record: relative, safe characters, no leading `-`, no `..`. */
export const SAFE_SHOT_RE = /^(?!-)(?!.*\.\.)[A-Za-z0-9_./-]+$/

/** Why a [ui] card value cannot be recorded, or null: the card title does not start with `-`, the page is an http(s)
 *  URL, each screenshot matches SAFE_SHOT_RE. */
export function uiCardProblem({ card, page, shots } = {}) {
  if (card !== undefined && (typeof card !== 'string' || !card.trim() || /^\s*-/.test(card))) return `card ${JSON.stringify(card)} — a title, not starting with "-"`
  if (page !== undefined && page !== '' && !/^https?:\/\/[^\s"'`$\\<>|;&]+$/.test(String(page))) return `page ${JSON.stringify(page)} — an http(s) URL`
  for (const s of shots ?? []) if (!SAFE_SHOT_RE.test(String(s))) return `screenshot ${JSON.stringify(s)} — a relative path of letters, digits, . _ / -`
  return null
}

/**
 * The tier a plan's first builder starts on (INV-1): judgment when Architecture Impact `changes` or `deviation`s an
 * invariant, or names one with an unreadable kind (fail safe); `preserves`, INV-none or no section start on build.
 * Returns { tier, invariants (only those that send the plan to judgment), reason } — reason is what the dry run and
 * the run's note print, e.g. "INV-1 changes", "INV-1 preserves", "INV-none".
 */
export function startTier(planText) {
  const { present, entries } = parseArchImpact(String(planText))
  const named = entries.filter((e) => e.id !== 'INV-none')
  const judged = named.filter((e) => e.kind !== 'preserves')
  const label = (e) => `${e.id} ${e.kind ?? 'unreadable'}`
  if (judged.length) return { tier: 'judgment', invariants: judged.map((e) => e.id), reason: judged.map(label).join(', ') }
  const reason = named.length ? named.map(label).join(', ') : entries.length ? 'INV-none' : present ? 'no invariant named' : 'no Architecture Impact'
  return { tier: 'build', invariants: [], reason }
}

/**
 * The plan without its `## Execution Notes` section (the heading and every line up to the next `## ` heading outside a
 * code fence): what the checkers read, so the builder's own account of its work never reaches them. Every other line is
 * kept as it is, line endings included.
 */
export function planWithoutNotes(planText) {
  const lines = String(planText).split(/(?<=\n)/)
  const out = []
  let inNotes = false
  let fence = false
  for (const line of lines) {
    const bare = line.replace(/\r?\n$/, '')
    if (!fence && /^##\s/.test(bare)) inNotes = /^##\s+Execution Notes\s*$/i.test(bare)
    if (/^\s*(```|~~~)/.test(bare)) fence = !fence
    if (!inNotes) out.push(line)
  }
  return out.join('')
}

/** The plan's `[human]` items (Goals / Done-when), verbatim without the tag, in file order. */
export function humanItems(planText) {
  const out = []
  for (const line of String(planText).replace(/\r\n/g, '\n').split('\n')) {
    const m = /^\s*[-*]\s*(?:\[[ x]\]\s*)?\[human\]\s*(.+)$/i.exec(line)
    if (m) out.push(m[1].trim())
  }
  return out
}

/**
 * Why a package.json test script would never exit, or null: `vitest` without `run` / --run / --watch=false, `jest`
 * with --watch or --watchAll, or a match of `pattern` (orchestrator.watchTestPattern, a regular expression a project
 * writes for its own framework's watch-mode command). The gate waits on the command, so a watch mode hangs it (a
 * project then sets commands.testCi to a script that exits).
 */
export function watchModeProblem(script, pattern = '') {
  const s = String(script ?? '')
  if (pattern) {
    try {
      if (new RegExp(pattern).test(s)) return 'it matches orchestrator.watchTestPattern'
    } catch { /* an invalid pattern is refused by install and sync */ }
  }
  if (/\bvitest\b/.test(s) && !/\bvitest\s+run\b|--run\b|--watch(?:=|\s+)false\b/.test(s)) return 'vitest without "run"'
  if (/\bjest\b/.test(s) && /--watch(?:All)?\b(?!=false)/.test(s)) return 'jest with --watch'
  return null
}

/** Free memory in GB (one decimal, rounded down) from os.freemem(): the one helper run-supervisor.mjs's floor and
 * /orchestrate's second-run rule (`node scripts/run-supervisor.mjs --free-mem`) both use. */
export const freeMemGb = (bytes) => Math.floor((Number(bytes) / 2 ** 30) * 10) / 10

/** Free space in GB (one decimal) from a statfs result. */
export const freeGb = (st) => Math.floor((Number(st.bavail) * Number(st.bsize)) / 1e8) / 10

const FINAL_STATES = ['merged', 'parked', 'left-run', 'skipped']

/**
 * The one line `orch-state.mjs watch` prints, from status.json alone: { line, stuck }.
 * - phase finished → `FINISHED`; stopped → `STOPPED: <reason>`;
 * - running with `updatedAt` older than `staleMin` minutes → `STUCK: plan <NNN> · <state> · no progress for <n> min ·
 *   last: <last note>` (the plan: the one in a non-final state whose history is the latest, else `?`);
 * - running with one plan's last two notes saying the same thing → `STUCK: plan <NNN> · <state> · same reason twice: <text>`;
 * - else `RUNNING`.
 * `nowMs` is the caller's clock (tests pass a fixed one).
 */
export function watchLine(status, { nowMs, staleMin }) {
  const phase = status?.phase ?? 'unknown'
  if (phase === 'finished') return { line: 'FINISHED', stuck: false }
  if (phase === 'stopped') return { line: `STOPPED: ${status.stopReason ?? 'stopped'}`, stuck: false }
  const plans = Object.values(status?.plans ?? {})
  const notes = Array.isArray(status?.notes) ? status.notes : []
  const lastAt = (p) => Date.parse((p.history ?? []).at(-1)?.at ?? '') || 0
  const active = plans.filter((p) => !FINAL_STATES.includes(p.state)).sort((a, b) => lastAt(b) - lastAt(a))[0]
  const who = active ? `plan ${active.nnn} · ${active.state}` : 'plan ? · no plan in progress'
  const stateOf = (nnn) => plans.find((p) => String(p.nnn) === String(nnn))?.state ?? '?'
  // The same reason twice in a row for one plan: the run is turning in a circle whatever updatedAt says.
  const seen = new Map()
  for (const n of notes) {
    if (!n.plan) continue
    const prev = seen.get(String(n.plan))
    if (prev !== undefined && prev === n.text) return { line: `STUCK: plan ${n.plan} · ${stateOf(n.plan)} · same reason twice: ${n.text}`, stuck: true }
    seen.set(String(n.plan), n.text)
  }
  const updated = Date.parse(status?.updatedAt ?? '')
  const idleMin = Number.isFinite(updated) ? Math.floor((nowMs - updated) / 60000) : null
  if (idleMin !== null && idleMin > staleMin) {
    const last = notes.at(-1)?.text ?? 'no note yet'
    return { line: `STUCK: ${who} · no progress for ${idleMin} min · last: ${last}`, stuck: true }
  }
  return { line: 'RUNNING', stuck: false }
}

/**
 * One `watch` line per plan of a run: state, round, tier and the model of its latest call, the minutes since its last
 * state change, and its last calls.csv row. `calls` is calls.csv's text (or ''). Plans in number order.
 */
export function planLines(status, { nowMs, calls = '' }) {
  const rows = String(calls).split(/\r?\n/).slice(1).filter(Boolean)
  const lastRow = (nnn) => rows.filter((r) => r.split(',')[0] === String(nnn)).at(-1) ?? null
  const plans = Object.values(status?.plans ?? {}).sort((a, b) => Number(a.nnn) - Number(b.nnn))
  return plans.map((p) => {
    const since = Date.parse((p.history ?? []).at(-1)?.at ?? '')
    const min = Number.isFinite(since) ? Math.max(0, Math.floor((nowMs - since) / 60000)) : null
    const latest = Object.entries(p.models ?? {}).sort((a, b) => (Date.parse(b[1]?.at ?? '') || 0) - (Date.parse(a[1]?.at ?? '') || 0))[0]
    const model = latest ? `${latest[0]} ${latest[1].model}` : 'no call yet'
    return `  ${p.nnn} ${p.state ?? '?'} · round ${p.round ?? 0} · tier ${p.tier ?? '-'} · ${model} · ${min === null ? '?' : min} min in this state · last call: ${lastRow(p.nnn) ?? 'none'}`
  })
}

// ---- asks: one question of one plan, one file (docs/agent/orchestrator.md "Asks") -------------------------------
/** Kinds only the Human answers; the two hard limits are `spend` and `production`. */
export const HUMAN_ONLY_KINDS = ['data', 'privacy', 'product', 'design', 'production', 'spend', 'decision-stale', 'db-write']
/** Kinds the Human or, later, the advisor answers. */
export const OPEN_KINDS = ['scope', 'technical', 'environment', 'review']
export const ASK_KINDS = [...HUMAN_ONLY_KINDS, ...OPEN_KINDS]
/** An ask id: `<NNN>-<n>` (the plan and its n-th ask in the run). */
export const ASK_ID_RE = /^\d{3,4}-\d{1,3}$/
/** Only the Human answers a Human-only kind, an unknown kind, or a question whose asker named no kind. */
export function humanOnlyAsk(kind, stated = true) {
  return !stated || !OPEN_KINDS.includes(String(kind))
}
/**
 * The plain-text card `watch` (and the run's console) prints for one open ask: the one line (id, plan, kind, who
 * answers, the question), the options with the recommended one first and marked, and the exact answer command.
 */
export function askCard(ask, run) {
  const options = Array.isArray(ask?.options) ? ask.options : []
  const rec = Number(ask?.recommendation)
  const numbered = options.map((o, i) => ({ n: i + 1, o }))
  const ordered = [...numbered.filter((x) => x.n === rec), ...numbered.filter((x) => x.n !== rec)]
  const cmd = `node scripts/orch-state.mjs answer --run ${run} --id ${ask.id}`
  return [
    `ASK ${ask.id} · plan ${ask.plan} · ${ask.kind} · ${ask.humanOnly ? 'only the Human answers' : 'the Human or the advisor answers'}: ${ask.question}`,
    ...ordered.map((x) => `  ${x.n}. ${x.o}${x.n === rec ? '  (recommended)' : ''}`),
    ...(ordered.length ? [`  answer: ${cmd} --choice ${ordered[0].n}`] : []),
    `  ${ordered.length ? 'or:    ' : 'answer:'} ${cmd} --text "<your answer>"`,
  ]
}

// ---- UI environment (orch-preflight.mjs --ui) ----------------------------------------------------------------------
// Each takes what a request returned — { status, allowOrigin } or { error } — and says what blocks the browser step.
const originOf = (url) => {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** A page's dev server: any answer below 500 means it is up. */
export function serverProblem(pageUrl, res) {
  const origin = originOf(pageUrl)
  if (!origin) return `page ${JSON.stringify(pageUrl)} is not a URL`
  if (res?.error) return `dev server ${origin} does not answer (${res.error}) — start it (node scripts/slot-serve.mjs or the project's dev command)`
  if (!(res?.status < 500)) return `dev server ${origin} answered ${res?.status} — fix the server error first`
  return null
}

/** The QA login: 2xx or 3xx is a working login; 401/403 or anything else blocks every card behind it. */
export function loginProblem(loginUrl, res) {
  if (res?.error) return `login ${loginUrl} does not answer (${res.error})`
  if (!(res?.status >= 200 && res.status < 400)) return `login ${loginUrl} answered ${res?.status} — check the QA user in .env (ORCH_QA_USER / ORCH_QA_PASSWORD)`
  return null
}

/** The backend, asked with the page's Origin: it must answer, and allow that origin when it is another origin. */
export function crossOriginProblem(pageUrl, apiUrl, res) {
  const page = originOf(pageUrl)
  const api = originOf(apiUrl)
  if (!api) return `backend ${JSON.stringify(apiUrl)} is not a URL`
  if (res?.error) return `backend ${api} does not answer (${res.error}) — start it`
  if (!(res?.status < 500)) return `backend ${api} answered ${res?.status}`
  if (page && page !== api && res.allowOrigin !== '*' && res.allowOrigin !== page) {
    return `backend ${api} is cross-origin unreachable from ${page} (Access-Control-Allow-Origin: ${res.allowOrigin || 'missing'}) — allow the dev origin`
  }
  return null
}

const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\r?\n/g, ' ')
const shotCell = (c) => ((c.screenshots ?? []).length
  ? c.screenshots.map((s) => `[![${cell(c.card).replace(/[[\]]/g, '')}](${s})](${s})`).join(' ')
  : 'no screenshot')

/**
 * The validation list of the merged plans, numbers running on across groups:
 * - a screenshot grid per page (plan order): one row per checked `[ui]` card — title, verdict (who checked it: the
 *   card's script or the browser agent, and the round) and a thumbnail link to each screenshot;
 * - first, one card per `removes:` decision of a merged plan (`removals`: { id, plan, text }), numbered before the rest;
 * - PLAN-DRIFT in its own section (the plan says X, the app has Y — no severity, not a bug);
 * - the `[ui]` cards no one checked and the plans' `[human]` items, which name no page, per plan.
 */
export function validationList(mergedPlans, removals = []) {
  const pages = new Map()
  const drift = []
  const unchecked = []
  for (const p of mergedPlans) {
    for (const c of p.uiCards ?? []) {
      const card = { ...c, nnn: p.nnn }
      if (c.status === 'plan-drift') drift.push(card)
      else if (c.status === 'unchecked') unchecked.push(card)
      else {
        const page = c.page || `page not named (plan ${p.nnn})`
        if (!pages.has(page)) pages.set(page, [])
        pages.get(page).push(card)
      }
    }
  }
  const human = mergedPlans.filter((p) => (p.humanItems ?? []).length)
  if (!pages.size && !drift.length && !unchecked.length && !human.length && !removals.length) return ['- nothing to validate', '']
  let n = 0
  const out = []
  if (removals.length) {
    out.push('### Removed behaviour — check before merging the PR', '')
    for (const r of removals) out.push(`${++n}. ${r.plan}: ${r.id} ${cell(r.text)} — open the screen; accept: decisions: ok · keep it: ${r.id} ✗ restore`)
    out.push('')
  }
  for (const [page, cards] of pages) {
    out.push(`### ${page}`, '', '| # | Card | Verdict | Screenshot |', '| --- | --- | --- | --- |')
    for (const c of cards) out.push(`| ${++n} | ${c.nnn}: ${cell(c.card)} | ${c.status} — ${c.via ?? 'browser'}, round ${c.round ?? 0} | ${shotCell(c)} |`)
    out.push('')
  }
  if (drift.length) {
    out.push('### Plan drift — the plan says X, the app has Y (not a bug; update the card or the plan)', '')
    for (const c of drift) {
      const shots = (c.screenshots ?? []).length ? c.screenshots.map((s) => `\`${s}\``).join(', ') : 'no screenshot'
      out.push(`${++n}. ${c.nnn}: ${c.card} — on ${c.page || 'a page not named'}; evidence: ${shots}`)
    }
    out.push('')
  }
  if (unchecked.length || human.length) {
    const any = pages.size || drift.length
    out.push(any ? '### Not checked by the run — the plans\' [human] items' : '### The plans\' [human] items (no UI check ran)', '')
    for (const c of unchecked) out.push(`${++n}. ${c.nnn}: ${c.card} — a [ui] card no script could check and the browser step was off; on ${c.page || 'a page not named'}`)
    for (const p of human) for (const h of p.humanItems) out.push(`${++n}. ${p.nnn} ${p.title ?? ''}: ${h}`)
    out.push('')
  }
  return out
}

/**
 * The run report (Markdown) from status.json and the merges git shows. `merged` is the ordered list of
 * { nnn, branch, sha } read from the anchored merge subjects — never a count kept in memory.
 */
/**
 * The project's log query (commands.logQuery) as node arguments for the report's app-errors section, or null when it
 * is unset, or { error } when it is not `node scripts/…` / `node tools/…`. `--since=plan-start` (a slot's stamp, which
 * the main folder never has) becomes `--since=<the run's start time>`.
 */
export function logQueryArgs(cmd, startedAt) {
  const c = String(cmd ?? '').trim()
  if (!c) return null
  const w = c.split(/ +/)
  if (w[0] !== 'node' || !/^(scripts|tools)\/[A-Za-z0-9_./-]+\.m?js$/.test(w[1] ?? '') || w[1].includes('..')) return { error: 'commands.logQuery is not node scripts/… or node tools/…, not run' }
  const args = w.slice(1).map((x) => (x === '--since=plan-start' && startedAt ? `--since=${startedAt}` : x))
  return { args, command: `node ${args.join(' ')}` }
}

/** Main counts as untouched when it did not move, or when every file it changed is a plan file or the todo list. */
export function mainUntouched(startSha, nowSha, changedFiles) {
  if (!startSha || startSha === nowSha) return { untouched: true, adminFiles: 0 }
  if (!Array.isArray(changedFiles)) return { untouched: false, adminFiles: 0 }
  const admin = changedFiles.filter((f) => /^plans\/.*\.plan\.md$/.test(f) || f === '.claude/todo.md')
  return { untouched: admin.length === changedFiles.length, adminFiles: admin.length }
}

function appErrorsSection(e) {
  if (!e) return []
  const head = ['## App errors since the run started', '', `Command (from the main folder): \`${e.command}\``]
  if (e.error) return [...head, `Could not run: ${e.error}`, '']
  return [...head, `Exit code: ${e.exit ?? '?'}`, '', '```text', ...(e.lines.length ? e.lines : ['(no output)']), ...(e.more ? [`… ${e.more} more line(s)`] : []), '```', '']
}

/** The report's flaky-check lines (a check that passed only on a rerun), or [] when status.json has none. */
function flakySection(status, plans) {
  const via = (f) => (f.via === 'same-commit' ? `passed on the next gate with no new commit${f.sha ? ` (${String(f.sha).slice(0, 7)})` : ''}` : "passed on the gate's rerun after env-fail")
  const rows = [
    ...plans.flatMap((p) => (p.flakes ?? []).map((f) => `- ${p.nnn}: \`${f.command}\` — round ${f.round ?? 0}, ${via(f)}`)),
    ...(status.flakes ?? []).map((f) => `- final gate: \`${f.command}\` — ${via(f)}`),
  ]
  return rows.length ? ['## Flaky checks', '', ...rows, ''] : []
}

// ---- decision triage (docs/agent/decision-review.md §5) --------------------------------------------------------------
export const TRIAGE_VERDICTS = ['accept', 'ask', 'follow-up', 'noise']
// A decision that names one of these is never accepted by the triage agent: the Human sees it. `author` and
// `authorship` do not match (`auth` alone is a word); `price` does. scripts/orch-state.mjs carries a mirror copy of this rule (SENSITIVE_CODE_RE).
export const TRIAGE_SENSITIVE_RE = /\b(auth|authn|authz|authentication|authori[sz]\w*|login|password\w*|permission\w*|roles?|tokens?|sessions?|secur\w*|secrets?|encrypt\w*|schema\w*|migrat\w*|columns?|data shape|payments?|pay|prices?|pricing|money|billing|invoices?|currenc\w*|refunds?)\b/i

/** `behaviour`, `seen`, `removes` — the type word a decision line starts with; `other` when it has none. */
export function decisionType(text) {
  const m = /^\s*(behaviour|seen|removes):/i.exec(String(text ?? ''))
  return m ? m[1].toLowerCase() : 'other'
}

/**
 * The hard rules, applied by code to the triage agent's verdict (never trusted): returns { verdict, forced }.
 * `none` stays `none`; an `ask` stays `ask`. For the rest, a type other than behaviour/seen (a `removes` type) and a
 * sensitive word turn the verdict into `ask` (forced `type` / `keyword`); a `seen:` accept becomes `follow-up` (forced
 * `seen`); an accept with a confidence below 70 or none becomes `ask` (forced `confidence`). A `follow-up` or `noise`
 * keeps its verdict unless the type or keyword rule fires: it hides nothing the Human must see.
 */
export function triageForce({ type, text, verdict, confidence }) {
  if (!TRIAGE_VERDICTS.includes(verdict)) return { verdict: 'none', forced: null }
  if (verdict === 'ask') return { verdict: 'ask', forced: null }
  const t = String(type ?? decisionType(text)).toLowerCase()
  if (t !== 'behaviour' && t !== 'seen') return { verdict: 'ask', forced: 'type' }
  if (TRIAGE_SENSITIVE_RE.test(String(text ?? ''))) return { verdict: 'ask', forced: 'keyword' }
  if (verdict === 'accept' && t === 'seen') return { verdict: 'follow-up', forced: 'seen' }
  const c = confidence === null || confidence === undefined || confidence === '' ? NaN : Number(confidence)
  if (verdict === 'accept' && !(c >= 70)) return { verdict: 'ask', forced: 'confidence' }
  return { verdict, forced: null }
}

const idNum = (d) => Number(String(d.id).replace(/\D/g, '')) || 0
/**
 * What the Human is shown for the run's decisions, from each decision's `verdict` / `forced` / `kind` / `confidence`.
 * Returns { ask, askMore, accepted, followUps, noise, none, collapsed, line }: `ask` is at most `maxAsk` items in this
 * order — forced `type`, forced `keyword`, the agent's own asks by confidence (high first), forced `confidence`, then
 * id — and `askMore` is the rest. In `filter` mode a non-ask item whose kind has at least `minGraded` graded rows and
 * at least `minAgreement` agreement goes to `collapsed` (never an ask, never `none`); in `shadow` and `off` nothing is
 * collapsed, and in `off` every item is `none`.
 */
export function triageView({ decisions, mode = 'shadow', stats = null, minAgreement = 0.9, minGraded = 20, maxAsk = 10 }) {
  const items = (Array.isArray(decisions) ? decisions : []).map((d) => ({ ...d, verdict: mode === 'off' || !TRIAGE_VERDICTS.includes(d.verdict) ? 'none' : d.verdict }))
  const rank = (d) => (d.forced === 'type' ? 0 : d.forced === 'keyword' ? 1 : d.forced === 'confidence' ? 3 : 2)
  const asks = items.filter((d) => d.verdict === 'ask').sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? (Number(b.confidence) || 0) - (Number(a.confidence) || 0) : 0) || idNum(a) - idNum(b))
  const calibrated = (d) => {
    if (mode !== 'filter' || !d.kind || d.kind === '-') return false
    const k = stats?.kinds?.[d.kind]
    return !!k && k.graded >= minGraded && k.agreement !== null && k.agreement >= minAgreement
  }
  const rest = (verdict) => items.filter((d) => d.verdict === verdict)
  const collapsed = [...rest('accept'), ...rest('follow-up'), ...rest('noise')].filter(calibrated)
  const shown = (verdict) => rest(verdict).filter((d) => !collapsed.includes(d))
  const all = stats?.all
  const pct = all && all.graded > 0 && all.agreement !== null ? `${Math.round(all.agreement * 100)}%` : 'n/a (first run)'
  const view = { ask: asks.slice(0, maxAsk), askMore: asks.slice(maxAsk), accepted: shown('accept'), followUps: shown('follow-up'), noise: shown('noise'), none: rest('none'), collapsed }
  return { ...view, line: `triage: ${mode} · agreement (last ${all?.last ?? 50}): ${pct} · collapsed: ${collapsed.length} · ask: ${asks.length} · follow-ups: ${rest('follow-up').length}` }
}

/**
 * The decisions the run's command shows the Human for grading: this launch's, and every earlier launch's that has no
 * grade row for this run yet (a launch that stopped before the Human graded, or never reached its report). Without the
 * second part a relaunch printed `ask: 0` while status.json held the ungraded decisions of the launch before.
 */
export function decisionsInView(decisions, { attempt = 1, run = '', gradeRows = [] } = {}) {
  const graded = new Set((Array.isArray(gradeRows) ? gradeRows : []).filter((g) => g && g.run === run).map((g) => String(g.id)))
  return (Array.isArray(decisions) ? decisions : []).filter((d) => {
    const a = d.attempt ?? 1
    return a === attempt || (a < attempt && !graded.has(String(d.id)))
  })
}

/**
 * A plan file both sides changed, merged for a rerun: `theirs` (the run branch's text — a later Planner, readiness or
 * plan-close edit) is the base; every Atomic Sub-task id ticked `[x]` in `ours` (the plan branch: the builder's work) is
 * ticked in it, and the `## Execution Notes` lines of `ours` it lacks are added at the end of that section. Pure.
 */
export function mergePlanFile({ ours, theirs }) {
  const nl = /\r\n/.test(String(theirs)) ? '\r\n' : '\n'
  const mine = String(ours ?? '').split(/\r?\n/)
  const out = String(theirs ?? '').split(/\r?\n/)
  // A sub-task id: A1, B2a, R1.1.
  const ticked = new Set(mine.map((l) => /^\s*- \[[xX]\] ([A-Z]+\d+(?:\.\d+)*[a-z]?):/.exec(l)?.[1]).filter(Boolean))
  for (let i = 0; i < out.length; i++) {
    const m = /^(\s*- )\[ \]( ([A-Z]+\d+(?:\.\d+)*[a-z]?):.*)$/.exec(out[i])
    if (m && ticked.has(m[3])) out[i] = `${m[1]}[x]${m[2]}`
  }
  const section = (lines) => {
    const a = lines.findIndex((l) => /^## Execution Notes\b/.test(l))
    if (a < 0) return null
    const b = lines.findIndex((l, i) => i > a && /^## /.test(l))
    return { a, b: b < 0 ? lines.length : b }
  }
  const os = section(mine)
  if (!os) return out.join(nl)
  const ts = section(out)
  const have = new Set(ts ? out.slice(ts.a + 1, ts.b).map((l) => l.trim()) : [])
  const add = mine.slice(os.a + 1, os.b).filter((l) => l.trim() && !have.has(l.trim()))
  if (!add.length) return out.join(nl)
  if (!ts) {
    const end = out.length && out[out.length - 1] === '' ? out.length - 1 : out.length
    out.splice(end, 0, '', '## Execution Notes', ...add)
    return out.join(nl)
  }
  let last = ts.b - 1
  while (last > ts.a && !out[last].trim()) last--
  out.splice(last + 1, 0, ...add)
  return out.join(nl)
}

const short = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s))
function decisionsSection(decisions, triage) {
  const list = Array.isArray(decisions) ? decisions : []
  if (!list.length) return ['## Decisions', '', '- none', '']
  const view = triageView({ decisions: list, ...triage })
  const full = (d) => {
    const out = [`- ${d.id} · ${d.plan} · ${d.verdict}${d.forced ? ` (rule: ${d.forced})` : ''}${d.kind && d.kind !== '-' ? ` · ${d.kind}` : ''} · ${d.text}`]
    if (d.rec) out.push(`  recommend: ${d.rec}${d.why ? ` — why: ${d.why}` : ''}`)
    else if (d.why) out.push(`  why: ${d.why}`)
    for (const a of d.alsoFrom ?? []) out.push(`  also: ${a.text} (${a.role ?? 'agent'}, round ${a.round ?? 0})`)
    return out
  }
  const lines = (d) => (view.collapsed.includes(d) ? [`- ${d.id} · ${d.plan} · ${d.verdict} · ${d.kind} · ${short(d.text, 100)} (collapsed: the kind agrees with the Human)`] : full(d))
  const block = (title, items, fn = lines) => (items.length ? [`### ${title}`, '', ...items.flatMap(fn), ''] : [])
  const byId = (a, b) => idNum(a) - idNum(b)
  const inFilter = (verdict) => [...view[verdict === 'accept' ? 'accepted' : verdict === 'follow-up' ? 'followUps' : 'noise'], ...view.collapsed.filter((d) => d.verdict === verdict)].sort(byId)
  return [
    '## Decisions', '', view.line, '',
    ...block('To grade', [...view.ask, ...view.askMore], full),
    ...block('Accepted by triage', inFilter('accept')),
    ...block('Follow-ups', inFilter('follow-up')),
    ...block('Noise', inFilter('noise')),
    ...block('Not triaged', view.none, full),
  ]
}

// The `removes:` decisions of the merged plans, in id order: a card each at the top of the Human's list. They come from the
// decision records (one store); a removal that triage filed as a repeat of another decision (`noise`) is not shown twice.
function removalsOf(decisions, mergedSet) {
  return (Array.isArray(decisions) ? decisions : [])
    .filter((d) => decisionType(d.text) === 'removes' && mergedSet.has(d.plan) && !/^duplicate of /.test(String(d.why ?? '')))
    .sort((a, b) => idNum(a) - idNum(b))
}

/** The report's "Builder tier" cell: every tier a builder of the plan ran on, in order (older status.json: the last one). */
export function builderTiers(p) {
  const tiers = Array.isArray(p?.tiers) && p.tiers.length ? p.tiers : p?.tier ? [p.tier] : []
  return tiers.map((t) => String(t).replace(/\|/g, '/')).join(' → ')
}

// ---- the lines of a failing check's output worth reading (the final gate's stop reason and report, a hand-off) ----
const NOISE_RE = /ELIFECYCLE|ERR_PNPM|npm ERR!|^npm error\b|Command failed with exit code/i
// a totals line: Karma TOTAL / Executed n of m (k FAILED), jest/vitest Tests:/Test Files, node:test ℹ fail / TAP # fail, mocha n failing
const TOTALS_RE = /^TOTAL:|\bExecuted \d+ of \d+\b.*\bFAILED\b|^(?:Tests?|Test Files|Test Suites):?\s.*\bfail|^(?:ℹ|#) fail\b|^\d+ failing\b/i
// a failing test or error: Karma/Jasmine FAILED, node:test not ok / ✖, jest/vitest FAIL / ●, mocha 1) name, Error:
const NAME_RE = /\bFAILED\b|^not ok\b|^✖|^FAIL\b|^●|^\d+\) \S|\bError:/
const SKIP_RE = /^✖ failing tests:?$|^● Console\b/
/** No plan of the run changed a file the final gate's output names: the failure may be this machine, not the plans. */
export const NO_PLAN_FILE_NOTE = "no plan in this run changed the failing files — may be this machine (try the same command on the run's base commit)"
/**
 * The lines of a failing check's output worth reading: the last totals line first, then up to `max` failing test names
 * or errors (Karma/Jasmine, node:test, jest/vitest, mocha). No such line: the last `last` lines that are not empty.
 */
export function failingLines(tail, { max = 5, last = 3 } = {}) {
  const lines = String(tail ?? '').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').split(/\r?\n/).map((l) => l.trim().slice(0, 200)).filter(Boolean)
  const totals = lines.filter((l) => !NOISE_RE.test(l) && TOTALS_RE.test(l))
  const names = [...new Set(lines.filter((l) => !NOISE_RE.test(l) && !SKIP_RE.test(l) && !TOTALS_RE.test(l) && NAME_RE.test(l)))].slice(0, max)
  const picked = [...totals.slice(-1), ...names]
  return picked.length ? picked : lines.slice(-last)
}

export function formatReport({ status, merged, mainShaNow, finishedAt, runBranch, mainBranch, mainChangedFiles = null, appErrors = null, decisions = null, triage = {}, learning = null }) {
  const plans = Object.values(status.plans ?? {}).sort((a, b) => (a.nnn < b.nnn ? -1 : 1))
  const mergedSet = new Map(merged.map((m) => [m.nnn, m]))
  const parked = plans.filter((p) => !mergedSet.has(p.nnn) && ['parked', 'left-run', 'skipped'].includes(p.state))
  const { untouched, adminFiles } = mainUntouched(status.mainShaAtStart, mainShaNow, mainChangedFiles)
  const adminNote = untouched && adminFiles ? ` (${adminFiles} plan/todo file(s) changed on ${mainBranch})` : ''
  const lines = [
    `# Orchestrator run ${status.run}`,
    '',
    `Run branch: \`${runBranch}\` (from \`origin/${mainBranch}\` at ${String(status.mainShaAtStart ?? '').slice(0, 7)}) · started ${status.startedAt ?? '?'} · finished ${finishedAt}`,
    `Result: ${merged.length} merged, ${parked.length} parked, skipped or left out, ${plans.length} in the run (counted from git and status.json).`,
    `\`${mainBranch}\` untouched: ${untouched ? 'yes' : 'NO'}${adminNote} — origin/${mainBranch} is ${String(mainShaNow).slice(0, 7)}.`,
    status.stopReason ? `Stopped: ${status.stopReason}` : '',
    // Every stop of every attempt (orch-state.mjs stop appends to stops[]): a later attempt never hides an earlier cause.
    ...(Array.isArray(status.stops) && status.stops.length ? ['', '## Stops', '', ...status.stops.map((st) => `- attempt ${st.attempt ?? '?'} · ${st.at ?? '?'} · ${st.reason}`), ''] : []),
    status.finalGate ? `Final gate: ${status.finalGate.ok ? 'ok' : `failed${status.finalGate.command ? `: ${status.finalGate.command}` : ''}`} (attempt ${status.finalGate.attempt ?? 1})` : '',
    status.finalGate && !status.finalGate.ok && status.finalGate.failing?.length ? `Failing: ${status.finalGate.failing.join(' / ')}` : '',
    status.finalGate && !status.finalGate.ok && status.finalGate.noPlanFile ? `Final gate note: ${NO_PLAN_FILE_NOTE}` : '',
    '',
    '## Plans',
    '',
    '| Plan | State | Rounds | Builder tier | Merge | Why |',
    '| --- | --- | --- | --- | --- | --- |',
    ...plans.map((p) => {
      const m = mergedSet.get(p.nnn)
      const state = m ? 'merged' : p.state
      return `| ${p.nnn} ${p.title ?? ''} | ${state} | ${p.round ?? 0} | ${builderTiers(p)} | ${m ? m.sha.slice(0, 7) : ''} | ${(p.reason ?? '').replace(/\|/g, '/')} |`
    }),
    '',
    ...flakySection(status, plans),
    ...appErrorsSection(appErrors),
    ...decisionsSection(decisions ?? status.decisions, triage),
    '## Run notes',
    '',
    ...((status.notes ?? []).length ? status.notes.map((n) => `- ${n.plan ? `${n.plan}: ` : ''}${n.text}`) : ['- none']),
    '',
    '## Models per agent',
    '',
    ...plans.flatMap((p) => Object.entries(p.models ?? {}).map(([role, v]) => `- ${p.nnn} ${role}: ${v.model}${v.effort ? ` / ${v.effort}` : ''}`)),
    '',
    '## What only the Human can do',
    '',
    ...validationList(plans.filter((p) => mergedSet.has(p.nnn)), removalsOf(decisions ?? status.decisions, mergedSet)),
    ...parked.map((p) => `- Decide on ${p.nnn}: ${p.reason ?? p.state}`),
    `- Review and merge the run branch (PowerShell, one line each):`,
    '',
    '```powershell',
    `git fetch origin`,
    `gh pr create --base ${mainBranch} --head ${runBranch} --title "Orchestrator run ${status.run}" --body-file .claude\\orchestrator-runs\\${status.run}.md`,
    '```',
    '',
    // What the run taught the next one : the character budget, then the trend line — always the last line.
    ...(learning?.budget ? [learning.budget, ''] : []),
    ...(learning?.trend ? [learning.trend, ''] : []),
  ]
  return lines.filter((l, i) => !(l === '' && lines[i - 1] === '')).join('\n')
}

// ---- lessons, run log and trend  ------------------------------------------------------------------------------
// Everything here is derived from status.json and the Human's graded replies by code: no model call.

/** The lesson roles of the orchestrator (docs/brain/agent-lessons/<role>.md); `planner` is read by /plan, not injected. */
export const INJECTED_ROLES = ['readiness', 'builder', 'gate', 'check-plan', 'check-bugs', 'check-rules', 'security', 'verify', 'ui']
const FINDER_ROLES = ['check-plan', 'check-bugs', 'check-rules', 'security']
/** What kind of command failed the final gate: test, lint, build, manifest, or none (a ciMirror command and anything unknown). */
export function finalGateKind(command) {
  const c = String(command ?? '').trim()
  if (/^node scripts\/kit-manifest-check\.mjs\b/.test(c)) return 'manifest'
  const m = /^(?:npm|pnpm|yarn) (?:run )?([\w:-]+)/.exec(c)
  const name = m ? m[1] : /^node --test\b/.test(c) ? 'test' : ''
  return /^test(?::|$)/.test(name) ? 'test' : /^lint(?::|$)/.test(name) ? 'lint' : /^build(?::|$)/.test(name) ? 'build' : 'none'
}
/**
 * The roles that could have caught a final-gate failure, by the kind of the failing command. `security` never receives one.
 * A finder that did not run on the blamed plan gets nothing.
 */
export const FINAL_GATE_ROLES = { test: ['check-bugs', 'check-plan'], lint: ['check-rules'], build: ['check-bugs'], manifest: ['readiness'], ciMirror: [], none: [] }
/** The `agent-rules.md` section each role reads (the builder reads its own file). */
export const RULES_GROUP = { readiness: 'readiness', ui: 'ui', 'check-plan': 'checkers', 'check-bugs': 'checkers', 'check-rules': 'checkers', verify: 'checkers' }

/** What kind of reason parked a plan: environment, agent-call-limit, same-reason-twice, fix-rounds, plan-info, error, not-started, other. */
export function reasonKind(reason) {
  const r = String(reason ?? '').trim()
  if (/^(environment|UI environment blocked|worktree)/i.test(r)) return 'environment'
  if (/^agent-call limit/i.test(r)) return 'agent-call-limit'
  if (/^same reason twice/i.test(r)) return 'same-reason-twice'
  if (/\(fix rounds used/i.test(r)) return 'fix-rounds'
  if (/^plan-info/i.test(r)) return 'plan-info'
  if (/^the plan pipeline stopped/i.test(r)) return 'error'
  if (/^not started|^pilot/i.test(r)) return 'not-started'
  return 'other'
}

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s))

// Lesson lines are built from fixed templates and enumerated values (a rule name, a file kind, a count, a command of an
// allowed shape). Free text that a model or the repo produced (a finding's reasoning, a question, a card title, a park
// reason, a tail) is never copied into a line the next run's agents read: a lesson is data, not an instruction.
/** A rule name as a short tag: only letters, digits and `. : / _ -`, 40 characters at most; anything else is dropped. */
export function ruleTag(s) {
  const t = String(s ?? '').replace(/[^A-Za-z0-9 ._:/-]/g, ' ').replace(/\s+/g, ' ').trim()
  // a category of up to three words, optionally `: ` and up to four more — a rule name, never a sentence
  return t.length <= 40 && /^[\w./-]+(?: [\w./-]+){0,2}(?:: [\w./-]+(?: [\w./-]+){0,3})?$/.test(t) ? t : 'other rule'
}
/** A check command of an allowed shape (`npm run <script>`, `node tools|scripts/<file> <safe args>`), else a generic name. */
export function commandTag(s) {
  const c = String(s ?? '').trim()
  return /^(?:npm|pnpm) run [\w:-]{1,40}$/.test(c) || /^node (?:tools|scripts)\/[\w./-]{1,60}(?: [\w./=:,@+-]{1,40}){0,3}$/.test(c) ? c : 'a check command'
}
const stepTag = (s) => (/^round \d{1,2}$/.test(String(s ?? '').trim()) ? String(s).trim() : 'a step')

// The stored cause of a fix round (plans[N].causeFacts, written by orch-state.mjs from facts the code produced: the failing
// command, a finding id, a path of the branch diff, an INV-n id of docs/brain/invariants.md) as lesson lines for the builder.
// No stored fact, no line: a cause that names nothing the reader could look at is not written.
// Only the shapes the code itself makes reach a lesson line, so an agent-written id or path cannot carry words to the
// next builder. Ids: gate-N, scope-N, ui-N, merge-N (the run makes them) and <role>-N for a finder role
// (check-plan-N, check-bugs-N, check-rules-N, security-N; the RULES_GROUP roles too). Paths: at most six segments of at
// most 40 characters each, no `.` or `..` segment (six keeps most app paths, e.g. src/app/pages/x/x.component.ts).
const ID_ROLES = [...new Set(['gate', 'scope', 'ui', 'merge', 'security', ...Object.keys(RULES_GROUP)])]
const SAFE_ID = new RegExp(`^(?:${ID_ROLES.map((r) => r.replace(/[-]/g, '\\-')).join('|')})-\\d{1,3}$`)
const SAFE_PATH = { test: (p) => {
  const parts = String(p).split('/')
  return parts.length <= 6 && parts.every((s) => /^[\w@.+-]{1,40}$/.test(s) && s !== '.' && s !== '..')
} }
export const safeLessonId = (id) => SAFE_ID.test(String(id ?? ''))
export const safeLessonPath = (p) => SAFE_PATH.test(String(p ?? ''))
function causeLessons(cause, fact) {
  const m = /^round \d+:\s*(.*)$/.exec(String(cause))
  const why = (m ? m[1] : String(cause)).trim()
  if (/^checker:/.test(why)) {
    const items = (fact?.findings ?? []).filter((f) => SAFE_ID.test(String(f?.id ?? ''))).map((f) =>
      `fix round caused by: finding ${f.id}${/^INV-\d+$/.test(String(f.inv ?? '')) ? ` (rule ${f.inv})` : ''}${SAFE_PATH.test(String(f.file ?? '')) ? ` in ${f.file}` : ''}`)
    return [...new Set(items)]
  }
  if (/^gate/.test(why)) {
    const cmd = fact?.cmd ?? why.replace(/^gate[^:]*:\s*/, '').split(', ')[0]
    const kind = finalGateKind(cmd) !== 'none' ? finalGateKind(cmd) : commandTag(cmd) !== 'a check command' ? commandTag(cmd) : null
    return kind ? [`fix round caused by: ${kind} failed${SAFE_PATH.test(String(fact?.file ?? '')) ? ` at ${fact.file}` : ''}`] : []
  }
  if (/^ui/.test(why)) return ['fix round caused by: a [ui] card failed']
  if (/^merge/.test(why)) return ['fix round caused by: the merge into the run branch']
  return []
}
// A miss is one enumerated kind (a [ui] card); anything else names nothing and gives no line. A gate event is one of two
// kinds with a command of an allowed shape.
const missTag = (s) => (/^ui:/.test(String(s)) ? 'a [ui] card failed after the checkers passed' : null)
const gateEventTag = (s) => {
  const m = /^(timed out|env-fail rerun):\s*(.*)$/.exec(String(s))
  return m && commandTag(m[2]) !== 'a check command' ? `${m[1]}: ${commandTag(m[2])}` : null
}
// The code-written start (or fixed ending) of a park reason: the literals of the run's `park()` calls. The model or check
// text after it is never read; a reason that matches none gives no line.
const PARK_LABELS = [[/^same reason twice/, 'same reason twice'], [/^agent-call limit/, 'agent-call limit'], [/^no progress/, 'no progress'], [/^replan needed/, 'replan needed'],
  [/^hand-off file/, 'hand-off file'], [/^worktree/, 'worktree'], [/^UI environment blocked/, 'UI environment blocked'], [/^environment/, 'environment'],
  [/\(fix rounds used: \d+ of \d+\) — needs the Human$/, 'needs the Human']]
export const parkLabel = (reason) => PARK_LABELS.find(([re]) => re.test(String(reason ?? '').trim()))?.[1] ?? null

/**
 * The lesson lines a run's status.json gives, one per fact: [{ role, text, has? }]. `role` is a lesson role
 * (docs/brain/agent-lessons/<role>.md); `has` (a RegExp) is the dedupe key when the text carries counts. Facts:
 * fix-round causes, escalations and parked plans (builder); candidates the verifier refuted and misses the final gate or
 * a UI card found after clean checkers (every finder that ran on the plan); low-confidence keeps that later mattered and
 * refuted problems that came back (verify); plans parked on the environment after readiness called them ready
 * (readiness); gate timeouts and re-run env-fails (gate); cards that failed after they had passed (ui); questions
 * readiness had to ask and cards that drifted from the app (planner).
 */
export function lessonFacts(status) {
  const out = []
  const add = (role, text, has) => out.push({ role, text, ...(has ? { has } : {}) })
  const plans = Object.values(status?.plans ?? {}).sort((a, b) => (String(a.nnn) < String(b.nnn) ? -1 : 1))
  for (const p of plans) {
    for (const c of p.roundCauses ?? []) {
      const round = Number(/^round (\d+)/.exec(String(c))?.[1])
      for (const t of causeLessons(c, (p.causeFacts ?? []).find((f) => f.round === round))) add('builder', t)
    }
    for (const e of p.escalations ?? []) if (stepTag(e.step) !== 'a step' && commandTag(e.check) !== 'a check command') add('builder', `escalated to the judgment tier at ${stepTag(e.step)}: ${commandTag(e.check)}`)
    if (['parked', 'left-run'].includes(p.state) && parkLabel(p.reason)) add('builder', `parked: ${parkLabel(p.reason)}`)
    if (p.ready === true && p.state === 'parked' && reasonKind(p.reason) === 'environment') add('readiness', 'parked on environment after ready')
    for (const [role, v] of Object.entries(p.verify?.byRole ?? {})) {
      const rules = (v.rules ?? []).filter(Boolean).map(ruleTag).filter((r) => r !== 'other rule')
      if (FINDER_ROLES.includes(role) && v.refuted > 0 && rules.length) add(role, `${v.refuted} of ${v.candidates} candidates refuted: ${rules.join(', ')}`, new RegExp(`^\\d+ of \\d+ candidates refuted: ${esc(rules.join(', '))}$`))
    }
    const ran = FINDER_ROLES.filter((r) => Object.keys(p.models ?? {}).includes(`orch-${r}`))
    // A final-gate failure is a miss of the roles its command kind names, never of every finder: the stored result
    // (status.finalGate: the failing command and the blamed plans) decides, a legacy `final gate failed: <cmd>` miss only
    // when no result is stored, and nothing at all once the gate has passed.
    const fg = status?.finalGate
    const legacy = (p.misses ?? []).filter((m) => /^final gate/.test(String(m))).map((m) => String(m).replace(/^final gate (?:failed|could not run):?\s*/, ''))
    const gateCmds = fg ? (fg.ok === false && (fg.blamed ?? []).map(String).includes(String(p.nnn)) ? [fg.command] : []) : legacy
    if (gateCmds.length) {
      const kind = finalGateKind(gateCmds[0])
      const file = fg && SAFE_PATH.test(String(fg.file ?? '')) ? fg.file : ''
      const detail = kind === 'none' ? '' : ` (${kind}${file ? `: ${file}` : ''})`
      for (const r of FINAL_GATE_ROLES[kind] ?? []) if (r === 'readiness' || ran.includes(r)) add(r, `missed: the final gate failed${detail}`)
    }
    for (const what of [...new Set((p.misses ?? []).filter((m) => !/^final gate/.test(String(m))).map(missTag).filter(Boolean))]) for (const r of ran) add(r, `missed: ${what}`)
    const lateLow = (p.verify?.lateLow ?? []).map(ruleTag).filter((r) => r !== 'other rule')
    if (lateLow.length) add('verify', `kept with a confidence below the keep threshold, then caused a fix round: ${lateLow.join(', ')}`)
    const reappeared = (p.verify?.reappeared ?? []).map(ruleTag).filter((r) => r !== 'other rule')
    if (reappeared.length) add('verify', `refuted, but the problem reappeared in a later round: ${reappeared.join(', ')}`)
    for (const ev of p.gateEvents ?? []) {
      const t = gateEventTag(ev)
      if (t) add('gate', t)
    }
    if ((p.uiCards ?? []).some((c) => c.regressed)) add('ui', 'a [ui] card failed after it had passed')
    // No asked-about line: the readiness question is the agent's text and the code has no kind for it.
    if ((p.uiCards ?? []).some((c) => c.status === 'plan-drift')) add('planner', `plan ${p.nnn} drifted from its [ui] card`)
  }
  return out
}

// ---- the run log (docs/brain/run-log.md) -----------------------------------------------------------------------------------
export const RUN_LOG_COLUMNS = ['Date', 'Run', 'Plans', 'Merged', 'Parked', 'Parked reasons', 'Fix rounds', 'Escalations', 'Gate fails', 'Final gate', '✗', 'Checker misses', '✗ per plan']
export const RUN_LOG_KEEP = 20
const ROW_KEYS = ['date', 'run', 'plans', 'merged', 'parked', 'reasons', 'fixRounds', 'escalations', 'gateFails', 'finalGate', 'x', 'misses', 'perPlan']
export const RUN_LOG_INTRO = [
  '# Run log', '',
  'One row per orchestrator run, written by `node scripts/orch-state.mjs finish` from the run\'s `status.json` — never by hand. The `✗` columns of a run are filled by the next `finish`, from `decision-log.md`; the newest run\'s stay `-` until then. The table keeps the 20 newest rows; older ones are rolled into one `Earlier (N runs): …` line above it.',
]

const planList = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter((x) => /^\d+$/.test(x)).map(Number)
const num = (s) => (/^-?\d+(\.\d+)?$/.test(String(s).trim()) ? Number(s) : null)
const rate = (n, d) => (d > 0 ? Number((n / d).toFixed(2)) : null)

/** One run-log row from status.json: counts only, the `✗` columns are `-` until a later `finish` fills them. */
export function runLogRow({ status, merged = [], finalGate = 'none', date }) {
  const plans = Object.values(status?.plans ?? {})
  const mergedSet = new Set(merged.map((m) => String(m.nnn)))
  const parked = plans.filter((p) => !mergedSet.has(String(p.nnn)) && ['parked', 'left-run'].includes(p.state))
  const kinds = [...new Set(parked.map((p) => reasonKind(p.reason)))]
  const sum = (f) => plans.reduce((a, p) => a + f(p), 0)
  return {
    date, run: status.run, plans: plans.map((p) => String(p.nnn)).sort().join(','), merged: String(mergedSet.size), parked: String(parked.length), reasons: kinds.join(',') || '-',
    fixRounds: String(sum((p) => p.round ?? 0)), escalations: String(sum((p) => (p.escalations ?? []).length)),
    gateFails: String(sum((p) => (p.roundCauses ?? []).filter((c) => /^round \d+:\s*gate/.test(c)).length)),
    finalGate: ((g) => (g === 'ok' || g === 'failed' ? g : '-'))(status?.finalGate ? (status.finalGate.ok ? 'ok' : 'failed') : finalGate), x: '-', misses: '-', perPlan: '-',
  }
}

/**
 * { pre: the lines above the table (the `Earlier` line excluded), earlier: that line or null, rows } from a run-log.md text.
 * The run log merges with `merge=union` (.gitattributes), which can leave two `Earlier` lines and two copies of a row both
 * sides rewrote: the `Earlier` line with the most runs wins, and a run keeps one row (at its first place, the copy with the
 * most columns filled).
 */
export function parseRunLog(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n')
  const head = lines.findIndex((l) => /^\|\s*Date\s*\|/.test(l))
  const above = head < 0 ? lines : lines.slice(0, head)
  const earliers = above.filter((l) => /^Earlier \(\d+ runs?\):/.test(l))
  const runsIn = (l) => Number(/^Earlier \((\d+)/.exec(l)[1])
  const earlier = earliers.reduce((best, l) => (best === null || runsIn(l) > runsIn(best) ? l : best), null)
  const all = (head < 0 ? [] : lines.slice(head + 2)).filter((l) => /^\|/.test(l)).map((l) => l.split('|').slice(1, -1).map((c) => c.trim())).filter((c) => c.length >= ROW_KEYS.length)
    .map((c) => Object.fromEntries(ROW_KEYS.map((k, i) => [k, c[i]])))
  const filled = (r) => ROW_KEYS.filter((k) => r[k] && r[k] !== '-').length
  const rows = []
  const at = new Map()
  for (const r of all) {
    if (!at.has(r.run)) at.set(r.run, rows.push(r) - 1)
    else if (filled(r) > filled(rows[at.get(r.run)])) rows[at.get(r.run)] = r
  }
  return { pre: above.filter((l) => !earliers.includes(l)), earlier, rows }
}

const SUM_LABELS = [['plans', 'plans'], ['merged', 'merged'], ['parked', 'parked'], ['fixRounds', 'fix rounds'], ['escalations', 'escalations'], ['gateFails', 'gate fails'], ['x', '✗'], ['misses', 'checker misses']]
function earlierTotals(line) {
  const t = { runs: 0, plans: 0, merged: 0, parked: 0, fixRounds: 0, escalations: 0, gateFails: 0, x: 0, misses: 0 }
  if (!line) return t
  t.runs = Number(/^Earlier \((\d+) runs?\)/.exec(line)?.[1] ?? 0)
  const totals = line.split(' — ')[0]
  for (const [k, label] of SUM_LABELS) t[k] = Number(new RegExp(`(?:^|· |: )${esc(label)} (\\d+)`).exec(totals)?.[1] ?? 0)
  return t
}

/** The `Earlier (N runs): …` line after folding `rolled` rows into the totals of the previous line (null with nothing to say). */
export function earlierLine(previous, rolled) {
  const t = earlierTotals(previous)
  for (const r of rolled) {
    t.runs += 1
    t.plans += planList(r.plans).length
    for (const k of ['merged', 'parked', 'fixRounds', 'escalations', 'gateFails', 'x', 'misses']) t[k] += num(r[k]) ?? 0
  }
  if (!t.runs) return null
  const avg = (v) => Number((v / t.runs).toFixed(2))
  return `Earlier (${t.runs} runs): ${SUM_LABELS.map(([k, label]) => `${label} ${t[k]}`).join(' · ')} — per run: plans ${avg(t.plans)} · parked ${avg(t.parked)} · fix rounds ${avg(t.fixRounds)} · ✗ per plan ${t.plans ? Number((t.x / t.plans).toFixed(2)) : '-'}`
}

/** A decision-log.md table as rows { date, plan, miss }. */
export function parseDecisionRows(text) {
  return String(text ?? '').split(/\r?\n/).filter((l) => /^\|/.test(l) && !/^\|\s*(Date|-)/.test(l)).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
    .filter((c) => c.length >= 7 && c[3] === '✗').map((c) => ({ date: c[0], plan: c[1], miss: c[6] }))
}

/**
 * Fills the `✗`, `Checker misses` and `✗ per plan` columns of every row except `keep` (the run just logged) from the
 * decision log: a log row belongs to the latest run row, dated no later than the log row, whose plan list holds its plan.
 */
export function fillGrades(rows, decisionRows, { keep = null } = {}) {
  const owner = new Map()
  for (const d of decisionRows) {
    const n = Number(String(d.plan).replace(/\D/g, ''))
    let best = -1
    rows.forEach((r, i) => {
      if (r.run !== keep && planList(r.plans).includes(n) && String(r.date) <= String(d.date) && (best < 0 || String(r.date) >= String(rows[best].date))) best = i
    })
    if (best >= 0) owner.set(d, best)
  }
  return rows.map((r, i) => {
    if (r.run === keep) return r
    const mine = decisionRows.filter((d) => owner.get(d) === i)
    const n = planList(r.plans).length
    return { ...r, x: String(mine.length), misses: String(mine.filter((d) => d.miss === 'yes').length), perPlan: n ? String(rate(mine.length, n)) : '-' }
  })
}

/** The run-log text after adding `row` (a run logged twice is replaced), filling earlier rows' grades and rolling past 20 rows. */
export function updateRunLog(text, row, decisionRows) {
  const { pre, earlier, rows } = parseRunLog(text)
  const next = [...rows.filter((r) => r.run !== row.run), row]
  const filled = fillGrades(next, decisionRows, { keep: row.run })
  const rolled = filled.slice(0, Math.max(0, filled.length - RUN_LOG_KEEP))
  const kept = filled.slice(rolled.length)
  const earlierText = earlierLine(earlier, rolled)
  const intro = pre.some((l) => l.trim()) ? pre.join('\n').replace(/\s+$/, '') : RUN_LOG_INTRO.join('\n')
  return `${[intro, '', ...(earlierText ? [earlierText, ''] : []), `| ${RUN_LOG_COLUMNS.join(' | ')} |`, `| ${RUN_LOG_COLUMNS.map(() => '---').join(' | ')} |`, ...kept.map((r) => `| ${ROW_KEYS.map((k) => String(r[k] ?? '-').replace(/\|/g, '/')).join(' | ')} |`)].join('\n')}\n`
}

/**
 * The trend of the last `last` rows: per run the `✗` per plan, fix rounds per plan and parked count, and the one line the
 * report ends with. Fewer than two rows: `Trend: first logged run`.
 */
export function trendOf(rows, { last = 3 } = {}) {
  const points = rows.map((r) => ({ run: r.run, x: num(r.perPlan), fix: rate(num(r.fixRounds) ?? 0, planList(r.plans).length), parked: num(r.parked) ?? 0 }))
  if (points.length < 2) return { points, line: 'Trend: first logged run' }
  const tail = points.slice(-last)
  const show = (f, fmt = (v) => v) => tail.map((p) => (f(p) === null || f(p) === undefined ? '-' : fmt(f(p)))).join(' → ')
  return { points, line: `Trend (last ${tail.length} runs): ✗ per plan ${show((p) => p.x)} · fix rounds per plan ${show((p) => p.fix)} · parked ${show((p) => p.parked)}` }
}

// ---- what the next run injects (the character budget) ------------------------------------------------------------------
/** "3.1k" for 3100, "820" for 820. */
export const kChars = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

/**
 * The blocks the next run injects — LESSONS per role, RULES per group, RECENT_RUNS — with their size in characters (the JSON
 * array as the task shows it) and the total. `roles` counts the roles that receive at least one non-empty block.
 */
export function contextBudget({ lessons = {}, rules = {}, recent = [] }) {
  const blocks = []
  const roles = new Set()
  for (const [role, lines] of Object.entries(lessons)) if (INJECTED_ROLES.includes(role) && lines.length) {
    blocks.push({ name: `LESSONS ${role}`, chars: JSON.stringify(lines).length })
    roles.add(role)
  }
  for (const [group, lines] of Object.entries(rules)) if (lines.length) {
    blocks.push({ name: `RULES ${group}`, chars: JSON.stringify(lines).length })
    for (const [role, g] of Object.entries(RULES_GROUP)) if (g === group) roles.add(role)
  }
  if (recent.length) {
    blocks.push({ name: 'RECENT_RUNS readiness', chars: JSON.stringify(recent).length })
    roles.add('readiness')
  }
  const total = blocks.reduce((a, b) => a + b.chars, 0)
  return { blocks, total, roles: roles.size, line: `Context added by learning: ${kChars(total)} chars across ${roles.size} roles` }
}
