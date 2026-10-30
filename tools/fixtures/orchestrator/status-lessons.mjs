// A status.json (the shape orch-state.mjs writes, plan 030 fields included) with one of every fact the lessons are
// written from, and the lesson lines it must give — see tools/test/orchestrator.test.mjs. Plain data: no clock, no files.
const FINDERS = { 'orch-check-plan': { model: 'sonnet' }, 'orch-check-bugs': { model: 'sonnet' }, 'orch-check-rules': { model: 'sonnet' } }

export const STATUS = {
  run: 'fix-run',
  phase: 'finished',
  attempts: 1,
  plans: {
    // Two fix rounds (a checker finding, then a gate failure), the second escalated; one refuted candidate per finder;
    // a miss the UI found after clean checkers; a refuted problem that came back; a kept-low problem that came back.
    101: {
      nnn: '101', title: 'Save form', state: 'merged', round: 2, tier: 'judgment', ready: true,
      models: { ...FINDERS, 'orch-security': { model: 'sonnet' } },
      roundCauses: ['round 1: checker: major src/form.ts:12 logic: empty value; blocker src/form.test.ts:4 runtime: path with spaces', 'round 2: gate: npm run test'],
      escalations: [{ step: 'round 2', check: 'npm run test' }],
      verify: {
        candidates: 5, refuted: 3, refutedRules: ['logic: off by one', 'AGENTS.md: secrets'],
        byRole: {
          'check-bugs': { candidates: 2, refuted: 1, rules: ['logic: off by one'] },
          'check-rules': { candidates: 2, refuted: 2, rules: ['AGENTS.md: secrets', 'dead code'] },
          'check-plan': { candidates: 1, refuted: 0, rules: [] },
        },
        lateLow: ['logic: empty value'], reappeared: ['runtime: path with spaces'],
      },
      misses: ['ui: Save shows Saved fail'],
      gateEvents: ['timed out: npm run test', 'env-fail rerun: npm run lint'],
      uiCards: [{ card: 'Save shows Saved', status: 'fail', via: 'browser', page: 'http://localhost:5173/form', screenshots: [], round: 2, regressed: true }, { card: 'Title says Edit', status: 'plan-drift', via: 'browser', page: '', screenshots: [], round: 2 }],
      asked: ['what should happen on cancel?'],
    },
    // Ready according to readiness, then parked on the environment.
    102: { nnn: '102', title: 'Export', state: 'parked', round: 0, tier: 'build', ready: true, reason: 'environment: dev server http://localhost:5173 does not answer', models: {} },
    // Parked for another reason; readiness had asked about it, so it was never "ready".
    103: { nnn: '103', title: 'Import', state: 'parked', round: 2, tier: 'judgment', ready: false, reason: 'checker: major src/i.ts:3 logic (fix rounds used: 2 of 2)', models: {}, asked: ['which file types?', 'what happens on error?'] },
  },
}

// role -> the lesson lines (without the "- <date> <run>: " prefix), in the order lessonFacts gives them for plans 101, 102, 103.
export const EXPECTED = {
  builder: [
    'fix round caused by: logic: empty value (ts file)',
    'fix round caused by: runtime: path with spaces (test file)',
    'fix round caused by: gate: npm run test',
    'escalated to the judgment tier at round 2: npm run test',
    'parked: environment: dev server http://localhost:5173 does not answer',
    'parked: checker: major src/i.ts:3 logic (fix rounds used: 2 of 2)',
  ],
  'check-bugs': ['1 of 2 candidates refuted: logic: off by one', 'missed: ui: Save shows Saved fail'],
  'check-rules': ['2 of 2 candidates refuted: AGENTS.md: secrets, dead code', 'missed: ui: Save shows Saved fail'],
  'check-plan': ['missed: ui: Save shows Saved fail'],
  security: ['missed: ui: Save shows Saved fail'],
  verify: [
    'kept with a confidence below the keep threshold, then caused a fix round: logic: empty value',
    'refuted, but the problem reappeared in a later round: runtime: path with spaces',
  ],
  readiness: ['parked on environment after ready: environment: dev server http://localhost:5173 does not answer'],
  gate: ['timed out: npm run test', 'env-fail rerun: npm run lint'],
  ui: ['card failed after it had passed: Save shows Saved'],
  planner: [
    'plan 101 had to be asked: what should happen on cancel?',
    'plan 101 drifted from its card: Title says Edit',
    'plan 103 had to be asked: which file types?',
    'plan 103 had to be asked: what happens on error?',
  ],
}
