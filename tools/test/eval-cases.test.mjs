// The kit's agent-eval case set (docs/agent-evals/cases, plan 021): every case parses in the harness shape, and no
// label comes from a model's opinion alone — each expected.json note starts with "fixed by <sha>" (a commit that is in
// git log), "clean:", "planted:" or "human-verdict <YYYY-MM-DD>:" (a decision the Human graded wrong; such a case holds
// project code and stays in the project's own cases). Run: node --test tools/test/eval-cases.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { findCases, evaluate } from '../lib/agent-eval/run.mjs'
import { caseKind } from '../lib/agent-eval/compare.mjs'
import stubPerfect from '../fixtures/agent-evals/stub-perfect.mjs'

const kit = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const casesRoot = join(kit, 'docs', 'agent-evals', 'cases')
const ROLES = ['orch-check-bugs', 'orch-check-plan', 'orch-check-rules', 'orch-verify']
const NOTE_RE = /^(fixed by ([0-9a-f]{7,40})\b|clean:|planted:|human-verdict \d{4}-\d{2}-\d{2}:)/

const allCases = () => ROLES.flatMap((role) => findCases(casesRoot, role).map((c) => ({ role, ...c })))

test('every role has a case folder and the set holds at least 20 cases', () => {
  for (const role of ROLES) assert.ok(existsSync(join(casesRoot, role)) && statSync(join(casesRoot, role)).isDirectory(), `no folder for ${role}`)
  const n = allCases().length
  assert.ok(n >= 20, `only ${n} cases`)
})

test('every case has an input folder and an expected.json in the harness shape', () => {
  for (const role of ROLES) {
    for (const name of readdirSync(join(casesRoot, role))) {
      const dir = join(casesRoot, role, name)
      if (!statSync(dir).isDirectory()) continue
      assert.ok(existsSync(join(dir, 'expected.json')), `${role}/${name}: no expected.json`)
      assert.ok(existsSync(join(dir, 'input')) && readdirSync(join(dir, 'input')).length > 0, `${role}/${name}: empty or missing input/`)
      const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'))
      const kind = caseKind(expected)
      assert.equal(kind, role === 'orch-verify' ? 'verdicts' : 'findings', `${role}/${name}: wrong label kind ${kind}`)
      if (kind === 'verdicts') {
        const ids = JSON.parse(readFileSync(join(dir, 'input', 'candidates.json'), 'utf8')).map((c) => c.id)
        for (const v of expected.verdicts) assert.ok(ids.includes(v.id), `${role}/${name}: verdict for unknown candidate ${v.id}`)
        assert.ok(expected.verdicts.some((v) => v.verdict === 'refuted'), `${role}/${name}: a verifier case needs a refutable false alarm`)
      }
    }
  }
})

test('the label sources: human-verdict <date>: is the fourth, with a real date; opinions are not', () => {
  for (const ok of ['fixed by abc1234 the guard', 'clean: nothing wrong', 'planted: off by one', 'human-verdict 2026-10-25: a dialog nobody asked for']) assert.ok(NOTE_RE.test(ok), ok)
  for (const bad of ['human-verdict: no date', 'human-verdict 25-10-2026: wrong date order', 'looks wrong to me', 'verdict 2026-10-25:']) assert.ok(!NOTE_RE.test(bad), bad)
})

test('every label names a code-backed source: fixed by <sha in git log>, clean:, planted: or human-verdict <date>:', () => {
  const shallow = spawnSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: kit, encoding: 'utf8' }).stdout.trim() === 'true'
  for (const c of allCases()) {
    const note = String(c.expected.note ?? '')
    const m = NOTE_RE.exec(note)
    assert.ok(m, `${c.role}/${c.name}: note must start with "fixed by <sha>", "clean:", "planted:" or "human-verdict <date>:" — got ${JSON.stringify(note.slice(0, 40))}`)
    if (m[2] && !shallow) {
      const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${m[2]}^{commit}`], { cwd: kit, encoding: 'utf8' })
      assert.equal(r.status, 0, `${c.role}/${c.name}: commit ${m[2]} is not in git log`)
    }
  }
})

test('orch-check-plan has the unlogged-removal pair (plan 042): a planted removal and a clean one the plan names', () => {
  const cases = findCases(casesRoot, 'orch-check-plan')
  const planted = cases.find((c) => c.name === 'planted-unlogged-removal')
  const clean = cases.find((c) => c.name === 'clean-removal-named-in-plan')
  assert.ok(planted && clean, 'both cases exist')
  assert.match(planted.expected.note, /^planted:/)
  assert.equal(planted.expected.findings.length, 1)
  assert.equal(planted.expected.findings[0].severity, 'major')
  assert.ok(planted.expected.findings[0].rule.includes('unlogged removal'))
  assert.match(clean.expected.note, /^clean:/)
  assert.deepEqual(clean.expected.findings, [])
})

test('the perfect stub scores recall 1 and precision 1 on every role (every case parses and scores)', async () => {
  for (const role of ROLES) {
    const r = await evaluate({ agentFile: join(kit, '.claude', 'agents', `${role}.md`), casesDir: casesRoot, runs: 1, runner: stubPerfect })
    assert.equal(r.total.errors, 0, `${role}: ${JSON.stringify(r.cases.flatMap((c) => c.errorDetails))}`)
    assert.equal(r.total.recall, 1, `${role}: recall ${r.total.recall}`)
    assert.equal(r.total.precision, 1, `${role}: precision ${r.total.precision}`)
  }
})
