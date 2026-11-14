/**
 * Style QA probe — measures one rendered page. Two halves:
 *
 *   collectPage(opts)   runs INSIDE the page (sweep.mjs passes it to page.evaluate; it uses nothing outside itself) and
 *                       returns recorded element boxes: { viewport, doc, elements: [...], tokens }.
 *   measure(record, opts) pure: the checks on recorded boxes — tests feed it recorded fixtures, no browser.
 *
 * Checks (every edge is logical: inline-start / inline-end follow `direction`, so a mirrored layout gives the same result):
 *   L1 horizontal page scroll · L2 clipped element, no scrollable ancestor · L3 cut text without an ellipsis ·
 *   L4 overlap > 4px where neither box contains the other · L5 a broken `oneRow` page · L6 a rail with a cut sliver, or
 *   with no scroll-snap at phone width · U1 native-looking control · T1/T2/T3 colour / font-size / radius off the
 *   tokens · G5 tap target (24×24; 44px tall for a primary action on touch).
 *
 * An element record: { i, parent, tag, selector, component, rect: { left, top, right, bottom }, display, position,
 * flexDirection, overflowX, overflowY, scrollWidth, clientWidth, scrollHeight, clientHeight, textOverflow, hasText,
 * borderStyle, appearance, backgroundColor, color, borderColor, fontSize, borderRadius, scrollSnapType, interactive,
 * primary }. `parent` is the index of the parent record or -1.
 *
 * Node built-ins only; no placeholders (tools import it).
 */

export const OVERLAP_PX = 4
export const MIN_TAP = 24
export const MIN_PRIMARY_TAP = 44
export const PHONE_MAX = 620
const TOL = 1

const w = (r) => r.right - r.left
const h = (r) => r.bottom - r.top
const scrolls = (v) => v === 'auto' || v === 'scroll'
const clips = (v) => v === 'hidden' || v === 'clip'

/** Logical position of a rect inside a reference rect: distances from the reference's inline-start edge. */
export function inline(rect, ref, direction) {
  return direction === 'rtl'
    ? { start: ref.right - rect.right, end: ref.right - rect.left }
    : { start: rect.left - ref.left, end: rect.right - ref.left }
}

/** Normalises a CSS colour to `rgb(r, g, b)` / `rgba(r, g, b, a)`; '' for transparent or unreadable. */
export function normColor(v) {
  const m = /^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+%?))?\s*\)$/.exec(String(v ?? '').trim())
  if (!m) return ''
  let a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
  if (!(a > 0)) return ''
  return a >= 1 ? `rgb(${m[1]}, ${m[2]}, ${m[3]})` : `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${a})`
}

const px = (v) => {
  const m = /^(-?[\d.]+)px$/.exec(String(v ?? '').trim())
  return m ? parseFloat(m[1]) : null
}

/** True for a control that still has the browser's own look. */
export function isNativeLook(el) {
  if (!el.interactive) return false
  if (el.borderStyle === 'outset' || el.borderStyle === 'inset' || el.borderStyle === 'groove' || el.borderStyle === 'ridge') return true
  return el.tag === 'select' && el.appearance === 'menulist' && px(el.borderRadius) === 0 && normColor(el.backgroundColor) === 'rgb(255, 255, 255)'
}

const finding = (check, el, locatorTail, message, extra = {}) => ({
  layer: 'sweep',
  check,
  selector: el.selector,
  component: el.component ?? null,
  locator: [el.selector, locatorTail].filter(Boolean).join(' | '),
  message,
  ...extra,
})

const children = (els) => {
  const by = new Map()
  for (const e of els) {
    if (!by.has(e.parent)) by.set(e.parent, [])
    by.get(e.parent).push(e)
  }
  return by
}

const visible = (e) => w(e.rect) > 0 && h(e.rect) > 0

/** L1 — an element beyond the inline-end (or inline-start) edge of the viewport while the page scrolls sideways. */
function l1(rec, direction, out) {
  const { doc, viewport } = rec
  if (!(doc.scrollWidth > doc.clientWidth + TOL)) return
  const ref = { left: 0, right: viewport.w }
  const scrollable = (e) => {
    for (let p = rec.elements[e.parent]; p; p = rec.elements[p.parent]) if (scrolls(p.overflowX)) return true
    return false
  }
  const bad = rec.elements.filter((e) => visible(e) && e.position !== 'fixed' && !scrollable(e) && (() => {
    const l = inline(e.rect, ref, direction)
    return l.end > viewport.w + TOL || l.start < -TOL
  })())
  const set = new Set(bad.map((e) => e.i))
  const tops = bad.filter((e) => !set.has(e.parent))
  if (!tops.length) {
    out.push(finding('L1', { selector: 'html' }, '', `the page scrolls sideways (${doc.scrollWidth}px content in ${doc.clientWidth}px)`, { edge: 'inline-end' }))
    return
  }
  for (const e of tops) {
    const l = inline(e.rect, ref, direction)
    const edge = l.end > viewport.w + TOL ? 'inline-end' : 'inline-start'
    const by = edge === 'inline-end' ? Math.round(l.end - viewport.w) : Math.round(-l.start)
    out.push(finding('L1', e, '', `sticks out ${by}px past the ${edge} edge of the viewport, so the page scrolls sideways`, { edge }))
  }
}

/** L2 — an element wider or taller than the nearest clipping ancestor, with nothing scrollable between. */
function l2(rec, direction, out) {
  const exceeds = (e, clip) => {
    const a = inline(e.rect, clip.rect, direction)
    const cw = w(clip.rect)
    if (a.end > cw + 2) return 'inline-end'
    if (a.start < -2) return 'inline-start'
    if (e.rect.bottom > clip.rect.bottom + 2) return 'bottom'
    if (e.rect.top < clip.rect.top - 2) return 'top'
    return null
  }
  const clipOf = (e) => {
    for (let p = rec.elements[e.parent]; p; p = rec.elements[p.parent]) {
      if (scrolls(p.overflowX) || scrolls(p.overflowY)) return null
      if (clips(p.overflowX) || clips(p.overflowY)) return p
    }
    return null
  }
  const hit = new Map()
  for (const e of rec.elements) {
    if (!visible(e) || e.position === 'fixed' || e.position === 'absolute') continue
    const c = clipOf(e)
    if (!c || !visible(c)) continue
    const edge = exceeds(e, c)
    if (edge) hit.set(e.i, { e, c, edge })
  }
  for (const { e, c, edge } of hit.values()) {
    const up = hit.get(e.parent)
    if (up && up.c === c) continue // report the topmost clipped element only
    out.push(finding('L2', e, `clipped by ${c.selector}`, `is cut off at the ${edge} edge of ${c.selector}, which clips and cannot scroll`, { edge }))
  }
}

/** L3 — text cut by overflow:hidden with no ellipsis. */
function l3(rec, _direction, out) {
  for (const e of rec.elements) {
    if (!visible(e) || !e.hasText) continue
    if (clips(e.overflowX) && e.scrollWidth > e.clientWidth + TOL && e.textOverflow !== 'ellipsis') {
      out.push(finding('L3', e, '', `its text is cut off (${e.scrollWidth}px of text in ${e.clientWidth}px) and shows no ellipsis`))
    }
  }
}

/** L4 — siblings that overlap by more than 4px in both directions with neither containing the other. */
function l4(rec, _direction, out) {
  const contains = (a, b) => a.left <= b.left + TOL && a.top <= b.top + TOL && a.right >= b.right - TOL && a.bottom >= b.bottom - TOL
  for (const sibs of children(rec.elements).values()) {
    const flow = sibs.filter((e) => visible(e) && e.position !== 'absolute' && e.position !== 'fixed')
    for (let a = 0; a < flow.length; a++) {
      for (let b = a + 1; b < flow.length; b++) {
        const A = flow[a].rect
        const B = flow[b].rect
        const ow = Math.min(A.right, B.right) - Math.max(A.left, B.left)
        const oh = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top)
        if (ow > OVERLAP_PX && oh > OVERLAP_PX && !contains(A, B) && !contains(B, A)) {
          const [x, y] = [flow[a], flow[b]].sort((p, q) => p.selector.localeCompare(q.selector))
          out.push(finding('L4', x, `overlaps ${y.selector}`, `overlaps ${y.selector} by ${Math.round(ow)}×${Math.round(oh)}px`))
        }
      }
    }
  }
}

/** L5 — a page marked oneRow whose row container wraps its children onto a second line. */
function l5(rec, _direction, out, opts) {
  if (!opts.oneRow) return
  for (const [parent, kids] of children(rec.elements)) {
    const p = rec.elements[parent]
    if (!p || !/flex/.test(p.display ?? '') || (p.flexDirection ?? 'row').startsWith('column')) continue
    const flow = kids.filter((e) => visible(e) && e.position !== 'absolute' && e.position !== 'fixed')
    if (flow.length < 2) continue
    const first = flow[0].rect
    const wrapped = flow.find((e) => e.rect.top >= first.bottom - TOL)
    if (wrapped) out.push(finding('L5', p, '', `the row wraps: ${wrapped.selector} sits below ${flow[0].selector}, but this page must stay on one row`))
  }
}

/** L6 + the Rails rows — every horizontally scrollable container. */
function l6(rec, direction, out, rails, opts) {
  const phone = rec.viewport.w <= PHONE_MAX
  for (const e of rec.elements) {
    if (!visible(e) || !scrolls(e.overflowX) || !(e.scrollWidth > e.clientWidth + TOL)) continue
    const kids = rec.elements.filter((k) => k.parent === e.i && visible(k))
    let whole = 0
    let sliver = null
    for (const k of kids) {
      const l = inline(k.rect, e.rect, direction)
      const cw = w(e.rect)
      if (l.start >= -TOL && l.end <= cw + TOL) whole++
      else if (l.start < cw && l.end > cw) {
        const shown = cw - l.start
        if (shown < Math.max(16, 0.2 * (l.end - l.start))) sliver = { k, shown }
      }
    }
    const snap = !!e.scrollSnapType && e.scrollSnapType !== 'none'
    rails.push({ selector: e.selector, width: Math.round(w(e.rect)), visible: whole, snap, edge: 'inline-end' })
    if (sliver) out.push(finding('L6', e, 'sliver', `shows only a ${Math.round(sliver.shown)}px sliver of ${sliver.k.selector} at the inline-end edge`, { edge: 'inline-end' }))
    if (phone && !snap) out.push(finding('L6', e, 'no-snap', `scrolls sideways at ${rec.viewport.w}px with no scroll-snap`))
  }
}

/** U1 — a control that still looks like the browser's own. */
function u1(rec, _direction, out) {
  for (const e of rec.elements) if (visible(e) && isNativeLook(e)) out.push(finding('U1', e, '', `a ${e.tag} with the browser's own look (border ${e.borderStyle}) — it needs the project's control style`))
}

/** T1–T3 — a computed colour, font size or radius that is not one of the resolved tokens. Returns the notes. */
function tokenChecks(rec, _direction, out, opts) {
  const notes = []
  const tk = opts.tokens
  const have = (k) => tk && tk[k] && tk[k].size > 0
  if (!have('color')) notes.push('T1 off: no colour tokens resolved')
  if (!have('fontSize')) notes.push('T2 off: no font-size tokens resolved')
  if (!have('radius')) notes.push('T3 off: no radius tokens resolved')
  for (const e of rec.elements) {
    if (!visible(e)) continue
    if (have('color')) {
      for (const [prop, v] of [['color', e.hasText ? e.color : ''], ['background-color', e.backgroundColor], ['border-color', e.borderStyle && e.borderStyle !== 'none' ? e.borderColor : '']]) {
        const c = normColor(v)
        if (c && !tk.color.has(c)) out.push(finding('T1', e, prop, `${prop} ${c} is not a colour token`, { property: prop, value: c }))
      }
    }
    if (have('fontSize') && e.hasText) {
      const f = px(e.fontSize)
      if (f !== null && !tk.fontSize.has(f)) out.push(finding('T2', e, 'font-size', `font-size ${f}px is not a font-size token`, { property: 'font-size', value: `${f}px` }))
    }
    if (have('radius')) {
      const r = px(e.borderRadius)
      if (r && !tk.radius.has(r)) out.push(finding('T3', e, 'border-radius', `border-radius ${r}px is not a radius token`, { property: 'border-radius', value: `${r}px` }))
    }
  }
  return notes
}

/** G5 — a tap target under 24×24, or a primary action under 44px tall on touch. */
function g5(rec, _direction, out, opts) {
  for (const e of rec.elements) {
    if (!visible(e) || !e.interactive) continue
    const [W, H] = [w(e.rect), h(e.rect)]
    if (W < MIN_TAP || H < MIN_TAP) out.push(finding('G5', e, 'size', `tap target ${Math.round(W)}×${Math.round(H)}px is under ${MIN_TAP}×${MIN_TAP}`))
    else if (opts.touch && e.primary && H < MIN_PRIMARY_TAP) out.push(finding('G5', e, 'primary', `primary action is ${Math.round(H)}px tall, under ${MIN_PRIMARY_TAP}px`))
  }
}

/**
 * The checks on one recorded page. opts: { direction: 'ltr'|'rtl', oneRow, touch, tokens: { color: Set<string>,
 * fontSize: Set<number>, radius: Set<number> } | null }. → { findings, rails, notes }.
 */
export function measure(rec, opts = {}) {
  const direction = opts.direction === 'rtl' ? 'rtl' : 'ltr'
  const out = []
  const rails = []
  l1(rec, direction, out)
  l2(rec, direction, out)
  l3(rec, direction, out)
  l4(rec, direction, out)
  l5(rec, direction, out, opts)
  l6(rec, direction, out, rails, opts)
  u1(rec, direction, out)
  const notes = tokenChecks(rec, direction, out, opts)
  g5(rec, direction, out, opts)
  return { findings: out, rails, notes }
}

/**
 * Runs INSIDE the page. Self-contained: no import, no outside name. Returns the record `measure` reads, plus the
 * resolved token sets as arrays (sets do not cross the page boundary).
 */
export function collectPage(opts) {
  const INTERACTIVE = 'a[href],button,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],input:not([type=hidden])'
  const view = { w: document.documentElement.clientWidth, h: window.innerHeight }
  const rectOf = (e) => {
    const r = e.getBoundingClientRect()
    return { left: r.left, top: r.top + window.scrollY, right: r.right, bottom: r.bottom + window.scrollY }
  }
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s)
  const selectorOf = (e) => {
    if (e.id) return `#${esc(e.id)}`
    const qa = e.getAttribute('data-qa')
    if (qa) return `${e.tagName.toLowerCase()}[data-qa=${qa}]`
    const parts = []
    for (let n = e; n && n.nodeType === 1 && n !== document.documentElement && parts.length < 4; n = n.parentElement) {
      const tag = n.tagName.toLowerCase()
      const cls = [...n.classList].filter((c) => !/\d{3,}|^ng-|^cdk-/.test(c)).slice(0, 2).map((c) => `.${esc(c)}`).join('')
      parts.unshift(`${tag}${cls}`)
      if (n.id || tag.includes('-')) break
    }
    return parts.join(' > ')
  }
  const componentOf = (e) => {
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) if (n.tagName.includes('-')) return n.tagName.toLowerCase()
    return null
  }
  const all = [...document.body.querySelectorAll('*')].filter((e) => !['SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK', 'META', 'TEMPLATE'].includes(e.tagName))
  const index = new Map(all.map((e, i) => [e, i]))
  const elements = []
  for (const e of all) {
    const cs = getComputedStyle(e)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '')
    const interactive = e.matches(INTERACTIVE) && !e.disabled
    elements.push({
      i: index.get(e),
      parent: index.has(e.parentElement) ? index.get(e.parentElement) : -1,
      tag: e.tagName.toLowerCase(),
      selector: selectorOf(e),
      component: componentOf(e),
      rect: rectOf(e),
      display: cs.display,
      position: cs.position,
      flexDirection: cs.flexDirection,
      overflowX: cs.overflowX,
      overflowY: cs.overflowY,
      scrollWidth: e.scrollWidth,
      clientWidth: e.clientWidth,
      scrollHeight: e.scrollHeight,
      clientHeight: e.clientHeight,
      textOverflow: cs.textOverflow,
      hasText: own,
      borderStyle: cs.borderTopStyle,
      appearance: cs.appearance,
      backgroundColor: cs.backgroundColor,
      color: cs.color,
      borderColor: cs.borderTopColor,
      fontSize: cs.fontSize,
      borderRadius: cs.borderTopLeftRadius,
      scrollSnapType: cs.scrollSnapType,
      interactive,
      primary: interactive && (e.matches('[type=submit],.primary,[class*=primary],[data-primary]') || false),
    })
  }
  // Re-index parents to positions in `elements` (hidden elements were dropped).
  const pos = new Map(elements.map((el, k) => [el.i, k]))
  const kept = elements.map((el, k) => {
    let p = el.parent
    while (p !== -1 && !pos.has(p)) p = index.has(all[p]?.parentElement) ? index.get(all[p].parentElement) : -1
    return { ...el, i: k, parent: p === -1 ? -1 : pos.get(p) }
  })
  // Resolved design tokens: every custom property with a configured prefix, read through computed style.
  const tokens = { color: [], fontSize: [], radius: [] }
  const names = new Set()
  for (const sheet of document.styleSheets) {
    let rules
    try { rules = sheet.cssRules } catch { continue }
    for (const r of rules ?? []) {
      if (r.style) for (const n of r.style) if (n.startsWith('--')) names.add(n)
    }
  }
  const probe = document.createElement('span')
  probe.style.cssText = 'position:absolute;visibility:hidden'
  document.body.appendChild(probe)
  for (const n of names) {
    for (const [kind, prefix] of Object.entries(opts.tokenPrefixes ?? {})) {
      if (!prefix || !n.startsWith(prefix)) continue
      const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim()
      if (!v) continue
      if (kind === 'color') {
        probe.style.color = ''
        probe.style.color = v
        if (probe.style.color) tokens.color.push(getComputedStyle(probe).color)
      } else {
        probe.style.fontSize = ''
        probe.style.fontSize = v
        const r = parseFloat(getComputedStyle(probe).fontSize)
        if (probe.style.fontSize && !Number.isNaN(r)) tokens[kind].push(r)
      }
    }
  }
  probe.remove()
  return {
    viewport: view,
    doc: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, scrollHeight: document.documentElement.scrollHeight },
    elements: kept,
    tokens,
  }
}
