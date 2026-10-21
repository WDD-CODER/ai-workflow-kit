# Plan 019 — Agent Eval Harness: Measure an Agent Before Trusting It

Status: draft
Snapshot: 3511799
Depends-on: 013

## Problem Statement
Which model should the checker and the verifier run on? Research says pipeline structure matters more than model size,
but no one in this kit has a number. The project QA system labels no finding as true or false, so there is no precision
figure either. Without a measurement, a model change or a prompt edit to a role agent is a guess, and the orchestrator's
first real run would rely on untested agents.

This plan adds a small harness: run one agent definition against a folder of cases and report recall, precision, cost
and run-to-run noise. The tool lives in the kit; the real cases live in each project (decision D7).

## Prerequisites
- Plan 013 merged (the agents exist and have result schemas).

## Goals & Success Criteria
**Primary:** `node tools/agent-eval.mjs --agent <agent file> --cases <dir> --runs 2` prints recall, precision, cost and
noise for the cases, and exits non-zero below a given threshold.

- [auto] `node --test tools/test/agent-eval.test.mjs` passes. It runs the harness with a stub runner (no model call) on
  the kit fixture cases and checks: a perfect stub scores recall 1.0 / precision 1.0; a stub that misses one expected
  finding scores recall below 1.0; a stub that adds one extra finding scores precision below 1.0; two runs whose
  results differ report a non-zero `noise`; `--min-recall 0.9` exits 1 when recall is 0.8.
- [auto] Structural comparison: a finding matches an expected one when `file`, `rule` and `severity` match (line within
  ±3, text ignored); proven by a unit test with a reworded finding that still matches.
- [auto] The kit fixture cases under `tools/fixtures/agent-evals/` contain no project name, path or port
  (`node tools/leak-check.mjs` passes).
- [auto] `node tools/install-check.mjs`, `pack-check`, `e2e-check`, `workflow-link-check`, `acceptance-check --e2e`
  pass; `node tools/drift-check.mjs --target .` reports no drift.
- [human] A first project case set of about 20 cases built from real data (the MVP run validation outcome and ~20
  labelled QA findings), and a baseline recorded for the checker and the verifier on Opus, Sonnet and Haiku. Dandan
  supplies the labels; the Planner records the result in the project's `docs/agent-evals/BASELINE.md`.

## Execution Mode
- Parallel: yes — only new files and `tools/lib/**`; 014 may run alongside.
- Concurrent plans: 014 (no shared files).
- Isolated DB: no.
- Kit edits: kit branch `feat/019-agent-eval-harness` + kit PR; Dandan merges. Release: with 013 (the baseline must
  exist before 014's first real run).

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`.

```scope
tools/agent-eval.mjs
tools/lib/agent-eval/**
tools/fixtures/agent-evals/**
tools/test/**
tools/e2e-check.mjs
core/docs/agent/agent-evals.md
docs/agent/agent-evals.md
CHANGELOG.md
```

## Read Scope

Entire repo. Analysis and architectural suggestions are expected.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside the
`## Read-Write Scope` above: STOP, tell the Human the file, the exact change, and why it can't be done in-scope; offer
`approved: <path>`; then append the path to the scope block above and retry.

## Architecture Impact
- INV-none: preserves — a kit-side developer tool; it is not installed into projects and changes no workflow rule.

## Step 0 — Reality Check

Runs only when `scope-check.mjs --drift` reports `REALITY: drift`. Check the listed commits by symbol and print one line
per commit: `ok` or `conflict: <what>`. STOP for a go only on a `conflict`.

## User Stories
- As Dandan, I want to see recall, precision and cost for Opus vs Sonnet vs Haiku on the checker so that I pick the model
  from data.
- As the Planner, I want a gate that fails when an agent prompt change makes results worse.

## Functional Requirements

### Must Have (P0)
- [ ] Case folder shape: `<role>/<case>/input/` (plan + diff, or page + card) and `expected.json` (findings by
  `file`/`rule`/`severity`, or `pass`/`fail`).
- [ ] The harness runs the agent N times per case (default 2), compares structurally, reports recall, precision, cost
  (tokens from the run result) and run-to-run noise.
- [ ] A runner interface so tests use a stub and real use calls Claude Code non-interactively with the agent file.
- [ ] `--min-recall` / `--min-precision` thresholds set the exit code.

### Should Have (P1)
- [ ] `--model <id>` overrides the agent's model so one agent file is compared across models.

### Nice to Have (P2)
- none

## UI/UX Notes
- A table per run: case, recall, precision, noise, tokens; a total line.

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [ ] A1: Define the shape of an eval case so projects can add their own real cases — input folder and expected findings file, documented with a generic example — core/docs/agent/agent-evals.md, tools/fixtures/agent-evals/
- [ ] A2: Compare an agent's findings with the expected ones by file, rule and severity, never by exact text — line tolerance, reworded findings still match — tools/lib/agent-eval/compare.mjs
- [ ] A3: Compute recall, precision, cost and run-to-run noise over several runs per case — tools/lib/agent-eval/score.mjs
- [ ] A4: Add the command that runs one agent file against a case folder and prints the table — stub runner for tests, real runner calls Claude Code non-interactively; thresholds set the exit code; model override flag — tools/agent-eval.mjs, tools/lib/agent-eval/run.mjs
- [ ] A5: Ship generic kit cases for the checker and the verifier, free of any project fact — a seeded off-by-one, a regex that loses a backslash, a claim with no evidence, a refutable false alarm — tools/fixtures/agent-evals/
- [ ] A6: Test the harness with a stub agent and wire it into the kit checks — perfect, missing, extra and noisy stubs; threshold exit codes; leak-check clean; CHANGELOG entry — tools/test/agent-eval.test.mjs, tools/e2e-check.mjs, CHANGELOG.md

## Technical Considerations
- Dependencies: agent files from plan 013 and their result schemas; `tools/lib/agent-result.mjs`.
- New files needed: `tools/agent-eval.mjs`, `tools/lib/agent-eval/*`, fixtures, test, `core/docs/agent/agent-evals.md`.
- Model changes: none.
- Backend / API: none.
- Auth and validation: none.
- Security surface: the real runner spends tokens and runs an agent on supplied input; it runs read-only agents only and
  refuses an agent file whose `tools:` includes Edit or Write unless `--allow-write` is passed.
- Data / migration: none.
- Project checks: none.

## Out of Scope
- Building the project's real case set (the `[human]` item; inputs arrive later from Dandan).
- Choosing the final models (the baseline informs it; a separate small change updates `kit.config.json` defaults).
- The UI validator's evals beyond the case shape (page + card inputs are defined, not populated).

## Critical Questions
- none

## Execution Notes
Review (Planner, 2026-10-21): fixed — brief's "plan 016" renumbered 019; real cases stay in each project (D7); the
harness refuses write-capable agents by default. Q4 default stays Sonnet finders + Sonnet verifier until the baseline.
Checked: 012, 013, 015, 016.
