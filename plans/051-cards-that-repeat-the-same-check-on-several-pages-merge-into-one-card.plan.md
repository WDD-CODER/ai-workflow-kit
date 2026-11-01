# Plan 051 — Cards that repeat the same check on several pages merge into one card with a list of pages

Status: draft
Depends-on: 050
Snapshot: 58be2737fde3c24035edc61c85c46798956a6bb0

## Problem Statement
The last FoodVibe run left 127 cards, many of them the same check on different pages (same action, same expected result, only the URL differs). Each one costs the Human a read and an answer.

This plan came from the backlog in plan 024 (idea C2); it is one of five that run in order, each after the one before it, because they edit the same files.

## Goals & Success Criteria
**Primary:** One card per distinct behavior: a check repeated on several pages is one card that lists the pages.

- [auto] `node --test tools/test/ui-tier.test.mjs` has a test that fails on today's code: two cards with the same Do and Expect and different URLs become one card listing both URLs; two cards that differ in Do or Expect stay separate.
- [auto] `node --test tools/test/orchestrator.test.mjs` has a test that fails on today's code: the merged card keeps the numbers of the cards it replaced, so a `failed: <number>` reply still maps to one of them.
- [human] On a run with repeated checks the Human sees one card with a list of pages instead of several near-identical cards.
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
core/.claude/workflows/orchestrate.js
.claude/workflows/orchestrate.js
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
Plan 050 is merged. Re-read the card layout rules in `docs/agent/job-validation.md` and how `orchestrate.js` builds the card list; drop any sub-task already covered.

## Atomic Sub-tasks

- [ ] B1: Say in the card rules when two cards are the same check: same Do and same Expect, different URL — and that anything else stays separate — core/docs/agent/job-validation.md
- [ ] B2: Merge such cards when the hand-off list is built, keeping one card with the list of pages and the numbers of the merged cards — core/.claude/workflows/orchestrate.js
- [ ] B3: Make a failed reply on a merged card name the page, so the agent knows which page broke — core/docs/agent/job-validation.md, core/.claude/workflows/orchestrate.js
- [ ] B4: Add tests that fail on today's code for the merge and the number mapping, then resync installed copies and add a changelog entry — tools/test/ui-tier.test.mjs, tools/test/orchestrator.test.mjs, CHANGELOG.md

## Technical Considerations
- Dependencies: plan 050. The merge happens where the list is built, not in the plans, so plan text stays untouched.
- Model changes: none. Backend / API: none. Auth and validation: none. Security surface: none. Data / migration: none. Project checks: none.
- Card format: a change here must not alter the format other plans rely on without a test in `tools/test/ui-tier.test.mjs` or `tools/test/orchestrator.test.mjs`.

## Out of Scope
- Cards that differ in the action or the expected result.
- The glance group (plan 050).

## Critical Questions
- Q: What if the same check fails on only one of the merged pages? A: the reply names the page (`failed: 4 /orders`); the other pages stay passed.

## Execution Notes
