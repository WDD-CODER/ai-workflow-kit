#!/usr/bin/env bash
# session-startup.sh — SessionStart hook
# Tells the session its role (Planner / Worker plan / idle slot) and frees merged slots. Where work stands is read
# from the plan (its checkboxes and Execution Notes) and git, not from a saved state file.
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

# The Planner folder stays on main: every session open in that folder shares its branch.
PLANNER_BRANCH=$(git -C "$REPO_ROOT" branch --show-current 2>/dev/null)
if [[ "$DESCRIBE" == PLANNER:* && -n "$PLANNER_BRANCH" && "$PLANNER_BRANCH" != "main" ]]; then
  DESCRIBE="$DESCRIBE WARNING: the Planner folder is on $PLANNER_BRANCH, not main, and every session in this folder is on it too. Tell the Human before doing anything else."
fi

# Model routing (docs/agent/model-routing.md): these variables override every kit agent file's `model:`.
if [[ -n "${CLAUDE_CODE_SUBAGENT_MODEL:-}" ]]; then
  DESCRIBE="$DESCRIBE MODEL_ROUTING: CLAUDE_CODE_SUBAGENT_MODEL=$CLAUDE_CODE_SUBAGENT_MODEL overrides the kit's agent models on Claude Code before v2.1.251 (and on any version with CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1). Tell the Human once."
fi
if [[ -n "${CLAUDE_CODE_SUBAGENT_MODEL_FORCE:-}" && "${CLAUDE_CODE_SUBAGENT_MODEL_FORCE}" != "0" ]]; then
  DESCRIBE="$DESCRIBE MODEL_ROUTING: CLAUDE_CODE_SUBAGENT_MODEL_FORCE=$CLAUDE_CODE_SUBAGENT_MODEL_FORCE makes Claude Code ignore the kit's agent models. Tell the Human once."
fi

# The hook output is built in node: JSON.stringify keeps quotes, backslashes and newlines valid.
# additionalContext sits directly under hookSpecificOutput.
emit() {
  KIT_CTX="$1" node -e 'process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: process.env.KIT_CTX } }) + "\n")'
}

emit "$DESCRIBE"
exit 0
