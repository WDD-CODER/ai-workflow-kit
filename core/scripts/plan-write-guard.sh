#!/bin/bash
# Plan Write Guard - PreToolUse (Edit|Write|MultiEdit)
# Blocks naive NEW writes to plans/*.plan.md when name-similar plans exist,
# unless .claude/.plan-write-ack names the target path (save-as-new after Human confirm).
# Existing plan edits always allowed. Shared with Cursor via save-plan skill + rules.
# stdout MUST be valid JSON for PreToolUse.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
ACK_FILE="$REPO/.claude/.plan-write-ack"

# Read tool stdin with timeout (Claude Code JSON). Empty/hang -> fail open allow.
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

json_allow() {
  local msg="$1"
  if [[ -n "$msg" ]]; then
    local escaped
    escaped=$(printf '%s' "$msg" | python -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null)
    if [[ -z "$escaped" ]]; then
      escaped="\"plan write guard\""
    fi
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
  if [[ -z "$escaped" ]]; then
    escaped="\"Denied: run save-plan / plan-name-similarity first.\""
  fi
  printf '{"permission":"deny","agent_message":%s}\n' "$escaped"
  exit 0
}

if [[ -z "$INPUT" ]]; then
  json_allow ""
fi

FILE_PATH=$(PLAN_GUARD_INPUT="$INPUT" python - <<'PY'
import json, os, re
raw = os.environ.get("PLAN_GUARD_INPUT", "")
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
if not path:
    m = re.search(r"plans[/\\][\w./\\-]+\.plan\.md", raw)
    path = m.group(0) if m else ""
print(path)
PY
)

NORM=$(printf '%s' "$FILE_PATH" | tr '\\' '/')

if [[ ! "$NORM" =~ plans/.+\.plan\.md$ ]]; then
  json_allow ""
fi

if [[ "$FILE_PATH" = /* ]] || [[ "$FILE_PATH" =~ ^[A-Za-z]: ]]; then
  ABS="$FILE_PATH"
else
  ABS="$REPO/$FILE_PATH"
fi
ABS_NORM=$(printf '%s' "$ABS" | tr '\\' '/')

if [[ -f "$ACK_FILE" ]]; then
  ACK_TARGET=$(tr -d '\r\n' < "$ACK_FILE" | tr '\\' '/')
  if [[ -n "$ACK_TARGET" ]] && { [[ "$ABS_NORM" == *"$ACK_TARGET" ]] || [[ "$ACK_TARGET" == *"$NORM" ]] || [[ "$NORM" == *"$ACK_TARGET" ]]; }; then
    rm -f "$ACK_FILE" 2>/dev/null || true
    json_allow "PLAN_WRITE_GUARD: ack consumed - write allowed for $NORM"
  fi
fi

if [[ -f "$ABS" ]]; then
  json_allow "PLAN_WRITE_GUARD: editing existing plan $NORM - keep Atomic Sub-tasks in sync with .claude/todo.md"
fi

REL=$(printf '%s' "$NORM" | sed -n 's|.*\(plans/.*\.plan\.md\)|\1|p')
[[ -z "$REL" ]] && REL="$NORM"

SIM_OUT=$(node "$REPO/scripts/plan-name-similarity.mjs" --file="$REL" 2>/dev/null || true)

if printf '%s' "$SIM_OUT" | grep -q 'no similar plans'; then
  json_allow "PLAN_WRITE_GUARD: no similar plans - new file OK. Prefer save-plan skill (ledger sync)."
fi

if printf '%s' "$SIM_OUT" | grep -q 'similar plan'; then
  MSG="PLAN_WRITE_GUARD: blocked new plan write - similar plan(s) exist. Run: node scripts/plan-name-similarity.mjs --file=$REL then ask Human: rewrite existing / save as new / cancel. On save-as-new: write the relative path to .claude/.plan-write-ack then retry Write. On rewrite: Edit the existing plan path instead.
$SIM_OUT"
  json_deny "$MSG"
fi

json_allow "PLAN_WRITE_GUARD: could not run similarity check - follow .claude/skills/save-plan/SKILL.md before writing plans/"
