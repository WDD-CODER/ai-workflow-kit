/**
 * Result validator for the single reviewer (plan 087, `.claude/agents/plan-reviewer.md`): the shared finder schema of
 * docs/agent/agent-roles.md (`problems[]` of `{id, file, line, rule, reasoning, severity}`, `model`, `effort`, optional
 * `pass` and `decisions`) plus `verdict: PASS|STOP`. Like `pass`, the verdict is computed from the problems — STOP when
 * any problem is `blocker` or `major` — and a result whose own verdict (or pass) disagrees is rejected.
 *
 *   import { validateReviewerResult } from './reviewer.mjs'
 *   const { ok, errors, pass } = validateReviewerResult(result, 'plan-reviewer')
 *
 * Plan 088 moved the validator into the kit's scripts (core/scripts/lib/plan-review.mjs), where run-plans.mjs reads the
 * reviewer's real results with it; the eval imports the same code from there.
 */
export { validateReviewerResult, REVIEWER_VERDICTS } from '../../../core/scripts/lib/plan-review.mjs'
