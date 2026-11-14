/**
 * Style QA sweep — opens every page × state × width in Chromium, measures it (probe.mjs), checks colour contrast with
 * axe (A1) and takes bounded screenshots. Read-only against the server: a request guard aborts every request that is
 * not a GET, so a step that clicks the wrong thing still writes nothing.
 *
 *   import { sweep, loadDeps, blockedStepProblems, guardDecision, segments, signInPath, INSTALL_LINE } from './sweep.mjs'
 *
 * `@playwright/test` and `@axe-core/playwright` come from the project's own node_modules (resolved from its root); the
 * kit never adds them to a package.json. No placeholders (tools import it); node built-ins only besides those two.
 */
import { createRequire } from 'module'
import { join, resolve, isAbsolute, relative } from 'path'
import { pathToFileURL } from 'url'
import { mkdirSync } from 'fs'
import { collectPage, measure, PHONE_MAX } from './probe.mjs'
import { sweepStatesOf, tabStates, baseRoute } from './pages.mjs'

export const INSTALL_LINE = 'npm i --no-save @playwright/test @axe-core/playwright && npx playwright install chromium'
export const MAX_SEGMENTS = 4
const STEP_TIMEOUT = 5000
const LOAD_TIMEOUT = 8000

/** Raised when the sweep cannot run at all (the browser does not start, an origin does not answer). */
export class SweepFailed extends Error {}

/** The sign-in module's absolute path; a repo-relative path inside the project only. */
export function signInPath(root, rel) {
  const r = String(rel ?? '').trim()
  if (!r) return null
  if (isAbsolute(r) || /^[a-zA-Z]:/.test(r) || r.split(/[\\/]/).includes('..')) throw new Error(`styleqa.signIn "${r}" must be a path inside the project (no absolute path, no "..")`)
  return resolve(root, r)
}

/** One message per step that touches a blocked word or selector; each names the step. [] = safe. */
export function blockedStepProblems(pages, settings) {
  const words = (settings.blockedSteps?.words ?? []).map((x) => String(x).toLowerCase()).filter(Boolean)
  const sels = (settings.blockedSteps?.selectors ?? []).map((x) => String(x).trim()).filter(Boolean)
  const out = []
  for (const p of pages) {
    for (const s of p.states ?? []) {
      for (const [i, step] of (s.steps ?? []).entries()) {
        const text = `${step.target} ${step.value ?? ''}`.toLowerCase()
        const word = words.find((w) => text.includes(w))
        const sel = sels.find((x) => step.target === x || step.target.includes(x))
        const why = word ? `the word "${word}"` : sel ? `the selector "${sel}"` : ''
        if (why) out.push(`pages[${p.slug}].states[${s.name}].steps[${i}] (${step.action} ${step.target}) is refused: it matches ${why} in styleqa.blockedSteps`)
      }
    }
  }
  return out
}

const ID_SEGMENT = /^(\d+|[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{24})$/i

/**
 * What the request guard does with a request: 'abort' (anything that is not a GET), 'empty' (a list request while the
 * `empty` state runs: a GET fetch/xhr to the API origin whose last path segment is not an id) or 'continue'.
 */
export function guardDecision(req, { empty = false, apiOrigin = '' } = {}) {
  if (String(req.method).toUpperCase() !== 'GET') return 'abort'
  if (!empty || !apiOrigin || !['fetch', 'xhr'].includes(req.resourceType)) return 'continue'
  let u
  try { u = new URL(req.url) } catch { return 'continue' }
  if (u.origin !== new URL(apiOrigin).origin) return 'continue'
  const last = u.pathname.split('/').filter(Boolean).at(-1) ?? ''
  return ID_SEGMENT.test(last) ? 'continue' : 'empty'
}

/** Installs the guard on a browser context. `state` is { empty: boolean }, changed by the caller per page state. */
export async function installGuard(context, state, apiOrigin) {
  await context.route('**/*', async (route) => {
    const r = route.request()
    const d = guardDecision({ method: r.method(), url: r.url(), resourceType: r.resourceType() }, { empty: state.empty, apiOrigin })
    if (d === 'abort') return route.abort('blockedbyclient')
    if (d === 'empty') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    return route.continue()
  })
}

/** Viewport-high segments of a page: at most `max`; a longer page is `truncated`. */
export function segments(total, viewportHeight, max = MAX_SEGMENTS) {
  const vh = Math.max(1, Math.floor(viewportHeight))
  const need = Math.max(1, Math.ceil(total / vh))
  const list = []
  for (let i = 0; i < Math.min(need, max); i++) list.push({ y: i * vh, height: Math.min(vh, Math.max(1, Math.ceil(total) - i * vh)) })
  return { segments: list, truncated: need > max }
}

/** The project's Playwright and axe, or the names that are missing. → { chromium, AxeBuilder } | { missing: [] } */
export async function loadDeps(root) {
  const req = createRequire(join(root, 'package.json'))
  const missing = []
  const load = async (name) => {
    try {
      return await import(pathToFileURL(req.resolve(name)).href)
    } catch {
      missing.push(name)
      return null
    }
  }
  const pw = await load('@playwright/test')
  const axe = await load('@axe-core/playwright')
  if (missing.length) return { missing }
  const AxeBuilder = axe.default?.default ?? axe.AxeBuilder ?? axe.default
  return { chromium: pw.chromium ?? pw.default?.chromium, AxeBuilder }
}

/** The first record's id of a list response: an array, or an object holding one (`items`, `data`, `results`). */
export function firstId(body) {
  const list = Array.isArray(body) ? body : ['items', 'data', 'results', 'records'].map((k) => body?.[k]).find(Array.isArray)
  const first = list?.[0]
  const id = first && typeof first === 'object' ? (first.id ?? first._id ?? first.uuid) : undefined
  return id === undefined || id === null ? null : String(id)
}

async function recordId(context, page, apiOrigin) {
  const list = String(page.idType)
  const url = /^https?:\/\//.test(list) ? list : list.startsWith('/') ? `${apiOrigin}${list}` : null
  if (!url) return null
  try {
    const res = await context.request.get(url)
    if (!res.ok()) return null
    return firstId(await res.json())
  } catch {
    return null
  }
}

const widthKey = (v) => `${v.width}x${v.height}`

async function runSteps(pg, steps) {
  for (const s of steps) {
    const loc = pg.locator(s.target).first()
    if (s.action === 'click') await loc.click({ timeout: STEP_TIMEOUT })
    else if (s.action === 'hover') await loc.hover({ timeout: STEP_TIMEOUT })
    else if (s.action === 'fill') await loc.fill(s.value ?? '', { timeout: STEP_TIMEOUT })
    else if (s.action === 'press') await loc.press(s.value ?? '', { timeout: STEP_TIMEOUT })
    else if (s.action === 'waitFor') await loc.waitFor({ timeout: STEP_TIMEOUT })
    else if (s.action === 'scrollTo') await loc.scrollIntoViewIfNeeded({ timeout: STEP_TIMEOUT })
    await pg.waitForTimeout(150)
  }
}

async function waitLoaded(pg, loaderText) {
  await pg.waitForLoadState('load', { timeout: LOAD_TIMEOUT }).catch(() => {})
  for (const t of loaderText) await pg.getByText(t).first().waitFor({ state: 'hidden', timeout: LOAD_TIMEOUT }).catch(() => {})
  await pg.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {})
}

const slugPart = (s) => String(s).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'x'

/**
 * The sweep. opts: { root, settings, pages, widths: [{ width, height }], states: null | [names], app, api, outDir,
 * reader: { locateComponent? } | null, direction, deps: { chromium, AxeBuilder } }.
 * → { findings, rails, notes, skipped: [], truncated: [] }; throws SweepFailed when it cannot run.
 */
export async function sweep(opts) {
  const { root, settings, pages, widths, app, api, outDir, reader, deps } = opts
  const findings = []
  const rails = []
  const notes = []
  const skipped = []
  const truncated = []
  const tokensOn = Object.values(settings.tokenPrefixes ?? {}).some(Boolean)
  const signIn = settings.signIn ? await import(pathToFileURL(signInPath(root, settings.signIn)).href).then((m) => m.signIn) : null
  if (signIn && typeof signIn !== 'function') throw new SweepFailed(`styleqa.signIn ${settings.signIn} does not export signIn(context, { appOrigin, apiOrigin })`)

  try {
    const res = await fetch(app, { signal: AbortSignal.timeout(8000) })
    void res
  } catch (e) {
    throw new SweepFailed(`the app origin ${app} does not answer (${e.cause?.code ?? e.message})`)
  }
  let browser
  try {
    browser = await deps.chromium.launch()
  } catch (e) {
    throw new SweepFailed(`the browser cannot start: ${String(e.message).split('\n')[0]}`)
  }
  const unsigned = pages.some((p) => p.auth) && !signIn
  if (unsigned) notes.push('no styleqa.signIn set: pages with auth were measured signed out')
  const locatedCache = new Map()
  const locate = (tag) => {
    if (!tag) return 'unknown'
    if (!locatedCache.has(tag)) {
      let src = null
      try { src = reader?.locateComponent ? reader.locateComponent(root, tag) : null } catch { src = null }
      locatedCache.set(tag, src || 'unknown')
    }
    return locatedCache.get(tag)
  }
  if (!reader?.locateComponent) notes.push('component source: unknown (the stack pack provides no component locator)')
  const contexts = new Map()
  try {
    const contextFor = async (vp, auth) => {
      const key = `${widthKey(vp)}|${auth ? 'auth' : 'anon'}`
      if (contexts.has(key)) return contexts.get(key)
      const phone = vp.width <= PHONE_MAX
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: phone, hasTouch: phone })
      if (auth && signIn) await signIn(context, { appOrigin: app, apiOrigin: api })
      const state = { empty: false }
      await installGuard(context, state, api)
      const entry = { context, state }
      contexts.set(key, entry)
      return entry
    }
    for (const page of pages) {
      const tabs = new Map(tabStates(page).map((t) => [t.name, t.route]))
      const declared = new Map((page.states ?? []).map((s) => [s.name, s]))
      const names = sweepStatesOf(page).filter((n) => !opts.states || opts.states.includes(n))
      for (const vp of widths) {
        const { context, state } = await contextFor(vp, !!page.auth)
        let id = null
        const needsId = page.routes.some((r) => r.includes(':'))
        if (needsId) id = await recordId(context, page, api)
        for (const name of names) {
          const raw = tabs.get(name) ?? baseRoute(page)
          if (raw.includes(':') && id === null) {
            const mark = `${page.slug} ${raw}`
            if (!skipped.includes(mark)) skipped.push(mark)
            continue
          }
          const route = raw.replace(/:[A-Za-z_]\w*/g, encodeURIComponent(id ?? ''))
          state.empty = name === 'empty'
          const pg = await context.newPage()
          try {
            try {
              await pg.goto(new URL(route, app).href, { waitUntil: 'load', timeout: 15000 })
            } catch (e) {
              throw new SweepFailed(`${page.slug} ${route} did not open at ${vp.width}px (${String(e.message).split('\n')[0]})`)
            }
            await waitLoaded(pg, settings.loaderText ?? [])
            if (declared.has(name)) await runSteps(pg, declared.get(name).steps)
            const rec = await pg.evaluate(collectPage, { tokenPrefixes: settings.tokenPrefixes })
            const tokens = tokensOn ? { color: new Set(rec.tokens.color), fontSize: new Set(rec.tokens.fontSize), radius: new Set(rec.tokens.radius) } : null
            const m = measure(rec, { direction: settings.uiDirection, oneRow: !!page.oneRow, touch: vp.width <= PHONE_MAX, tokens })
            for (const n of m.notes) if (!notes.includes(n)) notes.push(n)
            const sub = { layer: 'sweep', page: page.slug, state: name, widths: [vp.width] }
            const mine = m.findings.map((f) => ({ ...f, ...sub, source: locate(f.component) }))
            try {
              const axe = await new deps.AxeBuilder({ page: pg }).withRules(['color-contrast']).analyze()
              for (const v of axe.violations) {
                for (const node of v.nodes) {
                  const sel = Array.isArray(node.target) ? node.target.join(' ') : String(node.target)
                  mine.push({ ...sub, check: 'A1', selector: sel, component: null, source: 'unknown', locator: sel, message: `colour contrast too low: ${String(node.failureSummary ?? v.help).split('\n').slice(0, 2).join(' ').trim()}` })
                }
              }
            } catch (e) {
              const n = `A1 off: axe could not run (${String(e.message).split('\n')[0]})`
              if (!notes.includes(n)) notes.push(n)
            }
            const seg = segments(rec.doc.scrollHeight, vp.height)
            const shots = []
            const dir = join(outDir, 'screens')
            mkdirSync(dir, { recursive: true })
            for (const [k, s] of seg.segments.entries()) {
              const file = join(dir, `${slugPart(page.slug)}-${slugPart(name)}-${vp.width}-${k + 1}.png`)
              await pg.screenshot({ path: file, fullPage: true, clip: { x: 0, y: s.y, width: vp.width, height: s.height } })
              shots.push(relative(root, file).replace(/\\/g, '/'))
            }
            if (seg.truncated) truncated.push(`${page.slug} ${name} ${vp.width}`)
            for (const f of mine) findings.push({ ...f, screenshots: shots })
            for (const r of m.rails) {
              rails.push({ page: page.slug, state: name, width: vp.width, side: r.edge, expected: 'scroll-snap on phones, no cut sliver', measured: `${r.selector}: ${r.width}px wide, ${r.visible} visible, snap ${r.snap ? 'on' : 'off'}` })
            }
          } finally {
            await pg.close().catch(() => {})
          }
        }
      }
    }
  } finally {
    await browser.close().catch(() => {})
  }
  return { findings, rails, notes, skipped, truncated }
}
