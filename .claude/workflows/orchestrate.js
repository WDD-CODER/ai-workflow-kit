export const meta = {
  name: 'orchestrate',
  description: 'Run saved plans unattended into one run branch: readiness, then builder, gate, checkers and merge per plan, wave by wave',
  whenToUse: 'Started by the /orchestrate command only (it passes args: mode, run, plans, startedAt, root)',
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

const MODELS = { build: "sonnet", judgment: "inherit" }
const MAX_FIX_ROUNDS = 2
const RUN_PREFIX = "orch/"
const PROJECT_CHECKS = ["build", "lint", "test"].filter((s) => typeof s === 'string' && s !== '').map((s) => `npm run ${s}`)
const FAILING = ['blocker', 'major']
const KEEP_THRESHOLD = 80
const FINDERS = ['orch-check-plan', 'orch-check-bugs', 'orch-check-rules']
// Commands no agent may run (docs/agent/agent-roles.md deny list); a readiness command matching one is dropped.
const DENY = /\brm\s+-[a-z]*[rf]|reset\s+--hard|push\s+(?:[^\n]*\s)?(?:--force|-f\b|--force-with-lease)|git\s+clean|branch\s+-D|stash\s+clear|filter-branch/

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
const COMMON = { role: str, model: str, effort: str, decisions: strList, escalate: str }
const RUNNER = { type: 'object', properties: { exitCode: { type: 'integer' }, output: str }, required: ['exitCode', 'output'] }
const PROBLEM = {
  type: 'object',
  properties: { id: str, file: str, line: { type: 'integer' }, rule: str, reasoning: str, severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] } },
  required: ['id', 'file', 'line', 'rule', 'reasoning', 'severity'],
}
const SCHEMA = {
  readiness: {
    type: 'object',
    properties: { ...COMMON, plans: { type: 'array', items: { type: 'object', properties: { plan: str, state: { type: 'string', enum: ['ready', 'questions', 'blocked'] }, questions: strList, envNeeds: strList, commands: strList }, required: ['plan', 'state', 'questions', 'envNeeds', 'commands'] } } },
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
// Shell quoting for the runner: values are plain words, or double-quoted with $, backtick, backslash and quotes removed.
const q = (v) => {
  const s = String(v)
  return /^[\w.,:/=@+-]+$/.test(s) ? s : `"${s.replace(/["`$\\\r\n]/g, ' ').slice(0, 400)}"`
}

async function runner(script, argv, label) {
  const command = ['node', `scripts/${script}`, ...argv.map(q)].join(' ')
  const r = await agent([
    'Run exactly this one command from the folder below, once. Do not change it, add flags, retry or explain.',
    task({ FOLDER: ROOT, COMMAND: command }),
    'Return exitCode and output: the last output line that starts with ORCH_JSON, copied verbatim (the last 40 lines when there is none).',
  ].join('\n\n'), { agentType: 'kit-runner', schema: RUNNER, label: label ?? `${script.replace('.mjs', '')} ${argv[0] ?? ''}`, effort: 'low' })
  if (!r) return { ok: false, error: `runner returned nothing for: ${command}`, envFailure: true }
  const line = String(r.output).split('\n').reverse().find((l) => l.startsWith('ORCH_JSON '))
  if (!line) return { ok: false, error: `no ORCH_JSON line from: ${command} (exit ${r.exitCode})` }
  try {
    return JSON.parse(line.slice('ORCH_JSON '.length))
  } catch {
    return { ok: false, error: `unreadable ORCH_JSON from: ${command}` }
  }
}
const state = (argv, label) => runner('orch-state.mjs', argv, label)
const roleArg = (results) => results.filter(Boolean).filter((r) => r.role && r.model).map((r) => `${r.role}=${r.model}/${r.effort ?? ''}`).join(',')
async function setPlan(nnn, fields, results = []) {
  const argv = ['set', '--run', RUN, '--plan', nnn]
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) argv.push(`--${k}`, String(v))
  const roles = roleArg(results)
  if (roles) argv.push('--roles', roles)
  return state(argv, `state ${nnn} ${fields.state ?? ''}`)
}
const note = (text, nnn) => state(['note', '--run', RUN, ...(nnn ? ['--plan', nnn] : []), '--text', text], `note ${nnn ?? ''}`)

let mergeFolder = null

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
  const results = await parallel(plans.map((nnn) => () => agent([
    `Readiness check for one plan of orchestrator run ${RUN}. Follow .claude/agents/orch-readiness.md; return one entry in plans.`,
    task({ PLAN: order.plans[nnn]?.path ?? nnn, RUN_ORDER: order.waves, RUN_PLANS: plans }),
  ].join('\n\n'), { agentType: 'orch-readiness', schema: SCHEMA.readiness, label: `readiness ${nnn}`, phase: 'Readiness' })))
  const pre = await runner('orch-preflight.mjs', ['--run', RUN], 'preflight')
  const out = plans.map((nnn, i) => {
    const r = results[i]
    const p = r?.plans?.[0]
    if (!p) return { nnn, state: 'questions', questions: ['The readiness agent returned no result for this plan — check it by hand.'], envNeeds: [], commands: [] }
    const denied = p.commands.filter((c) => DENY.test(c))
    return { nnn, path: order.plans[nnn]?.path, state: p.state, questions: p.questions, envNeeds: p.envNeeds, commands: p.commands.filter((c) => !DENY.test(c)), denied, model: r.model }
  })
  return { mode: 'readiness', run: RUN, ok: true, waves: order.waves, skipped: order.skipped, plans: out, preflight: pre }
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
  ].filter(Boolean).join('\n\n')
  const opts = { schema: SCHEMA.builder, label: `builder ${ctx.nnn} ${ctx.tier} ${mode}`, phase: 'Build' }
  if (!judgment) return agent(prompt, { ...opts, agentType: 'orch-builder' })
  // The judgment tier: the role agent file on the judgment model; "inherit" = the main session's model, so the role
  // file is given as instructions to a default agent (an agentType would pin the build model).
  if (MODELS.judgment === 'inherit') return agent(`Read .claude/agents/orch-builder.md and follow it as your instructions.\n\n${prompt}`, { ...opts, effort: 'high' })
  return agent(prompt, { ...opts, agentType: 'orch-builder', model: MODELS.judgment, effort: 'high' })
}

async function gate(ctx) {
  const r = await agent([
    `Gate for plan ${ctx.nnn} of run ${RUN}. Follow .claude/agents/orch-gate.md.`,
    task({ FOLDER: ctx.wt.path, COMMANDS: ctx.checks }),
  ].join('\n\n'), { agentType: 'orch-gate', schema: SCHEMA.gate, label: `gate ${ctx.nnn}`, phase: 'Build', effort: 'low' })
  if (!r) return { r, env: true, why: 'the gate agent returned nothing' }
  const env = r.results.filter((x) => x.status === 'env-fail')
  const failed = r.results.filter((x) => x.status === 'fail')
  if (env.length) return { r, env: true, why: `gate env-fail: ${env.map((x) => x.command).join(', ')}` }
  // pass is computed from the results, never read from the agent
  if (failed.length || !r.results.length) {
    return { r, fail: true, why: `gate: ${failed.map((x) => x.command).join(', ') || 'no check ran'}`, check: failed[0]?.command, tail: failed[0]?.tail,
      findings: failed.map((x, i) => ({ id: `gate-${i + 1}`, file: x.command, line: 1, rule: 'check fails', reasoning: x.tail ?? '', severity: 'blocker' })) }
  }
  return { r }
}

async function checkers(ctx) {
  const diff = await state(['diff', '--run', RUN, '--plan', ctx.nnn], `diff ${ctx.nnn}`)
  if (!diff.ok) return { env: !!diff.envFailure, fail: !diff.envFailure, why: `diff: ${diff.error}`, findings: [] }
  const roles = diff.sensitive ? [...FINDERS, 'orch-security'] : FINDERS
  const base = task({ PLAN: ctx.info.path, BRANCH: `origin/${ctx.info.branch}`, BASE: `origin/${RUN_BRANCH}`, FOLDER: ctx.wt.path, FILES: diff.files })
  const found = await parallel(roles.map((role) => () => agent(`Check plan ${ctx.nnn} of run ${RUN}. Follow .claude/agents/${role}.md.\n\n${base}`,
    { agentType: role, schema: SCHEMA.finder, label: `${role.replace('orch-', '')} ${ctx.nnn}`, phase: 'Build' })))
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
  const v = await agent(`Verify the candidate problems of plan ${ctx.nnn} of run ${RUN}. Follow .claude/agents/orch-verify.md.\n\n${task({ PLAN: ctx.info.path, BRANCH: `origin/${ctx.info.branch}`, BASE: `origin/${RUN_BRANCH}`, FOLDER: ctx.wt.path, CANDIDATES: candidates })}`,
    { agentType: 'orch-verify', schema: SCHEMA.verify, label: `verify ${ctx.nnn}`, phase: 'Build' })
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
async function ui(ctx) {
  const cards = ctx.uiCards ?? []
  if (!cards.length && A.ui !== true) return {}
  const record = (c, status, via, shots) => setPlan(ctx.nnn, { round: ctx.round, card: c.card, 'card-status': status, page: c.page || undefined, shots: (shots ?? []).filter(Boolean).join(',') || undefined, via })
  const results = []
  const scripted = cards.filter((c) => c.test && !DENY.test(c.test))
  const failed = []
  const passed = []
  if (scripted.length) {
    const g = await agent([
      `UI gate for plan ${ctx.nnn} of run ${RUN}: run each [ui] card's own e2e test. Follow .claude/agents/orch-gate.md.`,
      task({ FOLDER: ctx.wt.path, COMMANDS: scripted.map((c) => c.test) }),
    ].join('\n\n'), { agentType: 'orch-gate', schema: SCHEMA.gate, label: `ui-gate ${ctx.nnn}`, phase: 'Build', effort: 'low' })
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
  const pre = await runner('orch-preflight.mjs', preArgs, `ui env ${ctx.nnn}`)
  if (!pre.ok) return { results, blocked: true, why: `UI environment blocked before the browser step: ${(pre.problems ?? [pre.error]).join('; ')}` }
  const known = [...failed.map((c) => `${c.card}: its script failed — ${c.tail}`), ...(ctx.knownFindings ?? [])]
  const r = await agent(`UI cards of plan ${ctx.nnn} of run ${RUN}. Follow .claude/agents/orch-ui.md, and give each card the page URL it was checked on in \`page\`.\n\n${task({
    PLAN: ctx.info.path, FOLDER: ctx.wt.path, SCREENSHOTS: `.claude/sessions/orch-${RUN}/screens-${ctx.nnn}`,
    CARDS: cards.length ? forBrowser.map((c) => ({ card: c.card, page: c.page, scriptFailed: failed.includes(c) })) : undefined,
    PRE_CHECKED: passed.length ? passed.map((c) => c.card) : undefined,
    KNOWN_FINDINGS: known.length ? known : undefined,
  })}`, { agentType: 'orch-ui', schema: SCHEMA.ui, label: `ui ${ctx.nnn}`, phase: 'Build' })
  if (!r) return { results, fail: true, why: 'the UI agent returned nothing', findings: [] }
  results.push(r)
  // Each card result (page, status, screenshot paths) goes into status.json: the run report's grid by page.
  for (const c of r.cards) await record({ card: c.card, page: c.page || forBrowser.find((x) => x.card === c.card)?.page }, c.status, 'browser', c.screenshots)
  const drift = r.cards.filter((c) => c.status === 'plan-drift')
  if (drift.length) await note(`plan drift (not a bug, no fix round): ${drift.map((c) => c.card).join('; ')}`, ctx.nnn)
  const bad = r.cards.filter((c) => c.status === 'fail')
  if (bad.length) return { results, fail: true, why: `ui: ${bad.map((c) => `${c.card} fail`).join('; ')}`, findings: bad.map((c, i) => ({ id: `ui-${i + 1}`, file: c.card, line: 1, rule: 'ui fail', reasoning: c.screenshots.join(', '), severity: 'major' })) }
  return { results }
}

async function merge(ctx) {
  return serial(async () => {
    await setPlan(ctx.nnn, { state: 'merging', round: ctx.round })
    const subject = `Merge ${ctx.info.branch} into ${RUN_BRANCH} (plan ${ctx.nnn})`
    const r = await agent([
      `Merge plan ${ctx.nnn} into run branch ${RUN_BRANCH}. Follow .claude/agents/orch-merge.md, with the checks below run before the push:`,
      task({ RUN_BRANCH, PLAN_BRANCH: ctx.info.branch, PLAN_NUMBER: ctx.nnn, MERGE_FOLDER: ctx.mergeFolder, SUBJECT: subject, CHECKS: ctx.checks }),
      `Steps: git fetch origin; git merge --ff-only origin/${RUN_BRANCH}; git merge --no-ff --no-commit origin/${ctx.info.branch}; run each CHECKS command (output to a temp file); all pass → git commit -m "${subject}" and push ${RUN_BRANCH}; a conflict or a failing check → git merge --abort and return merged: false with the reason. Never touch the main branch.`,
    ].join('\n\n'), { agentType: 'orch-merge', schema: SCHEMA.merge, label: `merge ${ctx.nnn}`, phase: 'Build' })
    if (!r) return { env: true, why: 'the merge agent returned nothing' }
    if (!r.merged) return { r, env: !!r.envFailure, fail: !r.envFailure, why: `merge: ${r.reason ?? 'not merged'}`,
      findings: [{ id: 'merge-1', file: RUN_BRANCH, line: 1, rule: 'merge into the run branch', reasoning: `${r.reason ?? ''} — merge origin/${RUN_BRANCH} into your branch, resolve, rerun the checks`, severity: 'blocker' }] }
    const clean = await state(['clean', '--run', RUN], 'merge folder clean')
    if (!clean.ok) return { r, stopRun: `merge folder not clean after merging ${ctx.nnn}: ${clean.error}`, merged: true }
    return { r, merged: true, sha: r.sha }
  })
}

async function envCheck(ctx, why) {
  await setPlan(ctx.nnn, { state: 'env-paused', round: ctx.round, reason: why })
  const r = await runner('orch-preflight.mjs', ['--env-only'], `env check ${ctx.nnn}`)
  return r
}

async function runPlan(nnn) {
  const info = await state(['plan-info', '--run', RUN, '--plan', nnn], `plan ${nnn}`)
  if (!info.ok) return { nnn, state: 'parked', reason: `plan-info: ${info.error}` }
  const ctx = { nnn, info, tier: info.startTier, round: 0, escalated: false, checks: [...PROJECT_CHECKS, ...((A.checks ?? {})[nnn] ?? []).filter((c) => !DENY.test(c))], handoff: `.claude/sessions/orch-${RUN}/handoff-${nnn}.md` }
  if (info.startTier === 'judgment') await note(`starts on the judgment tier: Architecture Impact names ${info.invariants.join(', ')}`, nnn)
  const park = async (reason) => {
    await setPlan(nnn, { state: 'parked', round: ctx.round, tier: ctx.tier, reason })
    return { nnn, state: 'parked', reason, round: ctx.round }
  }
  let wt = await state(['worktree', '--run', RUN, '--plan', nnn], `worktree ${nnn}`)
  if (!wt.ok && wt.envFailure) {
    const env = await envCheck(ctx, wt.error)
    if (!env.ok) return park(`environment: ${(env.problems ?? [env.error]).join('; ')}`)
    wt = await state(['worktree', '--run', RUN, '--plan', nnn], `worktree ${nnn} retry`)
  }
  if (!wt.ok) return park(`worktree: ${wt.error}`)
  ctx.wt = wt
  ctx.mergeFolder = mergeFolder
  let mode = 'first'
  let findings = []
  let envRetried = false
  for (;;) {
    await setPlan(nnn, { state: ctx.round ? 'fixing' : 'building', round: ctx.round, tier: ctx.tier })
    const b = await builder(ctx, mode, findings)
    let failure = null
    let results = [b]
    if (!b) failure = { why: 'the builder returned nothing', escalate: true }
    else if (b.envFailure) failure = { env: true, why: `builder: ${b.blocker ?? 'environment failure'}` }
    else if (b.status !== 'built') failure = { why: `builder ${b.status}: ${b.blocker ?? ''}`, escalate: true }
    else if (b.branch !== ctx.info.branch) failure = { why: `builder pushed ${b.branch}, expected ${ctx.info.branch}`, findings: [] }
    if (b?.status === 'built' && Array.isArray(b.uiCards)) ctx.uiCards = b.uiCards
    if (!failure) {
      await setPlan(nnn, { state: 'gate', round: ctx.round, tier: ctx.tier, sha: b.headSha }, results)
      results = []
      const g = await gate(ctx)
      results.push(g.r)
      if (g.env || g.fail) failure = g
      else {
        await setPlan(nnn, { state: 'checking', round: ctx.round }, results)
        results = []
        const c = await checkers(ctx)
        results.push(...(c.results ?? []))
        if (c.env || c.fail) failure = c
        else {
          const u = await ui(ctx)
          results.push(...(u.results ?? []))
          if (u.blocked) {
            // A blocked UI environment stops before the browser agent and costs no fix round: the plan is parked with
            // the reason, for the Human to fix the environment and relaunch.
            await setPlan(nnn, { round: ctx.round }, results)
            return park(u.why)
          }
          if (u.env || u.fail) failure = u
          else {
            await setPlan(nnn, { state: 'checking', round: ctx.round }, results)
            results = []
            const m = await merge(ctx)
            if (m.r) results.push(m.r)
            if (m.merged) {
              await setPlan(nnn, { state: 'merged', round: ctx.round, tier: ctx.tier, sha: m.sha, reason: m.stopRun }, results)
              return { nnn, state: 'merged', sha: m.sha, round: ctx.round, stopRun: m.stopRun }
            }
            failure = m
          }
        }
      }
    }
    if (results.length) await setPlan(nnn, { round: ctx.round }, results)
    if (failure.env) {
      // An environment failure never costs a fix round: pause, check the environment, retry once, else stop.
      if (envRetried) return park(`environment, again after one retry: ${failure.why}`)
      envRetried = true
      const env = await envCheck(ctx, failure.why)
      if (!env.ok) return park(`environment: ${(env.problems ?? [env.error]).join('; ')}`)
      await note(`environment failure (${failure.why}); the environment check passed, retried once without a fix round`, nnn)
      mode = 'env-retry'
      continue
    }
    // A real failure: back to a builder per the escalation rule, or park.
    if (ctx.round >= MAX_FIX_ROUNDS || (ctx.tier === 'judgment' && ctx.escalated)) return park(`${failure.why} (fix rounds used: ${ctx.round} of ${MAX_FIX_ROUNDS})`)
    ctx.round += 1
    findings = failure.findings ?? []
    ctx.knownFindings = findings.filter((f) => /^ui-/.test(f.id)).map((f) => `${f.file}: ${f.reasoning}`)
    if (failure.escalate || ctx.round >= 2) {
      // A persisting failure, an ESCALATE / blocked builder or a second finding: a fresh builder on the judgment tier.
      const w = await state(['handoff', '--run', RUN, '--plan', nnn, '--step', `round ${ctx.round}`, '--check', failure.check ?? failure.why, '--tail', failure.tail ?? failure.why, '--tried', `${ctx.tier} builder, mode ${mode}`], `handoff ${nnn}`)
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
  const pre = await runner('orch-preflight.mjs', ['--run', RUN], 'preflight')
  if (!pre.ok) return { mode: 'run', run: RUN, ok: false, stopped: 'preflight', problems: pre.problems ?? [pre.error] }
  const init = await state(['init', '--run', RUN, ...(A.startedAt ? ['--started', A.startedAt] : [])], 'start run')
  if (!init.ok) return { mode: 'run', run: RUN, ok: false, stopped: 'init', problems: [init.error] }
  mergeFolder = init.mergeFolder
  const order = await state(['order', '--run', RUN, '--plans', PLANS.join(',')], 'plan order')
  if (!order.ok) {
    await state(['stop', '--run', RUN, '--reason', `plan order: ${order.error}`])
    return { mode: 'run', run: RUN, ok: false, stopped: 'order', problems: [order.error] }
  }
  if (order.skipped?.length) log(`already merged into ${RUN_BRANCH} (from git): ${order.skipped.join(', ')}`)
  phase('Build')
  const outcomes = []
  let stopReason = null
  for (let w = 0; w < order.waves.length; w++) {
    const wave = order.waves[w]
    log(`wave ${w + 1}: ${wave.join(', ')}`)
    // Plans in one lock group (overlapping scope) run one after the other; the rest of the wave runs in parallel.
    const groups = (order.waveLocks?.[w] ?? []).map((g) => g.plans.filter((p) => wave.includes(p)))
    const grouped = new Set(groups.flat())
    const units = [...groups, ...wave.filter((p) => !grouped.has(p)).map((p) => [p])]
    const done = await parallel(units.map((unit) => async () => {
      const out = []
      for (const nnn of unit) out.push(await runPlan(nnn))
      return out
    }))
    const flat = done.flatMap((d, i) => d ?? units[i].map((nnn) => ({ nnn, state: 'parked', reason: 'the plan pipeline stopped with an error' })))
    outcomes.push(...flat)
    const stop = flat.find((o) => o.stopRun)
    const parked = flat.filter((o) => o.state !== 'merged')
    if (stop || parked.length) {
      stopReason = stop ? stop.stopRun : `wave ${w + 1} parked ${parked.map((p) => p.nnn).join(', ')} — later waves not started`
      const later = order.waves.slice(w + 1).flat()
      for (const nnn of later) {
        await setPlan(nnn, { state: 'skipped', reason: `not started: ${stopReason}` })
        outcomes.push({ nnn, state: 'skipped' })
      }
      await state(['stop', '--run', RUN, '--reason', stopReason])
      break
    }
  }
  phase('Report')
  const fin = await state(['finish', '--run', RUN], 'report')
  return {
    mode: 'run', run: RUN, ok: !!fin.ok, branch: RUN_BRANCH, stopReason,
    merged: fin.merged ?? [], parked: fin.parked ?? [], report: fin.report, local: fin.local, outcomes,
  }
}

return MODE === 'readiness' ? readiness() : run()
