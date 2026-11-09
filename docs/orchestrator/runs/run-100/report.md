# Orchestrator run run-100

Run branch: `orch/run-100` (from `origin/main` at ceaf4ef) · started 2026-11-08T18:21:01.292Z · finished 2026-11-08T19:53:34.892Z
Result: 1 merged, 4 parked, skipped or left out, 5 in the run (counted from git and status.json).
`main` untouched: yes — origin/main is ceaf4ef.

Final gate: ok (attempt 1)

## Plans

| Plan | State | Rounds | Builder tier | Merge | Why |
| --- | --- | --- | --- | --- | --- |
| 100 A run survives its session: a supervisor relaunches a killed run and waits out a rate limit | merged | 1 | build → judgment | ee369a1 | builder blocked: Writing core/.claude/commands/orchestrate.md is refused, both with Edit and with `cp` from a scratch file ("Claude requested permissions to edit … which is a sensitive file"). So `node tools/install-check.mjs` exits 1 (2 orchestrate.md assertions) and `node --test tools/test/run-supervisor.test.mjs` (fix rounds used: 1 of 2) — needs the Human |
| 101 A plan may change the test file next to a file in its scope, and readiness finds the tests it forgot | parked | 0 | build |  | worktree: git worktree add C:\coding projects\Cursor\ai-workflow-kit-orch-run-100-101: fatal: 'feat/101-a-plan-may-change' is already used by worktree at 'C:/coding projects/Cursor/ai-workflow-kit-fix-100' |
| 102  | skipped | 0 |  |  | shares files with parked 101 |
| 103  | skipped | 0 |  |  | shares files with parked 101 |
| 104  | skipped | 0 |  |  | shares files with parked 101 |

## Decisions

triage: shadow · agreement (last 50): 89% · collapsed: 0 · ask: 0 · follow-ups: 0

### Not triaged

- D1 · 100 · none · behaviour: the supervisor reads a reset time in the machine's local time and ignores any zone name in the message, so a limit that names another zone may wait too long or too short — reverse: parse the zone in resetWaitMs
- D2 · 100 · none · behaviour: the sweep does not run prune-merged-worktrees.sh. sweepFolders() in run-supervisor.mjs does its own checks on the orch-merge and orch-<run>-<NNN> folders, and the sweep scripts are unchanged — reverse: call the script from the supervisor's main()
- D3 · 100 · none · behaviour: a run counts as live when its supervisor pid is alive or its status.json says running and was touched within 15 minutes; orphan-sweep.mjs is skipped while any run is live — reverse: change liveRuns()
- D4 · 100 · none · behaviour: a stopped run (a stop other than a rate limit) is not relaunched, and a child that dies before writing status.json counts as a death — reverse: edit supervise()
- D5 · 100 · none · seen: core/.claude/commands/orchestrate.md — writes are refused as a sensitive file in this environment, which blocks S7
- D6 · 100 · none · behaviour: a launch of run-plans.mjs that never reaches init (a refusal, or a crash before it) ends the supervisor and is not relaunched — reverse: in classify(), treat kind 'refused' like 'died'
- D7 · 100 · none · behaviour: the sweep calls orphan-sweep.mjs and free-merged-slots.mjs --no-fetch but not prune-merged-worktrees.sh, because that script works on .claude/worktrees (session worktrees, not run leftovers) and its --confirm uses --force/rm -rf — reverse: add ['prune-merged-worktrees.sh'] (via bash) to the list in sweepLeftovers()
- D8 · 100 · none · behaviour: a run folder that git does not list as a worktree is kept with the line 'remove it by hand', never deleted with a recursive delete — reverse: in sweepLeftovers(), remove it instead of keep(...)
- D9 · 100 · none · behaviour: when the rate-limit message names a reset time, the wait is that time plus one minute; when the next wait would push the total past 6 hours, the supervisor stops the run ('supervisor gave up: the rate-limit waits would pass 6 hours …') rather than relaunching early — reverse: clamp waitMs to what is left of the 6 hours instead of giving up
- D10 · 100 · none · removes: /orchestrate's own 'relaunch once after a harness kill' step and the hand relaunch after a rate limit (the supervisor now does both; this takes effect only once the blocked orchestrate.md edit lands) — reverse: restore steps 3 and 4 of core/.claude/commands/orchestrate.md from b94afb4
- D11 · 101 · none · behaviour: I put the eval cases in a new folder docs/agent-evals/cases/plan-reviewer/ and left the role list in tools/test/eval-cases.test.mjs unchanged, because that file is outside the scope. Nothing runs these two cases until a harness names the role — reverse: add 'plan-reviewer' to ROLES there.
- D12 · 101 · none · behaviour: the weakened-test check reads the old line number of the removed assertion for the <file>:<line> in its reason — reverse: use the new numbering in removedLinesByFile()
- D13 · 101 · none · behaviour: plannedTestPaths() reads only the Atomic Sub-tasks section and the top-level '- [auto|ui|human]' Done-when lines. It skips tokens that are globs, URLs or start with a dot — reverse: widen the scan in plannedTestPaths()
- D14 · 101 · none · seen: tools/test/eval-cases.test.mjs:17 — the ROLES list does not include plan-reviewer, so its eval cases are never schema-checked

## Run notes

- 100: builder left undone (round 0): S7: core/.claude/commands/orchestrate.md still has the old run_in_background and relaunch steps. core/docs/agent/orchestrator.md and tools/install-check.mjs are changed.; S8: resync after the command changes, then npm run build, lint, test, install-check, size-budget, drift-check and scope-check. On
- 100: escalated to a fresh judgment-tier builder (round 1): builder blocked: Writes to core/.claude/commands/orchestrate.md are refused by a 'sensitive file' permission. Write, Edit and cp all failed. Until that file changes, the orchestrate.md test in run-supervisor.test.mjs and tools/install-check.mjs fail.
- 100: builder left undone (round 1): S7 (part): core/.claude/commands/orchestrate.md is unchanged because this session refuses writes under .claude/. The doc and install-check parts of S7 are done. The exact new text is in the plan's Execution Notes: step 2 runs `node scripts/run-supervisor.mjs --run <run> --plans <NNN,NNN>` (prints SU
- 100: parked: nothing to save (nothing uncommitted)
- wave 1 parked 100 — skipped 102, 104; 0 later plan(s) go on
- 101: builder left undone (round 0): S5b: the blocking rule in core/.claude/agents/plan-reviewer.md (Edit refused as a sensitive file); S6: reword core/.claude/commands/plan.md l.68–70 without adding a line; same rewording in core/.claude/references/prd-template.md l.32–33 and core/.claude/skills/save-plan/SKILL.md l.32 (Edit refused);
- 101: escalated to a fresh judgment-tier builder (round 1): builder ESCALATE: Edit on core/.claude/agents/plan-reviewer.md and core/.claude/commands/plan.md returned 'Claude requested permissions to edit … which is a sensitive file' (twice). S5b and S6 need those files. I did not work around the refusal.
- 101: builder left undone (round 1): S1-S5: not redone. The first attempt is in c564320 (git show c564320). They are only worth redoing once S5b and S6 can be written.; S5b: core/.claude/agents/plan-reviewer.md cannot be edited in this session (sensitive-file permission); S6: core/.claude/commands/plan.md (and very likely the other cor
- 101: parked: nothing to save (nothing uncommitted)
- wave 1 parked 101 — skipped 104; 0 later plan(s) go on
- wave 1 parked 101 — skipped 104; 0 later plan(s) go on

## Models per agent

- 100 builder: sonnet
- 100 judgment builder: opus

## What only the Human can do

### Removed behaviour — check before merging the PR

1. 100: D10 removes: /orchestrate's own 'relaunch once after a harness kill' step and the hand relaunch after a rate limit (the supervisor now does both; this takes effect only once the blocked orchestrate.md edit lands) — reverse: restore steps 3 and 4 of core/.claude/commands/orchestrate.md from b94afb4 — open the screen; accept: decisions: ok · keep it: D10 ✗ restore

### The plans' [human] items (no UI check ran)

2. 100 A run survives its session: a supervisor relaunches a killed run and waits out a rate limit: On the installed project (Windows), start a run with `/orchestrate`, then close that Claude Code session: the run goes on (`watch` keeps showing progress) and ends with its report (reply `ok`).

- Decide on 101: worktree: git worktree add C:\coding projects\Cursor\ai-workflow-kit-orch-run-100-101: fatal: 'feat/101-a-plan-may-change' is already used by worktree at 'C:/coding projects/Cursor/ai-workflow-kit-fix-100'
- Decide on 102: shares files with parked 101
- Decide on 103: shares files with parked 101
- Decide on 104: shares files with parked 101
- Review and merge the run branch (PowerShell, one line each):

```powershell
git fetch origin
gh pr create --base main --head orch/run-100 --title "Orchestrator run run-100" --body-file .claude\orchestrator-runs\run-100.md
```

Context added by learning: 618 chars across 2 roles

Trend (last 3 runs): ✗ per plan 0 → 0 → - · fix rounds per plan 0 → 0.33 → 0.2 · parked 0 → 1 → 1
