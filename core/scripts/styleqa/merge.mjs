/**
 * Style QA merge — folds the reviewers' findings into the same report, with stable IDs.
 *
 *   node scripts/styleqa/merge.mjs [--pages=<word,…>] [--out=<folder>] [--root=<folder>] [--settings=<file>]
 *                                  [--min-confidence=70]
 *
 * Reads <out>/review/review-<slug>.json (one per page, written by the styleqa-reviewer agent — untrusted model output):
 *   { "findings": [{ check V1–V8, severity high|medium|low, confidence 0–100, state, width, shot, region, anchorText,
 *                    title, expected, actual }] }
 * Every field is validated, unknown fields are dropped, a shot path must stay under the output folder. A finding with a
 * confidence below the threshold or a check outside V1–V8 is dropped; more than 6 findings for one state keep the 6
 * highest severities. A file that is not valid is skipped with one `skipped <file>: <reason>` line; the merge still exits 0.
 * IDs come from the finding store (findings.mjs): the fingerprint is check + page + state + region + anchorText, so the
 * same defect keeps its ID across runs. The same review file merged twice changes nothing (a hash per page is kept in
 * <out>/review/merged.json). The report is drawn again from <out>/run.json (written by run.mjs) with the visual findings in.
 * Exit 0 = merged (or nothing new); 1 = a bad argument, no run.json, or an unreadable page map. Node built-ins only.
 */
import { readdirSync, existsSync, readFileSync, writeFileSync, statSync, lstatSync } from 'fs'
import { resolve, join, dirname, relative, isAbsolute } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'
import { loadSettings, PAGE_MAP } from './config.mjs'
import { readPageMap, resolvePages, validNames, statesOf, sweepStatesOf } from './pages.mjs'
import { readStore, updateStore, writeStore } from './findings.mjs'
import { renderReport } from './report.mjs'
import { slugPart } from './queue.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const CHECKS = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8']
export const SEVERITIES = ['high', 'medium', 'low']
export const MAX_PER_STATE = 6
export const MIN_CONFIDENCE = 70
const MAX_FILE = 1024 * 1024
const text = (v, max = 300) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const posix = (p) => p.replace(/\\/g, '/')

/**
 * One review finding → a store finding, or { drop: reason }. page: the page map entry; screensRel: the screens folder
 * relative to the project root (a shot must be a .png under it).
 */
export function cleanFinding(raw, { page, screensRel, minConfidence = MIN_CONFIDENCE }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { drop: 'not an object' }
  if (!CHECKS.includes(raw.check)) return { drop: `check ${text(raw.check, 20) || '(none)'} is not V1–V8` }
  if (!SEVERITIES.includes(raw.severity)) return { drop: 'severity is not high, medium or low' }
  const confidence = Number(raw.confidence)
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) return { drop: 'confidence is not 0–100' }
  if (confidence < minConfidence) return { drop: `confidence ${confidence} is below ${minConfidence}` }
  const state = text(raw.state, 60)
  if (!statesOf(page).includes(state) && !sweepStatesOf(page).includes(state)) return { drop: `unknown state ${state || '(none)'}` }
  const width = Number(raw.width)
  if (!Number.isInteger(width) || width < 200 || width > 10000) return { drop: 'width is not a viewport width' }
  const shot = text(raw.shot, 300)
  const parts = posix(shot).split('/')
  if (!shot || isAbsolute(shot) || parts.includes('..') || !/\.png$/i.test(shot) || !posix(shot).startsWith(`${screensRel}/`)) return { drop: `shot ${shot || '(none)'} is not a screenshot under ${screensRel}` }
  const title = text(raw.title)
  if (!title) return { drop: 'no title' }
  const region = text(raw.region, 120)
  const anchorText = text(raw.anchorText, 120)
  const expected = text(raw.expected)
  const actual = text(raw.actual)
  return {
    layer: 'visual', check: raw.check, page: page.slug, state, widths: [width],
    locator: `${region}|${anchorText}`.toLowerCase(),
    severity: raw.severity, confidence, region, anchorText, expected, actual,
    message: `[${raw.severity}] ${title}${expected || actual ? ` — expected: ${expected || '?'}; actual: ${actual || '?'}` : ''}`,
    screenshots: [posix(shot)],
  }
}

/** The 6 highest severities per state (then the higher confidence); the rest are dropped. */
export function capPerState(findings, max = MAX_PER_STATE) {
  const rank = (f) => SEVERITIES.indexOf(f.severity)
  const sorted = [...findings].sort((a, b) => rank(a) - rank(b) || b.confidence - a.confidence || a.locator.localeCompare(b.locator))
  const seen = new Map()
  const keep = []
  for (const f of sorted) {
    const n = seen.get(f.state) ?? 0
    if (n < max) { keep.push(f); seen.set(f.state, n + 1) }
  }
  return keep
}

/** { findings, dropped: [reason…] } for one review file's text, or { skip: reason }. */
export function readReview(file, page, opts) {
  let body
  try {
    if (lstatSync(file).isSymbolicLink()) return { skip: 'a link, not a file' }
    if (statSync(file).size > MAX_FILE) return { skip: 'larger than 1 MB' }
    body = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    return { skip: e instanceof SyntaxError ? `not valid JSON (${e.message.split('\n')[0]})` : `unreadable (${e.code ?? e.message})` }
  }
  if (!body || typeof body !== 'object' || !Array.isArray(body.findings)) return { skip: 'no "findings" list' }
  const good = []
  const dropped = []
  for (const raw of body.findings) {
    const f = cleanFinding(raw, { page, ...opts })
    if (f.drop) dropped.push(f.drop)
    else good.push(f)
  }
  const kept = capPerState(good)
  for (let i = 0; i < good.length - kept.length; i++) dropped.push(`over ${MAX_PER_STATE} findings for one state`)
  return { findings: kept, dropped }
}

const hash = (findings) => createHash('sha256').update(JSON.stringify(findings.map((f) => [f.check, f.state, f.locator, f.severity, f.widths, f.message]).sort())).digest('hex').slice(0, 16)

/** The summary lines the skill prints: status, counts, top components, new / known / gone. */
export function summaryLines(current, { report, coverage }) {
  const open = current.filter((f) => f.status !== 'gone')
  const visual = open.filter((f) => f.layer === 'visual')
  const sev = (s) => visual.filter((f) => f.severity === s).length
  const byComp = new Map()
  for (const f of open) {
    if (!f.component || !f.page) continue
    if (!byComp.has(f.component)) byComp.set(f.component, new Set())
    byComp.get(f.component).add(f.page)
  }
  const top = [...byComp.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0])).slice(0, 5)
    .map(([c, ps]) => `${c} (${[...ps].sort().join(', ')})`)
  const n = (s) => current.filter((f) => f.status === s).length
  return [
    `STYLEQA: summary status: ok; pages: ${coverage.pages.length ? coverage.pages.join(', ') : 'none'}`,
    `STYLEQA: summary measured: ${open.length - visual.length} open; visual: ${visual.length} open (high ${sev('high')}, medium ${sev('medium')}, low ${sev('low')})`,
    `STYLEQA: summary top components: ${top.length ? top.join('; ') : 'none'}`,
    `STYLEQA: summary new ${n('new')}, known ${n('known')}, gone ${n('gone')}; report ${report}`,
  ]
}

export function main(argv) {
  const a = {}
  for (const x of argv) {
    const m = /^--([a-z-]+)=(.*)$/.exec(x)
    if (!m || !['pages', 'out', 'root', 'settings', 'min-confidence'].includes(m[1])) return { code: 1, lines: [`STYLEQA: unknown argument ${x}`] }
    a[m[1]] = m[2]
  }
  const minConfidence = a['min-confidence'] === undefined ? MIN_CONFIDENCE : Number(a['min-confidence'])
  if (!Number.isFinite(minConfidence)) return { code: 1, lines: ['STYLEQA: --min-confidence must be a number'] }
  const root = resolve(a.root ?? join(HERE, '..', '..'))
  const settings = loadSettings(a.settings ? resolve(a.settings) : null)
  const { map, problems } = readPageMap(join(root, PAGE_MAP))
  if (problems.length) return { code: 1, lines: [`STYLEQA: ${PAGE_MAP} refused:`, ...problems.map((p) => `  ${p}`)] }
  const { pages, unknown } = resolvePages(map, (a.pages ?? '').split(',').map((w) => w.trim()).filter(Boolean))
  if (unknown.length) return { code: 1, lines: [`STYLEQA: unknown page ${unknown.join(', ')} — valid pages:`, ...validNames(map).map((n) => `  ${n}`)] }
  const outDir = resolve(root, a.out ?? settings.outDir)
  const runFile = join(outDir, 'run.json')
  if (!existsSync(runFile)) return { code: 1, lines: [`STYLEQA: no ${posix(relative(root, runFile))} — run node scripts/styleqa/run.mjs --layers=static,sweep first`] }
  const run = JSON.parse(readFileSync(runFile, 'utf8'))
  const reviewDir = join(outDir, 'review')
  const screensRel = posix(relative(root, join(outDir, 'screens')))
  const mergedFile = join(reviewDir, 'merged.json')
  const merged = existsSync(mergedFile) ? JSON.parse(readFileSync(mergedFile, 'utf8')) : {}
  const lines = []
  const fresh = []
  const covered = []
  for (const page of pages) {
    const name = `review-${slugPart(page.slug)}.json`
    const file = join(reviewDir, name)
    if (!existsSync(file)) { lines.push(`STYLEQA: merge ${page.slug}: no review file ${name}`); continue }
    const r = readReview(file, page, { screensRel, minConfidence })
    if (r.skip) { lines.push(`skipped ${name}: ${r.skip}`); continue }
    const h = hash(r.findings)
    if (merged[page.slug] === h) { lines.push(`STYLEQA: merge ${page.slug}: unchanged`); continue }
    merged[page.slug] = h
    fresh.push(...r.findings)
    covered.push(page.slug)
    lines.push(`STYLEQA: merge ${page.slug}: ${r.findings.length} visual finding${r.findings.length === 1 ? '' : 's'}${r.dropped.length ? `, ${r.dropped.length} dropped` : ''}`)
  }
  const storeFile = join(outDir, 'known.json')
  const prev = readStore(storeFile)
  const date = run.date ?? prev.updated
  let store = prev
  if (covered.length) {
    const upd = updateStore(prev, { findings: fresh, coverage: { layers: ['visual'], pages: covered, states: null, widths: null } }, { date })
    store = upd.store
    writeStore(storeFile, store)
    writeFileSync(mergedFile, `${JSON.stringify(merged, null, 2)}\n`)
  }
  // The report's list: every open finding and what this run saw go (the measured layers' and the visual one's).
  const order = { new: 0, known: 1, gone: 2 }
  const current = Object.values(store.findings).filter((f) => f.status !== 'gone' || f.goneSince === store.updated)
    .sort((a2, b) => order[a2.status] - order[b.status] || a2.id.localeCompare(b.id))
  const reportFile = join(outDir, 'report.md')
  if (covered.length) writeFileSync(reportFile, renderReport({ date, current, coverage: run.coverage, notes: run.notes ?? [], pages: map.pages, rails: run.rails ?? [], direction: settings.uiDirection }))
  lines.push(...summaryLines(current, { report: posix(relative(root, reportFile)), coverage: run.coverage }))
  return { code: 0, lines }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, lines } = main(process.argv.slice(2))
  for (const l of lines) (code ? console.error : console.log)(l)
  process.exit(code)
}
