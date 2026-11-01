/**
 * Scope-tests lint — the save-plan shape check that a plan changing code names a test location in its scope.
 * The gate (scripts/lib/plan-scope.mjs) blocks a changed test file no scope line names a test location for; this tells
 * the Planner at save time. Read from the scope lines only (sub-task targets are prose). Pure: callers pass the plan
 * text. The test-path rule is plan-scope.mjs's (`testScopeGlobs`); nothing of it is repeated here.
 *
 * Status: 'no-scope' (no parsable scope block), 'docs-only' (every scope line is documentation), 'ok' (a scope line
 * names a test location, or the only lines are test lines), 'warn' (code lines and no test line; `codeGlobs` lists them).
 */
import { extractScopeGlobs, testScopeGlobs } from './plan-scope.mjs'

// A scope line that only ever matches documentation: a text file, a docs/ or plans/ folder, a changelog/readme/license.
const DOC_GLOB = /(\.(md|mdx|txt|rst)$)|(^(docs|plans)\/)|(^(CHANGELOG|README|LICENSE)[^/]*$)/i

export const isDocGlob = (glob) => DOC_GLOB.test(String(glob).replace(/\\/g, '/'))

export function scopeTestsLint(planText) {
  const globs = extractScopeGlobs(String(planText).replace(/\r\n/g, '\n'))
  if (!globs) return { status: 'no-scope', codeGlobs: [] }
  const tests = new Set(testScopeGlobs(globs))
  const codeGlobs = globs.filter((g) => !tests.has(g) && !isDocGlob(g))
  if (!codeGlobs.length) return { status: tests.size ? 'ok' : 'docs-only', codeGlobs }
  return { status: tests.size ? 'ok' : 'warn', codeGlobs }
}
