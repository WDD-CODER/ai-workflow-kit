---
name: github-sync
description: Pulls recent GitHub activity and syncs the local branch at session start or after time away — runs once per calendar day.
---

# Skill: github-sync

**Trigger:** Session start or after time away. **Once-per-day gate:** Check `notes/github-sync/<today-date>.md` first — if it exists, skip and print `✓ GitHub sync already ran today`. Only run if missing.
**Standard:** Session start rules are in session context from startup — no file reload needed.

---

## Phase 0: Worktree Remote Cleanup `[Procedural — Haiku/Composer (Fast/Flash)]`

**Check for breadcrumb:** If `.worktree-cleanup` exists in the repo root:
1. Read each line (one branch name per line)
2. For each branch name, run: `git push origin --delete <branch-name>`
   - If it succeeds: log `✓ Deleted remote branch: <branch-name>`
   - If it fails with "remote ref does not exist": log `✓ Already gone: <branch-name>` (safe to ignore)
3. Delete the `.worktree-cleanup` file after processing all entries
4. Run `git fetch --prune` to sync remote refs

If `.worktree-cleanup` does not exist, skip this phase entirely.

---

## Phase 1: Environment Audit `[Procedural — Haiku/Composer (Fast/Flash)]`

**Status Check:** Run `git status` and `git fetch`.

**Conflict Check:** Identify if local changes conflict with remote `main` or active `feat/` branch.

**Worktree Detection:** Identify if operating in a worktree; verify `.worktree-port` and `.worktree-root`.

---

## Phase 2: Synchronization `[Procedural — Haiku/Composer (Fast/Flash)]`

**Pull / Rebase:** Execute `git pull --rebase` for clean history.

**Stash Management:** If uncommitted changes exist: `git stash` → sync → `git stash pop`.

**Branch Cleanup:** Identify merged local branches safe to delete.

---

## Phase 3: Session Intelligence `[High Reasoning]`

**Daily Log Audit:** Read latest `.claude/sessions/*/session-handoff.md` (preferred) or `notes/session-handoffs/` (legacy fallback) and `notes/github-sync/` files. Summarize the "State of the Project" for the current session.

**GitHub Context:** Read open PRs via MCP (`mcp__github__list_pull_requests`) → fallback to `gh pr list`. Surface any pending reviews or CI failures.

**Todo Alignment:** Verify `.claude/todo.md` matches the current branch state.

---

## Completion Gate

Output: `"GitHub sync complete. Remote changes merged. Local branch is up to date."`

Save sync log to `notes/github-sync/<today-date>.md`.


