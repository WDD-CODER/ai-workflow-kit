# Plan 061 — A parked plan reruns without plan-file conflicts, and worktree branches track their own remote branch

Status: draft
Depends-on: none
Snapshot: aac496e051072bad36314d3b24767d2f7fa37469
Source: first orchestrator test run (test-512-422), findings F6 and D10

## Problem Statement

Two git-handling faults in how a plan branch is made and reused.

1. **F6.** A parked plan's old branch is reused, never recreated (`core/scripts/orch-state.mjs:670`, `exists ? worktree add branch :
   worktree add -b branch base`; slot path `core/scripts/lib/orch-folders.mjs:87`). On a rerun the run branch is merged into it
   (`orch-state.mjs:693-700`); a conflict aborts the merge and parks the plan again with
   `merging origin/<run> into <branch> conflicts` (:697, parked at `orchestrate.js:899`). The conflicting file is the plan's own
   file: the builder committed ticks and `## Execution Notes` lines to it (`orch-builder.md:26,46-47`) and the run branch holds
   a newer text of it. Nothing in the builder or merge agents may resolve it (`orch-merge.md:20-21` aborts and returns
   `merged: false`).
2. **D10.** The plan branch is created from `origin/<run branch>` (`orch-state.mjs:670`, `orch-folders.mjs:87`). With git's
   default `branch.autoSetupMerge` the new branch takes `origin/<run branch>` as its upstream, so a bare `git push` by the
   builder (`orch-builder.md:47`, `orchestrate.js:574` give no command) errors or pushes to the wrong ref. The run branch itself
   is created with `--no-track` (`orch-state.mjs:486`), which shows the intent.

## Goals & Success Criteria
**Primary:** rerunning a parked plan never stops on a conflict in the plan's own file, and a plan branch's upstream is never the
run branch.

- [auto] A worktree made by `orch-state.mjs worktree` and a slot branch made by `orch-folders.mjs` have no
  `branch.<name>.merge` set (`git config --get` exits 1), and a reused local branch that already inherited the run branch as
  upstream has it removed. Tests next to `orchestrator-folders.test.mjs:347` (worktree) and the slot helper tests near :177-186.
- [auto] `orch-builder.md` step 7 and the builder prompt (`orchestrate.js:574`) say `git push -u origin <branch>`; string assertions.
- [auto] Rerun of a parked plan whose branch has builder commits touching `plans/NNN-*.plan.md` and whose run branch has a newer
  text of that file: `orch-state.mjs worktree` returns ok, the merge commit exists, the plan file has the run branch's text with
  the builder's ticked sub-tasks and its added Execution Notes lines kept, and no other file is resolved by the script. A conflict in
  any other file still aborts and parks as today. Test in `tools/test/orchestrator-folders.test.mjs` with a real bare origin.
- [auto] `npm run build`, `npm run lint`, `npm test`, `node --test "tools/test/*.test.mjs"`, `node tools/orchestrator-e2e.mjs` and
  `node tools/drift-check.mjs --target .` all exit 0.
- [auto] `node scripts/scope-check.mjs --tests --plan=plans/061-a-parked-plan-reruns-without-plan-file-conflicts-and-worktree-branches-track-their-own-remote-branch.plan.md`
  prints `SCOPE_TESTS: ok`, and `node scripts/scope-check.mjs --diff=origin/main` on the finished branch prints `SCOPE: ok`.
- [human] On the Human's PC, relaunching a run with a parked plan whose plan file the Planner changed on `main` since: the plan
  builds again without a `merging … conflicts` park.

## Execution Mode
- Parallel: no
- Concurrent plans: shares `orch-state.mjs` and `tools/test/orchestrator-folders.test.mjs` with 059, 062 and 064.
- Isolated DB: no

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/scripts/orch-state.mjs
core/scripts/lib/orch-folders.mjs
core/scripts/lib/orch-run.mjs
core/.claude/agents/orch-builder.md
core/.claude/workflows/orchestrate.js
core/docs/agent/orchestrator.md
core/docs/brain/gotchas/agent-workflow.md
tools/test/orchestrator-folders.test.mjs
tools/test/orchestrator.test.mjs
scripts/**
.claude/**
docs/agent/**
docs/brain/**
.kit/install.json
CHANGELOG.md
```

`scripts/**`, `.claude/**`, `docs/agent/**`, `docs/brain/**` and `.kit/install.json` are rendered copies, written only by
`node tools/sync.mjs --target . --apply`.

## Read Scope

Entire repo and its git history.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry.

## Architecture Impact
- INV-none: preserves — the run branch is still never pushed to main; plan branches only stop inheriting the run branch as upstream.

## Step 0 — Reality Check

1. Runs only when `scope-check.mjs --drift` reports `REALITY: drift`: check the listed commits by symbol, print `ok` or
   `conflict: <what>` per commit; stop for a go only on a conflict.
2. Reproduce F6 in a scratch repo before choosing the fix: which side changes the plan file on the run branch (a relaunch that
   merges `main`, `plan-close`, another plan) — name the real source in Execution Notes. If the run branch can never hold a
   newer text of that file in a real run, say so and stop for the Human before B2.
3. `node tools/install-check.mjs` and `node --test "tools/test/*.test.mjs"` pass before any edit.

## User Stories
- As the Human, I want a rerun of a parked plan to continue, not park again on its own plan file.
- As the Human, I want the builder's push to go to the plan's own remote branch.

## Functional Requirements

### Must Have (P0)
- [ ] `--no-track` on both branch creations (`orch-state.mjs:670`, `orch-folders.mjs:87`); for a reused branch whose
      `branch.<b>.merge` equals the run branch, unset `branch.<b>.merge` and `branch.<b>.remote`.
- [ ] `git push -u origin <branch>` in `orch-builder.md` step 7 and `orchestrate.js:574`.
- [ ] Plan-file-only conflict handling in `worktree()` (`orch-state.mjs:695-697`): when the merge conflicts and the only
      conflicted path is `plans/NNN-*.plan.md`, resolve it with a pure function `mergePlanFile({ ours, theirs })` in
      `orch-run.mjs`: take `theirs` (the run branch's text), tick every sub-task line whose id is `[x]` in `ours`, append the
      `## Execution Notes` lines of `ours` that `theirs` lacks; commit with the merge message. Any other conflicted path: abort
      and fail exactly as today.
- [ ] Gotcha entry in `agent-workflow.md`; `orchestrator.md` names the rule; CHANGELOG entry.

### Should Have (P1)
- [ ] The park message for a non-plan-file conflict lists the conflicted paths.

### Nice to Have (P2)
- None.

## UI/UX Notes
None (scripts and agent text only).

## Atomic Sub-tasks

Every step names its own test location.

- [ ] A1: Failing tests first — upstream of a new worktree branch is the run branch today; a rerun with a plan-file conflict parks today; Step 0 findings to Execution Notes
  - Scope: `tools/test/orchestrator-folders.test.mjs`
- [ ] B1: `--no-track`, upstream cleanup for a reused branch, push command text; tests
  - Scope: `core/scripts/orch-state.mjs`, `core/scripts/lib/orch-folders.mjs`, `core/.claude/agents/orch-builder.md`, `core/.claude/workflows/orchestrate.js`, `tools/test/orchestrator-folders.test.mjs`, `tools/test/orchestrator.test.mjs`
- [ ] B2: `mergePlanFile` and the plan-file-only conflict resolution; unit tests of the function and the rerun test
  - Scope: `core/scripts/lib/orch-run.mjs`, `core/scripts/orch-state.mjs`, `tools/test/orchestrator-folders.test.mjs`, `tools/test/orchestrator.test.mjs`
- [ ] D1: Gotcha and `orchestrator.md`
  - Scope: `core/docs/brain/gotchas/agent-workflow.md`, `core/docs/agent/orchestrator.md`
- [ ] R1: Render the installed copies, run every check, add the changelog entry — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .`, build, lint, `npm test`, `node --test "tools/test/*.test.mjs"`, `node tools/orchestrator-e2e.mjs`
  - Scope: `scripts/**`, `.claude/**`, `docs/agent/**`, `docs/brain/**`, `.kit/install.json`, `CHANGELOG.md`

## Technical Considerations
- **Why resolve in code and not by the builder:** the merge runs before the builder starts (`worktree()`); a conflict there parks the
  plan with no builder left to resolve it, and `orch-merge` must never resolve (`orch-merge.md:20-21`).
- **Why take the run branch's text as the base:** it carries any later Planner/plan-close edit (Status, scope); the builder's own
  work (ticks, notes) is additive and is re-applied.
- **Why not recreate the branch:** it would drop the builder's earlier commits and break `resumed` (`orch-state.mjs:702`).
- **Alternative rejected:** the builder no longer commits the plan file — the gate and checkers read ticks from the branch.

## Out of Scope
- Resolving conflicts in any file other than the plan's own.
- Rebasing plan branches.
- Changing how the run branch is created or pushed.

## Critical Questions
- None open (Step 0 item 2 may stop for the Human if the F6 source cannot be reproduced).

## Execution Notes
- Source: orchestrator test run test-512-422, findings F6 + D10, kept as one plan (Human, 2026-11-02). Code facts: kit at
  `origin/main` `aac496e`.
