# Plan 024 — Validation speed-ups backlog: fewer and cheaper cards

Status: draft
Depends-on: 022, 023
Snapshot: a142a8337ab251a266845a3224190d91ee50ecb6

> BACKLOG — saved on 2026-10-25 so the ideas can be picked up later. Not ready to execute: the sub-tasks below are
> directions, not yet checked against the code. Before a Worker takes this plan, the Planner runs `/plan`'s Architect + PM
> review, splits it into plans of one idea each where they differ in size, and the Human answers the Critical Questions.

## Problem Statement
Plans 022 and 023 make a hand-off easier to read and answer. The Human still spends most of the time on how many cards
reach them: the last FoodVibe orchestrator run left 127 validation cards, many of them the same check on different
pages, many that always pass, and many on areas the diff did not touch.

The ideas below shrink or reorder what reaches the Human. They were proposed on 2026-10-25 next to the two that became plan 023.

## Goals & Success Criteria
**Primary:** fewer `[human]` cards per run, with no drop in the problems the Human catches.

- [human] Dandan picks which ideas to run, in what order, and confirms by number (answer to Critical Questions).
- [auto] When an idea is taken, the Planner replaces its line here with a link to its own plan, and `node scripts/scope-check.mjs --tags --plan=<path>` prints `DONE_WHEN_TAGS: ok` for the new plan.

## Execution Mode
- Parallel: no.
- Concurrent plans: none.
- Isolated DB: no.
- Kit edits: after splitting, one kit branch and kit PR per resulting plan.

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`.

```scope
core/docs/agent/job-validation.md
core/docs/agent/orchestrator.md
core/.claude/workflows/orchestrate.js
core/scripts/lib/orch-run.mjs
core/scripts/lib/done-when.mjs
core/.claude/agents/orch-ui.md
core/.claude/agents/orch-report.md
core/.claude/commands/ship.md
core/.claude/commands/done.md
CHANGELOG.md
```

Widen this scope when the plan is split; installed copies are added then.

## Read Scope

Entire repo, including `docs/agent-evals/` (eval cases for the checkers) and the saved orchestrator retrospective from the FoodVibe run.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry. Tags and releases: wait for Dandan's go.

## Architecture Impact
- INV-none: preserves — kit instruction and workflow files only; `docs/brain/invariants.md` lists no invariant these files touch. Re-check when the plan is split.

## Step 0 — Reality Check
Plans 022 and 023 merged. Re-read `docs/agent/orchestrator.md` ("The [ui] cards", the end-of-run validation list) and the Tier 1b section of `job-validation.md` as they are on `origin/main`; drop or reword any idea the code already covers.

## Atomic Sub-tasks

- [ ] C1: Show cards a script already passed as a separate "glance" group with their screenshots, so the Human scans instead of working through them — extends Tier 1b to `[human]` items a script can partly cover; a card moves to the glance group only when its test passed and left a screenshot — core/docs/agent/job-validation.md, core/docs/agent/orchestrator.md, core/scripts/lib/done-when.mjs
- [ ] C2: Merge cards that repeat the same check on several pages into one card with a list of pages — same Do and Expect with a different URL; keep one card per distinct behavior — core/docs/agent/job-validation.md, core/.claude/workflows/orchestrate.js
- [ ] C3: Learn from past runs which card types always pass and which fail often — record the outcome of each answered card in the kit's brain, suggest promoting a type to `[ui]` or `[auto]` after it passed in every run of a set number, and list often-failing types first. Depends on the decision-review and learning-loop plan (not yet saved in the kit) — core/docs/agent/job-validation.md, core/scripts/lib/orch-run.mjs
- [ ] C4: Skip cards for areas the diff did not touch when an automatic test already covers them — compare the card's page with the plan's changed files; the skipped list is printed in one line so the Human can ask for them — core/docs/agent/job-validation.md, core/scripts/lib/done-when.mjs
- [ ] C5: Reproduce a reported failure with a script instead of asking the Human questions — `failed: <number> <what you saw>` makes the agent write one short e2e test for it (the project's e2e command), run it, and fix until it passes — core/docs/agent/job-validation.md, core/.claude/agents/orch-ui.md
- [ ] C6: Apply the same plain-text, copy-ready card layout to the orchestrator's end-of-run validation list — screenshot grid per page stays, cards use plan 022's layout — core/docs/agent/orchestrator.md, core/.claude/agents/orch-report.md

## Technical Considerations
- Dependencies: plans 022 and 023; C3 also needs the decision-review and learning-loop plan; C1 and C6 touch the orchestrator and must not change the format other plans rely on without a test (`tools/test/ui-tier.test.mjs`, `tools/test/orchestrator.test.mjs`).
- New files needed: to be decided when split.
- Model changes: none.
- Backend / API: none.
- Auth and validation: none.
- Security surface: none.
- Data / migration: none.
- Project checks: none.
- Rough value order (a guess, not measured): C1, C2, C4 save the most Human time on large runs; C3 pays back over several runs; C5 matters when failures are frequent; C6 is a consistency fix.

## Out of Scope
- The card layout, the page-by-page replies and the page opener — plans 022 and 023.
- Changing which Done-when items get which tag.

## Critical Questions
- Q: Which ideas first? A: open — proposed order: C1, C2, C4, then C5, then C3, then C6.
- Q: How many passed runs before C3 suggests promoting a card type? A: open — proposed: 3.
- Q: Should C4 skip untouched areas silently or list them? A: open — proposed: list them in one line.

## Execution Notes
