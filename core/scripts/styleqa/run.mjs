/**
 * Style QA engine — lists the style defects of the project's pages in one report, with stable finding IDs.
 *
 *   node scripts/styleqa/run.mjs [--pages=<word,…>] [--layers=static[,sweep]] [--widths=375,620] [--states=<name,…>]
 *                                [--date=YYYY-MM-DD] [--out=<folder>] [--changed] [--app=<origin>] [--api=<origin>]
 *   node scripts/styleqa/run.mjs --list
 *
 * --pages   slugs or aliases from docs/qa/styleqa-pages.json (default: every page); an unknown word stops the run
 *           before anything runs, with every valid name (exit 1).
 * --list    prints the pages with their routes and states.
 * --layers  static (default): the stylesheet checks S1–S3; sweep: the browser layer — every page × state × width in
 *           Chromium (L1–L6, U1, T1–T3, G5, A1, screenshots); read-only: every non-GET request is aborted. It needs
 *           @playwright/test and @axe-core/playwright in the project (exit 2 with the install line when missing).
 * --changed only the pages whose route or component folders have files changed since origin/<main branch>.
 * --app / --api  override the app and API origins (default styleqa.appOrigin / apiOrigin, else this checkout's ports).
 * --widths  viewport widths from styleqa.widths (default: all); --states state names (default: all).
 * --date    the report date (default: today); --out the output folder (default: styleqa.outDir).
 * --root    the project folder (default: the folder above scripts/); --settings a JSON file of styleqa keys laid over the
 *           rendered ones (a trial run with other settings).
 *
 * Writes <out>/report.md and <out>/known.json (the finding store). Prints `STYLEQA: report <path> — …`.
 * Exit 0 = report written (findings do not fail the run) or no pages; 1 = a bad argument or page map, a step refused
 * by blockedSteps, a route in neither `pages` nor `excluded`, or a failed sweep (the report says `status: failed`);
 * 2 = a layer that is not installed. Node built-ins only.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { spawnSync } from 'child_process'
import { resolve, dirname, join, relative } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { loadSettings, parseWidths, origins, PAGE_MAP } from './config.mjs'
import { readPageMap, resolvePages, validNames, listLines, statesOf, sweepStatesOf, mapCheck, changedPages } from './pages.mjs'
import { staticChecks } from './static-checks.mjs'
import { readStore, updateStore, writeStore } from './findings.mjs'
import { renderReport } from './report.mjs'
import { sweep, loadDeps, blockedStepProblems, signInPath, SweepFailed, INSTALL_LINE } from './sweep.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const LAYERS = ['static', 'sweep']
const INSTALLED = ['static', 'sweep']

/** --name=value flags and bare --name switches. */
export function parseArgs(argv) {
  const a = {}
  for (const x of argv) {
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(x)
    if (!m) throw new Error(`unknown argument ${x}`)
    a[m[1]] = m[2] ?? true
  }
  const known = ['pages', 'list', 'layers', 'widths', 'states', 'date', 'out', 'root', 'settings', 'changed', 'app', 'api']
  const bad = Object.keys(a).find((k) => !known.includes(k))
  if (bad) throw new Error(`unknown flag --${bad} (allowed: ${known.map((k) => `--${k}`).join(', ')})`)
  return a
}

const words = (v) => (typeof v === 'string' ? v.split(',').map((w) => w.trim()).filter(Boolean) : [])
const today = () => new Date().toISOString().slice(0, 10)

/** The stack pack's route reader module, or null (no reader configured, or the file is missing). */
async function loadReader(root, settings) {
  if (!settings.routesReader) return null
  const file = join(root, settings.routesReader)
  return existsSync(file) ? import(pathToFileURL(file).href) : null
}

/** The app's routes through the pack reader: { routes: null } with a reason when it cannot read them. */
async function appRoutes(root, settings, reader) {
  if (!reader?.readRoutes) return { routes: null }
  const file = join(root, settings.routesFile || '')
  if (!settings.routesFile || !existsSync(file)) return { routes: null, why: `routes file ${settings.routesFile || '(paths.routesFile not set)'} not found` }
  return { routes: reader.readRoutes(readFileSync(file, 'utf8'), settings.routesFile) }
}

/** Files changed since origin/<main branch> (committed or not); null when git cannot say. */
function changedFiles(root, base) {
  const run = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' })
  const diff = run('diff', '--name-only', `origin/${base}...HEAD`)
  if (diff.status !== 0) return null
  const dirty = run('status', '--porcelain')
  const extra = (dirty.stdout ?? '').split(/\r?\n/).filter(Boolean).map((l) => l.slice(3).replace(/^.* -> /, ''))
  return [...diff.stdout.split(/\r?\n/).filter(Boolean), ...extra]
}

/** The whole run; returns { code, lines } (stdout lines; a code above 0 means they are reasons). */
export async function main(argv) {
  const say = []
  const stop = (code, ...lines) => ({ code, lines: [...say, ...lines.map((l) => `STYLEQA: ${l}`)] })
  let args
  try {
    args = parseArgs(argv)
  } catch (e) {
    return stop(1, e.message)
  }
  const root = resolve(typeof args.root === 'string' ? args.root : join(HERE, '..', '..'))
  let settings
  try {
    settings = loadSettings(typeof args.settings === 'string' ? resolve(args.settings) : null)
  } catch (e) {
    return stop(1, `settings file unreadable: ${e.message}`)
  }
  const { map, problems } = readPageMap(join(root, PAGE_MAP))
  if (problems.length) return stop(1, `${PAGE_MAP} refused:`, ...problems.map((p) => `  ${p}`))
  if (!map.pages.length) return { code: 0, lines: [`STYLEQA: no pages in ${PAGE_MAP} — add the project's pages to run the checks`] }
  if (args.list) return { code: 0, lines: listLines(map) }

  const resolved = resolvePages(map, words(args.pages))
  const { unknown } = resolved
  let pages = resolved.pages
  if (unknown.length) return stop(1, `unknown page${unknown.length > 1 ? 's' : ''} ${unknown.map((w) => `"${w}"`).join(', ')} — valid pages (slug, then aliases):`, ...validNames(map).map((n) => `  ${n}`))

  const layers = args.layers ? words(args.layers) : ['static']
  const badLayer = layers.find((l) => !LAYERS.includes(l))
  if (badLayer || !layers.length) return stop(1, `unknown layer "${badLayer ?? ''}" — allowed: ${LAYERS.join(', ')}`)
  const missing = layers.find((l) => !INSTALLED.includes(l))
  if (missing) return stop(2, `${missing} layer not installed`)
  const sweepOn = layers.includes('sweep')
  const reader = await loadReader(root, settings)
  const { routes, why } = await appRoutes(root, settings, reader)
  if (args.changed) {
    const files = changedFiles(root, settings.mainBranch || 'main')
    if (!files) return stop(1, `--changed needs git and origin/${settings.mainBranch || 'main'} to compare with`)
    pages = changedPages(pages, files, routes ?? [])
    say.push(`STYLEQA: --changed: ${pages.length ? pages.map((p) => p.slug).join(', ') : 'no page'} changed since origin/${settings.mainBranch || 'main'}`)
    if (!pages.length) return { code: 0, lines: say }
  }
  if (sweepOn) {
    const refused = blockedStepProblems(pages, settings)
    if (refused.length) return stop(1, 'a step is refused before the browser opens:', ...refused.map((r) => `  ${r}`))
    try { signInPath(root, settings.signIn) } catch (e) { return stop(1, e.message) }
  }

  const configured = parseWidths(settings.widths)
  let widths = null
  if (args.widths) {
    const want = words(args.widths).map((w) => Number(w.split('x')[0]))
    const bad = want.filter((w) => !configured.some((c) => c.width === w))
    if (bad.length) return stop(1, `unknown width ${bad.join(', ')} — configured widths: ${configured.map((c) => c.width).join(', ')}`)
    widths = want
  }
  let states = null
  if (args.states) {
    const have = new Set(pages.flatMap(sweepOn ? sweepStatesOf : statesOf))
    const want = words(args.states)
    const bad = want.filter((s) => !have.has(s))
    if (bad.length) return stop(1, `unknown state ${bad.join(', ')} on the chosen pages — states: ${[...have].join(', ')}`)
    states = want
  }
  const date = typeof args.date === 'string' ? args.date : today()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return stop(1, `--date ${date} must be YYYY-MM-DD`)
  const outDir = resolve(root, typeof args.out === 'string' ? args.out : settings.outDir)

  const coverage = { layers, pages: pages.map((p) => p.slug), states, widths }
  const found = []
  const notes = []
  const rails = []
  let failed = ''
  if (layers.includes('static')) {
    const r = staticChecks({ root, settings: { ...settings, outDir: relative(root, outDir) } })
    found.push(...r.findings)
    notes.push(...r.notes)
    say.push(`STYLEQA: static — ${r.files.length} stylesheet${r.files.length === 1 ? '' : 's'} read, ${r.findings.length} literal${r.findings.length === 1 ? '' : 's'} found`)
  }
  if (sweepOn) {
    const deps = await loadDeps(root)
    if (deps.missing) return stop(2, `sweep layer not installed — ${deps.missing.join(' and ')} not found in this project; install with: ${INSTALL_LINE}`)
    const o = origins(settings)
    const app = typeof args.app === 'string' ? args.app : o.app
    const api = typeof args.api === 'string' ? args.api : o.api
    try {
      const r = await sweep({ root, settings, pages, widths: configured.filter((c) => !widths || widths.includes(c.width)), states, app, api, outDir, reader, deps })
      found.push(...r.findings)
      rails.push(...r.rails)
      notes.push(...r.notes)
      if (r.skipped.length) coverage.skipped = r.skipped.map((s) => `${s} — skipped: no record`)
      if (r.truncated.length) coverage.truncated = r.truncated
      say.push(`STYLEQA: sweep — ${pages.length} page${pages.length === 1 ? '' : 's'}, ${r.findings.length} finding${r.findings.length === 1 ? '' : 's'}, ${r.rails.length} rail${r.rails.length === 1 ? '' : 's'}`)
    } catch (e) {
      if (!(e instanceof SweepFailed)) throw e
      failed = e.message
    }
  }
  const reportFile = join(outDir, 'report.md')
  mkdirSync(outDir, { recursive: true })
  if (failed) {
    // A failed sweep proves nothing about the findings: the store is left as it was.
    writeFileSync(reportFile, renderReport({ date, current: [], coverage, notes, pages: map.pages, direction: settings.uiDirection, failed }))
    return { code: 1, lines: [...say, `STYLEQA: status: failed — ${failed}`] }
  }
  const storeFile = join(outDir, 'known.json')
  const { store, current } = updateStore(readStore(storeFile), { findings: found, coverage }, { date })
  writeStore(storeFile, store)
  writeFileSync(reportFile, renderReport({ date, current, coverage, notes, pages: map.pages, direction: settings.uiDirection, rails }))
  // What merge.mjs needs to draw the same report again with the visual findings folded in.
  writeFileSync(join(outDir, 'run.json'), `${JSON.stringify({ date, coverage, notes, rails }, null, 2)}\n`)
  const n = (s) => current.filter((f) => f.status === s).length
  for (const note of notes) say.push(`STYLEQA: ${note}`)
  say.push(`STYLEQA: report ${relative(root, reportFile).replace(/\\/g, '/')} — ${n('new') + n('known')} open (${n('new')} new, ${n('known')} known), ${n('gone')} gone`)
  // The map check: an app route in neither `pages` nor `excluded` means the page map went stale.
  if (!reader?.readRoutes) say.push('SKIP map check: no route reader for this stack')
  else if (!routes) say.push(`SKIP map check: ${why}`)
  else {
    const stale = mapCheck(map, routes)
    if (stale.length) return { code: 1, lines: [...say, ...stale.map((r) => `STYLEQA: map check failed — route ${r} is in neither pages nor excluded in ${PAGE_MAP}`)] }
    say.push(`STYLEQA: map check ok — ${routes.length} route${routes.length === 1 ? '' : 's'} all in pages or excluded`)
  }
  return { code: 0, lines: say }
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMainModule) {
  const { code, lines } = await main(process.argv.slice(2))
  for (const l of lines) (code ? console.error : console.log)(l)
  process.exit(code)
}
