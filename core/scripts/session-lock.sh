#!/usr/bin/env bash
# session-lock.sh — liveness lock helpers, used by the Planner-Worker slot model.
# Sourced by session-manifest-hook.py's shell fallback caller, handoff-check.sh
# (release_lock), and take-plan.mjs (claim_lock, via Git Bash). Not meant to be
# run directly.

STALE_MINUTES="${STALE_MINUTES:-45}"

_lock_path() {
  echo "$1/.claude/.session-lock"
}

lock_is_fresh() {
  local dir="$1"
  local lock
  lock="$(_lock_path "$dir")"
  [ -f "$lock" ] || return 1

  local heartbeat_epoch now_epoch age_minutes
  heartbeat_epoch=$(python3 -c "
import json,sys
try:
    d=json.load(open(r'$lock'))
    print(int(d.get('heartbeat_epoch',0)))
except Exception:
    print(0)
" 2>/dev/null)
  heartbeat_epoch="${heartbeat_epoch:-0}"
  now_epoch=$(date +%s)
  age_minutes=$(( (now_epoch - heartbeat_epoch) / 60 ))

  [ "$age_minutes" -lt "$STALE_MINUTES" ]
}

claim_lock() {
  local dir="$1"
  mkdir -p "$dir/.claude"
  local lock now_iso now_epoch
  lock="$(_lock_path "$dir")"
  now_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  now_epoch=$(date +%s)
  printf '{"claimed_at":"%s","heartbeat":"%s","heartbeat_epoch":%s}\n' \
    "$now_iso" "$now_iso" "$now_epoch" > "$lock"
}

touch_heartbeat() {
  local dir="$1"
  [ -f "$(_lock_path "$dir")" ] || { claim_lock "$dir"; return; }
  claim_lock "$dir"
}

release_lock() {
  local dir="$1"
  local lock
  lock="$(_lock_path "$dir")"
  rm -f "$lock"
}
