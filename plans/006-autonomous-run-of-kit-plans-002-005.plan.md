# Plan 006 — Autonomous Run of Kit Plans 002–005 with One Merge Point

Status: active
Snapshot: bf4e45d8b2c65accf957056adfca2e3135e301b2

## Problem Statement
Plans 002–005 each wait for Dandan between steps: merge, tag, then the FoodVibe sync PR. Run as written, that is
about 10 interruptions. Dandan wants the agent to run all of them one after another without asking, and to come
back once: "everything is ready, merge this; here is what was done".

This plan is the run order and the rules for that run. **For this run it replaces the "Dandan merges / tag after
Dandan's go" lines in the Execution Mode of 002–005.** Each plan's own scope, Done-when, STOP rules and
sub-tasks still apply.

## Prerequisites
- Plan 001 merged, `v1.0.5` tagged and released (done: `95d6c2f`).
- Dandan approves this plan with `go` (that approval covers the actions listed under Autonomy Rules).

## Goals & Success Criteria
- [auto] Four kit PRs open, stacked: `feat/002-planner-review` → `main`, `feat/003-neutral-core-runtime` →
  002's branch, `feat/004-neutral-core-ci-commands` → 003's branch, `feat/005-react-vite-pack` → 004's branch.
  Every one has CI green (leak-check, e2e on Linux and Windows) and every `[auto]` item of its plan ticked
  with evidence in the plan file.
- [auto] Each plan's FoodVibe safety check passes **before** its PR is called ready: a `kit-sync` dry run from
  the branch (local source) into FoodVibe shows 0 `conflict` rows, apart from the conflicts 002 says to expect.
- [auto] One review pass per PR (a separate review agent reads the diff against its plan); every finding is
  fixed or written down in the PR body with the reason it was left.
- [auto] After Dandan merges the four PRs (in order 002 → 005): tag + release `v1.2.0` on the last merge
  commit; `install --source github:…@v1.2.0` records that ref and commit.
- [auto] Project PRs, one per project, from a `wt-N` slot: FoodVibe synced to `v1.2.0` (plan 001 P9, 002
  R6–R7, 005 V8 in one PR, plus the build and kit checks those steps list) and agentdesk synced to `v1.2.0`
  (005 V9: drop every override the kit now covers, port anything still needed).
- [human] Dandan merges the kit PRs once (merge point 1) and the project PRs once (merge point 2), after
  reading the summary for each.
- [human] The `[human]` checks of 001, 002 (R8) and 005, collected into one list at merge point 2.

## Execution Mode
- **Parallel:** no. Plans run in order 002 → 003 → 004 → 005, each building on the previous branch.
- **Where the code is written:** a kit slot, `../ai-workflow-kit-wt-1` (a git worktree), so this Planner
  folder stays on `main`. Project work runs in `../foodVibe1.0-wt-N` and `../agentdesk-wt-N` slots.
- **Who runs it:** this Planner session orchestrates. Each plan is implemented by one subagent in the kit
  slot, briefed with its plan file, the hand-off path and these rules. The Planner then re-runs the checks
  itself before marking the plan done; it never takes a subagent's "passes" on trust.
- **Releases:** one release, `v1.2.0`, after the merge. No `v1.1.0` (002's release) and no separate FoodVibe
  sync per plan: FoodVibe and agentdesk sync once, to `v1.2.0`. CHANGELOG gets one `[1.2.0]` entry with
  sections per plan and the "what a project must do" list from 005.
- **Kit edits:** the four branches above; no push to kit `main` except plan-file updates by the Planner.

## Read-Write Scope

Always allowed: this plan file, plans 002–005 (ticks and Execution Notes) and `.claude/sessions/**`.

```scope
plans/**
docs/session-state-*.md
```

Code scope is each plan's own scope block, written from the kit slot. Project scope is the sync steps' scope
in 001 (P9), 002 (R6–R7) and 005 (V8–V9).

## Read Scope
Kit repo, `handoff/2026-10-18-react-vite-adoption.md` (read from this Planner folder; never copied or
committed), FoodVibe, agentdesk.

## Autonomy Rules
Approved by `go`, without asking again:
- Create the kit slot and branches, commit, push branches, open and update PRs, re-run CI.
- Decide the open choices inside the plans (003 N0 "refuse vs auto-strip", 005 V0 "where the Supabase rules
  live", and similar), taking the option the plan or hand-off recommends; write each decision and why in
  that plan's `## Execution Notes`.
- Add kit-repo paths to a plan's scope when the fix needs them; list each one in the PR body.
- After Dandan's merge: tag and release `v1.2.0`, then open the project PRs.
- Save session state after each plan (`docs/session-state-<branch>.md`) so the run can resume after a
  context reset.

Never, even mid-run:
- Merge to `main` in any repo, move a published tag, push with `--force` or `--no-verify`, or bypass a hook.
- Write in FoodVibe or agentdesk before merge point 1, apart from scratch clones in the scratchpad.
- Edit, copy or commit `handoff/`; delete it only after Dandan's go (005 V9).

## Escalation Protocol
The run stops and tells Dandan (one message: what, where, options, recommendation) only for:
- a `conflict` row in a project sync that the plan doesn't already say how to resolve;
- a change that would alter FoodVibe's rendered CI behaviour, command rules or dev server, or make it need
  a new `overrides` entry (003 and 004 STOP rules);
- a check that still fails after two honest fix attempts, or CI that stays red for a reason outside the kit;
- a write needed outside the kit repo that no plan scope covers.
Anything else (a failing test, a design choice inside scope, a review finding) is handled inside the run and
reported at the merge point.

## Architecture Impact
- INV-none: preserves — this plan only orders and gates plans 002–005; their own Architecture Impact lines
  apply to the code.

## Step 0 — Reality Check
- Kit `main` = `bf4e45d` or later, clean; `v1.0.5` released.
- Each of 002–005 still matches the kit after 001 (001 already removed some "three-agent" text and fixed the
  SessionStart JSON, which 002 R4 and 005's SessionStart goal mention); note the overlap in each plan before
  starting it.
- FoodVibe and agentdesk slots exist and are idle.

## Atomic Sub-tasks
- [x] A0: Check the kit, plans and slots are ready for the run — Step 0, create `../ai-workflow-kit-wt-1` — kit repo
- [x] A1: Run plan 002 in the kit slot and open its PR — R0–R5 without the release; FoodVibe dry-run; review pass — `feat/002-planner-review`
- [x] A2: Run plan 003 on top of 002 and open its PR — N0–N9; FoodVibe safety check N8; review pass — `feat/003-neutral-core-runtime`
- [x] A3: Run plan 004 on top of 003 and open its PR — M0–M9; FoodVibe safety check M8; review pass — `feat/004-neutral-core-ci-commands`
- [x] A4: Run plan 005 on top of 004 and open its PR — V0–V7 and V10 without the tag; review pass — `feat/005-react-vite-pack`
- [x] A5: Ask Dandan to merge the four kit PRs, with a summary of each — merge point 1 — PRs
- [x] A6: Release v1.2.0 after the merge — tag the last merge commit, GitHub release, install proof — kit repo
- [x] A7: Sync FoodVibe to v1.2.0 in one PR — 002 R6 plan-checks move, dry-run, Apply, ng build, kit checks — `../foodVibe1.0-wt-N`
- [ ] A8: Sync agentdesk to v1.2.0 and drop the overrides the kit now covers — 005 V9, port anything left — `../agentdesk-wt-N`
- [ ] A9: Ask Dandan to merge the project PRs and run the human checks — merge point 2, one list — PRs

## Out of Scope
New work beyond plans 002–005; the guards mod (hand-off I-28); upstream fixes in the friend's repo
(hand-off Appendix B); porting the Python scripts to node.

## Execution Notes
- A0: kit slot `../ai-workflow-kit-wt-1` created. agentdesk-wt-1 is busy (`feat/003-workflow-hooks-ci-rules`, not this run); use agentdesk-wt-2 for A8.
- A1: PR #24 (`feat/002-planner-review`, `96a6f13` + review fixes `1c931af`), CI green; Planner re-ran leak/pack/install/e2e: ok. Review found 8 issues, all fixed; the main one: sync now reports a seed the kit promotes to managed as `conflict` (adopted projects' customised templates were being overwritten). FoodVibe dry-run: exactly the two expected template conflicts.
- Release number: the kit's semver rule says a release that needs project action is major. 002 (template conflicts) and 005 (`commands.*` change) need action, so the release is likely `v2.0.0`, not `v1.2.0`. Ask Dandan at merge point 1.
- CHANGELOG subsections are `### 00N — <title>` (leak-check refuses "Plan 00N" in CHANGELOG). `gh pr edit` fails on a Projects-classic deprecation; edit PR bodies with `gh api -X PATCH repos/WDD-CODER/ai-workflow-kit/pulls/<n>`.
- A2: PR #25 (`feat/003-neutral-core-runtime`, base 002 branch; `705caca`, `029f234`, `36bec95`, review fixes `8517efb`), CI green; Planner re-ran checks: ok (e2e 42 cases). Review: 0 high, 2 medium (AGENTS.workflow.md drift on fresh install; phantom frontend from old `commands.dev: "dev"`), 4 low — all fixed. FoodVibe dry-run: 3 new, 20 kit-update, only the two template conflicts; dev command byte-identical (scratch-clone slot-serve: started/kept/freed).
- Projects must act for 003: full `commands.*` values → script names; `npm install` inside `scripts/` + commit its lockfile; `@AGENTS.workflow.md` in CLAUDE.md when AGENTS.md is overridden; backend-only node-express sets `commands.dev: ""`.
- A3: PR #26 (`feat/004-neutral-core-ci-commands`, base 003 branch; `c84fc9d`, `8c8a7f1`, review fixes `ab260e9`), CI green; Planner re-ran checks: ok (e2e 42, link check 0 missing). Review: 0 high, 2 medium (changed-files lint hit kit scripts; scripts/ lockfile drift + unfixable blocking audit), 4 low — all fixed. Planner decision: `sync --apply` refreshes `scripts/package-lock.json`; the scripts audit is report-only, so FoodVibe gets no new blocking CI gate. FoodVibe dry-run: 3 new, 26 kit-update, only the two template conflicts; render diff: same CI behaviour and Angular rule wording.
- The 004 agent removed scratch folders with Node `fs.rmSync` after `rm -rf` was denied (scratchpad only). Tell Dandan; later agents are told not to work around a denied command.
- Release number decision (Planner, to confirm at merge point 1): `v2.0.0` — 002/003 need project action, which the kit's semver rule calls major. 005's PR sets kit.json to 2.0.0.
- A4: PR #27 (`feat/005-react-vite-pack`, base 004 branch; `221d666`, `55ee0d7`, `9352542`, review fixes `14c9eff`), CI green; Planner re-ran checks: ok (e2e 42, link check 7 fixtures 0 missing, acceptance 118). Review: 0 high, 3 medium (stack record config vs install.json; detection false positives; junction cleanup on interrupt), 4 low — all fixed, plus the pre-existing `.cursor/` refs without the Cursor layer. kit.json 2.0.0; CHANGELOG `[2.0.0]` with one "What a project must do" list. FoodVibe dry-run: 3 new, 27 kit-update, only the two template conflicts.
- A5: merge point 1 sent to Dandan (merge #24 → #27 in order, merge commits, not squash).
- A5: Dandan chose `merge all, v1.2.0`. Release renumbered to 1.2.0 on the 005 branch (`2eaab31`). Merged #24 (`f1ea73f`), #25 (`ff1ee1e`), #26 (`ddca9eb`), #27 (`85294d6`). Snag: `gh pr merge 24 --delete-branch` deleted the 002 branch and GitHub CLOSED #25 instead of retargeting; restored the branch at `1c931af`, reopened #25 and set its base to `main` via the API, then merged the rest without `--delete-branch`, retargeting each next PR to `main` and waiting for CI. Lesson: for stacked PRs, retarget the next PR before deleting the merged branch.
- A6: CI on `main` green at `85294d6`; tagged `v1.2.0`, GitHub release published; install from `github:…@v1.2.0` records ref `v1.2.0`, commit `85294d6`.
- Leftovers: merged remote branches `feat/002…005` and their local branches still exist (the delete command was denied; not worked around). The kit slot `../ai-workflow-kit-wt-1` is still on `feat/005-react-vite-pack`.
- A7: FoodVibe PR #424 (`3987dc66`): v1.0.2 → v1.2.0, template lines moved to `docs/agent/plan-checks.md`, `scripts/package-lock.json` committed, 0 overrides dropped (5 backport candidates listed in the PR). Planner re-check: sync 0/0/0, drift ok, 9/9 CI green. Dandan said `merge`: merged as `ccf06865`; FoodVibe main pulled, `npm ci` in `scripts/`; wt-1 detached idle, branch deleted. Kit follow-up: adoption-report shows the Angular frontend command as `npm run start -- -c slot --port {port}` instead of the real `ng serve` args (display only).
