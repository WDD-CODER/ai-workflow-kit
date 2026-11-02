# Plan 059 — Orchestrator gate: the kit manifest check runs per plan (and readiness/builder know it), and generated files are prepared before server tests

Status: draft
Depends-on: none
Snapshot: aac496e051072bad36314d3b24767d2f7fa37469
Source: first orchestrator test run (test-512-422), findings F4, F7, F11

## Problem Statement

1. **F4.** `kit-manifest-check.mjs` runs only in the final gate (`core/.claude/workflows/orchestrate.js:1092`, `init.kitManifest`
   from `core/scripts/orch-state.mjs:541`). A plan that adds a script, agent, command or `docs/brain/**` file (an ADR) passes its own
   gate, merges, and fails only at the end, when no builder is left to add the manifest entry. A test pins that choice:
   `tools/test/orchestrator.test.mjs:750-751` ("Never in a plan's own gate or the merge step").
2. **F7.** Readiness (`core/.claude/agents/orch-readiness.md` "For each plan", lines 31-63) and the builder
   (`core/.claude/agents/orch-builder.md` steps 3-4, prompt `orchestrate.js:565-579`) are not told that such a plan must also update
   the manifest, so the plan's scope lacks `manifest.json` and the builder cannot write it.
3. **F11.** Server tests need a generated folder (a project's `server/generated/schemas`) that a fresh worktree or the merge folder
   does not have. Nothing before the gate generates it (`ensureDeps`, `core/scripts/lib/orch-folders.mjs:43-70`, only installs
   packages; `commands.codegen` and `commands.slotPrepare` are not used by the gate), so the server tests fail in a fresh worktree.

## Goals & Success Criteria
**Primary:** a plan that adds an inventoried file or an ADR fails in its own gate until the manifest is updated; a gate never fails
on a missing generated folder the project can generate.

- [auto] When `init.kitManifest` is true, every plan's gate list (`ctx.checks`) contains `node scripts/kit-manifest-check.mjs`
  once, and the merge step's list (`mergeChecksOf`) does not. When it is false, the per-plan list is unchanged. Test in
  `tools/test/orchestrator.test.mjs` (the test at :741 is rewritten: per-plan gate has it, merge step has not, final gate once).
- [auto] New optional config `orchestrator.prepare` (list, default `[]`) of `{ "missing": "<repo-relative path>", "script":
  "<npm script>", "in": "<repo-relative folder, default .>" }`; install and sync accept the shape and refuse an absolute path,
  a `..`, a script that is a full command, or an unknown field (`tools/lib/kit.mjs`, config-validation test).
- [auto] `node scripts/orch-state.mjs prepare --missing <path> --script <name> [--in <folder>] [--pm npm|pnpm]` run in a folder:
  prints `PREPARE: ok (present)` and runs nothing when `<path>` exists; otherwise runs `<pm> run <script>` in `<in>`, prints
  `PREPARE: ok (generated)` when `<path>` exists afterwards, and exits 1 with the last 20 lines of the output when it does not.
  Test in `tools/test/orchestrator-folders.test.mjs` with a stub package script.
- [auto] With one `orchestrator.prepare` entry, the per-plan gate list and the final gate list both start with that `prepare`
  command, before the project checks; with `[]` neither list changes. Test in `tools/test/orchestrator.test.mjs`.
- [auto] The readiness agent's rules name the manifest (a plan that adds an inventoried file or an ADR and has `manifest.json` in
  neither scope nor a Done-when check gets a `questions` entry), and the builder prompt says the per-plan gate runs the manifest
  check. Test: the two agent files and the builder prompt contain the sentences (string assertions, same style as the existing
  prompt tests).
- [auto] `npm run build`, `npm run lint`, `npm test`, `node --test "tools/test/*.test.mjs"`, `node tools/orchestrator-e2e.mjs` and
  `node tools/drift-check.mjs --target .` all exit 0.
- [auto] `node scripts/scope-check.mjs --tests --plan=plans/059-orchestrator-gate-runs-the-kit-manifest-check-per-plan-and-prepares-generated-files-before-tests.plan.md`
  prints `SCOPE_TESTS: ok`, and `node scripts/scope-check.mjs --diff=origin/main` on the finished branch prints `SCOPE: ok`.
- [human] On the Human's PC, a two-plan run where one plan adds a script without a manifest entry: that plan is sent back by its
  own gate with `unclassified: scripts/<name>` and merges after the entry is added, instead of failing at the final gate.

## Execution Mode
- Parallel: no
- Concurrent plans: shares `orchestrate.js`, `orch-state.mjs` and `tools/test/orchestrator*.test.mjs` with 062, 063 and 064;
  `plan-order` lock groups decide the turn. Any time before them is fine.
- Isolated DB: no

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/.claude/workflows/orchestrate.js
core/scripts/orch-state.mjs
core/.claude/agents/orch-readiness.md
core/.claude/agents/orch-builder.md
core/docs/agent/orchestrator.md
kit.config.json
tools/lib/kit.mjs
tools/test/orchestrator.test.mjs
tools/test/orchestrator-folders.test.mjs
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
- INV-1: preserves — the readiness agent keeps its judgment-tier model (plan 063 pins it); this plan only adds a rule to its text.
- INV-none: preserves — the gate still never writes the main folder and never merges to main. The new `prepare` command writes
  only inside the gate's own folder.

## Step 0 — Reality Check

1. Runs only when `scope-check.mjs --drift` reports `REALITY: drift`: check the listed commits by symbol, print `ok` or
   `conflict: <what>` per commit; stop for a go only on a conflict.
2. Confirm `runPlan` (`orchestrate.js:835-852`) can see `init.kitManifest` (it is read at :1092 in `run()`); if it is out of
   scope of `runPlan`, pass it through `args`/a module constant. Report the choice in Execution Notes.
3. Confirm the manifest check passes in a plan worktree (it reads the worktree's own `docs/workflow-kit/manifest.json`); if a
   worktree lacks `scripts/kit-manifest-check.mjs` the check must be left out, not failed.
4. `node tools/install-check.mjs` and `node --test "tools/test/*.test.mjs"` pass before any edit.

## User Stories
- As the Human, I want a plan that adds a file to fail its own gate until the manifest lists it, so the run does not end red.
- As the Human, I want server tests to work in a fresh worktree without a manual build step.

## Functional Requirements

### Must Have (P0)
- [ ] Per-plan gate: add `node scripts/kit-manifest-check.mjs` to `ctx.checks` (`orchestrate.js:841`) when `init.kitManifest`;
      `mergeChecksOf` (:54) filters it out; the final list (:1092) keeps one copy (the existing `Set`).
- [ ] `orch-state.mjs prepare` command and `orchestrator.prepare` config (rendered into `orchestrate.js` as a constant next to
      `PROJECT_CHECKS`; one `prepare` command per entry, put first in the per-plan list and in `finalChecks`; not in
      `mergeChecksOf`, which runs on a tree the plan gate already prepared).
- [ ] Readiness: new rule in `orch-readiness.md` "For each plan" (item 7): when the plan adds a file under the manifest inventory
      (scripts, agents, commands, skills, `docs/brain/**`, `docs/agent/**`, `.github/workflows`) or an ADR, and the run's `init`
      has a manifest, the plan must list `docs/workflow-kit/manifest.json` in scope and `node scripts/kit-manifest-check.mjs` in
      its Done-when; else one `questions` entry. Add the matching line to the builder prompt and `orch-builder.md` step 3.
- [ ] `orchestrator.md` (gate section) and the config `$comment` in `kit.config.json` describe both; CHANGELOG entry.

### Should Have (P1)
- [ ] The `prepare` failure message names the entry (`missing`, `script`, `in`) so the Human can repeat it by hand.

### Nice to Have (P2)
- None.

## UI/UX Notes
None (scripts, agent text and docs only).

## Atomic Sub-tasks

Every step names its own test location.

- [ ] A1: Reproduce with failing tests — in `tools/test/orchestrator.test.mjs`: a per-plan gate list with `init.kitManifest: true` has no manifest check today; in `tools/test/orchestrator-folders.test.mjs`: `orch-state.mjs prepare` is an unknown command today; add Step 0 findings to Execution Notes
  - Scope: `tools/test/orchestrator.test.mjs`, `tools/test/orchestrator-folders.test.mjs`
- [ ] B1: Add `prepare` to `orch-state.mjs` and `orchestrator.prepare` to the config and its validation; tests for present / generated / failed and the config shapes
  - Scope: `core/scripts/orch-state.mjs`, `kit.config.json`, `tools/lib/kit.mjs`, `tools/test/orchestrator-folders.test.mjs`
- [ ] B2: Put the manifest check and the `prepare` commands into the per-plan and final gate lists; rewrite the test at :741; tests for merge step exclusion and empty `prepare`
  - Scope: `core/.claude/workflows/orchestrate.js`, `tools/test/orchestrator.test.mjs`
- [ ] B3: Tell readiness and the builder (agent files and builder prompt) with string-assertion tests
  - Scope: `core/.claude/agents/orch-readiness.md`, `core/.claude/agents/orch-builder.md`, `core/.claude/workflows/orchestrate.js`, `tools/test/orchestrator.test.mjs`
- [ ] D1: Document in `orchestrator.md` and the config comment
  - Scope: `core/docs/agent/orchestrator.md`, `kit.config.json`
- [ ] R1: Render the installed copies, run every check, add the changelog entry — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .`, build, lint, `npm test`, `node --test "tools/test/*.test.mjs"`, `node tools/orchestrator-e2e.mjs`
  - Scope: `scripts/**`, `.claude/**`, `docs/agent/**`, `docs/brain/**`, `.kit/install.json`, `CHANGELOG.md`

## Technical Considerations
- **Why `prepare` is a gate command and not a runner call:** the gate already runs a command list in the right folder; a first
  command costs no extra agent call and the existing env-fail and timeout handling apply.
- **Why a config list and not `commands.codegen`:** `codegen` is a generic script key with no "missing path" condition and is not
  used by the orchestrator; a project may run it elsewhere with other meaning. The list keeps the condition explicit and the
  kit free of project names (leak check).
- **Why not in the merge step:** `mergeChecks` is `build` plus the plan's scope check; the tree it merges came from a gate that
  prepared its own folder, and the merge folder is prepared by the final gate's list.
- **Leak check:** fixtures use scratch folders and stub scripts; no project path appears in shared files.

## Out of Scope
- Generating files outside the gate (dev servers, `[ui]` checks, `slot-serve.mjs`).
- Changing what `kit-manifest-check.mjs` checks, or the manifest format.
- Auto-writing manifest entries for the builder.

## Critical Questions
- None open.

## Execution Notes
- Source: orchestrator test run test-512-422, findings F4+F7 (gate/readiness) and F11 (generated schemas). Planner read the kit
  at `origin/main` `aac496e`; FoodVibe was not read (its `server/generated/schemas` and `build:schemas` are from the Human's words).
- Architect + PM review: see the block printed when this plan was saved (summary kept in the commit message).
