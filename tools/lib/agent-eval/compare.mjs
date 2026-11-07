/**
 * Structural comparison of an agent's findings with a case's expected findings (contract: docs/agent/agent-evals.md).
 *
 *   import { compareCase } from './compare.mjs'
 *   const { tp, fn, fp, unscored, keys } = compareCase(expected, result, { pass, caseRole })
 *
 * A finding matches an expected one when `file` and `rule` match, the severity is the same or one level away (plan 091:
 * blocker ~ major, major ~ minor; never blocker ~ minor) and the line is within ±LINE_TOLERANCE.
 * The reasoning text is never compared, so a reworded finding still matches. `rule` matches when the normalized
 * strings are equal, or when the expected rule is a bare category (no ':') equal to the category before the actual
 * rule's ':' ("logic" matches "logic: off-by-one in the loop bound"). An expected `rule` may be a list of accepted
 * rules. Node built-ins only.
 */
import { KEEP_THRESHOLD } from '../agent-result.mjs'

export const LINE_TOLERANCE = 3

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
export const normFile = (f) => String(f ?? '').trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '')
const category = (rule) => {
  const r = norm(rule)
  const at = r.indexOf(':')
  return at < 0 ? r : r.slice(0, at).trim()
}

/** Severity order (plan 091): adjacent levels match; an unknown severity matches only itself. */
export const SEVERITY_RANK = { blocker: 3, major: 2, minor: 1 }

/** True when the two severities are equal or one level apart. */
export function severityMatches(expectedSeverity, actualSeverity) {
  const e = norm(expectedSeverity)
  const a = norm(actualSeverity)
  if (e === a) return true
  const re = SEVERITY_RANK[e]
  const ra = SEVERITY_RANK[a]
  return re !== undefined && ra !== undefined && Math.abs(re - ra) === 1
}

/** True when the actual rule satisfies the expected rule (a string or a list of accepted strings). */
export function ruleMatches(expectedRule, actualRule) {
  const accepted = Array.isArray(expectedRule) ? expectedRule : [expectedRule]
  const actual = norm(actualRule)
  return accepted.some((e) => {
    const exp = norm(e)
    if (!exp) return false
    if (exp === actual) return true
    return !exp.includes(':') && exp === category(actual)
  })
}

/** True when one actual finding matches one expected finding (file, rule, severity within one level; line within the tolerance). */
export function findingMatches(expected, actual, tolerance = LINE_TOLERANCE) {
  if (normFile(expected.file) !== normFile(actual.file)) return false
  if (!severityMatches(expected.severity, actual.severity)) return false
  if (!ruleMatches(expected.rule, actual.rule)) return false
  if (expected.line === undefined || expected.line === null) return true
  return Number.isInteger(actual.line) && Math.abs(actual.line - expected.line) <= tolerance
}

/**
 * Pair expected and actual findings one-to-one. Each expected finding takes the closest-line unmatched actual one.
 * Returns { matched: [[expectedIndex, actualIndex]], missed: [expectedIndex], extra: [actualIndex] }.
 */
export function matchFindings(expectedList, actualList, tolerance = LINE_TOLERANCE) {
  const used = new Set()
  const matched = []
  const missed = []
  expectedList.forEach((exp, ei) => {
    let best = -1
    let bestDist = Infinity
    actualList.forEach((act, ai) => {
      if (used.has(ai) || !findingMatches(exp, act, tolerance)) return
      const dist = exp.line == null ? 0 : Math.abs(act.line - exp.line)
      if (dist < bestDist) { best = ai; bestDist = dist }
    })
    if (best < 0) missed.push(ei)
    else { used.add(best); matched.push([ei, best]) }
  })
  const extra = actualList.map((_, ai) => ai).filter((ai) => !used.has(ai))
  return { matched, missed, extra }
}

/**
 * Plan 091: the case roles whose diff.patch is only the slice of the real commit around the labelled bug. On these
 * cases a finding on plan.md that a plan step has no change in the diff is true for what the agent is shown, so it is
 * not scored: category `done-when`, `scope` or a sub-task id (`a2`, `d1`, `m6`).
 */
export const SLICE_ROLES = ['orch-check-bugs', 'orch-verify']
const SUBTASK_ID = /^[a-z]+\d+$/

/** True when an actual finding is a plan-step finding left unscored on a case of `caseRole`. */
export function isUnscored(actual, caseRole) {
  if (!SLICE_ROLES.includes(caseRole)) return false
  if (normFile(actual?.file).toLowerCase() !== 'plan.md') return false
  const cat = category(actual.rule).replace(/\s+/g, '-')
  return cat === 'done-when' || cat === 'scope' || SUBTASK_ID.test(cat)
}

/** The kind of comparison a case's expected.json asks for. */
export function caseKind(expected) {
  if (Array.isArray(expected?.findings)) return 'findings'
  if (Array.isArray(expected?.verdicts)) return 'verdicts'
  if (typeof expected?.pass === 'boolean') return 'pass'
  throw new Error('expected.json needs "findings": [...], "verdicts": [...] or "pass": true|false')
}

/**
 * Compare one run's result with a case's expectation. `result` is the parsed agent result (or null when the run
 * produced no valid result); `pass` is the validator's computed pass for pass/fail cases.
 * `caseRole` is the role folder the case sits in (plan 091: on a SLICE_ROLES case, an extra plan-step finding on
 * plan.md is counted as `unscored`, never as fp, and is left out of the noise keys).
 * Returns { tp, fn, fp, unscored, keys } where `keys` is a stable signature set of what the run reported (for noise).
 */
export function compareCase(expected, result, { pass = null, caseRole = null } = {}) {
  const kind = caseKind(expected)
  if (kind === 'findings') {
    const actual = Array.isArray(result?.problems) ? result.problems : []
    const { matched, missed, extra: unmatched } = matchFindings(expected.findings, actual)
    // A finding that matches an expected one stays a tp; only the extras are checked for the unscored rule.
    const extra = unmatched.filter((ai) => !isUnscored(actual[ai], caseRole))
    const keys = [
      ...matched.map(([ei]) => `expected#${ei}`),
      ...extra.map((ai) => {
        const a = actual[ai]
        return `extra:${normFile(a.file)}|${norm(a.rule)}|${norm(a.severity)}|${Math.round((a.line ?? 0) / (LINE_TOLERANCE * 2 + 1))}`
      }),
    ]
    return { tp: matched.length, fn: missed.length, fp: extra.length, unscored: unmatched.length - extra.length, keys }
  }
  if (kind === 'verdicts') {
    // A verifier reports a candidate when it keeps it with confidence ≥ KEEP_THRESHOLD; expected "keep" ids should be
    // reported, expected "refuted" ids should not.
    const want = new Set(expected.verdicts.filter((v) => v.verdict === 'keep').map((v) => String(v.id)))
    const got = new Set((Array.isArray(result?.verdicts) ? result.verdicts : [])
      .filter((v) => v?.verdict === 'keep' && Number(v.confidence) >= KEEP_THRESHOLD)
      .map((v) => String(v.id)))
    const tp = [...want].filter((id) => got.has(id)).length
    return { tp, fn: want.size - tp, fp: [...got].filter((id) => !want.has(id)).length, unscored: 0, keys: [...got].sort().map((id) => `keep:${id}`) }
  }
  // pass/fail: an expected failure is one thing to find; a reported failure is one finding.
  const wantFail = expected.pass === false
  const gotFail = pass === false
  return { tp: wantFail && gotFail ? 1 : 0, fn: wantFail && !gotFail ? 1 : 0, fp: !wantFail && gotFail ? 1 : 0, unscored: 0, keys: [gotFail ? 'fail' : pass === true ? 'pass' : 'no-result'] }
}
