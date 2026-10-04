/**
 * Plan scope parser — the one reading of a plan's "## Read-Write Scope" section.
 * Shared by scope-check.mjs (guard, /ship, drift) and take-plan.mjs (pre-claim check).
 *
 * Two accepted shapes inside the section (up to the next "## " heading):
 *   1. a fenced block opened with ```scope (or a plain ``` fence), one glob per line ('#' lines are comments);
 *   2. a "**Scope:**" line followed by a bulleted list whose items start with a `backticked` glob;
 *   3. shape 1 with its backticks lost: a line that is exactly "scope", then globs up to a blank line.
 * Returns the globs, or null when the section or both shapes are missing.
 */
export function extractScopeGlobs(planText) {
  const section = planText.match(/^## Read-Write Scope[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m)
  if (!section) return null
  const body = section[1]

  // A ```scope fence; also a plain ``` fence (the "scope" tag dropped, or left on the line above it).
  const fenced = body.match(/```scope[ \t]*\r?\n([\s\S]*?)```/) || body.match(/```[ \t]*\r?\n([\s\S]*?)```/)
  if (fenced) {
    const globs = fenced[1].split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    return globs.length ? globs : null
  }

  const list = body.match(/^\*\*Scope:\*\*[^\n]*\n((?:[ \t]*[-*][^\n]*(?:\n|$))+)/m)
  if (list) {
    const globs = list[1]
      .split(/\r?\n/)
      .map((l) => (l.match(/^\s*[-*]\s+`([^`]+)`/) || [])[1])
      .filter(Boolean)
    if (globs.length) return globs
  }

  // A ```scope fence whose backticks were lost (pasted from rendered markdown): a line that is exactly "scope",
  // then one glob per line (backticks optional) up to the first blank line.
  const bare = body.match(/^scope[ \t]*\r?\n((?:[^\S\r\n]*\S[^\n]*(?:\n|$))+)/m)
  if (bare) {
    const globs = bare[1]
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/^[-*]\s+/, '').replace(/^`([^`]+)`.*$/, '$1'))
      .filter((l) => l && !l.startsWith('#') && !/\s/.test(l))
    if (globs.length) return globs
  }
  return null
}
