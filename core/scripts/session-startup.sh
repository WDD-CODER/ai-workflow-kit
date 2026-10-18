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
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# A slot whose branch already merged is freed before the role check, so it starts idle; the
# Planner folder frees finished slots too. An idle slot skips it (nothing to free). Local refs only:
# a fetch can outlast the hook's timeout, and the slot merge step already fetched.
# Freeing a slot also stops its dev servers, so it gets a longer timeout.
if [[ -f "$REPO_ROOT/.worktree-plan" || ! -f "$REPO_ROOT/.worktree-port" ]]; then
  if command -v timeout >/dev/null 2>&1; then
    timeout 10 node "$SCRIPT_DIR/free-merged-slots.mjs" --no-fetch >/dev/null 2>&1 || true
  fi
fi

# Orphan sweep: kill this folder's idle dev watchers (a `node --watch` with no child, holding no
# port) left by a session that crashed or closed before its SessionEnd hook. Runs in a slot and in the main
# folder; a server that holds a port is never touched. Its lines go into the context below.
SWEEP=""
if command -v timeout >/dev/null 2>&1; then
  SWEEP=$(timeout 8 node "$SCRIPT_DIR/orphan-sweep.mjs" --quiet 2>/dev/null | tr '\r\n"\\' '    ' || true)
fi

DESCRIBE=$(node "$SCRIPT_DIR/lib/slot.mjs" --describe 2>/dev/null)
if [[ -n "${SWEEP// /}" ]]; then
  DESCRIBE="$DESCRIBE $SWEEP"
fi

# The Planner folder stays on {{git.mainBranch}}: every session open in that folder shares its branch.
PLANNER_BRANCH=$(git -C "$REPO_ROOT" branch --show-current 2>/dev/null)
if [[ "$DESCRIBE" == PLANNER:* && -n "$PLANNER_BRANCH" && "$PLANNER_BRANCH" != "{{git.mainBranch}}" ]]; then
  DESCRIBE="$DESCRIBE WARNING: the Planner folder is on $PLANNER_BRANCH, not {{git.mainBranch}}, and every session in this folder is on it too. Tell the Human before doing anything else."
fi

# The hook output is built in node: JSON.stringify keeps quotes, backslashes and newlines from the
# session-state file valid. additionalContext sits directly under hookSpecificOutput.
emit() {
  KIT_CTX="$1" node -e 'process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: process.env.KIT_CTX } }) + "\n")'
}
NL=$'\n'

if [[ "$DESCRIBE" == IDLE\ SLOT:* ]]; then
  emit "$DESCRIBE"
  exit 0
fi
# --- end slot role ---

# Resolved once, the same way for session-startup.sh, handoff-check.sh and
# write-session-state.mjs — see scripts/session-state-path.mjs.
RESOLVED=$(node "$SCRIPT_DIR/session-state-path.mjs" 2>/dev/null)

if [ "$RESOLVED" = "NONE" ]; then
  emit "IDLE SLOT: ask the Human which plan to execute."
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

  emit "$DESCRIBE${NL}${NL}Previous session state loaded from: $SESSION_STATE${NL}$CONTENT${NL}${NL}Full file: $SESSION_STATE — read only if needed.${NL}${NL}---${NL}SESSION SAVE TARGET: $SAVE_PATH${NL}When ending this session, write session-state to the path above (not docs/session-state.md directly). The pointer file .claude/.session-state-path is local-only (gitignored)."
else
  emit "$DESCRIBE${NL}${NL}No previous session state found for branch: ${BRANCH}.${NL}${NL}---${NL}SESSION SAVE TARGET: $SAVE_PATH${NL}When ending this session, write session-state to the path above."
fi

exit 0
