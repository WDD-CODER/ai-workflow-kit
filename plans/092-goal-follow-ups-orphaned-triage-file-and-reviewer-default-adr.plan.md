# Plan 092 — Goal follow-ups: remove the orphaned triage file and record the reviewer's Sonnet default in an ADR

Status: draft
Depends-on: none
Snapshot: 129c54cfc992f2abb150bd4ffccde22a7560e306
Source: follow-ups of the 2026-11-06 goal run (plans 090 and 091 reports). First real run of `scripts/run-plans.mjs` (plan 058 H1, Human 2026-11-07).

## Problem Statement
1. `docs/brain/triage-calibration.md` is a tracked data file that nothing reads or writes since plan 090 removed the triage support from `decision-log.mjs` (the kit-owned `docs/agent/kit-lessons/triage-calibration.md` is a different file and stays).
2. ADR `docs/brain/decisions/0017-orchestrator-loop-is-a-script.md` line 32 names `opus` as the default of `orchestrator.reviewerModel`; plan 091 changed the default to `sonnet` (Human 2026-11-07). ADRs are superseded, never edited in place, so the record needs a new ADR.

## Goals & Success Criteria
**Primary:** the orphaned file is gone and the reviewer default has a current record.

- [auto] `docs/brain/triage-calibration.md` does not exist, and `git grep -n "docs/brain/triage-calibration"` prints nothing outside `CHANGELOG.md` and `plans/**`.
- [auto] `docs/brain/decisions/0019-run-plans-reviewer-default-is-sonnet.md` exists, names `Supersedes: 0017 (the reviewer default only)`, and states the rule: `orchestrator.reviewerModel` defaults to `sonnet`; a change of default follows the reviewer eval's `REVIEWER:` line in `docs/agent-evals/087-reviewer-ab.md`.
- [auto] `npm run build`, `npm run lint`, `npm test` pass; `node tools/drift-check.mjs --target .` reports no drift.

## Execution Mode
- Parallel: no. Run with `node scripts/run-plans.mjs --run first --plans 092` (the first real run).
- Isolated DB: no.

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspot `CHANGELOG.md`.

```scope
docs/brain/triage-calibration.md
docs/brain/decisions/0019-run-plans-reviewer-default-is-sonnet.md
docs/brain/decisions/README.md
docs/brain/index.md
CHANGELOG.md
```

## Read Scope

Entire repo.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If the builder needs a file outside
the `## Read-Write Scope`: return ESCALATE with the file, the change and why; the Human answers `approved: <path>`.

## Architecture Impact
- INV-1: preserves — the reviewer stays off Haiku; only the record of its default changes.
- INV-none otherwise: one data file deleted, one ADR added.

## Step 0 — Reality Check
1. `git grep -n "triage-calibration"`: confirm only `docs/agent/kit-lessons/triage-calibration.md` (kit-owned, stays) and its readers remain besides `docs/brain/triage-calibration.md`.
2. `ls docs/brain/decisions/`: confirm 0019 is the next free number and whether an index (`README.md` / `docs/brain/index.md`) lists the ADRs.

## Atomic Sub-tasks

- [ ] F1: Remove the triage data file nothing reads any more — git rm, plus any index line naming it — docs/brain/triage-calibration.md, docs/brain/index.md
- [ ] F2: Record that the runner's reviewer defaults to Sonnet, superseding that one point of ADR 0017 — new ADR, index line if the folder has one — docs/brain/decisions/0019-run-plans-reviewer-default-is-sonnet.md, docs/brain/decisions/README.md
- [ ] T1: Add the changelog line and run the checks — CHANGELOG.md

## Technical Considerations
- Backend / API: none. Auth and validation: none. Security surface: none. Data / migration: none.

## Out of Scope
- A review folder without a remote (needs its own plan: a worktree shares the repository's remotes).
- Editing ADR 0017 in place.

## Critical Questions
- none.

## Execution Notes
