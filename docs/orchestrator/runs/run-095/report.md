# Orchestrator run run-095

Run branch: `orch/run-095` (from `origin/main` at 6f9662e) · started 2026-11-08T09:06:57.178Z · finished 2026-11-08T11:26:50.441Z
Result: 0 merged, 3 parked, skipped or left out, 3 in the run (counted from git and status.json).
`main` untouched: yes — origin/main is 6f9662e.

## Plans

| Plan | State | Rounds | Builder tier | Merge | Why |
| --- | --- | --- | --- | --- | --- |
| 095 Reviewer gates sensitive diffs; the unguarded reviewer and builder lose their Bash prefixes | parked | 0 | build |  | review could not run: review folder: git worktree add: fatal: Could not reset index file to revision 'HEAD'. |
| 098  | skipped | 0 |  |  | depends on parked 095 |
| 099  | skipped | 0 |  |  | depends on parked 095 |

## Decisions

triage: shadow · agreement (last 50): 89% · collapsed: 0 · ask: 0 · follow-ups: 0

### Not triaged

- D1 · 095 · none · behaviour: the reviewer gets no Bash at all (READ_ONLY_BASH = []), because a Bash(git diff:*) prefix cannot refuse --output or --no-index, so no test could show them refused — reverse: restore the git diff / git show prefixes in core/scripts/lib/claude-run.mjs
- D2 · 095 · none · behaviour: a run and its dry run now refuse to start when .claude/settings.json has no PreToolUse hooks (unguarded) — reverse: remove that check in run-plans.mjs and give allowedTools() a different fallback
- D3 · 095 · none · behaviour: isSensitive is exported from core/scripts/ship-prep.mjs, with no new sensitive-paths.mjs, because moving it would break tools/install-check.mjs, which is outside the scope — reverse: move it to lib/sensitive-paths.mjs and update install-check

## Run notes

- 095: escalated to a fresh judgment-tier builder (round 1): builder: claude timed out after 20 min
- 095: parked: nothing to save (nothing uncommitted)
- wave 1 parked 095 — skipped 098, 099; 0 later plan(s) go on

## Models per agent

## What only the Human can do

- nothing to validate

- Decide on 095: review could not run: review folder: git worktree add: fatal: Could not reset index file to revision 'HEAD'.
- Decide on 098: depends on parked 095
- Decide on 099: depends on parked 095
- Review and merge the run branch (PowerShell, one line each):

```powershell
git fetch origin
gh pr create --base main --head orch/run-095 --title "Orchestrator run run-095" --body-file .claude\orchestrator-runs\run-095.md
```

Context added by learning: 462 chars across 2 roles

Trend (last 3 runs): ✗ per plan 0 → 0 → - · fix rounds per plan 1 → 0 → 0 · parked 0 → 0 → 1
