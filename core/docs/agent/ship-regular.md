# /ship — REGULAR lane procedure

Loaded from `.claude/commands/ship.md` when Lane = REGULAR, or when any lane's ship reaches the PR path (a feature-complete commit). FAST and ULTRA-TRIVIAL checkpoint-only ships never need this file. If a section here seems to duplicate something already fixed elsewhere, check `docs/brain/gotchas/` — this file is a direct extraction of ship.md's REGULAR-lane text, moved verbatim.

---

## Phase 2 — REGULAR review procedure

**Lane = REGULAR:**
1. Invoke `/review` by **reading `.claude/commands/review.md` and executing it inline** — do
   **not** call it via the Skill tool by name (`skill: "review"`). The plain name "review" is
   ambiguous with a {{tools.browser}}-vendored skill of the same name at `~/.claude/skills/review/`,
   which is a much heavier multi-agent Review Army (telemetry, onboarding prompts, specialist
   subagent dispatch, Codex integration) — the Skill tool has been observed resolving to that
   one instead of this project's lightweight, judgment-only review, burning many times the
   tokens for no extra safety. Same collision risk applies to any other command name that
   might shadow a {{tools.browser}} skill (e.g. `browse`) — when a command file says "read X and execute
   it," read the file directly, don't route through Skill-tool name resolution.
2. On `REVIEW: PASS` → continue.
3. On `ISSUES FOUND` → fix the listed issues → re-run `/review` **exactly once**.
4. If still `ISSUES FOUND` → **stop**. Do not commit. Present remaining issues to the user.
5. Retry cap is hard: one fix-and-recheck cycle only. Never loop indefinitely.

---

## Brain-entry capture — REGULAR procedure

**Lane = REGULAR:** unchanged — follow `docs/agent/brain-capture.md`: run the extraction procedure (mine `sessions/YYYY-MM-DD.md` Decisions / review findings — not the diff alone), pick the artifact type(s), draft the full body per the required shape, then run the usefulness gate.

- **Required shapes** — Pattern: Problem / Solution / When to use. Gotcha: What hurt / Why the obvious fix is wrong / What to do instead. Decision: Context / Decision / Consequences (ADR, next number). Templates: `docs/brain/patterns/_TEMPLATE.md`, `docs/brain/decisions/_TEMPLATE.md`.
- **One-liner-only proposals are forbidden** — a title that restates the commit subject is not an entry. No draft body that fills the shape → nothing durable → omit the block entirely (the common case for chores).
- **Split when both apply** — a pattern (happy path) and its paired gotcha (the trap that looked like success) are two lines + two fenced drafts, cross-linked.

**How a proposed brain entry gets approved (any lane, whenever one is proposed):** This rides the existing `Approve? (Y / edit list / abort)` answer — there is no separate Y/N for the brain entry. Say `no brain` / `skip brain` alongside `Y` to opt out for this ship, or "edit list" to revise it (treat it like any other stageable item). On approval, write each approved draft **verbatim** to its `docs/brain/` file (for a gotcha: append to the matching `gotchas/<domain>.md` per the routing table in `docs/brain/gotchas.md`; new file under `patterns/`; new numbered file for `decisions/`) and stage it alongside the rest.

---

## Commit-vs-PR judgment

Decide whether this ship is a **feature-complete** commit (push + propose PR) or a **milestone/checkpoint** commit (push only, no PR). Do **not** infer "open PR if applicable."

**Manual override (check first):** If the user's ship-time message explicitly says e.g. "open a PR" / "create a PR" → treat as feature-complete and propose a PR. If it says e.g. "just commit" / "checkpoint" / "no PR" → treat as checkpoint; commit + push only, no PR. Skip the brief/ad-hoc check below when an override is present.

**Otherwise — brief used this session** (brief file referenced in conversation or `.claude/todo.md`):

1. Compare the session diff against that brief's **Done when** list.
2. **All criteria met** → feature-complete → run `node scripts/brain-review-check.mjs --scope=full` (advisory only — findings never block the PR, just get reported), then proceed to propose PR (`gh pr create` on a feature branch, existing flow).
3. **Not all criteria met** → milestone/checkpoint → commit + push to the branch only; **do not** propose a PR; **do not** run the `--scope=full` brain check (checkpoint commits only get the CI `--scope=dead-refs` pass). In the ship summary state explicitly: `Milestone commit — brief not yet complete, no PR proposed`. Then **Phase 4.5** with the CHECKPOINT banner.

**Otherwise — no brief this session** (ad-hoc work, no Done-when to check):

- Do **not** default to opening a PR.
- Ask once, single-select style: `Is this feature-complete (open a PR) or a checkpoint (push only)?`
- Follow the user's answer; do not assume either path.

**Hard rule:** Never open a PR without either (a) the brief's Done-when fully met, or (b) explicit user instruction (override or ad-hoc answer).

## After opening a PR (feature-complete path only)

After opening the PR, run `gh pr checks --watch` once. If any check fails, offer the user: run the fix loop now (`docs/agent/pr-check-fix-loop.md`) or leave it. Do not auto-run without asking.

Then proceed to **Phase 4.5 — Merge Gate** (mandatory).

---

## Phase 4.5 — Merge Gate (REGULAR procedure)

Follow `docs/agent/standards-git.md` → **Post-push Merge Gate**. Copy the combined MERGE GATE + BRAIN CAPTURE visual block exactly; wait for Human reply. Do not skip because a PR URL was already printed.

- **Feature-complete / PR path:** show MERGE GATE + Brain capture. On `merge` → create PR if missing, then `gh pr merge --merge --delete-branch` — inside a slot use `standards-git.md` → "Merging from a slot" instead (no `--delete-branch`; stay in the slot) — (if the merge fails on a dirty tree, see `docs/agent/ship-recovery.md` → "PR merge fallback"). On `later` → stop with PR in Next Steps. On `open-pr-only` → ensure PR exists, do not merge.
- **Checkpoint / milestone path:** show CHECKPOINT — DO NOT MERGE YET (+ Brain capture when durable). Do not offer merge.
- **Brain re-show:** If Phase 4 skipped the brain block (ad-hoc commit/push, deferred, or nothing staged then) but something durable happened in the session, **re-show** the Brain capture proposal here — per `docs/agent/brain-capture.md`: banner line = path + one-line title, full draft body in a fenced block below the banner, usefulness gate already passed. Omit only when nothing durable.
- **Brain capture auto-writes on the gate reply** — no separate `brain approve` token, matching how Phase 4 already rides `Y`:
  - `merge` / `later` / `open-pr-only` → write the approved fenced draft verbatim (append gotcha, new pattern file, or new `decisions/NNNN-*.md`) first, then do the reply's normal action (commit + push to the PR branch when possible; tiny follow-up PR if already merged).
  - `no brain` / `skip brain` (combined with any of the above) → explicit no-op on the brain write only; the gate reply's other action still happens.
  - `brain edit …` → revise draft, re-show banner, wait again before writing.
  - Combine freely (e.g. `merge`, `merge, no brain`, `later, brain edit …`).

Never merge without the Human's literal word `merge` in the reply to the gate; `Y` / `--yes` never merge.
