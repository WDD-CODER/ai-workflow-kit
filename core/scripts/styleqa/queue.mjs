/**
 * Style QA review queue — which screenshots a model reviewer reads, bounded.
 *
 *   node scripts/styleqa/queue.mjs [--pages=<word,…>] [--out=<folder>] [--root=<folder>] [--settings=<file>]
 *
 * Per page, from the sweep's screenshots (<out>/screens/<page>-<state>-<width>-<segment>.png):
 *   - every segment at the smallest and the largest width, for every state, is queued;
 *   - a middle width is queued for a state only when the finding store holds an S2 or S3 finding for that state and width;
 *   - at most 24 images per page: the rest are listed as `skipped` (the summary line says how many);
 *   - each entry carries the measured findings already recorded for its shot (so the reviewer skips what is known).
 * Writes <out>/review/queue-<slug>.json: { page, title, reviewFile, limit, entries: [{ shot, state, width, segment,
 * measured: [{ id, check, message }] }], skipped: [shot…] }. The reviewer writes <out>/review/review-<slug>.json.
 * Exit 0 = queues written (or no screenshots); 1 = a bad argument or page map. Node built-ins only.
 */
import { readdirSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { resolve, join, dirname, relative } from 'path'
import { fileURLToPath } from 'url'
import { loadSettings, PAGE_MAP } from './config.mjs'
import { readPageMap, resolvePages, validNames, sweepStatesOf } from './pages.mjs'
import { readStore } from './findings.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const MAX_IMAGES = 24
export const MIDDLE_CHECKS = ['S2', 'S3']
export const slugPart = (s) => String(s).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'x'
const posix = (p) => p.replace(/\\/g, '/')

/** The screenshots of a page, as { file, state, width, segment }; the state is matched through the page's state names. */
export function pageShots(files, page) {
  const out = []
  const states = sweepStatesOf(page)
  for (const file of files) {
    const m = /^(.*)-(\d+)-(\d+)\.png$/.exec(file)
    if (!m) continue
    for (const state of states) {
      if (m[1] === `${slugPart(page.slug)}-${slugPart(state)}`) { out.push({ file, state, width: Number(m[2]), segment: Number(m[3]) }); break }
    }
  }
  return out
}

/**
 * The queue of one page. shots: pageShots(); findings: the store's findings (any page). → { entries, skipped }.
 * Order: required shots (smallest and largest width) by state, width, segment; then the middle widths that earned a look.
 */
export function buildQueue({ page, shots, findings, screensDir, limit = MAX_IMAGES }) {
  const mine = Object.values(findings).filter((f) => f.page === page.slug && f.status !== 'gone')
  const byState = new Map()
  for (const s of shots) {
    if (!byState.has(s.state)) byState.set(s.state, [])
    byState.get(s.state).push(s)
  }
  const states = sweepStatesOf(page).filter((n) => byState.has(n))
  const required = []
  const middle = []
  for (const state of states) {
    const all = byState.get(state)
    const widths = [...new Set(all.map((s) => s.width))].sort((a, b) => a - b)
    const edge = new Set([widths[0], widths[widths.length - 1]])
    for (const s of all.sort((a, b) => a.width - b.width || a.segment - b.segment)) {
      if (edge.has(s.width)) required.push(s)
      else if (mine.some((f) => MIDDLE_CHECKS.includes(f.check) && f.state === state && (f.widths ?? []).includes(s.width))) middle.push(s)
    }
  }
  const ordered = [...required, ...middle]
  const entry = (s) => {
    const shot = posix(join(screensDir, s.file))
    return {
      shot, state: s.state, width: s.width, segment: s.segment,
      measured: mine.filter((f) => (f.screenshots ?? []).includes(shot)).map((f) => ({ id: f.id, check: f.check, message: f.message })),
    }
  }
  return { entries: ordered.slice(0, limit).map(entry), skipped: ordered.slice(limit).map((s) => posix(join(screensDir, s.file))) }
}

export function main(argv) {
  const a = {}
  for (const x of argv) {
    const m = /^--([a-z]+)=(.*)$/.exec(x)
    if (!m || !['pages', 'out', 'root', 'settings'].includes(m[1])) return { code: 1, lines: [`STYLEQA: unknown argument ${x}`] }
    a[m[1]] = m[2]
  }
  const root = resolve(a.root ?? join(HERE, '..', '..'))
  const settings = loadSettings(a.settings ? resolve(a.settings) : null)
  const { map, problems } = readPageMap(join(root, PAGE_MAP))
  if (problems.length) return { code: 1, lines: [`STYLEQA: ${PAGE_MAP} refused:`, ...problems.map((p) => `  ${p}`)] }
  const { pages, unknown } = resolvePages(map, (a.pages ?? '').split(',').map((w) => w.trim()).filter(Boolean))
  if (unknown.length) return { code: 1, lines: [`STYLEQA: unknown page ${unknown.join(', ')} — valid pages:`, ...validNames(map).map((n) => `  ${n}`)] }
  const outDir = resolve(root, a.out ?? settings.outDir)
  const screens = join(outDir, 'screens')
  const files = existsSync(screens) ? readdirSync(screens) : []
  const storeFile = join(outDir, 'known.json')
  const findings = existsSync(storeFile) ? readStore(storeFile).findings : {}
  const reviewDir = join(outDir, 'review')
  mkdirSync(reviewDir, { recursive: true })
  const lines = []
  for (const page of pages) {
    const shots = pageShots(files, page)
    if (!shots.length) { lines.push(`STYLEQA: queue ${page.slug}: no screenshots — run the sweep layer first`); continue }
    const { entries, skipped } = buildQueue({ page, shots, findings, screensDir: relative(root, screens) })
    const queueFile = join(reviewDir, `queue-${slugPart(page.slug)}.json`)
    const reviewFile = join(reviewDir, `review-${slugPart(page.slug)}.json`)
    writeFileSync(queueFile, `${JSON.stringify({ page: page.slug, title: page.title ?? page.slug, reviewFile: posix(relative(root, reviewFile)), limit: MAX_IMAGES, entries, skipped }, null, 2)}\n`)
    lines.push(`STYLEQA: queue ${page.slug}: ${entries.length} image${entries.length === 1 ? '' : 's'}${skipped.length ? `, ${skipped.length} skipped (over ${MAX_IMAGES})` : ''} — ${posix(relative(root, queueFile))}`)
  }
  return { code: 0, lines }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, lines } = main(process.argv.slice(2))
  for (const l of lines) (code ? console.error : console.log)(l)
  process.exit(code)
}
