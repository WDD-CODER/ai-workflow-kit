#!/bin/bash
# Scope Guard - PreToolUse hook (Planner-Worker workflow)
# Enforces a Worker's plan Read-Write Scope inside a {{slots.nameFormat}} slot. Fails open
# outside a slot, in an idle slot (no .worktree-plan), or on an internal
# scope-check error — the /ship scope gate (ship-prep.mjs) is the backstop
# in those cases. stdout MUST be valid JSON for Cursor PreToolUse.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"

json_allow() {
  local msg="$1"
  if [[ -n "$msg" ]]; then
    local escaped
    escaped=$(printf '%s' "$msg" | python -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null)
    [[ -z "$escaped" ]] && escaped="\"scope guard\""
    printf '{"permission":"allow","agent_message":%s}\n' "$escaped"
  else
    printf '{"permission":"allow"}\n'
  fi
  exit 0
}

json_deny() {
  local msg="$1"
  local escaped
  escaped=$(printf '%s' "$msg" | python -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null)
  [[ -z "$escaped" ]] && escaped="\"SCOPE_GUARD: denied - out of Read-Write Scope\""
  # Both formats: Cursor reads "permission", Claude Code reads hookSpecificOutput (it ignores the Cursor form).
  printf '{"permission":"deny","agent_message":%s,"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' "$escaped" "$escaped"
  exit 0
}

# Plan scope applies only in a slot with an active plan; the kit-owned check applies everywhere else
# (and in a slot to files the plan's scope doesn't cover).
IN_SLOT=1
[[ -f "$REPO/.worktree-port" && -f "$REPO/.worktree-plan" ]] || IN_SLOT=0

# Read tool stdin with a timeout (same pattern as plan-write-guard.sh) so a
# left-open pipe can't hang the hook.
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

if [[ -z "$INPUT" ]]; then
  [[ "$IN_SLOT" -eq 1 ]] || json_allow ""
  json_allow "SCOPE_GUARD: check failed (no tool input) - /ship scope gate will verify"
fi

FILE_PATH=$(SCOPE_GUARD_INPUT="$INPUT" python - <<'PY'
import json, os
raw = os.environ.get("SCOPE_GUARD_INPUT", "")
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

if [[ -z "$FILE_PATH" ]]; then
  [[ "$IN_SLOT" -eq 1 ]] || json_allow ""
  json_allow "SCOPE_GUARD: check failed (no file path in tool input) - /ship scope gate will verify"
fi

NORM=$(printf '%s' "$FILE_PATH" | tr '\\' '/')

# A file in another worktree (a slot edited from the Planner session, or the reverse) is judged by
# that worktree's own guard: its plan scope, not this folder's.
TARGET_DIR=$(dirname "$NORM")
while [[ -n "$TARGET_DIR" && ! -d "$TARGET_DIR" && "$(dirname "$TARGET_DIR")" != "$TARGET_DIR" ]]; do TARGET_DIR=$(dirname "$TARGET_DIR"); done
TARGET_ROOT=$(git -C "$TARGET_DIR" rev-parse --show-toplevel 2>/dev/null)
THIS_ROOT=$(git -C "$REPO" rev-parse --show-toplevel 2>/dev/null)
# Only a worktree of this same repository (same git common dir): never run another repo's script.
SAME_REPO=0
if [[ -n "$TARGET_ROOT" && -n "$THIS_ROOT" && "$TARGET_ROOT" != "$THIS_ROOT" ]]; then
  [[ "$(cd "$TARGET_ROOT" && cd "$(git rev-parse --git-common-dir)" && pwd)" == "$(cd "$REPO" && cd "$(git rev-parse --git-common-dir)" && pwd)" ]] && SAME_REPO=1
fi
if [[ "$SAME_REPO" -eq 1 && -f "$TARGET_ROOT/scripts/scope-guard.sh" ]]; then
  printf '%s' "$INPUT" | bash "$TARGET_ROOT/scripts/scope-guard.sh"
  exit 0
fi
# Outside this worktree and not a sibling worktree (e.g. the kit repo): plan scope governs this repo only.
NORM_LC=$(printf '%s' "$NORM" | tr '[:upper:]' '[:lower:]')
ROOT_LC=$(printf '%s' "$THIS_ROOT" | tr '[:upper:]' '[:lower:]')
if [[ -n "$ROOT_LC" && "$NORM_LC" == /* || -n "$ROOT_LC" && "$NORM_LC" == ?:/* ]]; then
  [[ "$NORM_LC" == "$ROOT_LC"/* ]] || json_allow ""
fi

# Kit-owned workflow files (ADR 0015 phase 5): the kit repo is their source of truth. Fails open if the checker is absent.
KIT_OUT=""
KIT_OWNED=0
if [[ -f "$REPO/scripts/kit-owned.mjs" ]]; then
  KIT_OUT=$(node "$REPO/scripts/kit-owned.mjs" --file="$NORM" 2>&1)
  printf '%s' "$KIT_OUT" | grep -q '^KIT_OWNED: yes' && KIT_OWNED=1
fi

kit_deny() {
  # Both formats: Cursor reads "permission", Claude Code reads hookSpecificOutput (it ignores the Cursor form).
  local esc
  esc=$(printf '%s' "$KIT_OUT" | python -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null)
  [[ -z "$esc" ]] && esc='"KIT_OWNED: yes - owned by the workflow kit"'
  printf '{"permission":"deny","agent_message":%s,"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}
' "$esc" "$esc"
  exit 0
}

# Outside a slot with an active plan (the Planner folder, an idle slot): kit-owned files stay blocked.
if [[ "$IN_SLOT" -eq 0 ]]; then
  [[ "$KIT_OWNED" -eq 1 ]] && kit_deny
  json_allow ""
fi

# In a slot the plan's Read-Write Scope decides: a kit-owned file the plan lists was approved with the plan.
OUT=$(node "$REPO/scripts/scope-check.mjs" --file="$NORM" 2>&1)
STATUS=$?

if [[ "$STATUS" -eq 0 ]]; then
  [[ "$KIT_OWNED" -eq 1 ]] && json_allow "SCOPE_GUARD: $NORM is kit-owned but in this plan's scope - allowed. Back-port the change to the workflow kit at /ship."
  json_allow ""
fi

if printf '%s' "$OUT" | grep -q '^SCOPE: out'; then
  json_deny "SCOPE_GUARD: $NORM is outside this plan's Read-Write Scope. Reading is fine; writing is not. STOP and tell the Human: file, exact change, why it can't be done in-scope. Wait for \"approved: $NORM\", then append the path to the plan's scope block and retry."
fi

[[ "$KIT_OWNED" -eq 1 ]] && kit_deny
json_allow "SCOPE_GUARD: check failed ($OUT) - /ship scope gate will verify"
