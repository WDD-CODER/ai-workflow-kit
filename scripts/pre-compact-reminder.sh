#!/usr/bin/env bash
# pre-compact-reminder.sh — PreCompact hook
# Fires when context is about to be compressed. Reminds the AI to put open work where it survives.
#
# Hook type: PreCompact (matcher: "")
# Timeout: 5s

cat <<'EOF'
{
  "systemMessage": "Context is about to be compressed. Before proceeding, confirm:\n1. Are the decisions and progress of this job in the plan (its checkboxes and Execution Notes) or committed?\n2. Are there any unpushed commits?\n3. Are the open signals and next steps written out in chat so /compact can keep them?\n\nAfter compression, early conversation details will be lost."
}
EOF

exit 0
