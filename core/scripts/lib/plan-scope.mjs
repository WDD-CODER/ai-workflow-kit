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

/**
 * Test-file gate. A test file is one under a test folder or named *.test.* / *.spec.* (plus e2e/**).
 * A plan may change a test file only when a scope line itself names a test location (`tools/test/**`, `src/a.test.ts`);
 * a broad folder glob (`tools/**`) never lists the tests under it, so a builder cannot edit the tests that would catch it.
 */
// Case-insensitive; a test folder at any depth (test, tests, spec, specs, e2e, cypress, playwright, __tests__,
// __snapshots__, __mocks__) or a file named *.test.*, *.spec.*, *_test.*, *_spec.* or test_*.
const TEST_DIR = /(^|\/)(test|tests|spec|specs|e2e|cypress|playwright|__tests__|__snapshots__|__mocks__)(\/|$)/i
const TEST_NAME = /(\.(test|spec)\.|_(test|spec)\.|(^|\/)test_[^/]*$)/i

export function isTestPath(path) {
  const p = String(path).replace(/\\/g, '/')
  return TEST_DIR.test(p) || TEST_NAME.test(p)
}

/** The scope globs that name a test location themselves. */
export function testScopeGlobs(scopeGlobs) {
  return (scopeGlobs ?? []).filter((g) => isTestPath(g))
}

/**
 * Of the changed files, the test files no test-naming scope line matches. `matchGlobs(globs)` returns a path
 * predicate (picomatch with dot:true), passed in so this file keeps no dependency.
 */
export function testFilesOutOfScope(files, scopeGlobs, matchGlobs) {
  const listed = testScopeGlobs(scopeGlobs)
  const isListed = listed.length ? matchGlobs(listed) : () => false
  return (files ?? []).filter((f) => isTestPath(f) && !isListed(String(f).replace(/\\/g, '/')))
}
