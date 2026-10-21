# /cleanup — Session & Worktree Pruning

Runs dry-run of both prune scripts, reports what would be removed, then
prompts user to confirm before executing deletions.

## Usage

```
/cleanup           — dry run only (safe, no deletions)
/cleanup --confirm — dry run, show plan, ask user, then execute
```

## What it does

1. **Prune old sessions** (`scripts/prune-old-sessions.sh`)
   - Removes `.claude/sessions/` directories older than 14 days
   - Skips any directory matching the current branch name
   - Never deletes the active session

2. **Prune merged worktrees** (`scripts/prune-merged-worktrees.sh`)
   - Scans `.claude/worktrees/` for worktrees whose branch is merged to `main`
   - Archives session files to `docs/archive/worktrees/<name>/` before deletion
   - Removes the worktree directory via `git worktree remove`

## Execution steps

### Step 1 — Dry run (always runs first)

```bash
bash scripts/prune-old-sessions.sh
bash scripts/prune-merged-worktrees.sh
```

### Step 2 — User confirmation

Show the dry-run output. Ask:

> "The above items would be deleted. Type YES to confirm, or anything else to cancel."

### Step 3 — Execute (only if user confirmed YES)

```bash
bash scripts/prune-old-sessions.sh --confirm
bash scripts/prune-merged-worktrees.sh --confirm
```

## Rules

- Never skip the dry-run step, even when `--confirm` is passed.
- Never delete a file with git commits in the last 14 days — the prune scripts
  check mtime, so verify before executing if in doubt.
- `docs/session-state.md` is never touched — it is the canonical rolling file.
- The current branch's session directories are always protected.
