/**
 * Does the kit get better? (plan 046, K11) brain-query's trend per kit version plus the minutes lost to kit problems per run
 * and the Human's round trips per run (when the run document knows them).
 */
import { trendRows } from '../../brain-query.mjs'
import { runKey, minutesLostInRun, semverCmp } from './ledger.mjs'

const avg = (sum, n) => (n > 0 ? Math.round((sum / n) * 10) / 10 : null)
const cell = (v) => (v === null || v === undefined ? '-' : String(v))

/** One row per kit version, oldest first: brain-query's columns + minutesLostPerRun + roundTripsPerRun. */
export function kitTrendRows({ runs, plans, events, grades }) {
  const base = trendRows(runs, grades, 'kitVersion')
  const plansByRun = new Map()
  for (const p of plans) {
    if (!plansByRun.has(runKey(p))) plansByRun.set(runKey(p), [])
    plansByRun.get(runKey(p)).push(p)
  }
  const eventsByRun = new Map()
  for (const e of events) {
    if (!eventsByRun.has(runKey(e))) eventsByRun.set(runKey(e), [])
    eventsByRun.get(runKey(e)).push(e)
  }
  return base
    .map((row) => {
      const mine = runs.filter((r) => String(r.kitVersion ?? 'unknown') === row.kitVersion)
      const lost = mine.reduce((s, r) => s + minutesLostInRun(eventsByRun.get(runKey(r)) ?? [], plansByRun.get(runKey(r)) ?? []), 0)
      const trips = mine.map((r) => r.counts?.humanRoundTrips).filter(Number.isFinite)
      return { ...row, minutesLostPerRun: avg(lost, mine.length), roundTripsPerRun: trips.length ? avg(trips.reduce((a, b) => a + b, 0), trips.length) : null }
    })
    .sort((a, b) => semverCmp(a.kitVersion, b.kitVersion))
}

export function kitTrendTable(rows) {
  const head = ['kitVersion', 'runs', 'plans', 'min lost/run', 'parked/run', 'fix rounds/plan', 'decisions/plan', '✗/plan', 'round trips/run', 'tokens/plan']
  const body = rows.map((r) => [r.kitVersion, r.runs, r.plans, r.minutesLostPerRun, r.parkedPerRun, r.fixRoundsPerPlan, r.decisionsPerPlan, r.wrongPerPlan, r.roundTripsPerRun, r.tokensPerPlan].map(cell))
  return [head, head.map(() => '---'), ...body].map((row) => `| ${row.join(' | ')} |`).join('\n')
}

/** The last three kit versions on one line. */
export function kitTrendLine(rows) {
  const last = rows.slice(-3)
  if (!last.length) return 'kit trend: no runs yet'
  return `kit trend (min lost/run · parked/run · fix rounds/plan): ${last.map((r) => `v${r.kitVersion} ${cell(r.minutesLostPerRun)} · ${cell(r.parkedPerRun)} · ${cell(r.fixRoundsPerPlan)}`).join(' → ')}`
}
