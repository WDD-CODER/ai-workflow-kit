# Plan 053 — The orchestrator end-of-run validation list uses the same plain-text, copy-ready card layout

Status: superseded by 069
Depends-on: 052
Snapshot: 58be2737fde3c24035edc61c85c46798956a6bb0

## Problem Statement
Plan 022 made the HOW TO VALIDATE cards plain terminal text with copy-ready values, but the orchestrator's end-of-run list (screenshot grid per page, then cards) still has its own layout.

This plan came from the backlog in plan 024 (idea C6); it is one of five that run in order, each after the one before it, because they edit the same files.

## Goals & Success Criteria
**Primary:** The end-of-run list shows its cards in the layout of plan 022; the screenshot grid per page stays.

- [auto] `node --test tools/test/orchestrator.test.mjs` has a test that fails on today's code: a `[human]` item in the end-of-run list is printed in the plan-022 card layout, grouped by page, and the screenshot grid per page is unchanged.
- [auto] `node --test tools/test/ui-tier.test.mjs` passes with a test that the layout text in `docs/agent/orchestrator.md` and `docs/agent/job-validation.md` do not disagree.
- [human] The end-of-run list of the next run reads like a normal hand-off, with values to copy on their own lines.
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
core/docs/agent/orchestrator.md
docs/agent/orchestrator.md
core/.claude/agents/orch-report.md
.claude/agents/orch-report.md
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
Plan 052 is merged. Re-read the card layout in `docs/agent/job-validation.md` and the end-of-run list in `docs/agent/orchestrator.md`; drop any sub-task already covered.

## Atomic Sub-tasks

- [ ] D1: Make the orchestrator doc point to the one card layout in the job-validation doc instead of describing its own — core/docs/agent/orchestrator.md
- [ ] D2: Make the report agent print each remaining card in that layout, grouped by page, with the screenshot grid kept — core/.claude/agents/orch-report.md
- [ ] D3: Add tests that fail on today's code for the layout and the unchanged grid, then resync installed copies and add a changelog entry — tools/test/orchestrator.test.mjs, tools/test/ui-tier.test.mjs, CHANGELOG.md

## Technical Considerations
- Dependencies: plan 052. Touches the format the orchestrator test relies on; keep the screenshot grid byte-for-byte the same.
- Model changes: none. Backend / API: none. Auth and validation: none. Security surface: none. Data / migration: none. Project checks: none.
- Card format: a change here must not alter the format other plans rely on without a test in `tools/test/ui-tier.test.mjs` or `tools/test/orchestrator.test.mjs`.

## Out of Scope
- The glance group, merged cards and skipped cards (plans 050–052).
- Changing the card layout itself.

## Critical Questions
- Q: Open questions? A: none.

## Execution Notes
