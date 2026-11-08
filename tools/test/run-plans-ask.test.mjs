// Plan 104: every question a run raises is one ask file for one plan. Only that plan waits; the run goes on with the
// rest, waits for answers at its end, and resumes an answered plan in the same run. A scratch project with the
// installed scripts and a fake claude (tools/test/lib/run-plans-fixture.mjs, tools/test/fixtures/fake-claude.mjs).
//   node --test tools/test/run-plans-ask.test.mjs
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { makeProject, toyPlan, FAKE } from './lib/run-plans-fixture.mjs'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const runPlans = await import(pathToFileURL(join(kit, 'scripts', 'run-plans.mjs')).href)
const orchRun = await import(pathToFileURL(join(kit, 'scripts', 'lib', 'orch-run.mjs')).href)

let p
let tmp
before(() => {
  p = makeProject({ kit })
  tmp = mkdtempSync(join(tmpdir(), 'rp-ask-'))
  p.addPlans({ 701: toyPlan(701), 702: toyPlan(702), 703: toyPlan(703, { deps: '701' }), 704: toyPlan(704), 711: toyPlan(711), 712: toyPlan(712, { deps: '711' }), 713: toyPlan(713) })
})
after(() => {
  p?.cleanup()
  if (tmp) rmSync(tmp, { recursive: true, force: true })
})

/**
 * A `claude` that answers a scripted ESCALATE on a plan's first builder call (`escalate[plan]`), fails every review of
 * the plans in `reviewFails`, and otherwise runs the shared fake. Each call is logged in <tmp>/<name>.log with whether
 * its prompt carried ANSWER.
 */
function bin(name, { escalate = {}, reviewFails = [] } = {}) {
  const file = join(tmp, `${name}.mjs`)
  const log = join(tmp, `${name}.log`)
  writeFileSync(file, [
    "import { readFileSync, existsSync, appendFileSync } from 'node:fs'",
    "import { spawnSync } from 'node:child_process'",
    'const argv = process.argv.slice(2)',
    "const sys = argv[argv.indexOf('--system-prompt-file') + 1]",
    'const input = readFileSync(0)',
    'const prompt = String(input)',
    "const text = sys && existsSync(sys) ? readFileSync(sys, 'utf8') : ''",
    "const role = /^# orch-builder\\b/m.test(text) ? 'builder' : /^# plan-reviewer\\b/m.test(text) ? 'reviewer' : 'other'",
    "const plan = (/(?:Build|Review) plan (\\d+)/.exec(prompt) ?? [])[1]",
    `const LOG = ${JSON.stringify(log)}`,
    "const prior = existsSync(LOG) ? readFileSync(LOG, 'utf8').split('\\n').filter(Boolean).map((l) => JSON.parse(l)).filter((c) => c.plan === plan && c.role === role).length : 0",
    "appendFileSync(LOG, JSON.stringify({ role, plan, answer: /^ANSWER: /m.test(prompt), at: Date.now() }) + '\\n')",
    `const ESC = ${JSON.stringify(escalate)}`,
    `const REVIEW_FAILS = ${JSON.stringify(reviewFails)}`,
    "const say = (o) => console.log(JSON.stringify({ type: 'result', is_error: false, result: '```json\\n' + JSON.stringify(o) + '\\n```', usage: {} }))",
    "if (role === 'builder' && prior === 0 && ESC[plan]) { say({ role: 'orch-builder', model: 'x', effort: 'medium', branch: 'b', summary: 's', evidence: [], notDone: ['T1'], ...ESC[plan] }); process.exit(0) }",
    "if (role === 'reviewer' && REVIEW_FAILS.includes(plan)) { console.error('review crashed'); process.exit(1) }",
    `const r = spawnSync(process.execPath, [${JSON.stringify(FAKE(kit))}, ...argv], { input, encoding: 'utf8' })`,
    "process.stdout.write(r.stdout ?? ''); process.stderr.write(r.stderr ?? ''); process.exit(r.status ?? 1)",
    '',
  ].join('\n'))
  return { file, calls: () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []) }
}
const asksDir = (run) => join(p.proj, '.claude', 'orchestrator-runs', run, 'asks')
const readAsk = (run, id) => JSON.parse(readFileSync(join(asksDir(run), `${id}.json`), 'utf8'))
const until = async (what, ok, ms = 120000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms;) {
    try {
      if (ok()) return
    } catch { /* not there yet */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  assert.fail(`timed out waiting for: ${what}`)
}

test('(b) humanOnly by kind; an ESCALATE with no kind is Human-only; the builder names its kind in ask.kind or the blocker', () => {
  for (const k of ['data', 'privacy', 'product', 'design', 'production', 'spend', 'decision-stale', 'db-write']) assert.equal(orchRun.humanOnlyAsk(k), true, k)
  for (const k of ['scope', 'technical', 'environment', 'review']) assert.equal(orchRun.humanOnlyAsk(k), false, k)
  assert.equal(orchRun.humanOnlyAsk('anything-else'), true)
  const esc = (extra) => runPlans.builderAsk({ status: 'ESCALATE', blocker: 'b', ...extra })
  assert.deepEqual([esc({}).kind, esc({}).stated, esc({}).humanOnly], ['unstated', false, true])
  assert.deepEqual([esc({ blocker: 'x is outside the Read-Write Scope' }).kind, esc({ blocker: 'x is outside the Read-Write Scope' }).humanOnly], ['scope', true], 'a scope ESCALATE with no kind stays Human-only')
  assert.deepEqual([esc({ ask: { kind: 'scope' } }).kind, esc({ ask: { kind: 'scope' } }).humanOnly], ['scope', false])
  assert.deepEqual([esc({ blocker: 'ESCALATE: db-write psql -c "insert"' }).kind, esc({ blocker: 'ESCALATE: db-write psql' }).humanOnly], ['db-write', true])
  assert.deepEqual([esc({ blocker: 'ESCALATE: technical the build tool needs a flag' }).kind, esc({ blocker: 'ESCALATE: technical x' }).humanOnly], ['technical', false])
  assert.equal(runPlans.builderAsk({ status: 'built' }), null)
})

test('(S8) the answer wait is fixed in code: ASK_WAIT_MIN 180 with test-only overrides; the scaffold has no askWaitMin', () => {
  assert.equal(runPlans.ASK_WAIT_MIN, 180)
  const src = readFileSync(join(kit, 'scripts', 'run-plans.mjs'), 'utf8')
  assert.match(src, /RUN_PLANS_ASK_WAIT_MS/)
  assert.match(src, /RUN_PLANS_ASK_POLL_MS/)
  const scaffold = JSON.parse(readFileSync(join(kit, 'kit.config.json'), 'utf8')).orchestrator
  assert.equal(scaffold.askWaitMin, undefined)
  assert.equal(JSON.parse(readFileSync(join(kit, '.kit', 'config.json'), 'utf8')).orchestrator?.askWaitMin, undefined)
})

test('(a)(c)(d)(e) one plan asks, the others go on; watch shows RUNNING and the open asks; an advisor answer to a Human-only ask is refused; the Human\'s answer resumes the plan in the same run', async () => {
  const b = bin('claude-a', {
    escalate: {
      701: { status: 'ESCALATE', blocker: 'src/701-extra.txt is outside the Read-Write Scope', ask: { kind: 'scope', question: 'May plan 701 also write src/701-extra.txt?', options: ['park: leave the plan for a replan', 'approved: src/701-extra.txt'], recommendation: 2 }, planChange: { needed: true, why: 'the toy needs a second file' } },
      704: { status: 'ESCALATE', blocker: 'ESCALATE: db-write psql -c "insert into toys"' },
    },
  })
  Object.assign(p.env, { RUN_PLANS_ASK_WAIT_MS: '240000', RUN_PLANS_ASK_POLL_MS: '300' })
  let run = null
  try {
    run = p.startPlans(['--run', 'asks', '--plans', '701,702,703,704', '--claude', b.file], { scenario: { 701: { builder: [{ extraFile: 'src/701-extra.txt' }] } } })
    const st = () => p.status('asks')
    await until('701 and 704 asking, 702 merged, 703 held', () => st().plans['701'].state === 'asking' && st().plans['704'].state === 'asking' && st().plans['702'].state === 'merged' && /waits on the answer to ask 701-1/.test(st().plans['703']?.reason ?? ''))
    // (a) one file per question, the plan's state asking; the plan that shares nothing went on and merged
    const a = readAsk('asks', '701-1')
    assert.deepEqual(Object.keys(a).sort(), ['context', 'humanOnly', 'id', 'kind', 'options', 'plan', 'question', 'recommendation'])
    assert.deepEqual([a.id, a.plan, a.kind, a.humanOnly, a.question], ['701-1', '701', 'scope', false, 'May plan 701 also write src/701-extra.txt?'])
    assert.deepEqual([a.recommendation, a.options[0]], [1, 'approved: src/701-extra.txt'])
    assert.match(a.options.at(-1), /^park: /)
    assert.match(a.context.reason, /^replan needed: /)
    assert.equal(a.context.proposal, 'the toy needs a second file')
    const d = readAsk('asks', '704-1')
    assert.deepEqual([d.kind, d.humanOnly], ['db-write', true])
    assert.equal(st().plans['703'].state, 'queued', 'the dependent of an asking plan waits')
    // (c) watch: RUNNING, one card per open ask
    const w = p.state('watch', '--run=asks')
    assert.equal(w.json.line, 'RUNNING', w.out)
    assert.match(w.out, /^ASK 701-1 · plan 701 · scope · the Human or the advisor answers: May plan 701/m)
    assert.match(w.out, /^ASK 704-1 · plan 704 · db-write · only the Human answers: /m)
    assert.match(w.out, /^ {2}answer: node scripts\/orch-state\.mjs answer --run asks --id 701-1 --choice 1$/m, 'the recommended option is stored first')
    // (e) an advisor's answer to a Human-only ask is refused with a run note; the ask stays open
    writeFileSync(join(asksDir('asks'), '704-1.answer.json'), JSON.stringify({ id: '704-1', by: 'advisor', choice: 1, option: 'x' }))
    await until('the advisor answer refused', () => st().notes.some((n) => n.plan === '704' && /refused: only the Human answers/.test(n.text)))
    assert.equal(existsSync(join(asksDir('asks'), '704-1.answer.json')), false, 'the refused answer is moved aside')
    assert.equal(st().plans['704'].state, 'asking')
    assert.match(p.state('watch', '--run=asks').out, /^ASK 704-1 /m)
    // (d) the answer command: a wrong choice is refused; the Human's answer is written with by: human
    assert.equal(p.state('answer', '--run=asks', '--id=701-1', '--choice=9').status, 1)
    assert.equal(p.state('answer', '--run=asks', '--id=709-1', '--choice=1').status, 1)
    const ans = p.state('answer', '--run=asks', '--id=701-1', '--choice=1')
    assert.equal(ans.status, 0, ans.out)
    assert.deepEqual([ans.json.answer.by, ans.json.answer.option], ['human', 'approved: src/701-extra.txt'])
    const t = p.state('answer', '--run=asks', '--id=704-1', '--text=no database write: build the toy without it')
    assert.equal(t.status, 0, t.out)
    const r = await run.done
    assert.equal(r.status, 0, r.out)
    const s = st()
    for (const n of ['701', '702', '703', '704']) assert.equal(s.plans[n].state, 'merged', `${n}: ${r.out}`)
    // the scope answer named a path: it is on the run branch's plan, and the resumed plan merged it
    assert.match(p.git(p.proj, 'show', 'origin/orch/asks:plans/701-toy-701.plan.md').out, /```scope\n[^`]*src\/701-extra\.txt\n```/)
    assert.equal(p.git(p.proj, 'show', 'origin/orch/asks:src/701-extra.txt').status, 0)
    // resumed in the same run, with the answer in the builder's prompt (plan 102's resume: the hand-off too)
    const calls = b.calls()
    const builds = (n) => calls.filter((c) => c.role === 'builder' && c.plan === n)
    assert.deepEqual(builds('701').map((c) => c.answer), [false, true])
    assert.deepEqual(builds('704').map((c) => c.answer), [false, true])
    assert.ok(s.notes.some((n) => n.plan === '701' && /resumed from park\/asks-701/.test(n.text)), JSON.stringify(s.notes))
    // the dependent ran after its dependency's answer
    assert.ok(builds('703')[0].at > builds('701')[1].at)
  } finally {
    // A failed assertion leaves the run waiting for answers: stop it, so the file ends.
    if (run && run.child.exitCode === null) run.child.kill()
    delete p.env.RUN_PLANS_ASK_WAIT_MS
    delete p.env.RUN_PLANS_ASK_POLL_MS
  }
})

test('(a)(c) same reason twice and a review that could not run twice ask; unanswered, they park with the question in the report and skip only their dependent', () => {
  const b = bin('claude-c', { reviewFails: ['713'] })
  Object.assign(p.env, { RUN_PLANS_ASK_WAIT_MS: '1500', RUN_PLANS_ASK_POLL_MS: '200' })
  try {
    const r = p.runPlans(['--run', 'unanswered', '--plans', '711,712,713', '--claude', b.file], { scenario: { 711: { builder: [{ gate: 'fail', text: 'same' }, { gate: 'fail', text: 'same' }] } } })
    assert.equal(r.status, 2, r.out)
    const s = p.status('unanswered')
    assert.equal(s.plans['711'].state, 'parked')
    assert.match(s.plans['711'].reason, /^same reason twice: gate: .* — ask 711-1 not answered/)
    const q = readAsk('unanswered', '711-1')
    assert.deepEqual([q.kind, q.humanOnly], ['technical', false])
    assert.match(q.options[0], /^park: /, 'the run recommends the park for its own code')
    assert.equal(s.plans['712'].state, 'skipped')
    assert.equal(s.plans['712'].reason, 'depends on parked 711')
    assert.equal(s.plans['713'].state, 'parked')
    assert.match(s.plans['713'].reason, /^review could not run: /)
    assert.equal(b.calls().filter((c) => c.role === 'reviewer' && c.plan === '713').length, 2, 'one retry before the ask')
    assert.equal(readAsk('unanswered', '713-1').kind, 'review')
    const report = readFileSync(join(p.proj, '.claude', 'orchestrator-runs', 'unanswered.md'), 'utf8')
    assert.match(report, /ask 711-1 not answered/)
    assert.match(report, new RegExp(q.question.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.deepEqual(readdirSync(asksDir('unanswered')).sort(), ['711-1.json', '713-1.json'])
  } finally {
    delete p.env.RUN_PLANS_ASK_WAIT_MS
    delete p.env.RUN_PLANS_ASK_POLL_MS
  }
})
