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
 * Why a changed test file is refused. The file may well match a broad scope glob; what is missing is a scope line that
 * names a test location, so the reason says that and never that the scope does not cover the file.
 */
export const TEST_LOCATION_RULE = 'no scope line names a test location'
export function testLocationReason(file) {
  return `${file}: ${TEST_LOCATION_RULE} — a code-folder glob does not list the tests under it; add a tests folder glob or this test file to the scope`
}

/**
 * Of the changed files, the test files no test-naming scope line matches. `matchGlobs(globs)` returns a path
 * predicate (picomatch with dot:true), passed in so this file keeps no dependency.
 */
export function testFilesOutOfScope(files, scopeGlobs, matchGlobs, removed) {
  return testRefusals(files, scopeGlobs, matchGlobs, removed).map((r) => r.file)
}

const SIBLING_MARK = /[._](?:spec|test)(\.[^./]+)$/i
const WEAKENS = /expect\(|assert|(?:^|\s)(?:it|test)\(|describe\(/

/** The source paths a test file sits next to: its path with `.spec.`/`.test.`/`_spec.`/`_test.` reduced to `.`; a test in a `__tests__/` folder also counts as next to the folder above. */
export function siblingSources(file) {
  const p = String(file).replace(/\\/g, '/')
  if (!SIBLING_MARK.test(p)) return []
  const src = p.replace(SIBLING_MARK, '$1')
  const out = [src]
  const m = /^(.*)\/__tests__\/([^/]+)$/i.exec(src)
  if (m) out.push(`${m[1]}/${m[2]}`)
  return out.filter((s) => !isTestPath(s))
}

/** True when the scope covers the source file this test sits next to (a sibling test needs no scope line of its own). */
export function isSiblingTest(file, scopeGlobs, matchGlobs) {
  const globs = scopeGlobs ?? []
  if (!globs.length) return false
  const isIn = matchGlobs(globs)
  return siblingSources(file).some((s) => isIn(s))
}

/** The first removed line of a test file that held an assertion or a test declaration: { line, text } or null. */
export function weakenedLine(file, removed) {
  const list = removed?.[String(file).replace(/\\/g, '/')] ?? []
  return list.find((r) => WEAKENS.test(r.text)) ?? null
}

export function weakenedReason(file, hit) {
  return `sibling test weakened: ${file}:${hit.line} — name the test in the scope to change its assertions`
}

/**
 * Removed lines per file from a `git diff -U0 --no-color` text: { 'path': [{ line (old file), text }] }.
 */
export function removedLinesByFile(diffText) {
  const out = {}
  let file = null
  let old = 0
  for (const raw of String(diffText ?? '').split('\n')) {
    if (raw.startsWith('diff --git ')) { file = null; continue }
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4).trim()
      if (p !== '/dev/null') file = p.replace(/^b\//, '')
      continue
    }
    if (raw.startsWith('--- ')) {
      const p = raw.slice(4).trim()
      if (p !== '/dev/null') file = p.replace(/^a\//, '')
      continue
    }
    const h = /^@@ -(\d+)(?:,\d+)? \+/.exec(raw)
    if (h) { old = Number(h[1]); continue }
    if (file && raw.startsWith('-')) (out[file] ??= []).push({ line: old++, text: raw.slice(1) })
  }
  return out
}

/**
 * The changed test files the gate refuses, each with its reason. A test file passes when a scope line names a test
 * location that lists it, or when it is a sibling test of a file the scope covers and its diff removes no assertion.
 * `removed` is removedLinesByFile of the diff (optional: without it the weakened-test check cannot run).
 */
export function testRefusals(files, scopeGlobs, matchGlobs, removed) {
  const listed = testScopeGlobs(scopeGlobs)
  const isListed = listed.length ? matchGlobs(listed) : () => false
  const out = []
  for (const f of files ?? []) {
    if (!isTestPath(f)) continue
    const p = String(f).replace(/\\/g, '/')
    if (isListed(p)) continue
    if (isSiblingTest(p, scopeGlobs, matchGlobs)) {
      const hit = weakenedLine(p, removed)
      if (hit) out.push({ file: f, reason: weakenedReason(f, hit) })
      continue
    }
    out.push({ file: f, reason: testLocationReason(f) })
  }
  return out
}
