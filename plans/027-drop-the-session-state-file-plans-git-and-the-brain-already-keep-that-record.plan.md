# Plan 027 — Drop the session-state file: plans, git and the brain already keep that record

Status: draft
Depends-on: none
Snapshot: dc7893fb3b9027ed3e62c6a4af0c35a150917c81

## Problem Statement

Every `/ship` rewrites `docs/session-state-<branch>.md`, and session start reads it back. Today the same facts live
elsewhere: what shipped is in git, the PR and `CHANGELOG.md`; what is open is the plan's own checkboxes and
`## Execution Notes`; lessons are in `docs/brain/`. What is left in the file is a list of loose ends that goes stale
(the kit's own copy was a week old and still named finished work as next steps), so a session that trusts it acts on
facts that are no longer true. It also adds a step, a commit amend and a guard exemption to every ship, and about 50
files in the kit refer to it (scripts, the branch/scope guards, mods, docs, templates, tests).

This plan removes the file from the workflow. Loose ends move to the place a session already looks: the plan's
`## Execution Notes` (open signals) or, when no plan is open, a line in the PR body.

## Goals & Success Criteria

**Primary:** no kit script, guard, mod, command or doc writes, reads, reminds about or exempts a session-state file, and
a new `/ship` produces one commit with no state-file step.

- [auto] `grep -rIl "session-state" core templates layers mods tools --include=*` lists nothing except `tools/` migration tests that name the old file on purpose (each listed file carries the marker `legacy-session-state`).
- [auto] `node --test tools/test/*.test.mjs` passes with the guard tests no longer exempting `docs/session-state-*.md` and a new case: a write to `docs/session-state-x.md` on `main` is refused like any other doc.
- [auto] `node tools/install-check.mjs`, `node tools/e2e-check.mjs`, `node tools/workflow-link-check.mjs`, `node tools/drift-check.mjs --target .` and `node tools/leak-check.mjs` pass.
- [auto] `node tools/sync.mjs --target <fixture project that has the old scripts> --ref <this tree>` reports `write-session-state.mjs` and `session-state-path.mjs` as `removed-from-kit`, and `--prune` deletes them without touching a project-owned `docs/session-state-*.md`.
- [human] In a project synced to the new kit, start a session and run `/ship` on a small change: no session-state step appears, no file is left dirty after the ship, and the wrap-up says where the open items went.

## Execution Mode
- Parallel: no
- Concurrent plans: none
- Isolated DB: no

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`docs/session-state-<branch>.md`, `.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/**
templates/**
layers/cursor/**
mods/**
tools/**
scripts/**
.claude/**
docs/agent/**
docs/brain/**
docs/session-state-main.md
AGENTS.md
README_WORKFLOW.md
.kit/install.json
CHANGELOG.md
```

## Read Scope

Entire repo. Analysis and architectural suggestions are expected.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry.

## Architecture Impact

Run `node scripts/scope-check.mjs --arch --plan=<this file>`. The scope reaches the guards (`core/scripts/lib/guard.mjs`,
`branch-guard.sh`) and the mods, so an invariant about the Planner folder or the guards may be touched. For each line it
lists, write `preserves` with the reason (the guards keep refusing every other write; only an exemption is removed) —
and if any invariant needs `changes` or `deviation`, STOP and ask the Human as `INV-n · current rule · proposed change
· who loses what`. Never write `Arch-approved:` without `approve arch change INV-n`.

- INV-none: preserves — placeholder until the Worker runs the arch check and replaces it with the per-invariant lines.

## Step 0 — Reality Check

Runs only when `scope-check.mjs --drift` reports `REALITY: drift`. Check the listed commits
by symbol (do not re-run the whole reality check from scratch) and print one line per commit:
`ok` or `conflict: <what>`. All `ok` → continue. STOP for a go only on a `conflict`.

## User Stories
- As the Human, I want one less file that must be rewritten and committed at every ship, so that shipping is shorter.
- As a Worker starting a session, I want the plan and git to be the only places to look, so that I never act on a stale list.

## Functional Requirements

### Must Have (P0)
- [ ] A1: Take the state-file step out of `/ship` — Phase 5, the amend, the tree line and the wrap-up field — and say where open items go instead (the plan's Execution Notes, or the PR body) — core/.claude/commands/ship.md, core/docs/agent/ship-regular.md, core/scripts/ship-prep.mjs
- [ ] A2: Stop session start, compaction and hand-off checks from reading or reminding about the file — core/scripts/session-startup.sh, core/scripts/pre-compact-reminder.sh, core/scripts/handoff-check.sh, core/.claude/skills/github-sync/SKILL.md, layers/cursor/.cursor/rules/brain-memory-session-start.mdc
- [ ] A3: Delete the two scripts that write and locate the file — core/scripts/write-session-state.mjs, core/scripts/session-state-path.mjs
- [ ] A4: Remove the guard exemption and every path mention in the guards and slot tooling, keeping every other rule — core/scripts/branch-guard.sh, core/scripts/lib/guard.mjs, core/scripts/lib/slot.mjs, core/scripts/lib/invariants.mjs, core/scripts/scope-check.mjs, core/scripts/take-plan.mjs, core/scripts/local-excludes.mjs
- [ ] A5: Remove the same exemption from the mods and their tests — mods/guards/**, mods/fleet/hooks/register.tsx, mods/README.md, mods/SECURITY.md
- [ ] A6: Update the docs, templates, brain pages and the PRD template so none names the file; `/cleanup`, `/workflow-report` and the orchestrator stop mentioning it — core/docs/**, core/.claude/**, templates/**, AGENTS.md
- [ ] A7: Update the tests, the e2e cycle and the link check; add the refused-write case and the removed-from-kit sync case — tools/test/guards.test.mjs, tools/e2e-check.mjs, tools/workflow-link-check.mjs, tools/install-check.mjs
- [ ] A8: Re-render the installed copies, delete the kit's own `docs/session-state-main.md`, add the changelog entry with the one-line migration (`kit-sync -Prune`) and bump to the next minor — CHANGELOG.md, kit.json, .kit/install.json, docs/session-state-main.md

### Should Have (P1)
- [ ] B1: Leave a project's own `docs/session-state-*.md` alone: sync never deletes it and the docs say the Human may delete it — core/docs/agent/workflow-map.md
- [ ] B2: Keep the compaction rule in AGENTS.md pointing at chat plus the plan's Execution Notes — templates/AGENTS.md, AGENTS.md

### Nice to Have (P2)
- [ ] C1: Mention in `docs/brain/` one entry on why the file was dropped, so nobody re-adds it — core/docs/brain/gotchas/agent-workflow.md

## UI/UX Notes
- None.

## Atomic Sub-tasks

- [ ] A1: Take the state-file step out of the ship command so a ship is one commit with no extra rewrite — core/.claude/commands/ship.md, core/docs/agent/ship-regular.md, core/scripts/ship-prep.mjs
- [ ] A2: Stop session start, compaction and hand-off checks from reading or reminding about the file — core/scripts/session-startup.sh, core/scripts/pre-compact-reminder.sh, core/scripts/handoff-check.sh, core/.claude/skills/github-sync/SKILL.md
- [ ] A3: Delete the two scripts that write and locate the file so nothing can recreate it — core/scripts/write-session-state.mjs, core/scripts/session-state-path.mjs
- [ ] A4: Remove the guard exemption and path mentions in the guards and slot tooling while keeping every other rule — core/scripts/lib/guard.mjs, core/scripts/branch-guard.sh, core/scripts/lib/slot.mjs, core/scripts/scope-check.mjs, core/scripts/take-plan.mjs
- [ ] A5: Remove the same exemption from the mods and their tests — mods/guards, mods/fleet, mods/README.md, mods/SECURITY.md
- [ ] A6: Update docs, templates, brain pages and the PRD template so none names the file — core/docs, core/.claude, templates, AGENTS.md
- [ ] A7: Update tests, the e2e cycle and the link check, and add the refused-write and removed-from-kit cases — tools/
- [ ] A8: Re-render the installed copies, delete the kit's own state file and add the changelog entry with the migration line — CHANGELOG.md, kit.json, .kit/install.json
- [ ] B1: Make sure sync leaves a project's own state files alone and the docs say they may be deleted — core/docs/agent/workflow-map.md
- [ ] B2: Point the compaction rule at chat plus the plan's Execution Notes — templates/AGENTS.md, AGENTS.md
- [ ] C1: Record in the brain why the file was dropped — core/docs/brain/gotchas/agent-workflow.md

## Execution Notes

- Origin: the Human asked (2026-10-26) whether the session-state concept is still needed now that the kit has a brain, a Planner and plans; the kit's own copy had gone a week stale.
- Version: a minor (v1.8.0): scripts are removed, projects run `kit-sync -Prune`. Tag and release wait for the Human's go.
- Historical eval-case inputs under `docs/agent-evals/cases/**` quote the old file; they are frozen fixtures, leave them.
- Open signals that today live in the state file move here: the leftover folder `ai-workflow-kit-026`, the unpulled FoodVibe main folder, plan 025's open `[human]` check.
