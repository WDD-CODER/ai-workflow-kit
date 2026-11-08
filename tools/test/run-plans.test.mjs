// Plan 088: scripts/run-plans.mjs — the orchestrator as one script, with the builder and the reviewer as headless calls.
// The installed scripts run in a scratch project (tools/test/lib/run-plans-fixture.mjs) with a fake `claude`
// (tools/test/fixtures/fake-claude.mjs): every model call is scripted and logged with its argv and folder.
//   node --test tools/test/run-plans.test.mjs
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve, basename } from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { makeProject, toyPlan, overlaps, FAKE } from './lib/run-plans-fixture.mjs'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const lib = (f) => import(pathToFileURL(join(kit, 'scripts', 'lib', f)).href)
const { claudeArgs, runAgent, readAgent, CONTEXT_FLAGS, RATE_LIMIT_RE, parseResult, passedModel } = await lib('claude-run.mjs')
const { gateCommands, runGate, scopeCheck, scopeMarker } = await lib('plan-gate.mjs')
const { readReview, review, validateReviewerResult, reviewVerdict } = await lib('plan-review.mjs')
const { blockedBy, unitsOf, afterPark } = await lib('run-order.mjs')
const runPlans = await import(pathToFileURL(join(kit, 'scripts', 'run-plans.mjs')).href)

// ---- the pure parts ---------------------------------------------------------------------------------------------
test('claude-run: every call carries the four context-saving flags, json output, the model and the agent\'s tools', () => {
  const builder = readAgent(join(kit, '.claude', 'agents', 'orch-builder.md'))
  const reviewer = readAgent(join(kit, '.claude', 'agents', 'plan-reviewer.md'))
  const b = claudeArgs({ agent: builder, model: 'sonnet', systemPromptFile: 's.md', allow: true, settings: 'C:/run/builder-settings.json' })
  for (const f of ['-p', '--setting-sources', 'local', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence']) assert.ok(b.includes(f), f)
  assert.deepEqual(CONTEXT_FLAGS, ['--setting-sources', 'local', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence'])
  assert.equal(b[b.indexOf('--output-format') + 1], 'json')
  assert.equal(b[b.indexOf('--model') + 1], 'sonnet')
  assert.equal(b[b.indexOf('--system-prompt-file') + 1], 's.md')
  assert.equal(b[b.indexOf('--tools') + 1], 'Read,Edit,Write,Bash,Grep,Glob')
  assert.ok(!b.includes('--disallowedTools'), 'the builder writes')
  const r = claudeArgs({ agent: reviewer, model: reviewer.model, systemPromptFile: 's.md', allow: true })
  assert.equal(r[r.indexOf('--tools') + 1], 'Read,Grep,Glob,Bash')
  assert.equal(r[r.indexOf('--disallowedTools') + 1], 'Edit,Write,MultiEdit,NotebookEdit')
  assert.ok(!claudeArgs({ agent: reviewer, model: 'inherit', systemPromptFile: 's.md' }).includes('--model'))
  // calls.csv records the model passed after --model; a call without one ("inherit") keeps the fallback.
  assert.equal(passedModel(b), 'sonnet')
  assert.equal(passedModel(claudeArgs({ agent: reviewer, model: 'inherit', systemPromptFile: 's.md' }), 'inherit'), 'inherit')
  assert.equal(passedModel([], ''), '')
})

test('claude-run: tools are pre-approved only when asked; the builder gets its list, a read-only agent never a bare Bash', () => {
  const builder = readAgent(join(kit, '.claude', 'agents', 'orch-builder.md'))
  const reviewer = readAgent(join(kit, '.claude', 'agents', 'plan-reviewer.md'))
  for (const agent of [builder, reviewer]) assert.ok(!claudeArgs({ agent, model: 'x', systemPromptFile: 's.md' }).includes('--allowedTools'), `${agent.name}: off by default`)
  const g = claudeArgs({ agent: builder, model: 'x', systemPromptFile: 's.md', allow: true, settings: 'C:/run/builder-settings.json' })
  assert.equal(g[g.indexOf('--settings') + 1], 'C:/run/builder-settings.json')
  assert.equal(g[g.indexOf('--allowedTools') + 1], 'Read,Edit,Write,Grep,Glob,Bash', 'with the guard hooks loaded the builder keeps a bare Bash')
  const r = claudeArgs({ agent: reviewer, model: 'x', systemPromptFile: 's.md', allow: true })
  const allowed = r[r.indexOf('--allowedTools') + 1].split(',')
  assert.ok(!allowed.includes('Bash'), 'no bare Bash for the reviewer')
  assert.equal(r[r.indexOf('--disallowedTools') + 1], 'Edit,Write,MultiEdit,NotebookEdit')
})

test('095 (d) the reviewer is pre-approved no Bash: no node --test, and no git diff / git show (a prefix cannot refuse --output or --no-index)', async () => {
  const { READ_ONLY_BASH, allowedTools } = await lib('claude-run.mjs')
  const reviewer = readAgent(join(kit, '.claude', 'agents', 'plan-reviewer.md'))
  assert.deepEqual(READ_ONLY_BASH, [])
  const r = claudeArgs({ agent: reviewer, model: 'x', systemPromptFile: 's.md', allow: true })
  const allowed = r[r.indexOf('--allowedTools') + 1].split(',')
  assert.deepEqual(allowed, ['Read', 'Grep', 'Glob'])
  assert.ok(!allowed.some((t) => /node --test|git diff|git show|^Bash/.test(t)), allowed.join(','))
  assert.deepEqual(allowedTools(reviewer), ['Read', 'Grep', 'Glob'])
})

test('095 (e) allowedTools() refuses a writing agent without guard hooks; with them it keeps a bare Bash; BUILDER_BASH is gone', async () => {
  const m = await lib('claude-run.mjs')
  const builder = readAgent(join(kit, '.claude', 'agents', 'orch-builder.md'))
  assert.equal('BUILDER_BASH' in m, false)
  assert.throws(() => m.allowedTools(builder), /refusing to start it unguarded/)
  assert.throws(() => claudeArgs({ agent: builder, model: 'x', systemPromptFile: 's.md', allow: true }), /unguarded/)
  assert.deepEqual(m.allowedTools(builder, { guarded: true }), ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash'])
  // the run refuses before anything starts: no guard hooks, no builder
  const src = readFileSync(join(kit, 'scripts', 'run-plans.mjs'), 'utf8')
  assert.match(src, /a builder never runs without guard hooks/)
})

test('095 reviewModeFor: a sensitive diff is gate whatever was asked; a non-sensitive diff keeps the asked mode', () => {
  const s = (f) => /guard|auth/.test(f)
  assert.deepEqual(runPlans.reviewModeFor({ asked: 'advisory', files: ['src/a.ts'], sensitive: s }), { mode: 'advisory', sensitive: [], note: null })
  const g = runPlans.reviewModeFor({ asked: 'advisory', files: ['src/a.ts', 'src/auth/guard.ts'], sensitive: s })
  assert.equal(g.mode, 'gate')
  assert.deepEqual(g.sensitive, ['src/auth/guard.ts'])
  assert.match(g.note, /sensitive path \(src\/auth\/guard\.ts\)/)
  assert.equal(runPlans.reviewModeFor({ asked: 'gate', files: [], sensitive: s }).mode, 'gate')
  // the default check is ship-prep's (security.sensitivePaths included)
  assert.equal(runPlans.reviewModeFor({ asked: 'advisory', files: ['src/app/core/guards/x.ts'] }).mode, 'gate')
  assert.equal(runPlans.reviewModeFor({ asked: 'advisory', files: ['src/451.txt'] }).mode, 'advisory')
})

test('claude-run: runAgent pre-approves nothing by default, and refuses a folder that brings its own .claude/settings.local.json', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rp-set-'))
  try {
    const bin = join(tmp, 'answer.mjs')
    writeFileSync(bin, `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(join(tmp, 'spawned.txt'))}, 'x')\nprocess.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({ result: 'ok', usage: {} })))\n`)
    const agentFile = join(kit, '.claude', 'agents', 'plan-reviewer.md')
    const plain = await runAgent({ agentFile, model: 'opus', cwd: tmp, prompt: 'x', bin })
    assert.equal(plain.ok, true, plain.error)
    assert.ok(!plain.argv.includes('--allowedTools'))
    const review = join(tmp, 'review')
    mkdirSync(join(review, '.claude'), { recursive: true })
    writeFileSync(join(review, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash'] } }))
    rmSync(join(tmp, 'spawned.txt'))
    const r = await runAgent({ agentFile, model: 'opus', cwd: review, prompt: 'x', bin, allow: true, trustCwdSettings: false })
    assert.deepEqual([r.ok, r.refused], [false, true])
    assert.match(r.error, /settings\.local\.json exists in the folder under review/)
    assert.equal(existsSync(join(tmp, 'spawned.txt')), false, 'nothing was spawned')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('plan-gate: the scope check is the kit\'s own code — a branch that rewrites its scripts/scope-check.mjs still fails with SCOPE: out', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rp-scope-'))
  const g = (...a) => spawnSync('git', a, { cwd: tmp, encoding: 'utf8' })
  try {
    g('init', '-q', '-b', 'main')
    g('config', 'user.email', 't@t')
    g('config', 'user.name', 't')
    mkdirSync(join(tmp, 'scripts'), { recursive: true })
    mkdirSync(join(tmp, 'plans'), { recursive: true })
    const plan = toyPlan(1)
    writeFileSync(join(tmp, 'plans', '001-toy.plan.md'), plan)
    writeFileSync(join(tmp, 'scripts', 'scope-check.mjs'), 'process.exit(1)\n')
    g('add', '-A')
    g('commit', '-q', '-m', 'base')
    const base = g('rev-parse', 'HEAD').stdout.trim()
    mkdirSync(join(tmp, 'src'))
    writeFileSync(join(tmp, 'src', '1.txt'), 'x\n')
    writeFileSync(join(tmp, 'scripts', 'scope-check.mjs'), "console.log('SCOPE: ok'); process.exit(0)\n")
    g('add', '-A')
    g('commit', '-q', '-m', 'tampered')
    const marker = scopeMarker(base, 'plans/001-toy.plan.md')
    const builtins = { [marker]: () => scopeCheck({ folder: tmp, base, planText: plan, planPath: 'plans/001-toy.plan.md' }) }
    const r = await runGate({ folder: tmp, commands: [marker], builtins, receipt: false })
    assert.equal(r.status, 'fail')
    assert.match(r.results[0].tail, /^SCOPE: out scripts\/scope-check\.mjs$/m)
    assert.doesNotMatch(r.results[0].tail, /SCOPE: out src\/1\.txt/, 'the plan\'s own file is in scope')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('claude-run: a rate or usage limit is recognised; the recorded headless answer parses', async () => {
  for (const t of ["You've hit your 5-hour limit", 'API Error: 429 rate_limit_error', 'Claude usage limit reached']) assert.match(t, RATE_LIMIT_RE)
  assert.doesNotMatch('the toy check failed', RATE_LIMIT_RE)
  const ok = JSON.parse(readFileSync(join(kit, 'tools', 'test', 'fixtures', 'claude-p-ok.json'), 'utf8'))
  assert.equal(ok.result, 'ok')
  assert.equal(ok.is_error, false)
  // A fake that answers like the recorded one, then like a limit.
  const tmp = mkdtempSync(join(tmpdir(), 'rp-cr-'))
  try {
    const bin = join(tmp, 'answer.mjs')
    writeFileSync(bin, `process.stdin.resume(); process.stdin.on('end', () => { process.stdout.write(${JSON.stringify(JSON.stringify(ok))}) })\n`)
    const a = await runAgent({ agentFile: join(kit, '.claude', 'agents', 'plan-reviewer.md'), model: 'opus', cwd: tmp, prompt: 'x', bin })
    assert.equal(a.ok, true, a.error)
    assert.equal(a.text, 'ok')
    assert.deepEqual(a.tokens, { input: 2 + 26286, output: 4 })
    writeFileSync(bin, "process.stdin.resume(); process.stdin.on('end', () => { console.log(JSON.stringify({ is_error: true, api_error_status: 429, result: \"You've hit your 5-hour limit\" })); process.exit(1) })\n")
    const l = await runAgent({ agentFile: join(kit, '.claude', 'agents', 'plan-reviewer.md'), model: 'opus', cwd: tmp, prompt: 'x', bin })
    assert.equal(l.ok, false)
    assert.equal(l.rateLimited, true)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('plan-review: the verdict is computed from blocker/major problems, never taken from the model', async () => {
  const p = (severity) => ({ id: 'r1', file: 'a.mjs', line: 3, rule: 'wrong result: x', reasoning: 'y', severity })
  assert.equal(reviewVerdict([p('minor')]), 'PASS')
  assert.equal(reviewVerdict([p('major')]), 'STOP')
  const lying = { role: 'plan-reviewer', model: 'm', effort: 'high', problems: [p('major')], verdict: 'PASS' }
  assert.match(validateReviewerResult(lying).errors.join(), /never trusted/)
  const read = readReview(`\`\`\`json\n${JSON.stringify(lying)}\n\`\`\``)
  assert.equal(read.verdict, 'STOP', 'the problems decide')
  assert.equal(readReview('no json').verdict, 'STOP')
  const call = async () => ({ ok: true, text: JSON.stringify({ ...lying, verdict: 'STOP', pass: false }) })
  const advisory = await review({ mode: 'advisory', call, nnn: '1', run: 'r', planText: '', base: 'b', branch: 'c', diffText: '', receipt: null })
  assert.deepEqual([advisory.verdict, advisory.enforced], ['STOP', false])
  assert.match(advisory.note, /advisory review STOP \(not enforced\)/)
  const gate = await review({ mode: 'gate', call, nnn: '1', run: 'r', planText: '', base: 'b', branch: 'c', diffText: '', receipt: null })
  assert.deepEqual([gate.verdict, gate.enforced], ['STOP', true])
})

test('plan text: open Critical Questions and the [auto] commands are read by script', () => {
  assert.deepEqual(runPlans.openQuestions(toyPlan(1, { question: 'Which folder?' })), ['Which folder?'])
  assert.deepEqual(runPlans.openQuestions(toyPlan(1)), [])
  assert.deepEqual(runPlans.openQuestions('## Critical Questions\n- Q: one?\n  A: open — the Human decides\n- Q: two? A: yes\n'), ['one?'])
  assert.deepEqual(runPlans.autoCommands('## Goals & Success Criteria\n- [auto] `node --test a.test.mjs` passes\n- [x] [auto] `node done.mjs`\n- [auto:main] `node main.mjs`\n- [human] `node h.mjs`\n'), ['node --test a.test.mjs'])
  assert.match(runPlans.checkProblem('node scripts/run-plans.mjs --dry-run'), /not a check/)
  assert.equal(runPlans.checkProblem('node --test tools/test/x.test.mjs'), null)
})

// ---- plan 097: the Human's decisions and the two hard limits ----------------------------------------------------
const DECISIONS = [
  '# Human decisions', '', '## 1. Decisions (chronological)', '',
  '| id | date | situation | suggested | the Human decided | reason | kind | status | ev |',
  '|---|---|---|---|---|---|---|---|---|',
  '| D04 | 10-21 | a | b | c | d | model-choice | in force | [H] |',
  '| D17 | 11-01 | a | b | c | d | data-env | superseded by D18 | [H] |',
  '| D18 | 11-02 | a | b | c | d | data-env | in force (goal step 3) | [H] |',
  '| D26 | 11-03 | a | b | c | d | learning | 071; frozen (D29.7) | [H] |',
  '| D30 | 11-04 | a | b | c | d | learning | open (and frozen by D29.7) | [S] |',
  '', '## 2. Standing rules', '- R1 not a table',
].join('\n')
const withQuestion = (nnn, line) => toyPlan(nnn).replace('- Q: anything open? A: no', line)
const withExecution = (plan, ...lines) => plan.replace('## Read-Write Scope', `## Execution Mode\n${lines.join('\n')}\n\n## Read-Write Scope`)

test('097 (a)(b) an A: default per D<n> answer stands only while D<n> is in force in human-decisions.md', () => {
  const st = runPlans.decisionStatuses(DECISIONS)
  assert.equal(st.get('D18'), 'in force (goal step 3)')
  assert.equal(st.get('D17'), 'superseded by D18')
  assert.equal(st.size, 5, 'only the Decisions table, never a later section')
  for (const id of ['D4', 'D04', 'd004']) assert.deepEqual(runPlans.decisionProblems(withQuestion(1, `- Q1: Escalate after? A: default per ${id} — one failure`), st), [], `${id} is the table's D04`)
  assert.deepEqual(runPlans.decisionProblems(withQuestion(1, '- Q1: Start the server? A: default per D18 — start what is missing'), st), [])
  for (const [id, status] of [['D17', 'superseded by D18'], ['D26', '071; frozen (D29.7)'], ['D30', 'open (and frozen by D29.7)'], ['D44', 'not recorded']]) {
    const probs = runPlans.decisionProblems(withQuestion(1, `- Q1: Start the server? A: default per ${id} — x`), st)
    assert.equal(probs.length, 1, id)
    assert.ok(probs[0].startsWith(`default per ${id}: decision is ${status} — ask the Human`), probs[0])
  }
  // (b) no human-decisions.md: a default answer is refused the same way, never a silent pass
  const none = runPlans.decisionProblems(withQuestion(1, '- Q1: Start the server? A: default per D18 — x'), null)
  assert.equal(none.length, 1)
  assert.match(none[0], /^default per D18: decision is unknown \(no docs\/brain\/human-decisions\.md\) — ask the Human/)
  // an answer the Human gave, or no default named, is not checked
  assert.deepEqual(runPlans.decisionProblems(withQuestion(1, '- Q1: Start the server? A: (Human, 2026-11-08) yes'), null), [])
})

test('097 (c) a run option above the plan\'s own Execution Mode lines is refused; a config default of advisory runs the plan on gate', () => {
  const plain = toyPlan(1)
  const opts = { concurrency: 1, reviewerMode: 'gate', reviewerModeSet: false, db: 'local' }
  const run = ['001', '002']
  assert.deepEqual(runPlans.optionProblems({ nnn: '001', planText: plain, opts, runPlans: run }), { problems: [], reviewerMode: 'gate', notes: [] })
  // concurrency 2: only a Concurrent plans line naming another plan of the same run asks for it
  const c2 = { ...opts, concurrency: 2 }
  const refusedC = 'more autonomy than plan 001 asks for: --concurrency 2'
  assert.deepEqual(runPlans.optionProblems({ nnn: '001', planText: plain, opts: c2, runPlans: run }).problems, [refusedC])
  assert.deepEqual(runPlans.optionProblems({ nnn: '001', planText: withExecution(plain, '- Parallel: no. Concurrent plans: none.'), opts: c2, runPlans: run }).problems, [refusedC])
  assert.deepEqual(runPlans.optionProblems({ nnn: '001', planText: withExecution(plain, '- Concurrent plans: 009'), opts: c2, runPlans: run }).problems, [refusedC], 'a plan outside the run')
  assert.deepEqual(runPlans.optionProblems({ nnn: '001', planText: withExecution(plain, '- Parallel: yes. CONCURRENT PLANS: 002.'), opts: c2, runPlans: run }).problems, [])
  assert.deepEqual(runPlans.optionProblems({ nnn: '001', planText: plain.replace('## Atomic Sub-tasks', 'Concurrent plans: 002\n\n## Atomic Sub-tasks'), opts: c2, runPlans: run }).problems, [refusedC], 'free text asks for nothing')
  // advisory review: an explicit --reviewer-mode advisory is refused without a Reviewer: advisory line
  const adv = { ...opts, reviewerMode: 'advisory', reviewerModeSet: true }
  assert.deepEqual(runPlans.optionProblems({ nnn: '001', planText: plain, opts: adv, runPlans: run }).problems, ['more autonomy than plan 001 asks for: --reviewer-mode advisory'])
  assert.deepEqual(runPlans.optionProblems({ nnn: '001', planText: withExecution(plain, '- reviewer: ADVISORY'), opts: adv, runPlans: run }), { problems: [], reviewerMode: 'advisory', notes: [] })
  assert.equal(runPlans.optionProblems({ nnn: '001', planText: withExecution(plain, '- Reviewer: advisory later'), opts: adv, runPlans: run }).problems.length, 1, 'exact value')
  // the config default (no flag) never gives more autonomy than the plan asks for: that plan's review is enforced
  const cfg = runPlans.optionProblems({ nnn: '001', planText: plain, opts: { ...adv, reviewerModeSet: false }, runPlans: run })
  assert.deepEqual([cfg.problems, cfg.reviewerMode], [[], 'gate'])
  assert.match(cfg.notes[0], /reviewer gate for plan 001: the plan has no Reviewer: advisory line/)
  // remote database: only a Database: remote line asks for it
  const remote = { ...opts, db: 'remote' }
  assert.deepEqual(runPlans.optionProblems({ nnn: '001', planText: plain, opts: remote, runPlans: run }).problems, ['more spend/risk than plan 001 asks for: --db remote'])
  assert.deepEqual(runPlans.optionProblems({ nnn: '001', planText: withExecution(plain, '- Database: remote'), opts: remote, runPlans: run }).problems, [])
  assert.equal(runPlans.optionProblems({ nnn: '001', planText: withQuestion(1, '- Q1: Database: remote? A: (Human, 2026-11-08) yes'), opts: remote, runPlans: run }).problems.length, 1, 'a Critical Question asks for nothing')
})

test('097 (d) a production question about a database or folder needs the Human\'s own answer, never a default', () => {
  const refused = (line) => runPlans.productionProblems('001', withQuestion(1, line))
  assert.deepEqual(refused('- Q1: Is the shared DB production? A: default per D18 — no'), ['production needs an explicit Human answer (plan 001 Q1)'])
  assert.deepEqual(refused('- Q2: Does the prod-db cluster take writes? A: no, local only'), ['production needs an explicit Human answer (plan 001 Q2)'], 'an answer not marked as the Human\'s is not explicit')
  assert.deepEqual(refused('- Q1: Is the LIVE server folder touched? A: default per D22'), ['production needs an explicit Human answer (plan 001 Q1)'])
  assert.deepEqual(refused('- Q1: Is the shared DB production? A: (Human, 2026-11-08) no, it is the local dev DB'), [])
  assert.deepEqual(refused('- Q1: Which product name does the producer database use? A: default per D18'), [], 'prod inside product / producer')
  assert.deepEqual(refused('- Q1: Does the live preview reload? A: default per D18'), [], 'live with no database or folder word')
  assert.deepEqual(refused('- Q1: Is production ready? A: default per D18'), [], 'production with no database or folder word')
})

test('097 (e) the builder\'s task carries both hard limits word for word', () => {
  const prompt = runPlans.builderPrompt({ RUN: 'r', RUN_BRANCH: 'orch/r', ctx: { nnn: '001', mode: 'first', tier: 'build', round: 1, info: { branch: 'feat/001-x' }, wt: { path: 'w' }, findings: [] }, l: { path: 'plans/001-x.plan.md', checks: [] }, LESSONS: [] })
  assert.ok(prompt.includes('Never choose more autonomy or more spend than the plan asks for.'), prompt)
  assert.ok(prompt.includes('Never treat a database or folder as production without an explicit Human answer.'), prompt)
})

test('run-order: blockedBy follows dependencies and shared files; units keep a lock group in order; onPark all stops every later plan', () => {
  const edges = [{ from: '1', to: '2' }, { from: '2', to: '3' }, { from: '1', to: '4', lock: true }, { from: '4', to: '5' }]
  assert.deepEqual([...blockedBy(['1'], ['2', '3', '4', '5', '6'], edges)], [['2', 'depends on parked 1'], ['3', 'depends on parked 1'], ['4', 'shares files with parked 1'], ['5', 'depends on parked 1']])
  assert.deepEqual(unitsOf(['1', '2', '3'], [{ plans: ['1', '3'] }]), [['1', '3'], ['2']])
  const all = afterPark({ parked: ['1'], laterWaves: [['6'], ['7']], edges, onPark: 'all', why: 'x' })
  assert.deepEqual([...all.blocked.keys()], ['6', '7'])
})

test('plan-gate: the command list is prepare, project checks, manifest, scope, then the plan\'s own; a failing command is in the receipt', async () => {
  const cmds = gateCommands({ prepare: [{ missing: 'gen/x', script: 'gen' }], pm: 'npm', build: 'build', lint: 'lint', test: 'test', testCi: 'test:ci', manifest: true, kitRoot: 'C:/main folder', scope: { base: 'origin/orch/r', plan: 'plans/1-x.plan.md' }, extra: ['npm run build', 'node --test a.test.mjs'] })
  assert.deepEqual(cmds, ['node scripts/orch-state.mjs prepare --missing gen/x --script gen', 'npm run build', 'npm run lint', 'npm run test:ci', 'node "C:/main folder/scripts/kit-manifest-check.mjs" --root .', 'scope-check (kit copy) --diff=origin/orch/r --plan=plans/1-x.plan.md', 'node --test a.test.mjs'])
  const tmp = mkdtempSync(join(tmpdir(), 'rp-gate-'))
  try {
    spawnSync('git', ['init', '-q'], { cwd: tmp })
    writeFileSync(join(tmp, 'ok.mjs'), 'process.exit(0)\n')
    writeFileSync(join(tmp, 'bad.mjs'), "console.log('line one'); console.log('the last line'); process.exit(3)\n")
    const g = await runGate({ folder: tmp, commands: ['node ok.mjs', 'node bad.mjs'], timeoutMin: 1 })
    assert.equal(g.status, 'fail')
    assert.equal(g.exit, 1)
    const receipt = JSON.parse(readFileSync(join(tmp, '.claude', 'gate-receipt.json'), 'utf8'))
    assert.deepEqual(receipt.results.map((r) => [r.command, r.exit, r.status]), [['node ok.mjs', 0, 'pass'], ['node bad.mjs', 3, 'fail']])
    assert.match(receipt.results[1].tail, /the last line$/)
    assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: tmp, encoding: 'utf8' }).stdout.includes('gate-receipt'), false, 'the receipt is excluded from git')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('config: reviewerMode, reviewerModel (never Haiku) and rateLimitWaitMin are bounded; the scaffold defaults pass', async () => {
  const { orchestratorProblems } = await import(pathToFileURL(join(kit, 'tools', 'lib', 'kit.mjs')).href)
  const scaffold = JSON.parse(readFileSync(join(kit, 'kit.config.json'), 'utf8')).orchestrator
  assert.deepEqual([scaffold.reviewerMode, scaffold.reviewerModel, scaffold.rateLimitWaitMin], ['gate', 'sonnet', 30])
  assert.equal(scaffold.builderTimeoutMin, undefined, 'no wall-clock builder limit in the scaffold')
  assert.equal(scaffold.builderIdleMin, undefined, 'the idle limit is fixed in run-plans.mjs, not a setting')
  assert.deepEqual(orchestratorProblems({ 'orchestrator.reviewerMode': 'gate', 'orchestrator.reviewerModel': 'sonnet', 'orchestrator.rateLimitWaitMin': 0 }), [])
  assert.match(orchestratorProblems({ 'orchestrator.reviewerMode': 'loud' }).join(), /reviewerMode is "loud"/)
  for (const m of ['haiku', 'claude-haiku-5-5', 'gpt']) assert.match(orchestratorProblems({ 'orchestrator.reviewerModel': m }).join(), /reviewerModel/)
  for (const w of [-1, 601, 1.5, '30']) assert.match(orchestratorProblems({ 'orchestrator.rateLimitWaitMin': w }).join(), /rateLimitWaitMin/)
})

test('098 (a) [F10] the builder has no wall clock, only a fixed 15-min idle limit; the gate keeps gateTimeoutMin', () => {
  assert.equal(runPlans.BUILDER_IDLE_MIN, 15)
  const src = readFileSync(join(kit, 'scripts', 'run-plans.mjs'), 'utf8')
  assert.match(src, /runAgent\(\{ \.\.\.call\.opts, cwd: wt, prompt, timeoutMs: 0, idleMs: BUILDER_IDLE_MS, watchDir: wt,/)
  assert.doesNotMatch(src, /runAgent\(\{ \.\.\.call\.opts[^\n]*GATE_TIMEOUT_MIN/, 'the builder never gets the gate\'s timeout')
  assert.match(src, /runGate\(\{ folder: wt, commands: l\.checks, timeoutMin: GATE_TIMEOUT_MIN/)
  assert.match(src, /RUN_PLANS_BUILDER_IDLE_MS/, 'a test-only override, no setting')
})

test('098 (a) [F10] spawnClaude: a call that keeps changing files outlives the idle limit; a silent one is stopped idle', async () => {
  const { spawnClaude, newestChange } = await import(pathToFileURL(join(kit, 'scripts', 'lib', 'claude-run.mjs')).href)
  const tmp = mkdtempSync(join(tmpdir(), 'rp-idle-'))
  try {
    mkdirSync(join(tmp, 'node_modules'), { recursive: true })
    writeFileSync(join(tmp, 'node_modules', 'x.js'), '')
    assert.equal(newestChange(join(tmp, 'node_modules')) > 0, true)
    const busy = join(tmp, 'busy.mjs')
    writeFileSync(busy, "import { writeFileSync } from 'node:fs'\nlet i = 0\nconst t = setInterval(() => { writeFileSync('work.txt', String(i++)); if (i > 12) { clearInterval(t); console.log('done') } }, 150)\n")
    const silent = join(tmp, 'silent.mjs')
    writeFileSync(silent, 'setTimeout(() => console.log("late"), 20000)\n')
    const t0 = Date.now()
    const a = await spawnClaude({ bin: busy, args: [], cwd: tmp, timeoutMs: 0, idleMs: 700, watchDir: tmp, pollMs: 50 })
    assert.equal(a.idle, false, 'a builder that keeps writing is never stopped')
    assert.equal(a.code, 0)
    assert.ok(Date.now() - t0 > 1500, 'it ran longer than the idle limit')
    const b = await spawnClaude({ bin: silent, args: [], cwd: tmp, timeoutMs: 0, idleMs: 700, watchDir: tmp, pollMs: 50 })
    assert.equal(b.idle, true, 'a silent call is stopped idle')
    assert.equal(b.timedOut, false, 'no wall clock')
  } finally {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
  }
})

test('098 (b) a scope ESCALATE is recognised; a db-write ask or another blocker is not', () => {
  const r = (blocker, status = 'ESCALATE') => runPlans.isScopeEscalation({ status, blocker })
  assert.equal(r('src/other.ts is outside the Read-Write Scope'), true)
  assert.equal(r('needs approved: src/other.ts'), true)
  assert.equal(r('SCOPE_GUARD: x is outside this plan\'s Read-Write Scope', 'blocked'), true)
  assert.equal(r('ESCALATE: db-write psql -c insert …'), false)
  assert.equal(r('the build keeps failing'), false)
  assert.equal(runPlans.isScopeEscalation({ status: 'built', blocker: 'outside the scope' }), false)
})

// ---- whole runs in a scratch project ----------------------------------------------------------------------------
let p
before(() => {
  p = makeProject({ kit })
  p.addPlans({
    474: toyPlan(474), 451: toyPlan(451), 452: toyPlan(452), 453: toyPlan(453), 455: toyPlan(455, { deps: '453' }), 457: withExecution(toyPlan(457), '- Reviewer: advisory'), 458: toyPlan(458), 462: toyPlan(462),
    456: toyPlan(456), 459: toyPlan(459, { question: 'Which database does the toy write to?' }),
    463: toyPlan(463), 464: toyPlan(464, { deps: '463' }),
    465: withExecution(toyPlan(465), '- Parallel: yes. Concurrent plans: 466.'), 466: withExecution(toyPlan(466), '- Parallel: yes. Concurrent plans: 465.'),
    482: withQuestion(482, '- Q1: Start the server? A: default per D17 — start it by hand'),
    483: withQuestion(483, '- Q1: Is the shared DB production? A: default per D18 — no'),
    484: withQuestion(484, '- Q1: Start the server? A: default per D18 — start what is missing'),
    470: toyPlan(470), 471: toyPlan(471, { deps: '470' }), 472: toyPlan(472, { deps: '471' }),
    480: withImpact(toyPlan(480), '- INV-1: preserves — the toy leaves it as it is'),
    481: withImpact(toyPlan(481), '- INV-1: changes — ADR docs/brain/decisions/0099-toy.md. Arch-approved: Human 2026-11-07', 'docs/brain/decisions/0099-toy.md'),
  })
})
after(() => p?.cleanup())

/** A toy plan with its own Architecture Impact line (and one more scope line, e.g. the ADR a `changes` names). */
function withImpact(plan, line, scope = null) {
  const p = plan.replace('## Architecture Impact\n- none', `## Architecture Impact\n${line}`)
  return scope ? p.replace('```scope\n', `\`\`\`scope\n${scope}\n`) : p
}

const stagesOf = (st, nnn) => (st.plans[nnn].calls ?? []).map((c) => c.stage)
let main
test('one run of seven plans: (a) a passing plan merges --no-ff at its checked head; (b) one fix round; (c) a twice-failing gate parks and only its dependent is skipped; (d) a Reviewer: advisory STOP is enforced by default; (e) a moved branch is refused; escalation', () => {
  main = p.runPlans(['--run', 'main', '--plans', '451,452,453,455,457,458,462,474'], {
    scenario: {
      474: { builder: [{ tamper: true }, { tamper: true }] },
      452: { builder: [{ gate: 'fail', text: 'toy 452 broke' }, { gate: 'pass' }] },
      453: { builder: [{ gate: 'fail', text: 'same failure' }, { gate: 'fail', text: 'same failure' }] },
      457: { reviewer: [{ verdict: 'STOP' }] },
      458: { reviewer: [{ verdict: 'PASS', moveBranch: true }] },
      462: { builder: [{ gate: 'fail', text: 'first failure' }, { gate: 'fail', text: 'another failure' }, { gate: 'pass' }] },
    },
  })
  assert.equal(main.status, 2, main.out)
  assert.deepEqual(main.json.merged.sort(), ['451', '452', '457', '462'], main.out)
  assert.deepEqual(main.json.parked.sort(), ['453', '458', '474'])
  assert.deepEqual(main.json.skipped, ['455'])
  const st = p.status('main')
  // (a) the merge commit's second parent is the checked head
  const head = st.plans['451'].checkedHead
  assert.match(head, /^[0-9a-f]{40}$/)
  const log = p.git(p.proj, 'log', '--first-parent', '--format=%H %P|%s', 'origin/orch/main').out.split('\n')
  const m451 = log.find((l) => l.endsWith('|Merge feat/451-toy-451 into orch/main (plan 451)'))
  assert.ok(m451, log.join('\n'))
  const parents = m451.split('|')[0].split(' ')
  assert.equal(parents.length, 3, 'a merge commit (--no-ff): the commit and two parents')
  assert.equal(parents[2], head, 'HEAD^2 is the checked head')
  assert.equal(st.plans['451'].state, 'merged')
  // (b) exactly three model calls
  assert.deepEqual(stagesOf(st, '452'), ['builder', 'builder fix', 'reviewer'])
  // (c) parked by plan-park.mjs (the park record), its own folder removed; the dependent is skipped with the reason
  assert.equal(st.plans['453'].state, 'parked')
  assert.match(st.plans['453'].reason, /^same reason twice: gate: npm run test/)
  assert.ok(st.plans['453'].park?.at, 'plan-park recorded the park')
  assert.equal(existsSync(join(p.root, 'rp-app-orch-main-453')), false, 'the parked plan\'s folder is gone')
  assert.equal(st.plans['455'].state, 'skipped')
  assert.equal(st.plans['455'].reason, 'depends on parked 453')
  // (d) the config default is gate (plan 098): the Reviewer: advisory plan's STOP gets a fix round, then it merges
  assert.equal(st.plans['457'].state, 'merged')
  assert.deepEqual(stagesOf(st, '457'), ['builder', 'reviewer', 'builder fix', 'reviewer'])
  assert.ok(!st.notes.some((n) => n.plan === '457' && /advisory review STOP/.test(n.text)), JSON.stringify(st.notes))
  // (e) the branch moved between the review and the merge: refused with both shas, parked, the run branch untouched
  assert.equal(st.plans['458'].state, 'parked')
  assert.match(st.plans['458'].reason, new RegExp(`the branch moved after its checks: the merge took [0-9a-f]{40} but the checked head is ${st.plans['458'].checkedHead}`))
  assert.ok(!log.some((l) => /\(plan 458\)$/.test(l)), 'no merge of 458 on the run branch')
  // a builder that rewrites the branch's own scripts/scope-check.mjs: the gate's scope check is the kit's copy, it fails
  assert.equal(st.plans['474'].state, 'parked')
  assert.match(st.plans['474'].reason, /^same reason twice: gate: scope-check \(kit copy\) --diff=origin\/orch\/main --plan=plans\/474-toy-474\.plan\.md/)
  assert.ok((st.plans['474'].roundCauses ?? []).some((c) => /scope-check \(kit copy\)/.test(c)), JSON.stringify(st.plans['474']))
  assert.ok(!log.some((l) => /\(plan 474\)$/.test(l)))
  // escalation: a second, different failure gets the hand-off and one judgment-tier builder
  assert.deepEqual(stagesOf(st, '462'), ['builder', 'builder fix', 'judgment builder', 'reviewer'])
  const judge = main.calls.find((c) => c.plan === '462' && c.handoff)
  assert.equal(judge?.model, 'opus', 'the judgment builder runs on models.judgment')
  assert.ok(st.plans['462'].resetToBase, 'handoff --reset-base ran')
  // (h) status.json and the report
  for (const n of ['451', '452', '457', '462']) {
    assert.match(st.plans[n].checkedHead, /^[0-9a-f]{40}$/)
    for (const c of st.plans[n].calls) assert.deepEqual(Object.keys(c).slice(0, 4), ['stage', 'model', 'seconds', 'tokens'])
  }
  assert.ok(existsSync(join(p.proj, '.claude', 'orchestrator-runs', 'main.md')), 'finish wrote the local report')
  assert.equal(p.git(p.proj, 'show', 'origin/orch/main:docs/orchestrator/runs/main/report.md').status, 0, 'and the report on the run branch')
  // origin/main never moves; the main folder stays clean
  assert.equal(p.git(p.proj, 'status', '--porcelain').out, '')
})

test('the argv of every call: the flags, the tier\'s model, the builder in its own folder, the reviewer in a review folder with no write tool', () => {
  const b = main.calls.find((c) => c.plan === '451' && c.role === 'builder')
  const r = main.calls.find((c) => c.plan === '451' && c.role === 'reviewer')
  for (const call of [b, r]) {
    for (const f of ['-p', '--output-format', 'json', '--setting-sources', 'local', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence', '--system-prompt-file']) assert.ok(call.argv.includes(f), `${call.role}: ${f}`)
  }
  assert.equal(b.argv[b.argv.indexOf('--model') + 1], 'sonnet')
  assert.equal(b.argv[b.argv.indexOf('--tools') + 1], 'Read,Edit,Write,Bash,Grep,Glob')
  assert.equal(basename(b.cwd), 'rp-app-orch-main-451')
  assert.equal(r.argv[r.argv.indexOf('--model') + 1], 'sonnet', 'the reviewer runs on orchestrator.reviewerModel (default sonnet), whatever models.review is')
  assert.ok(!/Edit|Write/.test(r.argv[r.argv.indexOf('--tools') + 1]))
  assert.equal(r.argv[r.argv.indexOf('--disallowedTools') + 1], 'Edit,Write,MultiEdit,NotebookEdit')
  assert.equal(b.argv[b.argv.indexOf('--allowedTools') + 1], 'Read,Edit,Write,Grep,Glob,Bash', 'only the builder, with its guard hooks loaded, keeps a bare Bash')
  assert.ok(!r.argv.includes('--settings'), 'the reviewer gets no settings file')
  assert.equal(r.argv[r.argv.indexOf('--allowedTools') + 1], 'Read,Grep,Glob', 'the reviewer: no Bash at all (plan 095)')
  assert.equal(basename(r.cwd), 'rp-app-orch-review-main-451')
  assert.equal(existsSync(r.cwd), false, 'the review folder is removed after the review')
})

test('the builder runs under the project\'s guard hooks: --settings names a file outside its folder holding the PreToolUse hooks, and the scope guard there denies a write outside the plan', () => {
  const b = main.calls.find((c) => c.plan === '451' && c.role === 'builder')
  const file = b.argv[b.argv.indexOf('--settings') + 1]
  assert.ok(b.argv.includes('--settings'), b.argv.join(' '))
  assert.equal(resolve(file), resolve(join(p.proj, '.claude', 'orchestrator-runs', 'main', 'builder-settings.json')), 'outside the builder\'s folder, in the main folder\'s run folder')
  const written = JSON.parse(readFileSync(file, 'utf8'))
  const installed = JSON.parse(readFileSync(join(p.proj, '.claude', 'settings.json'), 'utf8')).hooks.PreToolUse
  const root = p.proj.replace(/\\/g, '/')
  assert.deepEqual(written.hooks.PreToolUse, JSON.parse(JSON.stringify(installed).split('${CLAUDE_PROJECT_DIR}').join(root)), 'the installed hooks block, pointed at the main folder\'s scripts')
  assert.deepEqual(Object.keys(written), ['hooks'], 'nothing but the hooks')
  const commands = written.hooks.PreToolUse.flatMap((h) => h.hooks.map((x) => x.command)).join('\n')
  for (const g of ['branch-guard.sh', 'plan-write-guard.sh', 'scope-guard.sh', 'guard.mjs" write', 'guard.mjs" plan']) assert.ok(commands.includes(g), `${g} is in the builder's hooks`)
  assert.ok(!commands.includes('CLAUDE_PROJECT_DIR'))
  // What those hooks decide for the builder's folder (scope-guard.sh runs scripts/lib/guard.mjs scope).
  const wt = b.cwd
  const ask = (file) => spawnSync(process.execPath, [join(p.proj, 'scripts', 'lib', 'guard.mjs'), 'scope'], { input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(wt, file) }, cwd: wt }), encoding: 'utf8', env: p.env }).stdout
  assert.match(ask('stray.txt'), /deny[\s\S]*SCOPE_GUARD: stray\.txt is outside this plan's Read-Write Scope/)
  assert.doesNotMatch(ask('src/451.txt'), /deny/)
})

test('calls.csv: one row per model call and per gate command; the default concurrency 1 never overlaps two builders', () => {
  const csv = readFileSync(join(p.proj, '.claude', 'orchestrator-runs', 'main', 'calls.csv'), 'utf8').trim().split('\n')
  assert.equal(csv[0], 'plan,stage,model,seconds,input_tokens,output_tokens,exit')
  const rows = csv.slice(1).map((l) => l.split(','))
  assert.equal(rows.filter((r) => r[0] === '452' && !r[1].startsWith('gate') && !r[1].startsWith('merge')).map((r) => r[1]).join(','), 'builder,builder fix,reviewer')
  assert.ok(rows.some((r) => r[0] === '451' && r[1] === 'gate: npm run test' && r[6] === '0'))
  assert.ok(rows.some((r) => r[0] === '452' && r[1] === 'gate: npm run test' && r[6] === '1'))
  assert.equal(rows.filter((r) => r[1] === 'builder' || r[1] === 'reviewer').length + rows.filter((r) => /fix|judgment/.test(r[1])).length, main.calls.length)
  const builders = main.calls.filter((c) => c.role === 'builder')
  for (let i = 0; i < builders.length; i++) for (let j = i + 1; j < builders.length; j++) assert.equal(overlaps(builders[i], builders[j]), false)
})

test('orch-state watch reads a run the script wrote: FINISHED after the run', () => {
  const w = p.state('watch', '--run=main')
  assert.equal(w.status, 0, w.out)
  assert.equal(w.json.line, 'FINISHED')
})

test('(d) gate mode: a reviewer STOP gets one fix round, then the plan parks', () => {
  const r = p.runPlans(['--run', 'gated', '--plans', '456', '--reviewer-mode', 'gate'], { scenario: { 456: { reviewer: [{ verdict: 'STOP' }, { verdict: 'STOP' }] } } })
  assert.equal(r.status, 2, r.out)
  const st = p.status('gated')
  assert.equal(st.plans['456'].state, 'parked')
  assert.match(st.plans['456'].reason, /^same reason twice: review STOP: major src\/456\.txt:1/)
  assert.deepEqual(stagesOf(st, '456'), ['builder', 'reviewer', 'builder fix', 'reviewer'])
  assert.ok(r.calls.find((c) => c.plan === '456' && c.role === 'builder' && c.findings), 'the fix round gets the findings')
})

test('095 (a)(b)(c) Reviewer: advisory never applies to a sensitive diff: a STOP parks, a review that cannot run parks; a plain diff stays advisory', () => {
  const sensitivePlan = (nnn) => withImpact(withExecution(toyPlan(nnn), '- Reviewer: advisory'), '- none', `src/auth-${nnn}.txt`)
  p.addPlans({ 490: sensitivePlan(490), 491: sensitivePlan(491), 492: withExecution(toyPlan(492), '- Reviewer: advisory') })
  // (a) sensitive + advisory + STOP: one fix round, then parked — never merged
  const a = p.runPlans(['--run', 'sens-a', '--plans', '490', '--reviewer-mode', 'advisory'], { scenario: { 490: { builder: [{ extraFile: 'src/auth-490.txt' }], reviewer: [{ verdict: 'STOP' }, { verdict: 'STOP' }] } } })
  assert.equal(a.status, 2, a.out)
  const sa = p.status('sens-a')
  assert.equal(sa.plans['490'].state, 'parked', a.out)
  assert.match(sa.plans['490'].reason, /^same reason twice: review STOP: major src\/490\.txt:1/)
  assert.deepEqual(stagesOf(sa, '490'), ['builder', 'reviewer', 'builder fix', 'reviewer'])
  assert.ok(sa.notes.some((n) => n.plan === '490' && /sensitive path \(src\/auth-490\.txt\)/.test(n.text)), JSON.stringify(sa.notes))
  assert.ok(!p.git(p.proj, 'log', '--format=%s', 'origin/orch/sens-a').out.split('\n').some((l) => /\(plan 490\)$/.test(l)), 'no merge of 490')
  // (b) sensitive + advisory + the reviewer call exits non-zero: parked ("review could not run")
  const tmp = mkdtempSync(join(tmpdir(), 'rp-095-'))
  try {
    const bin = join(tmp, 'claude-review-fails.mjs')
    writeFileSync(bin, [
      "import { readFileSync, existsSync } from 'node:fs'",
      "import { spawnSync } from 'node:child_process'",
      'const argv = process.argv.slice(2)',
      "const sys = argv[argv.indexOf('--system-prompt-file') + 1]",
      "if (sys && existsSync(sys) && /^# plan-reviewer\\b/m.test(readFileSync(sys, 'utf8'))) { console.error('review crashed'); process.exit(1) }",
      `const r = spawnSync(process.execPath, [${JSON.stringify(FAKE(kit))}, ...argv], { input: readFileSync(0), encoding: 'utf8' })`,
      "process.stdout.write(r.stdout ?? ''); process.stderr.write(r.stderr ?? ''); process.exit(r.status ?? 1)",
      '',
    ].join('\n'))
    const b = p.runPlans(['--run', 'sens-b', '--plans', '491', '--reviewer-mode', 'advisory', '--claude', bin], { scenario: { 491: { builder: [{ extraFile: 'src/auth-491.txt' }] } } })
    assert.equal(b.status, 2, b.out)
    const sb = p.status('sens-b')
    assert.equal(sb.plans['491'].state, 'parked', b.out)
    assert.match(sb.plans['491'].reason, /^review could not run: claude exited 1/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  // (c) the same advisory plan with a plain diff: the STOP is recorded and the plan merges (plan 097's rule unchanged)
  const c = p.runPlans(['--run', 'sens-c', '--plans', '492', '--reviewer-mode', 'advisory'], { scenario: { 492: { reviewer: [{ verdict: 'STOP' }] } } })
  const sc = p.status('sens-c')
  assert.equal(sc.plans['492'].state, 'merged', c.out)
  assert.ok(sc.notes.some((n) => n.plan === '492' && /advisory review STOP \(not enforced\)/.test(n.text)), JSON.stringify(sc.notes))
})

test('099 (a) a run writes its own console log and a second launch appends to it; (b) status.json names the model of every call', () => {
  p.addPlans({ 500: toyPlan(500) })
  const first = p.runPlans(['--run', 'seen', '--plans', '500'])
  const log = join(p.proj, '.claude', 'orchestrator-runs', 'seen.console.log')
  assert.ok(existsSync(log), first.out)
  const one = readFileSync(log, 'utf8')
  assert.match(one, /RUN_PLANS: launch .* --run seen --plans 500/)
  assert.match(one, /RUN_PLANS: plan 500 merged into orch\/seen/)
  const st = p.status('seen')
  const m = st.plans['500'].models
  assert.ok(m.builder && m.builder.model && m.builder.tier === 'build' && m.builder.at, JSON.stringify(m))
  assert.ok(m.reviewer && m.reviewer.model, JSON.stringify(m))
  p.runPlans(['--run', 'seen', '--plans', '500'])
  const two = readFileSync(log, 'utf8')
  assert.ok(two.startsWith(one), 'the first launch\'s lines are still there')
  assert.equal((two.match(/RUN_PLANS: launch /g) ?? []).length, 2)
  p.runPlans(['--dry-run', '--run', 'seen-dry', '--plans', '500'])
  assert.ok(!existsSync(join(p.proj, '.claude', 'orchestrator-runs', 'seen-dry.console.log')), 'a dry run writes no log')
})

/** A `claude` whose builder runs `builder` (JS lines; `plan`, `git`, `answer` in scope); the reviewer is the fake's. */
function builderBin(dir, name, builder) {
  const bin = join(dir, `${name}.mjs`)
  writeFileSync(bin, [
    "import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'",
    "import { spawnSync } from 'node:child_process'",
    'const argv = process.argv.slice(2)',
    "const sys = argv[argv.indexOf('--system-prompt-file') + 1]",
    'const input = readFileSync(0)',
    "const prompt = String(input)",
    "const git = (...a) => spawnSync('git', a, { encoding: 'utf8' })",
    "const answer = (o) => console.log(JSON.stringify({ type: 'result', is_error: false, result: '```json\\n' + JSON.stringify(o) + '\\n```', usage: {} }))",
    "if (sys && existsSync(sys) && /^# orch-builder\\b/m.test(readFileSync(sys, 'utf8'))) {",
    "  const plan = (/Build plan (\\d+)/.exec(prompt) ?? [])[1]",
    ...builder,
    '} else {',
    `  const r = spawnSync(process.execPath, [${JSON.stringify(FAKE(kit))}, ...argv], { input, encoding: 'utf8' })`,
    "  process.stdout.write(r.stdout ?? ''); process.stderr.write(r.stderr ?? ''); process.exit(r.status ?? 1)",
    '}',
    '',
  ].join('\n'))
  return bin
}

test('098 (a) [F10] a builder stopped idle parks at once: no judgment builder, no reset, the work kept on park/<run>-<NNN>', () => {
  p.addPlans({ 493: toyPlan(493) })
  const tmp = mkdtempSync(join(tmpdir(), 'rp-098a-'))
  p.env.RUN_PLANS_BUILDER_IDLE_MS = '3000'
  p.env.RUN_PLANS_BUILDER_POLL_MS = '200'
  try {
    const bin = builderBin(tmp, 'claude-slow', [
      "  mkdirSync('src', { recursive: true })",
      "  writeFileSync(`src/${plan}.txt`, 'work in progress\\n')",
      "  git('add', '--', `src/${plan}.txt`)",
      "  git('commit', '-q', '-m', `toy ${plan}: half done`)",
      '  setTimeout(() => {}, 120000)',
    ])
    const r = p.runPlans(['--run', 'slow', '--plans', '493', '--claude', bin])
    assert.equal(r.status, 2, r.out)
    const st = p.status('slow')
    assert.equal(st.plans['493'].state, 'parked', r.out)
    assert.match(st.plans['493'].reason, /^builder stopped: claude idle for .* the work is kept on park\/slow-493/)
    assert.deepEqual(stagesOf(st, '493'), ['builder'], 'no fix round, no judgment builder')
    assert.ok(!st.plans['493'].resetToBase, 'no handoff --reset-base')
    p.git(p.proj, 'fetch', '-q', 'origin')
    assert.equal(p.git(p.proj, 'show', 'origin/park/slow-493:src/493.txt').out.trim(), 'work in progress', 'the committed work is on park/slow-493')
    assert.equal(p.git(p.proj, 'rev-parse', '--verify', '--quiet', 'refs/heads/feat/493-toy-493').status, 1, 'feat/493 renamed')
  } finally {
    delete p.env.RUN_PLANS_BUILDER_IDLE_MS
    delete p.env.RUN_PLANS_BUILDER_POLL_MS
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('098 (b) a builder ESCALATE about the scope parks replan needed at once — no judgment-tier call', () => {
  p.addPlans({ 494: toyPlan(494) })
  const tmp = mkdtempSync(join(tmpdir(), 'rp-098b-'))
  try {
    const bin = builderBin(tmp, 'claude-scope', [
      "  answer({ role: 'orch-builder', model: 'x', effort: 'medium', status: 'ESCALATE', branch: 'b', summary: 's', evidence: [], blocker: 'src/other.txt is outside the Read-Write Scope; offer approved: src/other.txt', notDone: ['T1'], planChange: { needed: true, why: 'scope' } })",
    ])
    const before = p.calls().length
    const r = p.runPlans(['--run', 'scope-esc', '--plans', '494', '--claude', bin])
    assert.equal(r.status, 2, r.out)
    const st = p.status('scope-esc')
    assert.equal(st.plans['494'].state, 'parked', r.out)
    assert.match(st.plans['494'].reason, /^replan needed: src\/other\.txt is outside the Read-Write Scope/)
    assert.deepEqual(stagesOf(st, '494'), ['builder'], 'one builder call, then the park')
    assert.equal(p.calls().length, before, 'the fake claude recorded zero further calls')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('098 (c) a Done-when check the runner cannot run is NOT READY in the dry run and refused in the real run', () => {
  p.addPlans({ 495: toyPlan(495).replace('## Read-Write Scope', '- [auto] `node scripts/run-plans.mjs --dry-run --plans 495` prints WOULD START\n\n## Read-Write Scope') })
  const dry = p.runPlans(['--dry-run', '--run', 'drop', '--plans', '495'])
  assert.equal(dry.json.plans['495'].ready, false, dry.out)
  assert.match(dry.out, /PROBLEM check command the runner cannot run: node scripts\/run-plans\.mjs --dry-run --plans 495: run-plans changes state or pushes/)
  assert.match(dry.out, /^WOULD START: no/m)
  const run = p.runPlans(['--run', 'drop', '--plans', '495'])
  assert.equal(run.status, 1, run.out)
  assert.match(run.out, /refused before the start/)
  assert.equal(run.calls.length, 0)
})

test('098 (d) the dry run runs the gate\'s test-file check and refuses a stale feat/<NNN> an earlier run left', () => {
  p.addPlans({
    496: toyPlan(496).replace('## Read-Write Scope', '- [auto] `node --test tests/496.test.mjs` passes\n\n## Read-Write Scope').replace('- [ ] T1: write the toy file', '- [ ] T1: write the toy file and tests/496.test.mjs'),
    497: toyPlan(497).replace('## Read-Write Scope', '- [auto] `node --test tests/497.test.mjs` passes\n\n## Read-Write Scope').replace('```scope\n', '```scope\ntests/497.test.mjs\n'),
    498: toyPlan(498),
  })
  const tests = p.runPlans(['--dry-run', '--run', 'tests', '--plans', '496,497'])
  assert.match(tests.out, /PROBLEM test file gate: tests\/496\.test\.mjs: no scope line names a test location/, tests.out)
  assert.deepEqual([tests.json.plans['496'].ready, tests.json.plans['497'].ready], [false, true], tests.out)
  // a feat/498 cut from an older main with a commit of its own: not built on the run's base
  const old = p.git(p.proj, 'rev-parse', 'HEAD~1').out.trim()
  const stale = p.git(p.proj, 'commit-tree', `${old}^{tree}`, '-p', old, '-m', 'an earlier run').out.trim()
  assert.equal(p.git(p.proj, 'update-ref', 'refs/heads/feat/498-toy-498', stale).status, 0)
  try {
    const dry = p.runPlans(['--dry-run', '--run', 'stale', '--plans', '498'])
    // plan 102: not a refusal — the run renames it at the plan's start
    assert.equal(dry.json.plans['498'].ready, true, dry.out)
    assert.match(dry.out, /WILL RENAME feat\/498-toy-498 → park\/stale-498: an earlier run left it and it is not built on origin\/main/)
    assert.doesNotMatch(dry.out, /PROBLEM stale branch/)
    assert.match(dry.out, /^WOULD START: yes/m)
  } finally {
    p.git(p.proj, 'update-ref', '-d', 'refs/heads/feat/498-toy-498')
  }
  assert.equal(p.runPlans(['--dry-run', '--run', 'stale', '--plans', '498']).json.plans['498'].ready, true)
})

test('098 (e) no --reviewer-mode and no orchestrator.reviewerMode: a Reviewer: advisory plan is reviewed as gate', () => {
  p.addPlans({ 499: withExecution(toyPlan(499), '- Reviewer: advisory') })
  const r = p.runPlans(['--run', 'default-gate', '--plans', '499'], { scenario: { 499: { reviewer: [{ verdict: 'STOP' }, { verdict: 'STOP' }] } } })
  assert.equal(r.status, 2, r.out)
  assert.match(r.out, /reviewer sonnet \(gate\)/)
  const st = p.status('default-gate')
  assert.equal(st.plans['499'].state, 'parked')
  assert.match(st.plans['499'].reason, /^same reason twice: review STOP: major src\/499\.txt:1/)
  assert.deepEqual(stagesOf(st, '499'), ['builder', 'reviewer', 'builder fix', 'reviewer'])
})

test('(f) a plan with an open Critical Question is refused before any build, with the question printed', () => {
  const r = p.runPlans(['--run', 'refused', '--plans', '459'])
  assert.equal(r.status, 1, r.out)
  assert.match(r.out, /open question \(A: open\): Which database does the toy write to\?/)
  assert.match(r.out, /refused before the start/)
  assert.equal(r.calls.length, 0)
  assert.equal(existsSync(join(p.proj, '.claude', 'orchestrator-runs', 'refused', 'status.json')), false, 'nothing was started')
})

test('(g) a rate limit pauses and retries once; a second one stops the run with stopped: rate-limit', () => {
  const r = p.runPlans(['--run', 'limits', '--plans', '470,471,472'], { scenario: { 470: { builder: [{ rateLimit: true }, { gate: 'pass' }] }, 471: { builder: [{ rateLimit: true }, { rateLimit: true }] } } })
  assert.equal(r.status, 2, r.out)
  assert.equal(r.json.stopped, 'rate-limit')
  const st = p.status('limits')
  assert.equal(st.plans['470'].state, 'merged', 'one limit: retried after the wait, then built')
  assert.deepEqual(stagesOf(st, '470'), ['builder', 'builder', 'reviewer'])
  assert.equal(r.calls.filter((c) => c.plan === '471').length, 2, 'the same call, retried once')
  assert.match(st.plans['471'].reason, /rate-limit/)
  assert.equal(st.plans['472'].state, 'skipped')
  assert.equal(st.phase, 'stopped')
  assert.match(st.stopReason, /^rate-limit: /)
})

test('--concurrency 2 runs two builders of one wave at once; watch prints RUNNING while the run goes', async () => {
  const run = p.startPlans(['--run', 'pair', '--plans', '465,466', '--concurrency', '2'], { scenario: { 465: { builder: [{ sleepMs: 4000 }] }, 466: { builder: [{ sleepMs: 4000 }] } } })
  let seen = null
  for (let i = 0; i < 120 && seen !== 'RUNNING'; i++) {
    await new Promise((res) => setTimeout(res, 500))
    if (existsSync(join(p.proj, '.claude', 'orchestrator-runs', 'pair', 'status.json'))) seen = p.state('watch', '--run=pair').json?.line ?? seen
  }
  const r = await run.done
  assert.equal(r.status, 0, r.out)
  assert.equal(seen, 'RUNNING')
  const [a, b] = r.calls.filter((c) => c.role === 'builder')
  assert.ok(a && b && overlaps(a, b), 'the two builders ran at the same time')
  assert.notEqual(a.cwd, b.cwd, 'each in its own folder')
})

test('097: the dry run refuses a stale default, a production default and run options above the plan, calls no model and never writes human-decisions.md', () => {
  const file = join(p.proj, 'docs', 'brain', 'human-decisions.md')
  mkdirSync(join(p.proj, 'docs', 'brain'), { recursive: true })
  writeFileSync(file, DECISIONS)
  try {
    const r = p.runPlans(['--dry-run', '--run', 'decide', '--plans', '482,483,484'])
    assert.equal(r.status, 0, r.out)
    assert.equal(r.calls.length, 0)
    assert.equal(r.json.modelCalls, 0)
    assert.match(r.out, /PROBLEM default per D17: decision is superseded by D18 — ask the Human/)
    assert.match(r.out, /PROBLEM production needs an explicit Human answer \(plan 483 Q1\)/)
    assert.deepEqual([r.json.plans['482'].ready, r.json.plans['483'].ready, r.json.plans['484'].ready], [false, false, true], r.out)
    assert.match(r.out, /^WOULD START: no/m)
    for (const [flag, re] of [[['--concurrency', '2'], /more autonomy than plan 484 asks for: --concurrency 2/], [['--db', 'remote'], /more spend\/risk than plan 484 asks for: --db remote/], [['--reviewer-mode', 'advisory'], /more autonomy than plan 484 asks for: --reviewer-mode advisory/]]) {
      const o = p.runPlans(['--dry-run', '--run', 'decide', '--plans', '484', ...flag])
      assert.match(o.out, re, o.out)
      assert.equal(o.json.plans['484'].ready, false)
      assert.equal(o.calls.length, 0)
    }
    assert.equal(readFileSync(file, 'utf8'), DECISIONS, 'read, never written')
  } finally {
    rmSync(join(p.proj, 'docs', 'brain', 'human-decisions.md'), { force: true })
  }
})

test('--dry-run prints the waves, the readiness lint, the preflight and the commands, and calls no model', () => {
  const r = p.runPlans(['--dry-run', '--run', 'dry', '--plans', '463,464'])
  assert.equal(r.status, 0, r.out)
  assert.equal(r.calls.length, 0)
  for (const re of [/^WAVE 1: 463$/m, /^WAVE 2: 464$/m, /^ {2}deps: DEPENDS_ON: ok/m, /^ {2}arch: /m, /^ {2}tags: DONE_WHEN_TAGS: ok/m, /^ {2}check files: ok/m, /^PREFLIGHT OK +main folder/m, /^ {4}npm run build$/m, /^ {2}builder: claude -p .*--setting-sources local/m, /^ {2}reviewer: claude -p .*--model sonnet/m, /^WOULD START: yes$/m]) assert.match(r.out, re)
  assert.equal(existsSync(join(p.proj, '.claude', 'orchestrator-runs', 'dry')), false, 'a dry run creates nothing')
  assert.equal(p.git(p.proj, 'ls-remote', 'origin', 'orch/dry').out, '')
})

test('the dry run prints the builder call the real run makes: same argv (but the system-prompt file), the start tier and why; calls.csv keeps the model passed', () => {
  const dry = p.runPlans(['--dry-run', '--run', 'tiers', '--plans', '480,481'])
  assert.equal(dry.status, 0, dry.out)
  assert.equal(dry.calls.length, 0)
  assert.match(dry.out, /^ {2}tier: build \(INV-1 preserves\)$/m)
  assert.match(dry.out, /^ {2}tier: judgment \(INV-1 changes\)$/m)
  const planned = dry.json.plans
  assert.deepEqual([planned['480'].builder.tier, planned['480'].builder.model], ['build', 'sonnet'])
  assert.deepEqual([planned['481'].builder.tier, planned['481'].builder.model], ['judgment', 'opus'])
  const run = p.runPlans(['--run', 'tiers', '--plans', '480,481'], { scenario: { 480: { builder: [{ gate: 'pass', reportModel: 'claude-other-model' }] } } })
  assert.equal(run.status, 0, run.out)
  const noPrompt = (argv) => argv.map((a, i) => (argv[i - 1] === '--system-prompt-file' ? '<system prompt>' : a))
  for (const [nnn, model] of [['480', 'sonnet'], ['481', 'opus']]) {
    const call = run.calls.find((c) => c.plan === nnn && c.role === 'builder')
    assert.ok(call, `plan ${nnn}: a builder call`)
    assert.deepEqual(noPrompt(call.argv), noPrompt(planned[nnn].builder.argv), `plan ${nnn}: the dry run's argv is the real one`)
    assert.equal(call.argv[call.argv.indexOf('--model') + 1], model)
  }
  const st = p.status('tiers')
  assert.ok(st.notes.some((n) => n.plan === '481' && /starts on the judgment tier: INV-1 changes/.test(n.text)), JSON.stringify(st.notes))
  assert.ok(!st.notes.some((n) => n.plan === '480' && /judgment tier/.test(n.text)))
  // calls.csv: the model passed after --model, not the one the answer names (the fake's reportModel).
  const rows = readFileSync(join(p.proj, '.claude', 'orchestrator-runs', 'tiers', 'calls.csv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','))
  assert.deepEqual(rows.filter((r) => r[1] === 'builder').map((r) => [r[0], r[2]]), [['480', 'sonnet'], ['481', 'opus']])
  assert.equal(st.plans['480'].calls.find((c) => c.stage === 'builder').model, 'sonnet')
})

test('--dry-run --plans 086,087 in the kit itself calls no model', () => {
  const log = join(p.root, 'kit-dry.log')
  const r = spawnSync(process.execPath, [join(kit, 'scripts', 'run-plans.mjs'), '--dry-run', '--plans', '086,087'], { cwd: kit, encoding: 'utf8', env: { ...process.env, RUN_PLANS_CLAUDE: FAKE(kit), FAKE_CLAUDE_LOG: log }, timeout: 300000 })
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`)
  assert.match(r.stdout, /^RUN_PLANS: dry run of dry-run/m)
  assert.match(r.stdout, /^PREFLIGHT /m)
  assert.equal(existsSync(log), false, 'the fake runner recorded zero calls')
})

test('101 a test path the plan names that its scope does not cover is NOT READY with the scope line to add; a sibling test is fine', () => {
  p.addPlans({
    601: toyPlan(601).replace('- [ ] T1: write the toy file', '- [ ] T1: write the toy file and e2e/601.spec.ts'),
    602: toyPlan(602).replace('- [ ] T1: write the toy file', '- [ ] T1: write the toy file and its test src/602.test.mjs').replace('```scope\n', '```scope\nsrc/602.mjs\n'),
  })
  const dry = p.runPlans(['--dry-run', '--run', 'named', '--plans', '601,602'])
  assert.match(dry.out, /PROBLEM test file gate: e2e\/601\.spec\.ts: no scope line names a test location.*; add this line to the scope block: e2e\/601\.spec\.ts/, dry.out)
  assert.deepEqual([dry.json.plans['601'].ready, dry.json.plans['602'].ready], [false, true], dry.out)
})

// ---- plan 103: the plan gate runs what the final gate runs; the final-gate fix round; undone items -------------------------
test('103 (e) gateCommands adds the ciMirror commands to the plan gate, and the trusted manifest check reads the plan\'s folder (--root .)', () => {
  const cmds = gateCommands({ pm: 'npm', build: 'build', lint: 'lint', test: 'test', manifest: true, kitRoot: 'C:/main folder', ciMirror: ['node tools/drift-check.mjs --target .', 'npm run build'], scope: { base: 'origin/orch/r', plan: 'plans/1-x.plan.md' } })
  assert.deepEqual(cmds, ['npm run build', 'npm run lint', 'npm run test', 'node "C:/main folder/scripts/kit-manifest-check.mjs" --root .', 'scope-check (kit copy) --diff=origin/orch/r --plan=plans/1-x.plan.md', 'node tools/drift-check.mjs --target .'])
  assert.deepEqual(runPlans.ciMirrorChecks(['npm run lint', 'git push', 'node scripts/kit-manifest-check.mjs', ' node tools/x.mjs '], ['lint'], { manifest: true }), ['npm run lint', 'node tools/x.mjs'], 'a command the runner cannot run is left out; the manifest check is the trusted one')
})

test('103 (e) the dry run puts every command of the final gate (the project checks and orchestrator.ciMirror) in each plan\'s gate', () => {
  const q = makeProject({ kit, config: { ciMirror: ['node scripts/toy-check.mjs 9', 'npm run lint'] } })
  try {
    q.addPlans({ 731: toyPlan(731) })
    const dry = q.runPlans(['--dry-run', '--run', 'mirror', '--plans', '731'])
    assert.equal(dry.status, 0, dry.out)
    const checks = dry.json.plans['731'].checks
    for (const c of ['npm run build', 'npm run lint', 'npm run test', 'node scripts/toy-check.mjs 9']) assert.ok(checks.includes(c), `${c} in ${checks.join(' | ')}`)
    assert.equal(new Set(checks).size, checks.length, 'no command twice')
  } finally {
    q.cleanup()
  }
})

test('103 (f) blameFinalGate: a failing output that names a file exactly one merged plan changed blames that plan; a shared file or two plans blame nobody', () => {
  const merged = { 101: ['src/a.ts', 'src/shared.ts'], 102: ['src/b.ts', 'src/shared.ts'], 103: ['docs/c.md'] }
  assert.equal(runPlans.blameFinalGate({ output: 'ERROR in src/a.ts:12:3 TS2322', merged }), '101')
  assert.equal(runPlans.blameFinalGate({ output: 'FAIL src\\b.ts', merged: { 102: ['src/b.ts'] } }), '102', 'Windows slashes')
  assert.equal(runPlans.blameFinalGate({ output: 'ERROR in src/shared.ts', merged }), null, 'two plans changed it')
  assert.equal(runPlans.blameFinalGate({ output: 'src/a.ts and src/b.ts failed', merged }), null, 'two plans named')
  assert.equal(runPlans.blameFinalGate({ output: 'src/a.ts and src/shared.ts failed', merged }), '101', 'the shared file blames nobody, the other file one plan')
  assert.equal(runPlans.blameFinalGate({ output: 'nothing named here', merged }), null)
  assert.equal(runPlans.blameFinalGate({ output: '', merged: {} }), null)
})

test('103 (f) run-plans gives the blamed plan one fix round in the final gate and records finalGate.blamed', () => {
  const src = readFileSync(join(kit, 'scripts', 'run-plans.mjs'), 'utf8')
  assert.match(src, /finalGate\.blamed = blamed/)
  assert.match(src, /runPlan\(blamed, \{ finalFix:/)
  assert.match(src, /\(Number\(prior\.round\) \|\| 0\) \+ 1 <= MAX_FIX_ROUNDS/, 'counted against maxFixRounds')
})

test('103 (g) a notDone entry that names an open [auto] or [ui] Done-when item is found; a ticked item, a [human] item or a sub-task is not', () => {
  const text = [
    '# Plan 9 — x', '', '## Goals & Success Criteria',
    '- [auto] `node --test tools/test/x.test.mjs` passes',
    '- [x] [auto] `npm run build` passes',
    '- [ui] The settings page shows the text "Saved" after one click',
    '- [human] The Human sees the colours', '',
    '## Atomic Sub-tasks', '- [ ] T1: write the parser',
  ].join('\n')
  assert.deepEqual(runPlans.openDoneWhenItems(text).map((i) => i.tag), ['auto', 'ui'])
  const hit = runPlans.undoneItems(text, ['node --test tools/test/x.test.mjs not run: no backend or database'])
  assert.equal(hit.length, 1)
  assert.match(hit[0].item, /^\[auto\] `node --test tools\/test\/x\.test\.mjs` passes/)
  assert.equal(runPlans.undoneItems(text, ['The settings page shows the text "Saved" after one click: no dev server'])[0].item.startsWith('[ui]'), true)
  assert.deepEqual(runPlans.undoneItems(text, ['npm run build', 'T1: write the parser', 'The Human sees the colours']), [])
  assert.deepEqual(runPlans.undoneItems(text, []), [])
  assert.equal(runPlans.serversNamed('no backend or database for an e2e screenshot'), 'be')
  assert.equal(runPlans.serversNamed('the dev server was not running'), 'fe')
  assert.equal(runPlans.serversNamed('ran out of time'), null)
})

test('103 (g) a builder result with a notDone Done-when item fails the gate with "Done-when item left undone: <item>"', () => {
  const src = readFileSync(join(kit, 'scripts', 'run-plans.mjs'), 'utf8')
  assert.match(src, /undoneItems\(planText, result\.notDone\)/)
  assert.match(src, /`Done-when item left undone: \$\{first\.item\}`/)
  assert.match(src, /slot-serve\.mjs', \['--main', '--servers', servers/)
})
