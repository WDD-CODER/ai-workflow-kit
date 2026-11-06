/**
 * Result validator for the single reviewer (plan 087, `.claude/agents/plan-reviewer.md`): the shared finder schema of
 * docs/agent/agent-roles.md (`problems[]` of `{id, file, line, rule, reasoning, severity}`, `model`, `effort`, optional
 * `pass` and `decisions`) plus `verdict: PASS|STOP`. Like `pass`, the verdict is computed from the problems — STOP when
 * any problem is `blocker` or `major` — and a result whose own verdict (or pass) disagrees is rejected.
 *
 *   import { validateReviewerResult } from './reviewer.mjs'
 *   const { ok, errors, pass } = validateReviewerResult(result, 'plan-reviewer')
 *
 * Lives with the eval until plan 088 wires the reviewer into the shared validator (tools/lib/agent-result.mjs).
 * Node built-ins only.
 */
import { validateAgentResult } from '../agent-result.mjs'

export const REVIEWER_VERDICTS = ['PASS', 'STOP']

/** Validate one reviewer result for the agent named `role`. Returns { ok, errors, pass }. */
export function validateReviewerResult(result, role) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return { ok: false, errors: ['result must be a JSON object'], pass: null }
  const errors = []
  if (result.role !== role) errors.push(`role must be ${role} (got ${JSON.stringify(result.role)})`)
  // The problem list, model, effort, decisions and pass are checked exactly as for a finder.
  const { role: _role, verdict, ...rest } = result
  const asFinder = validateAgentResult({ ...rest, role: 'orch-check-bugs' })
  errors.push(...asFinder.errors)
  const pass = asFinder.pass
  if (!REVIEWER_VERDICTS.includes(verdict)) errors.push(`verdict must be PASS or STOP (got ${JSON.stringify(verdict)})`)
  else if (pass !== null && (verdict === 'PASS') !== pass) {
    errors.push(`verdict is ${verdict} but the result's own problems say ${pass ? 'PASS' : 'STOP'} — a model's verdict is never trusted`)
  }
  return { ok: errors.length === 0, errors, pass }
}
