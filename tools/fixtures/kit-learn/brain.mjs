// The fixture brain for /kit-learn (plan 046): 6 runs in 2 projects on 2 kit versions, events with 4 signatures, one of them
// (S1) coming back after its fixing plan merged. The kit commits are placeholders: a test builds a small kit repository
// (kit-repo.mjs) and passes its shas. Nothing here is a real project's data.
export const S1 = 'gate (main folder): node scripts/log-query.mjs --since=<p> --level=error'
export const S2 = 'timeout: gate <slot> timed out after <n> min'
export const S3 = 'env-fail: <p> is not recognized'
export const S4 = 'park: same reason twice (fix rounds used <n> of <n>)'

const plan = (project, run, nnn, state, mins, extra = {}) => ({
  _id: `${project}:${run}:plan:${nnn}`, project, run, nnn: String(nnn), state, reason: null,
  minutes: { readiness: 2, building: mins[0], gate: mins[1], checks: mins[2], ui: null, merge: null, finalGate: null, envPaused: null },
  models: { 'orch-builder': { model: 'm', effort: 'low' } }, ...extra,
})
const event = (project, run, kind, nnn, signature) => ({ _id: `${project}:${run}:event:${kind}-${nnn}`, project, run, kind, plan: String(nnn), signature, text: signature, at: null })

/**
 * { runs, plans, events, grades, toil, lessonsIn, issues, proposals, cursor } — `old` is a kit commit before the fix of S1,
 * `current` one that contains it. Run times and plan minutes are chosen so the ranking is: I1 regressed, I2, I3, I4.
 */
export function fixtureBrain({ old, current, fix }) {
  const run = (project, name, startedAt, kitVersion, kitCommit) => ({
    _id: `${project}:${name}:run:-`, project, run: name, kitVersion, kitCommit, startedAt, finishedAt: startedAt, minutes: 60,
    counts: { plans: 3, merged: 1, parked: 1, skipped: 0, fixRounds: 2, flakes: 0, decisions: 2, notes: 0 },
  })
  return {
    runs: [
      run('alpha-app', 'run-a1', '2026-10-20T09:00:00.000Z', '1.12.0', old),
      run('alpha-app', 'run-a2', '2026-10-22T09:00:00.000Z', '1.12.0', old),
      run('beta-app', 'run-b3', '2026-10-24T09:00:00.000Z', '1.12.0', old),
      run('alpha-app', 'run-a4', '2026-10-28T09:00:00.000Z', '1.13.0', current),
      run('beta-app', 'run-b5', '2026-10-29T09:00:00.000Z', '1.13.0', current),
      run('alpha-app', 'run-a6', '2026-10-30T09:00:00.000Z', '1.13.0', current),
    ],
    plans: [
      plan('alpha-app', 'run-a1', 101, 'parked', [15, 10, 5]), // 30 min
      plan('alpha-app', 'run-a2', 102, 'parked', [15, 5, 5]), // 25 min
      plan('alpha-app', 'run-a2', 202, 'parked', [10, 5, 5]), // 20 min
      plan('beta-app', 'run-b3', 103, 'parked', [20, 10, 10]), // 40 min
      plan('alpha-app', 'run-a4', 304, 'parked', [30, 20, 10]), // 60 min
      plan('alpha-app', 'run-a4', 305, 'skipped', [null, null, null], { reason: 'skipped: depends on 304 which parked', minutes: { readiness: 3, building: null, gate: null, checks: null, ui: null, merge: null, finalGate: null, envPaused: null } }),
      plan('alpha-app', 'run-a4', 405, 'parked', [5, 3, 2]), // 10 min
      plan('beta-app', 'run-b5', 503, 'parked', [15, 10, 5]), // 30 min
      plan('alpha-app', 'run-a6', 601, 'parked', [10, 5, 5]), // 20 min (S1 again)
      plan('alpha-app', 'run-a6', 406, 'parked', [8, 4, 3]), // 15 min
    ],
    events: [
      event('alpha-app', 'run-a1', 'park', 101, S1),
      event('alpha-app', 'run-a2', 'park', 102, S1),
      event('beta-app', 'run-b3', 'park', 103, S1),
      event('alpha-app', 'run-a6', 'park', 601, S1),
      event('alpha-app', 'run-a2', 'timeout', 202, S2),
      event('beta-app', 'run-b5', 'timeout', 503, S2),
      event('alpha-app', 'run-a4', 'env-fail', 304, S3),
      event('alpha-app', 'run-a4', 'park', 405, S4),
      event('alpha-app', 'run-a6', 'park', 406, S4),
    ],
    grades: [
      { _id: 'alpha-app:g1', project: 'alpha-app', run: 'run-a1', kind: 'sort-order', triageVerdict: 'accept', humanVerdict: 'ok', kitVersion: '1.12.0' },
      { _id: 'alpha-app:g2', project: 'alpha-app', run: 'run-a2', kind: 'sort-order', triageVerdict: 'accept', humanVerdict: 'ok', kitVersion: '1.12.0' },
      { _id: 'beta-app:g3', project: 'beta-app', run: 'run-b3', kind: 'sort-order', triageVerdict: 'accept', humanVerdict: '✗', kitVersion: '1.12.0' },
      { _id: 'beta-app:g4', project: 'beta-app', run: 'run-b5', kind: 'sort-order', triageVerdict: 'ask', humanVerdict: '✗', kitVersion: '1.13.0' },
      { _id: 'beta-app:g5', project: 'beta-app', run: 'run-b5', kind: 'copy', triageVerdict: 'accept', humanVerdict: 'ok', kitVersion: '1.13.0' },
      { _id: 'beta-app:g6', project: 'beta-app', run: 'run-b5', kind: 'copy', triageVerdict: 'none', humanVerdict: 'ok', kitVersion: '1.13.0' },
    ],
    toil: [],
    lessonsIn: [],
    issues: [
      {
        _id: 'I1', id: 'I1', signature: S1, kind: 'park', title: S1, status: 'fixed', history: [{ at: '2026-10-25T00:00:00.000Z', status: 'fixed', note: 'plan 040 merged' }],
        runKeys: ['alpha-app:run-a1', 'alpha-app:run-a2', 'beta-app:run-b3'], seenRuns: 3, projects: ['alpha-app', 'beta-app'], seenProjects: 2,
        firstSeen: '2026-10-20', lastSeen: '2026-10-24', lastRunAt: '2026-10-24T09:00:00.000Z', lastKitVersion: '1.12.0', lastKitCommit: old,
        minutesLost: 95, toilIds: [], linkedPlan: '040', fixCommit: fix, fixture: null, createdAt: '2026-10-25T00:00:00.000Z',
      },
    ],
    proposals: [],
    cursor: [{ _id: 'collect', runKeys: ['alpha-app:run-a1', 'alpha-app:run-a2', 'beta-app:run-b3'], at: '2026-10-25T00:00:00.000Z' }],
  }
}
