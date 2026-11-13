/**
 * Style QA engine — lists the style defects of the project's pages in one report, with stable finding IDs.
 *
 *   node scripts/styleqa/run.mjs [--pages=<word,…>] [--layers=static[,sweep]] [--widths=375,620] [--states=<name,…>]
 *                                [--date=YYYY-MM-DD] [--out=<folder>]
 *   node scripts/styleqa/run.mjs --list
 *
 * --pages   slugs or aliases from docs/qa/styleqa-pages.json (default: every page); an unknown word stops the run
 *           before anything runs, with every valid name (exit 1).
 * --list    prints the pages with their routes and states.
 * --layers  static (default): the stylesheet checks S1–S3; sweep: the browser layer (exit 2 while it is not installed).
 * --widths  viewport widths from styleqa.widths (default: all); --states state names (default: all).
 * --date    the report date (default: today); --out the output folder (default: styleqa.outDir).
 * --root    the project folder (default: the folder above scripts/); --settings a JSON file of styleqa keys laid over the
 *           rendered ones (a trial run with other settings).
 *
 * Writes <out>/report.md and <out>/known.json (the finding store). Prints `STYLEQA: report <path> — …`.
 * Exit 0 = report written (findings do not fail the run) or no pages; 1 = a bad argument or page map; 2 = a layer
 * that is not installed. Node built-ins only.
 */
import { writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname, join, relative } from 'path'
import { fileURLToPath } from 'url'
import { loadSettings, parseWidths, PAGE_MAP } from './config.mjs'
import { readPageMap, resolvePages, validNames, listLines, statesOf } from './pages.mjs'
import { staticChecks } from './static-checks.mjs'
import { readStore, updateStore, writeStore } from './findings.mjs'
import { renderReport } from './report.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const LAYERS = ['static', 'sweep']
const INSTALLED = ['static']

/** --name=value flags and bare --name switches. */
export function parseArgs(argv) {
  const a = {}
  for (const x of argv) {
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(x)
    if (!m) throw new Error(`unknown argument ${x}`)
    a[m[1]] = m[2] ?? true
  }
  const known = ['pages', 'list', 'layers', 'widths', 'states', 'date', 'out', 'root', 'settings']
  const bad = Object.keys(a).find((k) => !known.includes(k))
  if (bad) throw new Error(`unknown flag --${bad} (allowed: ${known.map((k) => `--${k}`).join(', ')})`)
  return a
}

const words = (v) => (typeof v === 'string' ? v.split(',').map((w) => w.trim()).filter(Boolean) : [])
const today = () => new Date().toISOString().slice(0, 10)

/** The whole run; returns { code, lines } (stdout lines; a code above 0 means they are reasons). */
export function main(argv) {
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

  const { pages, unknown } = resolvePages(map, words(args.pages))
  if (unknown.length) return stop(1, `unknown page${unknown.length > 1 ? 's' : ''} ${unknown.map((w) => `"${w}"`).join(', ')} — valid pages (slug, then aliases):`, ...validNames(map).map((n) => `  ${n}`))

  const layers = args.layers ? words(args.layers) : ['static']
  const badLayer = layers.find((l) => !LAYERS.includes(l))
  if (badLayer || !layers.length) return stop(1, `unknown layer "${badLayer ?? ''}" — allowed: ${LAYERS.join(', ')}`)
  const missing = layers.find((l) => !INSTALLED.includes(l))
  if (missing) return stop(2, `${missing} layer not installed`)

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
    const have = new Set(pages.flatMap(statesOf))
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
  if (layers.includes('static')) {
    const r = staticChecks({ root, settings: { ...settings, outDir: relative(root, outDir) } })
    found.push(...r.findings)
    notes.push(...r.notes)
    say.push(`STYLEQA: static — ${r.files.length} stylesheet${r.files.length === 1 ? '' : 's'} read, ${r.findings.length} literal${r.findings.length === 1 ? '' : 's'} found`)
  }
  const storeFile = join(outDir, 'known.json')
  const { store, current } = updateStore(readStore(storeFile), { findings: found, coverage }, { date })
  writeStore(storeFile, store)
  const reportFile = join(outDir, 'report.md')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(reportFile, renderReport({ date, current, coverage, notes, pages: map.pages, direction: settings.uiDirection }))
  const n = (s) => current.filter((f) => f.status === s).length
  for (const note of notes) say.push(`STYLEQA: ${note}`)
  say.push(`STYLEQA: report ${relative(root, reportFile).replace(/\\/g, '/')} — ${n('new') + n('known')} open (${n('new')} new, ${n('known')} known), ${n('gone')} gone`)
  return { code: 0, lines: say }
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMainModule) {
  const { code, lines } = main(process.argv.slice(2))
  for (const l of lines) (code ? console.error : console.log)(l)
  process.exit(code)
}
