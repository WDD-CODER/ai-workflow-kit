# Plan 017 — Guards Work for Agents Launched From the Main Folder: Prove First, Then Fix the Gaps

Status: done
Snapshot: 3511799
Depends-on: 011

## Problem Statement
In the orchestrator MVP run, hooks ran in the agents 630 times and never blocked anything. The brief blamed the guards
for judging a write by the script's own location (the main folder). The kit's `main` already hands a file that lives in
another worktree to that worktree's own guard (`scope-guard.sh` lines 84–97, `branch-guard.sh` lines 79–95), so that
premise is probably wrong, and the retro itself says it is unknown whether a guard would have blocked anything. What the
retro does prove:
- a write made through Bash (a heredoc, `>`, `tee`) is never guarded;
- the run-branch merge folder is not a slot, so no plan scope applied there;
- 9 guard runs timed out at 10 s on Windows (Git Bash start-up).

Since plan 016 `/ship` (`ship-prep.mjs`) checks plan scope on a `feat/NNN-<slug>` branch even outside a slot, which is
the rule the merge folder needs. Also found in plan 016: on `main` the branch guard refuses gitignored runtime files such
as `.claude/sessions/**`.

So this plan proves each case with a test first, fixes only what fails, then closes the three real gaps.

## Prerequisites
- Plan 011 merged (it edits `scope-check.mjs`, which this plan reads).

## Goals & Success Criteria
**Primary:** a guard decides from the file being written and the hook input, whoever launched the agent, and no guard
run exceeds the hook time limit on Windows.

- [auto] `node --test tools/test/guards.test.mjs` passes, with these cases run through the real hook scripts and a
  scratch repo with a `wt-1` slot: (1) a session whose cwd is the main folder writes into `wt-1` outside the plan scope →
  output contains `SCOPE_GUARD:` and exit 2; (2) the same write inside the scope → exit 0; (3) a write on `main` outside
  `plans/*.plan.md` and `.claude/todo.md` → output contains `BRANCH_GUARD:`; (4) a write to `.claude/sessions/x/y.md`
  on `main` → exit 0; (5) a Bash command that writes into a guarded path (`cat > <path> <<EOF`, `echo x >> <path>`,
  `tee <path>`) on `main` or outside the slot scope → denied; a read-only Bash command (`cat <path>`, `git status`) →
  allowed.
- [auto] A merge folder on branch `orch/x` or `feat/NNN-slug` that is not a slot: a write outside plan NNN's scope is
  denied with `SCOPE_GUARD:` (via the `ship-prep` scope rule); a write inside is allowed; branch `main` still refuses.
- [auto] Each guard script run, measured by the test on a no-op input, finishes in under 2 s on the CI runner and the
  script does at most one `git` call on the allow path for a non-guarded file.
- [auto] `node tools/install-check.mjs`, `leak-check`, `pack-check`, `e2e-check`, `workflow-link-check` and
  `acceptance-check --e2e` pass; `node tools/drift-check.mjs --target .` reports no drift.
- [human] On Windows, `Measure-Command` over 20 runs of `scope-guard.sh` with a typical Edit payload: median < 3 s, none
  over 10 s. (Dandan runs the command given in the hand-off.)

## Execution Mode
- Parallel: no — shares `scope-check.mjs` / `ship-prep.mjs` with 011 and 016-installed copies.
- Concurrent plans: none.
- Isolated DB: no.
- Kit edits: kit branch `feat/017-guards-from-main-folder` + kit PR; Dandan merges. Release: ships alone (minor).

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`.

```scope
core/scripts/scope-guard.sh
core/scripts/branch-guard.sh
core/scripts/plan-write-guard.sh
core/scripts/ship-prep.mjs
core/scripts/lib/**
core/.claude/settings.json
core/docs/agent/standards-git.md
core/docs/agent/workflow-map.md
tools/test/**
tools/e2e-check.mjs
scripts/**
.claude/settings.json
docs/agent/**
CHANGELOG.md
```

## Read Scope

Entire repo. Analysis and architectural suggestions are expected.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside the
`## Read-Write Scope` above: STOP, tell the Human the file, the exact change, and why it can't be done in-scope; offer
`approved: <path>`; then append the path to the scope block above and retry.

## Architecture Impact
- INV-none: preserves — guards stay deny-by-rule on the same paths; the change makes them judge the written file's own
  worktree and adds the Bash-write and merge-folder cases. A human session in a slot or on `main` behaves as today.

## Step 0 — Reality Check

Runs only when `scope-check.mjs --drift` reports `REALITY: drift`. Check the listed commits by symbol and print one line
per commit: `ok` or `conflict: <what>`. STOP for a go only on a `conflict`.

## User Stories
- As Dandan, I want a write outside a plan's scope to be refused whichever folder the agent was started from.
- As the orchestrator, I want builders and the merger to be unable to write elsewhere with a shell heredoc.

## Functional Requirements

### Must Have (P0)
- [x] Tests for the three brief cases and the `.claude/sessions/**` case, run on the current scripts first.
- [x] Fix only the cases that fail in A1 (if none fail, say so in Execution Notes).
- [x] Merge-folder rule: a non-slot folder on `orch/*` or `feat/NNN-*` is judged by plan NNN's scope (`ship-prep`).
- [x] Bash writes to guarded paths are denied.
- [x] Guard run time under the hook limit.

### Should Have (P1)
- [x] The denial message tells the agent the `approved: <path>` route.

### Nice to Have (P2)
- none

## UI/UX Notes
- Denial messages keep the existing prefixes `SCOPE_GUARD:` / `BRANCH_GUARD:`.

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [x] A1: Prove what the guards do today for an agent started in the main folder, before changing anything — test cases for write into a slot outside scope, inside scope, write on main, and a runtime file on main; record which fail — tools/test/guards.test.mjs
- [x] A2: Fix only the cases that A1 shows failing — if all pass, write "premise did not hold" in Execution Notes and skip — core/scripts/scope-guard.sh, core/scripts/branch-guard.sh, core/scripts/plan-write-guard.sh
- [x] A3: Let a plan-scoped branch be judged by its plan even in a folder that is not a slot, so the merge folder of a run is covered — feat/NNN and orch/ branches use ship-prep's scope rule — core/scripts/scope-guard.sh, core/scripts/ship-prep.mjs, core/scripts/lib/
- [x] A4: Stop shell commands from writing into guarded paths unnoticed — a Bash PreToolUse check that recognises redirects, heredocs, tee, sed -i and cp/mv targets and applies the same path rules; read-only commands pass — core/scripts/scope-guard.sh, core/.claude/settings.json
- [x] A5: Let ignored runtime files (session folders, local pointers) be written on main without a refusal — .claude/sessions/**, .claude/.session-state-path — core/scripts/branch-guard.sh
- [x] A6: Bring each guard run well under the Windows hook limit — one git call on the allow path, no repeated subshells, measured by the test — core/scripts/scope-guard.sh, core/scripts/branch-guard.sh, core/scripts/lib/
- [x] A7: Sync installed copies, document the Bash-write rule and add the changelog entry — node tools/sync.mjs --target . --apply — core/docs/agent/standards-git.md, CHANGELOG.md, scripts/, .claude/settings.json

## Technical Considerations
- Dependencies: Claude Code PreToolUse hook input (`tool_input`, `cwd`); `core/scripts/lib/slot.mjs`; `ship-prep.mjs`.
- New files needed: `tools/test/guards.test.mjs`.
- Model changes: none.
- Backend / API: none.
- Auth and validation: none.
- Security surface: this is the guard layer itself. A Bash-write detector is best-effort (it cannot parse every shell
  construct); it must fail closed on a guarded path it cannot resolve and must never be the only defence — CI
  drift-check and `/ship` scope check remain.
- Data / migration: none.
- Project checks: none.

## Out of Scope
- Blocking Bash `git` commands in general (the user's deny list owns that).
- The `git config core.hooksPath .husky` step (human-only).
- Orchestrator code (014).

## Critical Questions
- none

## Execution Notes
Review (Planner, 2026-10-21): fixed — brief's premise ("guards derive the repo from the script location") does not match
`main` (scope-guard.sh:84-97, branch-guard.sh:79-95 delegate to the file's own worktree) → re-scoped to "prove first"
(decision C, accepted by Dandan). Checked: 006, 008, 009, 010, 012, 015, 016.
Build (orchestrator builder, 2026-10-21, branch feat/017-guards-from-main-folder, no Human available):
- Step 0: `node scripts/scope-check.mjs --drift --plan=plans/017-...` → `REALITY: clean` (exit 0) — skipped.
- A1 (tests first, on the scripts as they were at 4a144cc): `node --test tools/test/guards.test.mjs` → pass 4 / fail 7.
  Held: (1) main-folder session → wt-1 outside scope denied with SCOPE_GUARD (the target slot's guard ran);
  (2) inside scope allowed; (3) BRANCH_GUARD on main; no-plan branch allowed. Failed: (4) `.claude/sessions/x/y.md`
  on main denied by BRANCH_GUARD; (5) Bash writes never judged — and a read-only Bash input on main was *denied* by
  the old branch guard (empty path → Planner deny), so wiring Bash to the old script would have blocked every command;
  merge folder (feat/001-merge, orch/run-1 + .worktree-plan) allowed out-of-scope writes; no git-call trace.
  So the brief's premise ("guards judge by the script's location") did not hold; the real gaps were Bash, merge folder,
  runtime files, speed.
- A2–A6: both guards now run `scripts/lib/guard.mjs` (one node process; branch + git dirs read from files, no python,
  0 git calls on the allow path). A3 rule shared with ship-prep via `scopedPlanPath` in lib/slot.mjs
  (`--scoped-plan`). A4 Bash detector: redirects/heredocs/tee/sed -i/perl -i/cp/mv/install/touch, follows cd and
  bash -c, heredoc bodies stripped (a commit message in `"$(cat <<'EOF' … EOF)"` is not a target); unresolvable
  targets (`$VAR`, `$(...)`) are refused where a write needs a check (fail closed). Settings: PreToolUse `Bash`
  matcher → branch-guard.sh + scope-guard.sh (timeout 10).
- Decision (no Human): `orch/<run>` names no plan number, so a non-slot merge folder names its plan in
  `.worktree-plan` (same file a slot uses); without it and without a `<type>/NNN-` branch, no plan scope applies.
- Decision (no Human): denial wording keeps "outside this plan's Read-Write Scope" (tools/e2e-check.mjs matches it) and
  adds the plan path, branch and the `approved: <path>` route.
- Bug found in my own test and fixed: linking scripts/node_modules into the scratch repo with a junction let the
  recursive cleanup empty the real scripts/node_modules; the test now copies the dependencies.
- Timing (this Windows machine, Git Bash): no-op runs scope-guard 547/612/801 ms, branch-guard 1464/690/565 ms, all
  `GUARD_GIT_CALLS: 0`; in-scope check with scope-check 987 ms. Test limit 2000 ms passes.
- Evidence (after A7 sync): `node --test tools/test/guards.test.mjs` → exit 0, pass 13 fail 0;
  `node --test tools/test/plan-order.test.mjs` → exit 0; `npm run build` → exit 0 PACK_CHECK ok; `npm run lint` →
  exit 0 LEAK_CHECK ok; `npm run test` → exit 0 (INSTALL_CHECK ok, WORKFLOW_LINK_CHECK ok); `node tools/e2e-check.mjs`
  → exit 0 "E2E_CHECK: ok — 48 cases passed" (includes the guards test against the fresh e2e project);
  `node tools/drift-check.mjs --target .` → exit 0 KIT_DRIFT ok; `node tools/pack-check.mjs` / `leak-check` /
  `workflow-link-check` / `install-check` → exit 0.
- `npm run e2e` (acceptance-check --e2e): the first runs failed only on the upstream-owned slot-serve case at port 47302,
  which the acceptance runs of other builders running at the same time (orch-merge, orch-010) were holding. That is an
  environment problem. Rerun after they ended → exit 0 "ACCEPTANCE_CHECK: ok — 122 checks passed".
- scope extended: none needed (.kit/install.json is regenerated by sync and always allowed by scope-check).
- [human] Windows Measure-Command item: validated by Dandan 2026-10-22 (`done`) — 20 runs, Average 0.71 s, Maximum
  1.24 s (limit: median < 3 s, none over 10 s).

Checker round 1 (2026-10-21):
- major fixed — `cd` to a target the guard cannot resolve (`$VAR`, `$(...)`) now makes the folder unknown
  (core/scripts/lib/guard.mjs bashWrites: `dir = (...) || null`; resolveWord returns null for a relative word when cwd is
  null), so later relative targets are `{ unresolved }` until a resolvable cd. Probe
  `bashWrites('cd "$D" && echo x > f.txt', cwd)` → `[{"unresolved":"f.txt"}]` (was a resolved path in the old cwd).
  New cases in the bashWrites test: `cd "$WT" && echo x > README.md` → `?README.md`; `cd $(…)/../x && … > f.txt && tee
  g.txt` → `?f.txt ?g.txt`; `cd "$WT" && bash -c "echo x > h.txt"` → `?h.txt`; a later literal cd restores resolution.
- minor fixed — the test that claimed to run ship-prep is renamed to what it checks (slot.mjs `--scoped-plan`), the
  unused notes.md is gone, and it now also asserts the stale-marker case below.
- minor fixed — lib/slot.mjs scopedPlanPath outside a slot now uses the same rule as guard.mjs scopedPlan (a
  .worktree-plan whose file is missing is ignored). Test: stale `.worktree-plan` = plans/099-gone.plan.md on
  orch/run-1 → `--scoped-plan` prints '' and `scopedPlan(orch, 'orch/run-1')` is null.
- Evidence: `node --test tools/test/guards.test.mjs` exit 0 (13 pass, 0 fail); sync --apply exit 0 (2 kit-update);
  build 0, lint 0, test 0, e2e-check 0 ("48 cases passed"), drift-check 0 ("0 undeclared differences"); `npm run e2e`
  first run exit 1 ("1 of 38 checks failed", parallel builders' acceptance runs at the same time — environment), rerun
  once → exit 0.
