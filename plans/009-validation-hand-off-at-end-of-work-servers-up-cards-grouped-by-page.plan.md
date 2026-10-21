# Plan 009 — Validation Hand-off at the End of Work: Servers Up, Cards Grouped by Page

Status: draft
Snapshot: f83d318

## Problem Statement
Since kit PR #14 (2026-10-18) `/take-plan` no longer prints HOW TO VALIDATE cards at claim time — correctly, since
nothing can be checked before the work exists. But nothing replaced it at the **end** of the work: the cards only
appear if the agent decides on its own to read `docs/agent/job-validation.md` at close-out. On 2026-10-20 a FoodVibe
`/goal` run of plans 400–402 ended with a prose checklist, no cards, and the slot's servers down; the Human had to ask
for the ports, and after `/clear` the list was rebuilt again as prose.

The Human's rules (2026-10-20), already live machine-wide in `~/.claude/CLAUDE.md` "Human validation hand-off" and
enforced by the global hook `~/.claude/hooks/validation-handoff.mjs`:
1. Cards only when a check needs a human; all-`[auto]` → evidence only, no cards, no servers.
2. Cards when the work is finished, **before** `/ship`, a PR or a merge. Only with pre-approved merges ("merges
   pre-approved") do they come after the merge, `[human]` items left open until the Human replies.
3. Servers first: every page URL in the cards answers before the hand-off; the agent starts them itself.
4. Layout: grouped by page in click order — one `▸ <page> — <full URL>` line per page, its cards under it, numbers
   running on across groups; checks outside the app in a last group named by window.

This plan makes the kit's own files say the same thing, so every kit project (and Cursor, which has no global hook)
gets it through `kit-sync`.

## Prerequisites
- none.

## Goals & Success Criteria
**Primary:** in every kit project, a finished plan with `[human]` items ends with running servers and page-grouped
cards before any ship or merge.

- [auto] `grep -n "▸" core/docs/agent/job-validation.md` shows the page-grouped format in "Format" and in "Required
  close-out block"; `grep -c "app: {url" core/docs/agent/job-validation.md` → 0 (the per-header app field is gone).
- [auto] `core/.claude/commands/take-plan.md` has a numbered final step "Close-out" that names slot-serve, the cards and
  the wait, and states the pre-approved-merge exception.
- [auto] `core/.claude/commands/ship.md` Phase 4: with `[human]` items and no answered cards in the session, the
  gate shows the cards and states that **Y** alone does not validate them; `node --test` for the kit tools passes.
- [auto] `layers/cursor/.cursor/commands/{done,ship}.md` carry the same rules (Cursor has no hook).
- [auto] Kit release tagged; `kit-sync -Ref <tag> -Apply` on FoodVibe reports no `conflict` rows.
- [human] The next plan a FoodVibe Worker finishes ends with the servers up and page-grouped cards before `/ship`,
  without the global hook having to send it back (check the session: no "validation hand-off" hook block).

## Execution Mode
- Parallel: no (plan 008 also edits `core/.claude/commands/*`; take this after 008 merges).
- Concurrent plans: 008.
- Isolated DB: no.
- Kit edits: kit branch `feat/009-validation-hand-off` + kit PR; Dandan merges and gives the go for the release.

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`.

```scope
core/docs/agent/job-validation.md
core/.claude/commands/take-plan.md
core/.claude/commands/ship.md
core/.claude/commands/done.md
templates/AGENTS.md
layers/cursor/.cursor/commands/done.md
layers/cursor/.cursor/commands/ship.md
CHANGELOG.md
```

## Read Scope

Kit repo; FoodVibe's rendered copies of the files above; `~/.claude/CLAUDE.md` "Human validation hand-off" and
`~/.claude/hooks/validation-handoff.mjs` (the rule text the kit must match — read only, never copied into the kit).

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry. Project sync `conflict` rows: STOP, never `--force`. Tags and releases: wait
for Dandan's go.

## Architecture Impact
- INV-none: preserves — kit instruction files only; projects get them through `kit-sync`. No app, server or schema file.

## Step 0 — Reality Check
Plan 008 merged; re-read `take-plan.md` step 4 and `ship.md` Phase 4 as they are on `origin/main` after it, and
apply the changes below to that text.

## Atomic Sub-tasks
- [x] V1: Say clearly that cards appear only when a human is needed and only once the work is finished — Core rule + "When that moment is": all-[auto] → evidence only; cards before /ship, PR or merge; pre-approved merges ("merges pre-approved") → after the merge, items left open — core/docs/agent/job-validation.md
- [x] V2: Make the agent start the app before handing over checks, every time — "Servers first" becomes a hard step: every page URL in the cards must answer; slot → slot-serve, else the project's dev command; a failed start is fixed before the hand-off; no check needs the app → no servers — core/docs/agent/job-validation.md
- [x] V3: Group the cards by page so the Human opens each page once — new format: header "{N} checks on {P} pages", one "▸ page — full URL (real id for :id routes)" line per page in click order, WHERE names only the spot on the page, numbers run on, last group "Outside the app — window"; update the example and the Required close-out block; reply words done | not yet | failed: <numbers> | verify — core/docs/agent/job-validation.md
- [x] V4: Add the hand-off as the last step of every executed plan — take-plan gets a final "Close-out" step: [auto] evidence, then (when [human] items) slot-serve + cards + wait, before /ship; pre-approved merges exception; also applies when several plans run in one session — core/.claude/commands/take-plan.md
- [x] V5: Stop the ship gate from counting Y as validation when no cards were shown — Phase 4 wording and the page-grouped card format; VALIDATED BY HUMAN unchanged — core/.claude/commands/ship.md, core/.claude/commands/done.md
- [x] V6: Give Cursor the same rules, since it has no global hook — layers/cursor/.cursor/commands/done.md, layers/cursor/.cursor/commands/ship.md
- [x] V7: Point the always-loaded rules at the hand-off — one line in the Job validation hard rule: servers up, page-grouped cards, before ship/merge — templates/AGENTS.md
- [ ] V8: Release and bring it into FoodVibe — CHANGELOG entry, kit PR, release tag on Dandan's go, then kit-sync -Ref <tag> -Apply in FoodVibe and /ship there — CHANGELOG.md

## Out of Scope
- The global hook and `~/.claude/CLAUDE.md` rule (machine-wide, already in place; not kit files).
- New plan tags such as `[human:app]` — the page lines in the cards already tell whether the app is needed.
- Changing `scripts/slot-serve.mjs`.

## Execution Notes

Run in the kit slot `ai-workflow-kit-wt-1`, branch `feat/009-validation-hand-off` from `origin/main` `53ca2c6`.
Step 0: plan 008 merged (#29); `take-plan.md` step 4 and `ship.md` Phase 4 read as on `origin/main` — no conflict.
V1–V7 done; V8's kit part done (CHANGELOG under `[Unreleased]`: v1.3.1 is not tagged yet, so the version is chosen at
release). V8's PR merge, tag and FoodVibe `kit-sync` wait for Dandan.

- The section keeps the name "HOW TO VALIDATE checklist" (now "… — the hand-off at the end of the work"), because
  `core/.claude/instructions/validation-checklist.md` points at it by that name.
- `{{commands.dev}}` is not used for "outside a slot": its default is empty, so the text names the project's own dev
  command instead.
- Same rule, still old wording, outside this plan's scope: `core/.claude/commands/feat.md:26` ("Human Approve **Y**
  validates the job") and `core/docs/agent/workflow-map.md` F4 (no "servers first"). Asked the Human for `approved:`.
