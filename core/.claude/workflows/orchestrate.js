export const meta = {
  name: 'orchestrate',
  description: 'Run saved plans unattended into one run branch: readiness, then builder, gate, checkers and merge per plan, wave by wave',
  whenToUse: 'Started by the /orchestrate command only (it passes args: mode, run, plans, root)',
  phases: [
    { title: 'Readiness', detail: 'plan order, one readiness agent per plan, environment preflight' },
    { title: 'Start', detail: 'run branch, merge folder, wave order from git' },
    { title: 'Build', detail: 'per plan: builder, gate, checkers, merge into the run branch; stop after a wave that parked' },
    { title: 'Report', detail: 'report on the run branch and a local copy in the main folder' },
  ],
}

// The orchestrator workflow (docs/agent/orchestrator.md). This script has no file, git or clock access: every file,
// git and time step is a kit script (scripts/orch-state.mjs, scripts/orch-preflight.mjs) run by the mechanical runner
// agent, and git stays the ledger. Role agents are the .claude/agents/orch-*.md files; a model's own pass flag is never
// used: pass is computed here from the verified problem lists.

const MODELS = { build: {{models.build|json}}, judgment: {{models.judgment|json}} }
const MAX_FIX_ROUNDS = {{orchestrator.maxFixRounds|json}}
const RUN_PREFIX = {{orchestrator.runBranchPrefix|json}}
const PILOT_SIZE = {{orchestrator.pilotSize|json}}
// A checking agent gets at most this many items (docs/agent/agent-roles.md rule 10): the UI validator's cards go in batches.
const UI_BATCH = 5
const PM = {{project.packageManager|json}} === 'pnpm' ? 'pnpm' : 'npm'
// How many builders run at once, and how long one gate command may run (minutes) before the gate stops it.
const CONCURRENCY = {{orchestrator.concurrency|json}}
const GATE_TIMEOUT_MIN = {{orchestrator.gateTimeoutMin|json}}
// The gate runs commands.testCi when the project set it (a test command that exits), else commands.test: a watch-mode
// test script prints its totals and never returns.
const TEST_SCRIPT = {{commands.testCi|json}} || {{commands.test|json}}
// A dead agent (agent() returned null: a terminal API error, a blocked model) is retried once on this model;
// "inherit" = no retry. Install and sync refuse a Haiku value: the retry may be a review agent.
const FALLBACK_MODEL = {{orchestrator.fallbackModel|json}}
// Hard limits per plan, so a loop costs minutes and not hours: every run note is an agent call (the runner), and a
// plan that keeps calling agents without reaching a merge is parked. The counters live here (this script has no clock).
const MAX_NOTES = {{orchestrator.maxNotesPerPlan|json}}
const MAX_CALLS = {{orchestrator.maxAgentCallsPerPlan|json}}
const COUNT = { notes: {}, calls: {} }
const PROJECT_CHECKS = [{{commands.build|json}}, {{commands.lint|json}}, TEST_SCRIPT].filter((s) => typeof s === 'string' && s !== '').map((s) => `${PM} run ${s}`)
// The merge step's checks (orchestrator.mergeChecks): "build" = the project build plus the plan's own scope check
// (seconds), lint and tests having passed in the plan's gate and running once more at the final gate on the run branch;
// "full" = the plan's whole check list on every merge (a merge once cost three full test passes per plan).
const MERGE_CHECKS_MODE = {{orchestrator.mergeChecks|json}}
const BUILD_SCRIPT = {{commands.build|json}}
const BUILD_CHECK = typeof BUILD_SCRIPT === 'string' && BUILD_SCRIPT !== '' ? `${PM} run ${BUILD_SCRIPT}` : null
const mergeChecksOf = (checks) => (MERGE_CHECKS_MODE === 'full' ? checks : [...new Set([BUILD_CHECK, ...checks.filter((c) => /scope-check\.mjs/.test(c))].filter(Boolean))])
const FAILING = ['blocker', 'major']
const KEEP_THRESHOLD = 80
const FINDERS = ['orch-check-plan', 'orch-check-bugs', 'orch-check-rules']
// Commands no agent may run (docs/agent/agent-roles.md deny list); a readiness command matching one is dropped. Every
// command a plan or a builder supplies (readiness commands, args.checks, a [ui] card's test) also passes checkProblem.
const DENY = /\brm\s+-[a-z]*[rf]|reset\s+--hard|push\s+(?:[^\n]*\s)?(?:--force|-f\b|--force-with-lease)|git\s+clean|branch\s+-D|stash\s+clear|filter-branch/
// A plan's extra check commands (readiness `commands`, args.checks) are allowlisted, not just deny-listed: `npm run
// <script>` with a script package.json has (plan-info's npmScripts; null before plan-info = shape only), `node tools/…`
// or `node scripts/…` and `node --test <files>`, with safe arguments. Anything else is dropped with the reason.
const SAFE_ARG = /^[A-Za-z0-9_./=:,@+-]+$/
// The kit's own scripts that push, open a pull request, write run/plan/slot state or install files are never a check,
// whatever folder they sit in. A project's own scripts/ and tools/ hold its checks, so this is a deny set, not a list.
const NOT_A_CHECK = new Set([
  'kit-feedback', 'orch-state', 'decision-log', 'take-plan', 'slot-serve', 'slot-stop', 'todo-query',
  'todo-archive', 'plan-close', 'free-merged-slots', 'orphan-sweep', 'local-excludes', 'brain-capture-comment', 'sync', 'install', 'kit-sync',
])
function checkProblem(cmd, scripts) {
  const c = String(cmd ?? '').trim()
  if (DENY.test(c)) return `${c}: on the deny list`
  const npm = /^(?:npm|pnpm) run ([A-Za-z0-9:_-]+)$/.exec(c)
  if (npm) return scripts && !scripts.includes(npm[1]) ? `${c}: no script ${npm[1]} in package.json` : null
  const w = c.split(/ +/)
  const safe = (ws) => ws.every((x) => SAFE_ARG.test(x) && !x.includes('..'))
  if (w[0] === 'node' && /^(tools|scripts)\/[A-Za-z0-9_./-]+\.m?js$/.test(w[1] ?? '') && safe(w.slice(1))) {
    const name = w[1].split('/').pop().toLowerCase().replace(/\.m?js$/, '') // case-folded: Windows/macOS files match any case
    if (NOT_A_CHECK.has(name)) return `${c}: ${name} changes state or pushes, it is not a check`
    // A script run with a flag that makes it write (kit-owned --write, sync --apply, a linter's --fix) is not a check.
    const writes = w.slice(2).find((x) => /^--(write|apply|fix|update)(=.*)?$/.test(x))
    return writes ? `${c}: ${writes.split('=')[0]} writes files, it is not a check` : null
  }
  if (w[0] === 'node' && w[1] === '--test' && safe(w.slice(2)) && w.slice(2).every((x) => !x.startsWith('-') || /^--test-[a-z-]+(=[\w.,-]+)?$/.test(x))) return null
  return `${c}: not an allowed check (${PM} run <package.json script>, node tools/… or scripts/…, node --test <files>)`
}
// The project files a check command names: `node tools/x.mjs …` / `node scripts/x.mjs …` → that file, `node --test a b`
// → a and b. `npm run <script>` names no file here (package.json scripts are checked against package.json).
function checkFilesOf(cmd) {
  const w = String(cmd ?? '').trim().split(/ +/)
  if (w[0] !== 'node') return []
  if (w[1] === '--test') return w.slice(2).filter((x) => !x.startsWith('-') && SAFE_ARG.test(x) && !x.includes('..'))
  return /^(tools|scripts)\/[A-Za-z0-9_./-]+\.m?js$/.test(w[1] ?? '') ? [w[1]] : []
}
// A main-folder check (a plan's [auto:main] item: it reads the live environment — .env, a database, a log — that a
// worktree and the merge folder never have) runs in the Human's main folder, so only a project script is allowed
// there: no package.json script, no node --test (those run in the plan's worktree).
function mainCheckProblem(cmd) {
  const c = String(cmd ?? '').trim()
  return checkProblem(c, null) ?? (/^node (tools|scripts)\//.test(c) ? null : `${c}: only node scripts/… or node tools/… run from the main folder`)
}
// The plan branch shape (lib/orch-run.mjs PLAN_BRANCH_RE): it reaches git commands the agents run.
const PLAN_BRANCH_RE = /^feat\/\d+-[a-z0-9-]+$/
// [ui] card values recorded through `set` (lib/orch-run.mjs uiCardProblem): the same rules, checked before the call.
function cardProblem({ card, page, shots }) {
  if (typeof card !== 'string' || !card.trim() || /^\s*-/.test(card)) return `card ${card} starts with - or is empty`
  if (page !== undefined && page !== '' && !/^https?:\/\/[^\s"'`$\\<>|;&]+$/.test(String(page))) return `page ${page} is not an http(s) URL`
  const bad = (shots ?? []).find((s) => !/^(?!-)(?!.*\.\.)[A-Za-z0-9_./-]+$/.test(String(s)))
  if (bad !== undefined) return `screenshot ${bad} is not a safe relative path`
  return null
}

const A = args ?? {}
const MODE = A.mode === 'readiness' ? 'readiness' : 'run'
const RUN = String(A.run ?? '')
const ROOT = String(A.root ?? '.')
const PLANS = (Array.isArray(A.plans) ? A.plans : String(A.plans ?? '').split(',')).map((p) => String(p).trim()).filter(Boolean)
const RUN_BRANCH = `${RUN_PREFIX}${RUN}`
if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(RUN)) throw new Error(`args.run ${JSON.stringify(RUN)} is not a run name (lower-case letters, digits, dashes)`)
if (!PLANS.length || !PLANS.every((p) => /^\d{1,4}$/.test(p))) throw new Error('args.plans must list plan numbers')

// ---- schemas (docs/agent/agent-roles.md) -------------------------------------------------------------------------
const str = { type: 'string' }
const strList = { type: 'array', items: str }
// decisions: only "behaviour: …" (a choice the plan did not settle, with how to reverse it) and "seen: file:line …" (a
// defect outside the job); evidence and confirmations are not decisions and are dropped (take()).
const COMMON = { role: str, model: str, effort: str, decisions: { ...strList, description: 'only "behaviour: … — reverse: …" and "seen: file:line …" entries; evidence and confirmations are not decisions' }, escalate: str }
const RUNNER = { type: 'object', properties: { exitCode: { type: 'integer' }, output: { type: 'string', description: 'the command\'s output, with its ORCH_JSON line copied character for character — no reformatting, no wrapping, no quotes added' } }, required: ['exitCode', 'output'] }
const PROBLEM = {
  type: 'object',
  properties: { id: str, file: str, line: { type: 'integer' }, rule: str, reasoning: str, severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] } },
  required: ['id', 'file', 'line', 'rule', 'reasoning', 'severity'],
}
const SCHEMA = {
  readiness: {
    type: 'object',
    properties: { ...COMMON, plans: { type: 'array', items: { type: 'object', properties: { plan: str, state: { type: 'string', enum: ['ready', 'questions', 'blocked'] }, questions: strList, envNeeds: strList, commands: strList, mainCommands: strList }, required: ['plan', 'state', 'questions', 'envNeeds', 'commands'] } } },
    required: ['role', 'model', 'effort', 'plans'],
  },
  builder: {
    type: 'object',
    properties: {
      ...COMMON, status: { type: 'string', enum: ['built', 'blocked', 'ESCALATE'] }, branch: str, headSha: str, summary: str, evidence: strList, blocker: str, envFailure: { type: 'boolean' },
      // The plan's [ui] cards: page, the one short e2e test that checks it (none = no script can) and its screenshot.
      uiCards: { type: 'array', items: { type: 'object', properties: { card: str, page: str, test: str, screenshot: str }, required: ['card', 'page'] } },
    },
    required: ['role', 'model', 'effort', 'status', 'branch', 'summary', 'evidence'],
  },
  gate: {
    type: 'object',
    properties: { ...COMMON, results: { type: 'array', items: { type: 'object', properties: { command: str, status: { type: 'string', enum: ['pass', 'fail', 'env-fail'] }, tail: str }, required: ['command', 'status'] } }, pass: { type: 'boolean' } },
    required: ['role', 'model', 'effort', 'results'],
  },
  finder: { type: 'object', properties: { ...COMMON, problems: { type: 'array', items: PROBLEM }, pass: { type: 'boolean' } }, required: ['role', 'model', 'effort', 'problems'] },
  verify: {
    type: 'object',
    properties: { ...COMMON, verdicts: { type: 'array', items: { type: 'object', properties: { id: str, verdict: { type: 'string', enum: ['keep', 'refuted'] }, confidence: { type: 'number' }, severity: str, refutation: str, note: str }, required: ['id', 'verdict', 'confidence', 'severity'] } }, pass: { type: 'boolean' } },
    required: ['role', 'model', 'effort', 'verdicts'],
  },
  ui: {
    type: 'object',
    properties: { ...COMMON, cards: { type: 'array', items: { type: 'object', properties: { card: str, page: str, status: { type: 'string', enum: ['pass', 'fail', 'plan-drift'] }, screenshots: strList }, required: ['card', 'status', 'screenshots'] } }, pass: { type: 'boolean' } },
    required: ['role', 'model', 'effort', 'cards'],
  },
  merge: { type: 'object', properties: { ...COMMON, merged: { type: 'boolean' }, sha: str, reason: str, envFailure: { type: 'boolean' } }, required: ['role', 'model', 'effort', 'merged'] },
}

// ---- helpers ------------------------------------------------------------------------------------------------------
// A task block every role agent reads: one KEY: value line each (lists and objects as JSON).
const task = (fields) => Object.entries(fields).filter(([, v]) => v !== undefined && v !== null)
  .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n')
// Shell quoting for the runner: values are plain words, or double-quoted with quotes and backticks turned into ', a
// backslash into / and $ and line breaks into a space — a raw JSON sample in a reason or note keeps its shape.
const q = (v) => {
  const s = String(v)
  return /^[\w.,:/=@+-]+$/.test(s) ? s : `"${s.replace(/["`]/g, "'").replace(/\\/g, '/').replace(/[$\r\n]/g, ' ').slice(0, 400)}"`
}

// Every agent call goes through here. `opts.plan` (never passed on) keys the per-plan call counter. An agent that
// returns null (it died on a terminal API error, or the Human skipped it) is called once more on FALLBACK_MODEL,
// with a run note naming both models; a second null is returned as it is, so the caller's park or environment path
// handles it. An agent already on the fallback model, or "inherit", is not retried.
async function ask(prompt, opts = {}) {
  const { plan, ...o } = opts
  const key = plan ?? 'run'
  COUNT.calls[key] = (COUNT.calls[key] ?? 0) + 1
  const r = await agent(prompt, o)
  if (r !== null || FALLBACK_MODEL === 'inherit' || o.model === FALLBACK_MODEL) return r
  await note(`model fallback: ${o.label ?? o.agentType ?? 'agent'} ${o.model ?? 'agent default'} → ${FALLBACK_MODEL}`, plan)
  COUNT.calls[key] = (COUNT.calls[key] ?? 0) + 1
  return agent(prompt, { ...o, model: FALLBACK_MODEL })
}
const callsOf = (nnn) => COUNT.calls[nnn] ?? 0

// The runner's copy of a command's output: the last line that starts with ORCH_JSON, read with what a copy may add —
// a \r, backticks around the line, text after the closing brace. When it still does not parse, the error says what
// the parser saw: its message, the raw line (JSON-escaped, so a \r or a tab shows) and the first non-ASCII character.
function readOrchLine(output) {
  const lines = String(output ?? '').split(/\r?\n/).map((l) => l.trim().replace(/^`+|`+$/g, ''))
  const line = lines.slice().reverse().find((l) => l.startsWith('ORCH_JSON '))
  if (!line) return { error: 'no ORCH_JSON line', detail: `last lines: ${JSON.stringify(lines.filter(Boolean).slice(-3).join(' | '))}` }
  const text = line.slice('ORCH_JSON '.length)
  const open = text.indexOf('{')
  const close = text.lastIndexOf('}')
  try {
    if (open < 0 || close < open) throw new Error('no { … } in the line')
    return { json: JSON.parse(text.slice(open, close + 1)) }
  } catch (e) {
    // The hint comes before the raw line: a note or reason is cut at 400 characters, and the hint is the short part.
    const chars = [...line]
    const odd = chars.findIndex((c) => c.codePointAt(0) > 0x7e)
    const hint = odd < 0 ? '' : ` — non-ASCII U+${chars[odd].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} at ${odd}`
    return { error: 'unreadable ORCH_JSON', detail: `${e.message}${hint} — raw: ${JSON.stringify(line.slice(0, 300))}` }
  }
}

// One state or preflight command through a kit-runner agent. A copy that does not parse (the command itself may have
// succeeded — a run once parked a plan on a well-formed line) is asked for once more, at effort medium, and a run
// note keeps the first error; a second bad copy is returned with "after 2 attempts". `once` turns the retry off for
// the commands a second run would repeat: `note` (the line would be written twice) and `finish` (it commits the
// report; a second run would report "nothing to commit"). Every other orch-state command is idempotent — `worktree`
// reuses the folder or slot the plan already holds.
async function runner(script, argv, label, plan, { once = false } = {}) {
  const command = ['node', `scripts/${script}`, ...argv.map(q)].join(' ')
  const name = label ?? `${script.replace('.mjs', '')} ${argv[0] ?? ''}`
  const call = (effort, lbl) => ask([
    'Run exactly this one command from the folder below, once — nothing before it and nothing after it (no git pull, checkout or fetch, no install). Do not change it, add flags, retry or explain.',
    task({ FOLDER: ROOT, COMMAND: command }),
    'The command is [capture]: return exitCode and output — its full output, with the line that starts with ORCH_JSON copied character for character (no reformatting, no wrapping, no quotes added).',
  ].join('\n\n'), { agentType: 'kit-runner', schema: RUNNER, label: lbl, effort, plan })
  const read = (r, attempts) => {
    if (!r) return { result: { ok: false, error: `runner returned nothing for: ${command}`, envFailure: true } }
    const p = readOrchLine(r.output)
    if (p.json) return { result: p.json }
    const where = p.error === 'no ORCH_JSON line' ? `${command} (exit ${r.exitCode})` : command
    return { badCopy: true, result: { ok: false, error: `${p.error} from: ${where}${attempts > 1 ? ' after 2 attempts' : ''} — ${p.detail}` } }
  }
  const first = read(await call('low', name), 1)
  if (!first.badCopy || once) return first.result
  const second = read(await call('medium', `${name} retry`), 2)
  if (!second.badCopy) await note(`runner retry: ${name} — first attempt: ${first.result.error}`, plan)
  return second.result
}
// orch-state.mjs <command> --key value …: every flag and its value go as one `--key=value` token (quoted as a whole by
// q), so no value — an agent's card title, a reason — can ever be read as a flag.
const state = (argv, label, plan) => {
  const out = [argv[0]]
  for (let i = 1; i < argv.length; i += 2) out.push(`${argv[i]}=${argv[i + 1] ?? ''}`)
  return runner('orch-state.mjs', out, label, plan, { once: argv[0] === 'note' || argv[0] === 'finish' })
}
const roleArg = (results) => results.filter(Boolean).filter((r) => r.role && r.model).map((r) => `${r.role}=${r.model}/${r.effort ?? ''}`).join(',')
const CARD_FIELDS = ['card', 'card-status', 'page', 'shots', 'via']
async function setPlan(nnn, fields, results = []) {
  // Agent-supplied [ui] values are checked before the call; a bad one is not recorded (a run note says why).
  if (fields.card !== undefined) {
    const why = cardProblem({ card: fields.card, page: fields.page, shots: String(fields.shots ?? '').split(',').filter(Boolean) })
    if (why) {
      await note(`[ui] card not recorded: ${why}`, nnn)
      fields = Object.fromEntries(Object.entries(fields).filter(([k]) => !CARD_FIELDS.includes(k)))
    }
  }
  const argv = ['set', '--run', RUN, '--plan', nnn]
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) argv.push(`--${k}`, String(v))
  const roles = roleArg(results)
  if (roles) argv.push('--roles', roles)
  return state(argv, `state ${nnn} ${fields.state ?? ''}`, nnn)
}
// A run note is one runner agent call: at most MAX_NOTES per plan (run-level notes count under "run"), then one last
// note says so and later ones are dropped without a call.
async function note(text, nnn) {
  const key = nnn ?? 'run'
  const n = (COUNT.notes[key] ?? 0) + 1
  if (n > MAX_NOTES) return { ok: true, capped: true }
  COUNT.notes[key] = n
  const line = n === MAX_NOTES ? `notes capped: ${MAX_NOTES} notes written for ${nnn ? `plan ${nnn}` : 'the run'} (orchestrator.maxNotesPerPlan), later notes are dropped` : text
  return state(['note', '--run', RUN, ...(nnn ? ['--plan', nnn] : []), '--text', line], `note ${nnn ?? ''}`, nnn)
}

let mergeFolder = null

// Decisions agents took on their own: the `behaviour:` and `seen:` entries of every role result's `decisions` list.
// They are numbered D1…Dn at the end of the run, grouped by plan, and the Human grades them in one reply
// (docs/agent/decision-review.md). Anything else an agent put there (a confirmation, evidence — a run once had 11 of
// 15) is dropped and only counted: each kept line is a run note (an agent call) and a line the Human grades.
const DECISIONS = []
const DROPPED = {}
const DECISION_RE = /^(behaviour|seen):/i
function take(nnn, ...results) {
  for (const r of results) {
    for (const d of Array.isArray(r?.decisions) ? r.decisions : []) {
      const text = String(d).replace(/\s+/g, ' ').trim()
      if (!text) continue
      if (!DECISION_RE.test(text)) {
        DROPPED[nnn] = (DROPPED[nnn] ?? 0) + 1
        continue
      }
      if (!DECISIONS.some((x) => x.plan === nnn && x.text === text)) DECISIONS.push({ plan: nnn, text })
    }
  }
}
function numberedDecisions(first) {
  const rank = (d) => (/^behaviour:/i.test(d.text) ? 0 : 1)
  const out = []
  for (const plan of [...new Set(DECISIONS.map((d) => d.plan))].sort()) out.push(...DECISIONS.filter((d) => d.plan === plan).sort((a, b) => rank(a) - rank(b)))
  return out.map((d, i) => ({ id: `D${first + i}`, plan: d.plan, text: d.text }))
}

// Merges are serialised: one merge into the run branch at a time.
let mergeChain = Promise.resolve()
function serial(fn) {
  const p = mergeChain.then(fn, fn)
  mergeChain = p.then(() => undefined, () => undefined)
  return p
}

// ---- readiness ------------------------------------------------------------------------------------------------------
async function readiness() {
  phase('Readiness')
  const order = await state(['order', '--run', RUN, '--plans', PLANS.join(',')], 'plan order')
  if (!order.ok) return { mode: 'readiness', run: RUN, ok: false, error: order.error }
  const plans = order.waves.flat()
  const results = await parallel(plans.map((nnn) => () => ask([
    `Readiness check for one plan of orchestrator run ${RUN}. Follow .claude/agents/orch-readiness.md; return one entry in plans.`,
    task({ PLAN: order.plans[nnn]?.path ?? nnn, RUN_ORDER: order.waves, RUN_PLANS: plans }),
  ].join('\n\n'), { agentType: 'orch-readiness', schema: SCHEMA.readiness, label: `readiness ${nnn}`, phase: 'Readiness', plan: nnn })))
  const pre = await runner('orch-preflight.mjs', ['--run', RUN, '--plans', PLANS.join(',')], 'preflight')
  // A check whose file does not exist (and that the plan does not create) can never pass: a run once spent fix rounds
  // and a stronger builder on `node tools/<kit script>.mjs` in a project that has no such file. Dropped here, shown to
  // the Human (askHuman), never run.
  const missingOf = async (nnn, cmds) => {
    const files = [...new Set(cmds.flatMap(checkFilesOf))]
    if (!files.length) return []
    const r = await state(['check-files', '--plan', nnn, '--files', files.join(',')], `check files ${nnn}`, nnn)
    return r?.ok ? r.missing ?? [] : []
  }
  const out = []
  for (let i = 0; i < plans.length; i++) {
    const nnn = plans[i]
    const r = results[i]
    const p = r?.plans?.[0]
    if (!p) {
      out.push({ nnn, state: 'questions', questions: ['The readiness agent returned no result for this plan — check it by hand.'], envNeeds: [], commands: [], mainCommands: [] })
      continue
    }
    const main = Array.isArray(p.mainCommands) ? p.mainCommands : []
    const missing = new Set(await missingOf(nnn, [...p.commands, ...main]))
    const noFile = (c) => (checkFilesOf(c).find((f) => missing.has(f)) ? `${c}: ${checkFilesOf(c).find((f) => missing.has(f))} does not exist in the project and the plan does not create it` : null)
    const problem = (c, isMain) => (isMain ? mainCheckProblem(c) : checkProblem(c, null)) ?? noFile(c)
    const denied = [...p.commands.filter((c) => problem(c, false)), ...main.filter((c) => problem(c, true))]
    const deniedWhy = [...p.commands.filter((c) => problem(c, false)).map((c) => problem(c, false)), ...main.filter((c) => problem(c, true)).map((c) => problem(c, true))]
    out.push({ nnn, path: order.plans[nnn]?.path, state: p.state, questions: p.questions, envNeeds: p.envNeeds, commands: p.commands.filter((c) => !problem(c, false)), mainCommands: main.filter((c) => !problem(c, true)), denied, deniedWhy, missingFiles: [...missing], model: r.model })
  }
  // Nothing to ask (every plan ready, no question, no environment need, no check file missing, no main-folder command,
  // preflight ok) → the command starts the run without waiting for `go`; the Human's `ask` word forces the pause. A
  // main-folder command runs in the live environment (the main folder's .env, database, server) and is always shown
  // to the Human before it runs: `mainApproval` lists them, and the run refuses to start without `mainApproved`.
  const mainApproval = out.flatMap((p) => (p.mainCommands ?? []).map((c) => `${p.nnn}: ${c}`))
  const askHuman = pre?.ok !== true || mainApproval.length > 0 || out.some((p) => p.state !== 'ready' || (p.questions ?? []).length > 0 || (p.envNeeds ?? []).length > 0 || (p.missingFiles ?? []).length > 0)
  return { mode: 'readiness', run: RUN, ok: true, waves: order.waves, skipped: order.skipped, plans: out, preflight: pre, askHuman, mainApproval }
}

// ---- one plan ---------------------------------------------------------------------------------------------------------
async function builder(ctx, mode, findings) {
  const judgment = ctx.tier === 'judgment'
  const prompt = [
    `Build plan ${ctx.nnn} of orchestrator run ${RUN} (mode: ${mode}). Follow .claude/agents/orch-builder.md and docs/agent/agent-roles.md.`,
    task({
      PLAN: ctx.info.path, BRANCH: ctx.info.branch, WORKTREE: ctx.wt.path, RUN_BRANCH: RUN_BRANCH, MODE: mode, TIER: ctx.tier,
      ROUND: ctx.round, CHECKS: ctx.checks, FINDINGS: findings.length ? findings : undefined,
      HANDOFF: mode === 'handoff' ? ctx.handoff : undefined,
    }),
    mode === 'fix' ? 'Fix exactly the FINDINGS, rerun the checks, commit and push your branch.' : '',
    mode === 'handoff' ? 'You are a fresh builder: read the HANDOFF file, the plan and git diff against the run branch; rerun the failing check first.' : '',
    mode === 'env-retry' ? 'The environment check passed after an environment failure: continue the plan where it stopped.' : '',
    // A relaunch (or a stopped run) finds the plan branch with commits from the earlier attempt: continue from them.
    mode === 'first' && ctx.wt.resumed ? `The branch already has ${ctx.wt.resumed} commit(s) from an earlier attempt, and the packages are installed: read git log and git diff against the run branch, tick the plan's sub-tasks they finish, and continue from there. Do not start over and do not redo setup.` : '',
  ].filter(Boolean).join('\n\n')
  const opts = { schema: SCHEMA.builder, label: `builder ${ctx.nnn} ${ctx.tier} ${mode}`, phase: 'Build', plan: ctx.nnn }
  if (!judgment) return ask(prompt, { ...opts, agentType: 'orch-builder' })
  // The judgment tier: the role agent file on the judgment model; "inherit" = the main session's model, so the role
  // file is given as instructions to a default agent (an agentType would pin the build model).
  if (MODELS.judgment === 'inherit') return ask(`Read .claude/agents/orch-builder.md and follow it as your instructions.\n\n${prompt}`, { ...opts, effort: 'high' })
  return ask(prompt, { ...opts, agentType: 'orch-builder', model: MODELS.judgment, effort: 'high' })
}

const gateAgent = (ctx, commands, label) => ask([
  `Gate for plan ${ctx.nnn} of run ${RUN}. Follow .claude/agents/orch-gate.md.`,
  task({ FOLDER: ctx.wt.path, COMMANDS: commands, TIMEOUT_MIN: GATE_TIMEOUT_MIN }),
].join('\n\n'), { agentType: 'orch-gate', schema: SCHEMA.gate, label, phase: 'Build', effort: 'low', plan: ctx.nnn !== 'final' ? ctx.nnn : undefined })

async function gate(ctx) {
  // ctx.main: the plan's [auto:main] checks, run from the main folder after the worktree gate passed (never at the
  // merge or the final gate); their reasons say so, so a fix round and the report name the right place.
  const kind = ctx.main ? 'gate (main folder)' : 'gate'
  const r = await gateAgent(ctx, ctx.checks, ctx.main ? `gate ${ctx.nnn} main` : `gate ${ctx.nnn}`)
  if (!r) return { r, env: true, why: `the ${kind} agent returned nothing` }
  // Exactly one result per command in ctx.checks, matched by the command string: a check with no result, with two, or a
  // result for a command that was not asked for is a fail (a gate cannot pass by leaving a check out).
  let known = r.results.filter((x) => ctx.checks.includes(x.command))
  const unknown = r.results.filter((x) => !ctx.checks.includes(x.command)).map((x) => ({ command: x.command, status: 'fail', tail: 'the gate returned a result for a command it was not given' }))
  const twice = ctx.checks.filter((c) => known.filter((x) => x.command === c).length > 1).map((c) => ({ command: c, status: 'fail', tail: 'the gate returned more than one result for this check' }))
  let missingCmds = ctx.checks.filter((c) => !known.some((x) => x.command === c))
  // Results the gate lost (a run got 1 of 8 back): only the missing commands run again, once. A command still missing
  // after that is an environment failure, not a code failure — no fix round and no builder for it.
  if (missingCmds.length && !unknown.length && !twice.length) {
    await note(`gate rerun for ${missingCmds.length} missing result(s): ${missingCmds.join(', ')}`, ctx.nnn !== 'final' ? ctx.nnn : undefined)
    const again = await gateAgent(ctx, missingCmds, `gate ${ctx.nnn}${ctx.main ? ' main' : ''} rerun`)
    const more = (again?.results ?? []).filter((x) => missingCmds.includes(x.command) && !known.some((k) => k.command === x.command))
    known = [...known, ...more.filter((x, i) => more.findIndex((y) => y.command === x.command) === i)]
    missingCmds = ctx.checks.filter((c) => !known.some((x) => x.command === c))
    if (missingCmds.length) return { r, env: true, why: `${kind} returned no result, twice, for: ${missingCmds.join(', ')}` }
  }
  const missing = missingCmds.map((c) => ({ command: c, status: 'fail', tail: 'the gate returned no result for this check' }))
  const env = known.filter((x) => x.status === 'env-fail')
  const failed = [...known.filter((x) => x.status !== 'pass' && x.status !== 'env-fail'), ...missing, ...twice, ...unknown]
  if (env.length && !missing.length && !unknown.length && !twice.length) return { r, env: true, why: `${kind} env-fail: ${env.map((x) => x.command).join(', ')}` }
  // pass is computed from the results, never read from the agent
  if (failed.length || !ctx.checks.length) {
    // fingerprint: the reason plus the first failure's last output line — "the same reason twice" compares it, so a
    // gate that fails on the same command with a new error is not a loop.
    const why = `${kind}: ${failed.map((x) => x.command).join(', ') || 'no check ran'}`
    const last = String(failed[0]?.tail ?? '').trim().split('\n').pop() ?? ''
    return { r, fail: true, why, fingerprint: `${why} :: ${last}`, check: failed[0]?.command, tail: failed[0]?.tail,
      findings: failed.map((x, i) => ({ id: `gate-${i + 1}`, file: x.command, line: 1, rule: 'check fails', reasoning: x.tail ?? '', severity: 'blocker' })) }
  }
  return { r }
}

async function checkers(ctx) {
  const diff = await state(['diff', '--run', RUN, '--plan', ctx.nnn], `diff ${ctx.nnn}`, ctx.nnn)
  if (!diff.ok) return { env: !!diff.envFailure, fail: !diff.envFailure, why: `diff: ${diff.error}`, findings: [] }
  const roles = diff.sensitive ? [...FINDERS, 'orch-security'] : FINDERS
  const base = task({ PLAN: ctx.info.path, BRANCH: `origin/${ctx.info.branch}`, BASE: `origin/${RUN_BRANCH}`, FOLDER: ctx.wt.path, FILES: diff.files })
  const found = await parallel(roles.map((role) => () => ask(`Check plan ${ctx.nnn} of run ${RUN}. Follow .claude/agents/${role}.md.\n\n${base}`,
    { agentType: role, schema: SCHEMA.finder, label: `${role.replace('orch-', '')} ${ctx.nnn}`, phase: 'Build', plan: ctx.nnn })))
  const results = found.filter(Boolean)
  const missing = roles.filter((_, i) => !found[i])
  const candidates = []
  for (const r of results) {
    const computed = !r.problems.some((p) => FAILING.includes(p.severity))
    if (r.pass === true && !computed) await note(`${r.role} returned pass: true next to a ${r.problems.find((p) => FAILING.includes(p.severity)).severity} problem — pass recomputed as false`, ctx.nnn)
    r.problems.forEach((p, i) => candidates.push({ ...p, id: `${r.role.replace('orch-', '')}-${i + 1}` }))
  }
  if (missing.length) return { results, fail: true, env: false, why: `checker returned nothing: ${missing.join(', ')}`, findings: [] }
  if (!candidates.length) return { results, diff }
  const v = await ask(`Verify the candidate problems of plan ${ctx.nnn} of run ${RUN}. Follow .claude/agents/orch-verify.md.\n\n${task({ PLAN: ctx.info.path, BRANCH: `origin/${ctx.info.branch}`, BASE: `origin/${RUN_BRANCH}`, FOLDER: ctx.wt.path, CANDIDATES: candidates })}`,
    { agentType: 'orch-verify', schema: SCHEMA.verify, label: `verify ${ctx.nnn}`, phase: 'Build', plan: ctx.nnn })
  results.push(v)
  // A candidate without a verdict (or no verifier result) stays kept: dropping needs a concrete refutation.
  const verdictOf = new Map((v?.verdicts ?? []).map((x) => [x.id, x]))
  const kept = candidates.filter((c) => {
    const x = verdictOf.get(c.id)
    if (!x) return FAILING.includes(c.severity)
    return x.verdict === 'keep' && x.confidence >= KEEP_THRESHOLD && FAILING.includes(x.severity)
  })
  if (kept.length) return { results, diff, fail: true, why: `checker: ${kept.map((k) => `${k.severity} ${k.file}:${k.line} ${k.rule}`).join('; ')}`, findings: kept }
  return { results, diff }
}

// The [ui] tier (docs/agent/job-validation.md): each card's own script first, run by the gate; the browser agent only
// for a card whose script failed or that no script can check, after the UI environment check. A passing script card
// never reaches the browser agent. Verdicts: pass / fail / plan-drift; plan drift has no severity and is not a bug.
// The plan's own [ui] items (plan-info) are held against the builder's cards: an item no card covers is never dropped
// — it joins as a card with no script, so the browser agent checks it (args.ui) or it is recorded `unchecked` and
// reaches the Human in the run report.
// A card covers an item only when its title is the item's text (case, quotes and spaces aside): a short card title
// that is part of a longer item ("Save" inside "Save shows Saved in the header") covers nothing.
const normCard = (s) => String(s ?? '').toLowerCase().replace(/[`"'‘’“”]/g, '').replace(/\s+/g, ' ').trim()
function uiItemsMissing(items, cards) {
  const have = new Set(cards.map((c) => normCard(c.card)).filter(Boolean))
  return (items ?? []).filter((item) => {
    const n = normCard(item)
    return n && !have.has(n)
  })
}
async function ui(ctx) {
  const reported = ctx.uiCards ?? []
  const missing = uiItemsMissing(ctx.info?.uiItems, reported)
  if (missing.length) await note(`builder reported no card for ${missing.length} [ui] item(s), added with no script: ${missing.join('; ')}`, ctx.nnn)
  const cards = [...reported, ...missing.map((card) => ({ card, page: '' }))]
  if (!cards.length && A.ui !== true) return {}
  const record = (c, status, via, shots) => setPlan(ctx.nnn, { round: ctx.round, card: c.card, 'card-status': status, page: c.page || undefined, shots: (shots ?? []).filter(Boolean).join(',') || undefined, via })
  const results = []
  // A card's test command goes through the same allowlist as the plan's extra checks: one that is not allowed is not
  // run (a run note says why) and the card is treated as one no script can check.
  const scripts = Array.isArray(ctx.info?.npmScripts) ? ctx.info.npmScripts : []
  for (const c of cards.filter((x) => x.test && checkProblem(x.test, scripts))) await note(`[ui] card test dropped, not run: ${c.card}: ${checkProblem(c.test, scripts)}`, ctx.nnn)
  const scripted = cards.filter((c) => c.test && !checkProblem(c.test, scripts))
  const failed = []
  const passed = []
  if (scripted.length) {
    const g = await ask([
      `UI gate for plan ${ctx.nnn} of run ${RUN}: run each [ui] card's own e2e test. Follow .claude/agents/orch-gate.md.`,
      task({ FOLDER: ctx.wt.path, COMMANDS: scripted.map((c) => c.test), TIMEOUT_MIN: GATE_TIMEOUT_MIN }),
    ].join('\n\n'), { agentType: 'orch-gate', schema: SCHEMA.gate, label: `ui-gate ${ctx.nnn}`, phase: 'Build', effort: 'low', plan: ctx.nnn })
    if (!g) return { env: true, why: 'the UI gate agent returned nothing' }
    results.push(g)
    const env = g.results.filter((x) => x.status === 'env-fail')
    if (env.length) return { results, env: true, why: `ui gate env-fail: ${env.map((x) => x.command).join(', ')}` }
    for (const c of scripted) {
      const r = g.results.find((x) => x.command === c.test)
      if (r?.status === 'pass') {
        passed.push(c)
        await record(c, 'pass', 'script', [c.screenshot])
      }
      else failed.push({ ...c, tail: r?.tail ?? 'the gate did not run this test' })
    }
  }
  const unscripted = cards.filter((c) => !scripted.includes(c))
  const forBrowser = [...failed, ...unscripted]
  if (cards.length && !forBrowser.length) return { results }
  if (A.ui !== true) {
    // The browser step is off: a failed script is a bug for the builder; a card no script can check goes to the Human.
    for (const c of unscripted) await record(c, 'unchecked', 'none', [])
    for (const c of failed) await record(c, 'fail', 'script', [c.screenshot])
    if (!failed.length) return { results }
    return { results, fail: true, why: `ui: ${failed.map((c) => `${c.card} fail`).join('; ')}`,
      findings: failed.map((c, i) => ({ id: `ui-${i + 1}`, file: c.card, line: 1, rule: 'ui fail', reasoning: `${c.test}: ${c.tail}`, severity: 'major' })) }
  }
  // Environment before any browser step: the pages' servers, the QA login, the backend from the page's origin.
  const pages = [...new Set(forBrowser.map((c) => c.page).filter(Boolean))]
  const preArgs = ['--ui', ...(pages.length ? ['--pages', pages.join(',')] : []), ...(A.uiLogin ? ['--login', A.uiLogin] : []), ...(A.uiApi ? ['--api', A.uiApi] : [])]
  const pre = await runner('orch-preflight.mjs', preArgs, `ui env ${ctx.nnn}`, ctx.nnn)
  if (!pre.ok) return { results, blocked: true, why: `UI environment blocked before the browser step: ${(pre.problems ?? [pre.error]).join('; ')}` }
  const known = [...failed.map((c) => `${c.card}: its script failed — ${c.tail}`), ...(ctx.knownFindings ?? [])]
  // At most UI_BATCH cards per agent (agent-roles.md rule 10): each batch is a fresh agent, one after the other (they
  // share one browser).
  const batches = cards.length ? Array.from({ length: Math.ceil(forBrowser.length / UI_BATCH) }, (_, i) => forBrowser.slice(i * UI_BATCH, (i + 1) * UI_BATCH)) : [null]
  const shown = []
  for (let i = 0; i < batches.length; i++) {
    const part = batches[i]
    const r = await ask(`UI cards of plan ${ctx.nnn} of run ${RUN}. Follow .claude/agents/orch-ui.md, and give each card the page URL it was checked on in \`page\`.\n\n${task({
      PLAN: ctx.info.path, FOLDER: ctx.wt.path, SCREENSHOTS: `.claude/sessions/orch-${RUN}/screens-${ctx.nnn}`,
      CARDS: part ? part.map((c) => ({ card: c.card, page: c.page, scriptFailed: failed.includes(c) })) : undefined,
      PRE_CHECKED: passed.length ? passed.map((c) => c.card) : undefined,
      KNOWN_FINDINGS: known.length ? known : undefined,
      BATCH: batches.length > 1 ? `${i + 1} of ${batches.length}` : undefined,
    })}`, { agentType: 'orch-ui', schema: SCHEMA.ui, label: batches.length > 1 ? `ui ${ctx.nnn} ${i + 1}/${batches.length}` : `ui ${ctx.nnn}`, phase: 'Build', plan: ctx.nnn })
    if (!r) return { results, fail: true, why: 'the UI agent returned nothing', findings: [] }
    results.push(r)
    shown.push(...r.cards)
  }
  // Each card result (page, status, screenshot paths) goes into status.json: the run report's grid by page.
  for (const c of shown) await record({ card: c.card, page: c.page || forBrowser.find((x) => x.card === c.card)?.page }, c.status, 'browser', c.screenshots)
  const drift = shown.filter((c) => c.status === 'plan-drift')
  if (drift.length) await note(`plan drift (not a bug, no fix round): ${drift.map((c) => c.card).join('; ')}`, ctx.nnn)
  const bad = shown.filter((c) => c.status === 'fail')
  if (bad.length) return { results, fail: true, why: `ui: ${bad.map((c) => `${c.card} fail`).join('; ')}`, findings: bad.map((c, i) => ({ id: `ui-${i + 1}`, file: c.card, line: 1, rule: 'ui fail', reasoning: c.screenshots.join(', '), severity: 'major' })) }
  return { results }
}

async function merge(ctx) {
  return serial(async () => {
    await setPlan(ctx.nnn, { state: 'merging', round: ctx.round })
    const subject = `Merge ${ctx.info.branch} into ${RUN_BRANCH} (plan ${ctx.nnn})`
    const r = await ask([
      `Merge plan ${ctx.nnn} into run branch ${RUN_BRANCH}. Follow .claude/agents/orch-merge.md, with the checks below run before the push:`,
      task({ RUN_BRANCH, PLAN_BRANCH: ctx.info.branch, PLAN_NUMBER: ctx.nnn, MERGE_FOLDER: ctx.mergeFolder, SUBJECT: subject, CHECKS: ctx.mergeChecks, TIMEOUT_MIN: GATE_TIMEOUT_MIN }),
      `Steps: git fetch origin; git merge --ff-only origin/${RUN_BRANCH}; git merge --no-ff --no-commit origin/${ctx.info.branch}; run each CHECKS command (output to a temp file) under timeout TIMEOUT_MIN*60 seconds; all pass → git commit -m "${subject}" and push ${RUN_BRANCH}; a conflict or a failing check → git merge --abort and return merged: false with the reason. Never touch the main branch.`,
    ].join('\n\n'), { agentType: 'orch-merge', schema: SCHEMA.merge, label: `merge ${ctx.nnn}`, phase: 'Build', plan: ctx.nnn })
    if (!r) return { env: true, why: 'the merge agent returned nothing' }
    if (!r.merged) return { r, env: !!r.envFailure, fail: !r.envFailure, why: `merge: ${r.reason ?? 'not merged'}`,
      findings: [{ id: 'merge-1', file: RUN_BRANCH, line: 1, rule: 'merge into the run branch', reasoning: `${r.reason ?? ''} — merge origin/${RUN_BRANCH} into your branch, resolve, rerun the checks`, severity: 'blocker' }] }
    const clean = await state(['clean', '--run', RUN], 'merge folder clean', ctx.nnn)
    if (!clean.ok) return { r, stopRun: `merge folder not clean after merging ${ctx.nnn}: ${clean.error}`, merged: true }
    return { r, merged: true, sha: r.sha }
  })
}

async function envCheck(ctx, why) {
  await setPlan(ctx.nnn, { state: 'env-paused', round: ctx.round, reason: why })
  // --run: the merge folder's packages are part of the environment (the merge step builds there).
  const r = await runner('orch-preflight.mjs', ['--env-only', '--run', RUN], `env check ${ctx.nnn}`, ctx.nnn)
  return r
}

async function runPlan(nnn) {
  const info = await state(['plan-info', '--run', RUN, '--plan', nnn], `plan ${nnn}`, nnn)
  if (!info.ok) return { nnn, state: 'parked', reason: `plan-info: ${info.error}` }
  if (!PLAN_BRANCH_RE.test(String(info.branch))) return { nnn, state: 'parked', reason: `plan-info: plan branch ${JSON.stringify(info.branch)} does not match feat/<NNN>-<lower-case words>` }
  const extra = Array.isArray((A.checks ?? {})[nnn]) ? A.checks[nnn] : []
  const scripts = Array.isArray(info.npmScripts) ? info.npmScripts : []
  const dropped = extra.map((c) => checkProblem(c, scripts)).filter(Boolean)
  const checks = [...new Set([...PROJECT_CHECKS, ...extra.filter((c) => !checkProblem(c, scripts)).map((c) => String(c).trim())])]
  // The plan's [auto:main] checks (readiness `mainCommands`, args.mainChecks): project scripts run from the main folder
  // after the worktree gate passed; never part of the merge or the final gate.
  const mainExtra = Array.isArray((A.mainChecks ?? {})[nnn]) ? A.mainChecks[nnn] : []
  const mainDropped = mainExtra.map((c) => mainCheckProblem(c)).filter(Boolean)
  const mainChecks = [...new Set(mainExtra.filter((c) => !mainCheckProblem(c)).map((c) => String(c).trim()))]
  const ctx = { nnn, info, tier: info.startTier, round: 0, escalated: false, checks, mergeChecks: mergeChecksOf(checks), mainChecks, handoff: `.claude/sessions/orch-${RUN}/handoff-${nnn}.md` }
  for (const why of dropped) await note(`check command dropped, not run: ${why}`, nnn)
  for (const why of mainDropped) await note(`main-folder check dropped, not run: ${why}`, nnn)
  if (info.startTier === 'judgment') await note(`starts on the judgment tier: Architecture Impact names ${info.invariants.join(', ')}`, nnn)
  // A parked plan closes with one `set` (the reason carries everything), not one note per closing step.
  const park = async (reason) => {
    await setPlan(nnn, { state: 'parked', round: ctx.round, tier: ctx.tier, reason })
    return { nnn, state: 'parked', reason, round: ctx.round }
  }
  // The agent-call limit (orchestrator.maxAgentCallsPerPlan): checked before each stage, so a plan that keeps calling
  // agents without reaching a merge is parked instead of running for hours.
  const overLimit = () => callsOf(nnn) >= MAX_CALLS
  const limitReason = () => `agent-call limit: ${callsOf(nnn)} of ${MAX_CALLS} agent calls used (orchestrator.maxAgentCallsPerPlan)`
  let wt = await state(['worktree', '--run', RUN, '--plan', nnn], `worktree ${nnn}`, nnn)
  if (!wt.ok && wt.envFailure) {
    const env = await envCheck(ctx, wt.error)
    if (!env.ok) return park(`environment: ${(env.problems ?? [env.error]).join('; ')}`)
    wt = await state(['worktree', '--run', RUN, '--plan', nnn], `worktree ${nnn} retry`, nnn)
  }
  if (!wt.ok) return park(`worktree: ${wt.error}`)
  ctx.wt = wt
  ctx.mergeFolder = mergeFolder
  let mode = 'first'
  let findings = []
  let envRetried = false
  // The last real failure's reason (120 characters): the same one twice in a row parks the plan at once.
  let lastWhy = null
  // The merge step, on its own: after an environment failure at the merge (a merge folder without packages) the
  // branch is already built and verified, so the retry is this step only — no builder, gate or checkers again.
  const mergeStep = async (results) => {
    await setPlan(nnn, { state: 'checking', round: ctx.round }, results)
    const m = await merge(ctx)
    const res = m.r ? [m.r] : []
    take(nnn, m.r)
    if (m.merged) {
      await setPlan(nnn, { state: 'merged', round: ctx.round, tier: ctx.tier, sha: m.sha, reason: m.stopRun }, res)
      return { done: { nnn, state: 'merged', sha: m.sha, round: ctx.round, stopRun: m.stopRun } }
    }
    return { failure: { ...m, stage: 'merge' }, results: res }
  }
  for (;;) {
    if (overLimit()) return park(limitReason())
    let failure = null
    let results = []
    if (mode === 'merge-retry') {
      const r = await mergeStep([])
      if (r.done) return r.done
      failure = r.failure
      results = r.results
    } else {
    await setPlan(nnn, { state: ctx.round ? 'fixing' : 'building', round: ctx.round, tier: ctx.tier })
    const b = await builder(ctx, mode, findings)
    take(nnn, b)
    results = [b]
    if (!b) failure = { why: 'the builder returned nothing', escalate: true }
    else if (b.envFailure) failure = { env: true, why: `builder: ${b.blocker ?? 'environment failure'}` }
    else if (b.status !== 'built') failure = { why: `builder ${b.status}: ${b.blocker ?? ''}`, escalate: true }
    else if (b.branch !== ctx.info.branch) failure = { why: `builder pushed ${b.branch}, expected ${ctx.info.branch}`, findings: [] }
    if (b?.status === 'built' && Array.isArray(b.uiCards)) ctx.uiCards = b.uiCards
    if (!failure && overLimit()) return park(limitReason())
    if (!failure) {
      await setPlan(nnn, { state: 'gate', round: ctx.round, tier: ctx.tier, sha: b.headSha }, results)
      results = []
      let g = await gate(ctx)
      results.push(g.r)
      take(nnn, g.r)
      if (!g.env && !g.fail && ctx.mainChecks.length) {
        // The [auto:main] checks, from the main folder (ROOT): its code is the main branch, so they prove the live side
        // effects of the plan's own checks (a log, a database), not the plan's code.
        g = await gate({ ...ctx, wt: { path: ROOT }, checks: ctx.mainChecks, main: true })
        results.push(g.r)
        take(nnn, g.r)
      }
      if (g.env || g.fail) failure = g
      else if (overLimit()) return park(limitReason())
      else {
        await setPlan(nnn, { state: 'checking', round: ctx.round }, results)
        results = []
        const c = await checkers(ctx)
        results.push(...(c.results ?? []))
        take(nnn, ...(c.results ?? []))
        if (c.env || c.fail) failure = c
        else if (overLimit()) return park(limitReason())
        else {
          const u = await ui(ctx)
          results.push(...(u.results ?? []))
          take(nnn, ...(u.results ?? []))
          if (u.blocked) {
            // A blocked UI environment stops before the browser agent and costs no fix round: the plan is parked with
            // the reason, for the Human to fix the environment and relaunch.
            await setPlan(nnn, { round: ctx.round }, results)
            return park(u.why)
          }
          if (u.env || u.fail) failure = u
          else if (overLimit()) return park(limitReason())
          else {
            const r = await mergeStep(results)
            if (r.done) return r.done
            failure = r.failure
            results = r.results
          }
        }
      }
    }
    }
    if (results.length) await setPlan(nnn, { round: ctx.round }, results)
    if (failure.env) {
      // An environment failure never costs a fix round: pause, check the environment, retry once, else stop. At the
      // merge, the retry is the merge only (the branch is built and verified); earlier, the plan continues from the builder.
      if (envRetried) return park(`environment, again after one retry: ${failure.why}`)
      envRetried = true
      const env = await envCheck(ctx, failure.why)
      if (!env.ok) return park(`environment: ${(env.problems ?? [env.error]).join('; ')}`)
      const mergeOnly = failure.stage === 'merge'
      await note(`environment failure (${failure.why}); the environment check passed, ${mergeOnly ? 'the merge is retried on its own (the branch is already built and verified)' : 'retried once without a fix round'}`, nnn)
      mode = mergeOnly ? 'merge-retry' : 'env-retry'
      continue
    }
    // A real failure: back to a builder per the escalation rule, or park. The same reason twice in a row (the why
    // strings start with the step: gate, checker, ui, merge; a gate adds its last output line) is a loop — parked at
    // once, no further fix round.
    const why = String(failure.fingerprint ?? failure.why ?? '').trim().slice(0, 240)
    if (why && why === lastWhy) return park(`same reason twice: ${String(failure.why ?? '').trim().slice(0, 120)}`)
    lastWhy = why
    if (ctx.round >= MAX_FIX_ROUNDS || (ctx.tier === 'judgment' && ctx.escalated)) return park(`${failure.why} (fix rounds used: ${ctx.round} of ${MAX_FIX_ROUNDS})`)
    ctx.round += 1
    findings = failure.findings ?? []
    ctx.knownFindings = findings.filter((f) => /^ui-/.test(f.id)).map((f) => `${f.file}: ${f.reasoning}`)
    if (failure.escalate || ctx.round >= 2) {
      // A persisting failure, an ESCALATE / blocked builder or a second finding: a fresh builder on the judgment tier.
      const w = await state(['handoff', '--run', RUN, '--plan', nnn, '--step', `round ${ctx.round}`, '--check', failure.check ?? failure.why, '--tail', failure.tail ?? failure.why, '--tried', `${ctx.tier} builder, mode ${mode}`], `handoff ${nnn}`, nnn)
      if (!w.ok) return park(`hand-off file: ${w.error}`)
      ctx.tier = 'judgment'
      ctx.escalated = true
      mode = 'handoff'
      await note(`escalated to a fresh judgment-tier builder (round ${ctx.round}): ${failure.why}`, nnn)
    } else mode = 'fix'
  }
}

// ---- the run ------------------------------------------------------------------------------------------------------------
async function run() {
  phase('Start')
  const pre = await runner('orch-preflight.mjs', ['--run', RUN, '--plans', PLANS.join(',')], 'preflight')
  if (!pre.ok) return { mode: 'run', run: RUN, ok: false, stopped: 'preflight', problems: pre.problems ?? [pre.error] }
  // A main-folder check runs a plan's command in the live environment. Readiness listed them (mainApproval) and the
  // command waited for the Human's `go` before passing `mainApproved`; without it the run does not start — nothing is
  // created, no state file, no init.
  const mainList = Object.entries(A.mainChecks ?? {}).flatMap(([nnn, cmds]) => (Array.isArray(cmds) ? cmds : []).map((c) => `plan ${nnn} runs ${c} from the main folder — readiness lists it and the Human says go; the command then passes "mainApproved": true`))
  if (mainList.length && A.mainApproved !== true) return { mode: 'run', run: RUN, ok: false, stopped: 'main-approval', problems: mainList }
  // No start time is passed: init reads its own clock (a value the model wrote was invented) and returns it.
  const init = await state(['init', '--run', RUN], 'start run')
  if (!init.ok) return { mode: 'run', run: RUN, ok: false, stopped: 'init', problems: [init.error] }
  mergeFolder = init.mergeFolder
  const startedAt = init.startedAt ?? null
  const order = await state(['order', '--run', RUN, '--plans', PLANS.join(',')], 'plan order')
  if (!order.ok) {
    await state(['stop', '--run', RUN, '--reason', `plan order: ${order.error}`])
    return { mode: 'run', run: RUN, ok: false, stopped: 'order', problems: [order.error] }
  }
  if (order.skipped?.length) log(`already merged into ${RUN_BRANCH} (from git): ${order.skipped.join(', ')}`)
  phase('Build')
  // The pilot (orchestrator.pilotSize): a run with more plans than the pilot size builds the first plans in wave order,
  // then stops with the report and the numbered decisions; the Human's `continue` relaunches with args.pilot false.
  let waves = order.waves
  const waiting = []
  if (PILOT_SIZE > 0 && A.pilot !== false && order.waves.flat().length > PILOT_SIZE) {
    let left = PILOT_SIZE
    waves = []
    for (const wave of order.waves) {
      const now = wave.slice(0, left)
      left -= now.length
      if (now.length) waves.push(now)
      waiting.push(...wave.slice(now.length))
    }
    log(`pilot: ${PILOT_SIZE} of ${PILOT_SIZE + waiting.length} plans first, ${waiting.length} wait for the Human's continue`)
  }
  const pilotWaiting = [...waiting]
  const outcomes = []
  let stopReason = null
  let finalGate = null
  // Whatever happens in the waves or the final gate, the run ends with `stop` (when it did not finish) and `finish`:
  // the report and the decisions list exist every time, also when every plan parked or a step threw.
  try {
  for (let w = 0; w < waves.length; w++) {
    const wave = waves[w]
    log(`wave ${w + 1}: ${wave.join(', ')}`)
    // Plans in one lock group (overlapping scope) run one after the other; the rest of the wave runs in parallel.
    const groups = (order.waveLocks?.[w] ?? []).map((g) => g.plans.filter((p) => wave.includes(p)))
    const grouped = new Set(groups.flat())
    const units = [...groups, ...wave.filter((p) => !grouped.has(p)).map((p) => [p])]
    // At most CONCURRENCY units at once (orchestrator.concurrency): more builders on one machine made specs time out.
    // A unit that throws leaves its slot in `done` empty, which the line below turns into parked plans.
    const done = new Array(units.length).fill(undefined)
    const queue = units.map((unit, i) => [unit, i])
    await parallel(Array.from({ length: Math.min(Math.max(CONCURRENCY, 1), units.length) }, () => async () => {
      while (queue.length) {
        const [unit, i] = queue.shift()
        try {
          const out = []
          for (const nnn of unit) {
            out.push(await runPlan(nnn))
            // A plan that built in an idle wt-N slot gives it back, merged or parked (a slot with uncommitted or unpushed work stays).
            await state(['release', '--run', RUN, '--plan', nnn], `release ${nnn}`, nnn)
          }
          done[i] = out
        } catch (e) {
          log(`plan unit ${unit.join(', ')} stopped with an error: ${e?.message ?? e}`)
        }
      }
    }))
    const flat = done.flatMap((d, i) => d ?? units[i].map((nnn) => ({ nnn, state: 'parked', reason: 'the plan pipeline stopped with an error' })))
    outcomes.push(...flat)
    const stop = flat.find((o) => o.stopRun)
    const parked = flat.filter((o) => o.state !== 'merged')
    if (stop || parked.length) {
      stopReason = stop ? stop.stopRun : `wave ${w + 1} parked ${parked.map((p) => p.nnn).join(', ')} — later waves not started`
      const later = [...waves.slice(w + 1).flat(), ...waiting]
      for (const nnn of later) {
        await setPlan(nnn, { state: 'skipped', reason: `not started: ${stopReason}` })
        outcomes.push({ nnn, state: 'skipped' })
      }
      await state(['stop', '--run', RUN, '--reason', stopReason])
      waiting.length = 0
      break
    }
  }
  if (waiting.length) {
    stopReason = `pilot of ${PILOT_SIZE} plans done — ${waiting.length} plan(s) wait for the Human's continue: ${waiting.join(', ')}`
    for (const nnn of waiting) {
      await setPlan(nnn, { state: 'skipped', reason: 'pilot: waits for the Human\'s continue' })
      outcomes.push({ nnn, state: 'skipped' })
    }
    await state(['stop', '--run', RUN, '--reason', stopReason])
  }
  // The final integration gate: the project's full build and test once on the run branch after the last merge, so a
  // merge that breaks a test outside every plan is a finding, not a clean hand-over.
  const anyMerged = outcomes.some((o) => o.state === 'merged') || (order.skipped?.length ?? 0) > 0
  if (anyMerged && mergeFolder && PROJECT_CHECKS.length) {
    const g = await gate({ nnn: 'final', wt: { path: mergeFolder }, checks: PROJECT_CHECKS })
    if (g.fail || g.env) {
      const why = g.fail ? `final gate failed: ${g.check} — ${String(g.tail ?? '').split('\n').slice(-5).join(' / ')}` : `final gate could not run: ${g.why}`
      finalGate = { ok: false, command: g.check, tail: g.tail, why }
      await note(why.slice(0, 380))
      if (!stopReason) {
        stopReason = why.slice(0, 380)
        await state(['stop', '--run', RUN, '--reason', stopReason])
      }
    } else finalGate = { ok: true }
  }
  } catch (e) {
    const why = `run stopped with an error: ${String(e?.message ?? e).slice(0, 300)}`
    log(why)
    if (!stopReason) {
      stopReason = why
      await state(['stop', '--run', RUN, '--reason', stopReason])
    }
  }
  // The decisions, numbered D1…Dn: noted per plan (they appear in the report's "Decisions taken") and returned to the
  // command, which prints them with the reply format.
  const decisions = numberedDecisions(Number.isInteger(A.firstDecision) && A.firstDecision > 0 ? A.firstDecision : 1)
  for (const d of decisions) await note(`${d.id} ${d.text}`.slice(0, 380), d.plan)
  phase('Report')
  const fin = await state(['finish', '--run', RUN], 'report')
  // A run that ended on a limit or an error: the command prints this line first (STUCK), before the lists.
  const LIMIT = /^(agent-call limit|same reason twice|run stopped with an error)/
  const stuckWhy = LIMIT.test(String(stopReason ?? '')) ? stopReason : outcomes.find((o) => LIMIT.test(String(o.reason ?? '')))?.reason ?? null
  return {
    mode: 'run', run: RUN, ok: !!fin.ok, branch: RUN_BRANCH, stopReason, startedAt,
    merged: fin.merged ?? [], parked: fin.parked ?? [], report: fin.report, local: fin.local, reportCommitted: fin.reportCommitted ?? !!fin.ok, outcomes,
    pilot: pilotWaiting.length ? { size: PILOT_SIZE, waiting: pilotWaiting } : null,
    finalGate, decisions, decisionsDropped: DROPPED,
    stuck: stuckWhy ? `STUCK: ${stuckWhy}` : null,
    agentCalls: COUNT.calls, notes: COUNT.notes,
  }
}

return MODE === 'readiness' ? readiness() : run()
