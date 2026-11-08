# Plan 085 — The merge of a checked plan is pinned by script, not by the merge agent

Status: superseded by 088
Depends-on: 084
Snapshot: a513c5e40fe29742e8ee5d7cae573c7ba2d29095
Source: plan 083 follow-up (Execution Notes, 2026-11-05): "the merge pin is an instruction to the merge agent; a script check after the merge would enforce it". Human, 2026-11-05: its own plan, started after the reliability freeze ends (2026-11-15).

## Problem Statement
When the orchestrator merges a built and checked plan into the run branch, the merged commit must be exactly the head that passed the gate and the checkers (`checkedHead` in status.json). Today that is an instruction in the `orch-merge` agent's prompt (`core/.claude/workflows/orchestrate.js:931`: `git rev-parse MERGE_HEAD must print PLAN_HEAD`). The agent itself commits and pushes the run branch (`core/.claude/agents/orch-merge.md:27`). If the agent skips or misreads that check — or the plan branch moves between the check and the merge — an unchecked commit lands on the run branch, and nothing in code notices.

## Goals & Success Criteria
**Primary:** the run branch never carries a plan merge whose plan-side parent is not the plan's recorded `checkedHead`; the script, not a model, decides.

- [auto] `node --test tools/test/orchestrator-merge-only.test.mjs` passes, with tests that fail on today's code: (a) a merge whose second parent equals `checkedHead` is accepted and pushed; (b) a merge whose second parent differs is refused — the run branch on origin is unchanged, the merge folder is reset to the pre-merge commit, and the plan is parked with the reason "the branch moved after its checks" naming both shas; (c) a plan with no `checkedHead` (an older status.json) keeps today's behaviour, with a run note saying the pin was not checked.
- [auto] `node --test tools/test/orchestrator.test.mjs` passes, with a test that the workflow calls the script check between the merge commit and the push, for the normal path and for merge-only mode.
- [auto] `orch-merge.md` no longer pushes the run branch itself: it commits and returns; the push is the script's (or the agent pushes only after the script's ok — whichever Step 0 shows keeps one push per merge).
- [auto] `npm run build`, `npm run lint`, `npm test`, `node tools/orchestrator-e2e.mjs` and `node --test "tools/test/*.test.mjs"` pass; sync then drift-check reports no drift.
- [human] On the next orchestrator run, every merged plan's merge commit has the plan's checked head as its second parent (the report shows both shas), and no plan was refused for a pin mismatch it should not have been.

## Execution Mode
- Parallel: no.
- Concurrent plans: 084 goes first (both edit `orchestrate.js`).
- Isolated DB: no.
- Kit edits: one kit branch and one PR. Start after 2026-11-15 (the reliability freeze).

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspot `CHANGELOG.md`.

```scope
core/scripts/orch-state.mjs
scripts/orch-state.mjs
core/scripts/lib/orch-run.mjs
scripts/lib/orch-run.mjs
core/.claude/workflows/orchestrate.js
.claude/workflows/orchestrate.js
core/.claude/agents/orch-merge.md
.claude/agents/orch-merge.md
core/docs/agent/orchestrator.md
docs/agent/orchestrator.md
core/.claude/commands/orchestrate.md
.claude/commands/orchestrate.md
tools/test/orchestrator-merge-only.test.mjs
tools/test/orchestrator.test.mjs
tools/test/agent-contracts.test.mjs
tools/orchestrator-e2e.mjs
docs/brain/scorecard.md
CHANGELOG.md
```

## Read Scope

Entire repo.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry. Tags and releases: wait for the Human's go.

## Architecture Impact
- INV-1: preserves — the merge role keeps its model key and tier.
- Everything else: a check moves from a prompt instruction into `orch-state.mjs`. The run branch is still the only branch a run writes; the main branch is never touched.

## Step 0 — Reality Check
Before building, on `origin/main`: read `mergeStep` and `mergeOnly` in `orchestrate.js`, `merge-ready` and `set --checked-head` in `orch-state.mjs`, and `orch-merge.md`. Confirm where the push happens today and whether the merge folder can be reset safely (it is the run's own folder, never the main folder). Decide one of the two shapes below and record it as a `- decision:` line:
- **A (recommended):** the agent commits without pushing; `orch-state.mjs merge-verify --run --plan` checks `HEAD^2 == checkedHead` in the merge folder, then pushes the run branch (refusing → reset to `HEAD^` and park).
- **B:** the agent pushes as today, then `merge-verify` checks the pushed commit and, on a mismatch, reverts it with a new commit on the run branch and parks. Only if A cannot keep one push per merge.

## Atomic Sub-tasks

- [ ] M1: Add a script check that the merged commit is exactly the plan head that passed its checks — merge-verify: HEAD^2 must equal plans[N].checkedHead; mismatch → reset the merge folder, park with both shas — core/scripts/orch-state.mjs, tools/test/orchestrator-merge-only.test.mjs
- [ ] M2: Let the script push the run branch only after that check passes — orch-merge commits and returns; the workflow calls merge-verify, then the push — core/.claude/workflows/orchestrate.js, core/.claude/agents/orch-merge.md, tools/test/orchestrator.test.mjs, tools/test/agent-contracts.test.mjs
- [ ] M3: Keep older runs working when a plan has no recorded checked head — no pin, a run note says so — core/scripts/orch-state.mjs, core/.claude/workflows/orchestrate.js
- [ ] D1: Document the script pin and the new runner call — the merge section and the runner-calls table — core/docs/agent/orchestrator.md, core/.claude/commands/orchestrate.md
- [ ] T1: Run the end-to-end check with a moved branch, resync, changelog and this plan's scorecard row — tools/orchestrator-e2e.mjs, CHANGELOG.md, docs/brain/scorecard.md

## Technical Considerations
- The reset touches only the run's merge folder (`<repo>-orch-merge-<run>`), never the main folder and never origin's run branch, which has not moved yet in shape A.
- The runner-calls inventory test counts `state(` sites in `orchestrate.js`; add the new row to the table in `orchestrator.md` in the same commit.
- Backend / API: none. Auth and validation: none. Security surface: closes a gap where an unchecked commit could reach the run branch. Data / migration: none. Model changes: none.

## Out of Scope
- Merging the run branch into main (the Human does that).
- Changing what the gate or the checkers check.

## Critical Questions
- Shape A or B: Step 0 decides by the rule above (A unless it cannot keep one push per merge); record the choice.

## Execution Notes
