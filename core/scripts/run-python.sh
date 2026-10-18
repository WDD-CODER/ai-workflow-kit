#!/usr/bin/env bash
# run-python.sh — run a Python script with the first interpreter that works (python3, python, py).
# On Windows `python3` is often the Microsoft Store stub, which exists but fails. No Python at all:
# exit 0 quietly, so a hook that only records extra context never blocks the session.
#
#   bash scripts/run-python.sh scripts/session-manifest-hook.py [args…]
# stdin is passed through (Claude Code hooks read their JSON input from it).

for py in python3 python py; do
  if command -v "$py" >/dev/null 2>&1 && "$py" -c "import sys" >/dev/null 2>&1; then
    exec "$py" "$@"
  fi
done
exit 0
