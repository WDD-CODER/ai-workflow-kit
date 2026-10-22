/**
 * Scores for an agent eval (contract: docs/agent/agent-evals.md).
 *
 *   import { scoreCase, scoreTotal } from './score.mjs'
 *
 * Each run of a case is { tp, fn, fp, keys, tokens, costUsd, error }. Recall = tp / (tp + fn) and precision =
 * tp / (tp + fp), summed over runs (and, for the total, over cases); nothing to find counts as recall 1, nothing
 * reported as precision 1. Noise is how much the runs of one case disagree: 1 − |keys in every run| / |keys in any
 * run| (0 = every run reported the same thing). The total noise is the mean over cases. Cost: summed tokens and USD.
 * Node built-ins only.
 */

const ratio = (num, den) => (den === 0 ? 1 : num / den)
const sum = (list, f) => list.reduce((s, x) => s + (Number(f(x)) || 0), 0)

/** Run-to-run noise of one case: 0 when every run reported the same keys, up to 1 when no key is shared. */
export function noise(runs) {
  if (runs.length < 2) return 0
  const sets = runs.map((r) => new Set(r.keys ?? []))
  const union = new Set(sets.flatMap((s) => [...s]))
  if (union.size === 0) return 0
  const inAll = [...union].filter((k) => sets.every((s) => s.has(k))).length
  return 1 - inAll / union.size
}

/** Scores of one case from its runs. */
export function scoreCase(name, runs) {
  const tp = sum(runs, (r) => r.tp)
  const fn = sum(runs, (r) => r.fn)
  const fp = sum(runs, (r) => r.fp)
  return {
    name,
    runs: runs.length,
    tp, fn, fp,
    recall: ratio(tp, tp + fn),
    precision: ratio(tp, tp + fp),
    noise: noise(runs),
    tokens: sum(runs, (r) => r.tokens),
    costUsd: sum(runs, (r) => r.costUsd),
    errors: runs.filter((r) => r.error).length,
  }
}

/** Totals over scored cases. */
export function scoreTotal(cases) {
  const tp = sum(cases, (c) => c.tp)
  const fn = sum(cases, (c) => c.fn)
  const fp = sum(cases, (c) => c.fp)
  return {
    name: 'TOTAL',
    runs: sum(cases, (c) => c.runs),
    tp, fn, fp,
    recall: ratio(tp, tp + fn),
    precision: ratio(tp, tp + fp),
    noise: cases.length ? sum(cases, (c) => c.noise) / cases.length : 0,
    tokens: sum(cases, (c) => c.tokens),
    costUsd: sum(cases, (c) => c.costUsd),
    errors: sum(cases, (c) => c.errors),
  }
}
