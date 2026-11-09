# Plan 072 — Design rules are enforced: a configured design-rules file the builder and rules checker read, and unplanned UI element types flagged

Status: abandoned — obsolete: it changes the orchestrator workflow and agents that kit 2.1.0 / plan 090 deleted (scripts/run-plans.mjs replaced them); re-plan against run-plans.mjs if still wanted; closed 2026-11-09
Parked: 2026-11-05 — reliability freeze, revisit 2026-11-15
Depends-on: 070, 071
Snapshot: 5784d6d3de92d41b9b08de0161cf3c31a430a8b2
Source: FoodVibe run test-514-515 (PR #499) hand-off and eval file (Human, 2026-11-03); part 3 of 4 (070 records, 071 sorter, 073 quick-fix lane)

## Problem Statement
In run test-514-515 the Human's notes produced eight design rules (R1-R8), written to the project's `.interface-design/system.md`. No orchestrator agent reads that file: `orch-builder` reads `AGENTS.md` and the `## builder` rules, `orch-check-rules` reads `AGENTS.md` and the standards under `docs/agent/`, `orch-ui` reads no design file (hand-off section 4). Only FoodVibe's own `/design-port` command reads it. A rule written from notes is therefore enforced nowhere, and the same kind of break (a box inside a box, a native `details` element) can come back in the next plan.

Two builder choices also went unrecorded: the builder used a native `<details>` for "more details" and logged no decision, and nothing flagged it. The kit has no `scope-check --reuse` (it exists only as a FoodVibe override), and the rule in `docs/brain/agent-rules.md` asks for a decision only when a plan leaves a behaviour open, not a UI element type.

The kit has no design reviewer: plan 049 dropped one on 2026-11-01 ("a later plan"). The Human decided not to add a separate agent now: `orch-check-rules` and `orch-builder` read the design file, and this plan measures whether that is enough.

## Goals & Success Criteria
**Primary:** a project can name its design-rules file and its component-families file in its config; the builder follows the rules, the rules checker reports each break with the rule quoted, a break goes back to the builder as a fix round; a UI element type nobody planned is flagged and needs a logged decision or a question.

- [auto] `node --test tools/test/design-rules.test.mjs` passes, with tests that fail on today's code: the config accepts `design.rulesPath` and `design.familiesPath` (a missing file is refused by install and sync with one line); the install scan proposes the first existing of `.interface-design/system.md`, `DESIGN.md`, `docs/design-system.md` and never writes the file; with no path set nothing changes.
- [auto] `node --test tools/test/design-rules.test.mjs` passes with a test that the rendered `orch-builder.md` and `orch-check-rules.md` name the configured design-rules path when set and nothing when not (`KIT:if`), and that the workflow passes the path into the builder and the rules-checker prompts.
- [auto] `node --test tools/test/scope-check.test.mjs` passes, with tests that fail on today's code: `scope-check.mjs --ui-elements --base <ref>` lists each element type used in the changed lines that is not in the configured families file; with no families file it lists each element type used nowhere else in the app; element types already used elsewhere print nothing; the verdict is `UI_ELEMENTS: warn` (exit 0, never blocks).
- [auto] `node --test tools/test/orchestrator.test.mjs` passes with a test that a `UI_ELEMENTS` hit reaches the builder as "log a decision or raise a question", and the checkers' prompt asks whether that decision exists.
- [auto] `node --test tools/test/decision-log.test.mjs` passes with a test that an approved `design rule` row from a notes table is appended to the configured design-rules file under the section the table names (created when absent), once; a second apply adds nothing.
- [auto] `node tools/agent-eval.mjs --agent .claude/agents/orch-check-rules.md --cases docs/agent-evals/cases/orch-check-rules --runs 2` with the new cases (the original plan 515 diff, redacted, plus the design-rules file as it stood after round 1) reports the box-in-box break (R1) and the native-details break (R7). **Stop point:** if the agent misses either, this plan stops, the result is written in Execution Notes and the Human decides on a separate design reviewer that reads the builders' screenshots.
- [auto] `npm run build`, `node --test "tools/test/*.test.mjs"` and `node tools/leak-check.mjs` pass.
- [auto] `node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .` reports no drift.
- [human] On the next orchestrator run in a project that sets the design-rules path, a plan that breaks a written rule gets a fix round from the rules checker before the Human sees it.

## Execution Mode
- Parallel: no.
- Concurrent plans: none; plans 070 and 071 first (shared files: `decision-log.mjs`, `orchestrate.js`, `kit.config.json`).
- Isolated DB: no.
- Kit edits: one kit branch and one kit PR; commit per group.

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`, plus the append-only hotspot `CHANGELOG.md` (add an entry, never rewrite one).

```scope
core/.claude/agents/orch-builder.md
.claude/agents/orch-builder.md
core/.claude/agents/orch-check-rules.md
.claude/agents/orch-check-rules.md
core/.claude/workflows/orchestrate.js
.claude/workflows/orchestrate.js
core/scripts/scope-check.mjs
scripts/scope-check.mjs
core/scripts/decision-log.mjs
scripts/decision-log.mjs
core/docs/brain/agent-rules.md
docs/brain/agent-rules.md
tools/install.mjs
tools/lib/kit.mjs
kit.config.json
.kit/config.json
docs/agent-evals/cases/orch-check-rules/**
tools/fixtures/design/**
tools/test/design-rules.test.mjs
tools/test/scope-check.test.mjs
tools/test/decision-log.test.mjs
tools/test/orchestrator.test.mjs
CHANGELOG.md
```

## Read Scope

Entire repo, including `docs/agent-evals/`. The original diff is read from the project that made it (FoodVibe, `9d4efa81^1..9d4efa81`, read-only).

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry. Tags and releases: wait for the Human's go.

## Architecture Impact
- INV-none: preserves — adds config keys, a read-only check and prompt inputs; `docs/brain/invariants.md` (INV-1) is not touched and the design file stays project-owned.

## Step 0 — Reality Check
Confirm on `origin/main`: no kit file mentions `interface-design` or `DESIGN.md` (grep of `core/`, `packs/`, `layers/`, `templates/` was empty on `5784d6d`); `scope-check.mjs` has no `--reuse` (only `--diff`, `--tests`, `--arch`, `--deps`, `--overlap`); `orch-check-rules.md` reads `AGENTS.md` and `docs/agent/` standards. The original 515 diff lives in FoodVibe, not the kit: export it read-only with `git diff 9d4efa81^1 9d4efa81` and redact it (fixed placeholders for names, paths and Hebrew; keep the markup and style lines the rules concern).

## Atomic Sub-tasks

- [ ] D1: Let a project name its design-rules file and its component-families file, and let the installer propose them — config keys, a missing-file refusal, the install scan; the file stays project-owned — tools/install.mjs, tools/lib/kit.mjs, kit.config.json
- [ ] D2: Make the builder follow the design rules and the rules checker report each break, so a break goes back to the builder — both agents read the configured file, the workflow passes the path, a break is a finding that starts a fix round — core/.claude/agents/orch-builder.md, core/.claude/agents/orch-check-rules.md, core/.claude/workflows/orchestrate.js
- [ ] D3: Write an approved design rule into the design-rules file — appended under the section the sorted table names, once — core/scripts/decision-log.mjs
- [ ] U1: Flag UI element types in a diff that the plan did not fix and the app does not already use — a new check, never blocking; families file from config, else element types used nowhere else in the app — core/scripts/scope-check.mjs
- [ ] U2: Tell the builder to log a decision or raise a question for an unplanned UI element type, and tell the checkers to look for it — a rule in the builder rules, a line in the rules checker, the check's hit passed to the builder — core/docs/brain/agent-rules.md, core/.claude/agents/orch-builder.md, core/.claude/agents/orch-check-rules.md, core/.claude/workflows/orchestrate.js
- [ ] V1: Measure whether the rules checker catches the two breaks that reached the Human — evaluation cases from the original 515 diff and its design file; stop and report if R1 or R7 is missed — docs/agent-evals/cases/orch-check-rules/**, tools/fixtures/design/**
- [ ] T1: Add tests that fail on today's code for each group, resync installed copies and add a changelog entry — tools/test/design-rules.test.mjs, tools/test/scope-check.test.mjs, tools/test/decision-log.test.mjs, tools/test/orchestrator.test.mjs, CHANGELOG.md

## Technical Considerations
- A hit of the new check never blocks: it goes to the builder as "log a decision or raise a question", and the checkers see whether that decision exists (Human, 2026-11-03).
- The families file is project-owned and read from the project config; when a project has none, any element type in the diff that is used nowhere else in the app is flagged.
- FoodVibe's own `--reuse` override is left alone.
- Backend / API: none. Auth and validation: none. Security surface: none (read-only checks). Data / migration: none. Model changes: none. Project checks: none.

## Out of Scope
- A separate design reviewer (decided by the result of V1). The `orch-ui` agent. FoodVibe's override and its design files.
- Sorting notes (071), recording grades (070), the quick-fix lane (073).

## Critical Questions
- Q: Why no design agent? A: `orch-check-rules` already lists each break with the rule quoted; V1 measures that on the real diff, and the plan stops if it fails (Human, 2026-11-03).
- Q: Does a flagged element type block the builder? A: no; it is a warning that needs a decision or a question.

## Execution Notes
