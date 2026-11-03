# Plan 056 — Orchestrator: a kit script is a main-folder check only when listed, and a removal decision must never be triaged away

Status: draft
Depends-on: none
Snapshot: c497df8ad77fe934371a5debd884c1fc15a6d920

## Problem Statement

An automated security review of a project that synced kit v1.13.0 reported two issues in kit-owned files. Both were
read from the diff only and are **not yet reproduced**; the first step reproduces each with a failing test before any
fix.

1. `core/scripts/orch-state.mjs` — `main-try` runs a plan's command in the Human's live main folder and decides what
   is "not a check" with `MAIN_TRY_NOT_A_CHECK`, a denylist of kit script names (a copy of `NOT_A_CHECK` in
   `core/.claude/workflows/orchestrate.js`). A kit script missing from the list is treated as a read-only check. The
   scripts v1.13.0 added (`scripts/brain.mjs`, `scripts/scout/pr.mjs`, `scripts/scout/render.mjs`, and any later one)
   are on no list, so `main-try` would run them. A denylist fails open: each new kit script needs a second edit that
   nothing reminds the author of.
2. `core/.claude/workflows/orchestrate.js` (~line 1352) — the decision triage accepts an agent-supplied `duplicateOf`
   and forces the verdict `noise` when the target id exists, without checking that the target is the same kind of
   decision or running `triageForce` on it. A `removes:` decision can therefore be marked a duplicate of an unrelated
   decision and never reach the Human as a card, and a `removes:` decision can be dropped on an agent-written `why`.

## Decision (Human, 2026-11-02): allowlist for `main-try`

`main-try` becomes fail-closed for kit scripts: a script the kit installed is run as a main-folder check **only when
it is on a list of read-only kit checks**. The rule, in `orch-state.mjs` only (the one place that runs the command):

- A script named in `.kit/install.json` `files` (the kit's own, matched on the full relative path such as
  `scripts/scout/pr.mjs`, never on the bare name `pr`) runs only when its path is on `MAIN_TRY_KIT_CHECKS`.
- A script **not** named there is the project's own check (`scripts/` and `tools/` hold them) and is allowed as
  today, still subject to the safe-argument, deny-pattern and write-flag rules. This keeps every project check working.
- `.kit/install.json` missing or unreadable: `main-try` refuses with a reason (fail closed), it does not guess.
- The existing `MAIN_TRY_NOT_A_CHECK` names stay refused (a test asserts they are not on the allowlist).
- `orchestrate.js` keeps its `NOT_A_CHECK` deny set for the checks that run in a plan's worktree, where the folder is a
  scratch copy; `main-try` is the strict gate for the live folder and runs after it, so a command it refuses is
  reported as "not checkable from main", an outcome the workflow already handles (verified in A1).

## Goals & Success Criteria
**Primary:** a kit script cannot run in the live main folder until someone lists it as a read-only check, and a
`removes:` decision always reaches the Human.

- [auto] `orch-state.mjs main-try` refuses `scripts/brain.mjs`, `scripts/scout/pr.mjs` and `scripts/scout/render.mjs`
  (each recorded in `.kit/install.json`, none on the allowlist) with a reason that names the script and says to add
  it to the allowlist in the kit; exit non-zero.
- [auto] `main-try` still runs the listed read-only kit checks (`scripts/override-check.mjs`,
  `scripts/kit-manifest-check.mjs`, `scripts/plan-ledger-check.mjs`, `scripts/plan-order.mjs`,
  `scripts/scope-check.mjs` with read-only flags) and a project-only script that `.kit/install.json` does not name
  (test fixture `scripts/project-check.mjs`).
- [auto] With `.kit/install.json` absent or invalid, `main-try` refuses every command with a reason that names the file.
- [auto] Every path on `MAIN_TRY_KIT_CHECKS` exists under `core/scripts/` and is recorded in the kit's own
  `.kit/install.json`; no name from `MAIN_TRY_NOT_A_CHECK` is on it (test in `tools/test/orch-check-lists.test.mjs`).
- [auto] A triage item with `duplicateOf` is accepted as noise only when the target exists **and** has the same
  decision kind (`removes:` / `behaviour:` / `seen:`); `triageForce` still runs on it; an item that is or duplicates a
  `removes:` decision keeps a card (never `noise`). Tests in `tools/test/orchestrator.test.mjs` cover: cross-kind
  duplicate → not noise; `removes:` with an agent `why` of "duplicate" → card; same-kind duplicate → noise as before.
- [auto] `npm run build`, `npm run lint` (leak check), `npm test`, `node --test "tools/test/*.test.mjs"`,
  `node tools/orchestrator-e2e.mjs` and `node tools/drift-check.mjs --target .` all exit 0.
- [auto] `node scripts/scope-check.mjs --tests --plan=plans/056-orchestrator-check-allowlist-and-removal-decisions.plan.md`
  prints `SCOPE_TESTS: ok`, and `node scripts/scope-check.mjs --diff=origin/main` on the finished branch prints `SCOPE: ok`.
- [human] The Human has read the A1 reproduction output and the proposed allowlist (one line of evidence per kit
  script: reads only / writes / pushes / network) and said go before the fixes start.

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
core/docs/agent/orchestrator.md
tools/test/orchestrator.test.mjs
tools/test/orch-check-lists.test.mjs
scripts/**
.claude/**
docs/agent/**
.kit/install.json
CHANGELOG.md
```

`scripts/**`, `.claude/**`, `docs/agent/**` and `.kit/install.json` are the rendered copies, written only by
`node tools/sync.mjs --target . --apply`. `tools/test/orch-check-lists.test.mjs` is a new test file (the allowlist
tests); `tools/test/orchestrator.test.mjs` holds the triage tests.

## Read Scope

Entire repo and its git history.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry.

## Architecture Impact
- INV-none: preserves — tightens two rules the code already applies (what may run in the live main folder; which
  decisions reach the Human). The code decides, from a list and from `.kit/install.json`, not from an agent-supplied
  string; no decision moves to a model.

## Step 0 — Reality Check

1. Runs only when `scope-check.mjs --drift` reports `REALITY: drift`: check the listed commits by symbol, print `ok`
   or `conflict: <what>` per commit; stop for a go only on a conflict.
2. `git grep -n "MAIN_TRY_NOT_A_CHECK\|mainTryProblem\|mainCheckProblem\|main-try" -- core tools docs` — confirm
   `main-try` is the only place that runs a plan command in the live folder, and read how the workflow handles a
   `main-try` refusal (it must surface as "not checkable from main", not as a build failure). If it does not, say so
   in Execution Notes and stop for the Human.
3. `git grep -n "removalsOf" -- core scripts`: if no filter drops a `removes:` decision on its `why`, say so and drop
   that half of finding 2 from the plan.
4. `node tools/install-check.mjs` and `node --test "tools/test/*.test.mjs"` pass before any edit.

## User Stories
- As the Human, I want a kit script added later to stay out of my live main folder until the kit lists it as a
  read-only check, so an overnight run cannot push or open a pull request from there.
- As the Human, I want every decision that removes something shown to me, whatever an agent wrote beside it.
- As a project author, I want my own `scripts/` checks to keep working in `main-try` with no new config.

## Functional Requirements

### Must Have (P0)
- [ ] `main-try`: a script named in `.kit/install.json` runs only when its relative path is on `MAIN_TRY_KIT_CHECKS`;
      a script not named there runs as today; no readable `.kit/install.json` → refuse.
- [ ] `MAIN_TRY_KIT_CHECKS` lists only scripts verified read-only (A1's table), by relative path.
- [ ] `duplicateOf` accepted only for a same-kind target; `triageForce` runs on duplicates; `removes:` always a card.

### Should Have (P1)
- [ ] The refusal names the script and says how to get it listed (a kit change, not a project edit).
- [ ] `core/docs/agent/orchestrator.md` states the rule in one paragraph where it describes `main-try`.

### Nice to Have (P2)
- None.

## UI/UX Notes
None (orchestrator scripts only).

## Atomic Sub-tasks

Every step names its own test location: `tools/test/orch-check-lists.test.mjs` or `tools/test/orchestrator.test.mjs`.

- [ ] A1: Reproduce both findings with failing tests and list every kit script's read-only status before changing anything — tests that run `main-try` on `scripts/scout/pr.mjs`, `scripts/brain.mjs` and `scripts/scout/render.mjs` (accepted today), one for a cross-kind `duplicateOf`, one for a `removes:` decision with a "duplicate" `why`; a table of every script under `core/scripts/` with reads-only / writes / pushes / network evidence read from the script; print the failures and the table, then stop for the Human's go
  - Scope: `tools/test/orch-check-lists.test.mjs`, `tools/test/orchestrator.test.mjs`
- [ ] B1: Make `main-try` refuse a kit script that is not on the read-only list — add `MAIN_TRY_KIT_CHECKS` (full relative paths, from the approved table), read `.kit/install.json` `files` to tell a kit script from a project one, refuse when the file is unreadable, keep the write-flag, safe-argument and deny rules, make the refusal name the script, and add the allowlist tests (refused, allowed, project script, missing file, list-vs-disk, list-vs-denylist)
  - Scope: `core/scripts/orch-state.mjs`, `core/docs/agent/orchestrator.md`, `tools/test/orch-check-lists.test.mjs`
- [ ] B2: Stop a removal decision from being triaged away — accept `duplicateOf` only for a same-kind existing target, run `triageForce` on duplicates, keep any `removes:` decision as a card, and mirror the change in `scripts/lib/orch-run.mjs` where the helper has a copy
  - Scope: `core/.claude/workflows/orchestrate.js`, `core/scripts/lib/orch-run.mjs`, `tools/test/orchestrator.test.mjs`
- [ ] R1: Render the kit's own installed copies, run every check and add the changelog line — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .`, build, lint, `npm test`, the full `tools/test` run, `node tools/orchestrator-e2e.mjs`; one CHANGELOG line: `main-try` now runs a kit script only when it is on the read-only list; a project's own scripts are unaffected
  - Scope: `scripts/**`, `.claude/**`, `docs/agent/**`, `.kit/install.json`, `CHANGELOG.md`, `tools/test/orch-check-lists.test.mjs` (run, not edited)

## Technical Considerations
- **Why `.kit/install.json` and not a script-name list for "is this a kit script":** a project's own `scripts/pr.mjs` must
  keep working; only a path the kit installed is held to the allowlist. The file is already the kit's record of what it
  wrote, so there is no second list to keep in step. The cost: a project with no `.kit/install.json` gets refusals,
  which is the safe direction and matches how every other kit tool treats a missing record.
- **Fail closed on an unlisted kit script:** the next script the kit adds is refused in the live folder until a kit
  change lists it, which the author sees in the first run, not after an incident.
- **Overrides:** a project override of a kit script (e.g. `scripts/scope-check.mjs`) is still recorded in
  `install.json`, so the same path rule applies to it.
- **Leak check:** shared files stay product-agnostic; fixtures use scratch paths, no project names.

## Out of Scope
- Changing what a "check" runs, or how the orchestrator gates a merge.
- The worktree-side `NOT_A_CHECK` set in `orchestrate.js` (stays a deny set; the worktree is a scratch copy).
- Any change in a project that synced the kit (it receives the fix by release and `kit-sync`).
- Reworking the triage model prompt.

## Critical Questions
- None open. Decided by the Human on 2026-11-02: allowlist for `main-try`. Assumed: project-owned scripts stay allowed
  (otherwise every project check would need listing) and a missing `.kit/install.json` refuses.

## Execution Notes
- Source: an automated security review of a FoodVibe push (plan 524 merged as PR #494, 2026-11-02) flagged both items in
  kit v1.13.0 files. Findings are unverified; A1 is the verification.
- Per ADR 0021 the fix is made here and released, never patched in the project; FoodVibe takes it with `kit-sync -Ref`.
- Rewritten 2026-11-02 from "denylist plus completeness test" to the allowlist above after the Human chose `allowlist`.
- Architect + PM review (Planner, 2026-11-02): arch `INV-none`; every named file exists on `main` (new:
  `tools/test/orch-check-lists.test.mjs`); smallest version that is fail-closed; solo flow (no `.claude/todo.md`).
