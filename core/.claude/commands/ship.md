---
description: Session end — build, review, commit approval, conditional state/todo (inline, no subagent)
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---

# /ship — Session end (inline pipeline)

Closes the current session. Repo root = **workspace cwd**. No subagent spawns — all phases run inline.

**Aliases:** `/ship`, `/end-session`, "wrap up", "ship", "ship it".

Invoking `/ship` authorizes commit of this chat's files after explicit **Y** (unless `--yes`/`--skip-review`). Message-only prep without commit → `git-agent`. On-demand, not covered here: techdebt scan (`/techdebt`), docs refresh (`/docs-refresh`), workflow tuning (`/tune-workflow`).

## Flags

| Flag | Behavior |
|------|----------|
| `/ship` | Auto-detect lane, run its pipeline; wait for **Y** unless ULTRA-TRIVIAL |
| `/ship fast` | Collapses Phase 4 + 4.5 into one reply: `Y` = commit + push + PR; merging still needs the word `merge` |
| `/ship regular` | Force REGULAR lane |
| `/ship --yes` | Confirmation block, commit without waiting (review still runs) |
| `/ship --skip-review "reason"` | Bypass Phase 2; reason required; logs `[review-skipped: {reason}]` |

`fast` (or an auto-FAST/ULTRA-TRIVIAL diff): one reply answers commit + push + PR at once. `Y` stops there — PR open, not merged. Only a reply that contains the literal word `merge` (`merge`, `Y merge`) also merges; `later` / `open-pr-only` / `abort` as usual. Doesn't change lane classification or review depth. Works on any lane. `--yes` and "ship fast y" never imply merge. Chat "ship fast" ≡ `/ship fast`.

---

## Phase 0 — Lane classification

Run `node scripts/ship-prep.mjs` (`--mode regular` for `/ship regular`) and act on the printed lane — the script is the source of truth for thresholds. Announce it, e.g. `Lane: FAST (2 files, 14 lines, no sensitive paths)`.

---

## Phase 1 — Build gate (UNCONDITIONAL hard stop)

```bash
npm run {{commands.build}}
node scripts/plan-ledger-check.mjs
```

- **Fail** (either command) → stop. Do not commit. Fix, then re-run `/ship`.
- Never conditional. Ledger exit 1 (missing plan refs) blocks like a failed build; duplicate-NNN / stray-name warnings are advisory only.

---

## Phase 2 — Review (unless `--skip-review`, or Lane = FAST/ULTRA-TRIVIAL)

**REGULAR:** Read `docs/agent/ship-regular.md` → "Phase 2 — REGULAR review procedure" and follow it.

**FAST/ULTRA-TRIVIAL:** skip full `/review` (Phase 0 already confirmed small + no sensitive path). Instead: `npx eslint --fix`, one read of the diff for obvious correctness issues, record `Review: SKIPPED (fast-lane: {n} files/{m} lines, no sensitive paths)` + `[review-skipped: fast-lane]` in the commit body.

`--skip-review "reason"` (any lane): skip Phase 2, reason required, `Review: SKIPPED ({reason})` + `[review-skipped: {reason}]` in the commit body.

---

## Phase 3 — Manifest check

`git worktree list` misses same-directory concurrent sessions — check `docs/brain/gotchas/` for the known trap. Run `node scripts/ship-prep.mjs --check-baseline`, act on the printed status:

- `BRANCH_CHANGED` → **STOP**; show the Human both branch names, wait.
- `HEAD_MOVED` → re-run `git status --short` fresh, re-`Read` files before `git add`, note it in the summary.
- `scope: out` ({{slots.nameFormat}}, outside Read-Write Scope) → **STOP**; list files; `approved: <path>` or revert.
- `OK` (`scope: ok` in a slot) → proceed with this-chat-file staging.
- Non-empty `overlaps` → STOP; `no_manifest` → never `git add -A`, prefer this-chat files.
- Stage only this-chat dirty paths. Never `-A` unless Human overrode scope. Never stage secrets/`.env`.

Before Phase 4: `git fetch origin && git rebase origin/{{git.mainBranch}}`.
- Conflict where both sides only *added to* a hotspot (`{{paths.hotspots}}`) → keep both sides (union), `git rebase --continue`.
- Any other conflict → **STOP**; show the Human; do not resolve unilaterally.

---

## Phase 4 — Commit + push (UNCONDITIONAL approval gate)

- REGULAR, `fast` not passed: one Y here for commit, separate gate at Phase 4.5 for merge.
- FAST/ULTRA-TRIVIAL, or `fast` passed on any lane: the single reply here also answers Phase 4.5 — merge only if it contains the word `merge`.
- ULTRA-TRIVIAL: skip the interactive gate — commit + push auto (checkpoint only, never a PR). Print the tree as a receipt, tagged `[auto-approved: ultra-trivial]`. HOW TO VALIDATE becomes the one-line "no user-visible effect" form.

Present this tree, then **wait for explicit "Y"** (unless `--yes` or ULTRA-TRIVIAL):

~~~text
Branch: [branch-name]
Rename: [old → new]   # only if on feat/session-* placeholder

Proposed commit:
  type(scope): subject

  body (why, not what)
  [review-skipped: reason]   # only when --skip-review was used

Files to stage:
  ├── file1
  └── file2
  ├── .claude/todo.md          # when matching items will be marked [x] on Y
  └── plans/….plan.md          # when matching Atomic Sub-tasks will be marked [x] on Y

Also proposing a brain entry:   # only when durable; may be 2 lines (pattern + paired gotcha)
  docs/brain/{gotchas/<domain>.md | patterns/*.md | decisions/NNNN-*.md} — "one-line title"

HOW TO VALIDATE
  ① {plain title}
     WHERE   {window / page}
     DO      {action}  — or —  paste:  {exact text}
     SEE ✓   {success}
     FAIL ✗  {failure}
  ② …

Approve? (Y / merge / edit list / abort)   # Y = commit + push (+ PR); only "merge" merges
~~~

Every Done-when item `[auto]` → replace HOW TO VALIDATE with:

~~~text
VERIFIED BY AGENT
  - ✓ [auto] {item} — `{command}` → {output / exit code}
~~~

HOW TO VALIDATE is mandatory before Approve? — one card per check (WHERE / DO / SEE ✓ / FAIL ✗, plain words, exact paste text when a terminal is needed) per `docs/agent/job-validation.md` → Card rules; happy path + any edge/failure rule introduced; one line if no user-visible effect. Mandatory for `[human]`/untagged; all-`[auto]` shows VERIFIED BY AGENT instead. Never omit both.

Matching open todos: list *before* Y (still `[ ]`). On **Y**, mark `[x]` and stage in the **same** commit — never a second push for checkboxes. Chat-only jobs (no ship): `docs/agent/job-validation.md` Path B / `/done`.

A proposed brain entry: print its **full draft body** fenced below the tree (tree line carries only path + title).

### Brain-entry capture (no new gate)

**FAST/ULTRA-TRIVIAL:** skip the mining procedure by default (a tiny diff rarely yields a durable entry). Exception: diff touches `docs/brain/**`, or Human says "check brain"/"brain capture". Omit the block rather than running the full procedure to conclude nothing's there.

**REGULAR:** Read `docs/agent/ship-regular.md` → "Brain-entry capture — REGULAR procedure" and follow it — including "How a proposed brain entry gets approved" whenever a brain entry is proposed on any lane.

### Semantic branch rename

On `feat/session-*`: `git log main..HEAD --oneline` + `git diff --stat main..HEAD` → derive slug (`feat|fix|refactor|chore` + 2–4 kebab words) → show `Rename: {old} → {new}` in the tree → rename on approval: `git branch -m`.

### On approval (order is hard — do not reorder)

Approve **Y** (or `--yes`) = commit/push consent, and Human validation of any `[human]` items. Then:

1. **Todo sync (when items match):** mechanics ({{slots.nameFormat}} slot vs outside, exact commands, never-invent rule) → `docs/agent/job-validation.md` Path A step 2.
2. **Write brain drafts** (if proposed, not dropped) — verbatim to `docs/brain/**`.
3. **`git add` only listed paths** (todo/plan/brain included) — one commit with job + todos (+ brain), never job-then-todos-later.
4. **`git commit`** (Conventional Commit; Cursor trailer `Co-authored-by: Cursor <cursoragent@cursor.com>` when applicable).
5. **Session-state fold (before push)** — see Phase 5: write `docs/session-state-${BRANCH}.md`, `git add`, **`git commit --amend --no-edit`** (ours, not yet pushed). Never leave it dirty after ship.
6. Rename branch if approved.
7. Push only if asked ("push"/"ship and push"): `git push -u origin HEAD`. FAST/ULTRA-TRIVIAL: push is implied by the single Y.
8. **Commit-vs-PR judgment** (before any `gh pr create`) — see below. Never open a PR silently.

Recovery, and push-rejected/merge-fails → `docs/agent/ship-recovery.md`. Never commit to `main`. Never force-push. Never amend after push.

### Commit-vs-PR judgment

REGULAR, or the PR path is reached → Read `docs/agent/ship-regular.md` → "Commit-vs-PR judgment" and "After opening a PR" and follow them.

**Hard rule (every lane):** Never open a PR without (a) the brief's Done-when fully met, or (b) explicit user instruction.

Then **Phase 4.5 — Merge Gate** (mandatory).

---

## Phase 4.5 — Merge Gate (mandatory after successful push)

`fast` passed, or Lane naturally FAST/ULTRA-TRIVIAL: already decided at Phase 4 — merge only if that reply contained the word `merge`; a plain `Y` / `--yes` leaves the PR open (`Merge: deferred`).

Otherwise (REGULAR, `fast` not passed): Read `docs/agent/ship-regular.md` → "Phase 4.5 — Merge Gate (REGULAR procedure)" and follow it.

Never merge without the Human's literal word `merge` in the reply to this ship's gate. `Y`, `--yes`, "ship fast y" and approvals given before the gate never count.

---

## Phase 5 — Session-state (On approval step 5, fold into ship commit before push)

1. Save target: `.claude/.session-state-path` (gitignored pointer); fallback `docs/session-state-${BRANCH}.md` then `docs/session-state.md`.
2. `node scripts/write-session-state.mjs --summary "<2–4 bullets>" --next "<…>" [--pr <url>]` — resolves the branch-canonical path, appends (≤1 file changed vs `origin/{{git.mainBranch}}...HEAD`) or full-rewrites (>1).
3. `git add` that file only, then `git commit --amend --no-edit` (not yet pushed — never amend once pushed).
4. Continue On approval (rename → push → PR judgment).

Don't change `scripts/session-startup.sh`'s resume path. `.claude/.session-state-path` stays untracked.

---

## Phase 6 — Todo sync

Done in Phase 4 step 1 (before commit). No second pass after push except via Phase 4's recovery path.

---

## Output summary (always)

State which commit-vs-PR path was taken and why.

```
SESSION WRAP — {final_branch_name}
Lane: FAST | ULTRA-TRIVIAL | REGULAR ({reason})
Build: PASS | FAIL
Review: PASS | FIXED+PASS | SKIPPED (reason)
Commit: {sha or none}
Push: yes | no
PR path: PR proposed (Done-when met | user override/confirmed) | Checkpoint (brief incomplete | no brief, confirmed | user override)
PR: {url or N/A}
Merge: offered | merged {sha} | deferred | N/A (checkpoint)
Brain review: {summary} | N/A (checkpoint, not run)
Todo: {n marked} | no matching open items — skipped
Session state: {path} (append | full rewrite)
```

Milestone/checkpoint with an incomplete brief → also include: `Milestone commit — brief not yet complete, no PR proposed`
