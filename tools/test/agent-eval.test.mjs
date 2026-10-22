// Agent eval harness (tools/agent-eval.mjs, tools/lib/agent-eval/*): scored with a stub runner, never a model call.
// A perfect stub scores recall 1.0 / precision 1.0 on the kit fixture cases; a stub that misses one expected finding
// scores recall below 1.0; one that adds a finding scores precision below 1.0; runs that differ report noise > 0;
// --min-recall 0.9 exits 1 at recall 0.8; findings match structurally (file, rule, severity, line ±3, text ignored);
// write-capable agents are refused; --model reaches the runner; the fixtures pass leak-check.
//   node --test tools/test/agent-eval.test.mjs
// Uses the kit's installed agents (after `node tools/sync.mjs --target . --apply`) and the kit fixture cases.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, chmodSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { findingMatches, matchFindings, compareCase, ruleMatches } from '../lib/agent-eval/compare.mjs'
import { noise } from '../lib/agent-eval/score.mjs'
import { evaluate, loadAgent, writeRefusal, claudeArgs, claudeRunner, usageTokens, formatTable, casePrompt } from '../lib/agent-eval/run.mjs'
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
  assert.equal(findingMatches(expected, { ...reworded, severity: 'minor' }), false, 'severity must match')
  assert.equal(findingMatches(expected, { ...reworded, file: 'src/other.mjs' }), false, 'file must match')
  assert.equal(findingMatches(expected, { ...reworded, rule: 'runtime: null input' }), false, 'rule category must match')
  assert.equal(ruleMatches('logic: exact detail', 'logic: other detail'), false, 'a full expected rule needs the same rule')
  assert.equal(ruleMatches(['evidence', 'A1'], 'A1: test file missing'), true, 'any listed rule is accepted')
  assert.equal(findingMatches({ file: 'plan.md', rule: 'evidence', severity: 'major' }, { file: 'plan.md', line: 99, rule: 'evidence: no command', severity: 'major' }), true, 'no expected line = any line')
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
  assert.match(r.out, /case\s+recall\s+precision\s+noise\s+tokens/)
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
