#!/bin/bash
# Branch Guard - PreToolUse hook
# stdout MUST be valid JSON for Cursor PreToolUse.
#
# On main, a write to plans/<name>.plan.md or .claude/todo.md is the
# Planner's admin bypass (see AGENTS.md's Planner-Worker workflow) and is
# allowed without switching. Any other path on main still auto-switches.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"

# Read tool stdin with a timeout (same pattern as plan-write-guard.sh) so a
# left-open pipe can't hang the hook. Empty/timeout -> unknown path, which
# falls through to the safe default (auto-switch).
INPUT=""
if command -v timeout >/dev/null 2>&1; then
  INPUT=$(timeout 1 cat 2>/dev/null || true)
elif command -v gtimeout >/dev/null 2>&1; then
  INPUT=$(gtimeout 1 cat 2>/dev/null || true)
else
  INPUT=$(python -c "
import sys, select
r, _, _ = select.select([sys.stdin], [], [], 0.3)
print(sys.stdin.read() if r else '')
" 2>/dev/null || true)
fi

FILE_PATH=""
if [[ -n "$INPUT" ]]; then
  FILE_PATH=$(BRANCH_GUARD_INPUT="$INPUT" python - <<'PY'
import json, os
raw = os.environ.get("BRANCH_GUARD_INPUT", "")
path = ""
try:
    d = json.loads(raw)
    ti = d.get("tool_input") or d.get("input") or d
    if isinstance(ti, dict):
        path = ti.get("file_path") or ti.get("path") or ti.get("filePath") or ""
        edits = ti.get("edits")
        if not path and isinstance(edits, list) and edits:
            path = edits[0].get("file_path") or edits[0].get("path") or ""
except Exception:
    pass
print(path)
PY
  )
fi
NORM=$(printf '%s' "$FILE_PATH" | tr '\\' '/')

# A file outside this REPO (e.g. in a sibling {{slots.nameFormat}} worktree) is never on
# `main` and has no guard of its own to borrow — skip entirely rather than
# switching THIS repo's branch for an edit that happened somewhere else.
#
# This also computes REL_PATH (repo-relative, forward-slashed) because the
# Write/Edit tools always pass an ABSOLUTE file_path. Matching the plans/
# and .claude/todo.md bypass patterns against the raw NORM (still absolute)
# never matches, so the Planner admin bypass below silently never fires and
# every plan save force-switches off main. Match REL_PATH instead.
REL_PATH="$NORM"
if [[ -n "$FILE_PATH" ]]; then
  READ_RESULT=$(REPO_PATH="$REPO" FILE_PATH_INPUT="$FILE_PATH" python - <<'PY'
import os
repo = os.environ.get("REPO_PATH", "")
path = os.environ.get("FILE_PATH_INPUT", "")
try:
    repo_n = os.path.normcase(os.path.normpath(os.path.abspath(repo)))
    path_abs = path if os.path.isabs(path) else os.path.join(repo, path)
    path_n = os.path.normcase(os.path.normpath(os.path.abspath(path_abs)))
    if path_n == repo_n or path_n.startswith(repo_n + os.sep):
        rel = os.path.relpath(path_n, repo_n).replace(os.sep, "/")
        print("1|" + rel)
    else:
        print("0|")
except Exception:
    print("1|")
PY
  )
  INSIDE_REPO="${READ_RESULT%%|*}"
  if [[ "$INSIDE_REPO" == "0" ]]; then
    # The file lives in another worktree (a slot, or the Planner folder): that worktree's own
    # guard decides, so a session never borrows the wrong folder's rules.
    TARGET_DIR=$(dirname "$NORM")
    while [[ -n "$TARGET_DIR" && ! -d "$TARGET_DIR" && "$(dirname "$TARGET_DIR")" != "$TARGET_DIR" ]]; do TARGET_DIR=$(dirname "$TARGET_DIR"); done
    TARGET_ROOT=$(git -C "$TARGET_DIR" rev-parse --show-toplevel 2>/dev/null)
    # Only a worktree of this same repository (same git common dir): never run another repo's script.
    SAME_REPO=0
    if [[ -n "$TARGET_ROOT" ]]; then
      [[ "$(cd "$TARGET_ROOT" && cd "$(git rev-parse --git-common-dir)" && pwd)" == "$(cd "$REPO" && cd "$(git rev-parse --git-common-dir)" && pwd)" ]] && SAME_REPO=1
    fi
    if [[ "$SAME_REPO" -eq 1 && -f "$TARGET_ROOT/scripts/branch-guard.sh" ]]; then
      printf '%s' "$INPUT" | bash "$TARGET_ROOT/scripts/branch-guard.sh"
      exit 0
    fi
    printf '{"permission":"allow","agent_message":"BRANCH_GUARD: %s is outside this worktree - no branch action taken."}\n' "$NORM"
    exit 0
  fi
  REL_PATH="${READ_RESULT#*|}"
fi

CURRENT=$(git -C "$REPO" branch --show-current 2>/dev/null)
MSG=""

if [[ "$CURRENT" == "{{git.mainBranch}}" || "$CURRENT" == "master" ]]; then
  if [[ "$REL_PATH" =~ ^plans/[^/]+\.plan\.md$ ]] || [[ "$REL_PATH" == ".claude/todo.md" ]]; then
    printf '{"permission":"allow","agent_message":"BRANCH_GUARD: Planner admin bypass - %s stays on main."}\n' "$REL_PATH"
    exit 0
  fi

  # The Planner folder (no .worktree-port) never leaves {{git.mainBranch}} on its own: every session open
  # in it would follow the switch. Code goes through a slot, or a branch the Human asked for.
  if [[ ! -f "$REPO/.worktree-port" ]]; then
    DENY="BRANCH_GUARD: the Planner folder stays on {{git.mainBranch}} - only plans/*.plan.md and .claude/todo.md are written here. Do code work in a {{slots.nameFormat}} slot (take-plan). If the Human explicitly wants it done in this folder, create the branch first (git switch -c <type>/<slug>) and tell them every session in this folder moves with it."
    DENY_ESC=$(printf '%s' "$DENY" | python -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null)
    [[ -z "$DENY_ESC" ]] && DENY_ESC="\"BRANCH_GUARD: the Planner folder stays on {{git.mainBranch}}\""
    printf '{"permission":"deny","agent_message":%s,"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' "$DENY_ESC" "$DENY_ESC"
    exit 0
  fi

  BRANCH="feat/session-$(date +%Y%m%d)"
  if git -C "$REPO" show-ref --verify --quiet "refs/heads/$BRANCH" 2>/dev/null; then
    BRANCH="feat/session-$(date +%Y%m%d-%H%M)"
  fi
  git -C "$REPO" checkout -b "$BRANCH" 2>/dev/null
  MSG="BRANCH_GUARD: Auto-switched from main to new branch $BRANCH before writing code. Tell the user: Moved to branch \`$BRANCH\` before making any changes."
  echo "$MSG" >&2
fi

if [[ -n "$MSG" ]]; then
  ESCAPED=$(printf '%s' "$MSG" | python -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null)
  if [[ -z "$ESCAPED" ]]; then
    ESCAPED="\"$MSG\""
  fi
  printf '{"permission":"allow","agent_message":%s}\n' "$ESCAPED"
else
  printf '{"permission":"allow"}\n'
fi

exit 0
