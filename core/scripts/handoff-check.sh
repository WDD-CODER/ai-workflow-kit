#!/bin/bash
# handoff-check.sh — Stop hook
# Releases this slot's liveness lock at the end of a turn (two-slot parallel session system).
# The file name is kept so projects' hook settings keep working; it no longer checks any state file.
#
# Hook type: Stop
# Timeout: 10s

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CURRENT_TOPLEVEL="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -n "$CURRENT_TOPLEVEL" ]; then
  source "$SCRIPT_DIR/session-lock.sh"
  release_lock "$CURRENT_TOPLEVEL"
fi

exit 0
