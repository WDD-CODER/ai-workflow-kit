# Plan 070 — Validation notes are recorded: unique decision ids per run, graded orchestrator decisions, a triage lesson file and a notes reply

Status: draft
Parked: 2026-11-05 — reliability freeze, revisit 2026-11-15
Depends-on: 057, 065, 066, 069
Snapshot: 5784d6d3de92d41b9b08de0161cf3c31a430a8b2
Source: FoodVibe run test-514-515 (PR #499) hand-off and eval file (Human, 2026-11-03); part 1 of 4 with 071 (sorter), 072 (design rules), 073 (quick-fix lane)

## Problem Statement
In FoodVibe run test-514-515 the Human replied "done, with notes" to four rounds of validation cards. The kit recorded none of it:

1. The learning gate fires only on a cross mark or `failed:` (`core/scripts/decision-log.mjs:480`, `/✗|\bfailed:/i`), so "done, with notes" produces `LEARNING: nothing to record`.
2. `/ship` grades only `- decision:` lines in a Worker plan's notes (`core/.claude/commands/ship.md:160`). An orchestrator run keeps its decisions in `status.json`, so `decision-grades.jsonl` had 0 rows until they were written by hand.
3. Decision ids restart at D1 in every workflow call, and `orch-state.mjs:243-258` replaces a decision that has the same id. After a resume, the first pass's decisions disappear from the report and cannot be graded (plan 514's D1-D6 were lost; hand-off 5.1, 6.3).
4. The triage role has no lesson file, so the lesson for D1 (the triage question that did not ask about field order) had nowhere to go (hand-off 6.2).
5. A positive grade ("this choice was exactly right") and a grade for a note that has no decision id have no place in `decision-grades.jsonl`.

This plan records what the Human says. Sorting raw notes into a table is plan 071; design rules are plan 072; the quick-fix lane is plan 073.

## Goals & Success Criteria
**Primary:** a notes reply is recognised, an approved table of graded items can be applied by script (grades, lessons by role, follow-ups, run-log), and an orchestrator run's decisions are unique per run and gradeable at `/ship`.

- [auto] `node --test tools/test/notes-reply.test.mjs` passes, with tests that fail on today's code: `notes: x`, `Notes: x` and `done, with notes: x` make `decision-log.mjs learn --reply` print `LEARNING: record`; `done`, `not yet` and a reply with no cross and no `failed:` still print `LEARNING: nothing to record`; a reply holding `failed: 3` and `notes: x` is recognised as both.
- [auto] `node --test tools/test/orchestrator.test.mjs` passes, with a test that fails on today's code: a second `decisions` call on a run that already holds D1-D6 stores its decisions as D7 onward, leaves D1-D6 unchanged, and the report lists all of them.
- [auto] `node --test tools/test/decision-log.test.mjs` passes, with tests that fail on today's code: (a) `pending --status <status.json>` lists an orchestrator run's ungraded decisions as `D<n> · …` lines and `grade --run <run> --status …` stores them; (b) `notes-apply --table <file> --run <run>` stores one row per approved item: `ok`, `✗` with a cause, and `choice-ok` (a positive grade, also without a D id, stored with an id `N<round>-<n>`); (c) it adds each item's lesson to the file of the role named, `triage` included, and refuses a role with no lesson file; (d) it adds `seen:` items to `follow-ups.md`, fills the run-log ✗ column of the run, and a second apply of the same table adds nothing.
- [auto] `node --test tools/test/orchestrator.test.mjs` passes with a test that the rendered `orch-triage.md` reads `LESSONS` and that `INJECTED_ROLES` includes `triage`.
- [auto] The rendered instructions carry the change (a test reads them): `job-validation.md` lists `notes:` and `done, with notes:` as the third reply with the other two unchanged; `ship.md` says an orchestrator run's decisions come from `status.json`; `decision-review.md` §3 says approved notes items, positive ones included, reach the learning step.
- [auto] `npm run build` and `node --test "tools/test/*.test.mjs"` pass.
- [auto] `node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .` reports no drift.
- [human] On the next orchestrator run that ends with a `notes:` reply and a resume, the report lists every pass's decisions under unique ids, and `/ship` shows them to grade.

## Execution Mode
- Parallel: no.
- Concurrent plans: none; 065, 066 and 069 land first (shared files: `decision-log.mjs`, `orch-run.mjs`, `orchestrate.js`, `job-validation.md`).
- Isolated DB: no.
- Kit edits: one kit branch and one kit PR; one commit per sub-task group.

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`, plus the append-only hotspot `CHANGELOG.md` (add an entry, never rewrite one).

```scope
core/scripts/decision-log.mjs
scripts/decision-log.mjs
core/scripts/orch-state.mjs
scripts/orch-state.mjs
core/scripts/lib/orch-run.mjs
scripts/lib/orch-run.mjs
core/.claude/workflows/orchestrate.js
.claude/workflows/orchestrate.js
core/.claude/commands/ship.md
.claude/commands/ship.md
core/.claude/agents/orch-triage.md
.claude/agents/orch-triage.md
core/docs/agent/job-validation.md
docs/agent/job-validation.md
core/docs/agent/decision-review.md
docs/agent/decision-review.md
tools/test/notes-reply.test.mjs
tools/test/decision-log.test.mjs
tools/test/orchestrator.test.mjs
CHANGELOG.md
```

## Read Scope

Entire repo, including `docs/agent-evals/`.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry. Tags and releases: wait for the Human's go.

## Architecture Impact
- INV-none: preserves — adds a reply word, a lesson role and id rules in kit scripts; `docs/brain/invariants.md` (INV-1, pinned judgment model) is not touched.

## Step 0 — Reality Check
Checked on `origin/main` `5784d6d`: `decision-log.mjs:480` is the `learn` regex; `ship.md:160` is the Worker-plan-only grading step (plan 057 is merged and gave it `pending`/`grade --mark`); `orch-state.mjs:243-258` replaces a decision with the same id (`findIndex`, then overwrite); `orch-triage` has no lesson file. Before each group, re-read the lines named and drop any sub-task the code already covers (065 and 066 may have changed `lessonFacts`, `addLesson` and the role list; 069 may have changed `job-validation.md`).

## Atomic Sub-tasks

- [ ] G1: Keep decision ids unique across the passes of one run so a resume never overwrites the first pass — the second and later `decisions` calls continue after the highest stored id; the report reads all of them — core/scripts/orch-state.mjs, core/scripts/lib/orch-run.mjs, core/.claude/workflows/orchestrate.js
- [ ] G2: Give the triage role a lesson file and let the triage agent read it, so a bad question gets a lesson — add `triage` to the lesson roles and the injected roles; `orch-triage` reads `LESSONS` — core/scripts/decision-log.mjs, core/scripts/lib/orch-run.mjs, core/.claude/agents/orch-triage.md
- [ ] G3: Let /ship grade an orchestrator run's decisions and store approved notes items, positive ones included — `pending --status`, `grade --status`, and `notes-apply --table` (ok, ✗ with cause, choice-ok, lesson to a role, follow-ups, run-log ✗ column, idempotent) — core/scripts/decision-log.mjs, core/.claude/commands/ship.md, core/docs/agent/decision-review.md
- [ ] N1: Accept a third reply, notes, at every place the cards are answered and record it — `notes:` and `done, with notes:`, case-insensitive, free text after; `learn` prints `LEARNING: record` for it; layout unchanged — core/docs/agent/job-validation.md, core/scripts/decision-log.mjs
- [ ] T1: Add tests that fail on today's code for each group, resync installed copies and add a changelog entry — tools/test/notes-reply.test.mjs, tools/test/decision-log.test.mjs, tools/test/orchestrator.test.mjs, CHANGELOG.md

## Technical Considerations
- The table row shape that `notes-apply` reads is defined here (JSON: `card`, `want`, `category`, `origin` {file, line}, `role`, `confidence`, `uncertain`, optional `decisionId`, `cause`); plan 071's validator and agent produce exactly this shape.
- Categories: fix in the current plan, design rule, wording change, reverses a decision, new request, correct choice, no action. Only `reverses a decision` becomes `✗`; `correct choice` becomes `choice-ok`.
- Lessons keep the existing cap and de-duplication in `addLesson`; 066's counting applies to them.
- Backend / API: none. Auth and validation: none. Security surface: none. Data / migration: none (new file `docs/brain/agent-lessons/triage.md` is created on first lesson). Model changes: none. Project checks: none.

## Out of Scope
- Sorting raw notes into a table (071). Design rules and `--ui-elements` (072). The quick-fix lane and delta cards (073).
- Any change to the card layout beyond accepting the new reply.
- Merging a run branch.

## Critical Questions
- Q: How are ids kept unique? A: later calls continue after the highest stored id (the same rule 057 uses for `pending`), so ids never repeat within a run.
- Q: What id does a graded item with no decision get? A: `N<round>-<n>`, stored with `kind: "choice"`.

## Execution Notes
