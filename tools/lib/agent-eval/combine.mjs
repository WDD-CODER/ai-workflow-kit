/**
 * Combine several `agent-eval.mjs --json` reports into one report under one agent name (plan 087): the before arm when
 * one agent replaces several. `agent-eval-ab.mjs` compares a role only when both folders hold a report for it, so the
 * checkers' per-role reports become one report named after the replacing agent, case by case (`<role>/<case>`).
 *
 *   import { combineReports } from './combine.mjs'
 *   const report = combineReports([bugs, plan, rules, verify], { agent: 'plan-reviewer' })
 *
 * The total is recomputed from the cases (tp, fn, fp summed; noise the mean over every case; cost summed). The
 * run-to-run spread is kept only when every source report has one — the larger of them, an upper bound; reports
 * without per-run totals (before plan 049) give no spread. Node built-ins only.
 */
import { scoreTotal } from './score.mjs'

/** One report from `reports` (each { agent, model, cases, total }) under the name `agent`. */
export function combineReports(reports, { agent, note = null } = {}) {
  if (!agent) throw new Error('combineReports needs the agent name of the combined report')
  if (!Array.isArray(reports) || reports.length === 0) throw new Error('combineReports needs at least one report')
  for (const r of reports) if (!r?.agent || !Array.isArray(r.cases)) throw new Error('every report needs agent and cases (an agent-eval --json report)')
  const cases = reports.flatMap((r) => r.cases.map((c) => ({ ...c, name: c.name.includes('/') ? c.name : `${r.agent}/${c.name}` })))
  const models = [...new Set(reports.map((r) => r.model ?? 'unknown'))]
  const total = scoreTotal(cases)
  if (reports.every((r) => r.total?.spread)) {
    total.spread = Object.fromEntries(['recall', 'precision', 'noise'].map((f) => [f, Math.max(...reports.map((r) => Number(r.total.spread[f]) || 0))]))
  }
  return { agent, model: models.join('+'), combinedFrom: reports.map((r) => r.agent), ...(note ? { note } : {}), cases, total }
}
