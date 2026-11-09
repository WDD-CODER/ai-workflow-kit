# Plan 054 — A reported card failure is reproduced by one short test and fixed, with at most two fix attempts per card

Status: abandoned — parked under the freeze: new work with no failure shown today; re-plan after the freeze if still wanted; closed 2026-11-09
Parked: 2026-11-05 — reliability freeze, revisit 2026-11-15
Depends-on: 069
Snapshot: 58be2737fde3c24035edc61c85c46798956a6bb0

## Problem Statement
When the Human replies `failed: <number> <what you saw>`, the agent asks questions before it can act. A script that reproduces the failure removes the back and forth.

This plan came from the backlog in plan 024 (idea C5); it runs after plan 069 (which merged the earlier plans 050–053 of the same backlog), because they edit the same files.

## Goals & Success Criteria
**Primary:** A failed reply makes the agent write one short e2e test for the card, run it, and fix until it passes — at most two fix attempts per failed card, then it stops and reports to the Human.

- [auto] `node --test tools/test/ui-tier.test.mjs` has a test that fails on today's code: the rules say a `failed: <number> <text>` reply produces one e2e test (the project's e2e command) before any fix, and the attempt counter stops at 2.
- [auto] `node --test tools/test/orchestrator.test.mjs` has a test that fails on today's code: after the second failed fix attempt on a card, the run records the card as `needs-human` and does not start a third attempt.
- [human] On a real failed card the agent shows the reproducing test failing, then passing, and stops after two tries with a short report if it does not pass.
- [auto] `node --test tools/test/ui-tier.test.mjs tools/test/orchestrator.test.mjs` and `npm run build` pass.
- [auto] `node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .` reports no drift.

## Execution Mode
- Parallel: no.
- Concurrent plans: none (the validation speed-up plans run strictly in order: 069, then this plan).
- Isolated DB: no.
- Kit edits: one kit branch and one kit PR for this plan.

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`, plus the append-only hotspot `CHANGELOG.md` (add an entry, never rewrite one).

```scope
core/docs/agent/job-validation.md
docs/agent/job-validation.md
core/.claude/agents/orch-ui.md
.claude/agents/orch-ui.md
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
Plan 069 is merged. Re-read the failed-reply rules in `docs/agent/job-validation.md` and `orch-ui.md`; drop any sub-task already covered.

## Atomic Sub-tasks

- [ ] E1: Say what a failed reply does: write one short e2e test with the project's e2e command, run it to see it fail, then fix — core/docs/agent/job-validation.md
- [ ] E2: Add the stop rule: at most 2 fix attempts per failed card, then stop and report to the Human what was tried and what the test shows — core/docs/agent/job-validation.md, core/.claude/agents/orch-ui.md
- [ ] E3: Say what happens when no e2e test can reproduce the failure: ask the Human one question, never guess — core/docs/agent/job-validation.md
- [ ] E4: Add tests that fail on today's code for the reproduce step and the two-attempt stop, then resync installed copies and add a changelog entry — tools/test/ui-tier.test.mjs, tools/test/orchestrator.test.mjs, CHANGELOG.md

## Technical Considerations
- Dependencies: plan 069. The stop rule counts attempts per card, not per run.
- Model changes: none. Backend / API: none. Auth and validation: none. Security surface: none. Data / migration: none. Project checks: none.
- Card format: a change here must not alter the format other plans rely on without a test in `tools/test/ui-tier.test.mjs` or `tools/test/orchestrator.test.mjs`.

## Out of Scope
- Failures the Human reports without a card number.
- Fixing more than the reported card.

## Critical Questions
- Q: What counts as an attempt? A: one code change followed by a run of the reproducing test.

## Execution Notes
