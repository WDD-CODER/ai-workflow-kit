# Plan 055 — Planner names the test location in scope

Status: draft
Depends-on: 049
Snapshot: 3d52a688afa8bc070ddd5757bad271c66a7f82ed

## Problem Statement

The test-file gate (merged with the checkers hardening) blocks any changed test file that no scope line names a test
location for: `scope-check.mjs --diff` prints `SCOPE: test-out <path>` and `orch-state.mjs diff` returns
`testsOutOfScope`. A folder glob such as `src/**` does not list the tests under it. But nothing that tells the Planner
how to write a plan knows this rule: `/plan`'s Architect checklist says only "covers every file the steps write", the
PRD template's scope placeholder says "prefer folder globs", and `save-plan` lints nothing about it. So plans keep
being written with `src/**`, and the first orchestrator run parks on a blocker after a full build. The rule appears
only in `core/docs/agent/orchestrator.md` and `core/scripts/lib/plan-scope.mjs` (checked on `origin/main` `3d52a68`).

Cheapest place to catch it is at save time: one sentence in the Planner's instructions, and a warning from the
`save-plan` shape lint.

## Goals & Success Criteria
**Primary:** a plan whose steps change code can no longer be saved without being told, in the same command output,
that its scope names no test location.

- [auto] `node scripts/scope-check.mjs --tests --plan=<p>` prints `SCOPE_TESTS: warn` plus one line naming the code
  scope lines (and exits 0) for a plan whose only scope line is `src/**`; prints `SCOPE_TESTS: ok` for the same plan
  with the extra line `src/a.test.ts` or `tools/test/**`; prints `SCOPE_TESTS: skipped (docs only)` for a plan whose
  scope lines are all documentation. Always exit 0 (a warning, never an error) — test in `scope-tests-lint.test.mjs`.
- [auto] The lint reuses `isTestPath` / `testScopeGlobs` from `scripts/lib/plan-scope.mjs`: `git grep` of the new lib
  file finds no test-folder or test-name pattern of its own (test asserts the file imports them and holds no
  `__tests__` / `.test.` literal).
- [auto] One test runs the real, installed `scope-check.mjs` and `orch-state.mjs` (no stub) in a scratch git repo: a
  plan with scope `src/**` gets `SCOPE_TESTS: warn`, and the real gate then reports `SCOPE: test-out src/a.test.ts`
  (exit 1) and `testsOutOfScope` for a branch that edits that test; the same plan with `src/a.test.ts` added gets
  `SCOPE_TESTS: ok`, `SCOPE: ok` and an empty `testsOutOfScope` — the lint and the gate agree.
- [auto] The shipped instructions carry the rule: `core/.claude/commands/plan.md`, `core/.claude/references/prd-template.md`
  and `core/.claude/skills/save-plan/SKILL.md` each contain a sentence that a scope line must name the test location
  and that a code-folder glob does not cover the tests under it; `save-plan` lists `--tests` in its Phase 2 shape
  line and checklist (test reads the three files).
- [auto] `core/.claude/skills/save-plan/evals/evals.json` has a case (id 2) for a pasted plan whose scope is `src/**`
  only; `node --test "tools/test/eval-cases.test.mjs"` still passes.
- [auto] `npm run build`, `npm run lint` (the leak check: no project-specific or language-specific wording, no plan
  number in the CHANGELOG entry), `npm test`, `node --test "tools/test/*.test.mjs"`, `node tools/orchestrator-e2e.mjs`
  and `node tools/drift-check.mjs --target .` all exit 0.
- [auto] `node scripts/scope-check.mjs --tests --plan=plans/055-planner-names-the-test-location-in-scope.plan.md`
  prints `SCOPE_TESTS: ok`, and `node scripts/scope-check.mjs --diff=origin/main` on the finished branch prints
  `SCOPE: ok` (this plan passes its own gate).

## Execution Mode
- Parallel: no
- Concurrent plans: none running. Shares `.claude/**` / `scripts/**` rendered copies with 045–054; those wait for
  their own turn in `plan-order` (lock groups), so no `Depends-on:` edit to other plans is needed.
- Isolated DB: no

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/scripts/lib/scope-tests-lint.mjs
core/scripts/scope-check.mjs
core/.claude/commands/plan.md
core/.claude/references/prd-template.md
core/.claude/skills/save-plan/SKILL.md
core/.claude/skills/save-plan/evals/evals.json
tools/test/scope-tests-lint.test.mjs
scripts/**
.claude/**
docs/agent/**
.kit/install.json
CHANGELOG.md
```

`scripts/**`, `.claude/**`, `docs/agent/**` and `.kit/install.json` are the rendered copies, written only by
`node tools/sync.mjs --target . --apply` (R1). `tools/test/scope-tests-lint.test.mjs` is the one test location: it is
a new file and also holds the real-scripts test. `core/scripts/lib/plan-scope.mjs` is read, not edited.

## Read Scope

Entire repo and its git history.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry.

## Architecture Impact
- INV-none: preserves — adds a warning-only lint and instruction text; no decision moves from code to a model, and the
  gate itself (`plan-scope.mjs`) is unchanged.

## Step 0 — Reality Check

1. Runs only when `scope-check.mjs --drift` reports `REALITY: drift`: check the listed commits by symbol and print
   `ok` or `conflict: <what>` per commit; stop for a go only on a conflict.
2. Always: `git grep -n "testsOutOfScope\|test-out" -- core` — confirm the rule is still only in `orchestrator.md`,
   `plan-scope.mjs`, `scope-check.mjs` and `orch-state.mjs`; and read how `orchestrate.js` calls `orch-state.mjs diff`
   (its flags), because L2 runs that same command line for real.
3. Always: `node tools/install-check.mjs` and `node --test "tools/test/*.test.mjs"` pass before any edit — a red start is
   written into Execution Notes, not fixed here.

## User Stories
- As the Human, I want a plan that cannot pass its own gate to tell me so when it is saved, not after a full build.
- As the Planner, I want the rule written where I write scope lines, so I do not need to remember a merged plan.

## Functional Requirements

### Must Have (P0)
- [ ] Planner instructions say a scope line must name the test location itself.
- [ ] `scope-check --tests`: warn-only shape lint, docs-only plans exempt, reusing the test-path helper.
- [ ] Unit tests plus one test on the real scripts.

### Should Have (P1)
- [ ] A `save-plan` eval case for the `src/**`-only plan.

### Nice to Have (P2)
- None.

## UI/UX Notes
None (scripts and instructions only).

## Atomic Sub-tasks

Every step lists its exact Scope and names its own test location, `tools/test/scope-tests-lint.test.mjs`.

- [x] L1: Make saving a plan warn when its code scope names no place for the tests — new lint helper (`scopeTestsLint(planText)` → `ok` / `docs-only` / `warn` + the code scope lines; a scope line is documentation when it is `*.md`/`*.mdx`/`*.txt`, under `docs/` or `plans/`, or a CHANGELOG/README/LICENSE file; the test check imports `extractScopeGlobs` and `testScopeGlobs` from `plan-scope.mjs`, no pattern copied), and a `--tests --plan=<p>` mode in `scope-check.mjs` that prints `SCOPE_TESTS: ok | skipped (docs only) | warn` and always exits 0; usage header documents it — `core/scripts/lib/scope-tests-lint.mjs`, `core/scripts/scope-check.mjs`
  - Scope: `core/scripts/lib/scope-tests-lint.mjs`, `core/scripts/scope-check.mjs`, `tools/test/scope-tests-lint.test.mjs`
- [x] L2: Prove the lint with tests, including one that runs the real scripts instead of stubs — unit cases (warns for `src/**` only; no warn for docs-only; no warn with `src/a.test.ts` or `tools/test/**`; no warn when the only code line is itself a test line; CRLF plan text; plan with no scope block → `SCOPE_TESTS: skipped (no scope)`; lib file holds no test-path literal) and a scratch-repo test copying the installed `scripts/` that runs the real `scope-check.mjs --tests`, `scope-check.mjs --diff=main` and `orch-state.mjs diff` (flags as `orchestrate.js` passes them) for a `src/**` plan and the same plan with `src/a.test.ts` — `tools/test/scope-tests-lint.test.mjs`
  - Scope: `tools/test/scope-tests-lint.test.mjs`
- [x] P1: Tell the Planner, where it writes scope, to name the test location itself — in `/plan`'s Architect checklist replace "covers every file the steps write" by the same sentence plus "and, when a step changes code that has tests, a line that names the test location (for example a tests folder glob or a single test file); a code-folder glob does not cover the tests under it"; the same sentence under the PRD template's scope block (replace "prefer folder globs" with "prefer folder globs for code, and name the test location") — product-agnostic wording, no language or framework names — `core/.claude/commands/plan.md`, `core/.claude/references/prd-template.md`
  - Scope: `core/.claude/commands/plan.md`, `core/.claude/references/prd-template.md`, `tools/test/scope-tests-lint.test.mjs` (the test that reads both files for the sentence)
- [x] S1: Make save-plan state the rule and run the new lint, with an eval case — the Read-Write Scope bullet in Plan rules gets the sentence; Phase 2 Shape line and the checklist add `node scripts/scope-check.mjs --tests --plan=<path>` → `SCOPE_TESTS: ok|skipped`, and a `warn` is shown to the Human with the fix (add a test-location line) but does not block the save; `evals.json` id 2 — pasted plan, scope `src/**` only; assertions: `--tests` was run, the warning was shown, the agent offered a test-location line, the plan was still saved — `core/.claude/skills/save-plan/SKILL.md`, `core/.claude/skills/save-plan/evals/evals.json`
  - Scope: `core/.claude/skills/save-plan/SKILL.md`, `core/.claude/skills/save-plan/evals/evals.json`, `tools/test/scope-tests-lint.test.mjs` (the test that reads SKILL.md and parses evals.json)
- [x] R1: Render the kit's own installed copies, run every check and add the changelog line — `node tools/sync.mjs --target . --apply`, then `node tools/drift-check.mjs --target .`, build, lint, `npm test`, the full `tools/test` suite and `node tools/orchestrator-e2e.mjs`; one CHANGELOG entry under Unreleased/Added in product-agnostic words, with no plan number — `scripts/**`, `.claude/**`, `docs/agent/**`, `.kit/install.json`, `CHANGELOG.md`
  - Scope: `scripts/**`, `.claude/**`, `docs/agent/**`, `.kit/install.json`, `CHANGELOG.md`, `tools/test/scope-tests-lint.test.mjs` (run, not edited)

## Technical Considerations
- **Warning, not error.** The lint prints and exits 0; `save-plan` shows the warning and the Human decides. A plan that
  truly changes code with no tests keeps working (the gate only blocks a *changed* test file).
- **What "steps change non-doc source" means here:** read from the scope lines, not from free-text sub-task targets
  (those are prose and not parsed anywhere). The hotspot files and the plan file are "always allowed" and not scope
  lines, so they never count as code.
- **Why a real-scripts test:** the unit tests of the gate's plan stubbed `orch-state.mjs` and missed a flag allow-list
  bug that only the end-to-end run found. L2 runs the installed scripts with the exact `orch-state.mjs diff` command
  line from `orchestrate.js`, so a flag change shows up as a red test, and `orchestrator-e2e.mjs` is a Done-when item.
- **Leak check:** shared files stay product-agnostic; the sentence in `plan.md` / `prd-template.md` / `SKILL.md` uses
  "a tests folder glob or a single test file", never a language, framework or the examples' extensions beyond `src/a.test.ts`
  style placeholders already used in `orchestrator.md`.
- **Alternatives dropped:** making `--tests` an error (would block docs-adjacent plans and plans with no testable
  code); parsing sub-task targets (prose, unreliable); adding the rule only to docs (the failure happens at save
  time, a sentence alone was already the state that failed).

## Out of Scope
- Changing the gate in `plan-scope.mjs` or `orch-state.mjs`; changing what counts as a test path.
- Editing plans 045–054 (their scopes are theirs; the lint will warn on them when next saved or rewritten).
- Auto-adding a test line to a plan, or a check on `/ship`'s side (the gate already covers a built branch).

## Critical Questions
- None open. Assumed: warning (not error) and scope-line based detection, as the brief says.

## Execution Notes
- Built in worktree `ai-workflow-kit-wt055` on `feat/055-planner-names-the-test-location` (main untouched). Evidence:
  `node --test tools/test/scope-tests-lint.test.mjs` → 12 pass; `node --test "tools/test/*.test.mjs"` → 342 pass, 0 fail;
  `npm test`, `node tools/pack-check.mjs`, `npm run lint` (0 leaks), `node tools/drift-check.mjs --target .` (0 undeclared),
  `node tools/orchestrator-e2e.mjs` all exit 0; own plan: `--tests` → `SCOPE_TESTS: ok`, `--diff=origin/main` → `SCOPE: ok`.
  The first run of the real-scripts test passed with no stub: `orch-state.mjs diff --run r --plan <nnn>` returns
  `testsOutOfScope` as the unit tests expect.
- Source: the Human's brief after plan 049 merged (`3d52a68`): the test-file gate is in `plan-scope.mjs` and
  `orchestrator.md` only; the Planner protocol and `save-plan` do not know it.
- Architect + PM review (Planner, 2026-11-01): similarity `no similar plans`; arch `INV-none`; every named file exists on
  `origin/main` (new: `core/scripts/lib/scope-tests-lint.mjs`, `tools/test/scope-tests-lint.test.mjs`); smallest version —
  no new gate, no change to 045–054. This repo is solo flow (no `.claude/todo.md`): the checkboxes above are the ledger.
