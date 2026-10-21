#!/usr/bin/env python3
"""
PostToolUse hook — records edited file paths to the session manifest.
Reads tool event JSON from stdin. Appends the file_path (relative to repo root)
to .claude/sessions/<branch>/manifest.txt, skipping duplicates.
"""
import sys
import os
import json
import subprocess
import time
from datetime import datetime, timezone


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    # Tool input may be nested under 'tool_input' or at the top level
    tool_input = data.get('tool_input', data)
    file_path = tool_input.get('file_path', '')

    if not file_path:
        sys.exit(0)

    # Resolve repo root
    try:
        repo_root = subprocess.check_output(
            ['git', 'rev-parse', '--show-toplevel'],
            text=True, stderr=subprocess.DEVNULL
        ).strip()
    except Exception:
        sys.exit(0)

    # Make path relative to repo root, using forward slashes
    abs_path = os.path.normpath(file_path)
    root_norm = os.path.normpath(repo_root)
    try:
        rel_path = os.path.relpath(abs_path, root_norm).replace('\\', '/')
    except ValueError:
        # Different drive letters on Windows — store absolute
        rel_path = abs_path.replace('\\', '/')

    # Skip paths that escape the repo
    if rel_path.startswith('..'):
        sys.exit(0)

    # Get current branch
    try:
        branch = subprocess.check_output(
            ['git', 'branch', '--show-current'],
            text=True, stderr=subprocess.DEVNULL
        ).strip()
    except Exception:
        sys.exit(0)

    if not branch:
        sys.exit(0)

    # Write to manifest (deduplicated)
    manifest_dir = os.path.join(root_norm, '.claude', 'sessions', branch)
    os.makedirs(manifest_dir, exist_ok=True)
    manifest_path = os.path.join(manifest_dir, 'manifest.txt')

    existing = set()
    if os.path.exists(manifest_path):
        with open(manifest_path, encoding='utf-8') as f:
            existing = {line.strip() for line in f if line.strip()}

    if rel_path not in existing:
        with open(manifest_path, 'a', encoding='utf-8') as f:
            f.write(rel_path + '\n')

    # Refresh this slot's liveness heartbeat (two-slot parallel session system) —
    # only if it's already been claimed as a slot (lock file exists).
    lock_path = os.path.join(root_norm, '.claude', '.session-lock')
    if os.path.exists(lock_path):
        now = datetime.now(timezone.utc)
        try:
            with open(lock_path, encoding='utf-8') as f:
                claimed_at = json.load(f).get('claimed_at', now.strftime('%Y-%m-%dT%H:%M:%SZ'))
        except Exception:
            claimed_at = now.strftime('%Y-%m-%dT%H:%M:%SZ')
        with open(lock_path, 'w', encoding='utf-8') as f:
            json.dump({
                'claimed_at': claimed_at,
                'heartbeat': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
                'heartbeat_epoch': int(time.time()),
            }, f)


if __name__ == '__main__':
    main()
