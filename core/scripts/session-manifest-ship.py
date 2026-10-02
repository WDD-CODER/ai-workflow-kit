#!/usr/bin/env python3
"""
Ship-time manifest helper.
Usage: python3 scripts/session-manifest-ship.py [branch-name]

Outputs JSON:
{
  "no_manifest": true/false,
  "files": ["rel/path/to/file", ...],
  "overlaps": [
    {"branch": "other-branch", "files": ["shared/file.ts"]}
  ]
}

overlaps only contains entries from manifests modified < 24 hours ago
(stale manifests from abandoned sessions are ignored).
"""
import sys
import os
import json
import time
import subprocess


STALE_HOURS = 24


def get_branch():
    try:
        return subprocess.check_output(
            ['git', 'branch', '--show-current'],
            text=True, stderr=subprocess.DEVNULL
        ).strip()
    except Exception:
        return ''


def get_repo_root():
    try:
        return subprocess.check_output(
            ['git', 'rev-parse', '--show-toplevel'],
            text=True, stderr=subprocess.DEVNULL
        ).strip()
    except Exception:
        return os.getcwd()


def read_manifest(path):
    with open(path, encoding='utf-8') as f:
        return {line.strip() for line in f if line.strip()}


def main():
    branch = sys.argv[1] if len(sys.argv) > 1 else get_branch()
    if not branch:
        print(json.dumps({'no_manifest': True, 'files': [], 'overlaps': []}))
        return

    repo_root = get_repo_root()
    sessions_dir = os.path.join(repo_root, '.claude', 'sessions')
    my_manifest_path = os.path.join(sessions_dir, branch, 'manifest.txt')

    if not os.path.exists(my_manifest_path):
        print(json.dumps({'no_manifest': True, 'files': [], 'overlaps': []}))
        return

    my_files = read_manifest(my_manifest_path)
    now = time.time()
    overlaps = []

    # Walk all other session manifests
    if os.path.isdir(sessions_dir):
        for dirpath, _, filenames in os.walk(sessions_dir):
            for fname in filenames:
                if fname != 'manifest.txt':
                    continue
                other_path = os.path.join(dirpath, fname)
                if os.path.abspath(other_path) == os.path.abspath(my_manifest_path):
                    continue  # skip own manifest

                # Skip stale manifests
                age_hours = (now - os.path.getmtime(other_path)) / 3600
                if age_hours > STALE_HOURS:
                    continue

                # Derive other branch name from path
                other_branch = os.path.relpath(
                    os.path.dirname(other_path), sessions_dir
                ).replace('\\', '/')

                other_files = read_manifest(other_path)
                shared = my_files & other_files
                if shared:
                    overlaps.append({
                        'branch': other_branch,
                        'files': sorted(shared)
                    })

    print(json.dumps({
        'no_manifest': False,
        'files': sorted(my_files),
        'overlaps': overlaps
    }))


if __name__ == '__main__':
    main()
