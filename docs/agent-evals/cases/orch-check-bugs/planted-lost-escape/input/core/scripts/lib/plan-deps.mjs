/**
 * Plan dependencies — the one reading of what a plan needs first. Shared by plan-order.mjs, scope-check.mjs (--deps)
 * and take-plan.mjs, so every tool agrees on the same edges.
 *
 * A plan declares its dependencies in a header line (next to Status: and Snapshot:):
 *   Depends-on: 007, 012        (plan numbers; "#7", "plan 7" and "plans 7, 12" are read too)
 *   Depends-on: none            (declared: the plan needs nothing first)
 * Older plans said it in prose only; that is still read, so they need no edit:
 *   - Prerequisite: plan NNN merged / Prerequisites: plans NNN, MMM (…)   (numbers before the first ( — . or ;)
 *   - "must run after plan 7", "until plan 7 is done|merged|shipped|complete"
 *
 * Plain functions over plan text: no file system, no git, no packages.
 */

export const pad = (n) => String(n).padStart(3, '0')

/** The plan number of a path like plans/011-x.plan.md (or a bare "11" / "011"), padded to 3 digits; null otherwise. */
export function planNumber(pathOrNumber) {
  const s = String(pathOrNumber).replace(/\\/g, '/')
  if (/^\d+$/.test(s)) return pad(s)
  const m = s.match(/(?:^|\/)(\d+)-[^/]*\.plan\.md$/)
  return m ? pad(m[1]) : null
}

/** The human title from the H1 "# Plan NNN — Title" (also "-" or ":"); the whole H1 when it has no separator. */
export function planTitle(text) {
  const h1 = (String(text).match(/^# (.+)$/m) || [])[1]
  if (!h1) return ''
  const m = h1.match(/^Plan\s+[\w-]+\s*[—–:-]\s*(.+)$/)
  return (m ? m[1] : h1).trim()
}

const numbersIn = (s) => [...String(s).matchAll(/#?\b(\d{1,4})\b/g)].map((m) => pad(m[1]))

/**
 * The Depends-on: header line: null when the plan has none, [] for "none", else the padded plan numbers.
 * Only the first such line counts; "**Depends-on:**" (bold) is read the same.
 */
export function parseDependsOn(text) {
  const m = String(text).match(/^\**Depends-on:\**[ \t]*([^\r\n]*)$/im)
  if (!m) return null
  const value = m[1].trim()
  if (!value || /^(none|-|—|n\/a)\b/i.test(value)) return []
  return [...new Set(numbersIn(value.split(/[(;]/)[0]))]
}

/** Plan numbers named only in prose (legacy plans): "Prerequisite: plan NNN merged", "must run after plan 7", … */
export function parseProsePrerequisites(text) {
  const found = new Set()
  for (const m of String(text).matchAll(/\b(?:must\s+)?runs?\s+after\s+plans?\s+#?(\d{1,4})\b|\buntil\s+(?:plan\s+)?#?(\d{1,4})\s+(?:is\s+)?(?:done|merged|shipped|complete)/gi)) {
    found.add(pad(m[1] || m[2]))
  }
  // "Prerequisite: plan NNN merged" / "Prerequisites: plans NNN, MMM (…)": every plan number before the first ( — . or ;
  for (const m of String(text).matchAll(/^\s*[-*]?\s*\**Prerequisites?\**:\**\s*([^\n(—.;]*)/gim)) {
    if (!/\bplans?\b/i.test(m[1])) continue
    for (const n of numbersIn(m[1])) found.add(n)
  }
  return [...found]
}

/**
 * Every dependency of a plan, with the reason it is one: [{ nnn, reason: 'Depends-on:' | 'prose prerequisite' }].
 * declared = the plan has a Depends-on: line. The plan's own number (self) is never its own dependency.
 */
export function planDependencies(text, self = null) {
  const declared = parseDependsOn(text)
  const deps = new Map()
  for (const n of declared || []) deps.set(n, 'Depends-on:')
  for (const n of parseProsePrerequisites(text)) if (!deps.has(n)) deps.set(n, 'prose prerequisite')
  if (self) deps.delete(pad(self))
  return { declared: declared !== null, deps: [...deps].map(([nnn, reason]) => ({ nnn, reason })) }
}

/** "done", "closed", "superseded", … in the plan's Status: line — the plan was finished one way or another. */
export function isFinishedStatus(text) {
  return /^Status:\s*(superseded|done|closed|complete|abandoned)\b/im.test(String(text))
}

/** Open / done counts of the plan's "## Atomic Sub-tasks" checkboxes. */
export function atomicStats(text) {
  const sec = (String(text).match(/^## Atomic Sub-tasks[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m) || [])[1] || ''
  return { open: (sec.match(/^\s*- \[ \]/gm) || []).length, done: (sec.match(/^\s*- \[x\]/gim) || []).length }
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '$&')

/**
 * The only commit subject that marks a plan merged into an integration branch:
 *   Merge <source-branch> into <branch> (plan NNN)
 * anchored at both ends, so "plan NNN" anywhere else in a subject, or "(plan NNN0)", never counts.
 */
export function mergeSubjectRe(branch) {
  return new RegExp(`^Merge \\S+ into ${escapeRe(branch)} \\(plan (\\d+)\\)$`)
}

/** The plan numbers (as written, e.g. "011") that commit subjects mark merged into branch. */
export function mergedPlansFromSubjects(subjects, branch) {
  const re = mergeSubjectRe(branch)
  const out = new Set()
  for (const s of subjects) {
    const m = String(s).replace(/\r$/, '').match(re)
    if (m) out.add(m[1])
  }
  return out
}
