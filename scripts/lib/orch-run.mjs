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
export const PLAN_STATES = ['queued', 'building', 'gate', 'checking', 'fixing', 'env-paused', 'merging', 'merged', 'parked', 'left-run', 'skipped']

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
 *  URL, each screenshot matches SAFE_SHOT_RE. orchestrate.js applies the same rules before it calls `set`. */
export function uiCardProblem({ card, page, shots } = {}) {
  if (card !== undefined && (typeof card !== 'string' || !card.trim() || /^\s*-/.test(card))) return `card ${JSON.stringify(card)} — a title, not starting with "-"`
  if (page !== undefined && page !== '' && !/^https?:\/\/[^\s"'`$\\<>|;&]+$/.test(String(page))) return `page ${JSON.stringify(page)} — an http(s) URL`
  for (const s of shots ?? []) if (!SAFE_SHOT_RE.test(String(s))) return `screenshot ${JSON.stringify(s)} — a relative path of letters, digits, . _ / -`
  return null
}

/**
 * The tier a plan's first builder starts on: judgment when Architecture Impact names an invariant (other than INV-none)
 * the plan changes or deviates from, or names one without saying which (unreadable). A line that only `preserves` an
 * invariant starts on build: most plans preserve something, and a judgment start for every one of them put the main
 * session's model on plans a build-tier builder handles.
 */
export function startTier(planText) {
  const { entries } = parseArchImpact(String(planText))
  const named = entries.filter((e) => e.id !== 'INV-none' && e.kind !== 'preserves').map((e) => e.id)
  return { tier: named.length ? 'judgment' : 'build', invariants: named }
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
// `authorship` do not match (`auth` alone is a word); `price` does. The workflow carries a mirror copy of this rule.
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

export function formatReport({ status, merged, mainShaNow, finishedAt, runBranch, mainBranch, mainChangedFiles = null, appErrors = null, decisions = null, triage = {} }) {
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
    '',
    '## Plans',
    '',
    '| Plan | State | Rounds | Builder tier | Merge | Why |',
    '| --- | --- | --- | --- | --- | --- |',
    ...plans.map((p) => {
      const m = mergedSet.get(p.nnn)
      const state = m ? 'merged' : p.state
      return `| ${p.nnn} ${p.title ?? ''} | ${state} | ${p.round ?? 0} | ${p.tier ?? ''} | ${m ? m.sha.slice(0, 7) : ''} | ${(p.reason ?? '').replace(/\|/g, '/')} |`
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
  ]
  return lines.filter((l, i) => !(l === '' && lines[i - 1] === '')).join('\n')
}
