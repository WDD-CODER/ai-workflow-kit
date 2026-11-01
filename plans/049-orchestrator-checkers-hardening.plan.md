# Plan 049 — Orchestrator checkers hardening: a test-file gate, finders that judge the diff alone, a stop on no progress, and every change measured against the baseline

Status: draft
Depends-on: none
Snapshot: 65f45bb467a35c0a1c007ca8471875077a5aee82

## Problem Statement

The orchestrator comparison of 2026-10-31 concluded the kit stays the orchestrator, and that its weak part is the
checkers. The kit's own baseline (`docs/agent-evals/BASELINE.md`, 2026-10-22, Sonnet, 25 cases, 2 runs each):

| Role (sonnet) | Recall | Precision | Noise |
|---|---|---|---|
| orch-check-bugs | 0.27 | 0.22 | 0.57 |
| orch-check-plan | 0.30 | 0.38 | 0.20 |
| orch-check-rules | 0.25 | 0.25 | 0.67 |
| orch-verify | 0.33 | 1.00 | 0.00 |

Plans 045–048 (the kit brain, `/kit-learn`, the autonomy ladder, the agent improver) all lean on these checkers, so
they are hardened first. Seven gaps, found in the code on `65f45bb`:

1. **Nothing guards test files.** `scope-check.mjs` treats a test file like any other file: a plan whose scope has a
   folder glob (`scripts/**`, `core/**`) lets a builder edit or delete the tests that would catch it, and the
   orchestrator never runs a scope check on the plan branch at all (`orch-state.mjs diff` lists files and sensitivity
   only). ImpossibleBench shows builders editing tests to make them pass.
2. **The finders read the builder's own story.** `checkers()` gives every finder the plan file, which carries the
   builder's `## Execution Notes`, and `orch-check-plan` also gets `REMOVES` (the builder's `removes:` decisions);
   every finder may run `git log` / `git show`, which print the builder's commit messages. A finder that reads "tests
   pass, scope respected" is primed to agree. Nobody has measured whether hiding it finds more.
3. **There is no design reviewer.** No `DESIGN.md` checklist and no design finder exist in the kit (`git grep -i
   "DESIGN.md"` → nothing). A design-track plan is checked only for bugs, plan fit and rules.
4. **Escalation never asks whether the plan is wrong.** On a persisting failure the workflow writes a hand-off and
   starts a fresh judgment-tier builder (`orchestrate.js` ~L994–1001); nothing records whether the plan itself needs a
   change, so a plan that cannot be built as written burns its last round and parks with a code reason.
5. **The builder's receipt is thin.** The builder result has `summary` and `evidence` only — not what it left undone
   or which checks it ran, so the hand-off and the report cannot say what is missing.
6. **No stop on no progress.** A fix round whose builder pushes nothing new still runs gate and checkers again; the
   only loop stop is "the same reason twice", which a reworded finding escapes, so such a plan runs to `maxFixRounds`.
7. **The verifier does not see the gate.** `orch-verify` gets the candidates and the code, not the gate's results, so
   it cannot use "this check ran and passed / failed with this tail" when it keeps or refutes a finding.

## Goals & Success Criteria
**Primary:** each of the seven changes is either adopted because the re-run of the same 25 BASELINE cases shows it
helps (or, for the code-only changes, shows no regression), or left out because it does not — and the Human can see
that in one comparison table.

Measurement rule (applies to every item below): "before" is a fresh re-run on this plan's starting commit, not the
2026-10-22 numbers; Sonnet, 3 runs per case, the 25 case ids listed in BASELINE.md, today's exact-severity scorer.
For each figure, `s` = the larger of the two arms' run-to-run spread (max − min of the 3 run totals) and the real
difference is `d = max(0.05, 2 × s)`.

- [auto] Test-file gate: `node scripts/scope-check.mjs --diff=<base> --plan=<plan>` on a fixture branch that edits
  `tools/test/x.test.mjs` under a plan whose only scope line is `tools/**` prints `SCOPE: test-out tools/test/x.test.mjs`
  and exits 1; with the scope line `tools/test/x.test.mjs` it prints `SCOPE: ok` (tests in `tools/test/`).
- [auto] The orchestrator fails a plan branch that touches a test file outside its scope before any finder runs: in
  `orchestrator.test.mjs` a stub run whose diff reports `testsOutOfScope: ["src/a.test.ts"]` gets a fix round with the
  finding `rule: "test file outside the plan's scope"`, severity `blocker`, and no finder call.
- [auto] Redaction A/B: `node tools/agent-eval.mjs … --redact` gives the agent the case's plan with `## Execution
  Notes` removed and no `REMOVES`, and the agent prompt says to read diffs only (`git diff`, `git show --format=`);
  the test shows the redacted plan text has no Execution Notes heading and keeps every `- [x]` / `- [ ]` line.
- [auto] Redaction adopted only by numbers: `node tools/agent-eval-ab.mjs --before <dir> --after <dir>` prints, per
  finder, `ADOPT` only when recall rises by ≥ d **and** precision after ≥ precision before (two decimals); otherwise
  `REJECT`. The orchestrator change (H2b) is built only for an `ADOPT`; the verdict line is copied into Execution Notes.
- [auto] Design reviewer: with a `DESIGN.md` at the project root and a diff that touches a style or markup file, the
  stub run calls `orch-check-design` with `CHECKLIST: DESIGN.md`; without `DESIGN.md` it is never called (tests);
  `node tools/agent-eval.mjs --agent .claude/agents/orch-check-design.md --cases docs/agent-evals/cases/orch-check-design
  --runs 3 --model sonnet --json` runs on its 3 new cases and the numbers are recorded as its first baseline.
- [auto] Escalation records a replan verdict: the builder result has `planChange: { needed, why }`; every escalation
  writes `replan: yes|no — <why>` into the hand-off file and status.json; a judgment-tier builder that returns
  `needed: true` parks the plan with `replan needed: <why>` instead of using another round (tests).
- [auto] Richer receipt: the builder result requires `done`, `notDone` and `checksRun` (`[{command, status}]`); no
  token or usage field is added; a receipt that says a check passed which the gate failed adds the run note
  `receipt contradicts gate: <command>`; pass is still computed from the gate's results (test: a receipt claiming
  every check passed next to a failing gate still fails the plan).
- [auto] Circuit breaker: two fix rounds in a row that end on the same head sha as they started (the `sha` status.json
  holds) park the plan with `no progress: head <short sha> unchanged across 2 fix rounds (fix rounds used: n of
  maxFixRounds)` — test with a stub builder that returns the same `headSha` and `maxFixRounds: 5` parks after round 2.
- [auto] The verifier gets the gate: the verify task carries `GATE` (each command, status and a 20-line tail) from the
  last worktree gate of the same round (test); `--with-gate` in agent-eval passes a case's `input/gate.json`.
- [auto] Pass stays computed by script: the existing test "finder pass: true next to a blocker is recomputed" still
  passes, and new tests show the verifier's `pass`, the builder's `checksRun` and the design finder's `pass` never
  turn a failure into a pass.
- [auto] Before/after table: `docs/agent-evals/049-checkers-hardening.md` exists with, per role, the before run, every
  experiment arm and the after run (recall, precision, noise, errors, spread, d, cost), and one verdict per figure
  printed by `agent-eval-ab.mjs` (`improved` / `regressed` / `no real change`) — never typed by hand. The raw reports
  are under `docs/agent-evals/runs/049-*/`.
- [auto] No adopted change regresses a figure: in the after-vs-before table no role has a `regressed` verdict on
  recall, precision or noise; a `regressed` figure means the step that caused it is reverted (or the Human keeps it
  in writing in Execution Notes).
- [auto] `npm run build`, `npm run lint`, `npm test`, `node --test "tools/test/*.test.mjs"`,
  `node tools/drift-check.mjs --target .` pass.
- [human] The Human reads `docs/agent-evals/049-checkers-hardening.md` and accepts each ADOPT / REJECT and the
  after-run numbers before the PR merges.

### What counts as an improvement and a regression, per baseline figure

The 2026-10-22 numbers are the reference the Human knows; the judgement is always made against this plan's own
"before" run (the agent files changed since 2026-10-22 — plans 025, 030, 032 and 042 edited them).

| Figure (sonnet) | Baseline | Expected to move by | Improvement | Regression |
|---|---|---|---|---|
| check-bugs recall | 0.27 | H2 (redaction) | after − before ≥ d | before − after ≥ d |
| check-bugs precision | 0.22 | H2 | after − before ≥ d (for H2 adoption: after ≥ before is enough) | after < before − 0.02 (for H2 adoption: any drop) |
| check-bugs noise | 0.57 | H2 | before − after ≥ d | after − before ≥ d |
| check-plan recall | 0.30 | H2 | after − before ≥ d | before − after ≥ d |
| check-plan precision | 0.38 | H2 | as check-bugs precision | as check-bugs precision |
| check-plan noise | 0.20 | H2 | before − after ≥ d | after − before ≥ d |
| check-rules recall | 0.25 | H2 | after − before ≥ d | before − after ≥ d |
| check-rules precision | 0.25 | H2 | as check-bugs precision | as check-bugs precision |
| check-rules noise | 0.67 | H2 | before − after ≥ d | after − before ≥ d |
| verify recall (kept real findings) | 0.33 | H7 (gate output) | after − before ≥ d (one more real finding kept in the 3 cases is +0.33) | before − after ≥ d |
| verify precision (false alarms refuted) | 1.00 | H7 — must not move | — (already at the ceiling) | any value below 1.00 |
| errors (invalid JSON) per role | bugs 1, others 0 | none | — | +2 or more over before |
| cost per role | bugs 3.03, plan 0.73, rules 0.57, verify 2.08 USD (2 runs) | H2 a little down, H7 a little up | reported, not judged | over +20 % per case: named in the table for the Human |

H1, H4, H5 and H6 change code paths the 25 cases do not exercise; they are judged by "no regressed figure in the
after run" plus their own `[auto]` tests. The new design finder has no baseline: its first numbers become one.

## Execution Mode
- Parallel: no
- Concurrent plans: none. Runs before 045 (045 gets `Depends-on: …, 049`, so 046–048 follow). Plan 048 changes the
  same scorer files later (severity tolerance); this plan keeps the scorer exact so its numbers compare with BASELINE.
- Isolated DB: no

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/scripts/scope-check.mjs
core/scripts/lib/plan-scope.mjs
core/scripts/lib/redact.mjs
core/scripts/orch-state.mjs
core/.claude/workflows/orchestrate.js
core/.claude/agents/orch-builder.md
core/.claude/agents/orch-check-bugs.md
core/.claude/agents/orch-check-plan.md
core/.claude/agents/orch-check-rules.md
core/.claude/agents/orch-security.md
core/.claude/agents/orch-verify.md
core/.claude/agents/orch-check-design.md
core/docs/agent/orchestrator.md
core/docs/agent/agent-roles.md
core/docs/agent/model-routing.md
core/docs/agent/agent-evals.md
tools/agent-eval.mjs
tools/agent-eval-ab.mjs
tools/lib/agent-eval/run.mjs
tools/test/scope-tests-gate.test.mjs
tools/test/orchestrator.test.mjs
tools/test/agent-eval.test.mjs
tools/test/agent-eval-ab.test.mjs
tools/test/agent-contracts.test.mjs
tools/test/eval-cases.test.mjs
tools/test/fixtures/**
docs/agent-evals/BASELINE.md
docs/agent-evals/049-checkers-hardening.md
docs/agent-evals/baseline-2026-10-22.cases.txt
docs/agent-evals/runs/049-*/**
docs/agent-evals/cases/orch-verify/*/input/gate.json
docs/agent-evals/cases/orch-check-design/**
scripts/**
.claude/**
docs/agent/**
.kit/install.json
plans/045-the-kit-brain-every-run-sends-its-facts-to-a-private-mongodb-store-with-no-model-call-and-no-write-access-to-the-kit.plan.md
CHANGELOG.md
README.md
```

`scripts/**`, `.claude/**`, `docs/agent/**` and `.kit/install.json` are the rendered copies, written only by
`node tools/sync.mjs --target . --apply` (R1). The 045 path is only for its `Depends-on:` line, added at save time.
No existing case's `expected.json` or `input/plan.md` / `input/diff.patch` is edited: the 25 cases stay the same cases.

## Read Scope

Entire repo and its git history.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry.

## Architecture Impact
- INV-none: preserves — `docs/brain/invariants.md` holds only the template entry; this plan adds checks and inputs
  to the orchestrator and never moves a decision from code to a model (pass stays computed by script).

## Step 0 — Reality Check

1. Runs only when `scope-check.mjs --drift` reports `REALITY: drift`: check the listed commits by symbol and print
   `ok` or `conflict: <what>` per commit; stop for a go only on a conflict.
2. Always: `git log --oneline 9173793..HEAD -- docs/agent-evals/cases tools/lib/agent-eval/compare.mjs
   tools/lib/agent-eval/score.mjs` — a change to one of the 25 cases' labels or to the scorer since the baseline is
   written into Execution Notes (the before run absorbs it; it is not a reason to stop).

## User Stories
- As the Human, I want a builder never to pass by editing the tests that would catch it.
- As the Human, I want every checker change kept only when the same cases show it finds more without more false alarms.
- As the Human, I want a run to stop when a builder makes no progress, and to tell me when the plan, not the code, is wrong.

## Functional Requirements

### Must Have (P0)
- [ ] Test-file gate in `scope-check --diff` and in the orchestrator, computed by script.
- [ ] Before and after runs of the 25 BASELINE cases, with the comparison table and script-computed verdicts.
- [ ] Redaction A/B with the adoption rule; the orchestrator change only on `ADOPT`.
- [ ] Circuit breaker on an unchanged head sha.
- [ ] The verifier gets the gate output.

### Should Have (P1)
- [ ] Replan verdict on escalation.
- [ ] Richer builder receipt.

### Nice to Have (P2)
- [ ] Design finder with a `DESIGN.md` checklist (see Critical Questions).

## UI/UX Notes
- Terminal and run-report text only. New park reasons and notes are the exact strings in Goals.

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [ ] H0: Measure the starting point on the same 25 cases before anything changes — `docs/agent-evals/baseline-2026-10-22.cases.txt` (the 25 case ids BASELINE.md lists, one `<role>/<case>` per line; the two check-plan cases added later are not in it); `agent-eval.mjs --case-list <file>` runs only those; `--json` keeps per-run totals so the spread can be computed; `tools/agent-eval-ab.mjs --before <dir> --after <dir> [--adopt-rule redaction]` prints the table and a verdict per figure from the rule in Goals; run the 4 roles × sonnet × 3 runs on the plan's starting commit into `docs/agent-evals/runs/049-before/` — tools/agent-eval.mjs, tools/lib/agent-eval/run.mjs, tools/agent-eval-ab.mjs, tools/test/agent-eval.test.mjs, tools/test/agent-eval-ab.test.mjs, docs/agent-evals/baseline-2026-10-22.cases.txt, docs/agent-evals/runs/049-before/**
- [ ] H1: Fail a branch that touches a test file the plan's scope does not name — `isTestPath()` in plan-scope.mjs (`**/*.test.*`, `**/*.spec.*`, `**/test/**`, `**/tests/**`, `**/__tests__/**`, `e2e/**`); a test file counts as listed only when a scope line that itself names a test location matches it (`tools/test/**`, `src/a.test.ts`), never through a broad folder glob; `--diff` prints `SCOPE: test-out <path>` and exits 1 (so `/ship`'s ship-prep gets it too); `orch-state.mjs diff` returns `testsOutOfScope`; `checkers()` turns a non-empty list into a blocker finding before any finder runs — core/scripts/lib/plan-scope.mjs, core/scripts/scope-check.mjs, core/scripts/orch-state.mjs, core/.claude/workflows/orchestrate.js, tools/test/scope-tests-gate.test.mjs, tools/test/orchestrator.test.mjs, tools/test/fixtures/**
- [ ] H2a: Measure whether finders find more when they do not see the builder's claims — `core/scripts/lib/redact.mjs` (drop `## Execution Notes`, keep every checkbox line); `agent-eval.mjs --redact` applies it to the case plan and adds the "diffs only, no commit messages" line to the prompt; run check-bugs, check-plan, check-rules × sonnet × 3 runs into `docs/agent-evals/runs/049-redact/`; `agent-eval-ab.mjs --adopt-rule redaction` gives ADOPT / REJECT per finder — core/scripts/lib/redact.mjs, tools/agent-eval.mjs, tools/lib/agent-eval/run.mjs, tools/test/agent-eval.test.mjs, docs/agent-evals/runs/049-redact/**
- [ ] H2b: Give the finders the redacted plan in real runs, only for finders that got ADOPT — `orch-state.mjs redact --run --plan` writes `.claude/sessions/orch-<run>/plan-<NNN>.redacted.md`; `checkers()` passes it as `PLAN` (and drops `REMOVES`) for adopted finders; their agent files say to read diffs only; `orch-security` follows check-bugs' verdict (it has no cases, said in the table) — skipped with a line in Execution Notes when no finder got ADOPT — core/scripts/orch-state.mjs, core/.claude/workflows/orchestrate.js, core/.claude/agents/orch-check-bugs.md, core/.claude/agents/orch-check-plan.md, core/.claude/agents/orch-check-rules.md, core/.claude/agents/orch-security.md, tools/test/orchestrator.test.mjs
- [ ] H3: Add a design finder that checks a design-touching diff against the project's DESIGN.md checklist — new `orch-check-design` (read-only, same finder schema, runs like `orch-security`: only when `DESIGN.md` exists at the project root and the diff touches `**/*.{css,scss,less,html,jsx,tsx,vue,svelte}` or the plan has `Track: design|split`); gets the diff file list and `CHECKLIST: DESIGN.md`; registered in agent-roles and model-routing (review tier, never Haiku); 3 new cases (one planted checklist break, one clean, one break in a file the checklist does not cover) and its first measured numbers — core/.claude/agents/orch-check-design.md, core/scripts/orch-state.mjs, core/.claude/workflows/orchestrate.js, core/docs/agent/agent-roles.md, core/docs/agent/model-routing.md, docs/agent-evals/cases/orch-check-design/**, tools/test/orchestrator.test.mjs, tools/test/agent-contracts.test.mjs, tools/test/eval-cases.test.mjs
- [ ] H4: Make every escalation say whether the plan itself must change — builder schema `planChange: { needed: boolean, why: string }` (required on ESCALATE and blocked); `orch-state.mjs handoff --replan yes|no --replan-why <text>` writes `replan:` into the hand-off and status.json; a judgment-tier builder with `needed: true` parks with `replan needed: <why>`; the builder file says when to answer yes (a Done-when item or a scope line that cannot hold as written) — core/.claude/workflows/orchestrate.js, core/scripts/orch-state.mjs, core/.claude/agents/orch-builder.md, core/docs/agent/orchestrator.md, tools/test/orchestrator.test.mjs
- [ ] H5: Make the builder say what it did, what it did not do and which checks it ran — builder schema requires `done`, `notDone`, `checksRun: [{command, status}]` (no token or usage data — that is 045 Step 0); the hand-off and the run report show `notDone`; a `checksRun` pass that the gate failed adds `receipt contradicts gate: <command>`; the receipt never reaches the finders — core/.claude/workflows/orchestrate.js, core/.claude/agents/orch-builder.md, core/docs/agent/orchestrator.md, tools/test/orchestrator.test.mjs
- [ ] H6: Stop a plan whose builder makes no progress instead of running to the round limit — in `runPlan()` keep the sha status.json holds when a fix round starts; a round whose builder returns that same `headSha` counts as "no progress"; two in a row park with the reason in Goals — core/.claude/workflows/orchestrate.js, core/docs/agent/orchestrator.md, tools/test/orchestrator.test.mjs
- [ ] H7: Give the verifier the gate's results so it can keep or refute with them — the verify task gets `GATE` (command, status, 20-line tail of the round's worktree gate); `orch-verify.md` says how to use it and that it never decides pass; `input/gate.json` for the 3 verify cases (what the gate printed on the case's commit — the project checks passed, since each bug got past them); `--with-gate`; run verify × sonnet × 3 runs into `docs/agent-evals/runs/049-gate/` and compare with H0 — core/.claude/workflows/orchestrate.js, core/.claude/agents/orch-verify.md, tools/lib/agent-eval/run.mjs, tools/agent-eval.mjs, docs/agent-evals/cases/orch-verify/*/input/gate.json, docs/agent-evals/runs/049-gate/**, tools/test/orchestrator.test.mjs, tools/test/agent-eval.test.mjs
- [ ] H8: Re-run the same 25 cases on the finished branch and publish the comparison — 4 roles × sonnet × 3 runs into `docs/agent-evals/runs/049-after/` with every adopted change in place (H2b's redaction and H7's gate on); `agent-eval-ab.mjs` writes `docs/agent-evals/049-checkers-hardening.md` (before, each arm, after, verdicts, cost); a `regressed` figure → revert the step that caused it and re-run that role; add a short "After plan 049" section to BASELINE.md pointing to the new file (the 2026-10-22 tables stay) — docs/agent-evals/049-checkers-hardening.md, docs/agent-evals/runs/049-after/**, docs/agent-evals/BASELINE.md
- [ ] D1: Document the test-file gate, the redaction result, the design finder, replan, the receipt, the no-progress stop and the verifier's gate input — core/docs/agent/orchestrator.md, core/docs/agent/agent-roles.md, core/docs/agent/agent-evals.md, CHANGELOG.md
- [ ] R1: Render the kit's own installed copies and check drift — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .` — scripts/**, .claude/**, docs/agent/**, .kit/install.json

## Technical Considerations
- Dependencies: `orchestrate.js` (`checkers()`, `runPlan()`, `SCHEMA.builder`), `orch-state.mjs` (`diff`, `handoff`),
  `scope-check.mjs` `--diff` (used by `ship-prep.mjs`, so `/ship` gets the test gate too), `tools/lib/agent-eval/run.mjs`.
- New files: `core/scripts/lib/redact.mjs`, `core/.claude/agents/orch-check-design.md`, `tools/agent-eval-ab.mjs`,
  the case list, the comparison doc, 3 design cases, 3 `gate.json` inputs, two test files.
- Model changes: builder result gains `planChange`, `done`, `notDone`, `checksRun`; verify task gains `GATE`;
  `orch-state diff` gains `testsOutOfScope` (and `design` for H3).
- Backend / API: none. Auth and validation: none. Data / migration: none.
- Security surface: the test-file gate closes a way for a builder to pass by weakening tests. Redacted plan copies
  go only under `.claude/sessions/`.
- Pass is computed by script everywhere: the gate from its results, finders from their problems' severities, the
  verifier from verdicts and the keep threshold, the test gate and the no-progress stop from git and status.json.
  New fields (`checksRun`, the design finder's `pass`) are recorded, never trusted.
- Noise: 3–14 cases per role and 3 runs; one case moves recall by 0.07–0.33. That is why every verdict uses
  `d = max(0.05, 2 × spread)` and why H2 needs a recall gain with no precision drop. The scorer stays exact-severity
  (plan 048 adds tolerance later), so these numbers compare with BASELINE.md.
- Cost estimate (BASELINE sonnet, 2 runs: bugs 3.03 + plan 0.73 + rules 0.57 + verify 2.08 = 6.41 USD): 3 runs ≈
  9.6 USD per full pass. H0 9.6 + H2a ≈ 6.5 + H3 ≈ 1 + H7 ≈ 3.1 + H8 9.6 ≈ **30 USD**, plus re-runs after a revert.
- Lock groups: every sub-task names its exact files; the shared hot file is `orchestrate.js` (H1, H2b, H3–H7), so
  those steps run one after another in this order.

## Out of Scope
- Changing the scorer or any existing case's labels (plan 048). Token or usage data in the receipt (045 Step 0).
- Changing models per role. Improving `orch-builder` beyond its result fields. Cases for `orch-security`.
- Writing a `DESIGN.md` for any project — the finder reads a project's own file.
- Any change to plans 045–048 except 045's `Depends-on:` line.

## Critical Questions
- Q: Test-file gate — fail or only flag? A: fail (a blocker finding, so the builder gets a fix round) (Human,
  2026-11-01).
- Q: Does a broad folder glob (`tools/**`) count as listing the tests under it? A: no — only a scope line that names a
  test location counts; this is what makes the gate bite (045 and 048 already name their test files; a plan that
  relies on a folder glob for its tests must add a test line).
- Q: The kit has no design reviewer and no `DESIGN.md` today. Build a new conditional finder `orch-check-design`
  (H3 as written), or add the checklist to `orch-check-plan` instead, or drop H3? A: H3 as written (Human, 2026-11-01).
- Q: Runs per case — 3 (≈30 USD, gives the spread the verdicts need) or 2 like BASELINE (≈20 USD, spread from 2
  runs)? A: 3 (Human, 2026-11-01).
- Q: "No drop in precision" for the redaction adoption — exact (after ≥ before at two decimals) or within 0.02?
  A: exact, as the brief says.

## Execution Notes
- Source: the orchestrator comparison of 2026-10-31 (the kit stays; the checkers are the weak part) and
  `docs/agent-evals/BASELINE.md` (2026-10-22). Code facts checked on `65f45bb`: finders get `PLAN`, `BRANCH`, `BASE`,
  `FOLDER`, `FILES` (+ `REMOVES` for check-plan) and may run `git log`; verify gets no gate output; escalation at
  `orchestrate.js` ~L994; the only loop stop is "same reason twice" (~L987); `orch-state diff` has no scope check.
