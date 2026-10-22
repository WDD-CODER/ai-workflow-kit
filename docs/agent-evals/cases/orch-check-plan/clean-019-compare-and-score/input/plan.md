# Plan 019 — Agent Eval Harness: Measure an Agent Before Trusting It (excerpt)

Eval-case excerpt: only the comparison and scoring requirements and their two sub-tasks are kept. The rest of the
plan's changes (the command, the runner, fixtures, tests, docs) are outside this case and are not in diff.patch.

Status: active
Depends-on: 013

## Goals & Success Criteria
**Primary:** `node tools/agent-eval.mjs --agent <agent file> --cases <dir> --runs 2` prints recall, precision, cost and
noise for the cases, and exits non-zero below a given threshold.

- [auto] Structural comparison: a finding matches an expected one when `file`, `rule` and `severity` match (line within
  ±3, text ignored); proven by a unit test with a reworded finding that still matches.

## Functional Requirements

### Must Have (P0)
- [x] Case folder shape: `<role>/<case>/input/` (plan + diff, or page + card) and `expected.json` (findings by
  `file`/`rule`/`severity`, or `pass`/`fail`).
- [x] The harness runs the agent N times per case (default 2), compares structurally, reports recall, precision, cost
  (tokens from the run result) and run-to-run noise.

## Atomic Sub-tasks

- [x] A2: Compare an agent's findings with the expected ones by file, rule and severity, never by exact text — line tolerance, reworded findings still match — tools/lib/agent-eval/compare.mjs
- [x] A3: Compute recall, precision, cost and run-to-run noise over several runs per case — tools/lib/agent-eval/score.mjs

## Read-Write Scope

```scope
tools/lib/agent-eval/**
```
