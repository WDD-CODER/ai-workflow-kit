# Plan 011 — Plans Declare Dependencies, and plan-order Computes the Run Order

Status: draft
Snapshot: 3511799

## Problem Statement
A plan says what it needs first only in prose ("Prerequisite: plan 007 merged"). `take-plan.mjs` reads that prose for a
single plan, but nothing can look at a set of plans and say which can run together, which must wait, and which touch the
same files. The improvised orchestrator run (29 plans, 3 lanes) hand-wrote a dependency table and a lock table, and kept
"what is done" by matching `plan N` loosely in git subjects, which drifted from git five times.

This plan makes the dependency a field the tools read (`Depends-on:`), and adds one script, `plan-order`, that returns the
run order for any set of plans: waves (what can run in parallel), lanes, conflicts derived from scope overlap, and the
reason for every edge. The regular Planner → Worker flow benefits at once (a Worker is told which plan it is waiting on);
the orchestrator (plan 014) consumes the `--json` output instead of writing tables by hand.

Source: the original "plans declare what they need first" hand-off is not on the Planner's machine; this plan is written
from the orchestrator brief's Done-when list and its three retrospective additions. Dandan may send the hand-off later
for exact wording.

## Prerequisites
- none.

## Goals & Success Criteria
**Primary:** `node scripts/plan-order.mjs <plan numbers or paths>` prints the run order, and the existing tools enforce
the same `Depends-on:` data.

- [auto] `node --test tools/test/plan-order.test.mjs` passes. It covers: a chain (A→B→C = 3 waves), a diamond
  (A→B, A→C, B+C→D = waves [A] [B,C] [D]), a cycle (exit 1, names the plans in the cycle), a conflict pair (two
  plans with overlapping scope and no dependency = same wave but in one lock group), a missing dependency (names the
  plan and the file it expected), and a prose-only old plan (`Prerequisite: plan 007 merged` is read as a dependency).
- [auto] `plan-order --json` on the diamond fixture prints an object with `waves`, `lanes`, `conflicts` and `edges`, and
  every edge carries a `reason` (`Depends-on:` or `prose prerequisite` or `scope overlap: <glob>`).
- [auto] "Merged" on an integration branch: with `--branch orch/x --merged-from git`, a merge commit subject
  `Merge feat/011-x into orch/x (plan 011)` marks plan 011 done; `plan 011` in any other position of a subject, or
  `(plan 0110)`, does not. The anchored pattern is `^Merge \S+ into <branch> \(plan NNN\)$`. Proven by a test on a
  scratch git repo.
- [auto] Conflicts from scope overlap become lock groups; the hotspot and append-only files from the config
  (`paths.hotspots`, `project.i18nFile`) are left out of the overlap.
- [auto] `node scripts/scope-check.mjs --deps --plan=<path>` exits 1 and prints `DEPENDS_ON: missing` when the plan
  has no `Depends-on:` line, `DEPENDS_ON: ok` when it has one (`Depends-on: none` counts).
- [auto] `node scripts/take-plan.mjs` refuses a plan whose `Depends-on:` names a plan that is not merged into
  `origin/main`, and prints `NOT_READY: plan NNN (<title>) is not merged`. A plan whose dependencies are all merged is
  taken as before.
- [auto] `node tools/install-check.mjs`, `leak-check`, `pack-check`, `e2e-check`, `workflow-link-check` and
  `acceptance-check --e2e` pass; `node tools/drift-check.mjs --target .` reports no drift.

## Execution Mode
- Parallel: no — it changes `scope-check.mjs` and `take-plan.mjs`, which 017 also touches.
- Concurrent plans: none (017, 013, 014 wait for this one).
- Isolated DB: no.
- Kit edits: kit branch `feat/011-plan-order` + kit PR; Dandan merges. Release: ships alone (minor: new script, new
  field in the template, nothing an existing project must do).

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`.

```scope
core/scripts/plan-order.mjs
core/scripts/scope-check.mjs
core/scripts/take-plan.mjs
core/scripts/lib/**
core/.claude/references/prd-template.md
core/.claude/skills/save-plan/**
core/.claude/commands/plan.md
core/.claude/commands/take-plan.md
core/docs/agent/workflow-map.md
tools/test/**
tools/e2e-check.mjs
tools/install-check.mjs
scripts/**
.claude/commands/**
.claude/skills/**
.claude/references/**
docs/agent/**
README_WORKFLOW.md
README.md
CHANGELOG.md
```

## Read Scope

Entire repo. Analysis and architectural suggestions are expected.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside the
`## Read-Write Scope` above: STOP, tell the Human the file, the exact change, and why it can't be done in-scope; offer
`approved: <path>`; then append the path to the scope block above and retry.

## Architecture Impact
- INV-none: preserves — new planning script and a new optional plan field; no runtime rule in `docs/brain/invariants.md`
  is touched, the Planner/Worker roles are unchanged, and a plan without `Depends-on:` keeps working (it is only
  flagged by `scope-check --deps`).

## Step 0 — Reality Check

Runs only when `scope-check.mjs --drift` reports `REALITY: drift`. Check the listed commits by symbol (do not re-run the
whole reality check from scratch) and print one line per commit: `ok` or `conflict: <what>`. All `ok` → continue. STOP
for a go only on a `conflict`.

## User Stories
- As the Planner, I want every plan to say what it needs first so that nobody starts a plan whose base is not merged.
- As the orchestrator (plan 014), I want the run order, conflicts and their reasons as data so that I never hand-write a
  dependency or lock table.
- As a Worker, I want to be told which plan I am waiting on, by number and title.

## Functional Requirements

### Must Have (P0)
- [ ] `Depends-on: NNN, MMM` (or `none`) is a header line of a plan, read by `scripts/lib/` (one shared parser, used by
  `plan-order`, `scope-check` and `take-plan`).
- [ ] `plan-order` returns waves, lanes, derived conflicts (lock groups) and the reason of each edge, as text and `--json`.
- [ ] "Merged" on an integration branch means an anchored merge subject, never a loose match.
- [ ] `scope-check --deps` flags a missing `Depends-on:`; `take-plan` refuses an unmet dependency by name.

### Should Have (P1)
- [ ] Legacy prose (`Prerequisite: plan 007 merged`) is read as a dependency, so old plans need no edit.

### Nice to Have (P2)
- none

## UI/UX Notes
- Terminal output only. One line per wave: `WAVE 1: 011` / `WAVE 2: 013, 017 (lock group: core/scripts/scope-check.mjs)`.

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [ ] A1: Give plans a Depends-on line and one shared parser, so every tool reads dependencies the same way — also read legacy "Prerequisite" prose; `none` is valid — core/scripts/lib/plan-deps.mjs, core/.claude/references/prd-template.md, core/.claude/skills/save-plan/SKILL.md
- [ ] A2: Compute the run order for any set of plans: waves, lanes and the reason for every edge — cycle = exit 1 naming the plans; missing dependency names the plan; text and --json output — core/scripts/plan-order.mjs
- [ ] A3: Detect which plans would collide on the same files and put them in one lock group — scope overlap from each plan's Read-Write Scope, leaving out the config hotspots and append-only files — core/scripts/plan-order.mjs, core/scripts/lib/plan-scope.mjs
- [ ] A4: Decide "already merged" from an exact merge subject so a loose match can never mark a plan done — pattern ^Merge \S+ into <branch> \(plan NNN\)$, read from git on the named branch — core/scripts/plan-order.mjs
- [ ] A5: Warn at planning time when a plan has no Depends-on line — new scope-check --deps flag, mentioned in the plan command and the save-plan lint — core/scripts/scope-check.mjs, core/.claude/commands/plan.md, core/.claude/skills/save-plan/SKILL.md
- [ ] A6: Make a Worker refuse to start a plan whose dependency is not merged, naming that plan — reuses the shared parser; keeps today's prerequisite behaviour — core/scripts/take-plan.mjs, core/.claude/commands/take-plan.md
- [ ] A7: Prove all of it with tests on the six shapes and on a scratch git repo — chain, diamond, cycle, conflict pair, missing dependency, prose-only old plan, anchored merge subject — tools/test/plan-order.test.mjs, tools/e2e-check.mjs
- [ ] A8: Sync the installed copies and document the new script — node tools/sync.mjs --target . --apply; workflow map and CHANGELOG entry — core/docs/agent/workflow-map.md, CHANGELOG.md, scripts/, .claude/, docs/agent/

## Technical Considerations
- Dependencies: `scripts/lib/plan-scope.mjs` (scope parsing, glob overlap with picomatch), `take-plan.mjs` line 217
  (existing prose-prerequisite regex — reuse it inside the shared parser, do not leave two).
- New files needed: `core/scripts/plan-order.mjs`, `core/scripts/lib/plan-deps.mjs`, `tools/test/plan-order.test.mjs`.
- Model changes: none.
- Backend / API: none.
- Auth and validation: none.
- Security surface: none — reads plan files and `git log`; no shell string built from plan text.
- Data / migration: none. Old plans without the line keep working.
- Project checks: none (`docs/project/plan-checks.md` does not exist).

## Out of Scope
- The orchestrator itself (014) and its use of `--json`.
- Rewriting existing plans to add `Depends-on:`.
- Running plans (that stays `take-plan`).

## Critical Questions
- none

## Execution Notes
Review (Planner, 2026-10-21): fixed — anchored merge subject and `--json` reasons added from the retrospective;
overlap search checked 008, 010, 012, 015, 016 (shared files only: `scope-check.mjs`, `take-plan.mjs` with 016/017 —
this plan runs before 017). Open question B (missing hand-off) answered "write from the brief" by Dandan.
