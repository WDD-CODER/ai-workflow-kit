# Plan 052 — Cards for areas the diff did not touch are skipped when a test covers them, and the skipped list is shown

Status: superseded by 069
Depends-on: 051
Snapshot: 58be2737fde3c24035edc61c85c46798956a6bb0

## Problem Statement
Many cards check pages whose code the plan never changed and that an automatic test already covers. They almost always pass and still cost the Human a check.

This plan came from the backlog in plan 024 (idea C4); it is one of five that run in order, each after the one before it, because they edit the same files.

## Goals & Success Criteria
**Primary:** A card is skipped only when the diff did not touch its page and a test covers it; the skipped cards are printed on one line so the Human can ask for them.

- [auto] `node --test tools/test/ui-tier.test.mjs` has a test that fails on today's code: a card whose page maps to no changed file and has a passing test is skipped; a card on a changed page, or with no test, is kept.
- [auto] `node --test tools/test/orchestrator.test.mjs` has a test that fails on today's code: the hand-off prints one line `Skipped (untouched, test passed): <n> — <numbers>` and a reply `show skipped` brings the cards back.
- [human] On the next run the Human sees the skipped line and, when asked, gets the skipped cards.
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
Plan 051 is merged. Re-read how a card names its page and how the plan's changed files are known at hand-off; drop any sub-task already covered.

## Atomic Sub-tasks

- [ ] C1: Decide how a card's page maps to the changed files (page route to source file) and write the rule, including what happens when the mapping is unknown — keep the card — core/docs/agent/job-validation.md
- [ ] C2: Skip a card when its page is untouched and a passing test covers it, in the helper that builds the list — core/scripts/lib/done-when.mjs
- [ ] C3: Print the skipped cards on one line and let the Human bring them back with one reply — core/docs/agent/job-validation.md
- [ ] C4: Add tests that fail on today's code for the skip rule and the printed line, then resync installed copies and add a changelog entry — tools/test/ui-tier.test.mjs, tools/test/orchestrator.test.mjs, CHANGELOG.md

## Technical Considerations
- Dependencies: plan 051. When the page-to-file mapping cannot be decided, the card is kept: skipping is never the default.
- Model changes: none. Backend / API: none. Auth and validation: none. Security surface: none. Data / migration: none. Project checks: none.
- Card format: a change here must not alter the format other plans rely on without a test in `tools/test/ui-tier.test.mjs` or `tools/test/orchestrator.test.mjs`.

## Out of Scope
- Cards on touched pages.
- Changing which Done-when items get which tag.

## Critical Questions
- Q: Silent or listed? A: listed on one line (decided by the Human, 2026-11-01).

## Execution Notes
