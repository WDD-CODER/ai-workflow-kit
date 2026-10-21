#!/usr/bin/env bash
# pre-compact-reminder.sh — PreCompact hook
# Fires when context is about to be compressed. Reminds the AI to save
# critical state before earlier conversation details are lost.
#
# Hook type: PreCompact (matcher: "")
# Timeout: 5s

cat <<'EOF'
{
  "systemMessage": "Context is about to be compressed. Before proceeding, confirm:\n1. Have important decisions and progress been written to session-state.md?\n2. Are there any unpushed commits that need to be recorded?\n3. Are next steps documented?\n\nAfter compression, early conversation details will be lost. session-state.md is the memory bridge across compressions."
}
EOF

exit 0
