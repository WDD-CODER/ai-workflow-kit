#!/usr/bin/env bash
# prune-merged-worktrees.sh
# For each directory in .claude/worktrees/, checks if its branch has been
# merged to main. If merged: archives session files to docs/archive/worktrees/
# then removes the worktree directory.
# Default: dry-run (no deletions). Pass --confirm to actually execute.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
WORKTREES_DIR="$REPO_ROOT/.claude/worktrees"
ARCHIVE_DIR="$REPO_ROOT/docs/archive/worktrees"
CONFIRM=false

for arg in "$@"; do
  if [ "$arg" = "--confirm" ]; then
    CONFIRM=true
  fi
done

if [ ! -d "$WORKTREES_DIR" ]; then
  echo "[prune-merged-worktrees] worktrees dir not found: $WORKTREES_DIR"
  exit 0
fi

echo "[prune-merged-worktrees] Scanning $WORKTREES_DIR"
if [ "$CONFIRM" = false ]; then
  echo "[prune-merged-worktrees] DRY RUN — pass --confirm to execute"
fi
echo ""

FOUND=0
SKIPPED=0

while IFS= read -r -d '' wt_dir; do
  wt_name=$(basename "$wt_dir")

  # Skip non-git directories
  if [ ! -f "$wt_dir/.git" ] && [ ! -d "$wt_dir/.git" ]; then
    echo "  SKIP (not a worktree): $wt_name"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # Get the branch for this worktree
  wt_branch=$(git -C "$wt_dir" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
  if [ -z "$wt_branch" ] || [ "$wt_branch" = "HEAD" ]; then
    echo "  SKIP (detached HEAD or unknown branch): $wt_name"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # Check if the branch is merged to main
  merged=$(git -C "$REPO_ROOT" branch --merged main 2>/dev/null | grep -qE "^\*?\s+${wt_branch}$" && echo "yes" || echo "no")

  if [ "$merged" = "yes" ]; then
    FOUND=$((FOUND + 1))
    if [ "$CONFIRM" = true ]; then
      echo "  ARCHIVE+REMOVE (merged branch: $wt_branch): $wt_name"
      # Archive session files if they exist
      sessions_src="$wt_dir/.claude/sessions"
      if [ -d "$sessions_src" ] && [ -n "$(ls -A "$sessions_src" 2>/dev/null)" ]; then
        archive_dest="$ARCHIVE_DIR/$wt_name"
        mkdir -p "$archive_dest"
        cp -r "$sessions_src/." "$archive_dest/"
        echo "    Archived sessions to: docs/archive/worktrees/$wt_name/"
      fi
      # Remove the worktree from git
      git -C "$REPO_ROOT" worktree remove --force "$wt_dir" 2>/dev/null || rm -rf "$wt_dir"
      echo "    Removed worktree directory."
    else
      echo "  WOULD ARCHIVE+REMOVE (merged branch: $wt_branch): $wt_name"
    fi
  else
    echo "  SKIP (branch not merged): $wt_name ($wt_branch)"
    SKIPPED=$((SKIPPED + 1))
  fi
done < <(find "$WORKTREES_DIR" -mindepth 1 -maxdepth 1 -type d -print0 2>/dev/null)

echo ""
if [ "$CONFIRM" = true ]; then
  echo "[prune-merged-worktrees] Done. Processed: $FOUND, Skipped: $SKIPPED"
else
  echo "[prune-merged-worktrees] Dry run complete. Would process: $FOUND, Skipped: $SKIPPED"
  echo "[prune-merged-worktrees] Run with --confirm to actually execute."
fi
