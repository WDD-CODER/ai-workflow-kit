// scripts/styleqa/findings.mjs + report.mjs (core/scripts/styleqa): stable IDs, width collapse, new / known / gone,
// subset runs, the shared-component section, the section order and redaction.
//   node --test tools/test/styleqa-findings.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const engine = join(kit, 'scripts', 'styleqa')
const { findingId, collapse, updateStore } = await import(pathToFileURL(join(engine, 'findings.mjs')).href)
const { renderReport, SECTIONS } = await import(pathToFileURL(join(engine, 'report.mjs')).href)

const sweep = (page, locator, width, extra = {}) => ({ layer: 'sweep', check: 'L1', page, state: 'default', locator, widths: [width], message: `${locator} overflows`, ...extra })
const empty = () => ({ version: 1, updated: null, findings: {} })
const cov = (pages, extra = {}) => ({ layers: ['sweep'], pages, states: null, widths: null, ...extra })

test('the same finding at 375 and 620 is one finding with widths [375, 620]', () => {
  const out = collapse([sweep('dashboard', '.nav', 620), sweep('dashboard', '.nav', 375), sweep('dashboard', '.card', 375)])
  assert.equal(out.length, 2)
  assert.deepEqual(out.find((f) => f.locator === '.nav').widths, [375, 620])
  const { current } = updateStore(empty(), { findings: [sweep('dashboard', '.nav', 375), sweep('dashboard', '.nav', 620)], coverage: cov(['dashboard']) }, { date: 'd1' })
  assert.equal(current.length, 1)
  assert.deepEqual(current[0].widths, [375, 620])
})

test('two runs give the same IDs; the ID ignores line, width and message', () => {
  const f = sweep('dashboard', '.nav', 375, { line: 3 })
  assert.equal(findingId(f), findingId({ ...f, line: 90, widths: [1366], message: 'other words' }))
  assert.notEqual(findingId(f), findingId({ ...f, state: 'menu-open' }))
  assert.match(findingId(f), /^L1-[0-9a-f]{8}$/)
  const run = { findings: [f, sweep('settings', '.card', 375)], coverage: cov(['dashboard', 'settings']) }
  const one = updateStore(empty(), run, { date: 'd1' })
  const two = updateStore(one.store, run, { date: 'd2' })
  assert.deepEqual(two.current.map((x) => x.id), one.current.map((x) => x.id))
  assert.deepEqual(one.current.map((x) => x.status), ['new', 'new'])
  assert.deepEqual(two.current.map((x) => x.status), ['known', 'known'])
  assert.equal(two.current[0].firstSeen, 'd1')
})

test('a finding not seen again on a covered page becomes gone; a one-page run leaves the other pages untouched', () => {
  const first = updateStore(empty(), { findings: [sweep('dashboard', '.nav', 375), sweep('settings', '.card', 375)], coverage: cov(['dashboard', 'settings']) }, { date: 'd1' })
  const settingsId = first.current.find((f) => f.page === 'settings').id
  const dashId = first.current.find((f) => f.page === 'dashboard').id
  // A run on dashboard only that no longer sees .nav.
  const second = updateStore(first.store, { findings: [], coverage: cov(['dashboard']) }, { date: 'd2' })
  assert.equal(second.store.findings[dashId].status, 'gone')
  assert.equal(second.store.findings[dashId].goneSince, 'd2')
  assert.deepEqual(second.store.findings[settingsId], first.store.findings[settingsId], 'the settings finding is untouched')
  // A run that covers a different layer or width does not touch it either.
  const third = updateStore(first.store, { findings: [], coverage: cov(['settings'], { widths: [1366] }) }, { date: 'd3' })
  assert.equal(third.store.findings[settingsId].status, 'new')
  // Seen again after it went: new again.
  const back = updateStore(second.store, { findings: [sweep('dashboard', '.nav', 375)], coverage: cov(['dashboard']) }, { date: 'd4' })
  assert.equal(back.store.findings[dashId].status, 'new')
})

test('a shared component seen on 2 pages lands in "Shared components — fix once" with both pages', () => {
  const { current } = updateStore(empty(), {
    findings: [sweep('dashboard', 'app-header .title', 375, { component: 'app-header' }), sweep('settings', 'app-header .title', 375, { component: 'app-header' }), sweep('settings', '.form', 375, { component: 'settings-form' })],
    coverage: cov(['dashboard', 'settings']),
  }, { date: 'd1' })
  const text = renderReport({ date: 'd1', current, coverage: cov(['dashboard', 'settings']), pages: [{ slug: 'dashboard', title: 'Dashboard' }, { slug: 'settings', title: 'Settings' }] })
  const shared = text.split('## Shared components — fix once')[1].split('\n## ')[0]
  assert.match(shared, /\| app-header \| dashboard, settings \|/)
  assert.ok(!shared.includes('settings-form'), 'a component on one page is not shared')
})

test('the report sections come in the brief\'s order, after the status and coverage lines', () => {
  const text = renderReport({ date: '2026-01-02', current: [], coverage: { layers: ['static'], pages: [], states: null, widths: null }, notes: ['S2/S3 off: no token prefixes configured'], direction: 'rtl' })
  const lines = text.split('\n')
  assert.match(lines[0], /^# Style QA report — 2026-01-02$/)
  assert.match(lines[2], /^Status: 0 open/)
  assert.match(lines[3], /^Coverage: layers static;/)
  assert.match(text, /Direction: rtl — inline-start is the right edge/)
  assert.ok(text.includes('S2/S3 off: no token prefixes configured'))
  const heads = lines.filter((l) => /^## /.test(l)).map((l) => l.slice(3))
  assert.deepEqual(heads, SECTIONS)
  assert.deepEqual(SECTIONS, ['Summary', 'Shared components — fix once', 'Per page', 'Rails', 'Static findings by file'])
  assert.ok(text.indexOf('Status:') < text.indexOf('## Summary'))
})

test('a token-like string in a finding is redacted in the report and the store', () => {
  const jwt = `eyJ${'a'.repeat(20)}.${'b'.repeat(20)}.${'c'.repeat(20)}`
  const leaky = sweep('dashboard', '.nav', 375, { message: `request to /api?token=abc123secret with Bearer ${'z'.repeat(24)} and ${jwt}` })
  const { store, current } = updateStore(empty(), { findings: [leaky], coverage: cov(['dashboard']) }, { date: 'd1' })
  const text = renderReport({ date: 'd1', current, coverage: cov(['dashboard']) })
  for (const secret of ['abc123secret', 'z'.repeat(24), jwt]) {
    assert.ok(!text.includes(secret), `report leaks ${secret.slice(0, 12)}`)
    assert.ok(!JSON.stringify(store).includes(secret), `store leaks ${secret.slice(0, 12)}`)
  }
  assert.match(text, /\[redacted:/)
})
