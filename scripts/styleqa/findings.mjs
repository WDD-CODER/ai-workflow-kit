/**
 * Style QA finding store — stable IDs and new / known / gone across runs.
 *
 * A finding: { layer, check, page, state, locator, widths: [], component?, file?, line?, selector?, message, … }.
 * Its fingerprint is layer + check + page + state + locator — never a line number, a width or a timestamp — so an
 * unrelated edit (a line moved, a width added) keeps the ID. A static finding's locator is file + selector + property.
 * The same finding seen at several widths is one finding with every width in `widths`.
 *
 * The store is <outDir>/known.json: { version: 1, updated, findings: { <id>: { …finding, status, firstSeen, lastSeen } } }.
 * A run updates only what it covered (its layers, pages, states and widths): a finding the run covered and did not see
 * again is `gone`; everything else keeps its record, so a run on one page leaves the other pages untouched.
 *
 *   import { findingId, collapse, readStore, updateStore, writeStore } from './findings.mjs'
 *
 * Node built-ins only; no placeholders (tools import it).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { createHash } from 'crypto'
import { deepRedact } from './redact.mjs'

export const STATUSES = ['new', 'known', 'gone']

/** The fingerprint fields, in order. */
const KEY = (f) => [f.layer, f.check, f.page ?? '', f.state ?? '', f.locator].join('\n')

/** The stable ID: `<check>-<8 hex of the fingerprint>`, e.g. S2-3f9a01bc. */
export function findingId(f) {
  return `${f.check}-${createHash('sha256').update(KEY(f)).digest('hex').slice(0, 8)}`
}

const sortWidths = (ws) => [...new Set(ws.map(Number))].sort((a, b) => a - b)

/** One finding per ID; the widths of every copy joined. Each finding gets its `id`. */
export function collapse(findings) {
  const byId = new Map()
  for (const f of findings) {
    const id = findingId(f)
    const prev = byId.get(id)
    if (prev) prev.widths = sortWidths([...prev.widths, ...(f.widths ?? [])])
    else byId.set(id, { ...f, id, widths: sortWidths(f.widths ?? []) })
  }
  return [...byId.values()]
}

/** The store in a file, or an empty one. */
export function readStore(file) {
  if (!existsSync(file)) return { version: 1, updated: null, findings: {} }
  const s = JSON.parse(readFileSync(file, 'utf8'))
  return { version: 1, updated: s.updated ?? null, findings: s.findings ?? {} }
}

export function writeStore(file, store) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`)
}

/**
 * True when a run with this coverage looked where the finding lives. coverage: { layers: [], pages: [], states:
 * null | [], widths: null | [] } — null = all. A static finding (no page) is covered whenever the static layer ran.
 */
export function covers(coverage, f) {
  if (!coverage.layers.includes(f.layer)) return false
  if (f.page && !coverage.pages.includes(f.page)) return false
  if (coverage.states && f.state && !coverage.states.includes(f.state)) return false
  if (coverage.widths && f.widths?.length && !f.widths.some((w) => coverage.widths.includes(w))) return false
  return true
}

/**
 * The store after a run: { store, current } — current is every open finding with its status after this run plus the
 * ones this run saw go (new, known, then gone); the store keeps every record. Every string is redacted before it is kept.
 */
export function updateStore(prev, run, { date }) {
  const findings = { ...prev.findings }
  const seen = new Set()
  for (const f of collapse(run.findings).map(deepRedact)) {
    seen.add(f.id)
    const old = findings[f.id]
    const status = old && old.status !== 'gone' ? 'known' : 'new'
    // Widths this run did not cover keep their earlier sightings.
    const kept = (old?.widths ?? []).filter((w) => run.coverage.widths && !run.coverage.widths.includes(w))
    findings[f.id] = { ...f, widths: sortWidths([...f.widths, ...kept]), status, firstSeen: old && old.status !== 'gone' ? old.firstSeen : date, lastSeen: date }
  }
  const goneNow = new Set()
  for (const [id, f] of Object.entries(findings)) {
    if (seen.has(id) || f.status === 'gone' || !covers(run.coverage, f)) continue
    findings[id] = { ...f, status: 'gone', goneSince: date }
    goneNow.add(id)
  }
  const order = { new: 0, known: 1, gone: 2 }
  // The report's list: every open finding (other pages' too, as the last run left them) and what this run saw go.
  const current = Object.values(findings).filter((f) => f.status !== 'gone' || goneNow.has(f.id))
    .sort((a, b) => order[a.status] - order[b.status] || a.id.localeCompare(b.id))
  return { store: { version: 1, updated: date, findings }, current }
}
