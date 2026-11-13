// scripts/styleqa/merge.mjs: review files folded into the report with stable IDs. Uses the kit's rendered engine copy.
//   node --test tools/test/styleqa-merge.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const fixture = join(kit, 'tools', 'fixtures', 'styleqa', 'review')
const { main } = await import(pathToFileURL(join(kit, 'scripts', 'styleqa', 'merge.mjs')).href)

function project(reviews = {}, { runJson = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'styleqa-merge-'))
  cpSync(join(fixture, 'docs'), join(root, 'docs'), { recursive: true })
  const out = join(root, 'out', 'styleqa')
  mkdirSync(join(out, 'review'), { recursive: true })
  writeFileSync(join(out, 'known.json'), JSON.stringify({ version: 1, updated: '2026-11-13', findings: {} }))
  if (runJson) writeFileSync(join(out, 'run.json'), JSON.stringify({ date: '2026-11-13', coverage: { layers: ['static', 'sweep'], pages: ['dash', 'other'], states: null, widths: null }, notes: [], rails: [] }))
  for (const [name, body] of Object.entries(reviews)) writeFileSync(join(out, 'review', name), typeof body === 'string' ? body : JSON.stringify(body))
  return root
}
const run = (root, ...args) => main([`--root=${root}`, `--settings=${join(fixture, 'settings.json')}`, ...args])
const read = (root, f) => readFileSync(join(root, 'out', 'styleqa', f), 'utf8')
const fixtureReview = () => JSON.parse(readFileSync(join(fixture, 'review-dash.json'), 'utf8'))
const finding = (over = {}) => ({ check: 'V3', severity: 'medium', confidence: 85, state: 'default', width: 375, shot: 'out/styleqa/screens/dash-default-375-1.png', region: 'r', anchorText: 't', title: 'T', expected: 'e', actual: 'a', ...over })

test('a valid review file gets stable IDs and appears in the report beside the measured findings', () => {
  const root = project({ 'review-dash.json': fixtureReview() })
  writeFileSync(join(root, 'out', 'styleqa', 'known.json'), JSON.stringify({ version: 1, updated: '2026-11-13', findings: { 'L1-11111111': { id: 'L1-11111111', layer: 'sweep', check: 'L1', page: 'dash', state: 'default', locator: '.nav', widths: [375], status: 'new', message: 'nav overflows', screenshots: [] } } }))
  const r = run(root)
  assert.equal(r.code, 0, r.lines.join('\n'))
  const store = JSON.parse(read(root, 'known.json')).findings
  const visual = Object.values(store).filter((f) => f.layer === 'visual')
  assert.equal(visual.length, 2, 'the low-confidence one and the V9 one are dropped')
  assert.ok(visual.every((f) => /^V[1-8]-[0-9a-f]{8}$/.test(f.id)))
  assert.ok(!('extra' in visual[0]), 'unknown fields are dropped')
  const report = read(root, 'report.md')
  assert.ok(report.includes('L1-11111111') && visual.every((f) => report.includes(f.id)), 'measured and visual in one report')
  assert.match(r.lines.join('\n'), /summary measured: 1 open; visual: 2 open \(high 1, medium 1, low 0\)/)
})

test('merging the same files twice changes nothing; a changed file updates, and IDs stay', () => {
  const root = project({ 'review-dash.json': fixtureReview() })
  run(root)
  const store1 = read(root, 'known.json')
  const report1 = read(root, 'report.md')
  const again = run(root)
  assert.equal(again.code, 0)
  assert.equal(read(root, 'known.json'), store1)
  assert.equal(read(root, 'report.md'), report1)
  assert.match(again.lines.join('\n'), /merge dash: unchanged/)
  const f = JSON.parse(store1).findings
  const high = Object.keys(f).find((id) => f[id].severity === 'high')
  const medium = Object.keys(f).find((id) => f[id].severity === 'medium')
  writeFileSync(join(root, 'out', 'styleqa', 'review', 'review-dash.json'), JSON.stringify({ findings: [fixtureReview().findings[0]] }))
  run(root)
  const store2 = JSON.parse(read(root, 'known.json')).findings
  assert.equal(store2[high].status, 'known', 'the same defect keeps its ID and is known')
  assert.equal(store2[medium].status, 'gone', 'the one not seen again is gone')
})

test('a malformed file is skipped with one line and the merge still exits 0', () => {
  const root = project({ 'review-dash.json': fixtureReview(), 'review-other.json': readFileSync(join(fixture, 'review-other.json'), 'utf8') })
  const r = run(root)
  assert.equal(r.code, 0)
  assert.equal(r.lines.filter((l) => l.startsWith('skipped review-other.json: ')).length, 1, r.lines.join('\n'))
  const noList = project({ 'review-dash.json': { nothing: true } })
  assert.match(run(noList).lines.join('\n'), /skipped review-dash.json: no "findings" list/)
})

test('a finding below the confidence threshold or outside V1–V8 is dropped; a shot outside the output folder too', () => {
  const root = project({ 'review-dash.json': { findings: [finding({ confidence: 69 }), finding({ check: 'V0' }), finding({ check: 'U1' }), finding({ shot: '../secret.png' }), finding({ shot: '/etc/x.png' }), finding({ state: 'nope' }), finding({ title: 'kept' })] } })
  run(root)
  const visual = Object.values(JSON.parse(read(root, 'known.json')).findings)
  assert.equal(visual.length, 1)
  assert.match(visual[0].message, /kept/)
  const low = project({ 'review-dash.json': { findings: [finding({ confidence: 50 })] } })
  run(low, '--min-confidence=40')
  assert.equal(Object.keys(JSON.parse(read(low, 'known.json')).findings).length, 1)
})

test('more than 6 findings for one state keeps the 6 highest severities', () => {
  const sevs = ['low', 'high', 'low', 'medium', 'high', 'low', 'medium', 'low']
  const findings = sevs.map((severity, i) => finding({ severity, anchorText: `a${i}`, title: `t${i}` }))
  const root = project({ 'review-dash.json': { findings } })
  run(root)
  const kept = Object.values(JSON.parse(read(root, 'known.json')).findings)
  assert.equal(kept.length, 6)
  assert.equal(kept.filter((f) => f.severity === 'high').length, 2)
  assert.equal(kept.filter((f) => f.severity === 'medium').length, 2)
  assert.equal(kept.filter((f) => f.severity === 'low').length, 2)
})

test('no run.json stops with the command to run first', () => {
  const r = run(project({}, { runJson: false }))
  assert.equal(r.code, 1)
  assert.match(r.lines.join('\n'), /run\.mjs --layers=static,sweep first/)
})
