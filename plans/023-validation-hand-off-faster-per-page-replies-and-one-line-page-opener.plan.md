# Plan 023 — Validation hand-off faster: per-page replies and a one-line page opener

Status: draft
Depends-on: 022
Snapshot: a142a8337ab251a266845a3224190d91ee50ecb6

## Problem Statement
Validating a finished job takes the Human a long time, and two causes are in the hand-off rules themselves:
1. The agent waits for one reply covering every card before it fixes anything. With many failures the fix rounds run
   one after another, after the Human has already looked at everything.
2. Before a check the Human opens each page by hand, finds the right record, and sometimes sets up data first. The
   cards already carry full URLs (plan 009) but the Human still opens them one by one, and a card's Before line often
   asks the Human to prepare data the agent could prepare.

Decided with the Human on 2026-10-25: do these two first; the rest of the speed-up ideas are in plan 024 (backlog).

## Goals & Success Criteria
**Primary:** the Human can answer cards page by page and the agent starts fixing failures at once; one pasted line opens every page of the hand-off at the right record.

- [auto] `grep -c "ok: <numbers>" core/docs/agent/job-validation.md` prints a number greater than 3 (Format, example, close-out block, reply handling) and `grep -rn "ok: <numbers>" core/.claude/commands/done.md core/.claude/commands/ship.md core/.claude/commands/take-plan.md` prints a line in each file.
- [auto] `grep -n "Start-Process" core/docs/agent/job-validation.md` prints the opener line in the Format section and in the example.
- [auto] `node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .` exits 0.
- [auto] `npm run build` exits 0.
- [human] On the next hand-off with two or more pages: pasting the printed line opens every page in the browser at the right record, and answering `failed: <number>` for page 1 makes the agent start the fix before page 2 is answered.

## Execution Mode
- Parallel: no (same files as plan 022).
- Concurrent plans: none.
- Isolated DB: no.
- Kit edits: kit branch `feat/023-validation-faster-hand-off`, branched from the plan 022 branch (or from `main` once 022 merged) + kit PR; Dandan merges and gives the go for the release.

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

Entire repo, including `scripts/slot-serve.mjs` (prints the ports the opener line uses) and `core/docs/agent/orchestrator.md`.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry. Tags and releases: wait for Dandan's go.

## Architecture Impact
- INV-none: preserves — kit instruction files only; no app, server or schema file, and `docs/brain/invariants.md` lists no invariant these files touch.

## Step 0 — Reality Check
Plan 022 merged (its Format section is the text this plan edits). Re-read the Format section and the card blocks in
`ship.md` and `done.md` as they are on `origin/main` and apply the changes below to that text.

## Atomic Sub-tasks

- [ ] B1: Let the Human answer cards a few at a time instead of all at the end — new reply words `ok: <numbers>` and `failed: <numbers> <what you saw>` accepted in any number of messages, `done` closes every card still unanswered — core/docs/agent/job-validation.md
- [ ] B2: Make the agent start fixing a reported failure at once, while the Human checks the other pages — after `failed:` fix it, run the agent's own `[auto]`/`[ui]` checks, re-show only that card marked "re-check"; also re-show any already-ok card on the same page the fix touched — core/docs/agent/job-validation.md
- [ ] B3: Keep the record of answered cards as they arrive so ship shows the right VALIDATED BY HUMAN list — each `ok:` reply is a validation word for exactly those cards, never for the rest — core/docs/agent/job-validation.md, core/.claude/commands/ship.md
- [ ] B4: Print one line that opens every page of the hand-off — after servers answer, "Open all pages" line of PowerShell `Start-Process "<url>"` commands joined by `;` (macOS `open`, Linux `xdg-open` stated once), URLs in click order — core/docs/agent/job-validation.md
- [ ] B5: Make the agent prepare the data a card needs and link to it — seed the record in the slot or dev database (never shared or production data), put its real id in the URL, and write Before only when the agent cannot prepare it — core/docs/agent/job-validation.md
- [ ] B6: Add the new reply words and the opener line to the close-out and ship blocks — header "Reply any time, page by page", the `/done` block and its step 5, ship fallback block — core/.claude/commands/done.md, core/.claude/commands/ship.md, core/.claude/commands/take-plan.md
- [ ] B7: Give Cursor the same two rules, since it has no hook — layers/cursor/.cursor/commands/done.md, layers/cursor/.cursor/commands/ship.md
- [ ] B8: Mention page-by-page replies in the always-loaded rules — one clause in the Job validation hard rule — templates/AGENTS.md
- [ ] B9: Re-render this repo's installed copies and prove nothing drifted — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .`, `npm run build` — rendered copies
- [ ] B10: Record the change for the next release — CHANGELOG entry under Unreleased — CHANGELOG.md

## Technical Considerations
- Dependencies: plan 022's card layout; plan 009's servers-first rule (the opener line is printed only after every URL answers).
- New files needed: none.
- Model changes: none.
- Backend / API: none.
- Auth and validation: none.
- Security surface: the agent seeds data only through the project's own seed command or dev API, in the slot's dev database; a card never points at, or changes, production or shared data.
- Data / migration: none.
- Project checks: none.
- Risk: a fix made while the Human is still validating can change a page the Human already marked ok. B2 handles it by re-showing the already-ok cards on the same page as re-check; a fix touching shared code may affect other pages, which the agent states in one line.
- The opener line is Windows-first (PowerShell) because the Human works on Windows; the other shells are named once, not per card.

## Out of Scope
- Showing cards the agent's script already passed as a separate "glance" group, merging duplicate cards, learning which cards always pass, skipping untouched areas, reproducing a failure by script — plan 024 (backlog).
- The orchestrator's end-of-run validation list.
- Changing `scripts/slot-serve.mjs`.

## Critical Questions
- Q: Should `ok:` replies also count when sent in the middle of the agent's fix? A: open — proposed: yes, they are queued and recorded when the agent finishes its current step.

## Execution Notes
