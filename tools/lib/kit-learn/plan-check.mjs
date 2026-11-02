/**
 * Plan guard (plan 046, K6): a plan drafted from a brain issue (`Source: brain issue <id>`) must reproduce the problem in a
 * test — one Atomic Sub-task names a path under tools/test/ or tools/fixtures/.
 */
export const MISSING = 'regression test missing: a plan from a brain issue reproduces the problem in a test'
const TEST_PATH = /(?:^|[\s`'"(,])(?:\.\/)?tools\/(?:test|fixtures)\/[\w.@/-]+/

/** The `## Atomic Sub-tasks` section's checkbox lines (each sub-task is one line in the kit's plans). */
function subTasks(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((l) => /^##\s+Atomic Sub-tasks\b/.test(l))
  if (start === -1) return []
  const out = []
  for (const l of lines.slice(start + 1)) {
    if (/^##\s/.test(l)) break
    if (/^\s*-\s+\[[ xX]\]/.test(l)) out.push(l)
  }
  return out
}

/** { ok, issue, tests } — `issue` is null for a plan with no `Source: brain issue` line (the guard does not apply). */
export function planCheck(text) {
  const m = /^Source:\s*brain issue\s+(\S+)/m.exec(String(text))
  if (!m) return { ok: true, issue: null, tests: [] }
  const tests = []
  for (const l of subTasks(text)) for (const t of l.matchAll(new RegExp(TEST_PATH.source, 'g'))) tests.push(t[0].replace(/^[\s`'"(,]+/, '').replace(/^\.\//, ''))
  return { ok: tests.length > 0, issue: m[1], tests: [...new Set(tests)] }
}
