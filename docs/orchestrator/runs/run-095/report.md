# Orchestrator run run-095

Run branch: `orch/run-095` (from `origin/main` at 6f9662e) · started 2026-11-08T09:06:57.178Z · finished 2026-11-08T12:46:53.936Z
Result: 1 merged, 2 parked, skipped or left out, 3 in the run (counted from git and status.json).
`main` untouched: yes (1 plan/todo file(s) changed on main) — origin/main is 99037d4.

Final gate: ok (attempt 1)

## Plans

| Plan | State | Rounds | Builder tier | Merge | Why |
| --- | --- | --- | --- | --- | --- |
| 095 Reviewer gates sensitive diffs; the unguarded reviewer and builder lose their Bash prefixes | merged | 0 | build | 688afe3 |  |
| 098 A run never waits for the Human and never wastes a build | parked | 1 | build → judgment |  | same reason twice: builder: claude timed out after 20 min |
| 099  | skipped | 0 |  |  | depends on parked 098 |

## Decisions

triage: shadow · agreement (last 50): 89% · collapsed: 0 · ask: 0 · follow-ups: 0

### Not triaged

- D1 · 095 · none · behaviour: the reviewer gets no Bash at all (READ_ONLY_BASH = []), because a Bash(git diff:*) prefix cannot refuse --output or --no-index, so no test could show them refused — reverse: restore the git diff / git show prefixes in core/scripts/lib/claude-run.mjs
- D2 · 095 · none · behaviour: a run and its dry run now refuse to start when .claude/settings.json has no PreToolUse hooks (unguarded) — reverse: remove that check in run-plans.mjs and give allowedTools() a different fallback
- D3 · 095 · none · behaviour: isSensitive is exported from core/scripts/ship-prep.mjs, with no new sensitive-paths.mjs, because moving it would break tools/install-check.mjs, which is outside the scope — reverse: move it to lib/sensitive-paths.mjs and update install-check
- D4 · 095 · none · behaviour: the reviewer gets no Bash at all (READ_ONLY_BASH = []) because a `Bash(git diff:*)` prefix cannot refuse `--output` or `--no-index`, so plan item (d) cannot be tested — reverse: restore the prefixes in core/scripts/lib/claude-run.mjs
- D5 · 095 · none · behaviour: a run with no PreToolUse guard hooks now refuses to start, in the dry run too, instead of falling back to a wide Bash list — reverse: remove the unguarded check in run-plans.mjs
- D6 · 095 · none · behaviour: isSensitive is exported from ship-prep.mjs instead of moved to sensitive-paths.mjs, because tools/install-check.mjs (outside the scope) evaluates that block — reverse: move it to the new lib file and update install-check

## Run notes

- 095: escalated to a fresh judgment-tier builder (round 1): builder: claude timed out after 20 min
- 095: parked: nothing to save (nothing uncommitted)
- wave 1 parked 095 — skipped 098, 099; 0 later plan(s) go on
- 098: escalated to a fresh judgment-tier builder (round 1): builder: claude timed out after 20 min
- 098: parked: nothing to save (nothing uncommitted)
- wave 2 parked 098 — skipped 099; 0 later plan(s) go on

## Models per agent

## What only the Human can do

### The plans' [human] items (no UI check ran)

1. 095 Reviewer gates sensitive diffs; the unguarded reviewer and builder lose their Bash prefixes: Release the kit, run `kit-sync -Ref vX.Y.Z -Apply` on the installed project, and run one `/orchestrate` on a plan that says `Reviewer: advisory` and touches a guard file: it parks on a reviewer STOP instead of merging (reply `ok`).

- Decide on 098: same reason twice: builder: claude timed out after 20 min
- Decide on 099: depends on parked 098
- Review and merge the run branch (PowerShell, one line each):

```powershell
git fetch origin
gh pr create --base main --head orch/run-095 --title "Orchestrator run run-095" --body-file .claude\orchestrator-runs\run-095.md
```

Context added by learning: 523 chars across 2 roles

Trend (last 3 runs): ✗ per plan 0 → 0 → - · fix rounds per plan 1 → 0 → 0.33 · parked 0 → 0 → 1
