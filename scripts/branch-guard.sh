#!/bin/bash
# Branch Guard - PreToolUse hook (Edit|Write|MultiEdit and Bash). stdout MUST be valid JSON for Cursor PreToolUse.
#
# On main, a write to an open plan (plans/<name>.plan.md, plans/design/<name>.plan.md) or .claude/todo.md is
# the Planner's admin bypass and is allowed; gitignored runtime files (.claude/sessions/**,
# .claude/.plan-write-ack) are allowed too. Any other write is refused in the Planner folder and auto-switches a
# wt-N slot to a session branch. A file in another worktree is judged by that worktree's guard; a Bash
# command is judged by the files it writes.
# The logic lives in scripts/lib/guard.mjs (one node process: Git Bash start-up is the slow part on Windows).
s="${BASH_SOURCE[0]//\\//}"
d="${s%/*}"
[[ "$d" == "$s" ]] && d=.
exec node "$d/lib/guard.mjs" branch
