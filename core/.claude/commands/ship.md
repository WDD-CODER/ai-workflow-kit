---
description: Session end — the gate in code, review, commit approval, merge gate
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, Agent
---

# /ship — Session end

`/ship`, `/end-session`, "wrap up", "ship it" (chat "ship fast" ≡ `/ship fast`). Repo root = workspace cwd. Invoking `/ship` authorizes a commit of this chat's files after an explicit **Y**; message-only prep → `git-agent`. Never commit to `{{git.mainBranch}}`, never force-push, never amend after a push. Push rejected, merge fails → `docs/agent/ship-recovery.md`.

Flags: `regular` forces REGULAR · `fast` makes one reply answer commit + push + PR · `--yes` commits without waiting (the review still runs) · `--skip-review "reason"` skips Phase 2 (reason required; `Review: SKIPPED ({reason})` + `[review-skipped: {reason}]` in the body) · the word `merge` anywhere in the request (`/ship fast merge`) pre-approves commit + push + PR + merge, while Phase 1 failures and Phase 3 STOPs still stop.

## Phase 0 — Lane
`node scripts/ship-prep.mjs` (`--mode regular` for `regular`); announce its `Lane:` line. The script decides: a sensitive, build or CI path is always REGULAR.

## Phase 1 — Gate (hard stop, every lane)
`node scripts/ship-prep.mjs --gate --lane <lane>` runs `npm run {{commands.build}}`, lint, the tests (REGULAR only), `node scripts/plan-ledger-check.mjs` and `node scripts/override-check.mjs` by code, one `GATE:` line each. Exit 1 → stop, do not commit; fix from the printed tail, re-run `/ship`. `OVERRIDE_CHECK: FAIL` names the step an override lost: add it back from the kit's template. Ledger warnings are advisory.

## Phase 2 — Review
- **FAST / ULTRA-TRIVIAL:** `npx eslint --fix`, one read of the diff for obvious bugs, `Review: SKIPPED (fast-lane: {n} files/{m} lines, no sensitive paths)` + `[review-skipped: fast-lane]` in the body.
- **REGULAR on a plan branch** (`feat|fix/NNN-<slug>` and its `plans/**/NNN-*.plan.md`): `review.ship` picks (this project: `{{review.ship}}`); `fast` takes `light` unless `sensitiveMatches` in `node scripts/ship-prep.mjs --json` is not empty (ADR 0015). Off a plan branch: `light`.
  - `checkers` — read `.claude/commands/review-it.md` and run its steps 1–6 inline on the working tree against `git merge-base HEAD origin/{{git.mainBranch}}` (`git add -N` the untracked files first) → `Review: checkers <Decision> — kept <n>, dropped <m>`.
  - `reviewer` — `node scripts/lib/plan-review.mjs --branch <current> --base origin/{{git.mainBranch}}` → `Review: reviewer <PASS|STOP> — <n> problems`.
  - `light` — read `.claude/commands/review.md` and run it inline, never through the Skill tool (a vendored skill shadows the name) → `Review: light PASS` (`light (fast) PASS` when `fast` chose it).
- A kept blocker/major, a STOP or `ISSUES FOUND` → fix, re-check **exactly once** (checkers: `orch-verify` on the fixed findings plus the checks, no second set of finders); still failing → stop, do not commit, show what is left.
- Plan branch: append `- review: <mode> kept <n> dropped <m> rechecked <k> minutes <t> models <role=model,…>` to its `## Execution Notes` (no token counts).

## Phase 3 — Manifest + rebase
`node scripts/ship-prep.mjs --check-baseline`:
- `BRANCH_CHANGED` → STOP, show both branch names. `HEAD_MOVED` → fresh `git status --short`, re-read files before `git add`.
- `scope: out` → STOP; list the files; `approved: <path>` or revert. Non-empty `overlaps` → STOP.
- Stage only this chat's paths: never `git add -A` (`no_manifest` too), never secrets or `.env`; a `.kit/install.json` that sync rewrote joins the job.

Then `git fetch origin && git rebase origin/{{git.mainBranch}}`. A conflict where both sides only added to a hotspot (`{{project.i18nFile}}`, `{{paths.hotspots}}`) → keep both, `git rebase --continue`; any other conflict → STOP, show the Human, never resolve it alone.

## Phase 4 — Commit gate
Print the tree, then wait for **Y** — except `--yes`; `merge` in the request (tag `[pre-approved: merge]`, go on through the merge); ULTRA-TRIVIAL (tag `[auto-approved: ultra-trivial]`: commit + push, never a PR).

~~~text
Branch: {branch}
Rename: {old → new}        # feat/session-* only: slug from git log + diff --stat main..HEAD; git branch -m on Y
Proposed commit:
  type(scope): subject
  body (why, not what)
  Review: {the Phase 2 line}
Files to stage:
  ├── {file}
  └── plans/….plan.md, .claude/todo.md   # matching items, still [ ], marked [x] on Y
{VALIDATED BY HUMAN | HOW TO VALIDATE | VERIFIED BY AGENT}
Approve? (Y / merge / edit list / abort)   # Y = commit + push (+ PR); only "merge" merges; with cards: "done Y"
~~~

Exactly one validation block, never none (`docs/agent/job-validation.md` → "When that moment is"):
- **VALIDATED BY HUMAN** — the Human answered the cards in this session (close-out, `/done`, `done` / `verified` / `approved`): one `✓ [n] {card title} — "{reply word}"` line each. Never repeat answered cards.
- **HOW TO VALIDATE** — `[human]` items and no answered cards: servers first (every page URL answers), then the cards per `job-validation.md` → Format and Card rules (one line when nothing is user-visible). **Y** alone does not validate them: wait for `done` / `verified` / `approved` (`done Y` answers both); `not yet` / `failed: <numbers>` → no commit; fix and re-show.
- **VERIFIED BY AGENT** — every Done-when item `[auto]` or `[ui]`: `✓ [auto] {item} — {command} → {output}`, `✓ [ui] {item} — {its e2e test} → pass; screenshot {path}`. A `[ui]` item whose test fails or that no test checks becomes `⚠ [ui→human] {item} — {why}` with a card; plan drift is listed apart.

A mix shows VALIDATED BY HUMAN with the unanswered cards beneath it.
<!-- KIT:if review.learn=on -->
**Learning (`review.learn` = `on`):** under the tree, the decisions to grade (`docs/agent/decision-review.md` → "In `/ship`") and a brain entry when durable (path + title in the tree, its full draft fenced below, `docs/agent/brain-capture.md`; FAST / ULTRA-TRIVIAL only when the diff touches `docs/brain/**` or the Human asks). Both ride the Y reply (`Y, D2 ✗ …`, `no brain`). On Y, between steps 1 and 2: write the approved drafts verbatim, then grade and learn per that section; the wrap-up adds `Brain: {summary | none durable}` and `Learning: nothing to record | {n} logged, rule {added | none}`.
<!-- KIT:end -->

### On approval (order is hard)
**Y** (or `--yes`) is commit/push consent; it validates `[human]` items only together with a validation word for cards the Human was shown.
1. Todo sync: mark the matching todos and plan sub-tasks `[x]` (`docs/agent/job-validation.md` Path A step 2).
2. `git add -- <listed paths>` in **one** call, ticks included; stop on a non-zero exit and never relist a path `git rm` staged. Then **one** commit (Conventional Commit; Cursor adds `Co-authored-by: Cursor <cursoragent@cursor.com>`) — never a second commit or push for checkboxes. Rename the branch if approved.
3. Push: REGULAR when asked (`git push -u origin HEAD`); FAST / ULTRA-TRIVIAL / `fast`: the single Y implies it. Open items go in this commit: the plan's `## Execution Notes`, or the PR body.
4. PR: never without the brief's Done-when met or an explicit instruction — `docs/agent/standards-git.md` → "Commit-vs-PR judgment"; every `gh` call names `-R <owner>/<repo>` (same file, "`gh` in a fork").

## Phase 4.5 — Merge Gate (mandatory after a push)
`docs/agent/standards-git.md` → "Post-push Merge Gate": its MERGE GATE (or CHECKPOINT) block and `merge` / `later` / `open-pr-only`; a slot merge runs `node scripts/branch-autodelete-check.mjs` first ("Merging from a slot"); after a merge, "Plan close after the merge". REGULAR without `fast` waits here; FAST / `fast` was answered at Phase 4. **Merge only on the literal word `merge`** in this `/ship` request or the reply to its gate: `Y`, `--yes`, "ship fast y" and a `merge` from an earlier turn never count (`Merge: deferred`).

## Wrap-up (always)
~~~text
SESSION WRAP — {branch}
Lane: {lane} ({reason}) · Build: PASS | FAIL · Review: {line} · Commit: {sha | none} · Push: yes | no
PR path: PR (Done-when met | user override) | Checkpoint (brief incomplete | user override) · PR: {url | N/A}
Merge: merged {sha} | offered | deferred | N/A (checkpoint) · Todo: {n marked | none matching} · Open items: {where | none}
~~~
A checkpoint with an incomplete brief adds: `Milestone commit — brief not yet complete, no PR proposed`.
