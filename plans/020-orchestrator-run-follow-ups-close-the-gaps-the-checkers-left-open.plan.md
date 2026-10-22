# Plan 020 — Orchestrator Run Follow-ups: Close the Gaps the Checkers Left Open

Status: draft
Snapshot: 6bc9d95
Depends-on: 011, 013, 014, 017, 018, 019

## Problem Statement
The orchestrator run that built plans 010, 011, 013, 014, 017, 018 and 019 (merged in PR #37, released as v1.4.0)
passed every blocking check, but its independent checkers left a list of minor and nit findings, and the security
follow-up left one gap of the same kind it fixed. None blocks today's use; several make the next real `/orchestrate`
run less reliable or a guard easier to slip past:
- `[ui]` card test commands still go through the destructive-command deny list only, while every other extra check
  command now needs the allowlist (`core/.claude/workflows/orchestrate.js:287`).
- `plan-order` and `take-plan` disagree on "done": `take-plan` counts an open plan with no open sub-tasks as merged,
  `plan-order` does not, so `plan-order` schedules plans that are already on `main` (e.g. 016 before it was closed).
- `.kit/config.json` sets no `paths.hotspots`, so `CHANGELOG.md` and `README.md` count as scope overlap and every open
  plan lands in one lock group — the `--json` conflicts are useless for the orchestrator on this repo.
- The guard's Bash-write reader misses a redirect inside `$( … )`, and reads `>` inside `if [[ … ]]` / `(( … ))` as a
  write. The Bash matcher in `settings.json` runs `branch-guard` and `scope-guard` but not `plan-write-guard`.
- `orch-preflight.mjs` checks only that `scripts/slot-serve.mjs` exists; plan 014's Must Have asks that dev servers
  start.
- `/review-it` lets the Human name a branch, but always diffs `origin/main...HEAD`.
- Smaller: `parseDependsOn` reads numbers after an em dash (`Depends-on: 011 — after release 1.3` adds 001 and 003);
  `agent-eval` passes `--model inherit` to `claude` and its write refusal ignores Bash; `orch-state` stale-lock
  takeover can race; `uiItems()` reads `[ui]` bullets anywhere in the plan; `uiItemsMissing` matches card titles by
  substring; the merge prompt says `--no-ff --no-commit` while `orch-merge.md` says a direct merge commit; the
  missing-packages test relies on `node_modules/.package-lock.json` (npm 7+ only).

## Prerequisites
- none open: 011, 013, 014, 017, 018 and 019 are merged on `main` (`4e0e48e`) and released in v1.4.0.

## Goals & Success Criteria
**Primary:** every finding above is fixed with a test, or closed with a written reason, and the kit checks stay green.

- [auto] `node --test tools/test/*.test.mjs` passes and includes a new case per fixed finding: `[ui]` card test command
  not on the allowlist is dropped with a run note; `plan-order` treats a plan with zero open sub-tasks on main as done
  (same rule as `take-plan`); `parseDependsOn("011 — after release 1.3")` returns `["011"]`; a Bash command
  `x=$(cat > README.md <<'EOF' …)` on a guarded folder is denied; `if [[ $a > $b ]]; then :; fi` is allowed;
  `agent-eval` with `model: inherit` passes no `--model`; two concurrent `orch-state` lock takers never both hold it.
- [auto] `node scripts/plan-order.mjs --json` on this repo reports no lock group caused only by `CHANGELOG.md` or
  `README.md` (`paths.hotspots` set in `.kit/config.json`).
- [auto] `node tools/orchestrator-e2e.mjs` passes, including a case where the preflight reports a dev server that does
  not start (stub `slot-serve` exits 1) as an environment failure before any builder runs.
- [auto] `npm run build`, `npm run lint`, `npm run test`, `npm run e2e`, `node tools/e2e-check.mjs`,
  `node tools/drift-check.mjs --target .` exit 0; CI green on ubuntu and windows.
- [human] `/review-it feat/<some-branch>` run from `main` reviews that branch's diff (Dandan names a branch).

## Execution Mode
- Parallel: no — touches the orchestrator, guards and planning scripts at once.
- Concurrent plans: none.
- Isolated DB: no.
- Kit edits: kit branch `feat/020-orchestrator-follow-ups` + kit PR; Dandan merges. Release: patch v1.4.1.

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`.

```scope
core/.claude/workflows/orchestrate.js
core/.claude/agents/orch-merge.md
core/.claude/commands/review-it.md
core/.claude/settings.json
core/scripts/plan-order.mjs
core/scripts/take-plan.mjs
core/scripts/orch-state.mjs
core/scripts/orch-preflight.mjs
core/scripts/lib/**
core/docs/agent/orchestrator.md
tools/agent-eval.mjs
tools/lib/agent-eval/**
tools/orchestrator-e2e.mjs
tools/fixtures/orchestrator/**
tools/test/**
tools/e2e-check.mjs
.kit/config.json
.kit/install.json
scripts/**
.claude/**
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
- INV-none: preserves — fixes inside existing scripts and agents; guards only get stricter on guarded folders, and the
  orchestrator stays opt-in with `main` never written by a run.

## Step 0 — Reality Check

Runs only when `scope-check.mjs --drift` reports `REALITY: drift`. Check the listed commits by symbol and print one line
per commit: `ok` or `conflict: <what>`. STOP for a go only on a `conflict`.

## User Stories
- As Dandan, I want the next real orchestrator run to stop early on a broken dev server and never run an unchecked
  command from a UI card.
- As the Planner, I want `plan-order` to agree with `take-plan` and give useful lock groups on this repo.

## Functional Requirements

### Must Have (P0)
- [ ] `[ui]` card test commands go through the same allowlist as extra check commands.
- [ ] One "done" rule shared by `plan-order` and `take-plan`.
- [ ] `paths.hotspots` set for the kit repo.
- [ ] Bash-write reader: `$( … )` redirects seen; `[[ … ]]` / `(( … ))` comparisons not read as writes; the Bash
  matcher also runs `plan-write-guard`.
- [ ] Preflight starts the dev servers (or proves they answer) and reports a failed start as an environment failure.
- [ ] `/review-it` reviews the branch the Human names.

### Should Have (P1)
- [ ] The smaller findings (Depends-on em dash, agent-eval inherit/Bash, lock race, `[ui]` item scope and title match,
  merge prompt vs agent, `.package-lock.json` fallback).

### Nice to Have (P2)
- none

## UI/UX Notes
- Terminal output only.

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [ ] A1: Check UI card test commands with the same allowlist as other checks, so no unchecked command reaches the gate — drop with a run note like the other dropped checks — core/.claude/workflows/orchestrate.js, tools/orchestrator-e2e.mjs
- [ ] A2: Give planning tools one rule for "already done", so the run order matches what a Worker may take — open plan with zero open sub-tasks on main counts as done in both — core/scripts/lib/plan-deps.mjs, core/scripts/plan-order.mjs, core/scripts/take-plan.mjs
- [ ] A3: Stop the changelog and readme from forcing every kit plan into one lock group — set paths.hotspots in the kit's own config, re-sync — .kit/config.json, .kit/install.json
- [ ] A4: Make the guard see writes hidden in command substitutions and ignore comparisons in conditions, and run the plan-file guard on shell commands too — core/scripts/lib/guard.mjs, core/.claude/settings.json, tools/test/guards.test.mjs
- [ ] A5: Make the run's preflight prove the dev servers start, so a broken server stops the run before any builder — core/scripts/orch-preflight.mjs, tools/orchestrator-e2e.mjs
- [ ] A6: Make the review command review the branch the Human names, not always the current one — core/.claude/commands/review-it.md
- [ ] A7: Fix the smaller checker findings, each with a test — Depends-on em dash, agent-eval inherit and Bash refusal, lock race, UI item scope and title match, merge prompt vs merge agent, missing-packages fallback — core/scripts/lib/plan-deps.mjs, tools/lib/agent-eval/run.mjs, core/scripts/orch-state.mjs, core/scripts/lib/done-when.mjs, core/.claude/workflows/orchestrate.js, core/.claude/agents/orch-merge.md, core/scripts/lib/slot-procs.mjs, tools/test/
- [ ] A8: Sync the installed copies, run every kit check and add the changelog entry — node tools/sync.mjs --target . --apply — CHANGELOG.md, scripts/, .claude/, docs/agent/

## Technical Considerations
- Dependencies: v1.4.0 code from plans 011, 013, 014, 017, 018, 019.
- New files needed: none (tests go into the existing test files).
- Model changes: none.
- Backend / API: none.
- Auth and validation: none.
- Security surface: guard and orchestrator command handling — every change only narrows what is allowed.
- Data / migration: none.
- Project checks: none.

## Out of Scope
- The `[human]` real-project checks of plans 010, 013, 014, 018, 019.
- New orchestrator features.

## Critical Questions
- none

## Execution Notes
Written by the Planner on 2026-10-22 from the orchestrator run's checker findings (minors and nits) and the security
follow-up's open note. Dandan asked for this plan ("yes" to the follow-up plan question).
