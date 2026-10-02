#!/usr/bin/env bash
# prune-old-sessions.sh
# Removes directories in .claude/sessions/ whose mtime > 14 days old.
# Excludes any directory matching the current git branch name.
# Default: dry-run (no deletions). Pass --confirm to actually delete.

set -euo pipefail

SESSIONS_DIR="$(git rev-parse --show-toplevel)/.claude/sessions"
MAX_AGE_DAYS=14
CONFIRM=false

for arg in "$@"; do
  if [ "$arg" = "--confirm" ]; then
    CONFIRM=true
  fi
done

if [ ! -d "$SESSIONS_DIR" ]; then
  echo "[prune-old-sessions] sessions dir not found: $SESSIONS_DIR"
  exit 0
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

echo "[prune-old-sessions] Scanning $SESSIONS_DIR (max age: ${MAX_AGE_DAYS} days)"
if [ "$CONFIRM" = false ]; then
  echo "[prune-old-sessions] DRY RUN — pass --confirm to delete"
fi
echo ""

FOUND=0
SKIPPED=0

while IFS= read -r -d '' dir; do
  name=$(basename "$dir")

  # Skip if dir name contains current branch name (protect active session)
  if [ -n "$CURRENT_BRANCH" ] && echo "$name" | grep -qF "$CURRENT_BRANCH"; then
    echo "  SKIP (active branch match): $name"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # Check mtime of the directory itself
  if [ "$(uname)" = "Darwin" ]; then
    mtime=$(stat -f %m "$dir" 2>/dev/null || echo 0)
  else
    mtime=$(stat -c %Y "$dir" 2>/dev/null || echo 0)
  fi
  now=$(date +%s)
  age_days=$(( (now - mtime) / 86400 ))

  if [ "$age_days" -gt "$MAX_AGE_DAYS" ]; then
    FOUND=$((FOUND + 1))
    if [ "$CONFIRM" = true ]; then
      echo "  DELETE (${age_days}d old): $name"
      rm -rf "$dir"
    else
      echo "  WOULD DELETE (${age_days}d old): $name"
    fi
  fi
done < <(find "$SESSIONS_DIR" -mindepth 1 -maxdepth 1 -type d -print0 2>/dev/null)

echo ""
if [ "$CONFIRM" = true ]; then
  echo "[prune-old-sessions] Done. Deleted: $FOUND, Skipped: $SKIPPED"
else
  echo "[prune-old-sessions] Dry run complete. Would delete: $FOUND, Skipped: $SKIPPED"
  echo "[prune-old-sessions] Run with --confirm to actually delete."
fi
