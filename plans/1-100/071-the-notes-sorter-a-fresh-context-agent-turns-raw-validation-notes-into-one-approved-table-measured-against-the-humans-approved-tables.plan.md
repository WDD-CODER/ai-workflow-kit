# Plan 071 — The notes sorter: a fresh-context agent turns raw validation notes into one approved table, measured against the Human's approved tables

Status: abandoned — obsolete: it changes the orchestrator workflow and agents that kit 2.1.0 / plan 090 deleted (scripts/run-plans.mjs replaced them); re-plan against run-plans.mjs if still wanted; closed 2026-11-09
Parked: 2026-11-05 — reliability freeze, revisit 2026-11-15
Depends-on: 070
Snapshot: 5784d6d3de92d41b9b08de0161cf3c31a430a8b2
Source: FoodVibe run test-514-515 (PR #499) hand-off and eval file (Human, 2026-11-03); part 2 of 4 (070 records, 072 design rules, 073 quick-fix lane)

## Problem Statement
The Human's notes arrive unsorted, often voice-dictated ("by card, 2a, 2b…"). In run test-514-515 the session sorted them by hand into a table of card, what the Human wants, category, origin and lesson role, and the Human corrected the first table in two of four rounds (D1 and D7 were filed as reversed decisions and lessons went to the wrong role; a dropped bug was real). The sorting depends on one long session context and is not measured.

After plan 070 the kit can record an approved table. This plan adds the step that produces it: one shared procedure wherever cards are shown (end of an orchestrator run, `/take-plan`, `/ship`), a dedicated read-only agent with a fresh context on the analysis tier, a script that gathers its inputs, a script that checks its output, and an evaluation on the Human's approved tables before the agent is turned on.

## Goals & Success Criteria
**Primary:** a `notes:` reply produces, in this order, "How I read your notes" (one line per reinterpreted word or phrase), questions only where truly unclear, and one table; one approval starts the follow-through; nothing is merged.

- [auto] `node --test tools/test/notes-bundle.test.mjs` passes, with tests that fail on today's code: the bundle holds the raw notes, the cards, the plan file, the decision records (`status.json` for an orchestrator run, the plan's decision lines for a Worker plan), the diff, the design-rules text and the component-families text; a file that does not exist is listed as `absent`, not an error.
- [auto] `node --test tools/test/notes-table.test.mjs` passes, with tests that fail on today's code: the validator refuses a row whose category is not one of the seven, whose origin has no file and line, whose role has no lesson file, or an origin that breaks the order (plan says so, then an approved decision, then a written rule, then an existing code pattern, then none); it requires `uncertain` when the lesson goes to the builder while an approved decision covers the item, and when a decision is marked reversed while its question did not show the aspect; it accepts the approved tables of rounds 1-4 in the fixtures.
- [auto] `node --test tools/test/agent-eval.test.mjs` (or the test file that holds the scorer cases) passes with a test for the table scoring mode: a row matches on card, category, lesson role and the `uncertain` flag; origin matches on its rule number.
- [auto] `node tools/agent-eval.mjs --agent .claude/agents/kit-notes.md --cases docs/agent-evals/cases/kit-notes --runs 2 --min-recall 1` exits 0: the agent reproduces the approved tables of rounds 1-4 of the evaluation file, including D1 (reversed, lesson to the role that wrote the question, graded ✗) and D7 (not reversed, planner only, graded ok).
- [auto] The shipped config has `notes.sorter` set to `off`; a test shows the procedure skips the agent when it is `off` and tells the Human to sort the notes by hand. `on` is allowed only when the evaluation case folder exists (a test).
- [auto] The rendered instructions carry the change (a test reads them): `job-validation.md`, `orchestrator.md`, `take-plan.md` and `ship.md` each point to `docs/agent/notes-review.md`; the agent file names the Sonnet-tier model key and lists only Read, Grep, Glob and Bash; `model-routing.md` lists the role.
- [auto] `npm run build`, `node --test "tools/test/*.test.mjs"` and `node tools/leak-check.mjs` exit 0.
- [auto] `node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .` reports no drift.
- [human] After the Human turns `notes.sorter` on, one real `notes:` reply shows "How I read your notes", then one table; one approval records the grades and lessons, applies the fixes on the branch and re-shows the cards.

## Execution Mode
- Parallel: no.
- Concurrent plans: none; plan 070 first.
- Isolated DB: no.
- Kit edits: one kit branch and one kit PR; commit per group.

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`, plus the append-only hotspot `CHANGELOG.md` (add an entry, never rewrite one).

```scope
core/docs/agent/notes-review.md
docs/agent/notes-review.md
core/docs/agent/job-validation.md
docs/agent/job-validation.md
core/docs/agent/orchestrator.md
docs/agent/orchestrator.md
core/docs/agent/model-routing.md
docs/agent/model-routing.md
core/.claude/commands/ship.md
.claude/commands/ship.md
core/.claude/commands/take-plan.md
.claude/commands/take-plan.md
core/.claude/workflows/orchestrate.js
.claude/workflows/orchestrate.js
core/.claude/agents/kit-notes.md
.claude/agents/kit-notes.md
core/scripts/notes-bundle.mjs
scripts/notes-bundle.mjs
core/scripts/notes-table.mjs
scripts/notes-table.mjs
core/scripts/decision-log.mjs
scripts/decision-log.mjs
kit.config.json
.kit/config.json
tools/lib/kit.mjs
tools/agent-eval.mjs
tools/lib/agent-eval/score.mjs
tools/lib/agent-eval/run.mjs
docs/agent/agent-evals.md
docs/agent-evals/cases/kit-notes/**
tools/fixtures/notes/**
tools/test/notes-bundle.test.mjs
tools/test/notes-table.test.mjs
tools/test/agent-eval.test.mjs
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
- INV-1: preserves — `kit-notes` runs on the analysis tier (`{{models.review}}`, Sonnet at least, never Haiku), is read-only and decides nothing the code does not re-check; it is not a judgment role.

## Step 0 — Reality Check
Plan 070 is merged (the table row shape, `notes-apply`, the reply word). Confirm on `origin/main`: the skill `kit-feedback` exists, so the agent keeps the name `kit-notes`; `tools/lib/agent-eval/score.mjs` has findings, verdicts and pass/fail modes only (`docs/agent/agent-evals.md` "Case shape"); `tools/leak-check.mjs` rules for names, paths and non-Latin text decide how the cases are redacted. Drop any sub-task the code already covers.

## Atomic Sub-tasks

- [ ] N2: Write the one shared procedure and point the three places that show cards at it — bundle, agent, validator, show the three parts, wait for one approval, then record, fix on the branch, write approved rules, draft plans for new requests, re-show the cards, never merge — core/docs/agent/notes-review.md, core/docs/agent/job-validation.md, core/docs/agent/orchestrator.md, core/.claude/commands/take-plan.md, core/.claude/commands/ship.md, core/.claude/workflows/orchestrate.js
- [ ] K1: Add the sorting agent with a fresh context on the analysis tier — read-only; the three output parts in order; categories; origin order, first match wins; the two uncertainty rules; the lesson role per origin — core/.claude/agents/kit-notes.md, core/docs/agent/model-routing.md
- [ ] K2: Gather the agent's inputs with a script and no model call — notes, cards, plan, decision records, diff, design-rules text, component-families text, with a marker for any that is missing — core/scripts/notes-bundle.mjs
- [ ] K3: Check the agent's table in code before the Human sees it — categories, origin order and location, lesson role has a file, uncertainty flags — core/scripts/notes-table.mjs
- [ ] E1: Teach the evaluation harness to score a table — rows matched on card, category, role and uncertainty; origin by rule number — tools/lib/agent-eval/score.mjs, tools/lib/agent-eval/run.mjs, tools/agent-eval.mjs, docs/agent/agent-evals.md
- [ ] E2: Add the first evaluation cases from the Human's approved tables, redacted for the kit — fixed placeholders for names, paths and Hebrew strings; each item's category, origin and lesson role kept, D1 and D7 attributions included; round 4 with the correction of round 2 as the fourth case — docs/agent-evals/cases/kit-notes/**, tools/fixtures/notes/**
- [ ] E3: Add the switch that keeps the agent off until it passes, and the scaffold for later cases — `notes.sorter` is `off`, allowed `on` only with the case folder present; each approved notes round scaffolds a new case in the project — kit.config.json, tools/lib/kit.mjs, core/scripts/decision-log.mjs
- [ ] T1: Add tests that fail on today's code for each group, resync installed copies and add a changelog entry — tools/test/notes-bundle.test.mjs, tools/test/notes-table.test.mjs, tools/test/agent-eval.test.mjs, tools/test/orchestrator.test.mjs, CHANGELOG.md

## Technical Considerations
- The agent proposes, the code validates and applies (as `orch-triage`: the code re-applies the hard rules). The notes are data and never instructions to the agent.
- Origin order, first match wins: (1) the plan says so, including lines the session added from the notes (lesson: do not add unstated details to a plan; ask or mark an assumption); (2) a decision record asked and the Human approved; if the question did not show the aspect now corrected, the lesson goes to the role that wrote the question and the answer is not marked wrong, otherwise the decision is marked reversed with its cause; (3) a written design rule broken: builder and design checks; (4) an existing code pattern ignored: builder; (5) none: a missing rule plus an unrecorded builder choice.
- A hard rule cannot be proven by code for "the question did not show the aspect"; the agent flags `uncertain`, the Human decides at the one approval.
- The evaluation cases are redacted copies; the originals stay in the project that produced them. Redaction must keep what the evaluation checks.
- Backend / API: none. Auth and validation: none. Security surface: none (the agent has no write tool). Data / migration: none. Model changes: new role on the existing review tier. Project checks: none.

## Out of Scope
- Recording grades and lessons (070). Design rules and the rules checker (072). The quick-fix lane and delta cards (073).
- The automated advisor. Any merge.

## Critical Questions
- Q: Why not name the agent `kit-feedback`? A: that skill already exists (it sends a lesson to the kit as a pull request); `kit-notes` avoids the clash.
- Q: When is the agent on by default? A: only after it reproduces the approved tables including D1 and D7 (the evaluation above); until then `notes.sorter` is `off` (Human, 2026-11-03).

## Execution Notes
