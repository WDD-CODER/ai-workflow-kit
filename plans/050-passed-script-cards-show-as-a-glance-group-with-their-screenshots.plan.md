# Plan 050 — Cards a script already passed show as a glance group with their screenshots

Status: draft
Depends-on: 049
Snapshot: 58be2737fde3c24035edc61c85c46798956a6bb0

## Problem Statement
A `[ui]` card whose script passed is already evidence (Tier 1b in `docs/agent/job-validation.md`), but a card a script covers in part still reaches the Human as a full card to work through. The Human should scan those cards, not work through them.

This plan came from the backlog in plan 024 (idea C1); it is one of five that run in order, each after the one before it, because they edit the same files.

## Goals & Success Criteria
**Primary:** Cards a script has already passed are shown together as a glance group, each with its screenshot, so the Human scans them in one pass.

- [auto] `node --test tools/test/ui-tier.test.mjs` has a test that fails on today's code: an item whose script passed and left a screenshot goes to the glance group; an item whose test failed or left no screenshot stays a full card.
- [auto] `node --test tools/test/orchestrator.test.mjs` has a test that fails on today's code: the end-of-run list prints the glance group before the full cards, with one screenshot link per row.
- [human] On the next orchestrator run the glance group shows the passed cards with thumbnails and the Human can scan it in under a minute.
- [auto] `node --test tools/test/ui-tier.test.mjs tools/test/orchestrator.test.mjs` and `npm run build` pass.
- [auto] `node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .` reports no drift.

## Execution Mode
- Parallel: no.
- Concurrent plans: none (the five validation speed-up plans run strictly in order).
- Isolated DB: no.
- Kit edits: one kit branch and one kit PR for this plan.

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`, plus the append-only hotspot `CHANGELOG.md` (add an entry, never rewrite one).

```scope
core/docs/agent/job-validation.md
docs/agent/job-validation.md
core/docs/agent/orchestrator.md
docs/agent/orchestrator.md
core/scripts/lib/done-when.mjs
scripts/lib/done-when.mjs
tools/test/ui-tier.test.mjs
tools/test/orchestrator.test.mjs
CHANGELOG.md
```

## Read Scope

Entire repo, including `docs/agent-evals/`.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry. Tags and releases: wait for Dandan's go.

## Architecture Impact
- INV-none: preserves — kit instruction and workflow files only; `docs/brain/invariants.md` lists no invariant these files touch.

## Step 0 — Reality Check
Plans 022 and 023 are merged. Re-read "Tier 1b" in `docs/agent/job-validation.md` and "The [ui] cards" in `docs/agent/orchestrator.md` as on `origin/main`; drop or reword any sub-task the code already covers.

## Atomic Sub-tasks

- [ ] A1: Check whether the card code already supports a glance group before changing anything — read done-when.mjs, the job-validation Tier 1b text and the orchestrator end-of-run list, and write the finding in Execution Notes — core/scripts/lib/done-when.mjs, core/docs/agent/job-validation.md, core/docs/agent/orchestrator.md
- [ ] A2: Define when a card moves to the glance group: its test passed and left a screenshot, nothing else — rule text and a helper that sorts cards — core/docs/agent/job-validation.md, core/scripts/lib/done-when.mjs
- [ ] A3: Print the glance group in the hand-off and in the end-of-run list, before the full cards, one row per card with title and screenshot link — core/docs/agent/job-validation.md, core/docs/agent/orchestrator.md
- [ ] A4: Add tests that fail on today's code for the sort rule and the printed group, then resync installed copies and add a changelog entry — tools/test/ui-tier.test.mjs, tools/test/orchestrator.test.mjs, CHANGELOG.md

## Technical Considerations
- Dependencies: plan 049. Extends Tier 1b to items a script can cover only in part; if A1 finds the glance group already built, the Worker stops and reports, and the Planner reduces this plan.
- Model changes: none. Backend / API: none. Auth and validation: none. Security surface: none. Data / migration: none. Project checks: none.
- Card format: a change here must not alter the format other plans rely on without a test in `tools/test/ui-tier.test.mjs` or `tools/test/orchestrator.test.mjs`.

## Out of Scope
- Merging cards that repeat a check (plan 051).
- Skipping cards for untouched areas (plan 052).
- Changing which Done-when items get which tag.

## Critical Questions
- Q: Does a `[human]` item ever move to the glance group? A: only a card whose script passed and saved a screenshot; the item stays `[human]` in the plan.

## Execution Notes
