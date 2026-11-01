// tools/agent-eval-ab.mjs: the verdict per figure and the redaction adoption rule, computed from two report folders.
//   node --test tools/test/agent-eval-ab.test.mjs
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { judge, adoptRedaction, threshold, compare, loadReports } from '../agent-eval-ab.mjs'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const tmp = mkdtempSync(join(tmpdir(), 'agent-eval-ab-'))
after(() => rmSync(tmp, { recursive: true, force: true }))

const report = (agent, t, spread = {}) => ({ agent, model: 'sonnet', cases: [{}, {}], total: { recall: 0.3, precision: 0.3, noise: 0.5, errors: 0, costUsd: 1, spread: { recall: 0, precision: 0, noise: 0 }, ...t, ...(Object.keys(spread).length ? { spread: { recall: 0, precision: 0, noise: 0, ...spread } } : {}) } })
const verdictOf = (rows, figure) => rows.find((r) => r.figure === figure).verdict

test('d is max(0.05, 2 × the larger spread)', () => {
  assert.equal(threshold(report('a', {}), report('a', {}), 'recall').d, 0.05)
  assert.ok(Math.abs(threshold(report('a', {}, { recall: 0.1 }), report('a', {}, { recall: 0.03 }), 'recall').d - 0.2) < 1e-9)
})

test('recall: improved at +d, regressed at −d, else no real change; a wide spread raises d', () => {
  const before = report('orch-check-bugs', { recall: 0.3 })
  assert.equal(verdictOf(judge(before, report('orch-check-bugs', { recall: 0.35 })), 'recall'), 'improved')
  assert.equal(verdictOf(judge(before, report('orch-check-bugs', { recall: 0.25 })), 'recall'), 'regressed')
  assert.equal(verdictOf(judge(before, report('orch-check-bugs', { recall: 0.33 })), 'recall'), 'no real change')
  assert.equal(verdictOf(judge(before, report('orch-check-bugs', { recall: 0.4 }, { recall: 0.1 })), 'recall'), 'no real change', 'd = 0.2')
})

test('precision regresses on a drop over 0.02; orch-verify precision regresses below 1.00; noise improves when it falls by d', () => {
  const before = report('orch-check-plan', { precision: 0.38, noise: 0.5 })
  assert.equal(verdictOf(judge(before, report('orch-check-plan', { precision: 0.35 })), 'precision'), 'regressed')
  assert.equal(verdictOf(judge(before, report('orch-check-plan', { precision: 0.37 })), 'precision'), 'no real change')
  assert.equal(verdictOf(judge(before, report('orch-check-plan', { noise: 0.4 })), 'noise'), 'improved')
  assert.equal(verdictOf(judge(before, report('orch-check-plan', { noise: 0.6 })), 'noise'), 'regressed')
  const v = report('orch-verify', { precision: 1 })
  assert.equal(verdictOf(judge(v, report('orch-verify', { precision: 0.75 })), 'precision'), 'regressed')
  assert.equal(verdictOf(judge(v, report('orch-verify', { precision: 1 })), 'precision'), 'no real change')
})

test('errors regress at +2; cost over +20 % per case is named', () => {
  const before = report('orch-check-bugs', { errors: 1, costUsd: 2 })
  assert.equal(verdictOf(judge(before, report('orch-check-bugs', { errors: 3, costUsd: 2 })), 'errors'), 'regressed')
  assert.equal(verdictOf(judge(before, report('orch-check-bugs', { errors: 2, costUsd: 2 })), 'errors'), 'no real change')
  assert.equal(verdictOf(judge(before, report('orch-check-bugs', { costUsd: 2.5 })), 'cost'), 'over +20 %')
  assert.equal(verdictOf(judge(before, report('orch-check-bugs', { costUsd: 2.2 })), 'cost'), 'reported')
})

test('redaction is ADOPT only when recall rises by ≥ d and precision (two decimals) does not drop', () => {
  const before = report('orch-check-bugs', { recall: 0.27, precision: 0.22 })
  assert.match(adoptRedaction(before, report('orch-check-bugs', { recall: 0.4, precision: 0.22 })).line, /^ADOPT orch-check-bugs/)
  assert.match(adoptRedaction(before, report('orch-check-bugs', { recall: 0.4, precision: 0.2 })).line, /^REJECT/, 'precision fell')
  assert.match(adoptRedaction(before, report('orch-check-bugs', { recall: 0.3, precision: 0.3 })).line, /^REJECT/, 'recall gain below d')
  assert.match(adoptRedaction(before, report('orch-check-bugs', { recall: 0.4, precision: 0.2201 })).line, /^ADOPT/, 'equal at two decimals counts as not lower')
  assert.match(adoptRedaction(before, report('orch-check-bugs', { recall: 0.4, precision: 0.22 }, { recall: 0.1 })).line, /^REJECT/, 'a 0.13 gain is inside d = 0.2')
})

test('the CLI prints the table, a verdict line per figure and the adoption line; --out writes the markdown', () => {
  for (const [dir, t] of [['b', { recall: 0.27, precision: 0.22 }], ['a', { recall: 0.4, precision: 0.25 }]]) {
    mkdirSync(join(tmp, dir), { recursive: true })
    writeFileSync(join(tmp, dir, 'orch-check-bugs.sonnet.json'), JSON.stringify(report('orch-check-bugs', t)))
  }
  const out = join(tmp, 'out.md')
  const r = spawnSync(process.execPath, [join(kit, 'tools', 'agent-eval-ab.mjs'), '--before', join(tmp, 'b'), '--after', join(tmp, 'a'), '--adopt-rule', 'redaction', '--out', out], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /\| recall \| 0\.27 \| 0\.40 \| 0\.00 \| 0\.05 \| improved \|/)
  assert.match(r.stdout, /ADOPT orch-check-bugs/)
  assert.match(r.stdout, /AGENT_EVAL_AB: 1 role\(s\), 1 improved, 0 regressed/)
  assert.match(readFileSync(out, 'utf8'), /### orch-check-bugs/)
  assert.deepEqual(Object.keys(loadReports(join(tmp, 'b'))), ['orch-check-bugs'])
  assert.equal(compare({ before: loadReports(join(tmp, 'b')), arms: [{ name: 'after', reports: loadReports(join(tmp, 'a')) }] }).roles.length, 1)
  assert.equal(spawnSync(process.execPath, [join(kit, 'tools', 'agent-eval-ab.mjs'), '--before', join(tmp, 'b')], { encoding: 'utf8' }).status, 2)
})
