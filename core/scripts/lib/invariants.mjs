/**
 * Architecture invariants — the one reading of docs/brain/invariants.md and of a plan's
 * "## Architecture Impact" section, plus the pure checks behind scope-check.mjs --arch
 * (and take-plan.mjs's pre-claim gate). Shared by both; no I/O here.
 *
 * Registry shape (per invariant, up to the next "## " heading):
 *   ## INV-n — <title>
 *   - Rule: …  - Source: …  - Touches: `glob`, `glob`  - Users lose if broken: …  - Test: …
 * plus one header line "Enforced from plan: NNN".
 *
 * Plan entry shapes (one bullet per invariant under "## Architecture Impact"):
 *   - INV-n: preserves — <how>
 *   - INV-n: deviation until <plan/phase> — users lose: <…> — Arch-approved: Human YYYY-MM-DD
 *   - INV-n: changes — ADR docs/brain/decisions/NNNN-<slug>.md — Arch-approved: Human YYYY-MM-DD
 *   - INV-none: preserves — <why>
 */
import picomatch from 'picomatch'

const SECTION_RE = (heading) => new RegExp(`^## ${heading}[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm')

function field(body, name) {
  const m = body.match(new RegExp(`^-\\s*${name}:\\s*(.*)$`, 'm'))
  return m ? m[1].trim() : null
}

/** Parses the registry text. Returns { enforcedFrom: number|null, invariants: [{ id, title, rule, source, touches, usersLose, test }] }. */
export function parseInvariants(text) {
  const enforced = text.match(/^Enforced from plan:\s*(\d+)/m)
  const invariants = []
  for (const m of text.matchAll(/^## (INV-\d+)\s*[—-]\s*([^\n]*)\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)) {
    const body = m[3]
    const touches = [...(field(body, 'Touches') || '').matchAll(/`([^`]+)`/g)].map((t) => t[1])
    invariants.push({
      id: m[1],
      title: m[2].trim(),
      rule: field(body, 'Rule'),
      source: field(body, 'Source'),
      touches,
      usersLose: field(body, 'Users lose if broken'),
      test: field(body, 'Test')
    })
  }
  return { enforcedFrom: enforced ? Number(enforced[1]) : null, invariants }
}

/** Parses a plan's "## Architecture Impact". Returns { present, entries: [{ id, kind, approved, adr, raw }] }. */
export function parseArchImpact(planText) {
  const section = planText.match(SECTION_RE('Architecture Impact'))
  if (!section) return { present: false, entries: [] }
  const entries = []
  for (const line of section[1].split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s*(INV-(?:\d+|none))\s*:\s*(preserves|deviation|changes)?\b(.*)$/i)
    if (!m) continue
    const adr = (line.match(/docs\/brain\/decisions\/\d{4}-[^\s`)]+\.md/) || [])[0] || null
    entries.push({
      id: m[1].toUpperCase().replace('INV-NONE', 'INV-none'),
      kind: m[2] ? m[2].toLowerCase() : null,
      approved: /Arch-approved:\s*Human\b/.test(line),
      adr,
      raw: line.trim()
    })
  }
  return { present: true, entries }
}

/** The plan number from a path like plans/387-slug.plan.md, or null (fixtures, unnumbered drafts). */
export function planNumber(planPath) {
  const m = String(planPath).replace(/\\/g, '/').match(/(?:^|\/)(\d{1,4})-[^/]*\.plan\.md$/)
  return m ? Number(m[1]) : null
}

/**
 * Invariants a set of plan scope globs touches: a tracked file matches both a scope glob and
 * a Touches glob, or either glob matches the other's literal path (files that don't exist yet).
 */
export function affectedInvariants(scopeGlobs, invariants, trackedFiles) {
  const inScope = picomatch(scopeGlobs, { dot: true })
  const hits = []
  for (const inv of invariants) {
    if (!inv.touches.length) continue
    const touched = picomatch(inv.touches, { dot: true })
    const viaFile = trackedFiles.some((f) => inScope(f) && touched(f))
    const viaLiteral = scopeGlobs.some((g) => touched(g)) || inv.touches.some((t) => inScope(t))
    if (viaFile || viaLiteral) hits.push(inv)
  }
  return hits
}

/**
 * The --arch --plan gate. Returns { ok, lines } — lines are printed as-is.
 * Below "Enforced from plan:" a plan without the section is grandfathered (skipped);
 * a plan that has the section is always checked.
 */
export function checkPlanArch({ planPath, planText, scopeGlobs, registry, trackedFiles, adrExists }) {
  const impact = parseArchImpact(planText)
  const num = planNumber(planPath)
  if (!impact.present && num !== null && registry.enforcedFrom !== null && num < registry.enforcedFrom) {
    return { ok: true, lines: ['ARCH: skipped (grandfathered)'] }
  }

  const affected = affectedInvariants(scopeGlobs, registry.invariants, trackedFiles)
  const byId = new Map(impact.entries.map((e) => [e.id, e]))
  const inScope = picomatch(scopeGlobs, { dot: true })
  const problems = []

  if (!impact.present && !affected.length) problems.push('ARCH: missing section "## Architecture Impact" (use "- INV-none: preserves — <why>")')
  for (const inv of affected) {
    if (!byId.has(inv.id)) problems.push(`ARCH: missing ${inv.id} (${inv.title}) — this plan's scope overlaps its Touches: ${inv.touches.join(', ')}`)
  }
  for (const e of impact.entries) {
    if (e.kind === null) problems.push(`ARCH: unreadable ${e.id} — use "preserves", "deviation until …" or "changes — ADR …": ${e.raw}`)
    if ((e.kind === 'deviation' || e.kind === 'changes') && !e.approved) problems.push(`ARCH: unapproved ${e.id} — a ${e.kind} needs "Arch-approved: Human YYYY-MM-DD" (only after the Human says "approve arch change ${e.id}")`)
    if (e.kind === 'changes' && (!e.adr || !(adrExists(e.adr) || inScope(e.adr)))) problems.push(`ARCH: bad-adr ${e.id} — ${e.adr || 'no ADR path'} neither exists nor is in this plan's scope`)
  }

  if (problems.length) return { ok: false, lines: problems }
  const ids = impact.entries.map((e) => e.id)
  return { ok: true, lines: [`ARCH: ok ${ids.length ? ids.join(', ') : 'INV-none'}`] }
}

/** --arch --diff warnings for changed files: an invariant touched with no entry in the active plan. */
export function diffArchWarnings({ changedFiles, registry, planText }) {
  const entries = planText ? new Set(parseArchImpact(planText).entries.map((e) => e.id)) : new Set()
  const lines = []
  for (const inv of registry.invariants) {
    if (entries.has(inv.id) || !inv.touches.length) continue
    const touched = picomatch(inv.touches, { dot: true })
    for (const f of changedFiles) if (touched(f)) lines.push(`ARCH: warn ${inv.id} ${f}`)
  }
  return lines
}

const DECISION_FILE_RE = /^docs\/session-state[^/]*\.md$|^plans\/[^/]+\.plan\.md$/

/** "Human decision" lines added to session-state / plan files with no INV-n and no ADR reference. */
export function decisionWithoutAdr(addedLines) {
  return addedLines
    .filter(({ file, text }) => DECISION_FILE_RE.test(file) && /Human decision/i.test(text) && !/INV-\d/.test(text) && !/decisions\/\d{4}/.test(text))
    .map(({ file, line }) => `ARCH: warn decision-without-adr ${file}:${line}`)
}

/** Added lines from a `git diff -U0` output: [{ file, line, text }]. */
export function parseAddedLines(diffText) {
  const out = []
  let file = null
  let next = 0
  for (const l of diffText.split(/\r?\n/)) {
    if (l.startsWith('+++ ')) { file = l.startsWith('+++ b/') ? l.slice(6) : null; continue }
    const hunk = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) { next = Number(hunk[1]); continue }
    if (file && l.startsWith('+')) out.push({ file, line: next++, text: l.slice(1) })
  }
  return out
}
