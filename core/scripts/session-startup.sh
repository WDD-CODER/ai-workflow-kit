#!/usr/bin/env bash
# session-startup.sh — SessionStart hook
# Automatically loads the previous session's state into context,
# so the AI picks up exactly where it left off.
#
# Branch-canonical save target:
#   - SAVE_PATH = docs/session-state-${BRANCH}.md (no PPID — safe to commit on /ship)
#   - .claude/.session-state-path is local-only (gitignored) so SessionStart never dirties git
#   - Override both with SESSION_STATE_PATH for rare parallel-window cases
#   - Falls back to docs/session-state.md if no branch file exists
#
# Hook type: SessionStart (matcher: "startup")
# Timeout: 10s

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Planner-Worker slot role (no auto-claim) ---
DESCRIBE=$(node "$SCRIPT_DIR/lib/slot.mjs" --describe 2>/dev/null)

if [[ "$DESCRIBE" == IDLE\ SLOT:* ]]; then
  cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "decision": {
      "additionalContext": "$DESCRIBE"
    }
  }
}
EOF
  exit 0
fi
# --- end slot role ---

# Resolved once, the same way for session-startup.sh, handoff-check.sh and
# write-session-state.mjs — see scripts/session-state-path.mjs.
RESOLVED=$(node "$SCRIPT_DIR/session-state-path.mjs" 2>/dev/null)

if [ "$RESOLVED" = "NONE" ]; then
  cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "decision": {
      "additionalContext": "IDLE SLOT: ask Dandan which plan to execute."
    }
  }
}
EOF
  exit 0
fi

SAVE_PATH="$RESOLVED"
SESSION_STATE="$RESOLVED"

# Local pointer only — gitignored
mkdir -p .claude
echo "$SAVE_PATH" > .claude/.session-state-path

BRANCH=$(git branch --show-current 2>/dev/null)
BRANCH="${BRANCH:-main}"

if [ -f "$SESSION_STATE" ]; then
  # Do not Read .claude/todo.md in full. Only Session Summary / Next Steps / Commit
  # are injected here, capped at 1500 chars — full session-state stays on disk.
  CONTENT=$(awk '
    /^## Session Summary/ { flag=1 }
    /^## Next Steps/ { flag=1 }
    /^## Commit/ { flag=1 }
    /^## / && $0 !~ /^## Session Summary/ && $0 !~ /^## Next Steps/ && $0 !~ /^## Commit/ { flag=0 }
    flag { print }
  ' "$SESSION_STATE")

  if [ -z "$CONTENT" ]; then
    CONTENT=$(head -c 1500 "$SESSION_STATE")
  else
    CONTENT=$(printf '%s' "$CONTENT" | head -c 1500)
  fi

  cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "decision": {
      "additionalContext": "$DESCRIBE\\n\\nPrevious session state loaded from: $SESSION_STATE\\n$CONTENT\\n\\nFull file: $SESSION_STATE — read only if needed.\\n\\n---\\nSESSION SAVE TARGET: $SAVE_PATH\\nWhen ending this session, write session-state to the path above (not docs/session-state.md directly). The pointer file .claude/.session-state-path is local-only (gitignored)."
    }
  }
}
EOF
else
  cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "decision": {
      "additionalContext": "$DESCRIBE\\n\\nNo previous session state found for branch: ${BRANCH}.\\n\\n---\\nSESSION SAVE TARGET: $SAVE_PATH\\nWhen ending this session, write session-state to the path above."
    }
  }
}
EOF
fi

exit 0
