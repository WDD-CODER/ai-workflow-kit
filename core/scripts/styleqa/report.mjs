/**
 * Style QA report — one Markdown file ordered for fixing:
 *
 *   status and coverage lines · Summary · Shared components — fix once · Per page · Rails · Static findings by file
 *
 * A component seen on two or more pages is listed once under "Shared components — fix once" with every page, so it is
 * fixed once. The Rails table is filled by the sweep layer (rails: [{ page, state, width, side, expected, measured }]).
 * Every value passes redact() — no token or credential reaches the report.
 *
 *   import { renderReport, SECTIONS } from './report.mjs'
 *
 * Node built-ins only; no placeholders (tools import it).
 */
import { redact } from './redact.mjs'

export const SECTIONS = ['Summary', 'Shared components — fix once', 'Per page', 'Rails', 'Static findings by file']

/** A table cell: redacted, one line, pipes escaped. */
const cell = (v) => redact(Array.isArray(v) ? v.join(', ') : String(v ?? '')).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')
const row = (cells) => `| ${cells.map(cell).join(' | ')} |`
const table = (head, rows) => [row(head), `|${head.map(() => ' --- |').join('')}`, ...rows.map(row)]

/** The edge words for a UI direction: ltr → left / right, rtl → right / left. */
export function edges(direction) {
  return direction === 'rtl' ? { start: 'right', end: 'left' } : { start: 'left', end: 'right' }
}

/**
 * The report text. current: the findings with their status (findings.mjs updateStore); coverage: { layers, pages,
 * states, widths }; notes: lines such as "S2/S3 off: …"; pages: the page map's pages (titles); rails: sweep rows.
 */
export function renderReport({ date, current, coverage, notes = [], pages = [], rails = [], direction = '', failed = '' }) {
  const open = current.filter((f) => f.status !== 'gone')
  const count = (st, list = current) => list.filter((f) => f.status === st).length
  const out = [`# Style QA report — ${cell(date)}`, '']
  if (failed) out.push(`Status: failed — ${cell(failed)}`)
  else out.push(`Status: ${open.length} open (${count('new')} new, ${count('known')} known), ${count('gone')} gone this run.`)
  const all = (v) => (v ? v.join(', ') : 'all')
  out.push(`Coverage: layers ${all(coverage.layers)}; pages ${coverage.pages.length ? coverage.pages.join(', ') : 'none'}; states ${all(coverage.states)}; widths ${all(coverage.widths)}.`)
  for (const s of coverage.skipped ?? []) out.push(`Skipped: ${cell(s)}`)
  if (coverage.truncated?.length) out.push(`Truncated: ${cell(coverage.truncated.join('; '))} (the page is taller than ${4} viewport-high screenshots)`)
  if (direction === 'rtl' || direction === 'ltr') {
    const e = edges(direction)
    out.push(`Direction: ${direction} — inline-start is the ${e.start} edge, inline-end the ${e.end} edge.`)
  }
  for (const n of notes) out.push(cell(n))
  out.push('')

  out.push(`## ${SECTIONS[0]}`, '')
  const checks = [...new Set(current.map((f) => f.check))].sort()
  if (!checks.length) out.push('No findings.')
  else out.push(...table(['Check', 'New', 'Known', 'Gone'], checks.map((c) => {
    const of = current.filter((f) => f.check === c)
    return [c, count('new', of), count('known', of), count('gone', of)]
  })))
  out.push('')

  out.push(`## ${SECTIONS[1]}`, '')
  const byComponent = new Map()
  for (const f of open) {
    if (!f.component || !f.page) continue
    if (!byComponent.has(f.component)) byComponent.set(f.component, [])
    byComponent.get(f.component).push(f)
  }
  const shared = [...byComponent.entries()].map(([c, fs]) => [c, fs, [...new Set(fs.map((f) => f.page))].sort()]).filter(([, , ps]) => ps.length >= 2)
    .sort((a, b) => b[2].length - a[2].length || a[0].localeCompare(b[0]))
  if (!shared.length) out.push('No component has findings on more than one page.')
  else out.push(...table(['Component', 'Pages', 'Findings'], shared.map(([c, fs, ps]) => [c, ps, fs.map((f) => f.id)])))
  out.push('')

  out.push(`## ${SECTIONS[2]}`, '')
  const paged = current.filter((f) => f.page)
  const titles = new Map(pages.map((p) => [p.slug, p.title]))
  const slugs = [...new Set(paged.map((f) => f.page))].sort()
  if (!slugs.length) out.push('No page findings (the sweep and visual layers fill this section).')
  for (const slug of slugs) {
    out.push(`### ${cell(slug)}${titles.has(slug) ? ` — ${cell(titles.get(slug))}` : ''}`, '')
    const mine = paged.filter((f) => f.page === slug)
    const shots = mine.some((f) => f.screenshots?.length)
    out.push(...table(['ID', 'Status', 'Check', 'State', 'Widths', 'Component', 'What', ...(shots ? ['Screenshots'] : [])], mine
      .map((f) => [f.id, f.status, f.check, f.state, f.widths, f.source && f.source !== 'unknown' ? `${f.component ?? ''} (${f.source})` : f.component ?? '', f.message, ...(shots ? [f.screenshots ?? []] : [])])), '')
  }
  if (!slugs.length) out.push('')

  out.push(`## ${SECTIONS[3]}`, '')
  if (!rails.length) out.push('No rails measured (the sweep layer fills this table).')
  else out.push(...table(['Page', 'State', 'Width', 'Edge', 'Expected', 'Measured'], rails.map((r) => [r.page, r.state, r.width, r.side, r.expected, r.measured])))
  out.push('')

  out.push(`## ${SECTIONS[4]}`, '')
  const stat = current.filter((f) => f.layer === 'static')
  const files = [...new Set(stat.map((f) => f.file))].sort()
  if (!files.length) out.push('No static findings.')
  for (const file of files) {
    out.push(`### ${cell(file)}`, '')
    out.push(...table(['ID', 'Status', 'Check', 'Line', 'Selector', 'What'], stat.filter((f) => f.file === file)
      .sort((a, b) => (a.line ?? 0) - (b.line ?? 0)).map((f) => [f.id, f.status, f.check, f.line, f.selector, f.message])), '')
  }
  return `${out.join('\n').trimEnd()}\n`
}
