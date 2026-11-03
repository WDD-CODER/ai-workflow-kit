# Plan 076 — Every readiness question carries a kind and a default, and every answer is recorded by script

Status: draft
Depends-on: 065, 075
Snapshot: b075db1e9c4876d4f210c95612df2e2a406a160a

## Problem Statement

Before a run, `orch-readiness` asks the Human all open questions in one batch, and the Planner writes each answer into
the plan's `## Execution Notes` as `Orchestrator readiness (<date>): <question> → <answer>` (`(delegated)` when the
Human said "decide yourself"; `.claude/commands/orchestrate.md` step 2). That text is the only record:

1. A question has no kind. The schema keeps `questions` as a plain string list (`core/.claude/workflows/orchestrate.js:166`),
   so nothing can count answers per kind. Run 065's readiness noted the same gap: "no code-made kind exists → no asked-about
   line is written for planner or readiness" (plan 065 Execution Notes, 2026-11-03).
2. The default is free text inside the question (`Default if unanswered: …`, `core/.claude/agents/orch-readiness.md:25-59`),
   so nothing can tell whether the Human took the default or chose otherwise.
3. The run keeps at most 3 asked questions per plan as one joined fact (`orchestrate.js:932-938`, `queueFact(nnn, 'asked', …)`),
   without the answer, and the kit brain never receives questions or answers (`core/scripts/lib/brain-doc.mjs` has no
   such document).

The Human decided on 2026-11-01 to keep answering every question himself for now and to start collecting a structured
log of questions and answers, so that after about a month the data shows which kinds of question an advisor agent could
answer. Without kinds, defaults and recorded answers there is nothing to measure. Grading whether an answer was right
later is plan 077.

## Goals & Success Criteria

**Primary:** every readiness question has a kind and a default a script can read, and after the Human answers, one row
per question (run, plan, kind, question, default, answer, delegated, took-default) is stored in the project and sent to
the kit brain, with no model call.

- [auto] `node --test tools/test/readiness-answers.test.mjs` passes, with tests that fail on today's code:
  (a) `parseQuestion("<plan>: [product] what happens on cancel? Default if unanswered: close without saving")` returns
  `{ plan, kind: "product", text, default: "close without saving" }`; a question with no `[kind]` gets `kind: "other"`;
  a question with no `Default if unanswered:` gets `default: null`;
  (b) `node scripts/decision-log.mjs readiness --run <run> --plans 101,102` reads the plans' `Orchestrator readiness
  (<date>, <run>): <question> → <answer>` lines of that run only (lines of other runs and old lines without a run name
  are ignored) and appends one row per line to `docs/brain/readiness-answers.jsonl`, each with a stable
  `id: "<run>-<plan>-<n>"` (n = the line's order in that plan for that run), with
  `delegated: true` for an answer ending `(delegated)` and `tookDefault: true` when the answer equals the question's
  default (whitespace and case ignored); it prints `READINESS: recorded <n>`;
  (c) a second call for the same run adds nothing (`READINESS: recorded 0`), and a plan with no such line adds nothing;
  (d) a line whose question carries no kind is stored with `kind: "other"`, never refused.
- [auto] `node --test tools/test/brain.test.mjs` passes, with a test that fails on today's code: `node scripts/brain.mjs
  digest --answers --run <run>` reads only `docs/brain/readiness-answers.jsonl` (no `status.json` needed; today `digest`
  exits 1 without one, `brain.mjs:206-210`) and prints one `events` document per row of that run with
  `kind: "readiness-answer"`, the question and answer passed through `redact()`, and a stable `_id` built from the row
  `id` (a second send is a no-op in the store).
- [auto] `node --test tools/test/orchestrator.test.mjs` passes, with a test that the rendered `orch-readiness.md`
  tells the agent to start every question with one of the kinds `[product]`, `[scope]`, `[design]`, `[data]`, `[arch]`,
  `[env]`, `[run]`, `[claim]`, `[check]`, and to end it with `Default if unanswered: <default>`.
- [auto] The rendered `orchestrate.md` step 2 writes each answer as `Orchestrator readiness (<date>, <run>): <question
  exactly as readiness returned it, kind tag and default included> → <answer>`, and says that after the answers are
  committed the Planner runs
  `node scripts/decision-log.mjs readiness --run <run> --plans <NNN,…>` and then `node scripts/brain.mjs send --answers
  --run <run>` (a test reads it).
- [auto] `npm run build`, `npm run lint` and `node --test "tools/test/*.test.mjs"` pass.
- [auto] `node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .` reports no drift.
- [human] After the next real orchestrator run with readiness questions, `docs/brain/readiness-answers.jsonl` in the
  project holds one row per question the Human answered, with the right kind and the delegated flag.

## Execution Mode
- Parallel: no.
- Concurrent plans: plan 065 is running now (Depends-on: 065). Plans 060 and 074 (S3, a test-location question) also
  add readiness items to `orch-readiness.md`, and 079 adds one more; whichever merges later keeps every item. Plans 067
  and 082 also edit `brain.mjs` / `brain-doc.mjs`; each adds its own option, so the merges are additive. Plan 075 first,
  so the full test set is green.
- Isolated DB: no.

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/scripts/lib/readiness-question.mjs
scripts/lib/readiness-question.mjs
core/scripts/decision-log.mjs
scripts/decision-log.mjs
core/scripts/brain.mjs
scripts/brain.mjs
core/scripts/lib/brain-doc.mjs
scripts/lib/brain-doc.mjs
core/.claude/agents/orch-readiness.md
.claude/agents/orch-readiness.md
core/.claude/commands/orchestrate.md
.claude/commands/orchestrate.md
core/docs/agent/kit-brain.md
docs/agent/kit-brain.md
.kit/install.json
tools/test/readiness-answers.test.mjs
tools/test/brain.test.mjs
tools/test/orchestrator.test.mjs
CHANGELOG.md
```

`scripts/**`, `.claude/**`, `docs/agent/**` and `.kit/install.json` are the rendered copies, written only by
`node tools/sync.mjs --target . --apply` (R1).

## Read Scope

Entire repo and its git history.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry.

## Architecture Impact
- INV-1: preserves — `orch-readiness.md` changes only the wording of its questions (a kind tag in front, the default at
  the end); its model key and tier are not touched.

## Step 0 — Reality Check

1. Runs only when `scope-check.mjs --drift` reports `REALITY: drift`: check the listed commits by symbol and print `ok`
   or `conflict: <what>` per commit; stop for a go only on a conflict.
2. Always: `git log --oneline -5 -- core/.claude/agents/orch-readiness.md core/.claude/commands/orchestrate.md` and
   `grep -n "Orchestrator readiness" core/.claude/commands/orchestrate.md` — confirm today's line shape is
   `Orchestrator readiness (<date>): <question> → <answer>`; this plan changes it to `(<date>, <run>)`. A different shape on
   `main` is written into Execution Notes and the new shape is built from it; it is not a reason to stop.

## User Stories
- As the Human, I want every question I answer before a run kept with its kind and default, so that after a month I can
  see which kinds of question I always answer with the default.
- As the Human, I want this to cost me nothing: no new question, no new step that needs me.

## Functional Requirements

### Must Have (P0)
- [ ] A question parser shared by the recorder and the brain digest.
- [ ] Readiness questions start with a kind tag and end with their default.
- [ ] One script call records the answers of a run, idempotently, with the delegated and took-default flags.
- [ ] The rows reach the kit brain as `events` documents (no new collection, so no change to the database roles).

### Should Have (P1)
- [ ] `/orchestrate` step 2 runs both commands without asking.

### Nice to Have (P2)
- none

## UI/UX Notes
- Terminal text only: `READINESS: recorded <n>` and the usual `BRAIN:` line.

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [ ] Q1: Read a readiness question into its plan, kind, text and default, so every tool reads it the same way — `parseQuestion()` and the kind list (`product`, `scope`, `design`, `data`, `arch`, `env`, `run`, `claim`, `check`, `other`) — core/scripts/lib/readiness-question.mjs, tools/test/readiness-answers.test.mjs
- [ ] Q2: Make readiness tag each question with its kind and end it with its default — one rule in the agent file mapping its existing question kinds (run history → `run`, scope or Depends-on → `scope`, edit/leave/cancel/error → `product`, manifest and the test-location question of plan 074 → `check`, claims → `claim`, environment needs → `env`) — core/.claude/agents/orch-readiness.md, tools/test/orchestrator.test.mjs
- [ ] A1: Record the Human's answers of a run as rows the learning tools can count — `decision-log.mjs readiness --run --plans`: parse the plans' readiness lines, match each to its question, flags `delegated` and `tookDefault`, append to `docs/brain/readiness-answers.jsonl`, skip rows already stored for the run — core/scripts/decision-log.mjs, tools/test/readiness-answers.test.mjs
- [ ] A2: Send the answers to the kit brain with the run's other facts — `answerDocs()` (kind `readiness-answer`, redacted text, stable id) and `brain.mjs digest|send --answers --run`, reading only the answers file (no status.json); one line in the kit-brain doc's command table — core/scripts/lib/brain-doc.mjs, core/scripts/brain.mjs, core/docs/agent/kit-brain.md, tools/test/brain.test.mjs
- [ ] A3: Run both commands at the end of the readiness step, so nothing depends on the Human remembering — step 2 writes the run name in each answer line and the question exactly as returned (kind tag and default kept), then runs both commands — core/.claude/commands/orchestrate.md, tools/test/orchestrator.test.mjs
- [ ] R1: Render the kit's own installed copies, check drift and add a changelog line — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .` — scripts/**, .claude/**, docs/agent/**, .kit/install.json, CHANGELOG.md

## Technical Considerations
- Dependencies: `decision-log.mjs` (new `readiness` command beside `grade` and `pending`), `brain.mjs` (`send` options
  parsed at `brain.mjs:30-52`; `answers` is a new boolean flag like `grades`), `brain-doc.mjs` (`redact()`, `head()`).
- New files: `core/scripts/lib/readiness-question.mjs`, `tools/test/readiness-answers.test.mjs`.
- Model changes: none. The `questions` schema stays a string list; the kind is a text tag so no workflow code changes.
- Backend / API: none. Auth and validation: none.
- Security surface: question and answer text goes to the brain only through `redact()`, like grade text.
- Data / migration: a new project-owned file `docs/brain/readiness-answers.jsonl` (append-only, created on the first
  row). Past runs are not backfilled.

## Out of Scope
- Grading whether an answer was right, and the per-kind report (plan 077).
- An advisor agent that answers questions (decided on 2026-11-01: build it only after about a month of these rows).
- Changing the `questions` schema to objects, or the asked-about lesson lines of plan 065.

## Critical Questions
- Q: A new brain collection or the existing `events`? A: `events` with kind `readiness-answer`, so the writer role
  needs no change in the database provider (recommended; the Human can change it at approval).
- Q: Backfill answers from older plans? A: no; the log starts with the first run after this plan.

## Execution Notes
- Source: chat "אוטומציה של תהליך עבודה עם סוכן" (2026-11-01): keep the up-front questions, record each question and
  answer in a fixed format (question, kind, answer and reason, the agent's suggestion and whether it was taken, later
  whether it was right), build the advisor after about a month of data.
- Review (Architect + PM, a separate agent against b075db1, 2026-11-03): mechanical gaps fixed in the draft (line references, scope and Depends-on, test names); open points answered with the recommended default in Critical Questions. The Planner's own review is still to run.
