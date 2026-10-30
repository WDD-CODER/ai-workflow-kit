---
description: Session end — build, review, commit approval, conditional state/todo (inline; kit-runner runs the build gate)
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, Agent
---

# /ship — Session end (inline pipeline)

Closes the current session. Repo root = **workspace cwd**. One sub-agent only: `kit-runner` runs the Phase 1 build gate (`docs/agent/model-routing.md`). Review, staging, approvals and every decision run inline.

**Aliases:** `/ship`, `/end-session`, "wrap up", "ship", "ship it".

Invoking `/ship` authorizes commit of this chat's files after explicit **Y** (unless `--yes`/`--skip-review`). Message-only prep without commit → `git-agent`. On-demand, not covered here: techdebt scan (`/techdebt`), docs refresh (`/docs-refresh`), workflow tuning (`/tune-workflow`).

## Flags

| Flag | Behavior |
|------|----------|
| `/ship` | Auto-detect lane, run its pipeline; wait for **Y** unless ULTRA-TRIVIAL |
| `/ship fast` | Collapses Phase 4 + 4.5 into one reply: `Y` = commit + push + PR; merging still needs the word `merge` |
| `/ship … merge` | The word `merge` anywhere in the `/ship` request (e.g. `/ship fast y merge`) pre-approves commit + push + PR + merge — no second ask |
| `/ship regular` | Force REGULAR lane |
| `/ship --yes` | Confirmation block, commit without waiting (review still runs) |
| `/ship --skip-review "reason"` | Bypass Phase 2; reason required; logs `[review-skipped: {reason}]` |

`fast` (or an auto-FAST/ULTRA-TRIVIAL diff): one reply answers commit + push + PR at once. `Y` stops there — PR open, not merged. Only the literal word `merge` also merges — either in the `/ship` request itself (`/ship fast merge`, "ship fast y merge") or in the gate reply (`merge`, `Y merge`); `later` / `open-pr-only` / `abort` as usual. Doesn't change lane classification or review depth. Works on any lane. `--yes` and "ship fast y" without the word `merge` never imply merge. Chat "ship fast" ≡ `/ship fast`.

---

## Phase 0 — Lane classification

Run `node scripts/ship-prep.mjs` (`--mode regular` for `/ship regular`) and act on the printed lane — the script is the source of truth for thresholds. Announce it, e.g. `Lane: FAST (2 files, 14 lines, no sensitive paths)`.

---

## Phase 1 — Build gate (UNCONDITIONAL hard stop)

Hand the three commands to the `kit-runner` agent (`.claude/agents/kit-runner.md`), the ledger check marked `[capture]` (its
advisory warnings exit 0), and act on its `RUN` / `OUTPUT` / `FAILED` blocks. In Cursor (no sub-agents) run them inline.

```bash
npm run build
node scripts/plan-ledger-check.mjs   # [capture]
node scripts/override-check.mjs
```

- **Fail** (any command, a `FAILED` block) → stop. Do not commit. Fix from the error lines it copied, then re-run `/ship`. An `OVERRIDE_CHECK: FAIL` line names the step an overridden workflow lost: add it back from the kit's template.
- `ESCALATE`, or no `RUN` line for a command, or no `OUTPUT` block for the ledger check → run the three commands inline yourself; a build result you did not see is not a pass.
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
- `scope: out` (wt-N, outside Read-Write Scope) → **STOP**; list files; `approved: <path>` or revert.
- `OK` (`scope: ok` in a slot) → proceed with this-chat-file staging.
- Non-empty `overlaps` → STOP; `no_manifest` → never `git add -A`, prefer this-chat files.
- Stage only this-chat dirty paths. Never `-A` unless Human overrode scope. Never stage secrets/`.env`.

Before Phase 4: `git fetch origin && git rebase origin/main`.
- Conflict where both sides only *added to* a hotspot (`(not set)`, `CHANGELOG.md, README.md`) → keep both sides (union), `git rebase --continue`.
- Any other conflict → **STOP**; show the Human; do not resolve unilaterally.

---

## Phase 4 — Commit + push (UNCONDITIONAL approval gate)

- REGULAR, `fast` not passed: one Y here for commit, separate gate at Phase 4.5 for merge.
- FAST/ULTRA-TRIVIAL, or `fast` passed on any lane: the single reply here also answers Phase 4.5 — merge only if it contains the word `merge`.
- **`merge` in the `/ship` request** (e.g. `/ship fast merge`, `/ship fast y merge`): `merge` implies `Y` — the request already is the reply. Print the tree as a receipt tagged `[pre-approved: merge]`, then commit, push, PR and merge without stopping. Phase 1 build/ledger failures and Phase 3 STOPs still stop.
- ULTRA-TRIVIAL: skip the interactive gate — commit + push auto (checkpoint only, never a PR). Print the tree as a receipt, tagged `[auto-approved: ultra-trivial]`. HOW TO VALIDATE becomes the one-line "no user-visible effect" form.

Present this tree, then **wait for explicit "Y"** (unless `--yes`, `merge` already in the `/ship` request, or ULTRA-TRIVIAL):

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

VALIDATED BY HUMAN                      # the usual case: the close-out cards were answered before /ship
  - ✓ [1] {card title} — "{reply word}" (this chat)
  - ✓ [2] …

  — or, only when no close-out happened before /ship (servers started first; Y alone does not validate these) —

HOW TO VALIDATE - {N} checks on {P} places
Reply any time, page by page: ok: <numbers> | failed: <numbers> <what you saw> | done | not yet
Open all pages (paste in PowerShell):
Start-Process "{url 1}"; Start-Process "{url 2}"
  PAGE: {Page name}
  URL:  {full URL}
  [1] {plain title}
      Before: {only when needed}
      Do:
        a) {action}, paste:
           {exact value, alone on its line}
      Expect: {success}
      Fail:   {only when needed}
  [2] …
  PLACE: {exact window}
  [3] …
  (full layout and card rules: docs/agent/job-validation.md → Format and Card rules)

Approve? (Y / merge / edit list / abort)   # Y = commit + push (+ PR); only "merge" merges; with cards above: "done Y"
~~~

Every Done-when item `[auto]` or `[ui]` → replace HOW TO VALIDATE with:

~~~text
VERIFIED BY AGENT
  - ✓ [auto] {item} — `{command}` → {output / exit code}
  - ✓ [ui] {item} — `{its e2e test}` → pass; screenshot `{path}`
~~~

A `[ui]` item is agent-checked with evidence: its own short e2e test (the project's e2e command, `commands.e2e`) passing, plus the
screenshot path (`docs/agent/job-validation.md` Tier 1b). A `[ui]` item whose test fails, or that no test can check,
falls back to `[human]` (`⚠ [ui→human] {item} — {why}`) and gets a card; a plan-drift result is listed apart, not as a bug.

Phase 4 shows exactly one of these, never none:
- **VALIDATED BY HUMAN** — the Human already answered the HOW TO VALIDATE cards in this session (end-of-job close-out, `/done`, or a validation word such as `done` / `verified` / `approved`). List each card with the reply word. **Never repeat cards the Human already answered** — the commit gate records validation, it does not re-run it.
- **HOW TO VALIDATE** — `[human]` items and no answered cards in this session: the close-out was skipped, so this gate shows the cards first. Run "Servers first" (`job-validation.md`: every page URL answers), then the cards grouped by page per `docs/agent/job-validation.md` → Format and Card rules; happy path + any edge/failure rule introduced; one line if no user-visible effect. Say in the tree that **Y** alone does not validate them: commit/push waits for a validation word (`done`, `verified`, `approved` — `done Y` answers both). `not yet` / `failed: <numbers>` → no commit; fix and re-show.
- **VERIFIED BY AGENT** — every Done-when item is `[auto]` or `[ui]` with its evidence.
A mix (some cards answered, some not) shows VALIDATED BY HUMAN with the unanswered cards repeated beneath it. Rules: `docs/agent/job-validation.md` → "When that moment is".

Matching open todos: list *before* Y (still `[ ]`). On **Y**, mark `[x]` and stage in the **same** commit — never a second push for checkboxes. Chat-only jobs (no ship): `docs/agent/job-validation.md` Path B / `/done`.

A proposed brain entry: print its **full draft body** fenced below the tree (tree line carries only path + title).

**Decisions to grade (Worker plan only):** when the plan's `## Execution Notes` hold `- decision:` lines and the Human has not graded them in this session, print them under the tree as `D1…Dn` — `removes:` first, then `behaviour:`, then `seen:`, one line each (`D2 · behaviour: … — reverse: …`) — and end with the reply format: `decisions: ok` or `D<n> ✗ <what I'd choose>` (several on one line, comma-separated). The grade may ride on the `Y` reply (`Y, D2 ✗ no dialog`). No decisions, or already graded → print nothing.

### Brain-entry capture (no new gate)

**FAST/ULTRA-TRIVIAL:** skip the mining procedure by default (a tiny diff rarely yields a durable entry). Exception: diff touches `docs/brain/**`, or Human says "check brain"/"brain capture". Omit the block rather than running the full procedure to conclude nothing's there.

**REGULAR:** Read `docs/agent/ship-regular.md` → "Brain-entry capture — REGULAR procedure" and follow it — including "How a proposed brain entry gets approved" whenever a brain entry is proposed on any lane.

### Semantic branch rename

On `feat/session-*`: `git log main..HEAD --oneline` + `git diff --stat main..HEAD` → derive slug (`feat|fix|refactor|chore` + 2–4 kebab words) → show `Rename: {old} → {new}` in the tree → rename on approval: `git branch -m`.

### On approval (order is hard — do not reorder)

Approve **Y** (or `--yes`) = commit/push consent. It validates `[human]` items only together with a validation word for cards the Human was shown (VALIDATED BY HUMAN, or `done Y` at this gate) — never on its own. Then:

1. **Todo sync (when items match):** mechanics (wt-N slot vs outside, exact commands, never-invent rule) → `docs/agent/job-validation.md` Path A step 2.
2. **Write brain drafts** (if proposed, not dropped) — verbatim to `docs/brain/**`.
   **Learning step (no command from the Human):** run `node scripts/decision-log.mjs learn --reply "<the Human's replies this session>"`. `LEARNING: nothing to record` → one line, no model call, go on. `LEARNING: record` → follow `docs/agent/decision-review.md`: log every `✗` decision and every `failed:` card to `docs/brain/decision-log.md`, add a rule to `docs/brain/agent-rules.md` when the same kind of mistake repeats (`no rule` in the reply skips it), and send each generic lesson to the kit (`scripts/kit-feedback.mjs`). The two `docs/brain` files join the commit in step 3.
3. **`git add` only listed paths** (todo/plan/brain included) — one commit with job + todos (+ brain), never job-then-todos-later. One `git add -- <paths>` call, and **stop on a non-zero exit** before any commit: a path that no longer exists (a deletion `git rm` already staged, a typo) aborts the whole add, and a commit that follows anyway holds only what was staged before. Never relist a path `git rm` staged.
4. **`git commit`** (Conventional Commit; Cursor trailer `Co-authored-by: Cursor <cursoragent@cursor.com>` when applicable).
5. Rename branch if approved.
6. Push only if asked ("push"/"ship and push"): `git push -u origin HEAD`. FAST/ULTRA-TRIVIAL: push is implied by the single Y.
7. **Commit-vs-PR judgment** (before any `gh pr create`) — see below. Never open a PR silently.

Recovery, and push-rejected/merge-fails → `docs/agent/ship-recovery.md`. Never commit to `main`. Never force-push. Never amend after push.

### Commit-vs-PR judgment

REGULAR, or the PR path is reached → Read `docs/agent/ship-regular.md` → "Commit-vs-PR judgment" and "After opening a PR" and follow them.

**Hard rule (every lane):** Never open a PR without (a) the brief's Done-when fully met, or (b) explicit user instruction.

Every `gh` call names the repo `origin` points at: `gh pr create -R <owner>/<repo> …` (from `git remote get-url origin`;
in a fork `gh` otherwise targets the parent). A failing `gh pr edit` → `gh api -X PATCH repos/<owner>/<repo>/pulls/<n>
-F body=@<file>`. Both: `docs/agent/standards-git.md` → "`gh` in a fork, and when `gh pr edit` fails".

Then **Phase 4.5 — Merge Gate** (mandatory).

---

## Phase 4.5 — Merge Gate (mandatory after successful push)

`merge` in the `/ship` request: already approved — merge without asking again (any lane), after writing any brain draft unless `no brain` was said.

Merging inside a slot: `docs/agent/standards-git.md` → "Merging from a slot" — delete the merged remote branch only when `node scripts/branch-autodelete-check.mjs` does not print `AUTODELETE: auto`; an already-gone branch is not a loose end.

`fast` passed, or Lane naturally FAST/ULTRA-TRIVIAL: already decided at Phase 4 — merge only if that reply (or the `/ship` request) contained the word `merge`; a plain `Y` / `--yes` leaves the PR open (`Merge: deferred`).

Otherwise (REGULAR, `fast` not passed): Read `docs/agent/ship-regular.md` → "Phase 4.5 — Merge Gate (REGULAR procedure)" and follow it.

Never merge without the Human's literal word `merge` — in this ship's `/ship` request or in the reply to its gate. `Y`, `--yes`, "ship fast y" without `merge`, and a `merge` from an earlier ship/turn never count.

---

## Phase 5 — Open items (no file to write)

There is no session-state file. What shipped is the commit and the PR; what is still open is written where the next
session already looks, in the commit from step 3 and never in a second one:

- a loose end of this plan → a line in the plan's `## Execution Notes` (the plan file is already staged);
- no plan, or a loose end for the Human → a line in the PR body and in the wrap-up below.

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
Learning: nothing to record | {n} logged, rule {added|none}, kit feedback {PR url|none}
Todo: {n marked} | no matching open items — skipped
Open items: {where they were written} | none
```

Milestone/checkpoint with an incomplete brief → also include: `Milestone commit — brief not yet complete, no PR proposed`
