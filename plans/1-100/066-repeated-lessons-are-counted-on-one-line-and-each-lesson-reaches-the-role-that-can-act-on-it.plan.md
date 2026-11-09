# Plan 066 — Repeated lessons are counted on one line and each lesson reaches the role that can act on it

Status: abandoned — parked under the freeze: new work with no failure shown today; re-plan after the freeze if still wanted; closed 2026-11-09
Parked: 2026-11-05 — reliability freeze, revisit 2026-11-15
Depends-on: 065
Snapshot: 9909c12f1572d8e1e0a4aa133ab2b362c468c1ee
Source: first orchestrator test run (test-512-422) follow-up; Human decision "approve: code facts only" (2026-11-02)

## Problem Statement

1. **A repeat is invisible.** `addLesson` (`core/scripts/decision-log.mjs:207-218`) adds nothing when the same lesson text is
   already in the file, so a fact seen in five runs looks identical to one seen once; and with the cap (`LESSON_LINES = 40`,
   `LESSON_CHARS = 3000`, :58-59) the oldest line goes first, so a lesson that keeps coming back can be dropped before a one-off
   from yesterday.
2. **Routing is incomplete.** The builder gets `LESSONS` (`orchestrate.js:651`) but no `RULES`: the `builder` section of
   `docs/brain/agent-rules.md` exists (`RULE_SECTIONS` includes it, `decision-log.mjs:52`) but `rulesIn` (`orch-state.mjs:~598-601`)
   returns only `checkers`, `readiness`, `ui`, `RULES_GROUP` (`orch-run.mjs:453`) has no builder entry, and `orch-builder.md:17`
   mentions only `LESSONS`. Readiness gets nothing about what it had to ask. The planner file is read by `/plan`
   (`core/.claude/commands/plan.md:52-53`), not injected.

## Goals & Success Criteria
**Primary:** a lesson fact seen again is counted on its one line, the cap drops the least-seen first, and each role reads the
lessons it can act on (builder: fix-round causes, parks and RULES; readiness: asked-about facts in code-made form; finders: 064's
final-gate routing; planner: its own lines for `/plan`).

- [auto] Lesson line shape `- <first date> <run> · seen in N runs, last <date>: <fact>`, updated in place when the same fact comes
  again in a later run (N + 1, `last` = that date), never duplicated. The key is the fact text. A second `lessons`/`finish` call
  for the same run changes nothing (the run name is remembered per line or the count is keyed by run). Test in
  `tools/test/orchestrator.test.mjs` (or the decision-log test file): same fact over three runs gives one line with `seen in 3 runs`;
  the same run written twice leaves the file byte-for-byte unchanged.
- [auto] Legacy lines without a count (`- <date> <run>: <fact>`) read as seen once and are rewritten into the new shape the first time
  the same fact comes again. Test: a legacy file plus the same fact gives `seen in 2 runs`.
- [auto] Cap order: when the file passes 40 lines or 3000 characters, lines are dropped least-seen first, then oldest `last` date first;
  the line just added or updated is never the one dropped. Test: a full file with mixed counts drops the count-1 lines first, in
  date order, then count-2 lines.
- [auto] Routing per role, asserted on `lessonFacts` output and on the `context` answer: the builder gets fix-round causes and parks;
  readiness gets no asked-about line (065 stores no code-made question fact, so no route is built — the test asserts readiness
  gets none from a status with `asked` entries); finders keep 064's `FINAL_GATE_ROLES` lines; the planner keeps its own lines in `planner.md`, which
  is not injected. Test: one case per role.
- [auto] The builder receives `RULES`: `rulesIn` returns a `builder` group, `RULES_GROUP` gains `builder`, `orchestrate.js` passes
  `RULES: rulesOf('builder')` in the builder task (:651), and `orch-builder.md` tells the builder to read it as data. Test: the
  builder task text holds the `RULES` line list from a fixture `agent-rules.md`; an empty section gives `[]`.
- [auto] `context` still reports the lesson budget (`orch-state.mjs:1170-1181`); a counted line is not longer than the cap allows.
  Test: `chars` and `line` from `context` for a file with counted lines.
- [auto] `npm run build`, `npm run lint`, `npm test`, `node --test "tools/test/*.test.mjs"`, `node tools/orchestrator-e2e.mjs` and
  `node tools/drift-check.mjs --target .` all exit 0.
- [auto] `node scripts/scope-check.mjs --tests --plan=plans/066-repeated-lessons-are-counted-on-one-line-and-each-lesson-reaches-the-role-that-can-act-on-it.plan.md`
  prints `SCOPE_TESTS: ok`, and `node scripts/scope-check.mjs --diff=origin/main` on the finished branch prints `SCOPE: ok`.
- [human] After two real FoodVibe runs that hit the same problem, open one file in `docs/brain/agent-lessons/` on the run branch: a
  line reads `seen in 2 runs, last <date>: …`.

## Execution Mode
- Parallel: no
- Concurrent plans: shares `decision-log.mjs`, `orch-state.mjs`, `orch-run.mjs`, `orchestrate.js` and
  `tools/test/orchestrator.test.mjs` with 065; built after 065.
- Isolated DB: no

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/scripts/decision-log.mjs
core/scripts/orch-state.mjs
core/scripts/lib/orch-run.mjs
core/.claude/workflows/orchestrate.js
core/.claude/agents/orch-builder.md
core/docs/agent/orchestrator.md
tools/test/orchestrator.test.mjs
tools/test/decision-log.test.mjs
tools/lib/kit-learn/**
tools/test/kit-learn.test.mjs
scripts/**
.claude/**
docs/agent/**
docs/brain/**
.kit/install.json
CHANGELOG.md
```

`scripts/**`, `.claude/**`, `docs/agent/**`, `docs/brain/**` and `.kit/install.json` are rendered copies, written only by
`node tools/sync.mjs --target . --apply`.

## Read Scope

Entire repo and its git history.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry.

## Architecture Impact
- INV-none: preserves — lesson file format, caps and which roles read which lines change; lesson files are still written only by
  script, only on the run branch, with no agent-written text. No registered invariant in `docs/brain/invariants.md` is touched
  (INV-1 is the only one). This plan does not touch judgment-model routing: the tier table and escalation are unchanged; only
  which lesson and rule lines a role reads changes.

## Step 0 — Reality Check

1. Runs only when `scripts/scope-check.mjs --drift` reports `REALITY: drift`: check the listed commits by symbol, print `ok` or
   `conflict: <what>` per commit; stop for a go only on a conflict.
2. Plan 065 is merged (it changes the line texts this plan counts); otherwise stop.
3. Read `addLesson`/`lessonOf`/`lessonSize` (`decision-log.mjs:195-218`), `learnRun` (`orch-state.mjs:610-631`), `lessonsIn`
   (:545), `context` (:1170-1181), `rulesIn` (:~598), `kitLessonsIn`, and every reader of the line shape (`lessonOf` regex,
   `lessonParts`, `lessonSize`, the kit-learn upkeep that reads lesson files, `tools/lib/kit-learn/upkeep.mjs`).
4. List every place that parses a lesson line (grep `lessonOf`, `agent-lessons`) so the new shape breaks none; print the list.
5. Key the repeat count on stable facts only: command kind + file path, the park-reason prefix, an `INV-n` id. Never a finding
   id — ids are positional per call (`<lens>-<n>`, `gate-<n>`, `scope-<n>`, `ui-<n>`, `orchestrate.js:715, 758, 776, 853, 884`),
   so `bugs-1` in two runs names unrelated findings. A 065 line may still show the id for reading; the key drops it. Test: the
   same file + kind with different ids counts as one line; the same id on different files stays two lines.
6. `node tools/install-check.mjs` and `node --test "tools/test/*.test.mjs"` pass before any edit.

## User Stories
- As the Human, I want to see that a problem came back in several runs, on one line.
- As a builder, I want the rules written for my role as well as the lessons.

## Functional Requirements

### Must Have (P0)
- [ ] Counted lesson lines, in-place update, legacy lines read as seen once.
- [ ] Cap drops least-seen first, then oldest.
- [ ] Builder `RULES` (`rulesIn`, `RULES_GROUP`, builder task, `orch-builder.md`).
- [ ] Readiness gets no asked-about line until a code-made question fact exists; no route is built for it now.
- [ ] `orchestrator.md` (lesson format and routing table) and a CHANGELOG entry.

### Should Have (P1)
- [ ] The run report's learning block shows how many lines were updated rather than added.

### Nice to Have (P2)
- None.

## UI/UX Notes
None (scripts and docs only).

## Atomic Sub-tasks

Every step names its own test location.

- [ ] A1: Failing tests first — a repeated fact stays a single uncounted line and the oldest line is dropped first — Step 0 findings to Execution Notes — `tools/test/orchestrator.test.mjs`, `tools/test/decision-log.test.mjs`
- [ ] B1: Count a repeated lesson in place and read old lines as seen once — `core/scripts/decision-log.mjs`, `core/scripts/orch-state.mjs`, `tools/test/orchestrator.test.mjs`
- [ ] B2: Drop the least-seen line first when the lesson file is over its cap — `core/scripts/decision-log.mjs`, `tools/test/decision-log.test.mjs`
- [ ] B3: Give the builder its rules section and read it as data — `core/scripts/orch-state.mjs`, `core/scripts/lib/orch-run.mjs`, `core/.claude/workflows/orchestrate.js`, `core/.claude/agents/orch-builder.md`, `tools/test/orchestrator.test.mjs`
- [ ] B4: Route each fact to the role that can act on it and prove it per role — `core/scripts/lib/orch-run.mjs`, `core/scripts/orch-state.mjs`, `tools/test/orchestrator.test.mjs`
- [ ] D1: Document the line format, the cap order and the routing table — `core/docs/agent/orchestrator.md`
- [ ] R1: Render the installed copies, run every check, add the changelog entry — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .`, build, lint, `npm test`, `node --test "tools/test/*.test.mjs"`, `node tools/orchestrator-e2e.mjs`
  - Scope: `scripts/**`, `.claude/**`, `docs/agent/**`, `docs/brain/**`, `.kit/install.json`, `CHANGELOG.md`

## Technical Considerations
- **Key = the fact text** (the part after the prefix); `addLesson`'s `dedupe` RegExp (`has`, `orch-run.mjs:536`) keeps working for the
  one template that carries counts (`N of M candidates refuted`); its count stays inside the fact, so the key for it is the `has` match.
- **Idempotence per run:** `finish` and `lessons` can both run for one run (`orch-state.mjs:1062`, `:994`); the in-place count must not
  go up twice for the same run. Keep the last run name on the line (`first run` is in the prefix; store `last run` too, or compare
  `last` date plus run in a hidden suffix) — decided in Step 0.
- **Size:** the new prefix is about 30 characters longer than the old one; the 3000-char cap still holds, and `lessonSize`
  (`decision-log.mjs:195`) measures the new lines.
- **Rules for the builder:** `rulesIn` is read by `context` and by `learnRun`'s budget (`orch-state.mjs:629`), so adding a group
  changes the budget line; the test pins it.
- **Readiness asked-about:** the question title is agent text (065 records that no code-made kind exists), so this plan routes
  asked-about facts to readiness only when 065 stores one; with none stored, readiness gets nothing from this path.

## Out of Scope
- Sending counts to the kit brain and kit lessons (plan 067).
- A filtered copy of agent text (park reason, readiness question title) is a possible later plan, not part of this one.
- Changing the rule at `orch-run.mjs:477-479`.
- Changing the 40-line / 3000-char / 2000-char caps.

## Critical Questions
- None open. Assumed (change on a no): `planner.md` lines are counted the same way and stay uninjected; the builder's RULES are the
  `## builder` section of `docs/brain/agent-rules.md` as is.

## Execution Notes
- Source: Human decisions of 2026-11-02 (routing; counting). Facts from the kit at `origin/main` `9909c12` (v2.0.0).
- Build order: 065, then 066, then 067.
- Architect + PM review (Planner, 2026-11-02): no duplicate of 030/046/047/048. Changed from the draft: readiness gets no asked-about
  route (it would be dead code with no code-made fact to carry); scope adds `tools/lib/kit-learn/**` and
  `tools/test/kit-learn.test.mjs`, because kit-learn's upkeep reads lesson files and the new line shape must not break it.
