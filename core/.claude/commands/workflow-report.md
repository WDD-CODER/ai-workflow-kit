---
description: Write a factual report of how the WORKFLOW went this session (not the feature) - feeds the next kit fix round
---

# /workflow-report

Run it before `/clear` when a plan finishes (Worker) or after a Planner session. Write a short, factual report of how the **workflow** went in this session, not the feature itself. Quote real command output; write "unknown" rather than guess. Do not fix anything now.

1. **Role and place**
   - Role (Planner or Worker), slot ({{slots.nameFormat}} or main folder), folder path.
   - Branch at start and at end. Plan number(s).
   - The first prompt the Human gave you.

2. **Timeline** - numbered steps: what ran (take-plan, /ship, merge, save-plan, todo sync, free-merged-slots...) and the key output line of each.

3. **What went wrong** - for each problem: symptom (exact error text), cause, workaround used, time lost (or "unknown").

4. **Checks** - answer each with yes / no / not reached, plus evidence:
   a. take-plan: did a refusal leave the slot untouched?
   b. take-plan: if the slot's previous branch was squash-merged, did it say "was merged in PR #N ... starting fresh" with no hand reset?
   c. take-plan: did the "servers:" line show both be and fe (started / kept), and did both answer?
   d. Were leftover servers stopped automatically? Did you kill anything by hand?
   e. Session state: did notes land in `docs/session-state-<this branch>.md` (not another plan's file)?
   f. Scope: did any scope check say "out" for a file that belongs to this plan? Did the slot record (`node scripts/lib/slot.mjs --list`) match the branch?
   g. Drift check: did it run (`REALITY: clean` / drift), or fail on a missing Snapshot?
   h. Merge (only if the Human said the word "merge"): stayed in the same slot folder? Ran `git fetch` and `free-merged-slots` after? No `--delete-branch`?
   i. Validation after the merge: did it go to the Planner, or did you open a second PR?
   j. Planner only: did save-plan number the plan with `node scripts/next-plan-number.mjs`? Did the todo-sync Action (or `sync --merged`) mark the merged plans in `.claude/todo.md`?
   k. Did any guard block an edit (KIT_OWNED / SCOPE_GUARD / BRANCH_GUARD)? Was the block right?
   l. Anything you did by hand that a script could have done?

5. **Verdict** - table: # | problem | generic (any project) or project-only | file where the fix belongs | proposed fix | priority (P0/P1/P2).

6. **End state** - paste the raw output of:

```bash
git branch --show-current
git status --short
git worktree list
node scripts/lib/slot.mjs --list
```
