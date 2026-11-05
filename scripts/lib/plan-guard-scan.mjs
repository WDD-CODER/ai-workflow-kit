/**
 * The code a plan prescribes, run through the project's commit guards before any builder starts: a plan that asks for a
 * line a guard blocks would be built and then refused at the commit. Pure: callers pass the plan text and the guards.
 *
 * Prescribed code = every fenced code block (except a ```scope block, which holds paths) and every inline code span of
 * the plan's other lines. Prose is never scanned, so "never log the token" parks nothing.
 */

// Sections that describe a plan (the fault it fixes, how it is checked, what it leaves out, what happened) quote code;
// they never tell the builder to write it, so their code is not prescribed.
const DESCRIBING = /^##\s+(Problem Statement|Goals|Out of Scope|Critical Questions|Execution Notes|Step 0|Architecture Impact|Escalation Protocol|Read Scope|Read-Write Scope)\b/i

// A prohibition ending right before a span: "never", "do not call", "don't log", "avoid", "instead of", "without".
// A miss here is no hole: the commit guard itself still blocks the line at the builder's commit.
const NEGATED = /\b(?:never|not|no|don't|dont|avoid|instead of|without|forbid\w*|must not|stop)\b(?:\s+\w+){0,2}\s*[:,]?\s*$/i

/** [{ planLine, code }] — each fenced block as one snippet (its first code line is planLine), each inline span alone;
 *  the describing sections (DESCRIBING) are skipped unless `all` (the db-write listing reads every section). */
export function prescribedSnippets(planText, { all = false } = {}) {
  const lines = String(planText ?? '').replace(/\r\n/g, '\n').split('\n')
  const out = []
  let skip = false
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) skip = !all && DESCRIBING.test(lines[i])
    const fence = /^\s*(`{3,}|~{3,})\s*([\w-]*)/.exec(lines[i])
    if (fence) {
      const close = lines.findIndex((l, j) => j > i && l.trim().startsWith(fence[1]))
      const end = close < 0 ? lines.length : close
      if (!skip && fence[2] !== 'scope') out.push({ planLine: i + 2, code: lines.slice(i + 1, end).join('\n') })
      i = end
      continue
    }
    if (skip) continue
    // An inline span prescribes only when it is a statement (a call or an assignment) on a line that does not forbid it
    // ("never bind `[innerHTML]`", "do not `console.log(token)`"); a fenced block always prescribes.
    for (const m of lines[i].matchAll(/`([^`\n]+)`/g)) {
      if (all) {
        out.push({ planLine: i + 1, code: m[1] })
        continue
      }
      // the few words right before the span: a prohibition there ("never call `x()`") makes it a quote, not a step
      const before = lines[i].slice(Math.max(0, m.index - 40), m.index).replace(/`[^`\n]*`/g, ' ')
      if (/[(=]/.test(m[1]) && !NEGATED.test(before)) out.push({ planLine: i + 1, code: m[1] })
    }
  }
  return out
}

/**
 * The guard hits of a plan's prescribed code: [{ planLine, guard, ruleLine, rule, text }]. `guards` is a list of
 * { name, scan } with scan(text, file) → [{ line, rule, ruleLine, text }] (a guard's scanGuardText).
 */
export function planGuardHits(planText, guards) {
  const hits = []
  for (const s of prescribedSnippets(planText)) {
    for (const g of guards ?? []) {
      let found = []
      try {
        found = g.scan(s.code, 'plan') ?? []
      } catch {
        found = []
      }
      for (const h of found) hits.push({ planLine: s.planLine + (h.line ?? 1) - 1, guard: g.name, ruleLine: h.ruleLine ?? 0, rule: h.rule, text: h.text })
    }
  }
  return hits
}

/** One park reason line for a hit: names the guard, the rule and its line, and the plan line it came from. */
export function guardParkReason(h) {
  return `guard ${h.guard} line ${h.ruleLine}: ${h.rule} — plan line ${h.planLine}: ${String(h.text).slice(0, 120)}`
}
