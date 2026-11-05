# Plan 075 — CI runs every kit tool test, so a red test cannot hide on the builder's machine

Status: draft
Depends-on: none
Snapshot: b075db1e9c4876d4f210c95612df2e2a406a160a

## Problem Statement

The kit has 24 test files under `tools/test/`. CI never runs them as a set: the `leak-check` job runs leak, pack, drift,
install and link checks (`.github/workflows/leak-check.yml:22-57`), and the `e2e` job runs `tools/e2e-check.mjs`, which
runs only 7 of the files, and only against a freshly installed project (`tools/e2e-check.mjs:171-195`). `npm test` runs
`install-check` and `workflow-link-check` only (`package.json:8`). The other files run only when a builder types
`node --test "tools/test/*.test.mjs"` on its own machine.

This is not theoretical. On `main` at `b075db1` the full set has one red test that CI did not catch:
`tools/test/orchestrator.test.mjs:1153` ("final gate: PROJECT_CHECKS, then the manifest check, then
orchestrator.ciMirror …") fails at line 1159. PR #94 put six checks into the kit's own `orchestrator.ciMirror`
(`.kit/config.json:33-40`), so the kit's rendered workflow already carries a mirror, and the test's baseline run now
includes it while its override replaces it. The same test passes inside `e2e-check`, whose fresh project has no mirror,
so CI stayed green.

The fix was proposed on 2026-10-31 (chat "בדיקות e2e ומיזוג PR"): run the whole set once in CI on every PR, and keep
local runs to the checks that CI does not cover. It was never planned.

## Goals & Success Criteria

**Primary:** every pull request runs `node --test "tools/test/*.test.mjs"` once on Ubuntu, the one test that is red
today is fixed, and the change loop says which checks a builder runs locally.

- [auto] `node --test "tools/test/*.test.mjs"` exits 0 on the plan branch (today it exits 1 on the ciMirror test).
- [auto] `node --test tools/test/orchestrator.test.mjs` passes: the ciMirror test computes its `base` with
  `source: withMirror([])`, so expected = project checks + manifest check + the deduplicated override, the same in the kit
  root and in a fresh project; the closing "an empty mirror changes nothing" assertion uses the same base
  (`node tools/e2e-check.mjs` passes too).
- [auto] `.github/workflows/leak-check.yml` has its own job `kit-tests` (Ubuntu, Node 22, running beside `leak-check`
  so PR wall time does not grow by the ~5 minutes the set takes) with a step `npm ci --prefix scripts` (the workflow
  scripts import `picomatch`) followed by the step `Every kit tool test (node --test tools/test)` whose `run` is
  `node --test "tools/test/*.test.mjs"`; `tools/test/ci-coverage.test.mjs` reads the workflow file and fails without the
  job or either step.
- [auto] `tools/test/ci-coverage.test.mjs` also fails when a file under `tools/test/` (not under `fixtures/`) matches
  `/\.test\.(c|m)?js$/` but not `*.test.mjs`, so no test file can sit outside the CI run.
- [auto] `docs/CHANGE-LOOP.md` section 1 lists the local checks as build, lint, `npm test`, drift-check and
  `node --test "tools/test/*.test.mjs"`, says `e2e-check` and `acceptance-check --e2e` run in CI on every PR and
  locally only to debug a CI failure, and says never to run `orchestrator-e2e` and `e2e-check` both (`tools/test/ci-coverage.test.mjs` reads it).
- [auto] `npm run build` and `npm run lint` pass.
- [human] The first PR after the merge shows the new step green in the `leak-check` job.

## Execution Mode
- Parallel: yes.
- Concurrent plans: plan 065 (running now) may edit `tools/test/orchestrator.test.mjs`; this plan changes only the
  ciMirror test in that file. Merge `origin/main` into the plan branch before the PR if 065 merged first.
- Isolated DB: no.

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
.github/workflows/leak-check.yml
docs/CHANGE-LOOP.md
tools/test/orchestrator.test.mjs
tools/test/ci-coverage.test.mjs
CHANGELOG.md
docs/brain/scorecard.md
```

## Read Scope

Entire repo and its git history.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry.

## Architecture Impact
- INV-none: preserves — CI configuration, one test and one doc; no invariant's `Touches` glob is in scope.

## Step 0 — Reality Check

1. Runs only when `scope-check.mjs --drift` reports `REALITY: drift`: check the listed commits by symbol and print `ok`
   or `conflict: <what>` per commit; stop for a go only on a conflict.
2. Always: run `node --test "tools/test/*.test.mjs"` once and write the failing test names into Execution Notes. If a
   test other than the ciMirror one fails, fix it only when the cause is the same kind (a kit-root value the test did
   not expect); any other failure is written down and the Human is asked (`approved: <path>` for its file).

## User Stories
- As the Human, I want CI to fail when any kit test fails, so that a green PR means the whole kit is green.
- As the Human, I want builders to stop running the slow e2e checks on my Windows machine when CI runs them anyway.

## Functional Requirements

### Must Have (P0)
- [ ] The CI step for the whole test set.
- [ ] The ciMirror test fixed so it holds in the kit root and in a fresh project.
- [ ] A test that keeps the CI step and the glob honest.

### Should Have (P1)
- [ ] The change-loop doc names the local checks.

### Nice to Have (P2)
- none

## UI/UX Notes
- none (CI and docs only).

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [x] T1: Fix the final-gate test that broke when the kit got its own CI mirror — base computed with an empty mirror (`withMirror([])`), for both the override assertion and the empty-mirror assertion — tools/test/orchestrator.test.mjs
- [x] C1: Run every kit tool test once in CI on every pull request, in its own job so the PR does not wait longer — job kit-tests: checkout, Node 22, npm ci --prefix scripts, node --test — .github/workflows/leak-check.yml
- [x] C2: Fail a test when the CI step goes missing or a test file falls outside the glob — tools/test/ci-coverage.test.mjs
- [x] D1: Say which checks a builder runs locally and which only CI runs — docs/CHANGE-LOOP.md section 1, and a changelog line — docs/CHANGE-LOOP.md, CHANGELOG.md

## Technical Considerations
- Dependencies: a new `kit-tests` job (Ubuntu, Node 22) beside `leak-check`. The full set took 285 s on Linux at
  `b075db1` (454 tests); in its own job it does not lengthen the PR.
- New files: `tools/test/ci-coverage.test.mjs`.
- Model changes: none. Backend / API: none. Auth and validation: none. Security surface: none.
- Data / migration: none.
- The orchestrator's final gate for the kit (`orchestrator.ciMirror` in `.kit/config.json`) is not changed: the whole
  set already runs in a kit plan's Done-when, and adding it to the mirror would run it twice per run.

## Out of Scope
- Running the set on Windows in CI (the `e2e` job already covers Windows on `main` and tags).
- Changing `npm test` (the orchestrator's per-plan gate runs it; the full set there would slow every plan).
- The review hand-off blocks of individual plans.

## Critical Questions
- Q: Add the step to the Windows leg too? A: no; Ubuntu on every PR, as the 2026-10-31 proposal said (recommended).
- Q: A step in `leak-check` or its own job? A: its own job `kit-tests`, so the ~5 minutes run in parallel (recommended).

## Execution Notes
- Source: chat "בדיקות e2e ומיזוג PR" (2026-10-31): 10 of 17 test files ran only on the builder's machine; proposal to
  run them in CI and keep e2e in CI only.
- Evidence at `b075db1` (plan author, 2026-11-03): `node --test "tools/test/*.test.mjs"` on Linux, Node 22: one failure,
  `final gate: PROJECT_CHECKS, then the manifest check, then orchestrator.ciMirror …` (`orchestrator.test.mjs:1159`,
  actual list without the six mirror checks).
- Review (Architect + PM, a separate agent against b075db1, 2026-11-03): mechanical gaps fixed in the draft (line references, scope and Depends-on, test names); open points answered with the recommended default in Critical Questions. The Planner's own review is still to run.
- Run (2026-11-05, Human brief "reliability freeze", Part B plan 1 of 5). First commit: `docs/brain/scorecard.md` and the scorecard line in `docs/CHANGE-LOOP.md`, as the brief asked.
- Step 0 (Windows, Node 22, before any edit): `node --test "tools/test/*.test.mjs"` — 460 tests, 459 pass, 1 fail, 6 min 2 s: only `final gate: PROJECT_CHECKS, then the manifest check, then orchestrator.ciMirror …`, the expected one.
- decision: the scorecard's Project column says `app project` instead of the project's real name — CI's leak-check runs `--project-only` over `docs/brain/` and fails on that name (checked locally: `scorecard.md:8: product … (brain)`, LEAK_CHECK: FAIL); the file's intro says to use neutral labels. Reversible: rename the row if leak-check gets an allowance.
- decision: `node tools/e2e-check.mjs` (named in the T1 Done-when item) was not run locally — the plan's own D1 text says it runs in CI and locally only to debug a CI failure; the PR's `e2e` job is the evidence.
- decision: `ci-coverage.test.mjs` compares the change-loop text with whitespace collapsed, so a re-wrapped line does not break it.
