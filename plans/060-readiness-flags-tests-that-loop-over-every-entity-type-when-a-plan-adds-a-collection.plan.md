# Plan 060 — Readiness flags tests that loop over every entity type when a plan adds a collection; the plan template asks for them

Status: draft
Depends-on: none
Snapshot: aac496e051072bad36314d3b24767d2f7fa37469
Source: first orchestrator test run (test-512-422), findings F3 and D16

## Problem Statement

A plan that adds a collection (an entity type) breaks a test it never mentions: a test that loops over every entity type
(in the test run: `cross-business.test.js`). The plan's scope does not name that test, so the builder cannot update it
(the test-file gate blocks a changed test the scope does not list, `orchestrate.js:677`), and the failure shows up late as a gate
failure or a park. Readiness (`core/.claude/agents/orch-readiness.md` "For each plan", lines 31-63) asks about claims, environment
and `[auto]` commands but never looks for such tests, and the plan template
(`core/.claude/references/prd-template.md`, sections at :10, :24, :91) and `/plan`'s PM review (`core/.claude/commands/plan.md`
:66 area) do not ask for them either.

## Goals & Success Criteria
**Primary:** a plan that adds a collection names, in scope and in a sub-task, every test that loops over all entity types, or
readiness asks the Human before the run builds it.

- [auto] `orch-readiness.md` has a rule (item 8 of "For each plan"): when the plan adds a collection / entity type / table /
  model, search the repo's tests for loops over the full set of types (a registry array, `Object.keys`/`Object.values` of the type
  map, a `for … of`/`forEach`/`describe.each`/`test.each` over the list of collections) and return each hit as a new per-plan
  field `allTypeTests: [{ path, why }]`; a hit not covered by the plan's `## Read-Write Scope` also adds a `questions` entry
  naming the file and offering `approved: <path>`. Test: the agent file contains the rule and the example JSON in the agent file
  and `SCHEMA.readiness` in `orchestrate.js` accept `allTypeTests` (string assertions plus a schema validation test in
  `tools/test/orchestrator.test.mjs`).
- [auto] The readiness result with `allTypeTests` is carried to the builder prompt as `ALL_TYPE_TESTS` so the builder updates
  them first; test: the builder prompt of a plan whose readiness returned two paths contains both paths.
- [auto] `prd-template.md` has, under "Technical Considerations", a line asking a plan that adds a collection to list every test
  that loops over all entity types and to give each one a sub-task and a scope line; `plan.md`'s PM review has the matching check;
  `save-plan`'s shape lint is unchanged. Test: string assertions on the two files.
- [auto] `npm run build`, `npm run lint`, `npm test`, `node --test "tools/test/*.test.mjs"`, `node tools/orchestrator-e2e.mjs` and
  `node tools/drift-check.mjs --target .` all exit 0.
- [auto] `node scripts/scope-check.mjs --tests --plan=plans/060-readiness-flags-tests-that-loop-over-every-entity-type-when-a-plan-adds-a-collection.plan.md`
  prints `SCOPE_TESTS: ok`, and `node scripts/scope-check.mjs --diff=origin/main` on the finished branch prints `SCOPE: ok`.
- [human] On the Human's PC, `/orchestrate` of a plan that adds a collection to a project with an all-types test: readiness lists
  that test and asks about it before `go`.

## Execution Mode
- Parallel: no
- Concurrent plans: shares `orchestrate.js` and `tools/test/orchestrator.test.mjs` with 059, 062, 063 and 064, and
  `orch-readiness.md` with 059 (the `plan-order` lock groups decide the turn).
- Isolated DB: no

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/.claude/agents/orch-readiness.md
core/.claude/references/prd-template.md
core/.claude/commands/plan.md
core/.claude/workflows/orchestrate.js
core/docs/agent/orchestrator.md
tools/test/orchestrator.test.mjs
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
- INV-1: preserves — the readiness agent keeps its judgment-tier model (plan 063 pins it); this plan only adds a rule and an output field.
- INV-none: preserves — readiness stays read-only; it gains a search and an output field, nothing is written.

## Step 0 — Reality Check

1. Runs only when `scope-check.mjs --drift` reports `REALITY: drift`: check the listed commits by symbol, print `ok` or
   `conflict: <what>` per commit; stop for a go only on a conflict.
2. Read `SCHEMA.readiness` and the readiness prompt (`orchestrate.js:488-492`) and the claim handling after it; report where a
   per-plan field is read, so `allTypeTests` is carried the same way as `envNeeds`.
3. `node tools/install-check.mjs` and `node --test "tools/test/*.test.mjs"` pass before any edit.

## User Stories
- As the Human, I want readiness to tell me which existing tests a new collection will break, before the run builds it.

## Functional Requirements

### Must Have (P0)
- [ ] Readiness rule, example JSON and `SCHEMA.readiness` field `allTypeTests` (optional list; absent = none).
- [ ] The field is carried into the builder prompt (`builder()`, `orchestrate.js:565-579`) as `ALL_TYPE_TESTS`.
- [ ] `prd-template.md` line and `plan.md` PM-review line; CHANGELOG entry; `orchestrator.md` readiness section names the field.

### Should Have (P1)
- [ ] A readiness hit outside the plan's scope is turned into a question by the workflow script (not only by the model):
      the script compares each `allTypeTests` path with the plan's scope globs (the matcher `scope-check.mjs` uses) and adds the
      question itself, so a model that forgets the question still stops the run.

### Nice to Have (P2)
- None.

## UI/UX Notes
None (agent text, template and workflow script only).

## Atomic Sub-tasks

Every step names its own test location.

- [ ] A1: Failing tests first — a readiness schema without `allTypeTests` rejects an entry with it today; the builder prompt has no `ALL_TYPE_TESTS`; Step 0 findings to Execution Notes
  - Scope: `tools/test/orchestrator.test.mjs`
- [ ] B1: Readiness rule, example JSON, schema field, builder-prompt carry; tests
  - Scope: `core/.claude/agents/orch-readiness.md`, `core/.claude/workflows/orchestrate.js`, `tools/test/orchestrator.test.mjs`
- [ ] B2 (P1): Script-side scope check of each `allTypeTests` path into a question; tests
  - Scope: `core/.claude/workflows/orchestrate.js`, `tools/test/orchestrator.test.mjs`
- [ ] D1: Template line, PM-review line, `orchestrator.md`
  - Scope: `core/.claude/references/prd-template.md`, `core/.claude/commands/plan.md`, `core/docs/agent/orchestrator.md`
- [ ] R1: Render the installed copies, run every check, add the changelog entry — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .`, build, lint, `npm test`, `node --test "tools/test/*.test.mjs"`, `node tools/orchestrator-e2e.mjs`
  - Scope: `scripts/**`, `.claude/**`, `docs/agent/**`, `docs/brain/**`, `.kit/install.json`, `CHANGELOG.md`

## Technical Considerations
- **Why a model search and not a script:** "loops over every entity type" has no generic shape (registry arrays, `.each`
  tables, directory scans); the readiness agent already reads the repo with Grep. The script only enforces the scope
  comparison (P1), which is exact.
- **Why a new field and not a claim:** a claim needs an answer from the Human; a hit inside scope needs none and goes straight
  to the builder.
- **Leak check:** fixtures use invented entity names; `cross-business` appears only in this plan's Source line.

## Out of Scope
- A generic detector of all-types tests in code.
- Changing the test-file gate (`orchestrate.js:677`).
- Updating the tests for the Human.

## Critical Questions
- None open.

## Execution Notes
- Source: orchestrator test run test-512-422, findings F3 + D16. Kit read at `origin/main` `aac496e`; the project's tests were not read.
