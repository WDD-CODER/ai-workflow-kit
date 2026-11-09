# Plan 101 — A plan may change the test file next to a file in its scope, and readiness finds the tests it forgot

Status: done
Depends-on: none
Snapshot: 99037d4
Source: the stops audit of 16 FoodVibe runs, mapped on 2026-11-08 (group A: stops #13, 16, 19, 24, 25, 26, 27). The Human took every recommendation on 2026-11-08. Reliability fix, allowed in the freeze; no new capability.

## Problem Statement
The test-file gate (`lib/plan-scope.mjs` `testFilesOutOfScope`) refuses any changed test file unless a scope line itself names a test location. It exists so a builder cannot edit the tests that would catch it. In practice the planner listed `src/x.component.ts` and the builder had to change `src/x.component.spec.ts` next to it:

- 7 of the 36 audited stops were this one cause, each a park "replan needed" after a fix round and a judgment-tier builder.
- In run-517 alone, plans 535, 374 and 510 spent about 5.2 M input tokens and 44 minutes of builder time, all discarded; each needed the Human to add scope lines and start a new run.
- Plan 098 makes such an ESCALATE park at once (no judgment call), which saves the tokens but still stops the plan.

## Goals & Success Criteria
**Primary:** a plan's builder may change or add the test file that sits next to a source file its scope lists, without a scope line for it, and still may not weaken an existing test without the reviewer seeing it; a plan that needs any other test location is flagged before any builder runs.

- [auto] `node --test tools/test/scope-tests-gate.test.mjs` passes, with tests that fail on today's code:
  (a) scope `src/app/x.component.ts`; changed `src/app/x.component.spec.ts` → allowed (a sibling test);
  (b) scope `src/app/feature/**`; changed `src/app/feature/y.service.spec.ts` → allowed (the source file `y.service.ts` matches the glob);
  (c) scope `src/app/x.component.ts`; changed `src/app/other.component.spec.ts` or `e2e/x.spec.ts` → refused with today's reason;
  (d) a sibling test is a file whose path, with one of `.spec.` / `.test.` / `_spec.` / `_test.` removed, is a path the scope covers, in the same folder (a `__tests__/` folder directly under that folder counts as the same folder);
  (e) an existing sibling test whose diff removes a line holding `expect(`, `assert`, ` it(`, ` test(` or `describe(` is refused with `sibling test weakened: <file>:<line> — name the test in the scope to change its assertions`; adding lines is always allowed.
- [auto] The reviewer agent (`plan-reviewer.md`) has a blocking rule, with a kit eval case that fails without it: any changed test file in the diff gets a check. A test made easier to pass is a STOP. That covers a loosened matcher, a skipped or focused test (`.skip`, `xit`, `.only`), a widened timeout, a mock that replaces the unit under test, or a new test that asserts nothing the plan's goal names. The finding quotes the test line and the source line it no longer checks.
- [auto] `node --test tools/test/run-plans.test.mjs` passes, with a test that fails today: a plan whose sub-tasks or Done-when name a test path that is neither listed in the scope nor a sibling test is `NOT READY` in the dry run, with the exact scope line to add.
- [auto] The same rule is used by every reader of the test-file gate (the run's gate, `orch-state.mjs diff` `testsOutOfScope`, `scope-check`, the dry run of plan 098): one function in `lib/plan-scope.mjs`, no second copy (`grep -c "function testFilesOutOfScope" core/scripts/lib/plan-scope.mjs` = 1, and no other file defines it).
- [auto] The planner's plan-writing guidance (the doc that tells it how to write `## Read-Write Scope`) says that a sibling test needs no line and that any other test location does; `docs/agent/orchestrator.md` describes the rule.
- [auto] `npm run build`, `npm run lint`, `npm test` and `node tools/drift-check.mjs --target .` pass (the builder runs the kit sync with apply first; it is a step, not a check).
- [human] On the installed project, a run of a plan that lists only a component file, whose fix needs its `.spec.ts`, merges without a park (reply `ok`).

## Execution Mode
- Parallel: no.
- Concurrent plans: none.
- Isolated DB: no.
- Run: in the same run as 100, 102, 103, 104 (`/orchestrate 100,101,102,103,104`). `orch/<run>` merges into `main` only by a PR the Human approves.
- Fallback: when the dry run says `WOULD START: no`, append one line with the date and the reason to `docs/brain/error-review.md` first, then build this plan by the solo flow (`feat/101-<slug>`, then `/ship`).

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspots `CHANGELOG.md` and `docs/brain/error-review.md`.

```scope
core/scripts/lib/plan-scope.mjs
scripts/lib/plan-scope.mjs
core/scripts/scope-check.mjs
scripts/scope-check.mjs
core/scripts/orch-state.mjs
scripts/orch-state.mjs
core/scripts/run-plans.mjs
scripts/run-plans.mjs
core/scripts/lib/plan-gate.mjs
scripts/lib/plan-gate.mjs
core/docs/agent/orchestrator.md
docs/agent/orchestrator.md
core/.claude/agents/plan-reviewer.md
.claude/agents/plan-reviewer.md
docs/agent-evals/cases/**
core/.claude/commands/plan.md
.claude/commands/plan.md
core/.claude/references/prd-template.md
.claude/references/prd-template.md
core/.claude/skills/save-plan/SKILL.md
.claude/skills/save-plan/SKILL.md
tools/test/scope-tests-gate.test.mjs
tools/test/run-plans.test.mjs
CHANGELOG.md
docs/brain/error-review.md
```

The plan-writing docs are `plan.md` l.68–70, `prd-template.md` l.32–33 and `save-plan/SKILL.md` (the `## Read-Write Scope` rule): each says "a code-folder glob does not cover the tests under it". `plan.md` is at 179 of its 180-line budget (`tools/size-budget.json` `commandLinesExcept`): reword in place and add no line.

## Read Scope

Entire repo.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a step needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry.

## Architecture Impact
- INV-1: preserves — the readiness check in `run-plans.mjs` only reads plan text and scope globs; it calls no model and changes no role's model tier.
- INV-none other expected — Step 0 confirms. If an invariant or ADR in `docs/brain/` states the rule "a code-folder glob never lists the tests under it", this plan changes it: STOP and ask the Human for `approve arch change INV-n` before S3.

## Step 0 — Reality Check
1. `lib/plan-scope.mjs` l.55–82 (`isTestPath` l.55, `testScopeGlobs` l.61, `testLocationReason` l.70, `testFilesOutOfScope` l.78; checked at bf8926e): the matcher is passed in; the sibling rule needs the scope globs and the changed file only, plus the diff for case (e).
2. Every caller of `testFilesOutOfScope` (`grep -rn testFilesOutOfScope core/`): `run-plans.mjs` `testsOutOfScope` l.412–415 (the dry run), `orch-state.mjs diff` l.1223 (`testsOutOfScope`), `scope-check.mjs` l.206. The gate's `scopeCheck` (`lib/plan-gate.mjs` l.39) checks the scope only and does not call it: find where the run's gate reads `testsOutOfScope` and keep that one path. Each caller passes the diff it already has, or gets it from git.
3. `docs/brain/invariants.md` and `docs/brain/decisions/`: whether the test-location rule is an invariant or an ADR (see Architecture Impact).
4. The plan-writing docs are named under the scope block; `lib/scope-tests-lint.mjs` (the save-plan warning) keeps warning when a scope names code and no test location, since a test outside the same folder still needs a line.
5. Plan 098 S7 (the dry run runs the gate's test-file check, `run-plans.mjs` `testsOutOfScope` l.412): the readiness check of this plan extends that call, not a copy of it.

## Atomic Sub-tasks
- [x] S1: Write the failing tests first for siblings, globs, non-siblings, the same-folder rule and a weakened test — cases (a)–(e) — tools/test/scope-tests-gate.test.mjs
- [x] S2: Write the failing test that readiness names the scope line a plan's own test path needs — tools/test/run-plans.test.mjs
- [x] S3: Let the test next to a scoped file through, and refuse it when an assertion is removed — sibling rule, weakened-test reason — core/scripts/lib/plan-scope.mjs
- [x] S4: Give every caller the diff it needs for the weakened-test check — core/scripts/lib/plan-gate.mjs, core/scripts/orch-state.mjs, core/scripts/scope-check.mjs
- [x] S5: Flag before the build the test locations a plan names but its scope doesn't cover — core/scripts/run-plans.mjs
- [x] S5b: Make the reviewer stop a test made easier to pass, with an eval case of a loosened matcher and one of a skipped test — core/.claude/agents/plan-reviewer.md, docs/agent-evals/cases/**
- [x] S6: Tell the planner and the docs the new rule — core/.claude/commands/plan.md (no added line), core/.claude/references/prd-template.md, core/.claude/skills/save-plan/SKILL.md, core/docs/agent/orchestrator.md
- [x] S7: Resync the installed copies, run every check, add the changelog entry — CHANGELOG.md

## Technical Considerations
- The weakened-test check is line-based on the diff (removed lines only); a renamed assertion shows as a removed line and is refused. The fix is a scope line, which the plan's author decides.
- The reviewer still sees every changed test in the diff; the sibling rule only removes the park.
- A new sibling test file (added, not changed) has no removed lines and is always allowed.

## Out of Scope
Test folders other than a `__tests__/` directly beside the source (for example `e2e/`, `cypress/`, `tools/test/`): they still need a scope line. Questions about scope during a run (plan 104).

## Critical Questions
None open. (The Human took the recommendation on 2026-11-08: only test files next to a file in the scope, not every test folder of the project.)

## Execution Notes
- 2026-11-08 Planner: Depends-on no longer names 098 — it is merged into main (4518804); its open [human] item does not gate this code, and the run would otherwise rebuild it.
- 2026-11-08 Planner: the `.claude/` part is already done by hand on this branch, because an unattended builder is refused every edit under `.claude/` ("sensitive file"): the S5b reviewer rule in `core/.claude/agents/plan-reviewer.md`, and the S6 wording in `core/.claude/commands/plan.md`, `core/.claude/references/prd-template.md` and `core/.claude/skills/save-plan/SKILL.md` (sources and installed copies). The builder does not edit any `.claude/` file; it builds the rest (S1–S5, the S5b eval cases under `docs/agent-evals/cases/`, the `docs/agent/orchestrator.md` part of S6, S7).
- 2026-11-08 Builder: a sibling test also counts as in scope for the plain scope check (scope-check.mjs buildMatcher, lib/plan-gate.mjs scopeCheck); without it `SCOPE: out` fired before the test-file gate. Both files are already in the scope block.
- Evidence: scope-tests-gate test -> exit 0, pass 10; run-plans test -> exit 0; npm run build/lint/test -> exit 0; drift-check -> exit 0; eval-cases test -> exit 0.
- Reviewer eval cases: docs/agent-evals/cases/plan-reviewer/planted-loosened-matcher and planted-skipped-test.
