---
status: accepted
date: 2026-11-06
review-by: 2027-05-06
---

# 0017. The orchestrator loop is a script; only the builder and the reviewer are model calls

## Context

The orchestrator ran as a workflow (`.claude/workflows/orchestrate.js`) on a runtime with no file, git or clock
access, so every state write, note, diff, preflight and merge was a `kit-runner` model call on the mechanical tier. The
runner re-typed commands, mis-copied JSON and sometimes refused a state write. Measured: run-065 used 39 agent calls,
633k tokens and 74 minutes and stopped at the merge; run-513-516c used 51 calls and 755k tokens and merged 1 of 2 plans.
The sources the kit follows (Anthropic: simple composable patterns; Applied LLMs: deterministic code over LLM prompts,
workflows over agents) and the kit's 2026-11-05 decision point the same way. The kit already ran Claude headlessly
(`claude -p`) for its agent eval, and four flags were shown to cut a call's context to a few thousand tokens.

Rejected: keeping the workflow and moving more steps into `orch-state.mjs` (every step still needs a runner model call
to start it); a second agent for the gate or the merge (the work is mechanical; a model adds cost and failure modes).

## Decision

Approved by the Human on 2026-11-06 for the goal run (Arch-approved: Human 2026-11-06).

- `scripts/run-plans.mjs` is the orchestrator loop. Readiness lint, preflight, order, state (`orch-state.mjs`), gate,
  merge and its pin, park and report are code. The run branch `orch/<run>` and "the run never merges into main" are
  unchanged.
- Two model calls only, each one headless `claude -p` through `scripts/lib/claude-run.mjs` with `--setting-sources
  local --strict-mcp-config --disable-slash-commands --no-session-persistence`: the builder (`orch-builder.md`,
  `models.build`, escalation on `models.judgment` — INV-1 preserved) and the single reviewer (`plan-reviewer.md`,
  `orchestrator.reviewerModel`, default `opus`, the best arm of the kit's reviewer eval; never Haiku). The reviewer is advisory
  (`orchestrator.reviewerMode`) until its measured precision reaches 0.50.
- The merge takes the plan branch only at the head the gate and the review saw: `orch-state.mjs merge-verify` checks
  `HEAD^2 == checkedHead` before the one push (the merge pin, by script instead of a prompt instruction).
- Security: only the builder is pre-approved its tools; the reviewer gets narrow Bash patterns (git diff, git show,
  node --test), no write tool, and is refused when the branch under review holds its own `.claude/settings.local.json`
  (the one settings file `--setting-sources local` still reads). The gate's scope and manifest checks are the main
  folder's trusted code, on the scope as the run branch holds it, never the branch's own `scripts/` copies.

## Consequences

- A plan costs two model calls normally and five at worst; `calls.csv` records each call and gate command.
- A rate or usage limit pauses the run and retries once; a second one stops it for a relaunch after the reset.
- The project's hooks (the scope guard) do not run inside a headless call; the gate's trusted scope check replaces
  them. A builder can no longer extend its own scope block: it escalates instead.
- The workflow, its runner calls and the workflow-only config keys stay until a follow-up deletes them.

## Review

At review-by: compare runs before and after (calls, tokens, minutes, merged/parked per run from `docs/brain/run-log.md`
and `calls.csv`); check the reviewer's precision before switching `reviewerMode` to `gate`; check that no parked plan
was refused by the merge pin or the scope check wrongly.
