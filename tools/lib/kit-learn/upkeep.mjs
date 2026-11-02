/**
 * Does each kit lesson work? (plan 046, K9) Per live kit lesson: its exposures (runs where its role ran on a kit version that
 * had the lesson) and the recurrences of its issue's signature in those runs. Never retires anything: it names candidates.
 */
import { isSafety } from './lessons.mjs'
import { runKey, semverCmp } from './ledger.mjs'

export const RETIRE_AFTER_EXPOSURES = 10
export const DRIFT_RECURRENCES = 2

/** A run's role ran when one of its plans records a model for it; readiness and the gate run in every run that has plans. */
export function roleRan(role, runPlans) {
  if (['readiness', 'gate'].includes(role)) return runPlans.length > 0
  return runPlans.some((p) => Object.keys(p.models ?? {}).some((k) => k === role || k === `orch-${role}`))
}

/**
 * Rows { id, role, issue, exposures, recurrences, safety, flag, fixture } for every live lesson of `lessons` ({ role -> parsed
 * file }). `flag` is `drift → enforce`, `retire? enforced by <fixture>` or null.
 */
export function lessonUpkeep({ lessons, issues, runs, plans, events, minExposures = RETIRE_AFTER_EXPOSURES }) {
  const plansByRun = new Map()
  for (const p of plans) {
    const k = runKey(p)
    if (!plansByRun.has(k)) plansByRun.set(k, [])
    plansByRun.get(k).push(p)
  }
  const rows = []
  for (const [role, file] of Object.entries(lessons)) {
    for (const l of file.live) {
      const exposed = runs.filter((r) => semverCmp(r.kitVersion, l.since) >= 0 && roleRan(role, plansByRun.get(runKey(r)) ?? [])).map(runKey)
      const issue = issues.find((i) => i._id === l.issue) ?? null
      const hit = issue ? new Set(events.filter((e) => e.signature === issue.signature).map(runKey)) : new Set()
      const recurrences = exposed.filter((k) => hit.has(k)).length
      const safety = isSafety(l)
      let flag = null
      if (recurrences >= DRIFT_RECURRENCES) flag = 'drift → enforce'
      else if (!safety && issue?.status === 'fixed' && issue.fixture && recurrences === 0 && exposed.length >= minExposures) flag = `retire? enforced by ${issue.fixture}`
      rows.push({ id: l.id, role, issue: l.issue, text: l.text, exposures: exposed.length, recurrences, safety, flag, fixture: issue?.fixture ?? null })
    }
  }
  return rows
}

export const upkeepLine = (r) => `${r.id} ${r.role} exposures ${r.exposures} recurrences ${r.recurrences}${r.safety ? ' safety' : ''}${r.flag ? ` ${r.flag}` : ''}`
