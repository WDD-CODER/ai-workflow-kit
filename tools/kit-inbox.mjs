/**
 * Kit inbox — lists feedback/inbox/ grouped by slug similarity and prints one draft plan block per group that the kit's
 * Planner can paste into `/plan`. Kit-only: tools/ is never installed into a project. Prints drafts; creates no plan.
 *
 *   node tools/kit-inbox.mjs [--inbox <folder>] [--min 0.6]
 *
 * An entry is feedback/inbox/<date>-<slug>.md (written by scripts/kit-feedback.mjs). Two entries are one group when
 * their slug words overlap by at least --min (the same stemmed-word overlap plan-name-similarity.mjs scores plan titles
 * with). An entry with `seen-in: 2` or more (the same lesson from several projects) makes its group a priority and sorts
 * first. Node built-ins only. Exit 0 always (an empty inbox prints `KIT_INBOX: empty`).
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const STOP = new Set('a an the and or of to in on for is it its with as at by be so that this not no from into'.split(' '))

// Crude on purpose, like plan-name-similarity.mjs: plural and -ing/-ed endings go, both sides are stemmed the same way.
function stem(word) {
  let s = word
  if (s.length <= 3) return s
  if (s.length > 4 && s.endsWith('ies')) s = `${s.slice(0, -3)}y`
  else if (s.length > 3 && s.endsWith('s') && !/(?:ss|us|is)$/.test(s)) s = s.slice(0, -1)
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3)
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2)
  if (s.length > 4 && s.endsWith('e')) s = s.slice(0, -1)
  return s
}
export const slugTokens = (slug) => [...new Set(String(slug).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2 && !STOP.has(t)).map(stem))]
const overlap = (a, b) => (a.length && b.length ? a.filter((t) => b.includes(t)).length / Math.min(a.length, b.length) : 0)

/** { file, slug, title, seenIn, summary } of one inbox entry; null for a file that is not an entry. */
export function parseEntry(file, text) {
  const m = /^\d{4}-\d{2}-\d{2}-(.+)\.md$/.exec(file)
  if (!m) return null
  const lines = String(text).replace(/\r\n/g, '\n').split('\n')
  const title = (lines.find((l) => /^#\s+/.test(l)) ?? `# ${m[1]}`).replace(/^#\s+/, '').trim()
  const seen = /^seen-in:[ \t]*(\d+)[ \t]*$/m.exec(text)
  const body = lines.filter((l) => l.trim() && !/^#\s/.test(l) && !/^seen-in:/.test(l) && !/^Sent \d{4}/.test(l))
  return { file, slug: m[1], title, seenIn: seen ? Number(seen[1]) : 1, summary: (body[0] ?? '').trim().slice(0, 300) }
}

/** Groups of entries whose slug words overlap by at least `min`; priority groups (seen-in 2 or more) first. */
export function groupInbox(entries, { min = 0.6 } = {}) {
  const groups = []
  for (const e of entries) {
    const tokens = slugTokens(e.slug)
    const g = groups.find((x) => overlap(tokens, x.tokens) >= min)
    if (g) {
      g.entries.push(e)
      g.tokens = [...new Set([...g.tokens, ...tokens])]
    } else groups.push({ tokens, entries: [e] })
  }
  return groups.map((g) => ({ ...g, seenIn: g.entries.reduce((a, e) => a + (e.seenIn > 1 ? e.seenIn : 1), 0), priority: g.entries.some((e) => e.seenIn >= 2) || g.entries.length >= 2 }))
    .sort((a, b) => Number(b.priority) - Number(a.priority) || b.seenIn - a.seenIn || (a.entries[0].file < b.entries[0].file ? -1 : 1))
}

/** The draft plan block of one group, to paste into `/plan`. */
export function draftBlock(group, n) {
  const first = group.entries[0]
  return [
    `GROUP ${n}${group.priority ? ' [priority]' : ''} — ${first.title} (${group.entries.length} entr${group.entries.length === 1 ? 'y' : 'ies'}, seen-in ${group.seenIn})`,
    '--- draft plan block (paste into /plan) ---',
    `Goal: ${first.title}`,
    '',
    '## Problem Statement',
    ...group.entries.map((e) => `- ${e.summary || e.title} (feedback/inbox/${e.file}${e.seenIn > 1 ? `, seen-in: ${e.seenIn}` : ''})`),
    '',
    '## Source',
    ...group.entries.map((e) => `- feedback/inbox/${e.file} — delete it when the plan is done or the entry is dismissed`),
    '--- end ---',
  ].join('\n')
}

function main(argv) {
  const flag = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d)
  const kit = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const inbox = resolve(flag('inbox', join(kit, 'feedback', 'inbox')))
  const min = Number(flag('min', 0.6))
  const entries = (existsSync(inbox) ? readdirSync(inbox).sort() : []).map((f) => parseEntry(f, readFileSync(join(inbox, f), 'utf8'))).filter(Boolean)
  if (!entries.length) {
    process.stdout.write('KIT_INBOX: empty\n')
    return
  }
  const groups = groupInbox(entries, { min })
  process.stdout.write(`KIT_INBOX: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} in ${groups.length} group(s); a group with seen-in 2 or more (or two entries) is a priority\n\n${groups.map((g, i) => draftBlock(g, i + 1)).join('\n\n')}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
