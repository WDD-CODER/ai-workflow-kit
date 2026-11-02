# Plan 056 — Orchestrator: new kit scripts must not count as checks, and a removal decision must never be triaged away

Status: draft
Depends-on: none
Snapshot: c497df8ad77fe934371a5debd884c1fc15a6d920

## Problem Statement

An automated security review of a project that synced kit v1.13.0 reported two issues in kit-owned files. Both were
read from the diff only and are **not yet reproduced**; Step 0 reproduces each with a failing test before any fix.

1. `core/scripts/orch-state.mjs` — `MAIN_TRY_NOT_A_CHECK` (a copy of `NOT_A_CHECK` in `core/.claude/workflows/orchestrate.js`)
   is a denylist of the kit scripts that push, open a pull request or write state. The scripts v1.13.0 added
   (`brain`, `scripts/scout/pr.mjs`, `scripts/scout/render.mjs`, and any later one) are on neither list, so the
   orchestrator's main-try may run them as if they were read-only checks.
2. `core/.claude/workflows/orchestrate.js` (~line 1250) — the decision triage accepts an agent-supplied `duplicateOf`
   and forces the verdict `noise` when the target id exists, without checking that the target is the same kind of
   decision or running `triageForce` on it. A `removes:` decision can therefore be marked a duplicate of an unrelated
   decision and never reach the Human as a card, and a `removes:` decision can be dropped on an agent-written `why`.

Both are fail-open: a missing entry or an agent's word loosens a hard rule that the code is meant to apply itself.

## Goals & Success Criteria
**Primary:** a new kit script cannot be run as a check until someone classifies it, and a `removes:` decision always
reaches the Human.

- [auto] A test fails when a script under `core/scripts/**/*.mjs` is on neither the check list nor the not-a-check
  list (the completeness test), and passes after `brain`, `pr`, `render` and every other current script are classified.
- [auto] `orch-state.mjs main-try` refuses `scripts/scout/pr.mjs`, `scripts/brain.mjs` and `scripts/scout/render.mjs`
  with a reason (exit non-zero, message names the script), matched on the relative path, not the bare name `pr`.
- [auto] The two copies of the not-a-check list (`orch-state.mjs`, `orchestrate.js`) stay equal: a test compares them.
- [auto] A triage item with `duplicateOf` is accepted as noise only when the target exists **and** has the same
  decision kind (`removes:` / `behaviour:` / `seen:`); `triageForce` still runs on it; an item that is or duplicates a
  `removes:` decision keeps a card (never `noise`). Tests in `tools/test/orchestrator.test.mjs` cover: cross-kind
  duplicate → not noise; `removes:` with an agent `why` of "duplicate" → card; same-kind duplicate → noise as before.
- [auto] `npm run build`, `npm run lint` (leak check), `npm test`, `node --test "tools/test/*.test.mjs"`,
  `node tools/orchestrator-e2e.mjs` and `node tools/drift-check.mjs --target .` all exit 0.
- [auto] `node scripts/scope-check.mjs --tests --plan=plans/056-orchestrator-check-allowlist-and-removal-decisions.plan.md`
  prints `SCOPE_TESTS: ok`, and `node scripts/scope-check.mjs --diff=origin/main` on the finished branch prints `SCOPE: ok`.
- [human] The Human has read the Step 0 reproduction output and agrees both findings are real before the fixes start.

## Execution Mode
- Parallel: no
- Concurrent plans: shares `core/.claude/workflows/orchestrate.js` and `tools/test/orchestrator.test.mjs` with other
  orchestrator plans; `plan-order` lock groups decide the turn, no `Depends-on:` edit to other plans is needed.
- Isolated DB: no

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/scripts/orch-state.mjs
core/scripts/lib/orch-run.mjs
core/.claude/workflows/orchestrate.js
tools/test/orchestrator.test.mjs
tools/test/orch-check-lists.test.mjs
scripts/**
.claude/**
docs/agent/**
.kit/install.json
CHANGELOG.md
```

`scripts/**`, `.claude/**`, `docs/agent/**` and `.kit/install.json` are the rendered copies, written only by
`node tools/sync.mjs --target . --apply`. `tools/test/orch-check-lists.test.mjs` is a new test file (the completeness
and list-equality tests); `tools/test/orchestrator.test.mjs` holds the triage tests.

## Read Scope

Entire repo and its git history.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry.

## Architecture Impact
- INV-none: preserves — tightens two rules the code already applies (what counts as a check; which decisions reach the
  Human). No decision moves from code to a model; the opposite: less is left to an agent-supplied string.

## Step 0 — Reality Check

1. Runs only when `scope-check.mjs --drift` reports `REALITY: drift`: check the listed commits by symbol, print `ok`
   or `conflict: <what>` per commit; stop for a go only on a conflict.
2. Reproduce finding 1: write the failing tests first (`main-try` on `scripts/scout/pr.mjs` is accepted today; the
   completeness test lists the unclassified scripts). Print the output.
3. Reproduce finding 2: a failing triage test (cross-kind `duplicateOf` yields `noise` today). Find where a `removes:`
   decision is filtered by its `why` with `git grep -n "removalsOf" -- core scripts`; if no such filter exists, say so
   and drop that half of finding 2 from the plan.
4. A finding that does not reproduce is not fixed: write the evidence in Execution Notes and stop for the Human.
5. `node tools/install-check.mjs` and `node --test "tools/test/*.test.mjs"` pass before any edit.

## User Stories
- As the Human, I want a script added to the kit later to be unusable as an unattended check until it is classified, so
  an overnight run cannot push or open a pull request by accident.
- As the Human, I want every decision that removes something to be shown to me, whatever an agent wrote beside it.

## Functional Requirements

### Must Have (P0)
- [ ] One classification per kit script (check / not-a-check), matched on the relative path, with a test that fails on an
      unclassified script.
- [ ] The two copies of the list kept equal by a test.
- [ ] `duplicateOf` accepted only for a same-kind target; `triageForce` runs on duplicates; `removes:` always a card.

### Should Have (P1)
- [ ] The refusal message names the script and says how to classify it.

### Nice to Have (P2)
- None.

## UI/UX Notes
None (orchestrator scripts only).

## Atomic Sub-tasks

Every step names its own test location: `tools/test/orch-check-lists.test.mjs` or `tools/test/orchestrator.test.mjs`.

- [ ] A1: Reproduce both findings with failing tests before changing anything — a test that runs `main-try` on `scripts/scout/pr.mjs`, one that lists unclassified scripts, one for a cross-kind `duplicateOf`, one for a `removes:` decision with a "duplicate" `why`; print the failures and stop for the Human's go
  - Scope: `tools/test/orch-check-lists.test.mjs`, `tools/test/orchestrator.test.mjs`
- [ ] B1: Make a new kit script unusable as a check until it is classified — keep the not-a-check list, add `brain`, `pr`, `render` and every other unclassified script by relative path, switch the match to the relative path, add the completeness test and the copy-equality test, make the refusal message name the script
  - Scope: `core/scripts/orch-state.mjs`, `core/.claude/workflows/orchestrate.js`, `tools/test/orch-check-lists.test.mjs`
- [ ] B2: Stop a removal decision from being triaged away — accept `duplicateOf` only for a same-kind existing target, run `triageForce` on duplicates, keep any `removes:` decision as a card, and mirror the change in `scripts/lib/orch-run.mjs` where the helper has a copy
  - Scope: `core/.claude/workflows/orchestrate.js`, `core/scripts/lib/orch-run.mjs`, `tools/test/orchestrator.test.mjs`
- [ ] R1: Render the kit's own installed copies, run every check and add the changelog line — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .`, build, lint, `npm test`, the full `tools/test` run, `node tools/orchestrator-e2e.mjs`; one CHANGELOG line saying what a project must do (nothing: kit-sync)
  - Scope: `scripts/**`, `.claude/**`, `docs/agent/**`, `.kit/install.json`, `CHANGELOG.md`, `tools/test/orch-check-lists.test.mjs` (run, not edited)

## Technical Considerations
- **Why a completeness test, not only more names:** the denylist failed because adding a script needs a second edit
  nobody is told about. A test that fails on an unclassified script makes the omission loud at the author's desk, with
  the smallest change to behaviour. An allowlist of read-only checks is the stronger design (see Critical Questions).
- **Relative path, not bare name:** `pr` and `render` are common basenames; matching `scripts/scout/pr.mjs` avoids
  blocking an unrelated project script of the same name.
- **Two copies:** `orchestrate.js` has no imports, so the list is copied into `orch-state.mjs`; the equality test is the
  guard the existing comment ("Copy of NOT_A_CHECK in orchestrate.js") asks for in words.
- **Leak check:** shared files stay product-agnostic; test fixtures use scratch paths, no project names.

## Out of Scope
- Changing what a "check" runs, or how the orchestrator gates a merge.
- Any change in a project that synced the kit (it receives the fix by release and `kit-sync`).
- Reworking the triage model prompt.

## Critical Questions
- Allowlist vs denylist for `main-try`: the review suggests an allowlist of known read-only check scripts. Assumed for
  this plan: keep the denylist and add the completeness test (smallest change, no new behaviour). Switching to an
  allowlist is a larger change to what the orchestrator may run; say `allowlist` and A1/B1 are rewritten.

## Execution Notes
- Source: an automated security review of a FoodVibe push (plan 524 merged as PR #494, 2026-11-02) flagged both items in
  kit v1.13.0 files. Findings are unverified; A1 is the verification.
- Per ADR 0021 the fix is made here and released, never patched in the project; FoodVibe takes it with `kit-sync -Ref`.
- Architect + PM review (Planner, 2026-11-02): arch `INV-none`; every named file exists on `main` (new:
  `tools/test/orch-check-lists.test.mjs`); smallest version chosen; solo flow (no `.claude/todo.md`).
