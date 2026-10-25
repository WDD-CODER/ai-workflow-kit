# Plan 022 — Validation cards in plain terminal text with copy-ready values

Status: draft
Depends-on: none
Snapshot: a142a8337ab251a266845a3224190d91ee50ecb6

## Problem Statement
The HOW TO VALIDATE cards (plan 009) are hard for the Human to follow and slow to act on:
- Each card has six or seven labeled lines (WHY, WHERE, SETUP, DO, SEE, FAIL); WHY and WHERE overlap, and a Human who
  is not reading carefully loses the one thing to do.
- A value to type sits inside a sentence ("DO paste: …"), so the Human copies a whole line and trims it by hand.
- A dependency ("check 2 only works after check 1") is not written anywhere.
- The cards are shown in a terminal (Claude Code) or in Cursor chat, where colors, emoji, tables and circled digits
  do not render reliably; text in Hebrew mixed into an English line is scrambled by the terminal.

Decided with the Human on 2026-10-25: keep the one-card-per-check, grouped-by-page structure; print it as plain
terminal text; every value the Human types or pastes is English and sits alone on its own line; Hebrew only when the
value is literal Hebrew data the app or database holds.

## Goals & Success Criteria
**Primary:** every card the kit prints is plain text, and every value to type or paste can be copied from one line.

- [auto] `grep -rEn "SEE ✓|FAIL ✗|WHY {2,}|WHERE {2,}|▸|[①②③④⑤⑥⑦⑧⑨]" core/docs/agent/job-validation.md core/.claude/commands/ship.md core/.claude/commands/done.md core/.claude/commands/take-plan.md layers/cursor/.cursor/commands/done.md layers/cursor/.cursor/commands/ship.md templates/AGENTS.md` prints nothing.
- [auto] `grep -c "Expect:" core/docs/agent/job-validation.md` prints a number greater than 3 (Format, example, Required close-out block).
- [auto] `node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .` exits 0.
- [auto] `npm run build` exits 0.
- [human] The next hand-off a project prints after `kit-sync` shows plain-text cards where each pasted value is alone on its line, commands are English, and any Hebrew sits alone on its own line exactly as the app shows it.

## Execution Mode
- Parallel: no (plan 023 edits the same files and depends on this one).
- Concurrent plans: none.
- Isolated DB: no.
- Kit edits: kit branch `feat/022-validation-cards-plain-text` + kit PR; Dandan merges and gives the go for the release.

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`.

```scope
core/docs/agent/job-validation.md
core/.claude/commands/ship.md
core/.claude/commands/done.md
core/.claude/commands/take-plan.md
layers/cursor/.cursor/commands/done.md
layers/cursor/.cursor/commands/ship.md
templates/AGENTS.md
CHANGELOG.md
AGENTS.md
README_WORKFLOW.md
docs/agent/job-validation.md
.claude/commands/ship.md
.claude/commands/done.md
.claude/commands/take-plan.md
.cursor/commands/done.md
.cursor/commands/ship.md
.kit/install.json
```

The last nine entries are this repo's installed copies, written only by `node tools/sync.mjs --target . --apply`.

## Read Scope

Entire repo, including `core/.claude/instructions/validation-checklist.md`, `core/docs/agent/workflow-map.md` and
`core/docs/brain/patterns/how-to-validate-on-job-gate.md` (they point at the section by name; the name stays).

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry. Tags and releases: wait for Dandan's go.

## Architecture Impact
- INV-none: preserves — kit instruction files only; no app, server or schema file, and `docs/brain/invariants.md` lists no invariant these files touch.

## Step 0 — Reality Check
Runs only when `node scripts/scope-check.mjs --drift` reports `REALITY: drift`: re-read the section "HOW TO VALIDATE
checklist" in `core/docs/agent/job-validation.md` and the card blocks in `ship.md` and `done.md` as they are on
`origin/main` and apply the changes below to that text.

## Atomic Sub-tasks

- [ ] A1: Print cards as plain terminal text that reads the same in Claude Code and Cursor — new Format section and example: header, `PAGE:`/`URL:` lines, `[n]` numbers, labels Before/Do/Expect/Fail, one `=` rule between places; no colors, emoji, tables, circled digits or box drawing — core/docs/agent/job-validation.md
- [ ] A2: Put every value the Human must type on its own line so one triple-click copies it — Core rule "copy-ready": no label, bullet or trailing words on that line; commands, paths, flags and numbers are English; Hebrew only for literal data the app or database holds, written exactly as the app has it, alone on its line, never mixed with English words on one line — core/docs/agent/job-validation.md
- [ ] A3: Make cards shorter so long lists stay cheap to read — drop the WHY line (the title says what is proven), keep Before only when the check needs data that may not exist, keep Fail only when failure is more than "Expect did not happen" — core/docs/agent/job-validation.md
- [ ] A4: Say on a card when it needs an earlier one first — "(needs [1] done first)" after the title whenever a check uses data another card creates — core/docs/agent/job-validation.md
- [ ] A5: Use the same card layout in the chat-job close-out so both paths look alike — the "Required close-out block" and the `/done` block, reply words unchanged — core/docs/agent/job-validation.md, core/.claude/commands/done.md
- [ ] A6: Use the same card layout in the ship approval tree and number answered cards as [1] — VALIDATED BY HUMAN lines and the fallback HOW TO VALIDATE block — core/.claude/commands/ship.md
- [ ] A7: Update the take-plan close-out and both Cursor commands to name the new layout and the two rules — wording only — core/.claude/commands/take-plan.md, layers/cursor/.cursor/commands/done.md, layers/cursor/.cursor/commands/ship.md
- [ ] A8: Mirror the two rules in one line of the always-loaded rules — Job validation hard rule — templates/AGENTS.md
- [ ] A9: Re-render this repo's installed copies and prove nothing drifted — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .`, `npm run build` — rendered copies
- [ ] A10: Record the change for the next release — CHANGELOG entry under Unreleased: no action for projects; rendered files that change — CHANGELOG.md

## Technical Considerations
- Dependencies: plan 009's hand-off rules (servers first, page grouping, reply words) stay as they are; only the card text changes.
- New files needed: none.
- Model changes: none.
- Backend / API: none.
- Auth and validation: none.
- Security surface: none.
- Data / migration: none.
- Project checks: none (`docs/project/plan-checks.md` does not exist).
- Token cost (estimate, not measured): a card is about 150–200 tokens; with the trims in A3 the layout costs about the same as today's.
- Terminals may display Hebrew mirrored or misordered; the rule keeps Hebrew alone on a line for that reason. Copying is expected to give the correct text but was not verified — see Critical Questions.

## Out of Scope
- Reply handling per page and the one-line page opener — plan 023.
- The orchestrator's end-of-run validation list and screenshot grid (`docs/agent/orchestrator.md`) — plan 024 (backlog).
- Any change to which Done-when items get cards (`[auto]`, `[ui]`, `[human]` tagging).

## Critical Questions
- Q: Does Hebrew copied from a Windows terminal paste into the app in the right order? A: open — Dandan checks with the first real hand-off; if it fails, the rule changes to give the Hebrew value inside a code fence or in a `.txt` file the Human opens.

## Execution Notes
