---
name: github-sync
description: Once-a-day sync at session start or after time away — pulls with rebase, cleans up remote branches listed in `.worktree-cleanup`, prunes merged locals, and summarizes open PRs and the project state for this session. Use when a session begins, when the user says "sync", "pull", "what changed", "I'm back", or when `git status` shows the branch is behind. Skips itself if it already ran today.
allowed-tools: Bash(node scripts/github-sync-gate.mjs *) Bash(git status *) Bash(git fetch *) Bash(git branch *) Bash(git log *) Bash(gh pr list *)
---

# github-sync

## Gate (computed before you read this)

!`node scripts/github-sync-gate.mjs || true`

If the first line is `GATE: already-ran`, print `✓ GitHub sync already ran today` and stop — nothing else in this file applies. Otherwise continue; the facts above (branch, dirty count, ahead/behind, cleanup list) replace any need to re-run `git status`.

## 1. Remote cleanup (only if `CLEANUP` listed branches)

For each branch in `.worktree-cleanup`: `git push origin --delete <branch>`. "remote ref does not exist" means it is already gone — log `✓ Already gone: <branch>` and move on. When all entries are processed, delete `.worktree-cleanup` and run `git fetch --prune`. The file is the hand-off from `/cleanup` in a slot that cannot push deletes itself; leaving it behind would re-delete on every sync.

## 2. Sync

- `DIRTY > 0` → `git stash` first, pop after the pull. Never rebase on top of uncommitted work.
- `git pull --rebase` (rebase keeps the Planner/Worker history linear, which `plan-ledger-check` relies on).
- On a conflict: stop, show the conflicting files, and ask — do not resolve someone else's work.
- List local branches already merged into `{{git.mainBranch}}` (`git branch --merged {{git.mainBranch}}`) and offer them for deletion; do not delete without a yes.

## 3. Session intelligence

- Read the newest `.claude/sessions/*/session-handoff.md` and the newest `docs/session-state-*.md` (by date suffix) — these are the "where were we" files.
- `gh pr list --state open` → surface pending reviews and failing checks.
- Compare `.claude/todo.md` open items (`node scripts/todo-query.mjs open`) with the current branch; flag anything that looks finished but unmarked.

## 4. Finish

Write `notes/github-sync/<today>.md` (the `MARKER` path from the gate) with: branch, what was pulled, branches deleted, open PRs, and the 3–5 line project summary. Writing the marker is the last step on purpose — a sync that failed halfway must not count as done for today.

Then report in chat, in this shape:

```
GitHub sync complete — <branch> up to date (<n> commits pulled, <m> remote branches cleaned).
Open PRs: …
State: …
```
