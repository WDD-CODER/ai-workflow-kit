// Role-agent contracts: each installed `.claude/agents/orch-*.md` documents a JSON result under `## Output` that the
// shared validator (tools/lib/agent-result.mjs) accepts; the validator rejects a result without `model`/`effort` and a
// `pass: true` that its own problems contradict; every agent file pins `model:` and `effort:`; the builder cannot start
// agents or message anyone; no role prompt names a deny-listed command.
//   node --test tools/test/agent-contracts.test.mjs
// Reads the kit repo's installed copies (after `node tools/sync.mjs --target . --apply`). AGENT_CONTRACTS_ROOT=<project>
// reads another installed project instead (tools/e2e-check.mjs points it at its fresh e2e project).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateAgentResult, parseAgentResult, outputExample, ROLES } from '../lib/agent-result.mjs'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const project = process.env.AGENT_CONTRACTS_ROOT ? resolve(process.env.AGENT_CONTRACTS_ROOT) : kit
const agentsDir = join(project, '.claude', 'agents')
const agentFiles = readdirSync(agentsDir).filter((f) => f.endsWith('.md'))
const read = (f) => readFileSync(join(agentsDir, f), 'utf8')
const frontmatter = (text) => {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  assert.ok(m, 'agent file has frontmatter')
  return Object.fromEntries(m[1].split(/\r?\n/).map((l) => /^(\w+):\s*(.*)$/.exec(l)).filter(Boolean).map((x) => [x[1], x[2].trim()]))
}
const DENY = [/reset --hard/, /push --force/, /push -f\b/, /\brm -r/, /\brm -rf/]

test('every role agent exists, once', () => {
  for (const role of ROLES) assert.ok(agentFiles.includes(`${role}.md`), `${role}.md is installed in ${agentsDir}`)
})

for (const role of ROLES) {
  test(`${role}: the documented ## Output example passes the shared validator`, () => {
    const text = read(`${role}.md`)
    const example = outputExample(text)
    assert.equal(example.role, role)
    const r = validateAgentResult(example)
    assert.deepEqual(r.errors, [], `${role} example: ${r.errors.join('; ')}`)
    assert.equal(r.ok, true)
    assert.equal(frontmatter(text).name, role)
  })
}

test('every agent file pins model: and effort:, and none has an empty tools:', () => {
  for (const f of agentFiles) {
    const fm = frontmatter(read(f))
    assert.ok(fm.model, `${f}: model: is missing or empty`)
    assert.ok(!/\{\{/.test(fm.model), `${f}: model: is not rendered (${fm.model})`)
    assert.ok(fm.effort, `${f}: effort: is missing or empty`)
    if ('tools' in fm) assert.ok(fm.tools, `${f}: tools: is empty`)
  }
})

test('the builder has neither Agent nor SendMessage, and edits files', () => {
  const tools = frontmatter(read('orch-builder.md')).tools.split(',').map((t) => t.trim())
  assert.ok(!tools.includes('Agent') && !tools.includes('SendMessage') && !tools.includes('Task'), `orch-builder tools: ${tools.join(', ')}`)
  for (const t of ['Read', 'Edit', 'Write', 'Bash']) assert.ok(tools.includes(t), `orch-builder needs ${t}`)
})

test('the security reviewer is read-only', () => {
  const tools = frontmatter(read('orch-security.md')).tools.split(',').map((t) => t.trim())
  assert.deepEqual(tools.filter((t) => !['Read', 'Grep', 'Glob'].includes(t)), [])
})

test('no role agent names a deny-listed command', () => {
  for (const f of agentFiles.filter((x) => x.startsWith('orch-'))) {
    const text = read(f)
    for (const re of DENY) assert.ok(!re.test(text), `${f} contains ${re}`)
  }
})

const finder = (over = {}) => ({ role: 'orch-check-bugs', model: 'claude-x', effort: 'high', problems: [], pass: true, ...over })
const major = { id: 'b1', file: 'src/a.mjs', line: 3, rule: 'runtime', reasoning: 'crashes on null', severity: 'major' }

test('validator: a result missing model (or effort) is rejected', () => {
  const { model, ...noModel } = finder()
  assert.equal(validateAgentResult(noModel).ok, false)
  assert.match(validateAgentResult(noModel).errors.join('\n'), /model is required/)
  const { effort, ...noEffort } = finder()
  assert.match(validateAgentResult(noEffort).errors.join('\n'), /effort is required/)
})

test('validator: pass: true with a major problem is rejected; pass is computed', () => {
  const lie = validateAgentResult(finder({ problems: [major], pass: true }))
  assert.equal(lie.ok, false)
  assert.equal(lie.pass, false)
  assert.match(lie.errors.join('\n'), /never trusted/)
  assert.equal(validateAgentResult(finder({ problems: [major], pass: false })).ok, true)
  assert.equal(validateAgentResult(finder({ problems: [{ ...major, severity: 'minor' }], pass: true })).ok, true)
  assert.equal(validateAgentResult(finder({ problems: [{ ...major, line: undefined }], pass: false })).ok, false)
})

test('validator: verifier keeps only >= 80 confidence, and a refutation must be concrete', () => {
  const v = (verdicts, pass) => validateAgentResult({ role: 'orch-verify', model: 'm', effort: 'medium', verdicts, pass })
  assert.equal(v([{ id: 'a', verdict: 'keep', confidence: 90, severity: 'major' }], true).ok, false)
  assert.equal(v([{ id: 'a', verdict: 'keep', confidence: 60, severity: 'major' }], true).ok, true)
  assert.equal(v([{ id: 'a', verdict: 'refuted', confidence: 90, severity: 'major' }], true).ok, false)
  assert.equal(v([{ id: 'a', verdict: 'refuted', confidence: 90, severity: 'major', refutation: 'src/a.mjs:4 guards null' }], true).ok, true)
})

test('validator: gate, builder, merge and the reply parser', () => {
  const gate = (results, pass) => validateAgentResult({ role: 'orch-gate', model: 'm', effort: 'low', results, pass })
  assert.equal(gate([{ command: 'x', status: 'fail' }], false).ok, false, 'a failed command needs its tail')
  assert.equal(gate([{ command: 'x', status: 'env-fail' }], true).ok, false, 'env-fail is not a pass')
  assert.equal(gate([{ command: 'x', status: 'pass' }], true).ok, true)
  const b = { role: 'orch-builder', model: 'm', effort: 'medium', branch: 'feat/x', summary: 's', evidence: [] }
  assert.equal(validateAgentResult({ ...b, status: 'built' }).ok, false, 'built needs evidence')
  assert.equal(validateAgentResult({ ...b, status: 'blocked' }).ok, false, 'blocked needs a blocker')
  assert.equal(validateAgentResult({ ...b, status: 'ESCALATE', blocker: 'needs a schema change' }).ok, true)
  assert.equal(validateAgentResult({ role: 'orch-merge', model: 'm', effort: 'low', merged: true }).ok, false)
  assert.equal(validateAgentResult({ role: 'nobody', model: 'm', effort: 'low' }).ok, false)
  assert.deepEqual(parseAgentResult('notes\n```json\n{"a":1}\n```\nmore\n```json\n{"b":2}\n```'), { b: 2 })
})
