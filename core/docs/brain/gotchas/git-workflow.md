# git-workflow gotchas

## Removing a git worktree from inside itself

**What hurt:** `git worktree remove <path>` fails (or leaves a dangling lock) when the shell's cwd is still inside that worktree — the process holds an open handle on the directory.

**Why the obvious fix is wrong:** Retrying with `--force` clears the worktree registration but can leave orphaned `.git/worktrees/<name>` metadata behind; it doesn't address the actual cause (cwd still inside the target).

**What to do instead:** `cd` back to the main repo root before running `git worktree remove`; follow up with `git worktree prune` if metadata lingers. See `.claude/skills/worktree-setup/SKILL.md` and `scripts/prune-merged-worktrees.sh`.

---

---

## `gh pr create` failing on PAT scope

**What hurt:** `gh pr create` fails (often with an unhelpful permissions error) when the token behind `gh auth` lacks the scope a PR touching `.github/workflows/*` needs — common with fine-grained PATs issued without `workflow` scope.

**Why the obvious fix is wrong:** Re-running the command or re-authenticating with the same token doesn't help — the scope is fixed at token-issue time, not session time.

**What to do instead:** When a workflow-touching PR fails to create, check `gh auth status` scopes first; regenerate the PAT with `workflow` scope rather than retry-looping the same command.

---

---

## Tracked session-state pointer dirties every ship/merge

**What hurt:** `.claude/.session-state-path` was tracked in git but rewritten on every SessionStart (`session-startup.sh`) to a PPID-keyed path. `/ship` also wrote session-state *after* commit/push. Result: perpetual dirty trees and `gh pr merge --delete-branch` failing on local checkout.

**Why the obvious fix is wrong:** Committing the updated pointer “to clean the tree” just schedules the next SessionStart to dirty it again. Leaving Phase 5 until after push guarantees an uncommitted handoff file.

**What to do instead:** Keep `.claude/.session-state-path` gitignored (local pointer only). Save to stable `docs/session-state-${BRANCH}.md` (no PPID). On `/ship`, write that file after commit, amend before push. See Plan 295 / `.claude/commands/ship.md` Phase 5.

---

---

## Splitting one file's uncommitted diff across two branches: no `git stash -p` available

**What hurt:** `server/db.js` had two unrelated uncommitted hunks (a plan 301 search-index addition and unrelated mongo connection-visibility listeners) that needed to land on two different branches. The normal tool for this, `git stash push -p` / `git add -p`, is interactive, and this environment's Bash tool explicitly does not support interactive flags.

**Why the obvious fix is wrong:** Trying to script `git add -p` with piped `y`/`n` answers is fragile and easy to get wrong silently (wrong hunk staged, file left in a half-applied state).

**What to do instead:** Read the file, `git diff` it to see the exact hunks, then use Edit to manually remove the unwanted hunk on branch A (reverting it to match what branch B should not have), commit, then switch to branch B and manually re-add just that hunk via Edit using the diff text already captured. Slower but deterministic and auditable — confirm with a final `git diff` before each commit.

---

## A concurrent session's `git add -A` can steal your uncommitted change

**What hurt:** Mid-`/ship`, a second session working in the same directory switched the
branch from `feat/perf-phase1-m3-m5` to `feat/design-migration` and committed. Its commit
`012d3c9` swept up `src/app/app.config.ts` - an uncommitted edit belonging to the *other*
session's work - into an unrelated design-migration commit. Switching back to the perf
branch then restored the pre-edit version, so the change had silently vanished from the
working tree while living on in a foreign commit.

**Why the obvious fix is wrong:** `git worktree list` returns 1, so the usual concurrency
check sees nothing. Two agents sharing one working tree are invisible to it. Trusting a
`git status` snapshot taken earlier in the conversation is also wrong - the tree can
change between reading it and staging.

**What to do instead:** Compare branch *and* HEAD against the values captured when the
workflow started, and hard-stop on any change (`/ship` Phase 3 does this - honor it).
Before staging, re-run `git status --short` fresh rather than reusing an earlier snapshot.
After any forced branch switch, diff your expected changes against the tree and re-apply
anything a concurrent commit absorbed. And never `git add -A` in a shared working
directory - stage explicit paths only.

---

---

## Recovering a shared working directory after a live `.git/index.lock`

**What hurt:** Mid-`/ship`, staging hit `fatal: Unable to create '.git/index.lock': File
exists` — a second tool (Cursor, same directory, no separate worktree, so
`git worktree list` showed 1) was actively touching git. The working tree also had ~15
files dirty that this session never edited, spanning at least three unrelated bodies of
work (two earlier sessions' still-uncommitted plans plus the live Cursor session).
Related to the `git add -A` entry above, but this is the recovery procedure once you're
already mid-collision rather than the prevention step.

**Why the obvious fix is wrong:** Deleting the lock on sight risks corrupting whatever
the other process is mid-write on. Bundling the whole dirty tree into one commit (or
worse, one PR) silently ships someone else's unreviewed, possibly-incomplete work under
your name — and a botched `git add -p` retry after a lock error can leave the index in
a half-staged state.

**What to do instead:** Check `tasklist` (Windows) / `ps` for an actual running `git`
process before touching the lock — none running means it's stale, safe to clear with
plain `rm` (not `rm -f`, which this environment's global deny blocks anyway). Then
classify the unfamiliar dirty files by diff shape before staging anything: pure
deletions with zero insertions cross-reference cleanly against `.claude/todo.md`/
`plans/*.md` claims of "done" work; any insertions mixed in usually mean a different,
undocumented body of work touched the same file and needs its own bucket. Commit your
own bucket **first**, directly on the pre-existing HEAD, so its branch pointer stays a
clean, PR-able diff against main. Stack any recovered/other-session buckets after it via
`git branch <name> <sha>` — never checkout a different branch in the shared directory to
do this, since checkout would overwrite files a live concurrent editor may still have
open; if you need a branch actually checked out (e.g. to append a file after PR checks
already passed), use `git worktree add <scratch-path> <branch>` instead, work there, then
`git worktree remove` it. Never invent a PR for a bucket you didn't author or fully
verify — push it as a checkpoint and say so explicitly.

---

---

## A stale dev server on a different port can present as a design-port regression

**Status:** draft — generalized from a project lesson; review before relying on it.

A stale dev server left running on another port can masquerade as a regression; check which process owns the port before debugging the code.

---

## `todo.md`'s "not merged, no PR opened yet" can be stale — verify with `merge-base`, don't just open the PR

**What hurt:** Plan 308's todo.md entry said the dead-CSS-purge branch (`chore/dead-css-purge-plan-308`) was "committed and pushed... not merged, no PR opened yet." Trusting that note, `gh pr create` was run straight away — it failed with "No commits between main and chore/dead-css-purge-plan-308." The branch's tip commit was already an ancestor of `main` (confirmed via `git merge-base --is-ancestor <sha> origin/main`), evidently swept in through an unrelated merge (likely `feat/optimization`/PR #192) without that branch's own PR ever getting tracked back into `todo.md`.

**Why the obvious fix is wrong:** Assuming the todo.md/plan-file note is ground truth and opening the PR anyway wastes a round-trip and produces a confusing GitHub API error that looks like an auth or scope problem rather than a stale-tracking problem.

**What to do instead:** Before opening a PR for a branch that a todo/plan file claims is "unmerged," run `git merge-base --is-ancestor <branch-tip> origin/main` first. If it prints true, the branch is already merged — no PR to open, fix the stale tracking note instead (and consider deleting the now-redundant branch/worktree).

---

---

## A shared-directory branch switch silently carries YOUR uncommitted edits onto someone else's branch — then your next commit lands there

**What hurt:** Mid-session, uncommitted edits (`server/index.js`, `.claude/todo.md`, a plan file) sat in the working tree of the **main, non-worktree** directory on `chore/todo-archive-plan-308`. A second, concurrent Cursor session sharing that exact directory ran `git checkout chore/ship-fast-single-approval` for its own unrelated task. `git checkout` carries forward any uncommitted local modification that doesn't conflict with the target branch's version of that file — since those three files happened to be identical between the two branches at that point, the checkout succeeded silently, with no prompt, and repositioned HEAD out from under the first session without touching the dirty files at all. The next `git commit` (run by the original session, unaware HEAD had moved) created a real commit on the **wrong branch**, stacked on top of the other session's own commit. Confirmed via `git show --name-status <foreign-commit>` that it contained none of the swept-along files — this was not a `git add -A` collision (see the entry above); it was a checkout silently relocating dirty files across a branch switch neither session asked for.

**Why the obvious fix is wrong:** Assuming "my uncommitted files must be safe because `git checkout` refuses when there'd be a conflict" is wrong — checkout only refuses when the file *differs* between the old and new branch tips. When the file happens to be identical (common for files neither branch is actively touching), checkout succeeds and quietly reassigns your dirty edits to a different branch context with zero warning. `git worktree list` doesn't reveal this either — both sessions show as **one** entry, because neither had created a separate worktree; they were two independent processes pointed at the same physical directory.

**What to do instead:**
1. **Structural fix — default to a dedicated worktree per session** rather than the shared main checkout, any time another agent/tool might be active in this repo (`worktree-setup` skill / `EnterWorktree`; this repo already keeps live worktrees for `feat/optimization` and `chore/dead-css-purge-plan-308` — the pattern exists, it just wasn't applied to this session before the incident). A worktree has its own independent HEAD; no other process sharing the repo can move it out from under you.
2. **Cheap guard when a worktree isn't practical:** immediately before any `git commit` in a shared (single-worktree) directory, run `git branch --show-current` and compare against the branch confirmed right after your previous commit this session. Mismatch → STOP before committing; do not assume your edits are still on the branch you think they're on.
3. **Recovery, if it already happened:** `git show --name-status <foreign-commit>` to confirm it does *not* contain your files (it usually won't, per the mechanism above), then cherry-pick your stray commit onto the correct branch via a scratch `git worktree add` + `git cherry-pick`, and reset the foreign branch back to its pre-your-commit sha (`git reset --hard <foreign-sha>` — only safe when that branch's tree is otherwise clean). Never `checkout` a different branch directly in the shared directory to do this cleanup — that repeats the exact risk for whichever session is still using it; do the reset only on the branch/directory you're already on.
