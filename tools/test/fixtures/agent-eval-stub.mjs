// Stub runner for tools/test/agent-eval.test.mjs — answers from the case's own expected.json, no model call.
// Default export: the runner, whose mode comes from AGENT_EVAL_STUB (perfect | miss-one | extra-one | noisy | garbage),
// for `node tools/agent-eval.mjs --runner tools/test/fixtures/agent-eval-stub.mjs`. makeStub(mode) for in-process use.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const EXTRA = { file: 'src/extra.mjs', line: 1, rule: 'logic: stub extra finding', reasoning: 'stub', severity: 'major' }

// isolated: the stub never runs the agent, so an agent with Bash writes nothing (tools/lib/agent-eval/run.mjs
// writeRefusal); makeStub(mode, { isolated: false }) is a runner that does not isolate its cases.
export function makeStub(mode = 'perfect', { isolated = true } = {}) {
  const stub = async ({ role, model, caseDir, run }) => {
    const calls = (makeStub.calls ??= [])
    calls.push({ role, model, run })
    if (mode === 'garbage') return { text: 'not json at all', tokens: 5, costUsd: 0 }
    const expected = JSON.parse(readFileSync(join(caseDir, 'expected.json'), 'utf8'))
    const result = { role, model: model ?? 'stub', effort: 'stub' }
    if (Array.isArray(expected.verdicts)) {
      result.verdicts = expected.verdicts.map((v) => (v.verdict === 'keep'
        ? { id: v.id, verdict: 'keep', confidence: 90, severity: 'major', note: 'stub' }
        : { id: v.id, verdict: 'refuted', confidence: 90, severity: 'major', refutation: 'stub: guard at the cited file' }))
    } else {
      let problems = (expected.findings ?? []).map((f, i) => ({
        id: `stub-${i + 1}`,
        file: f.file,
        line: f.line ?? 1,
        rule: Array.isArray(f.rule) ? `${f.rule[0]}: stub wording` : (f.rule.includes(':') ? f.rule : `${f.rule}: stub wording`),
        reasoning: 'Reworded by the stub; the text is never compared.',
        severity: f.severity,
      }))
      if (mode === 'miss-one') problems = problems.slice(1)
      if (mode === 'extra-one' || (mode === 'noisy' && run % 2 === 0)) problems.push({ id: 'stub-extra', ...EXTRA })
      result.problems = problems
    }
    return { text: '```json\n' + JSON.stringify(result) + '\n```', tokens: 100, costUsd: 0.001 }
  }
  stub.isolated = isolated
  return stub
}

export default makeStub(process.env.AGENT_EVAL_STUB ?? 'perfect')
