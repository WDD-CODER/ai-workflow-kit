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
  ],
  "pruned": ["other-branch", ...]
}

A manifest is skipped (and, if its owning branch no longer exists or is
already merged into HEAD, pruned from disk) before the overlap diff runs.
Only a manifest whose branch still exists, isn't merged, and was touched in
the last 24h can produce a real overlap — this is what distinguishes a live
colliding session from a stale leftover (merged-and-deleted branch, or a
branch that never got created in the first place).
"""
import sys
import os
import json
import time
import shutil
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


def prune_stale_remote_refs():
    """Drop local origin/<branch> tracking refs for branches GitHub already
    deleted (squash-merge-and-delete leaves no ancestor commit to detect via
    merge-base, so a stale local tracking ref is the only thing left lying
    to resolve_branch_sha). Best-effort — never fails the script."""
    try:
        subprocess.run(
            ['git', 'fetch', 'origin', '--prune', '--quiet'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15
        )
    except Exception:
        pass


def resolve_branch_sha(branch):
    """Local ref first, then origin/<branch>. None if neither exists."""
    for ref in (branch, f'origin/{branch}'):
        try:
            return subprocess.check_output(
                ['git', 'rev-parse', '--verify', ref],
                text=True, stderr=subprocess.DEVNULL
            ).strip()
        except Exception:
            continue
    return None


def is_merged_into_head(sha):
    try:
        subprocess.check_call(
            ['git', 'merge-base', '--is-ancestor', sha, 'HEAD'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        return True
    except Exception:
        return False


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

    prune_stale_remote_refs()

    my_files = read_manifest(my_manifest_path)
    now = time.time()
    overlaps = []
    pruned = []

    # Walk all other session manifests
    if os.path.isdir(sessions_dir):
        for dirpath, _, filenames in os.walk(sessions_dir):
            for fname in filenames:
                if fname != 'manifest.txt':
                    continue
                other_path = os.path.join(dirpath, fname)
                if os.path.abspath(other_path) == os.path.abspath(my_manifest_path):
                    continue  # skip own manifest

                # Derive other branch name from path
                other_branch = os.path.relpath(
                    os.path.dirname(other_path), sessions_dir
                ).replace('\\', '/')

                # Dead or already-landed branch: can't collide with it, no
                # matter how fresh the manifest file's mtime is. Prune it so
                # the next run doesn't even have to ask.
                sha = resolve_branch_sha(other_branch)
                if sha is None or is_merged_into_head(sha):
                    pruned.append(other_branch)
                    shutil.rmtree(os.path.dirname(other_path), ignore_errors=True)
                    continue

                # Branch is real and unmerged — only a recent manifest counts
                # as a live collision (older ones are presumed abandoned, but
                # left on disk since they might still be resumed).
                age_hours = (now - os.path.getmtime(other_path)) / 3600
                if age_hours > STALE_HOURS:
                    continue

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
        'overlaps': overlaps,
        'pruned': pruned
    }))


if __name__ == '__main__':
    main()
