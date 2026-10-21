#!/bin/bash
# Scope Guard - PreToolUse hook (Edit|Write|MultiEdit and Bash). stdout MUST be valid JSON for Cursor PreToolUse.
# Holds a write to the plan's Read-Write Scope in a {{slots.nameFormat}} slot with an active plan, and outside a slot on a
# branch other than {{git.mainBranch}} that names a plan (.worktree-plan, or <type>/NNN-<slug>) — a run's merge folder.
# A file in another worktree is judged by that worktree's guard; a Bash command is judged by the files it writes.
# Fails open on an internal error — the /ship scope gate (ship-prep.mjs) is the backstop.
# The logic lives in scripts/lib/guard.mjs (one node process: Git Bash start-up is the slow part on Windows).
s="${BASH_SOURCE[0]//\\//}"
d="${s%/*}"
[[ "$d" == "$s" ]] && d=.
exec node "$d/lib/guard.mjs" scope
