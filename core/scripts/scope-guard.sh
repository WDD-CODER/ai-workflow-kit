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
  printf '{"permission":"deny","agent_message":%s}\n' "$escaped"
  exit 0
}

# Not a slot at all -> nothing to enforce.
[[ -f "$REPO/.worktree-port" ]] || json_allow ""
# Idle slot (no active plan) -> nothing to enforce.
[[ -f "$REPO/.worktree-plan" ]] || json_allow ""

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

[[ -n "$INPUT" ]] || json_allow "SCOPE_GUARD: check failed (no tool input) - /ship scope gate will verify"

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

[[ -n "$FILE_PATH" ]] || json_allow "SCOPE_GUARD: check failed (no file path in tool input) - /ship scope gate will verify"

NORM=$(printf '%s' "$FILE_PATH" | tr '\\' '/')

OUT=$(node "$REPO/scripts/scope-check.mjs" --file="$NORM" 2>&1)
STATUS=$?

if [[ "$STATUS" -eq 0 ]]; then
  json_allow ""
fi

if printf '%s' "$OUT" | grep -q '^SCOPE: out'; then
  json_deny "SCOPE_GUARD: $NORM is outside this plan's Read-Write Scope. Reading is fine; writing is not. STOP and tell the Human: file, exact change, why it can't be done in-scope. Wait for \"approved: $NORM\", then append the path to the plan's scope block and retry."
fi

json_allow "SCOPE_GUARD: check failed ($OUT) - /ship scope gate will verify"
