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
const { claudeArgs, runAgent, readAgent, CONTEXT_FLAGS, RATE_LIMIT_RE, parseResult } = await lib('claude-run.mjs')
const { gateCommands, runGate, scopeCheck, scopeMarker } = await lib('plan-gate.mjs')
const { readReview, review, validateReviewerResult, reviewVerdict } = await lib('plan-review.mjs')
const { blockedBy, unitsOf, afterPark } = await lib('run-order.mjs')
const runPlans = await import(pathToFileURL(join(kit, 'scripts', 'run-plans.mjs')).href)

// ---- the pure parts ---------------------------------------------------------------------------------------------
test('claude-run: every call carries the four context-saving flags, json output, the model and the agent\'s tools', () => {
  const builder = readAgent(join(kit, '.claude', 'agents', 'orch-builder.md'))
  const reviewer = readAgent(join(kit, '.claude', 'agents', 'plan-reviewer.md'))
  const b = claudeArgs({ agent: builder, model: 'sonnet', systemPromptFile: 's.md', allow: true })
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
})

test('claude-run: tools are pre-approved only when asked; the builder gets its list, a read-only agent never a bare Bash', () => {
  const builder = readAgent(join(kit, '.claude', 'agents', 'orch-builder.md'))
  const reviewer = readAgent(join(kit, '.claude', 'agents', 'plan-reviewer.md'))
  for (const agent of [builder, reviewer]) assert.ok(!claudeArgs({ agent, model: 'x', systemPromptFile: 's.md' }).includes('--allowedTools'), `${agent.name}: off by default`)
  const b = claudeArgs({ agent: builder, model: 'x', systemPromptFile: 's.md', allow: true })
  assert.equal(b[b.indexOf('--allowedTools') + 1], 'Read,Edit,Write,Grep,Glob,Bash(git:*),Bash(npm run:*),Bash(pnpm run:*),Bash(node:*)', 'no guard hooks: no bare Bash for the builder either')
  assert.ok(!b.includes('--settings'))
  const g = claudeArgs({ agent: builder, model: 'x', systemPromptFile: 's.md', allow: true, settings: 'C:/run/builder-settings.json' })
  assert.equal(g[g.indexOf('--settings') + 1], 'C:/run/builder-settings.json')
  assert.equal(g[g.indexOf('--allowedTools') + 1], 'Read,Edit,Write,Grep,Glob,Bash', 'with the guard hooks loaded the builder keeps a bare Bash')
  const r = claudeArgs({ agent: reviewer, model: 'x', systemPromptFile: 's.md', allow: true })
  const allowed = r[r.indexOf('--allowedTools') + 1].split(',')
  assert.deepEqual(allowed, ['Read', 'Grep', 'Glob', 'Bash(git diff:*)', 'Bash(git show:*)', 'Bash(node --test:*)'])
  assert.ok(!allowed.includes('Bash'), 'no bare Bash for the reviewer')
  assert.equal(r[r.indexOf('--disallowedTools') + 1], 'Edit,Write,MultiEdit,NotebookEdit')
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

test('run-order: blockedBy follows dependencies and shared files; units keep a lock group in order; onPark all stops every later plan', () => {
  const edges = [{ from: '1', to: '2' }, { from: '2', to: '3' }, { from: '1', to: '4', lock: true }, { from: '4', to: '5' }]
  assert.deepEqual([...blockedBy(['1'], ['2', '3', '4', '5', '6'], edges)], [['2', 'depends on parked 1'], ['3', 'depends on parked 1'], ['4', 'shares files with parked 1'], ['5', 'depends on parked 1']])
  assert.deepEqual(unitsOf(['1', '2', '3'], [{ plans: ['1', '3'] }]), [['1', '3'], ['2']])
  const all = afterPark({ parked: ['1'], laterWaves: [['6'], ['7']], edges, onPark: 'all', why: 'x' })
  assert.deepEqual([...all.blocked.keys()], ['6', '7'])
})

test('plan-gate: the command list is prepare, project checks, manifest, scope, then the plan\'s own; a failing command is in the receipt', async () => {
  const cmds = gateCommands({ prepare: [{ missing: 'gen/x', script: 'gen' }], pm: 'npm', build: 'build', lint: 'lint', test: 'test', testCi: 'test:ci', manifest: true, kitRoot: 'C:/main folder', scope: { base: 'origin/orch/r', plan: 'plans/1-x.plan.md' }, extra: ['npm run build', 'node --test a.test.mjs'] })
  assert.deepEqual(cmds, ['node scripts/orch-state.mjs prepare --missing gen/x --script gen', 'npm run build', 'npm run lint', 'npm run test:ci', 'node "C:/main folder/scripts/kit-manifest-check.mjs"', 'scope-check (kit copy) --diff=origin/orch/r --plan=plans/1-x.plan.md', 'node --test a.test.mjs'])
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
  assert.deepEqual([scaffold.reviewerMode, scaffold.reviewerModel, scaffold.rateLimitWaitMin], ['advisory', 'sonnet', 30])
  assert.deepEqual(orchestratorProblems({ 'orchestrator.reviewerMode': 'gate', 'orchestrator.reviewerModel': 'sonnet', 'orchestrator.rateLimitWaitMin': 0 }), [])
  assert.match(orchestratorProblems({ 'orchestrator.reviewerMode': 'loud' }).join(), /reviewerMode is "loud"/)
  for (const m of ['haiku', 'claude-haiku-5-5', 'gpt']) assert.match(orchestratorProblems({ 'orchestrator.reviewerModel': m }).join(), /reviewerModel/)
  for (const w of [-1, 601, 1.5, '30']) assert.match(orchestratorProblems({ 'orchestrator.rateLimitWaitMin': w }).join(), /rateLimitWaitMin/)
})

// ---- whole runs in a scratch project ----------------------------------------------------------------------------
let p
before(() => {
  p = makeProject({ kit })
  p.addPlans({
    474: toyPlan(474), 451: toyPlan(451), 452: toyPlan(452), 453: toyPlan(453), 455: toyPlan(455, { deps: '453' }), 457: toyPlan(457), 458: toyPlan(458), 462: toyPlan(462),
    456: toyPlan(456), 459: toyPlan(459, { question: 'Which database does the toy write to?' }),
    463: toyPlan(463), 464: toyPlan(464, { deps: '463' }),
    465: toyPlan(465), 466: toyPlan(466),
    470: toyPlan(470), 471: toyPlan(471, { deps: '470' }), 472: toyPlan(472, { deps: '471' }),
  })
})
after(() => p?.cleanup())

const stagesOf = (st, nnn) => (st.plans[nnn].calls ?? []).map((c) => c.stage)
let main
test('one run of seven plans: (a) a passing plan merges --no-ff at its checked head; (b) one fix round; (c) a twice-failing gate parks and only its dependent is skipped; (d) advisory STOP merges; (e) a moved branch is refused; escalation', () => {
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
  // (d, advisory) a STOP is recorded, not enforced
  assert.equal(st.plans['457'].state, 'merged')
  assert.ok(st.notes.some((n) => n.plan === '457' && /advisory review STOP \(not enforced\)/.test(n.text)), JSON.stringify(st.notes))
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
  assert.equal(r.argv[r.argv.indexOf('--allowedTools') + 1], 'Read,Grep,Glob,Bash(git diff:*),Bash(git show:*),Bash(node --test:*)', 'the reviewer: no bare Bash')
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

test('--dry-run prints the waves, the readiness lint, the preflight and the commands, and calls no model', () => {
  const r = p.runPlans(['--dry-run', '--run', 'dry', '--plans', '463,464'])
  assert.equal(r.status, 0, r.out)
  assert.equal(r.calls.length, 0)
  for (const re of [/^WAVE 1: 463$/m, /^WAVE 2: 464$/m, /^ {2}deps: DEPENDS_ON: ok/m, /^ {2}arch: /m, /^ {2}tags: DONE_WHEN_TAGS: ok/m, /^ {2}check files: ok/m, /^PREFLIGHT OK +main folder/m, /^ {4}npm run build$/m, /^ {2}builder: claude -p .*--setting-sources local/m, /^ {2}reviewer: claude -p .*--model sonnet/m, /^WOULD START: yes$/m]) assert.match(r.out, re)
  assert.equal(existsSync(join(p.proj, '.claude', 'orchestrator-runs', 'dry')), false, 'a dry run creates nothing')
  assert.equal(p.git(p.proj, 'ls-remote', 'origin', 'orch/dry').out, '')
})

test('--dry-run --plans 086,087 in the kit itself calls no model', () => {
  const log = join(p.root, 'kit-dry.log')
  const r = spawnSync(process.execPath, [join(kit, 'scripts', 'run-plans.mjs'), '--dry-run', '--plans', '086,087'], { cwd: kit, encoding: 'utf8', env: { ...process.env, RUN_PLANS_CLAUDE: FAKE(kit), FAKE_CLAUDE_LOG: log }, timeout: 300000 })
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`)
  assert.match(r.stdout, /^RUN_PLANS: dry run of dry-run/m)
  assert.match(r.stdout, /^PREFLIGHT /m)
  assert.equal(existsSync(log), false, 'the fake runner recorded zero calls')
})
