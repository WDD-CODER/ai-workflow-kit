# Plan 064 — Lesson lines go only to the role that could have caught the problem, and the report and run-log row follow the final gate re-run

Status: draft
Depends-on: 062
Snapshot: aac496e051072bad36314d3b24767d2f7fa37469
Source: first orchestrator test run (test-512-422), finding F10 (+ Human addition 2026-11-02)

## Problem Statement

1. **Wrong role gets the lesson.** `lessonFacts` (`core/scripts/lib/orch-run.mjs:535-536`) gives `missed: <tag>` to every finder that
   ran on a plan (`FINDER_ROLES`, :438) for any miss. A final-gate miss (`orchestrate.js:1209-1211`, blamed on the single plan whose
   changed file name appears in the failure tail) therefore teaches the security reviewer about a lint failure, or `check-plan`
   about a manifest check no finder can see (`missTag`, :497-498).
2. **Stale result.** The final gate result is never stored in `status.json`: `finalGate` is a local variable (`orchestrate.js:1321`)
   passed once as `--final-gate` (:1283). A failed run keeps `phase: stopped`, `stopReason` and `plans[N].misses` containing
   `final gate failed: …`. When the Human re-runs the final gate by hand and it passes, `orch-state.mjs finish` or `lessons`
   (which hard-codes `finalGate: 'none'`, `orch-state.mjs:1000`) rebuilds lesson lines from those misses, and the report
   and the run-log row (`runLogRow`, `orch-run.mjs:563-575`, value from the CLI argument) show the old failure or `-`.

## Goals & Success Criteria
**Primary:** a lesson line reaches only a role that could have caught the problem, decided by script from the run state; after a
passing final-gate re-run, `finish` and `lessons` write the passing result everywhere and never a wrong lesson line.

- [auto] `status.json` has a run-level `finalGate: { ok, command, at, attempt }`, written by a new `orch-state.mjs final-gate
  --run <name> --result ok|failed [--command "<failing command>"]` (the workflow calls it at `orchestrate.js:1202-1217`; the Human
  can call it by hand). Test: the two results, the stored shape, `attempt` counting up.
- [auto] A final-gate failure is no longer written as a free-text `plans[N].misses` entry; `final-gate --result failed` stores the
  failing command and the blamed plan numbers (the existing single-plan rule at :1209-1211) in `finalGate`. A `final-gate --result ok`
  after a failure removes legacy `final gate …` entries from `plans[*].misses` and, when `stopReason` starts with `final gate`,
  clears it and sets `phase` back so `finish` can finish the run. Test with a status.json holding the stale state.
- [auto] Role routing is a table in `orch-run.mjs` (`FINAL_GATE_ROLES`) keyed by the kind of the failing command
  (`test` → `check-bugs`, `check-plan`; `lint` → `check-rules`; `build` → `check-bugs`; `manifest` → `readiness`; `ciMirror` and
  unknown → none); `security` never receives a final-gate lesson. `lessonFacts` uses it. Test in
  `tools/test/orchestrator.test.mjs` (extend the case at :1425): each kind gives its lines to its roles and no others; [ui] misses
  still go to the finders that ran.
- [auto] `lessonFacts` skips every final-gate miss while `status.finalGate.ok === true`, and `orch-state.mjs lessons` and `finish`
  read the final gate from `status.finalGate` (a `--final-gate` argument updates it first); `lessons` no longer hard-codes
  `'none'`. Test: fail → by-hand pass → `lessons` writes no `missed: the final gate failed` line.
- [auto] After `final-gate --result ok|failed` on a run whose `phase` is `finished` or `stopped`, the report (local copy and
  `docs/orchestrator/runs/<run>/report.md`) and the run-log row are rewritten from the stored result in the same call
  (`updateRunLog` already replaces the row of the same run, `orch-run.mjs:640`); the report no longer prints `Stopped: final gate
  failed` after a pass. Test: row says `ok`, report has no stale stop line, a second identical call changes nothing.
- [auto] `npm run build`, `npm run lint`, `npm test`, `node --test "tools/test/*.test.mjs"`, `node tools/orchestrator-e2e.mjs` and
  `node tools/drift-check.mjs --target .` all exit 0.
- [auto] `node scripts/scope-check.mjs --tests --plan=plans/064-lesson-lines-go-only-to-the-role-that-could-have-caught-the-problem-and-the-report-and-run-log-follow-the-final-gate-rerun.plan.md`
  prints `SCOPE_TESTS: ok`, and `node scripts/scope-check.mjs --diff=origin/main` on the finished branch prints `SCOPE: ok`.
- [human] On the Human's PC, after a run that stopped at the final gate: fix the cause, run `node scripts/orch-state.mjs final-gate
  --run <name> --result ok`, and the report and the run-log row show the passing result with no lesson line blaming a reviewer.

## Execution Mode
- Parallel: no
- Concurrent plans: shares `orchestrate.js`, `orch-state.mjs`, `orch-run.mjs` and `tools/test/orchestrator.test.mjs` with 059, 061,
  062 and 063; built last of the 062/063/064 group (Human, 2026-11-02).
- Isolated DB: no

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/scripts/orch-state.mjs
core/scripts/lib/orch-run.mjs
core/.claude/workflows/orchestrate.js
core/docs/agent/orchestrator.md
tools/test/orchestrator.test.mjs
scripts/**
.claude/**
docs/agent/**
docs/brain/**
.kit/install.json
CHANGELOG.md
```

`scripts/**`, `.claude/**`, `docs/agent/**`, `docs/brain/**` and `.kit/install.json` are rendered copies, written only by
`node tools/sync.mjs --target . --apply`.

## Read Scope

Entire repo and its git history.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry.

## Architecture Impact
- INV-none: preserves — only status.json bookkeeping, lesson routing and the report rewrite change; lesson files are still written
  only by script, only on the run branch.

## Step 0 — Reality Check

1. Runs only when `scope-check.mjs --drift` reports `REALITY: drift`: check the listed commits by symbol, print `ok` or
   `conflict: <what>` per commit; stop for a go only on a conflict.
2. Plans 062 and 063 are merged (this plan edits the same files); otherwise stop.
3. Read `finish()` (`orch-state.mjs:1062-1147`), `learnRun()` (:447-469), `lessons()` (:994-1004), `set` miss handling (:827-829)
   and the final-gate block (`orchestrate.js:1202-1217`) as they are after 062.
4. Find how `phase` and `stopReason` are used by `watch` and `finish` (:1068) so clearing them cannot hide a real stop.
5. `node tools/install-check.mjs` and `node --test "tools/test/*.test.mjs"` pass before any edit.

## User Stories
- As the Human, I want a lesson to reach only the agent role that could have prevented the problem.
- As the Human, I want the report and the run log to say what is true after I fixed and re-ran the final gate.

## Functional Requirements

### Must Have (P0)
- [x] `final-gate` subcommand and `status.finalGate`; the workflow calls it; legacy `final gate …` misses removed on a pass.
- [x] `FINAL_GATE_ROLES` routing table and `lessonFacts` changes; final-gate misses skipped on a pass.
- [x] `finish` and `lessons` read `status.finalGate`; `runLogRow` and `formatReport` take the final gate from `status`.
- [x] Rewrite of report and run-log row when the final gate is recorded on a finished/stopped run.
- [x] `orchestrator.md` (status.json fact table, final gate section) and CHANGELOG entry.

### Should Have (P1)
- [ ] `[ui]` misses route by the failed card's area (only finders that ran); unchanged unless Step 0 shows a cheap script attribution.

### Nice to Have (P2)
- None.

## UI/UX Notes
None (scripts and docs only).

## Atomic Sub-tasks

Every step names its own test location.

- [x] A1: Failing tests first — a final-gate miss reaches all finders today; a by-hand pass leaves the stale stop line and the old lesson; Step 0 findings to Execution Notes
  - Scope: `tools/test/orchestrator.test.mjs`
- [x] B1: `status.finalGate`, the `final-gate` subcommand, the workflow call, legacy-miss cleanup; tests
  - Scope: `core/scripts/orch-state.mjs`, `core/.claude/workflows/orchestrate.js`, `tools/test/orchestrator.test.mjs`
- [x] B2: Role routing table and `lessonFacts`; `lessons`/`finish`/`runLogRow`/`formatReport` read `status.finalGate`; tests
  - Scope: `core/scripts/lib/orch-run.mjs`, `core/scripts/orch-state.mjs`, `tools/test/orchestrator.test.mjs`
- [x] B3: Report and run-log rewrite after a re-run; tests
  - Scope: `core/scripts/orch-state.mjs`, `core/scripts/lib/orch-run.mjs`, `tools/test/orchestrator.test.mjs`
- [x] D1: `orchestrator.md`
  - Scope: `core/docs/agent/orchestrator.md`
- [x] R1: Render the installed copies, run every check, add the changelog entry — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .`, build, lint, `npm test`, `node --test "tools/test/*.test.mjs"`, `node tools/orchestrator-e2e.mjs`
  - Scope: `scripts/**`, `.claude/**`, `docs/agent/**`, `docs/brain/**`, `.kit/install.json`, `CHANGELOG.md`

## Technical Considerations
- **Attribution is script-only:** the failing command string, classified by the existing command-kind helper, plus the role
  table; no model decides it and no free text is copied into a lesson (the test at `orchestrator.test.mjs:1798-1819` stays green).
- **Why not keep the miss string and filter it:** a free string has no kind; the structured `finalGate` is the one source both
  `lessonFacts` and the report read, so they cannot disagree.
- **Legacy status.json:** runs written before this plan hold `final gate failed` strings; the cleanup matches that prefix only.
- **Idempotent rewrite:** the report and row are pure functions of `status.json`; a second call changes nothing.

## Out of Scope
- Re-running the final gate by script (the Human or a later relaunch runs it; this plan records and rewrites).
- Reworking how lessons are written to `docs/brain/agent-lessons/<role>.md` beyond routing.
- Changing which plan is blamed for a final-gate failure.

## Critical Questions
- None open. The role table is the Planner's default (assumed, change on a no): `test` → check-bugs + check-plan, `lint` →
  check-rules, `build` → check-bugs, manifest → readiness, ciMirror/unknown → none.

## Execution Notes
- Source: orchestrator test run test-512-422, finding F10, plus the Human's second item (status.json must not keep a final-gate
  failure for roles that could not have caught it, and is corrected by a passing re-run). Facts from the kit at `origin/main`
  `aac496e`. Build order (Human, 2026-11-02): 063, 062, then 064.
- Step 0: drift lists 062/063 commits (db9f3af, 0f2ef30, 4d1241e, 11e1acf): ok, all merged; the symbols this plan edits (`finish`, `learnRun`,
  `lessons`, the final-gate block, `lessonFacts`) are where the plan says. `finish` only turns `running` into `finished`, so clearing a final-gate
  stop (phase back to `finished`, or `running` when there is no report yet) cannot hide another stop: it is cleared only when `stopReason` starts
  with `final gate`.
- decision: agent-chosen (coordinator), UNGRADED: the workflow records the final gate on its existing `finish` call (`--final-gate-command`, `--final-gate-plans`) instead of calling `final-gate` — the plan says "the workflow calls it", but that would be a new per-item runner call; `final-gate` stays for the Human — reverse: add a `state(['final-gate', …])` call before `finish`
- decision: agent-chosen (coordinator), UNGRADED: `attempt` counts changed outcomes (result, command or blamed plans differ from the stored one); an identical repeat is a retry and changes nothing — the plan says only "counting up", and a re-sent call must be idempotent — reverse: always `attempt + 1` in `applyFinalGate`
- decision: agent-chosen (coordinator), UNGRADED: the report/row rewrite runs only when the run has `finishedAt` and phase `finished`/`stopped`; a stopped run with no `finish` yet only stores the result — rewriting there would invent a report before `finish` — reverse: drop the `finishedAt` test in `final-gate`
- decision: agent-chosen (coordinator), UNGRADED: the report gets a `Final gate: ok|failed: <cmd> (attempt N)` line whenever `finalGate` is stored, and the by-hand rewrite does not resend to the kit brain — the plan wants the report to show the passing result — reverse: delete the line in `formatReport`; pass `brain: true` in `final-gate`
- decision: agent-chosen (coordinator), UNGRADED: kind comes from a new `finalGateKind(command)` (no earlier command-kind helper existed; `commandTag` only sanitises); `npm|pnpm|yarn run test*|lint*|build*`, `node --test` and the kit manifest check are classified, `ciMirror` key kept in the table but always empty — reverse: edit `finalGateKind`
- decision: agent-chosen (coordinator), UNGRADED: a legacy status with a `final gate …` miss and no stored `finalGate` is routed by the command inside the miss; `readiness` is taught without the "ran on the plan" filter (it ran on every plan) — reverse: drop the legacy branch in `lessonFacts`
- evidence R1: sync + drift-check ok, build ok, lint ok, npm test ok, `node --test tools/test/*.test.mjs` 448/448, orchestrator-e2e 90 cases, SCOPE_TESTS ok, SCOPE ok.
- seen: the P1 `[ui]` routing is unchanged (Step 0 found no cheap script attribution); `[ui]` misses still go to every finder that ran.
