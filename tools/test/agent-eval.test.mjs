// Agent eval harness (tools/agent-eval.mjs, tools/lib/agent-eval/*): scored with a stub runner, never a model call.
// A perfect stub scores recall 1.0 / precision 1.0 on the kit fixture cases; a stub that misses one expected finding
// scores recall below 1.0; one that adds a finding scores precision below 1.0; runs that differ report noise > 0;
// --min-recall 0.9 exits 1 at recall 0.8; findings match structurally (file, rule, severity, line ±3, text ignored);
// write-capable agents are refused; --model reaches the runner; the fixtures pass leak-check.
//   node --test tools/test/agent-eval.test.mjs
// Uses the kit's installed agents (after `node tools/sync.mjs --target . --apply`) and the kit fixture cases.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { findingMatches, matchFindings, compareCase, ruleMatches } from '../lib/agent-eval/compare.mjs'
import { noise } from '../lib/agent-eval/score.mjs'
import { evaluate, loadAgent, writeRefusal, claudeArgs, claudeRunner, usageTokens, formatTable, casePrompt, findCases } from '../lib/agent-eval/run.mjs'
import { validateReviewerResult } from '../lib/agent-eval/reviewer.mjs'
import { combineReports } from '../lib/agent-eval/combine.mjs'
import { makeStub } from './fixtures/agent-eval-stub.mjs'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const cases = join(kit, 'tools', 'fixtures', 'agent-evals')
// AGENT_EVAL_ROOT=<project> measures that installed project's agent files instead (tools/e2e-check.mjs sets it).
const agentsRoot = process.env.AGENT_EVAL_ROOT ? resolve(process.env.AGENT_EVAL_ROOT) : kit
const agent = (name) => join(agentsRoot, '.claude', 'agents', `${name}.md`)
const cli = join(kit, 'tools', 'agent-eval.mjs')
const stubFile = join(kit, 'tools', 'test', 'fixtures', 'agent-eval-stub.mjs')
const tmp = mkdtempSync(join(tmpdir(), 'agent-eval-test-'))
after(() => rmSync(tmp, { recursive: true, force: true }))

const runCli = (args, mode = 'perfect') => {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: kit, encoding: 'utf8', env: { ...process.env, AGENT_EVAL_STUB: mode } })
  return { status: r.status, out: `${r.stdout}${r.stderr}` }
}

// A case set with one case of five expected findings: missing one gives recall exactly 0.8.
const fiveDir = join(tmp, 'five')
mkdirSync(join(fiveDir, 'five-findings', 'input'), { recursive: true })
writeFileSync(join(fiveDir, 'five-findings', 'input', 'diff.patch'), '')
writeFileSync(join(fiveDir, 'five-findings', 'expected.json'), JSON.stringify({
  findings: [1, 2, 3, 4, 5].map((n) => ({ file: `src/f${n}.mjs`, line: n * 10, rule: 'logic', severity: 'major' })),
}))

test('a reworded finding still matches: file, rule and severity match, line within ±3, text ignored', () => {
  const expected = { file: 'src/paginate.mjs', line: 4, rule: 'logic', severity: 'major' }
  const reworded = { file: './src/paginate.mjs', line: 6, rule: 'Logic: loop bound is inclusive', severity: 'major', reasoning: 'Entirely different words.' }
  assert.equal(findingMatches(expected, reworded), true)
  assert.equal(findingMatches(expected, { ...reworded, line: 8 }), false, 'line 4 lines away does not match')
  assert.equal(findingMatches(expected, { ...reworded, severity: 'blocker' }), true, 'plan 091: one severity level away matches')
  assert.equal(findingMatches(expected, { ...reworded, file: 'src/other.mjs' }), false, 'file must match')
  assert.equal(findingMatches(expected, { ...reworded, rule: 'runtime: null input' }), false, 'rule category must match')
  assert.equal(ruleMatches('logic: exact detail', 'logic: other detail'), false, 'a full expected rule needs the same rule')
  assert.equal(ruleMatches(['evidence', 'A1'], 'A1: test file missing'), true, 'any listed rule is accepted')
  assert.equal(findingMatches({ file: 'plan.md', rule: 'evidence', severity: 'major' }, { file: 'plan.md', line: 99, rule: 'evidence: no command', severity: 'major' }), true, 'no expected line = any line')
})

test('plan 091 severity: a finding one level from the label is a tp (blocker~major, major~minor); two levels apart is not', () => {
  const exp = (severity) => ({ file: 'src/a.mjs', line: 10, rule: 'logic', severity })
  const act = (severity) => ({ file: 'src/a.mjs', line: 11, rule: 'logic: x', severity })
  for (const [e, a] of [['major', 'blocker'], ['blocker', 'major'], ['major', 'minor'], ['minor', 'major']]) {
    assert.equal(findingMatches(exp(e), act(a)), true, `${e} ~ ${a}`)
    const c = compareCase({ findings: [exp(e)] }, { problems: [act(a)] })
    assert.deepEqual([c.tp, c.fn, c.fp], [1, 0, 0], `${e} vs ${a} is one tp, no fp and no fn`)
  }
  for (const [e, a] of [['blocker', 'minor'], ['minor', 'blocker']]) {
    assert.equal(findingMatches(exp(e), act(a)), false, `${e} vs ${a}: two levels apart`)
    const c = compareCase({ findings: [exp(e)] }, { problems: [act(a)] })
    assert.deepEqual([c.tp, c.fn, c.fp], [0, 1, 1])
  }
  assert.equal(findingMatches(exp('major'), act('weird')), false, 'an unknown severity matches only itself')
})

test('matching is one-to-one: two expected findings are not both satisfied by one actual finding', () => {
  const exp = { file: 'a.mjs', line: 10, rule: 'logic', severity: 'major' }
  const m = matchFindings([exp, { ...exp, line: 11 }], [{ ...exp, rule: 'logic: x' }])
  assert.equal(m.matched.length, 1)
  assert.equal(m.missed.length, 1)
})

test('pass/fail and verifier cases compare structurally', () => {
  assert.deepEqual(compareCase({ pass: false }, {}, { pass: false }).tp, 1)
  assert.deepEqual(compareCase({ pass: true }, {}, { pass: false }).fp, 1)
  const v = compareCase({ verdicts: [{ id: 'a', verdict: 'keep' }, { id: 'b', verdict: 'refuted' }] },
    { verdicts: [{ id: 'a', verdict: 'keep', confidence: 70 }, { id: 'b', verdict: 'keep', confidence: 95 }] })
  assert.deepEqual([v.tp, v.fn, v.fp], [0, 1, 1], 'a keep below the 80 threshold is not reported; a kept false alarm is a false positive')
})

for (const role of ['orch-check-bugs', 'orch-check-plan', 'orch-verify']) {
  test(`${role}: a perfect stub scores recall 1.0 / precision 1.0 / noise 0 on the kit fixture cases`, async () => {
    const r = await evaluate({ agentFile: agent(role), casesDir: cases, runs: 2, runner: makeStub('perfect') })
    assert.ok(r.cases.length >= 1)
    assert.equal(r.total.recall, 1)
    assert.equal(r.total.precision, 1)
    assert.equal(r.total.noise, 0)
    assert.equal(r.total.errors, 0)
    assert.equal(r.total.tokens, 200 * r.cases.length)
  })
}

test('a stub that misses one expected finding scores recall below 1.0', async () => {
  const r = await evaluate({ agentFile: agent('orch-check-bugs'), casesDir: cases, runs: 2, runner: makeStub('miss-one') })
  assert.ok(r.total.recall < 1, `recall ${r.total.recall}`)
  assert.equal(r.total.precision, 1)
})

test('a stub that adds one extra finding scores precision below 1.0', async () => {
  const r = await evaluate({ agentFile: agent('orch-check-bugs'), casesDir: cases, runs: 2, runner: makeStub('extra-one') })
  assert.ok(r.total.precision < 1, `precision ${r.total.precision}`)
  assert.equal(r.total.recall, 1)
  assert.equal(r.total.noise, 0, 'the same extra finding every run is not noise')
})

test('two runs whose results differ report a non-zero noise', async () => {
  const r = await evaluate({ agentFile: agent('orch-check-bugs'), casesDir: cases, runs: 2, runner: makeStub('noisy') })
  assert.ok(r.total.noise > 0, `noise ${r.total.noise}`)
  assert.ok(r.cases.every((c) => c.noise > 0))
  assert.equal(noise([{ keys: ['a'] }, { keys: ['a'] }]), 0)
  assert.equal(noise([{ keys: ['a'] }, { keys: ['a', 'b'] }]), 0.5)
})

test('a reply with no valid JSON result counts as an error and finds nothing', async () => {
  const r = await evaluate({ agentFile: agent('orch-check-bugs'), casesDir: cases, runs: 1, runner: makeStub('garbage') })
  assert.equal(r.total.errors, r.cases.length)
  assert.equal(r.total.recall, 0)
  assert.match(formatTable(r), /no JSON result/)
})

test('--model overrides the agent model for the runner and the report', async () => {
  makeStub.calls = []
  const r = await evaluate({ agentFile: agent('orch-check-bugs'), casesDir: cases, runs: 1, model: 'claude-haiku-test', runner: makeStub('perfect') })
  assert.equal(r.model, 'claude-haiku-test')
  assert.ok(makeStub.calls.length > 0 && makeStub.calls.every((c) => c.model === 'claude-haiku-test'))
  const d = await evaluate({ agentFile: agent('orch-check-bugs'), casesDir: cases, runs: 1, runner: makeStub('perfect') })
  assert.equal(d.model, loadAgent(agent('orch-check-bugs')).model, 'without --model the agent file model is used')
})

test('CLI: --min-recall 0.9 exits 1 when recall is 0.8, and 0 when it is met', () => {
  const low = runCli(['--agent', agent('orch-check-bugs'), '--cases', fiveDir, '--runs', '2', '--runner', stubFile, '--min-recall', '0.9'], 'miss-one')
  assert.equal(low.status, 1, low.out)
  assert.match(low.out, /^TOTAL\s+0\.80\s+1\.00\s+0\.00\s/m)
  assert.match(low.out, /AGENT_EVAL: FAIL — recall 0\.80 < 0\.9/)
  const ok = runCli(['--agent', agent('orch-check-bugs'), '--cases', fiveDir, '--runner', stubFile, '--min-recall', '0.9', '--min-precision', '0.9'], 'perfect')
  assert.equal(ok.status, 0, ok.out)
  assert.match(ok.out, /AGENT_EVAL: ok/)
  const prec = runCli(['--agent', agent('orch-check-bugs'), '--cases', fiveDir, '--runner', stubFile, '--min-precision', '0.9'], 'extra-one')
  assert.equal(prec.status, 1, prec.out)
  assert.match(prec.out, /precision 0\.83 < 0\.9/)
})

test('CLI: the table has a row per case and a total line', () => {
  const r = runCli(['--agent', agent('orch-check-bugs'), '--cases', cases, '--runner', stubFile])
  assert.equal(r.status, 0, r.out)
  for (const c of ['off-by-one', 'regex-backslash', 'clean-change', 'TOTAL']) assert.match(r.out, new RegExp(`^${c}\\s`, 'm'))
  assert.match(r.out, /case\s+recall\s+precision\s+noise\s+unscored\s+tokens/)
})

test('a write-capable agent is refused unless --allow-write is passed', () => {
  const dir = join(tmp, 'agents')
  mkdirSync(dir, { recursive: true })
  const writer = join(dir, 'orch-check-bugs.md')
  writeFileSync(writer, '---\nname: orch-check-bugs\ntools: Read, Edit\nmodel: sonnet\n---\nbody\n')
  const refused = runCli(['--agent', writer, '--cases', cases, '--runner', stubFile])
  assert.equal(refused.status, 2, refused.out)
  assert.match(refused.out, /can write files \(tools: Edit\)/)
  const allowed = runCli(['--agent', writer, '--cases', cases, '--runner', stubFile, '--allow-write'])
  assert.equal(allowed.status, 0, allowed.out)
  assert.match(writeRefusal({ name: 'x', tools: null }), /inherits every tool/)
  assert.equal(writeRefusal(loadAgent(agent('orch-verify')), false, { isolated: true }), null, 'the verifier (Read, Bash) is allowed on an isolating runner')
  assert.equal(writeRefusal(loadAgent(agent('orch-security'))), null, 'a read-only agent with no Bash needs no isolation')
})

test('Bash can write: an agent with Bash is refused on a runner that does not isolate its cases', async () => {
  assert.match(writeRefusal({ name: 'x', tools: ['Read', 'Bash'] }), /can write files through Bash/)
  assert.equal(writeRefusal({ name: 'x', tools: ['Read', 'Bash'] }, true), null, '--allow-write still runs it')
  await assert.rejects(evaluate({ agentFile: agent('orch-check-bugs'), casesDir: cases, runs: 1, runner: makeStub('perfect', { isolated: false }) }), /through Bash/)
  assert.equal(claudeRunner().isolated, true, 'the default runner isolates each case')
})

test('model inherit passes no --model to claude (the session default), a named model does', () => {
  const a = loadAgent(agent('orch-check-bugs'))
  assert.ok(!claudeArgs({ agent: a, model: 'inherit', systemPromptFile: 's.md' }).includes('--model'))
  assert.ok(!claudeArgs({ agent: a, model: null, systemPromptFile: 's.md' }).includes('--model'))
  assert.ok(claudeArgs({ agent: a, model: 'sonnet', systemPromptFile: 's.md' }).includes('--model'))
})

test('the real runner runs each case in a scratch copy: a file the agent writes never lands in the case folder', async () => {
  const caseInput = join(tmp, 'iso-case', 'input')
  mkdirSync(caseInput, { recursive: true })
  writeFileSync(join(caseInput, 'diff.patch'), '')
  // A fake `claude`: writes a file in its working folder and answers with that folder.
  const fake = join(tmp, 'fake-claude.mjs')
  writeFileSync(fake, [
    "import { writeFileSync, existsSync } from 'node:fs'",
    "writeFileSync('written-by-agent.txt', 'x')",
    "process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({ result: JSON.stringify({ cwd: process.cwd(), copied: existsSync('diff.patch') }), usage: { input_tokens: 1 }, total_cost_usd: 0 })))",
  ].join('\n'))
  let bin
  if (process.platform === 'win32') bin = `"${process.execPath}" "${fake}"`
  else {
    bin = join(tmp, 'fake-claude')
    writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`)
    chmodSync(bin, 0o755)
  }
  const reply = await claudeRunner({ bin, timeoutMs: 60_000 })({ agent: loadAgent(agent('orch-check-bugs')), model: 'inherit', role: 'orch-check-bugs', inputDir: caseInput })
  const seen = JSON.parse(reply.text)
  assert.equal(seen.copied, true, 'the case input is copied into the scratch folder')
  assert.notEqual(resolve(seen.cwd), resolve(caseInput))
  assert.equal(existsSync(join(caseInput, 'written-by-agent.txt')), false, 'the case folder is untouched')
  assert.equal(existsSync(seen.cwd), false, 'the scratch copy is removed after the run')
})

test('the real runner calls Claude Code non-interactively with the agent prompt, model and read-only tools', () => {
  const a = loadAgent(agent('orch-check-bugs'))
  const args = claudeArgs({ agent: a, model: 'opus', systemPromptFile: 'sys.md' })
  assert.deepEqual(args.slice(0, 5), ['-p', '--output-format', 'json', '--system-prompt-file', 'sys.md'])
  assert.equal(args[args.indexOf('--model') + 1], 'opus')
  assert.equal(args[args.indexOf('--tools') + 1], 'Read,Grep,Glob,Bash')
  assert.match(args[args.indexOf('--disallowedTools') + 1], /Edit,Write/)
  assert.equal(usageTokens({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2, service_tier: 'x' }), 17)
  const prompt = casePrompt({ role: 'orch-check-bugs', inputDir: join(cases, 'orch-check-bugs', 'off-by-one', 'input') })
  assert.match(prompt, /--- src\/paginate\.mjs ---/)
  assert.match(prompt, /--- diff\.patch ---/)
})

test('the kit fixture cases name no project, path or port (leak-check)', () => {
  const r = spawnSync(process.execPath, [join(kit, 'tools', 'leak-check.mjs'), '--root', cases], { cwd: kit, encoding: 'utf8' })
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`)
  assert.match(r.stdout, /LEAK_CHECK: ok/)
})

test('plan 049 --redact: the case plan loses its Execution Notes, keeps every checkbox, and the prompt says diffs only', () => {
  const dir = join(tmp, 'redact-input')
  mkdirSync(dir, { recursive: true })
  const plan = ['# Plan 1', '', '## Atomic Sub-tasks', '- [x] T1: done thing', '- [ ] T2: open thing', '', '## Execution Notes', '- tests pass, scope respected', 'removes: a key handler — reverse: add it', '', '## Out of Scope', '- nothing', ''].join('\n')
  writeFileSync(join(dir, 'plan.md'), plan)
  writeFileSync(join(dir, 'diff.patch'), 'diff --git a/x b/x\n')
  const plain = casePrompt({ role: 'orch-check-plan', inputDir: dir })
  assert.match(plain, /## Execution Notes/)
  assert.doesNotMatch(plain, /read diffs only/)
  const red = casePrompt({ role: 'orch-check-plan', inputDir: dir, redact: true })
  assert.doesNotMatch(red, /## Execution Notes/)
  assert.doesNotMatch(red, /tests pass, scope respected|removes: a key handler/)
  assert.match(red, /- \[x\] T1: done thing/)
  assert.match(red, /- \[ \] T2: open thing/)
  assert.match(red, /## Out of Scope/, 'the next section stays')
  assert.match(red, /read diffs only \(`git diff`, `git show --format=`\)/)
})

test('plan 049 --with-gate: gate.json reaches the agent only with the flag', () => {
  const dir = join(tmp, 'gate-input')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'candidates.json'), '[]')
  writeFileSync(join(dir, 'gate.json'), '[{"command":"npm test","status":"pass"}]')
  assert.doesNotMatch(casePrompt({ role: 'orch-verify', inputDir: dir }), /gate\.json/)
  assert.match(casePrompt({ role: 'orch-verify', inputDir: dir, withGate: true }), /--- gate\.json ---/)
})

test('plan 049 --case-list runs only the listed cases and reports the run-to-run spread', async () => {
  const list = join(tmp, 'cases.txt')
  writeFileSync(list, '# c\norch-check-bugs/off-by-one\norch-check-plan/other\n')
  const r = runCli(['--agent', agent('orch-check-bugs'), '--cases', cases, '--runs', '2', '--runner', stubFile, '--case-list', list, '--json'], 'noisy')
  const report = JSON.parse(r.out.slice(r.out.indexOf('{')))
  assert.deepEqual(report.cases.map((c) => c.name), ['off-by-one'])
  assert.equal(report.runTotals.length, 2)
  assert.ok(report.total.spread.precision > 0, 'run 2 adds an extra finding, run 1 does not: the totals differ')
  const bad = runCli(['--agent', agent('orch-check-bugs'), '--cases', cases, '--runner', stubFile, '--case-list', list.replace('cases.txt', 'nope.txt')])
  assert.equal(bad.status, 2)
  writeFileSync(list, 'orch-check-bugs/not-a-case\n')
  assert.equal(runCli(['--agent', agent('orch-check-bugs'), '--cases', cases, '--runner', stubFile, '--case-list', list]).status, 2, 'a listed case that is missing is an error')
})

// ---- plan 087: one reviewer scored against every case (--role all), the reviewer schema, the combined before-run ----

const reviewerAgent = join(tmp, 'agents-087', 'plan-reviewer.md')
mkdirSync(join(tmp, 'agents-087'), { recursive: true })
writeFileSync(reviewerAgent, '---\nname: plan-reviewer\ntools: Read, Grep, Glob, Bash\nmodel: sonnet\neffort: high\n---\nbody\n')

// A reviewer stub: answers every case with its expected findings (a verifier case's kept candidates) and a verdict.
// `stub.hidden` records, per case, the files the runner was told to hide.
const reviewerStub = (mode = 'perfect') => {
  const stub = async ({ role, model, caseName, caseDir, inputDir, hide = [] }) => {
    stub.hidden[caseName] = hide
    const expected = JSON.parse(readFileSync(join(caseDir, 'expected.json'), 'utf8'))
    let findings = expected.findings ?? []
    if (Array.isArray(expected.verdicts)) {
      const cands = JSON.parse(readFileSync(join(inputDir, 'candidates.json'), 'utf8'))
      findings = expected.verdicts.filter((v) => v.verdict === 'keep').map((v) => cands.find((c) => c.id === v.id))
    }
    const problems = findings.map((f, i) => ({ id: `rev-${i + 1}`, file: f.file, line: f.line ?? 1, rule: `${Array.isArray(f.rule) ? f.rule[0] : f.rule.split(':')[0]}: stub`, reasoning: 'stub', severity: f.severity }))
    const fails = problems.some((p) => ['blocker', 'major'].includes(p.severity))
    const verdict = mode === 'lying-verdict' ? 'PASS' : fails ? 'STOP' : 'PASS'
    const pass = mode === 'lying-verdict' ? undefined : !fails
    return { text: '```json\n' + JSON.stringify({ role, model: model ?? 'stub', effort: 'high', problems, pass, verdict }) + '\n```', tokens: 10, costUsd: 0.01 }
  }
  stub.hidden = {}
  stub.isolated = true
  return stub
}

test('plan 087 --role all: an agent that is not a checker is scored on every <role>/<case>, verifier cases as findings', async () => {
  const all = findCases(cases, 'all')
  const names = all.map((c) => c.name)
  for (const n of ['orch-check-bugs/off-by-one', 'orch-check-plan/claim-no-evidence', 'orch-verify/refutable-false-alarm']) assert.ok(names.includes(n), `${n} in ${names.join(', ')}`)
  const verify = all.find((c) => c.name === 'orch-verify/refutable-false-alarm')
  assert.deepEqual(verify.expected.findings.map((f) => [f.file, f.line, f.severity]), [['src/list.mjs', 2, 'major']], 'only the kept candidate is expected')
  assert.ok(verify.expected.findings[0].rule.includes('logic') && verify.expected.findings[0].rule.includes('wrong result'))
  assert.deepEqual(verify.hide, ['candidates.json'])
  const stub = reviewerStub()
  const r = await evaluate({ agentFile: reviewerAgent, casesDir: cases, runs: 2, runner: stub })
  assert.equal(r.role, 'all')
  assert.equal(r.cases.length, all.length)
  assert.equal(r.total.errors, 0, JSON.stringify(r.cases.flatMap((c) => c.errorDetails)))
  assert.equal(r.total.recall, 1)
  assert.equal(r.total.precision, 1)
  assert.deepEqual(stub.hidden['orch-verify/refutable-false-alarm'], ['candidates.json'], 'the runner is told to hide the finders\' candidates')
})

test('plan 087 --role: a checker keeps its own folder by default; --role all and --role <name> override it', async () => {
  const own = await evaluate({ agentFile: agent('orch-check-bugs'), casesDir: cases, runs: 1, runner: makeStub('perfect') })
  assert.ok(own.cases.every((c) => !c.name.includes('/')), 'a checker on its own folder: plain case names')
  assert.equal(own.role, 'orch-check-bugs')
  const one = await evaluate({ agentFile: reviewerAgent, casesDir: cases, runs: 1, runner: reviewerStub(), role: 'orch-check-bugs' })
  assert.deepEqual(one.cases.map((c) => c.name).sort(), ['clean-change', 'off-by-one', 'regex-backslash'])
  const list = join(tmp, 'all-cases.txt')
  writeFileSync(list, '# 087\norch-check-bugs/off-by-one\norch-verify/refutable-false-alarm\n')
  const r = runCli(['--agent', reviewerAgent, '--cases', cases, '--runs', '1', '--runner', stubFile, '--case-list', list, '--role', 'all', '--json'], 'perfect')
  const report = JSON.parse(r.out.slice(r.out.indexOf('{')))
  assert.deepEqual(report.cases.map((c) => c.name), ['orch-check-bugs/off-by-one', 'orch-verify/refutable-false-alarm'])
  assert.equal(runCli(['--agent', reviewerAgent, '--cases', cases, '--runner', stubFile, '--role']).status, 2, '--role needs a value')
})

test('plan 087 reviewer schema: the finder schema plus verdict PASS|STOP, and the verdict is computed, never trusted', async () => {
  const ok = { role: 'plan-reviewer', model: 'm', effort: 'high', problems: [], pass: true, verdict: 'PASS' }
  assert.deepEqual(validateReviewerResult(ok, 'plan-reviewer').errors, [])
  const major = { id: 'r1', file: 'a.mjs', line: 3, rule: 'wrong result: x', reasoning: 'y', severity: 'major' }
  assert.equal(validateReviewerResult({ ...ok, problems: [major], pass: false, verdict: 'STOP' }, 'plan-reviewer').ok, true)
  assert.equal(validateReviewerResult({ ...ok, problems: [{ ...major, severity: 'minor' }], verdict: 'PASS' }, 'plan-reviewer').ok, true, 'a minor problem does not stop; pass may be left out')
  assert.match(validateReviewerResult({ ...ok, problems: [major], pass: undefined, verdict: 'PASS' }, 'plan-reviewer').errors.join('\n'), /never trusted/)
  assert.match(validateReviewerResult({ ...ok, verdict: 'MAYBE' }, 'plan-reviewer').errors.join('\n'), /PASS or STOP/)
  assert.match(validateReviewerResult({ ...ok, role: 'orch-check-bugs' }, 'plan-reviewer').errors.join('\n'), /role must be plan-reviewer/)
  assert.match(validateReviewerResult({ ...ok, problems: [{ ...major, line: undefined }], pass: false, verdict: 'STOP' }, 'plan-reviewer').errors.join('\n'), /line must be a line number/)
  const r = await evaluate({ agentFile: reviewerAgent, casesDir: cases, runs: 1, runner: reviewerStub('lying-verdict') })
  assert.ok(r.total.errors > 0, 'a STOP-worthy result that says PASS is an invalid result')
})

test('plan 087 the real runner copies only what the prompt shows: redacted plan, no hidden file, gate.json only with --with-gate', async () => {
  const caseInput = join(tmp, 'blind-case', 'input')
  mkdirSync(caseInput, { recursive: true })
  writeFileSync(join(caseInput, 'plan.md'), '# P\n\n## Goals\n- g\n\n## Execution Notes\n- tests pass\n')
  writeFileSync(join(caseInput, 'candidates.json'), '[]')
  writeFileSync(join(caseInput, 'gate.json'), '[]')
  writeFileSync(join(caseInput, 'diff.patch'), '')
  const fake = join(tmp, 'fake-claude-087.mjs')
  writeFileSync(fake, [
    "import { readFileSync, existsSync } from 'node:fs'",
    "let input = ''",
    "process.stdin.on('data', (d) => { input += d })",
    "process.stdin.on('end', () => console.log(JSON.stringify({ result: JSON.stringify({ plan: readFileSync('plan.md', 'utf8'), cand: existsSync('candidates.json'), gate: existsSync('gate.json'), promptCand: input.includes('--- candidates.json ---') }), usage: {}, total_cost_usd: 0 })))",
  ].join('\n'))
  let bin
  if (process.platform === 'win32') bin = `"${process.execPath}" "${fake}"`
  else {
    bin = join(tmp, 'fake-claude-087')
    writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`)
    chmodSync(bin, 0o755)
  }
  const run = claudeRunner({ bin, timeoutMs: 60_000 })
  const a = loadAgent(reviewerAgent)
  const blind = JSON.parse((await run({ agent: a, model: 'inherit', role: 'plan-reviewer', inputDir: caseInput, redact: true, hide: ['candidates.json'] })).text)
  assert.doesNotMatch(blind.plan, /Execution Notes|tests pass/, 'the copy holds the redacted plan')
  assert.equal(blind.cand, false, 'a hidden file is not copied')
  assert.equal(blind.promptCand, false, 'nor shown')
  assert.equal(blind.gate, false, 'gate.json is copied only with --with-gate')
  const gated = JSON.parse((await run({ agent: a, model: 'inherit', role: 'plan-reviewer', inputDir: caseInput, withGate: true })).text)
  assert.equal(gated.gate, true)
  assert.match(gated.plan, /Execution Notes/, 'without --redact the plan is copied as it is')
})

test('plan 087 --combine: several role reports summed into one report under one agent name (the before arm of the A/B)', () => {
  const dir = join(tmp, 'combine')
  mkdirSync(dir, { recursive: true })
  const rep = (agentName, cs) => ({ agent: agentName, model: 'sonnet', cases: cs, total: {} })
  const c = (name, tp, fn, fp, noiseV, cost, errors = 0) => ({ name, runs: 2, tp, fn, fp, recall: 0, precision: 0, noise: noiseV, tokens: 100, costUsd: cost, errors, errorDetails: [] })
  const a = rep('orch-check-bugs', [c('x', 1, 1, 2, 0.5, 1), c('y', 0, 0, 0, 0, 1, 1)])
  const b = rep('orch-verify', [c('z', 1, 1, 0, 0, 2)])
  writeFileSync(join(dir, 'a.json'), JSON.stringify(a))
  writeFileSync(join(dir, 'b.json'), JSON.stringify(b))
  const merged = combineReports([a, b], { agent: 'plan-reviewer' })
  assert.equal(merged.agent, 'plan-reviewer')
  assert.deepEqual(merged.combinedFrom, ['orch-check-bugs', 'orch-verify'])
  assert.deepEqual(merged.cases.map((x) => x.name), ['orch-check-bugs/x', 'orch-check-bugs/y', 'orch-verify/z'])
  assert.deepEqual([merged.total.tp, merged.total.fn, merged.total.fp, merged.total.errors], [2, 2, 2, 1])
  assert.equal(merged.total.recall, 0.5)
  assert.equal(merged.total.precision, 0.5)
  assert.equal(merged.total.costUsd, 4)
  assert.equal(merged.total.noise, 0.5 / 3)
  const out = join(dir, 'out', 'plan-reviewer.json')
  const r = runCli(['--combine', join(dir, 'a.json'), '--combine', join(dir, 'b.json'), '--as', 'plan-reviewer', '--out', out])
  assert.equal(r.status, 0, r.out)
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).total.tp, 2)
  assert.equal(runCli(['--combine', join(dir, 'a.json')]).status, 2, '--combine needs --as and --out')
})

// ---- plan 091: plan-step findings on plan.md are not scored on bug and verify cases (their diff is only a slice) ----

test('plan 091 unscored: on a bug or verify case, a plan.md finding of category done-when, scope or a sub-task id is neither tp nor fp', () => {
  const code = { file: 'src/a.mjs', line: 10, rule: 'logic', severity: 'major' }
  const found = { ...code, rule: 'logic: x' }
  const steps = [
    { file: 'plan.md', line: 40, rule: 'done-when: the test item has no change in the diff', severity: 'major' },
    { file: './plan.md', line: 12, rule: 'Scope: out of scope', severity: 'minor' },
    { file: 'plan.md', line: 20, rule: 'A2: ticked but not in the diff', severity: 'major' },
    { file: 'plan.md', line: 21, rule: 'm6', severity: 'blocker' },
  ]
  for (const caseRole of ['orch-check-bugs', 'orch-verify']) {
    const c = compareCase({ findings: [code] }, { problems: [found, ...steps] }, { caseRole })
    assert.deepEqual([c.tp, c.fn, c.fp, c.unscored], [1, 0, 0, 4], caseRole)
    assert.ok(c.keys.every((k) => !k.includes('plan.md')), 'unscored findings are left out of the noise keys')
  }
  for (const caseRole of ['orch-check-plan', 'orch-check-rules', null]) {
    const c = compareCase({ findings: [code] }, { problems: [found, ...steps] }, { caseRole })
    assert.deepEqual([c.tp, c.fn, c.fp, c.unscored], [1, 0, 4, 0], `${caseRole}: scored as before`)
  }
  const other = compareCase({ findings: [code] }, { problems: [found, { file: 'plan.md', line: 3, rule: 'evidence: no command', severity: 'major' }, { file: 'src/b.mjs', line: 3, rule: 'done-when: x', severity: 'major' }] }, { caseRole: 'orch-check-bugs' })
  assert.deepEqual([other.fp, other.unscored], [2, 0], 'another plan.md category, or done-when on a code file, is still scored')
})

test('plan 091 unscored: evaluate passes the case role, the report and the A/B table carry the unscored figure', async () => {
  const dir = join(tmp, 'cases-091')
  for (const role of ['orch-check-bugs', 'orch-check-plan']) {
    mkdirSync(join(dir, role, 'c1', 'input'), { recursive: true })
    writeFileSync(join(dir, role, 'c1', 'input', 'diff.patch'), '')
    writeFileSync(join(dir, role, 'c1', 'expected.json'), JSON.stringify({ findings: [{ file: 'src/a.mjs', line: 5, rule: 'logic', severity: 'major' }] }))
  }
  const stub = async ({ role }) => ({ text: JSON.stringify({ role, model: 'stub', effort: 'high', problems: [
    { id: 'r1', file: 'src/a.mjs', line: 5, rule: 'logic: x', reasoning: 'y', severity: 'blocker' },
    { id: 'r2', file: 'plan.md', line: 30, rule: 'D1: ticked, no change in the diff', reasoning: 'y', severity: 'major' },
  ], pass: false, verdict: 'STOP' }), tokens: 1, costUsd: 0 })
  stub.isolated = true
  const r = await evaluate({ agentFile: reviewerAgent, casesDir: dir, runs: 2, runner: stub })
  const byName = Object.fromEntries(r.cases.map((c) => [c.name, c]))
  assert.deepEqual([byName['orch-check-bugs/c1'].tp, byName['orch-check-bugs/c1'].fp, byName['orch-check-bugs/c1'].unscored], [2, 0, 2])
  assert.deepEqual([byName['orch-check-plan/c1'].tp, byName['orch-check-plan/c1'].fp, byName['orch-check-plan/c1'].unscored], [2, 2, 0])
  assert.deepEqual([r.total.tp, r.total.fp, r.total.unscored], [4, 2, 2])
  assert.ok(r.runTotals.every((t) => t.unscored === 1), 'each run unscored one finding')
  assert.match(formatTable(r), /unscored/)
  // A checker on its own folder (plain case names): the scope is the case role.
  const ownStub = async (a) => stub({ ...a, role: 'orch-check-bugs' })
  ownStub.isolated = true
  const own = await evaluate({ agentFile: agent('orch-check-bugs'), casesDir: dir, runs: 1, runner: ownStub })
  assert.equal(own.total.unscored, 1)
  const { compare } = await import('../agent-eval-ab.mjs')
  const { text } = compare({ before: { 'plan-reviewer': r }, arms: [{ name: 'after', reports: { 'plan-reviewer': r } }] })
  assert.match(text, /\| Run \| Recall \| Precision \| Noise \| Unscored \|/)
  assert.match(text, /\| before \| 1\.00 \| 0\.67 \| 0\.00 \| 2 \|/)
})
