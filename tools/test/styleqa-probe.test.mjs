// scripts/styleqa/probe.mjs (core/scripts/styleqa): the layout, theme and touch checks on recorded element boxes —
// no browser. L1 page scroll, L2 clipped, L3 cut text, L4 overlap, L5 oneRow, L6 rail (sliver / no scroll-snap),
// U1 native control, T1–T3 off-token, G5 tap target; each found once and each the same when the layout is mirrored
// and uiDirection is rtl.
//   node --test tools/test/styleqa-probe.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const kit = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const { measure } = await import(pathToFileURL(join(kit, 'scripts', 'styleqa', 'probe.mjs')).href)

const VW = 375
const rect = (left, top, right, bottom) => ({ left, top, right, bottom })
const BASE = { display: 'block', position: 'static', flexDirection: 'row', overflowX: 'visible', overflowY: 'visible', textOverflow: 'clip', hasText: false, borderStyle: 'none', interactive: false, primary: false, scrollSnapType: 'none' }
/** A recorded element; `i` is its position, `parent` the index of its parent. */
const el = (i, parent, selector, r, extra = {}) => ({ ...BASE, i, parent, tag: 'div', selector, component: null, rect: r, scrollWidth: r.right - r.left, clientWidth: r.right - r.left, scrollHeight: r.bottom - r.top, clientHeight: r.bottom - r.top, ...extra })
const page = (elements, doc = {}) => ({ viewport: { w: VW, h: 800 }, doc: { scrollWidth: VW, clientWidth: VW, scrollHeight: 800, ...doc }, elements })
/** The same layout in a right-to-left page: every box reflected in the viewport. */
const mirror = (rec) => ({ ...rec, elements: rec.elements.map((e) => ({ ...e, rect: { ...e.rect, left: VW - e.rect.right, right: VW - e.rect.left } })) })
const body = el(0, -1, 'body', rect(0, 0, VW, 800))

/** Runs the checks on a layout in ltr and on its mirror in rtl; both must agree. */
function both(rec, opts = {}) {
  const ltr = measure(rec, { direction: 'ltr', ...opts })
  const rtl = measure(mirror(rec), { direction: 'rtl', ...opts })
  assert.deepEqual(rtl.findings, ltr.findings, 'the mirrored layout in rtl gives the same findings')
  assert.deepEqual(rtl.rails, ltr.rails, 'and the same rails')
  return ltr
}
const checks = (r) => r.findings.map((f) => f.check).sort()

test('L1: an element past the inline-end edge makes the page scroll sideways — once, with its edge', () => {
  const r = both(page([body, el(1, 0, '.banner', rect(0, 0, 500, 40))], { scrollWidth: 500 }))
  assert.deepEqual(checks(r), ['L1'])
  assert.equal(r.findings[0].selector, '.banner')
  assert.equal(r.findings[0].edge, 'inline-end')
  assert.deepEqual(checks(both(page([body, el(1, 0, '.ok', rect(0, 0, VW, 40))]))), [], 'no sideways scroll, no L1')
  const inRail = both(page([body, el(1, 0, '.rail', rect(0, 0, VW, 40), { overflowX: 'auto', scrollWidth: 900 }), el(2, 1, '.card', rect(0, 0, 900, 40))], { scrollWidth: VW }))
  assert.ok(!checks(inRail).includes('L1'))
})

test('L2: an element cut by a clipping ancestor with nothing scrollable between', () => {
  const card = el(1, 0, '.card', rect(0, 0, 100, 100), { overflowX: 'hidden', overflowY: 'hidden' })
  const r = both(page([body, card, el(2, 1, '.badge', rect(0, 0, 160, 20))]))
  assert.deepEqual(checks(r), ['L2'])
  assert.equal(r.findings[0].selector, '.badge')
  assert.equal(r.findings[0].edge, 'inline-end')
  const scrolling = el(1, 0, '.card', rect(0, 0, 100, 100), { overflowX: 'hidden', overflowY: 'auto' })
  assert.deepEqual(checks(both(page([body, scrolling, el(2, 1, '.badge', rect(0, 0, 160, 20))]))), [], 'a scrollable ancestor means it is reachable')
})

test('L3: text cut off with no ellipsis', () => {
  const cut = el(1, 0, '.title', rect(0, 0, 100, 20), { hasText: true, overflowX: 'hidden', scrollWidth: 240 })
  assert.deepEqual(checks(both(page([body, cut]))), ['L3'])
  assert.deepEqual(checks(both(page([body, { ...cut, textOverflow: 'ellipsis' }]))), [])
})

test('L4: siblings overlapping by more than 4px where neither contains the other', () => {
  const a = el(1, 0, '.a', rect(0, 0, 100, 40))
  const r = both(page([body, a, el(2, 0, '.b', rect(90, 0, 190, 40))]))
  assert.deepEqual(checks(r), ['L4'])
  assert.deepEqual(checks(both(page([body, a, el(2, 0, '.b', rect(97, 0, 190, 40))]))), [], '3px is within the 4px allowance')
  assert.deepEqual(checks(both(page([body, a, el(2, 0, '.b', rect(10, 5, 60, 30))]))), [], 'a box inside the other is not an overlap')
})

test('L5: a oneRow page whose flex row wraps', () => {
  const row = el(1, 0, '.toolbar', rect(0, 0, VW, 90), { display: 'flex' })
  const rec = page([body, row, el(2, 1, '.x', rect(0, 0, 200, 40)), el(3, 1, '.y', rect(0, 50, 200, 90))])
  assert.deepEqual(checks(both(rec, { oneRow: true })), ['L5'])
  assert.deepEqual(checks(both(rec, { oneRow: false })), [], 'only a page marked oneRow is held to it')
})

test('L6: a rail with a cut sliver, and a rail with no scroll-snap at phone width', () => {
  const rail = (snap, width) => [el(1, 0, '.rail', rect(0, 0, VW, 60), { overflowX: 'auto', scrollWidth: 4 * width, scrollSnapType: snap }),
    ...[0, 1, 2, 3].map((k) => el(2 + k, 1, `.card-${k}`, rect(k * width, 0, (k + 1) * width, 60)))]
  const sliver = both(page([body, ...rail('x mandatory', 180)]))
  assert.deepEqual(sliver.findings.map((f) => `${f.check} ${f.locator.split(' | ')[1]}`), ['L6 sliver'])
  assert.equal(sliver.rails.length, 1)
  assert.deepEqual({ visible: sliver.rails[0].visible, snap: sliver.rails[0].snap, width: sliver.rails[0].width }, { visible: 2, snap: true, width: 375 })
  const noSnap = both(page([body, ...rail('none', 170)]))
  assert.deepEqual(noSnap.findings.map((f) => `${f.check} ${f.locator.split(' | ')[1]}`), ['L6 no-snap'])
  assert.equal(noSnap.rails[0].snap, false)
  const wide = { ...page([body, ...rail('none', 170)]), viewport: { w: 1366, h: 768 } }
  assert.deepEqual(measure(wide, { direction: 'ltr' }).findings.filter((f) => f.check === 'L6'), [], 'no-snap is a phone-width defect')
})

test('U1: a control that still looks like the browser\'s own', () => {
  const native = el(1, 0, 'button[data-qa=native]', rect(0, 0, 80, 40), { tag: 'button', interactive: true, borderStyle: 'outset' })
  assert.deepEqual(checks(both(page([body, native]))), ['U1'])
  assert.deepEqual(checks(both(page([body, { ...native, borderStyle: 'solid' }]))), [])
})

test('T1-T3: a colour, font size and radius that are not tokens', () => {
  const tokens = { color: new Set(['rgb(0, 0, 0)', 'rgb(255, 255, 255)']), fontSize: new Set([14, 16]), radius: new Set([4, 8]) }
  const text = el(1, 0, '.text', rect(0, 0, 200, 30), { hasText: true, color: 'rgb(18, 52, 86)', backgroundColor: 'rgba(0, 0, 0, 0)', fontSize: '13px', borderRadius: '5px' })
  const r = both(page([body, text]), { tokens })
  assert.deepEqual(checks(r), ['T1', 'T2', 'T3'])
  const ok = el(1, 0, '.text', rect(0, 0, 200, 30), { hasText: true, color: 'rgb(0, 0, 0)', fontSize: '16px', borderRadius: '8px' })
  assert.deepEqual(checks(both(page([body, ok]), { tokens })), [])
  const off = both(page([body, text]), { tokens: null })
  assert.deepEqual(checks(off), [])
  assert.deepEqual(off.notes, ['T1 off: no colour tokens resolved', 'T2 off: no font-size tokens resolved', 'T3 off: no radius tokens resolved'])
})

test('G5: a tap target under 24×24, and a primary action under 44px tall on touch', () => {
  const small = el(1, 0, '.icon', rect(0, 0, 20, 20), { tag: 'button', interactive: true })
  assert.deepEqual(checks(both(page([body, small]))), ['G5'])
  const primary = (h) => el(1, 0, '.save', rect(0, 0, 120, h), { tag: 'button', interactive: true, primary: true })
  assert.deepEqual(checks(both(page([body, primary(40)]), { touch: true })), ['G5'])
  assert.deepEqual(checks(both(page([body, primary(44)]), { touch: true })), [])
  assert.deepEqual(checks(both(page([body, primary(40)]), { touch: false })), [], '44px is a touch rule')
})
