# Plan 081 — Card outcomes are recorded, and card kinds that always pass are proposed to the Planner as [ui] items

Status: draft
Depends-on: 069, 070
Snapshot: b075db1e9c4876d4f210c95612df2e2a406a160a

## Problem Statement

Validation cards are the Human's slowest step: run test-514-515 ended with 127 cards on the first MVP run, and every run
since ends with a list he works through by hand. Plan 069 groups and shortens the list; it does not learn from it. The
idea C3 was saved in the backlog plan 024 on 2026-10-27 and kept when 024 was split on 2026-11-01:

> Learn from past runs which card types always pass and which fail often — record the outcome of each answered card,
> suggest promoting a type to `[ui]` or `[auto]` after it passed in 3 runs, list often-failing types first. Not planned
> now: rebuild it on the kit brain (plans 045 and 046) and the grade log from plan 041 once those are merged.

045 and 046 are merged, so the condition is met. Two facts shape the plan:

1. Card outcomes are partly recorded already: a script or browser verdict is stored per card in `status.json`
   (`card`, `card-status`, `via`, `page`; `orchestrate.js:817`). The Human's own `ok: <numbers>` / `failed: <numbers>`
   replies on the remaining cards are not stored anywhere a script can count (`docs/agent/job-validation.md`).
2. Only the plan author tags a Done-when item (`save-plan` Plan rules); an agent never promotes a tag. So a "promotion"
   can only be a suggestion the Planner sees while writing the next plan.

Whether card kinds repeat often enough to be worth counting is not known. The plan measures that first and stops if
the data is too thin.

## Goals & Success Criteria

**Primary:** each answered card leaves one outcome row; a kind of card that passed by the Human's hand in 3 different
runs appears to the Planner as an `open:` suggestion to write it as a `[ui]` item; kinds that fail often are listed
first in the next end-of-run card list.

- [auto] `node --test tools/test/card-outcomes.test.mjs` passes, with tests that fail on today's code:
  (a) `node scripts/decision-log.mjs cards --run <run> --reply "ok: 1,2 failed: 3" --list <cards.json>` appends one row
  per numbered card to `docs/brain/card-outcomes.jsonl` (`run`, `plan`, `tag`, `card`, `page`, `outcome`, `via:
  "human"`, `kind`) and prints `CARDS: recorded 3`; the same reply again adds nothing;
  (b) at `finish` the run's script and browser verdicts from `status.json` are appended the same way (`via: "script"` or
  `"browser"`);
  (c) `kind` is `<tag>|<page path with ids and numbers replaced by :id>|<card text with quoted strings and numbers
  replaced>`, lowercased, so the same check on two plans gets the same kind;
  (d) `decision-log.mjs cards --stats` prints `CARD_KIND <kind> · runs <n> · pass <p> · fail <f>` lines, the
  `promote?` mark on a `[human]` kind with a Human pass in at least 3 different runs and no fail, and `CARDS: no
  outcomes yet` on an empty file.
- [auto] The rendered `plan.md` Architect + PM review runs `decision-log.mjs cards --stats --promote` when
  `card-outcomes.jsonl` exists and adds one `open:` line per marked kind the draft repeats as `[human]`
  (`open: cards like "<kind>" passed by hand in <n> runs — write this item as [ui]?`); the rendered `job-validation.md`
  says the end-of-run list shows cards of often-failing kinds first (a test reads both).
- [auto] `npm run build`, `npm run lint` and `node --test "tools/test/*.test.mjs"` pass.
- [auto] `node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .` reports no drift.
- [human] After three FoodVibe runs, `cards --stats` lists at least one kind the Human agrees could have been a `[ui]`
  item.

## Execution Mode
- Parallel: no.
- Concurrent plans: plans 069, 070 and 073 change the card list and `decision-log.mjs`; this plan comes after 070.
- Isolated DB: no.

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/scripts/decision-log.mjs
scripts/decision-log.mjs
core/scripts/lib/card-kind.mjs
scripts/lib/card-kind.mjs
core/scripts/orch-state.mjs
scripts/orch-state.mjs
core/.claude/commands/plan.md
.claude/commands/plan.md
core/docs/agent/job-validation.md
docs/agent/job-validation.md
.kit/install.json
tools/test/card-outcomes.test.mjs
tools/test/fixtures/card-outcomes/**
CHANGELOG.md
```

`scripts/**`, `.claude/**`, `docs/agent/**` and `.kit/install.json` are the rendered copies, written only by
`node tools/sync.mjs --target . --apply` (R1).

## Read Scope

Entire repo and its git history, and the `status.json` files of past runs where the builder can read them.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry.

## Architecture Impact
- INV-none: preserves — a project-owned outcome log, a report and two instruction lines; tags stay the plan author's.

## Step 0 — Reality Check

1. Runs only when `scope-check.mjs --drift` reports `REALITY: drift`: check the listed commits by symbol and print `ok`
   or `conflict: <what>` per commit; stop for a go only on a conflict.
2. Always — measure before building: write `cardKind()` first (C1), then run it over every card record in the past
   `status.json` files the builder can read (`docs/orchestrator/runs/*/status.json` on the branch, plus the fixture
   runs) and write into Execution Notes the number of cards, of kinds, and of kinds seen in 2 or more runs. Fewer than 5
   repeating kinds → stop with `CARDS: too few repeats — <n>`, tick C1 only, and leave the rest for the Human.

## User Stories
- As the Human, I want card kinds I always pass by hand to become scripted `[ui]` items in future plans, so that my list
  gets shorter run by run.
- As the Human, I want cards that often fail shown first, while I am still fresh.

## Functional Requirements

### Must Have (P0)
- [ ] `cardKind()` and the Step 0 measurement.
- [ ] Outcome rows from the Human's replies and from the run's verdicts.
- [ ] `cards --stats` with the promotion mark (3 runs, no fail).

### Should Have (P1)
- [ ] The Planner's `open:` suggestion and the failing-first order.

### Nice to Have (P2)
- Sending outcome rows to the kit brain (a later plan; the project log is enough to prove the idea).

## UI/UX Notes
- Terminal text only.

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [ ] C1: Give every card a kind that stays the same across plans, and measure whether kinds repeat — `cardKind()` plus the Step 0 count — core/scripts/lib/card-kind.mjs, tools/test/card-outcomes.test.mjs, tools/test/fixtures/card-outcomes/**
- [ ] C2: Keep one outcome row per answered card, from the Human's reply and from the run's own verdicts — `decision-log.mjs cards --run --reply --list`, and `finish` appending the script and browser verdicts — core/scripts/decision-log.mjs, core/scripts/orch-state.mjs, tools/test/card-outcomes.test.mjs
- [ ] C3: Show which kinds always pass by hand and which fail — `cards --stats [--promote]` — core/scripts/decision-log.mjs, tools/test/card-outcomes.test.mjs
- [ ] C4: Let the Planner see the promotion suggestion and the Human see failing kinds first — one review step in plan, one card-order sentence in job validation — core/.claude/commands/plan.md, core/docs/agent/job-validation.md
- [ ] R1: Render the kit's own installed copies, check drift and add a changelog line — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .` — scripts/**, .claude/**, docs/agent/**, .kit/install.json, CHANGELOG.md

## Technical Considerations
- Dependencies: plan 069 (the end-of-run card list and its numbering), plan 070 (the reply parser in `decision-log.mjs`
  and the run's decision ids); `status.json` card records (`orchestrate.js:817`).
- New files: `core/scripts/lib/card-kind.mjs`, `tools/test/card-outcomes.test.mjs`, fixtures.
- Model changes: none. Backend / API: none. Auth and validation: none.
- Security surface: card text stays in the project's own `docs/brain/`; nothing leaves the machine in this plan.
- Data / migration: a new project-owned file `docs/brain/card-outcomes.jsonl`.

## Out of Scope
- Changing a plan's tags automatically (only the plan author tags).
- Promoting to `[auto]` (a card is a UI check; `[auto]` stays for exact command output).
- Sending outcomes to the kit brain.

## Critical Questions
- Q: How many passed runs before a suggestion? A: 3 (Human, plan 024, 2026-11-01).
- Q: Build on if kinds rarely repeat? A: no; Step 0 stops the plan below 5 repeating kinds (recommended).

## Execution Notes
- Source: backlog item C3 in `plans/1-100/024-validation-speed-ups-backlog-fewer-and-cheaper-cards.plan.md` (chat
  "Validation schema redesign", 2026-10-27; split in chat "פיצול תוכנית 024", 2026-11-01).
