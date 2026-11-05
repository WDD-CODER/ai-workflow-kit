# Plan 077 — A readiness answer later shown wrong is marked, and a per-kind report shows which questions an agent could answer

Status: draft
Parked: 2026-11-05 — reliability freeze, revisit 2026-11-15
Depends-on: 076, 071, 075
Snapshot: b075db1e9c4876d4f210c95612df2e2a406a160a

## Problem Statement

After plan 076 every readiness answer is stored as a row in `docs/brain/readiness-answers.jsonl` with its kind, its
default and whether the Human took it. The field that matters most for a future advisor agent is still missing: was the
answer right? The Human's own words on 2026-11-01: only a later verdict tells "decisions an agent can be trusted with"
from the ones it cannot.

The verdict already appears in one place. When the Human writes validation notes, the notes sorter (plan 071) gives each
item an origin in a fixed order: the plan said so, then an approved decision or an answer to a question, then a written
rule, then a code pattern. A row whose origin is the Human's answer to a readiness question and whose category is
"reverses a decision I approved" is exactly an answer that turned out wrong. Today nothing links that row back to the
answer, and nothing summarises the answers per kind.

## Goals & Success Criteria

**Primary:** an approved notes table that reverses a readiness answer marks that answer `wrong` by script; a run whose
merge and validation finished without such a row marks its answers `held`; one command prints, per kind, how many
answers there were, how often the default was taken, how often the Human delegated, and how often an answer was wrong.

- [auto] `node --test tools/test/readiness-answers.test.mjs` passes, with tests that fail on today's code:
  (a) `notes-apply` with an approved row whose origin is the notes table's usual `{file, line}` pointing at a readiness
  answer line (`Orchestrator readiness (<date>, <run>): …`, plan 076) plus `answerId: "<run>-<plan>-<n>"`, and whose
  category is the reversed-decision category, sets `verdict: "wrong"` and `verdictBy: "notes"` on that answer row, once
  (a second apply changes nothing);
  (b) `node scripts/decision-log.mjs readiness --close --run <run>` sets `verdict: "held"` on every answer of the run
  with no verdict yet and prints `READINESS: held <n>, wrong <m>`; a closed run is never closed twice; `wrong` overrides an
  earlier `held` (notes can arrive after the close), and nothing overrides `wrong`;
  (c) `node scripts/decision-log.mjs readiness --stats` prints one line per kind
  `<kind> · answers <n> · default taken <p>% · delegated <q>% · wrong <r>%`, sorted by answers, and `READINESS: no
  answers yet` on an empty file.
- [auto] `node --test tools/test/notes-table.test.mjs` passes with a test that the table validator accepts an `answerId`
  beside a `{file, line}` origin and refuses an `answerId` with no such row in `readiness-answers.jsonl`.
- [auto] `node --test tools/test/brain.test.mjs` passes with a test that a verdict change is sent as a new
  `readiness-answer` event that names the same answer id and has the verdict in its `_id`, so the store keeps the
  history.
- [auto] The rendered `ship.md` says that when a run branch is merged and the Human's final reply has no `notes:`, the
  Planner runs `decision-log.mjs readiness --close --run <run>` and then `node scripts/brain.mjs send --answers --run
  <run>`; the rendered `notes-review.md` names the `answerId` field (a test reads both).
- [auto] `npm run build`, `npm run lint` and `node --test "tools/test/*.test.mjs"` pass.
- [auto] `node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .` reports no drift.
- [human] After two real runs, `node scripts/decision-log.mjs readiness --stats` in the project shows numbers the Human
  recognises (for example the kinds he always answers with the default).

## Execution Mode
- Parallel: no.
- Concurrent plans: 070 to 073 edit `decision-log.mjs`, `ship.md` and `notes-review.md`; this plan comes after 071.
- Isolated DB: no.

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/scripts/decision-log.mjs
scripts/decision-log.mjs
core/scripts/notes-table.mjs
scripts/notes-table.mjs
core/scripts/lib/readiness-question.mjs
scripts/lib/readiness-question.mjs
core/scripts/lib/brain-doc.mjs
scripts/lib/brain-doc.mjs
core/.claude/commands/ship.md
.claude/commands/ship.md
core/docs/agent/notes-review.md
docs/agent/notes-review.md
tools/test/readiness-answers.test.mjs
tools/test/notes-table.test.mjs
tools/test/brain.test.mjs
CHANGELOG.md
```

`scripts/**`, `.claude/**` and `docs/agent/**` are the rendered copies, written only by
`node tools/sync.mjs --target . --apply` (R1).

## Read Scope

Entire repo and its git history.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry.

## Architecture Impact
- INV-none: preserves — the plan adds fields and a report to project-owned learning files; no invariant's `Touches`
  glob is in scope.

## Step 0 — Reality Check

1. Runs only when `scope-check.mjs --drift` reports `REALITY: drift`: check the listed commits by symbol and print `ok`
   or `conflict: <what>` per commit; stop for a go only on a conflict.
2. Always: confirm on `main` that plan 071's `notes-table.mjs` exists, how its origin is written
   (`grep -n "origin" core/scripts/notes-table.mjs`) and the exact name of its reversed-decision category. Write both into
   Execution Notes; `answerId` is an optional field beside the existing origin, never a second origin shape.

## User Stories
- As the Human, I want to see, per kind of question, how often my answer was the default and how often it was wrong, so
  that I can decide which kinds an advisor agent may answer first.

## Functional Requirements

### Must Have (P0)
- [ ] The readiness origin form in the notes table, checked against the stored answers.
- [ ] `notes-apply` marks a reversed answer `wrong`; closing a run marks the rest `held`.
- [ ] The per-kind report.

### Should Have (P1)
- [ ] Verdict changes reach the kit brain.

### Nice to Have (P2)
- none

## UI/UX Notes
- Terminal text only; the report is at most one line per kind.

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [ ] V1: Let a notes table name a readiness answer as the origin of a mistake — an optional answerId beside the usual file-and-line origin, refused when the answer does not exist — core/scripts/notes-table.mjs, core/docs/agent/notes-review.md, tools/test/notes-table.test.mjs
- [ ] V2: Mark an answer wrong when an approved table reverses it, and held when its run closes clean — `notes-apply` sets the verdict once; `readiness --close --run` sets `held` when the run branch merged with no notes left; wrong overrides held; one line in the ship command that closes and sends — core/scripts/decision-log.mjs, core/.claude/commands/ship.md, tools/test/readiness-answers.test.mjs
- [ ] V3: Show per kind how often the default was taken and how often an answer was wrong — `readiness --stats` — core/scripts/decision-log.mjs, tools/test/readiness-answers.test.mjs
- [ ] V4: Send each verdict to the kit brain as its own event, so the history is kept — core/scripts/lib/brain-doc.mjs, tools/test/brain.test.mjs
- [ ] R1: Render the kit's own installed copies, check drift and add a changelog line — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .` — scripts/**, .claude/**, docs/agent/**, CHANGELOG.md

## Technical Considerations
- Dependencies: plan 076 (`readiness-answers.jsonl`, `parseQuestion()`), plan 070 (`notes-apply`), plan 071
  (`notes-table.mjs`, the origin column and its order).
- New files: none (tests extend files that 076 and 071 create).
- Model changes: answer rows gain `verdict` (`wrong` | `held` | null), `verdictBy`, `verdictAt`.
- Backend / API: none. Auth and validation: none. Security surface: none new (text already redacted by 076).
- Data / migration: rows written by 076 gain optional fields; old rows without them read as `verdict: null`.

## Out of Scope
- The advisor agent itself (a later plan, from the report this plan adds, after about a month of runs).
- Grading readiness answers one by one at `/ship` (it would add a question to every ship).

## Critical Questions
- Q: Should every answer get an explicit grade at `/ship`? A: no; a reversed answer is found through the notes table and
  the rest count as `held` when the run closes (recommended: no new question for the Human).
- Q: When is a run closed? A: when its run branch is merged and the Human's final reply has no `notes:` (recommended).
- Q: Which kinds may an advisor answer first? A: open until the report has about a month of data (Human, 2026-11-01).

## Execution Notes
- Source: chat "אוטומציה של תהליך עבודה עם סוכן" (2026-11-01) for the verdict field; chat "בחירת סוכן אופוסס מול סוננט"
  (2026-11-03) for the origin order the notes sorter uses.
- Review (Architect + PM, a separate agent against b075db1, 2026-11-03): mechanical gaps fixed in the draft (line references, scope and Depends-on, test names); open points answered with the recommended default in Critical Questions. The Planner's own review is still to run.
