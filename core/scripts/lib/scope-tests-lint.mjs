/**
 * Scope-tests lint — the save-plan shape check that a plan's scope lets the run change the tests the plan needs.
 * It runs the run's own test-file gate (scripts/lib/plan-scope.mjs `testRefusals`, the function `orch-state.mjs diff`
 * and the dry run's readiness check call) on the test paths the plan names, so the save and the run cannot disagree.
 * Pure: callers pass the plan text. The test-path rule is plan-scope.mjs's; nothing of it is repeated here.
 *
 * Status, worst first:
 *   'bad'       a scope line is only a test's file name (`bare`): it matches nothing the plan means;
 *   'warn'      a test path the plan names would be refused by the run (`refused`: { file, reason }), or the scope names
 *               code and no test location (`codeGlobs`);
 *   'ok'        none of those; 'docs-only' (every scope line is documentation); 'no-scope' (no parsable scope block).
 */
import { createRequire } from 'module'
import { extractScopeGlobs, testScopeGlobs, testRefusals, plannedTestPaths, bareTestLines } from './plan-scope.mjs'

// A scope line that only ever matches documentation: a text file, a docs/ or plans/ folder, a changelog/readme/license.
const DOC_GLOB = /(\.(md|mdx|txt|rst)$)|(^(docs|plans)\/)|(^(CHANGELOG|README|LICENSE)[^/]*$)/i

export const isDocGlob = (glob) => DOC_GLOB.test(String(glob).replace(/\\/g, '/'))

const picomatch = createRequire(import.meta.url)('picomatch')
const matchGlobs = (g) => picomatch(g, { dot: true })

export function scopeTestsLint(planText) {
  const text = String(planText).replace(/\r\n/g, '\n')
  const globs = extractScopeGlobs(text)
  if (!globs) return { status: 'no-scope', codeGlobs: [], bare: [], refused: [] }
  const bare = bareTestLines(globs)
  const refused = testRefusals(plannedTestPaths(text), globs, matchGlobs)
  const tests = new Set(testScopeGlobs(globs))
  const codeGlobs = globs.filter((g) => !tests.has(g) && !isDocGlob(g))
  const out = { codeGlobs, bare, refused }
  if (bare.length) return { status: 'bad', ...out }
  if (refused.length) return { status: 'warn', ...out }
  if (!codeGlobs.length) return { status: tests.size ? 'ok' : 'docs-only', ...out }
  return { status: tests.size ? 'ok' : 'warn', ...out }
}
