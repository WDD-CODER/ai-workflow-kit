# Plan 082 — A solo plan shipped with /ship sends its run record to the kit brain, like an orchestrator run

Status: abandoned — obsolete: /ship brain capture now sits behind review.learn (default off) since plan 089; closed 2026-11-09
Parked: 2026-11-05 — reliability freeze, revisit 2026-11-15
Depends-on: 075
Snapshot: b075db1e9c4876d4f210c95612df2e2a406a160a

## Problem Statement

The kit brain learns only from orchestrator runs. `brain.mjs send --run <name>` builds its `runs`, `plans` and `events`
documents from a run's `status.json` (`core/scripts/brain.mjs:67-91`, `runItems()`; `core/scripts/lib/brain-doc.mjs:226-265`).
A Worker plan shipped with `/ship` has no `status.json`, so the brain receives only its grade rows (plan 057 grades
every shown decision under the run name `ship-<NNN>` and `decision-log.mjs grade` sends them;
`core/.claude/commands/ship.md:178`). The facts plan 057 writes per review — the review mode, findings kept and dropped,
re-checks, minutes and models (`- review: …` line, `core/docs/agent/ship-regular.md:55-66`) — stay in the plan file.

So `/kit-learn` and `tools/kit-learn.mjs trend` see none of the solo work, which is most of what the Human ships, and
cannot compare the checker review with the light one. This was stage 2 of the learning-loop decision of 2026-11-02
("a run record for solo plans sent to the brain"), held until a real FoodVibe orchestrator run and a `brain-query`
check had happened. Run test-514-515 has happened since.

## Goals & Success Criteria

**Primary:** after `/ship` of a Worker plan, the brain holds one `runs` document and one `plans` document for it with
`kind: "solo"`, built by script from the plan file, with no model call and no new step for the Human.

- [auto] `node --test tools/test/brain.test.mjs` passes, with tests that fail on today's code:
  (a) `node scripts/brain.mjs digest --ship <NNN>` prints a `runs` document (`run: "ship-<NNN>"`, `kind: "solo"`,
  `plans: 1`, kit version and commit) and a `plans` document with the plan's last `- review:` line parsed into
  `review: { mode, kept, dropped, rechecked, minutes, models }`, the count of `- decision:` lines, and how many of them
  carry a `[graded …]` tag;
  (b) a plan with no `- review:` line gives `review: null`, never an error;
  (c) `send --ship <NNN>` twice stores the documents once (stable `_id`), and with no `KIT_BRAIN_URI` the line is
  `BRAIN: queued <n> (KIT_BRAIN_URI not set)` and the exit code is 0.
- [auto] The rendered `ship.md` "On approval" step runs `node scripts/brain.mjs send --ship <NNN>` after the grade step
  on a plan branch, and says nothing waits for it (a test reads it).
- [auto] `node --test tools/test/kit-learn.test.mjs` passes with tests that `tools/brain-query.mjs runs` shows a
  `kind` column (`solo` or `orchestrator`), and that `trendRows()` (`tools/brain-query.mjs:28`, also used by
  `tools/lib/kit-learn/trend.mjs:5`) keeps solo runs out of `parked/run`, `fix rounds/plan` and `min/plan` and counts them
  in their own `solo plans` column, so `kit-learn.mjs trend` is not skewed.
- [auto] `npm run build`, `npm run lint` and `node --test "tools/test/*.test.mjs"` pass.
- [auto] `node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .` reports no drift.
- [human] After the next `/ship` of a FoodVibe Worker plan, `node tools/brain-query.mjs runs --last 3` in the kit lists
  it as `solo` with its review minutes.

## Execution Mode
- Parallel: yes.
- Concurrent plans: plans 076, 077 and 067 also edit `brain.mjs` and `brain-doc.mjs`; each adds its own option, so the
  merge is additive.
- Isolated DB: no.

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/scripts/brain.mjs
scripts/brain.mjs
core/scripts/lib/brain-doc.mjs
scripts/lib/brain-doc.mjs
core/.claude/commands/ship.md
.claude/commands/ship.md
core/docs/agent/kit-brain.md
docs/agent/kit-brain.md
tools/brain-query.mjs
tools/test/brain.test.mjs
tools/test/kit-learn.test.mjs
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
- INV-none: preserves — new brain documents from a plan file; no invariant's `Touches` glob is in scope.

## Step 0 — Reality Check

1. Runs only when `scope-check.mjs --drift` reports `REALITY: drift`: check the listed commits by symbol and print `ok`
   or `conflict: <what>` per commit; stop for a go only on a conflict.
2. Always: confirm the `- review:` line shape in the rendered `ship-regular.md` and the `ship-<NNN>` run name in
   `ship.md`; a different shape on `main` is followed and written into Execution Notes.

## User Stories
- As the Human, I want the kit to learn from the plans I ship by hand, not only from orchestrator runs.
- As the Human, I want to compare the checker review with the light one on time and findings, from real ships.

## Functional Requirements

### Must Have (P0)
- [ ] `digest|send --ship <NNN>` with the solo run and plan documents.
- [ ] `/ship` sends them after the grade step.

### Should Have (P1)
- [ ] `brain-query` shows the kind and the trend counts solo plans apart.

### Nice to Have (P2)
- Eval cases from defects found after a review: already covered by plan 048 (`agent-eval-cases.mjs from-fix`).

## UI/UX Notes
- Terminal text only: the usual `BRAIN:` line.

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [ ] S1: Build a solo run's brain documents from the plan file alone — `shipDocs()` parsing the last review line, decision and graded counts, plus `brain.mjs digest|send --ship` — core/scripts/lib/brain-doc.mjs, core/scripts/brain.mjs, tools/test/brain.test.mjs
- [ ] S2: Send them from /ship after the grade step, so no solo plan is missed — one line in the On approval step, one row in the kit-brain command table — core/.claude/commands/ship.md, core/docs/agent/kit-brain.md
- [ ] S3: Show solo plans apart from orchestrator runs when the kit reads the brain, so the trend is not skewed — a kind column in runs; trendRows keeps solo runs in their own column — tools/brain-query.mjs, tools/test/kit-learn.test.mjs
- [ ] R1: Render the kit's own installed copies, check drift and add a changelog line — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .` — scripts/**, .claude/**, docs/agent/**, CHANGELOG.md

## Technical Considerations
- Dependencies: plan 057 (built and released in v2.0.0: the `ship-<NNN>` run name and the review fact line).
- New files: none.
- Model changes: `runs` and `plans` documents gain `kind` (`solo` | `orchestrator`; a missing `kind` reads as
  `orchestrator`).
- Backend / API: none. Auth and validation: none.
- Security surface: plan text is not sent; only counts, the review mode and model names, all through `redact()`.
- Data / migration: none in the project; the brain gets new documents in existing collections, so the database roles
  do not change.

## Out of Scope
- Eval cases from post-review misses (plan 048 grows cases from fix commits).
- Token counts for a solo ship (the runtime does not expose them cheaply, as plan 057 found).

## Critical Questions
- Q: Wait for a `brain-query` check by the Human before building? A: no; the signature-collision check is the Human's
  separate step (`node tools/brain-query.mjs events` in the kit) and does not change this plan (recommended).

## Execution Notes
- Source: chat "לולאת הלמידה והאורקסטרטור" (2026-11-02) and the project doc
  `claude/decision-2026-11-02-learning-loop-in-ship.md`, "Stage 2 later".
- Review (Architect + PM, a separate agent against b075db1, 2026-11-03): mechanical gaps fixed in the draft (line references, scope and Depends-on, test names); open points answered with the recommended default in Critical Questions. The Planner's own review is still to run.
