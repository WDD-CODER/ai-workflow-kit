---
status: accepted
date: 2026-11-07
review-by: 2027-05-07
---

# 0018. The workflow runtime is deleted; the checker pipeline stays as `/ship`'s default review

## Context

ADR 0017 made `scripts/run-plans.mjs` the orchestrator loop and left the older workflow
(`.claude/workflows/orchestrate.js`), its runner agent and the role agents only it called "until a follow-up deletes
them". Once `/orchestrate` ran the script and `/ship` stopped naming the runner, nothing started them, yet every session still loaded, listed and referenced them, and
the kit had grown to 25 commands, 17 agents and 45 scripts with no limit. A freeze keeps that weight; only a deletion
removes it, and only a test keeps it from coming back.

The five checker agents (`orch-check-plan`, `orch-check-bugs`, `orch-check-rules`, `orch-verify`, `orch-security`)
and `/review-it` are different: they are `/ship`'s default review (`review.ship = checkers`) until the single reviewer
(`plan-reviewer.md`) measures its precision on the reviewer eval.

Rejected: freezing the files behind a flag (the context cost stays); deleting the checkers with the rest (`/ship` would
lose its default review before the reviewer is measured).

## Decision

Approved by the Human on 2026-11-06 for the goal run, revised 2026-11-07 (Arch-approved: Human 2026-11-06, revised
2026-11-07).

- Deleted from `core/` and every installed copy: the workflow runtime, `/auto-solve`, and the agents `orch-gate`,
  `orch-merge`, `orch-report`, `orch-triage`, `orch-readiness`, `kit-runner`, `kit-prevalidate`. Every file stays
  recoverable from `fd212e1` (and earlier).
- Kept: the five checkers and `/review-it`, `orch-builder`, `plan-reviewer`, `orch-ui`, `git-agent`, `skill-judge`.
- `orch-state.mjs` keeps what `run-plans.mjs` and `lib/plan-gate.mjs` call (`note`, `flake`, `decisions`, `prepare`
  among them) and loses `trend`, `main-try`, `main-tries` and the base64 note, flake and cause queues;
  `decision-log.mjs stats` no longer writes a calibration file.
- A size budget (`tools/size-budget.json`, enforced by `tools/test/size-budget.test.mjs` in `npm test` and CI): at most
  24 command files (target 10), 10 agent files while the checkers stay (back to 5 when `review.ship` switches to
  `reviewer`), per-file line limits, `AGENTS.md` ≤ 70 lines, instruction load ≤ 800 (back to 600 when
  `job-validation.md` is shortened), 15 orchestrator keys (target 12). Raising a limit needs a plan that names it.

INV-1 is preserved: the judgment tier still runs the escalated builder and the first builder of a plan that names an
invariant; readiness, the third role it named, no longer exists.

## Consequences

- Sessions load and list fewer files; `/commands` and the agent list show nothing dead.
- A project's leftover keys of the old runtime are dropped with one `NOTE orchestrator: <key> removed` line each.
- The kit can no longer grow a command or agent past its budget without a plan that says why.
- Frozen plans that name a deleted file are rewritten by their Step 0 reality check when reopened.

## Review

At review-by: has any deleted piece been missed (a run, a project, a reopened plan)? Has the reviewer replaced the
checkers (`review.ship = reviewer`), so the agent budget can drop to 5? Has `job-validation.md` been shortened, so the
instruction load can drop to 600?
