# /ship — Recovery procedures

Loaded from `.claude/commands/ship.md` when a push is rejected, a merge fails, or a prior ship already committed/pushed a job without todos. This file is a direct extraction of ship.md's recovery-path text, moved verbatim.

---

## Recovery only (missing todos after a prior ship)

If a prior ship already committed/pushed the job without todos (agent bug or mid-flight rule change), immediately mark matching `[x]` and push a tiny follow-up commit on the same branch — do not leave checkboxes open.

---

## Push conflict guard

If push is rejected (non-fast-forward):
```bash
git fetch origin
git log --oneline HEAD..origin/{branch}
git diff --stat HEAD...origin/{branch}
```
Present choices: (a) rebase (b) merge (c) abort — wait for user choice. On conflicts during rebase/merge: list files, stop, instruct resolve then re-run `/ship`.

If renamed after remote had the old name:
```bash
git push origin --delete {old_name}
git push -u origin {new_name}
```

---

## PR merge fallback

If `gh pr merge --merge --delete-branch` (or, in a slot, `gh pr merge --merge`) fails due to dirty local tree, fall back to:
```bash
gh pr merge {pr_number} --merge --auto
```
Do not stash/commit unrelated dirty files to unblock merge.
