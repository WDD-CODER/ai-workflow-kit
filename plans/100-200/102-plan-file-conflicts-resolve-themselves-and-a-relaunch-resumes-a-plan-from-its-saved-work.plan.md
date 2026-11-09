# Plan 102 — Plan-file conflicts resolve themselves, and a relaunch resumes a plan from its saved work

Status: done
Depends-on: 100
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
- [auto] `node --test tools/test/orchestrator-park-branch.test.mjs` passes, with a test that fails today: at plan start, a `feat/<NNN>` that is stale by today's test (`staleBranchProblem`, `run-plans.mjs` l.420: neither it nor the run's base contains the other, and this run's `status.json` does not hold the plan) is renamed to `park/<old-run-or-stale>-<NNN>`, local and remote, and a fresh `feat/<NNN>` is cut. A run note names both branches. The dry run reports this as `WILL RENAME`, not as a refusal; the existing assertion `PROBLEM stale branch …` in `tools/test/run-plans.test.mjs` l.681 changes to `WILL RENAME`. A branch that is not stale keeps today's reuse (`orch-state.mjs worktree` merges the run branch into it and keeps the builder's work), and `tools/test/orchestrator-folders.test.mjs` passes unchanged.
- [auto] `node --test tools/test/orchestrator-resume.test.mjs` passes, with tests that fail today:
  (d) a relaunched run whose plan has a `park/<run>-<NNN>` branch and a hand-off, and whose last stop is `process died`, `timed out`, `environment`, `rate-limit` or an answered question (plan 104), starts that plan from the park branch. The round counter and the tier continue, and the builder's prompt carries the hand-off;
  (e) a plan parked for its own code (`same reason twice`, fix rounds used) is not resumed this way. It stays parked, as today;
  (f) a relaunch with the same run name whose `feat/<NNN>` is based on this run branch and holds commits the run branch does not (the run died after the build; error-review run-095: 095 was built three times) reuses that branch and its hand-off: the next step is the gate on the existing commits, not a new builder from round 0.
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
tools/test/run-plans.test.mjs
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
1. `lib/plan-merge.mjs` `mergePlan` l.40–58 (checked at bf8926e): how a conflict is read (`diff --diff-filter=U` l.49) and undone (`merge --abort` l.50); the pin check (`merge-verify` l.53) must still pass after a plan-file resolution. Check that it pins the plan branch's head, not the merge's content.
2. `orch-state.mjs` `plan-info` (l.837; the `reused branch` path l.905), `park-save` (l.1071) and what plan 098 S8 added: `park-branch` (l.519–530, the rename on park, called from `park` l.1161). The rename at start reuses that code. Plan 098's dry-run refusal of a stale branch is `run-plans.mjs` `staleBranchProblem` l.420: it becomes `WILL RENAME`.
3. Where a relaunch rebuilds the done set (`runOrder` in `lib/run-order.mjs` l.18) and where the plan's context starts (`run-plans.mjs` l.593: `const ctx = { …, tier: l.start.tier, round: 0, … }`; there is no `ctx.handoff` today). The resume sets round, tier and the hand-off from the park branch's hand-off file (`.claude/sessions/orch-<run>/handoff-<NNN>.md`), or from `feat/<NNN>` for case (f).
4. Plan 100's `stops[]`: the resume rule reads the plan's last stop from it.

## Atomic Sub-tasks
- [x] S1: Write the failing tests first for plan-file conflicts, other conflicts and the pre-build catch-up — cases (a)–(c) — tools/test/orchestrator-merge-plan-file.test.mjs
- [x] S2: Write the failing test that a stale branch is renamed at start, not refused — tools/test/orchestrator-park-branch.test.mjs, tools/test/run-plans.test.mjs (the dry-run assertion at l.681)
- [x] S3: Write the failing tests for resuming from saved work, for not resuming a plan that failed on its own code, and for a relaunch reusing a built branch — cases (d)–(f) — tools/test/orchestrator-resume.test.mjs
- [x] S4: Take the run branch's plan file in a merge and before a build — core/scripts/lib/plan-merge.mjs, core/scripts/run-plans.mjs
- [x] S5: Rename a stale plan branch at start and cut a fresh one — core/scripts/orch-state.mjs, core/scripts/run-plans.mjs
- [x] S6: Resume a stopped plan from its park branch or its built branch with its round, tier and hand-off — core/scripts/run-plans.mjs, core/scripts/orch-state.mjs, core/scripts/plan-park.mjs
- [x] S7: Describe the three rules — core/docs/agent/orchestrator.md
- [x] S8: Resync the installed copies, run every check, add the changelog entry — CHANGELOG.md

## Technical Considerations
- The record is written by the script from git (the commit, its author and subject, the diff), never by a model. The rule "only the Planner edits a plan" stays true: the Execution Notes line is a fact the run records, the same way a park note is.
- Only files under `plans/**` take the run branch's copy. A plan file is the Planner's and the Human's, never the builder's, so the run branch's copy is the current one.
- A renamed stale branch keeps its commits, so nothing is lost.

## Out of Scope
Starting the relaunch (plan 100); environment repair (plan 103); the question an answered plan resumes from (plan 104).

## Critical Questions
None open.

## Execution Notes
- 2026-11-08 Builder: npm run build/lint/test → exit 0; node --test for the merge-plan-file (6 pass), park-branch, resume (4 pass) files → exit 0; scope-check → SCOPE: ok; drift-check → KIT_DRIFT: ok. The pre-build catch-up (c) already existed in `orch-state worktree` (it merges the run branch into the plan branch, plan file by mergePlanFile); the test pins it. plan-park.mjs was not needed.
- 2026-11-08 Planner: Depends-on no longer names 098 — it is merged into main (4518804); its open [human] item does not gate this code, and the run would otherwise rebuild it.
