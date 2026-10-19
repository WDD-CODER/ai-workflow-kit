---
description: Bring {{git.mainBranch}} up to the upstream repo (the one this repo is a copy of) and replay our own commits (workflow kit, plans, ledger) on top; the force-push to origin stays with the Human
---

# /pull-copy — rebase this copy on its upstream

This repo is a copy of someone else's repo (`upstream`). The upstream {{git.mainBranch}} is the base; our own
commits on `{{git.mainBranch}}` (the workflow kit and its syncs, plans, `.claude/todo.md`) are replayed on top so
they survive every pull. Never push to `upstream`. Upstream-owned paths (`ownership.upstreamPaths` in
`kit.config.json`) are never edited here, so a rebase should not conflict; when it does, a Human decides.

Run these steps in the Planner folder (the main checkout, not a slot). Stop and report if any fails:

1. If not on `{{git.mainBranch}}`, run `git checkout {{git.mainBranch}}`.
2. `git remote get-url upstream` — no `upstream` remote: stop and ask the Human for the upstream URL
   (then `git remote add upstream <url>` and `git remote set-url --push upstream DISABLED`).
3. `git status --short --untracked-files=no`. Tracked files modified: list them and stop — the Human commits,
   stashes or discards them first (a rebase can't run on a dirty tree).
4. Record the old head: `git rev-parse --short HEAD`.
5. `git fetch upstream`
6. Count incoming: `git rev-list --count HEAD..upstream/{{git.mainBranch}}`. Count ours:
   `git rev-list --count --no-merges upstream/{{git.mainBranch}}..HEAD`.
7. `git rebase upstream/{{git.mainBranch}}`
   - On a conflict: run `git diff --name-only --diff-filter=U`, then `git rebase --abort`, report the conflicting
     files and which of our commits hit them, and stop. **Never resolve a conflict yourself** — ask the Human.
8. The rewritten history must be force-pushed to `origin`. The pre-push hook refuses a push of upstream code to
   `{{git.mainBranch}}`, and skipping a hook is the Human's call only. Give the Human this exact command to run
   themselves (in Claude Code with the `!` prefix), and wait:
   `! git push --force-with-lease --no-verify origin {{git.mainBranch}}`
9. After they confirm, report: the new head (`git log --oneline -1`), the incoming upstream commits, and how many of
   our commits now sit on top (`git log --oneline --no-merges upstream/{{git.mainBranch}}..HEAD`).

Never `git push --force` without `--force-with-lease`, never push to `upstream`, never use `--no-verify` yourself.
