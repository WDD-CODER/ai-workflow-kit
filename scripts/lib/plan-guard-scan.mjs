/**
 * The code a plan prescribes, run through the project's commit guards before any builder starts: a plan that asks for a
 * line a guard blocks would be built and then refused at the commit. Pure: callers pass the plan text and the guards.
 *
 * Prescribed code = every fenced code block (except a ```scope block, which holds paths) and every inline code span of
 * the plan's other lines. Prose is never scanned, so "never log the token" parks nothing.
 */

/** [{ planLine, code }] — each fenced block as one snippet (its first code line is planLine), each inline span alone. */
export function prescribedSnippets(planText) {
  const lines = String(planText ?? '').replace(/\r\n/g, '\n').split('\n')
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const fence = /^\s*(`{3,}|~{3,})\s*([\w-]*)/.exec(lines[i])
    if (fence) {
      const close = lines.findIndex((l, j) => j > i && l.trim().startsWith(fence[1]))
      const end = close < 0 ? lines.length : close
      if (fence[2] !== 'scope') out.push({ planLine: i + 2, code: lines.slice(i + 1, end).join('\n') })
      i = end
      continue
    }
    for (const m of lines[i].matchAll(/`([^`\n]+)`/g)) out.push({ planLine: i + 1, code: m[1] })
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
