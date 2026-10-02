#!/bin/bash
# handoff-check.sh — Stop hook
# Validates that session-state.md is complete when a handoff is in progress.
# Only activates when session-state.md was modified in the last 60 seconds
# (i.e., the AI just wrote/updated it). Silent otherwise.
#
# Checks for: latest commit hash, session summary section, next steps section.
#
# Set SESSION_STATE_PATH to customize the file location.
# Default: docs/session-state.md
#
# Hook type: Stop
# Timeout: 10s

# Release this slot's liveness lock unconditionally, before any of the checks below
# (which have early exits) — two-slot parallel session system.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CURRENT_TOPLEVEL="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -n "$CURRENT_TOPLEVEL" ]; then
  source "$SCRIPT_DIR/session-lock.sh"
  release_lock "$CURRENT_TOPLEVEL"
fi

# Resolved the same way session-startup.sh and write-session-state.mjs do —
# see scripts/session-state-path.mjs.
SESSION_STATE=$(node "$SCRIPT_DIR/session-state-path.mjs" 2>/dev/null)

if [ "$SESSION_STATE" = "NONE" ] || [ -z "$SESSION_STATE" ] || [ ! -f "$SESSION_STATE" ]; then
  exit 0
fi

# Check if session-state.md was modified in the last 60 seconds
if [ "$(uname -s)" = "Linux" ] || [ "$(uname -o 2>/dev/null)" = "Msys" ] || [ "$(uname -o 2>/dev/null)" = "Cygwin" ]; then
  FILE_MTIME=$(stat -c %Y "$SESSION_STATE" 2>/dev/null || stat -f %m "$SESSION_STATE" 2>/dev/null)
else
  FILE_MTIME=$(stat -f %m "$SESSION_STATE" 2>/dev/null)
fi
NOW=$(date +%s)
AGE=$(( NOW - FILE_MTIME ))

if [ "$AGE" -gt 60 ]; then
  # Not recently modified — not a handoff, stay silent
  exit 0
fi

# session-state.md was just modified — validate content
LATEST_COMMIT=$(git log -1 --format="%h" 2>/dev/null)
ERRORS=""

if [ -n "$LATEST_COMMIT" ]; then
  if ! grep -q "$LATEST_COMMIT" "$SESSION_STATE" 2>/dev/null; then
    ERRORS="${ERRORS}Warning: session-state.md does not contain the latest commit hash ($LATEST_COMMIT)\n"
  fi
fi

if ! grep -q "## Session Summary" "$SESSION_STATE" 2>/dev/null; then
  ERRORS="${ERRORS}Warning: session-state.md is missing a '## Session Summary' section\n"
fi

if ! grep -q "## Next Steps" "$SESSION_STATE" 2>/dev/null; then
  ERRORS="${ERRORS}Warning: session-state.md is missing a '## Next Steps' section\n"
fi

if [ -n "$ERRORS" ]; then
  echo -e "Handoff check found issues:\n${ERRORS}Please fix these before ending the session."
fi

exit 0
