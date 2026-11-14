/**
 * Style QA page map — docs/qa/styleqa-pages.json, the project's own list of pages and their states:
 *
 *   { "pages": [ { "slug", "aliases": [], "title", "routes": ["/…"], "idType"?, "auth", "oneRow"?, "states": [
 *       { "name", "steps": [ { "action": "click|hover|fill|press|waitFor|scrollTo", "target": "<selector>", "value"? } ] } ] } ],
 *     "excluded": [ { "route", "why" } ] }
 *
 * Every page has the state `default` (the page as it opens); `states` adds the others. A page word is a slug or an
 * alias (any language; matched exactly after trimming).
 *
 *   import { readPageMap, pageMapProblems, resolvePages, listLines } from './pages.mjs'
 *
 * Node built-ins only; no placeholders (tools import it).
 */
import { readFileSync, existsSync } from 'fs'

export const STEP_ACTIONS = ['click', 'hover', 'fill', 'press', 'waitFor', 'scrollTo']
export const DEFAULT_STATE = 'default'
const SLUG = /^[a-z0-9][a-z0-9-]*$/
const PAGE_KEYS = ['slug', 'aliases', 'title', 'routes', 'idType', 'auth', 'oneRow', 'states']
const STEP_KEYS = ['action', 'target', 'value']

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
const str = (v) => typeof v === 'string' && v.trim() !== ''

/** One message per problem of a parsed page map, each naming the field (`pages[1].aliases[0]`). [] = valid. */
export function pageMapProblems(map) {
  const out = []
  if (!isObj(map)) return ['the page map must be a JSON object { "pages": [], "excluded": [] }']
  if (!Array.isArray(map.pages)) out.push('pages must be a list')
  if (map.excluded !== undefined && !Array.isArray(map.excluded)) out.push('excluded must be a list')
  const names = new Map() // slug or alias -> where it was first named
  const claim = (word, at) => {
    const w = word.trim()
    if (names.has(w)) out.push(`${at} "${w}" is already used by ${names.get(w)} — every slug and alias must be unique`)
    else names.set(w, at)
  }
  for (const [i, p] of (Array.isArray(map.pages) ? map.pages : []).entries()) {
    const at = `pages[${i}]`
    if (!isObj(p)) {
      out.push(`${at} must be an object`)
      continue
    }
    for (const k of Object.keys(p)) if (!PAGE_KEYS.includes(k) && !k.startsWith('$')) out.push(`${at}.${k} is not a page field — allowed: ${PAGE_KEYS.join(', ')}`)
    if (typeof p.slug !== 'string' || !SLUG.test(p.slug)) out.push(`${at}.slug ${JSON.stringify(p.slug)} must be lower-case letters, digits and dashes`)
    else claim(p.slug, `${at}.slug`)
    if (p.aliases !== undefined && !Array.isArray(p.aliases)) out.push(`${at}.aliases must be a list of words`)
    for (const [j, a] of (Array.isArray(p.aliases) ? p.aliases : []).entries()) {
      if (!str(a)) out.push(`${at}.aliases[${j}] must be a non-empty word`)
      else claim(a, `${at}.aliases[${j}]`)
    }
    if (!str(p.title)) out.push(`${at}.title must be a non-empty string`)
    if (!Array.isArray(p.routes) || !p.routes.length) out.push(`${at}.routes must be a non-empty list of paths starting with "/"`)
    else p.routes.forEach((r, j) => { if (typeof r !== 'string' || !r.startsWith('/')) out.push(`${at}.routes[${j}] ${JSON.stringify(r)} must be a path starting with "/"`) })
    if (p.idType !== undefined && !str(p.idType)) out.push(`${at}.idType must be a non-empty string when set`)
    if (!(typeof p.auth === 'boolean' || (typeof p.auth === 'string' && SLUG.test(p.auth)))) out.push(`${at}.auth ${JSON.stringify(p.auth)} must be true, false or a role word (a ui.logins role)`)
    if (p.oneRow !== undefined && typeof p.oneRow !== 'boolean') out.push(`${at}.oneRow must be true or false when set`)
    if (p.states !== undefined && !Array.isArray(p.states)) out.push(`${at}.states must be a list`)
    const stateNames = new Set([DEFAULT_STATE])
    for (const [j, s] of (Array.isArray(p.states) ? p.states : []).entries()) {
      const sat = `${at}.states[${j}]`
      if (!isObj(s)) {
        out.push(`${sat} must be an object { "name", "steps" }`)
        continue
      }
      if (typeof s.name !== 'string' || !SLUG.test(s.name)) out.push(`${sat}.name ${JSON.stringify(s.name)} must be lower-case letters, digits and dashes`)
      else if (stateNames.has(s.name)) out.push(`${sat}.name "${s.name}" is already a state of ${p.slug ?? at}${s.name === DEFAULT_STATE ? ' (every page has it)' : ''}`)
      else stateNames.add(s.name)
      if (!Array.isArray(s.steps) || !s.steps.length) {
        out.push(`${sat}.steps must be a non-empty list`)
        continue
      }
      for (const [k, step] of s.steps.entries()) {
        const kat = `${sat}.steps[${k}]`
        if (!isObj(step)) {
          out.push(`${kat} must be an object { "action", "target", "value"? }`)
          continue
        }
        if (!STEP_ACTIONS.includes(step.action)) out.push(`${kat}.action ${JSON.stringify(step.action)} — allowed: ${STEP_ACTIONS.join(' | ')}`)
        if (!str(step.target)) out.push(`${kat}.target must be a non-empty selector`)
        if ((step.action === 'fill' || step.action === 'press') && typeof step.value !== 'string') out.push(`${kat}.value must be a string for ${step.action}`)
        for (const x of Object.keys(step)) if (!STEP_KEYS.includes(x)) out.push(`${kat}.${x} is not a step field — allowed: ${STEP_KEYS.join(', ')}`)
      }
    }
  }
  for (const [i, e] of (Array.isArray(map.excluded) ? map.excluded : []).entries()) {
    if (!isObj(e) || typeof e.route !== 'string' || !e.route.startsWith('/')) out.push(`excluded[${i}].route must be a path starting with "/"`)
    else if (!str(e.why)) out.push(`excluded[${i}].why must say why the route is left out`)
  }
  return out
}

/** { map, problems }: the parsed page map, or the reasons it cannot be used (a missing file, bad JSON, bad fields). */
export function readPageMap(file) {
  if (!existsSync(file)) return { map: null, problems: [`no page map at ${file}`] }
  let map
  try {
    map = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    return { map: null, problems: [`${file} is not valid JSON: ${e.message}`] }
  }
  const problems = pageMapProblems(map)
  return { map: problems.length ? null : map, problems }
}

/** The state names of a page, `default` first. */
export const statesOf = (page) => [DEFAULT_STATE, ...(page.states ?? []).map((s) => s.name)]

/**
 * Page words → pages. `words` empty or absent = every page. { pages, unknown }: the pages in map order (each once),
 * and the words that name no page.
 */
export function resolvePages(map, words) {
  const all = map.pages ?? []
  const asked = (words ?? []).map((w) => String(w).trim()).filter(Boolean)
  if (!asked.length) return { pages: all, unknown: [] }
  const bySlug = new Map()
  for (const p of all) {
    bySlug.set(p.slug, p)
    for (const a of p.aliases ?? []) bySlug.set(a.trim(), p)
  }
  const want = new Set()
  const unknown = []
  for (const w of asked) {
    const p = bySlug.get(w)
    if (p) want.add(p.slug)
    else unknown.push(w)
  }
  return { pages: all.filter((p) => want.has(p.slug)), unknown }
}

/** Every valid page word: one line per page, `slug (alias, alias)`. */
export const validNames = (map) => (map.pages ?? []).map((p) => (p.aliases?.length ? `${p.slug} (${p.aliases.map((a) => a.trim()).join(', ')})` : p.slug))

/** --list: one line per page with its title, routes and states. */
export function listLines(map) {
  return (map.pages ?? []).map((p) => {
    const aka = p.aliases?.length ? `  aliases: ${p.aliases.map((a) => a.trim()).join(', ')}` : ''
    return `${p.slug} — ${p.title}${aka}  routes: ${p.routes.join(', ')}  states: ${statesOf(p).join(', ')}`
  })
}

// ---- the sweep layer's view of the page map ----

const ROUTE_PARAM = /:[A-Za-z_]\w*/g
/** A route with every `:param` named alike, so `/a/:id` and `/a/:recipeId` are one route. */
export const routeShape = (r) => String(r).split('?')[0].replace(/\/+$/, '').replace(ROUTE_PARAM, ':p') || '/'

/** The tab states of a page: every route with a query (`/settings?tab=billing`) is a state `tab-<value>`. */
export function tabStates(page) {
  return page.routes.filter((r) => r.includes('?')).map((r) => {
    const q = new URLSearchParams(r.split('?')[1])
    const v = [...q.values()][0] ?? 'x'
    return { name: `tab-${String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x'}`, route: r }
  })
}

/** The state names the sweep runs for a page: default, empty (a page with `idType` lists records), tabs, then its own. */
export function sweepStatesOf(page) {
  return [DEFAULT_STATE, ...(page.idType ? ['empty'] : []), ...tabStates(page).map((t) => t.name), ...(page.states ?? []).map((s) => s.name)]
}

/** The route a page opens by default: the first without a query. */
export const baseRoute = (page) => page.routes.find((r) => !r.includes('?')) ?? page.routes[0]

/**
 * The map check: app routes (from the stack pack's reader) that are in neither `pages` nor `excluded`.
 * routes: [{ path, lazy? }]. A lazy route covers every page route beneath it. → the uncovered paths.
 */
export function mapCheck(map, routes) {
  const known = new Set()
  for (const p of map.pages ?? []) for (const r of p.routes) known.add(routeShape(r))
  for (const e of map.excluded ?? []) known.add(routeShape(e.route))
  return routes.filter((r) => {
    const s = routeShape(r.path)
    if (known.has(s)) return false
    return !(r.lazy && [...known].some((k) => k.startsWith(`${s}/`)))
  }).map((r) => r.path)
}

/**
 * --changed: the pages whose route folders or component folders hold a changed file. files: repo-relative paths;
 * routes: the stack pack's route list ([{ path, folder? }]). A page whose routes the reader gives a folder for is
 * judged by that folder alone; without one, by its slug and route words appearing as a folder or file name.
 */
export function changedPages(pages, files, routes = []) {
  const changed = files.map((f) => f.replace(/\\/g, '/'))
  return pages.filter((p) => {
    const shapes = p.routes.map(routeShape)
    const folders = routes.filter((r) => r.folder && shapes.includes(routeShape(r.path))).map((r) => `${r.folder.replace(/\/+$/, '')}/`)
    if (folders.length) return changed.some((f) => folders.some((d) => f.startsWith(d)))
    const words = new Set([p.slug, ...shapes.flatMap((s) => s.split('/').filter((x) => x && !x.startsWith(':')))])
    return changed.some((f) => {
      const parts = f.split('/')
      return parts.some((seg, i) => words.has(i === parts.length - 1 ? seg.replace(/\..*$/, '') : seg))
    })
  })
}
