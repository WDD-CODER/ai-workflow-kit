# Plan 079 — Readiness asks for a missing UI Spec, and the builder logs every visual choice the spec leaves open

Status: abandoned — obsolete: it changes the orchestrator workflow and agents that kit 2.1.0 / plan 090 deleted (scripts/run-plans.mjs replaced them); re-plan against run-plans.mjs if still wanted; closed 2026-11-09
Parked: 2026-11-05 — reliability freeze, revisit 2026-11-15
Depends-on: 078, 072
Snapshot: b075db1e9c4876d4f210c95612df2e2a406a160a

## Problem Statement

After plan 078 a UI plan can carry a `## UI Spec` (Page, Placement, Elements, States, Texts) and `scope-check --ui-spec`
warns when it is missing. Two gaps stay open inside a run:

1. `orch-readiness` asks product questions only for behaviour (edit, leave, cancel, error) and explicitly says "Skip
   plans that change only styling or only the backend" (`core/.claude/agents/orch-readiness.md:50-54`). A UI plan whose spec is missing or
   incomplete reaches the builder without a question, which is how plan 515's box-inside-a-box shipped.
2. The builder records a decision only for an unsettled behaviour (`behaviour:`), a defect seen (`seen:`) or a removal
   (`removes:`); everything else is dropped (the `COMMON.decisions` description at `core/.claude/workflows/orchestrate.js:156`,
   `take()` at `:468`, the ranking at `:486`). A visual choice
   the plan did not settle (which element, where it sits, a new element type) leaves no trace, so the Human cannot grade
   it at `/ship` and the learning loop never sees it. Plan 072 adds one case (an unplanned element type must be logged
   or asked), but not the general rule.

The 2026-10-28 design plan said: "the builder builds only what is in the spec; every visual choice not in it is
recorded as `design:`", graded like `behaviour:`.

## Goals & Success Criteria

**Primary:** a run asks about a UI plan's missing spec in the readiness batch, and every visual choice the builder makes
that the spec does not fix becomes a numbered `design:` decision the Human grades.

- [auto] `node --test tools/test/orchestrator.test.mjs` passes, with tests that fail on today's code:
  (a) the rendered `orch-readiness.md` has a rule: run `node scripts/scope-check.mjs --ui-spec --plan=<plan>` for each
  plan; on `UI_SPEC: warn` add `<plan>: [design] the UI Spec is missing <labels> — write them now? Default if
  unanswered: build from the plan text and log every visual choice as design:`; the skip sentence keeps "only the
  backend" and drops "only styling";
  (b) a builder result with a `design: <choice> — reverse: <how>` entry keeps it (`take()`), numbers it with the run's
  other decisions after `behaviour:` and before `seen:`, and the report lists it under the plan;
  (c) a `design:` entry without `— reverse:` is dropped with the run note `design decision dropped: no reverse`.
- [auto] `node --test tools/test/decision-log.test.mjs` passes, with tests that fail on today's code: `pending` and
  `grade` read `design:` lines (type `design`); a `design` decision graded `✗` is written to `decision-log.md` and, at
  its second `✗` of a kind, `rules --add` proposes it for the `## ui` section, never `## builder`.
- [auto] The rendered `orch-builder.md` says: build only what the UI Spec states; for each choice of element, placement
  or text it does not fix, take the simplest option that reuses an existing element and log `design: … — reverse: …`;
  the rendered `decision-review.md` grades `design:` like `behaviour:` (a test reads both).
- [auto] `npm run build`, `npm run lint` and `node --test "tools/test/*.test.mjs"` pass.
- [auto] `node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .` reports no drift.
- [human] On the next FoodVibe run with a UI plan, either readiness asked about its spec, or the report lists the
  builder's visual choices as `design:` decisions to grade.

## Execution Mode
- Parallel: no.
- Concurrent plans: plans 072 (same builder and rules-checker files, `orchestrate.js`), 070 (decision ids) and 060
  (a readiness item) touch the same files; this plan comes after 072.
- Isolated DB: no.

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/.claude/agents/orch-readiness.md
.claude/agents/orch-readiness.md
core/.claude/agents/orch-builder.md
.claude/agents/orch-builder.md
core/.claude/workflows/orchestrate.js
.claude/workflows/orchestrate.js
core/docs/agent/decision-review.md
docs/agent/decision-review.md
core/scripts/decision-log.mjs
scripts/decision-log.mjs
tools/test/orchestrator.test.mjs
tools/test/decision-log.test.mjs
CHANGELOG.md
```

`scripts/**`, `.claude/**` and `docs/agent/**` are the rendered copies, written only by
`node tools/sync.mjs --target . --apply` (R1).

## Read Scope

Entire repo and its git history.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry.

## Architecture Impact
- INV-1: preserves — `orch-readiness.md` gains one question rule; its model key and tier are not touched.

## Step 0 — Reality Check

1. Runs only when `scope-check.mjs --drift` reports `REALITY: drift`: check the listed commits by symbol and print `ok`
   or `conflict: <what>` per commit; stop for a go only on a conflict.
2. Always: on `main`, read how plan 072 phrased its unplanned-element rule in `orch-builder.md` and how plan 070 numbers
   decisions (`grep -n "UI_ELEMENTS\|design" core/.claude/agents/orch-builder.md`, `grep -n "TYPE_ORDER" core/scripts/decision-log.mjs`).
   The `design:` rule extends 072's rule (an unplanned element type is one kind of visual choice), never repeats it;
   write the merged wording into Execution Notes.

## User Stories
- As the Human, I want the run to ask me about a screen before building it when the plan does not describe it.
- As the Human, I want every visual choice a builder made on its own to reach me as a decision I can grade, so that a
  wrong choice becomes a rule.

## Functional Requirements

### Must Have (P0)
- [ ] The readiness rule for a missing or incomplete UI Spec; the styling-only skip removed.
- [ ] `design:` decisions kept, numbered, reported and graded.

### Should Have (P1)
- [ ] A second `✗` of a design kind proposes a `## ui` rule.

### Nice to Have (P2)
- none

## UI/UX Notes
- Terminal and report text only.

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [ ] R2: Make readiness ask about a UI plan's missing spec in the one batch before the run — run the UI Spec lint per plan, one design question per warn, drop the styling-only skip — core/.claude/agents/orch-readiness.md, tools/test/orchestrator.test.mjs
- [ ] B1: Make the builder build only what the spec states and log each visual choice it had to make — one rule in the builder file, merged with plan 072's unplanned-element rule — core/.claude/agents/orch-builder.md
- [ ] B2: Keep design decisions through the run so they reach the report and the grade list — the COMMON.decisions description (`:156`), `take()` (`:468`) and the rank (`:486`) accept `design:` after behaviour; a design entry with no reverse is dropped with a note — core/.claude/workflows/orchestrate.js, tools/test/orchestrator.test.mjs
- [ ] G1: Grade design decisions like behaviour ones and route a repeated wrong one to the ui rules — `TYPE_ORDER` and the type regexes in decision-log, the ui section for design kinds, the review doc — core/scripts/decision-log.mjs, core/docs/agent/decision-review.md, tools/test/decision-log.test.mjs
- [ ] R1: Render the kit's own installed copies, check drift and add a changelog line — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .` — scripts/**, .claude/**, docs/agent/**, CHANGELOG.md

## Technical Considerations
- Dependencies: plan 078 (`scope-check --ui-spec`), plan 072 (builder and rules-checker design wording), plan 070
  (decision ids unique per run). The `[design]` question tag comes from plan 076; without 076 it is harmless text.
- New files: none.
- Model changes: decision type `design` beside `removes`, `behaviour`, `seen`.
- Backend / API: none. Auth and validation: none. Security surface: none.
- Data / migration: grade rows may carry `type: "design"`; older rows are unchanged.

## Out of Scope
- A design reviewer agent that judges screenshots (decided by plan 072's V1 result).
- Writing the spec for the Human (the Planner writes it in `/plan`; readiness only asks).

## Critical Questions
- Q: Does a missing spec stop the plan? A: no; it is a readiness question with a default, like the other product
  questions (recommended).
- Q: Where does a repeated wrong design choice go? A: the `## ui` rules section; a rule the Human writes from notes goes
  to the project's design-rules file through plan 072 (recommended).

## Execution Notes
- Source: chat "תכנון ווקפלו לעיצוב UI/UX" (2026-10-28/29), steps 2 and 3 of "how it will look in a run"; chat "בחירת
  סוכן אופוסס מול סוננט" (2026-11-03), the combobox example.
- Review (Architect + PM, a separate agent against b075db1, 2026-11-03): mechanical gaps fixed in the draft (line references, scope and Depends-on, test names); open points answered with the recommended default in Critical Questions. The Planner's own review is still to run.
