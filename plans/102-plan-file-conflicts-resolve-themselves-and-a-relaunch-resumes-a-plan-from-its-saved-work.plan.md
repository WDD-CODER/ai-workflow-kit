# Plan 102 — Plan-file conflicts resolve themselves, and a relaunch resumes a plan from its saved work

Status: draft
Depends-on: 098, 100
Snapshot: 99037d4
Source: the stops audit of 16 FoodVibe runs, mapped on 2026-11-08 (groups B and H: stops #12, 14, 18, 21, 29). The Human took every recommendation on 2026-11-08. Reliability fix, allowed in the freeze; no new capability.

## Problem Statement
1. **A conflict in the plan's own file parks the plan.** The plan file is edited on the run branch (the Human or the Planner answers a question or adds a scope line) while the builder branch still holds the older copy. The merge stops on a conflict only in that file. This happened at #14, #18 (twice), #21. The waits ran from 10 minutes to 9 h 50 min overnight, and each time the Human restarted the run.
2. **A branch from another run is reused.** Plan 098 renames a parked plan's `feat/<NNN>` to `park/<run>-<NNN>` and makes the dry run fail on a stale `feat/<NNN>`. A failing dry run still needs the Human to delete or rename the branch (#29: the Human deleted branches in a terminal).
3. **A relaunch starts a plan from round 0.** After a park or a death, the next run rebuilds the plan from scratch, although its commits were saved (#12: 37 minutes redone; #18: 29 minutes redone).

## Goals & Success Criteria
**Primary:** a plan-file conflict and a stale branch never stop a run, and a plan that stopped for a reason that wasn't its own code (death, time limit, environment, rate limit, an answered question) continues from its saved commits.

- [auto] `node --test tools/test/orchestrator-merge-plan-file.test.mjs` passes, with tests that fail on today's code:
  (a) a merge whose only conflicts are in `plans/**` files is completed with the run branch's copy of those files (in the merge folder the run branch is `HEAD`, so `git checkout --ours -- <file>`). The merge then runs its checks as usual, and a run note names the file;
  (b) a merge with a conflict in any other file still fails as today;
  (c) before the builder starts, when the run branch's plan file differs from the plan branch's copy, the run branch is merged into the plan branch first, using the same plan-file rule, so the builder reads the current plan.
- [auto] The same test file covers the record of a plan changed during a run. When the run branch's copy of a plan file differs from the copy the plan's builder started from, the script writes a record, not an agent. The record is:
  - a run note `plan <NNN> changed during the run: <commit> <author> — <commit subject>`;
  - a section `## Plans changed during the run` in the report, with the diff of the plan file, cut to 40 lines;
  - one line under the plan's `## Execution Notes` on the run branch, `<date> changed during <run> in <commit>: <commit subject>`, committed by the merge step.
  A plan-file commit on a run branch whose subject has no reason (shorter than 10 characters after `plan(NNN):`) gives a run warning naming the commit.
- [auto] `node --test tools/test/orchestrator-park-branch.test.mjs` passes, with a test that fails today: at plan start, a `feat/<NNN>` that is not based on the current run branch is renamed to `park/<old-run-or-stale>-<NNN>`, local and remote, and a fresh `feat/<NNN>` is cut. A run note names both branches. The dry run reports this as `WILL RENAME`, not as a refusal.
- [auto] `node --test tools/test/orchestrator-resume.test.mjs` passes, with tests that fail today:
  (d) a relaunched run whose plan has a `park/<run>-<NNN>` branch and a hand-off, and whose last stop is `process died`, `timed out`, `environment`, `rate-limit` or an answered question (plan 104), starts that plan from the park branch. The round counter and the tier continue, and the builder's prompt carries the hand-off;
  (e) a plan parked for its own code (`same reason twice`, fix rounds used) is not resumed this way. It stays parked, as today.
- [auto] `docs/agent/orchestrator.md` describes the plan-file rule, the rename at start and the resume rule.
- [auto] `npm run build`, `npm run lint`, `npm test` and `node tools/drift-check.mjs --target .` pass (the builder runs the kit sync with apply first; it is a step, not a check).
- [human] On the installed project, edit a plan file on the run branch while its builder works. The plan merges with no park, and the run note names the plan file (reply `ok`).

## Execution Mode
- Parallel: no.
- Concurrent plans: none.
- Isolated DB: no.
- Run: in the same run as 100, 101, 103, 104. `orch/<run>` merges into `main` only by a PR the Human approves.
- Fallback: when the dry run says `WOULD START: no`, append one line with the date and the reason to `docs/brain/error-review.md` first, then build this plan by the solo flow (`feat/102-<slug>`, then `/ship`).

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspots `CHANGELOG.md` and `docs/brain/error-review.md`.

```scope
core/scripts/lib/plan-merge.mjs
scripts/lib/plan-merge.mjs
core/scripts/orch-state.mjs
scripts/orch-state.mjs
core/scripts/run-plans.mjs
scripts/run-plans.mjs
core/scripts/plan-park.mjs
scripts/plan-park.mjs
core/docs/agent/orchestrator.md
docs/agent/orchestrator.md
tools/test/orchestrator-merge-plan-file.test.mjs
tools/test/orchestrator-park-branch.test.mjs
tools/test/orchestrator-resume.test.mjs
CHANGELOG.md
docs/brain/error-review.md
```

## Read Scope

Entire repo.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a step needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry.

## Architecture Impact
- INV-1: preserves — a resumed plan keeps the tier it stopped on; a plan that needed the judgment tier is resumed on it.

## Step 0 — Reality Check
1. `lib/plan-merge.mjs` l.40–55: how a conflict is read (`diff --diff-filter=U`) and undone; the pin check (`merge-verify`) must still pass after a plan-file resolution. Check that it pins the plan branch's head, not the merge's content.
2. `orch-state.mjs` `plan-info` (the `reused branch` path) and `park-save`, plus what plan 098 S8 added (the rename on park). The rename at start reuses that code.
3. Where a relaunch rebuilds the done set (`order`, `runOrder` in `lib/run-order.mjs`) and where `ctx.round`, `ctx.tier`, `ctx.handoff` start (`run-plans.mjs` plan loop). The resume sets them from the park branch's hand-off file.
4. Plan 100's `stops[]`: the resume rule reads the plan's last stop from it.

## Atomic Sub-tasks
- [ ] S1: Write the failing tests first for plan-file conflicts, other conflicts and the pre-build catch-up — cases (a)–(c) — tools/test/orchestrator-merge-plan-file.test.mjs
- [ ] S2: Write the failing test that a stale branch is renamed at start, not refused — tools/test/orchestrator-park-branch.test.mjs
- [ ] S3: Write the failing tests for resuming from saved work and for not resuming a plan that failed on its own code — cases (d), (e) — tools/test/orchestrator-resume.test.mjs
- [ ] S4: Take the run branch's plan file in a merge and before a build — core/scripts/lib/plan-merge.mjs, core/scripts/run-plans.mjs
- [ ] S5: Rename a stale plan branch at start and cut a fresh one — core/scripts/orch-state.mjs, core/scripts/run-plans.mjs
- [ ] S6: Resume a stopped plan from its park branch with its round, tier and hand-off — core/scripts/run-plans.mjs, core/scripts/orch-state.mjs, core/scripts/plan-park.mjs
- [ ] S7: Describe the three rules — core/docs/agent/orchestrator.md
- [ ] S8: Resync the installed copies, run every check, add the changelog entry — CHANGELOG.md

## Technical Considerations
- The record is written by the script from git (the commit, its author and subject, the diff), never by a model. The rule "only the Planner edits a plan" stays true: the Execution Notes line is a fact the run records, the same way a park note is.
- Only files under `plans/**` take the run branch's copy. A plan file is the Planner's and the Human's, never the builder's, so the run branch's copy is the current one.
- A renamed stale branch keeps its commits, so nothing is lost.

## Out of Scope
Starting the relaunch (plan 100); environment repair (plan 103); the question an answered plan resumes from (plan 104).

## Critical Questions
None open.

## Execution Notes
