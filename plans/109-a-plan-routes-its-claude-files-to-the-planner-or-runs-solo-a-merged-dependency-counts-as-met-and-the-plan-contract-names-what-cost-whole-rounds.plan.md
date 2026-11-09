# Plan 109 — a plan routes its `.claude/` files to the Planner or runs solo, a merged dependency counts as met, and the plan contract names what cost whole rounds

Status: draft
Parked: 2026-11-09 — the Human froze new work until the workflow runs clean on FoodVibe; reopen only when a validation case, a CI check or a real run fails on what this plan fixes.
Depends-on: none
Snapshot: bf79f22
Source: Human, 2026-11-09 — "is there a gap between how we write plans and how the orchestrator works today?" The
Execution Notes of plans 097–104 and `docs/brain/error-review.md` (run-095, run-100) show seven authoring patterns
that parked plans or needed the Planner's hand; five of them are rules for the plan contract, one is a readiness check,
one is a dependency rule. Reliability fix, allowed in the freeze (Human, 2026-11-09); no new agent, no model call, no
`kit.config.json` key.

## Problem Statement
1. **`.claude/**` edits by an unattended builder are refused** (Claude Code's sensitive-file protection; only bypass
   mode lifts it — error-review run-100). Plan 100 spent one Sonnet and one Opus call (9.5 M input tokens) on edits
   that could never land; 101 and 104 were split by hand after the fact. Nothing in readiness looks at the scope for
   those paths, and nothing in the plan says who does them.
2. **A dependency that is merged but not `done` is treated as not met.** Plans 100–103 named `Depends-on: 098, 099`;
   both were merged into `main` (4518804) with only their `[human]` release item open, and the Planner removed the
   lines by hand because "the run would otherwise rebuild them". `Depends-on` means "merged before this starts", and
   a `[human]` item that needs a kit release cannot gate code on `main`.
3. **The template does not say what the runs taught.** (i) 103 wrote "tests that fail on today's code"; the builder
   wrote regex tests on the runner's source and three fresh reviews said STOP. (ii) 103 and 104 both needed the shared
   fixture `tools/test/lib/run-plans-fixture.mjs`, outside their scope, and waited for `approved:`. (iii) Step 0 lines
   like `openQuestions (l.125)` were stale before 100–104 started and had to be fixed first. (iv) 098 bundled eight
   problems and 103 eight cases; both were finished by hand, while 097 (five cases) merged in one round. (v) 098 added
   a `kit.config.json` key and hit the 15-key cap mid-run. (vi) Every plan 097–104 repeats the gate's own checks in its
   Done-when (`npm run build`, `lint`, `npm test`, the test glob), which plan 108 shows runs them twice.

## Goals & Success Criteria
**Primary:** a plan that touches `.claude/**` says who does it and readiness enforces that; a dependency merged into
`main` is met; the plan contract carries the six rules so the Planner's review catches them before a builder pays.

- [auto] `node --test tools/test/plan-routing.test.mjs` passes, with cases that fail on today's code (string fixtures
  through `lintPlan`'s helpers; no fake run):
  (a) a plan whose scope block has an entry under `.claude/` or `core/.claude/` and whose `## Execution Mode` has no
  `Planner-only files:` line naming it (glob match) and no `Solo: yes` line is `NOT READY` with
  `.claude/ in scope: <path> — add it to "Planner-only files:" (done by the Planner before the run) or set "Solo: yes"`;
  (b) with `Planner-only files: <paths>` covering every such entry the plan is ready, the dry run prints
  `planner-only: <paths> (committed before the run)`, and the builder prompt carries `Never edit: <paths> — the Planner
  did them before the run` (string test on `builderPrompt`);
  (c) with `Solo: yes` the plan is `NOT READY` with `run this plan solo: its work is under .claude/` and no model call;
  (d) a `Depends-on` plan not in the run is met when its number appears in a merge subject on `origin/main`
  (`plan-order`'s existing merged test, or the anchored subject `(plan NNN)`) or its plan file is `done` — a `draft`
  plan merged into `main` with an open `[human]` item is met; an unmerged `draft` is not, as today. The same rule in
  `take-plan`'s refusal, if it has its own check (Step 0 says which).
- [auto] `.claude/references/prd-template.md` (installed copy) has, in `## Execution Mode`, the two optional lines
  `Planner-only files: <paths under .claude/, done before the run> | none` and `Solo: yes | no`, and in Done-when one
  fixed line with no backticked command — `- [auto] The gate's own checks pass (build, lint, test, scope, drift): the
  orchestrator's gate or /ship Phase 1 is the proof; list only the test files this plan adds or changes` — in place of
  the per-plan repeat of those commands; `node tools/instruction-load.mjs` stays ≤ 800 (size budget `instructionLoad`).
- [auto] `.claude/skills/save-plan/SKILL.md` (installed copy) checklist has one line each for: (i) a Done-when for
  behaviour names the test level ("end-to-end on <fixture>" or "unit on <module>"); a test that only matches source
  text is not a check; (ii) a test that needs a shared fixture names the fixture's folder in the scope; (iii) Step 0 and
  the Problem Statement point at symbols (`lintPlan()`), never at line numbers; (iv) at most five `[auto]` cases per
  plan — more is two plans; (v) no new configuration key without naming the key it removes (a code constant with a
  test-only override instead); (vi) `.claude/**` in scope needs `Planner-only files:` or `Solo: yes`. `grep -c` of six
  marker words the plan picks (Step 0) = 6.
- [auto] `plans/README.md` names the kit's own instances: the shared fixture is `tools/test/lib/**` and goes in the
  scope of every plan that tests the runner; the key cap is `orchestratorKeys` in `tools/size-budget.json`; a kit plan
  with `Solo: yes` is built on `feat/NNN-<slug>` in this folder and shipped with `/ship`.
- [auto] The gate's own checks pass: `npm run build`, `npm run lint`, `npm test`, `node --test
  tools/test/size-budget.test.mjs`, `node tools/drift-check.mjs --target .` (the builder runs the kit sync with apply
  first; it is a step, not a check).
- [human] The next kit plan written with `/plan` after this one carries the Execution Mode lines and the fixed Done-when
  line, and its dry run prints the `planner-only:` line when it touches `.claude/` (reply `ok` with the plan number).

## Execution Mode
- Parallel: no. Concurrent plans: none.
- Solo kit flow: `feat/109-<slug>` in this folder, then `/ship` (this plan edits `core/.claude/**`). Run after 108
  (both change `core/scripts/run-plans.mjs`).

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspot
`CHANGELOG.md`.

```scope
core/scripts/run-plans.mjs
core/scripts/plan-order.mjs
core/scripts/take-plan.mjs
core/scripts/lib/plan-deps.mjs
core/scripts/lib/run-order.mjs
core/.claude/references/prd-template.md
core/.claude/skills/save-plan/SKILL.md
core/docs/agent/orchestrator.md
plans/README.md
tools/test/plan-routing.test.mjs
tools/test/fixtures/**
scripts/run-plans.mjs
scripts/plan-order.mjs
scripts/take-plan.mjs
scripts/lib/plan-deps.mjs
scripts/lib/run-order.mjs
.claude/references/prd-template.md
.claude/skills/save-plan/SKILL.md
docs/agent/orchestrator.md
```

(The installed copies — `scripts/**`, `.claude/**`, `docs/agent/**` — are rewritten by `node tools/sync.mjs --target .
--apply`.)

## Read Scope

Entire repo. The evidence: `plans/1-100/097-…` to `plans/104-…` Execution Notes, `docs/brain/error-review.md`,
`docs/brain/first-run-audit-2026-11-08.md`.

## Escalation Protocol

If a step needs a file outside the `## Read-Write Scope` (the dependency check lives in another module, the `/plan`
command text must name the new lines): STOP, tell the Human the file, the change, and why; offer `approved: <path>`;
then append the path to the scope block and retry.

## Architecture Impact
- INV-1: preserves — the new refusals sit in `lintPlan`, which the dry run and the real run share; no model call is
  added. `Solo: yes` refuses before `init`, so nothing is created.

## Step 0 — Reality Check
1. Read `lintPlan()` and `builderPrompt()` in `run-plans.mjs` and the scope parser `scripts/lib/plan-scope.mjs`: where
   the scope entries are available at readiness, and where a prompt line is added (plan 097 added the two hard limits
   there — follow that shape).
2. Read `scripts/lib/plan-deps.mjs`, `plan-order.mjs` and `scripts/lib/run-order.mjs`: find the exact test that decides
   a `Depends-on` plan outside the run is met, and whether `take-plan.mjs` has its own; name both in the Execution Notes.
3. Read `core/.claude/references/prd-template.md` `## Execution Mode` (lines `Parallel:` / `Concurrent plans:`) and the
   Done-when block; read the `save-plan` checklist's shape (one `- [ ]` line per check) so the new lines match it.
4. Run `node tools/instruction-load.mjs` before and after the template edit; the budget is 800 (today's value in the
   Execution Notes).

## Atomic Sub-tasks
- [ ] T1: Write the failing tests (a)–(d) first — tools/test/plan-routing.test.mjs
- [ ] T2: Readiness: `.claude/` scope entries need `Planner-only files:` or `Solo: yes`; the dry-run line; the `Never edit:` prompt line — core/scripts/run-plans.mjs
- [ ] T3: A dependency merged into `main` is met whatever its Status line — core/scripts/lib/plan-deps.mjs, core/scripts/plan-order.mjs, core/scripts/take-plan.mjs, core/scripts/lib/run-order.mjs
- [ ] T4: Template: the two Execution Mode lines and the one fixed Done-when line — core/.claude/references/prd-template.md
- [ ] T5: `save-plan` checklist: the six rules, one line each — core/.claude/skills/save-plan/SKILL.md
- [ ] T6: The kit's own instances; orchestrator.md readiness list; sync; every check; changelog — plans/README.md, core/docs/agent/orchestrator.md, CHANGELOG.md

## Technical Considerations
- `Planner-only files:` is a statement, not a proof: readiness cannot see that the Planner already committed them. The
  proof stays plan 105's runtime rule (a refused edit parks at once) — 108 removes the cost before it, 105 catches what
  slips through. The two plans do not share a function.
- The template is stack-neutral: the kit-specific instances (fixture folder, key cap) go in `plans/README.md`, not in
  `core/`.
- Rule (iv) is a checklist line for the Planner's review, not a readiness refusal: a six-case plan may still be right.

## Out of Scope
The lean gate itself (plan 108); runtime detection of refused edits (plan 105); recording plan edits made during a run
(done, plan 102); `[human]` items that need an installed project (plan 106 replaces them with a sandbox run); the
advisor.

## Critical Questions
- Q1: When `.claude/**` is a small part of a plan, who does it and when?
  A: (Human, 2026-11-09) The Planner, committed on `main` before the run; the plan names the paths in `Planner-only
  files:` and the builder is told never to edit them. When `.claude/**` is the core of the plan, `Solo: yes`, and
  `/orchestrate` refuses it with "run this plan solo". Bypass mode for builders is not an option: it would let a builder
  edit its own guards.

## Execution Notes
