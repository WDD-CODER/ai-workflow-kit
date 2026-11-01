# Plan 024 — Validation speed-ups backlog: fewer and cheaper cards

Status: draft
Depends-on: none
Snapshot: 58be2737fde3c24035edc61c85c46798956a6bb0

> POINTER LIST — split on 2026-11-01. This file is no longer executed: each idea that was ready became its own plan,
> and the one that was not stays here as a backlog entry. Nothing below is for a Worker to take.

## Problem Statement
Plans 022 and 023 made a hand-off easier to read and answer. The Human still spends most of the time on how many cards
reach them (the last FoodVibe run left 127). Ideas for shrinking that were collected here; five became plans.

## Goals & Success Criteria
**Primary:** each idea lives in exactly one place — its own plan, or a backlog line below.

- [auto] `node scripts/scope-check.mjs --tags --plan=plans/024-validation-speed-ups-backlog-fewer-and-cheaper-cards.plan.md` prints `DONE_WHEN_TAGS: ok`.
- [human] Dandan confirms the split below matches what was decided on 2026-11-01.

## Split into plans (run in this order, each after the one before)

| Idea | Plan | Depends-on |
| --- | --- | --- |
| C1 glance group for cards a script passed | 050 | 049 (last plan of the current wave) |
| C2 merge cards that repeat a check on several pages | 051 | 050 |
| C4 skip cards for untouched areas, list them on one line | 052 | 051 |
| C6 plain-text card layout for the end-of-run list | 053 | 052 |
| C5 reproduce a reported failure with a short test, 2 fix attempts at most | 054 | 053 |

## Backlog (no plan yet)

- C3: Learn from past runs which card types always pass and which fail often — record the outcome of each answered card,
  suggest promoting a type to `[ui]` or `[auto]` after it passed in 3 runs, list often-failing types first. Not planned
  now: rebuild it on the kit brain (plans 045 and 046) and the grade log from plan 041 once those are merged.

## Execution Mode
- Parallel: no.
- Concurrent plans: none.
- Isolated DB: no.

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`.

```scope
plans/024-validation-speed-ups-backlog-fewer-and-cheaper-cards.plan.md
```

## Read Scope

Entire repo.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry.

## Architecture Impact
- INV-none: preserves — this file only records where the ideas went.

## Atomic Sub-tasks

- [x] Z1: Split the backlog into one plan per ready idea and keep the unready one as a backlog line — plans/024-validation-speed-ups-backlog-fewer-and-cheaper-cards.plan.md

## Out of Scope
- Executing any idea from this file.

## Critical Questions
- Q: Which ideas first? A: C1, C2, C4, C6, C5 (Human, 2026-11-01).
- Q: Passed runs before C3 suggests a promotion? A: 3 (when C3 is planned).
- Q: C4 silent or listed? A: listed on one line.

## Execution Notes
- 2026-11-01: split by the Planner after the Architect + PM review; plans 050–054 saved.
