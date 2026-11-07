---
status: accepted
date: 2026-11-07
review-by: 2027-05-07
supersedes: 0017-orchestrator-loop-is-a-script
---

# 0019. The runner's reviewer defaults to Sonnet; the reviewer eval decides any change of default

Supersedes: 0017 (the reviewer default only)

## Context

ADR 0017 made `scripts/run-plans.mjs` the orchestrator loop and named `opus` as the default of
`orchestrator.reviewerModel`, because Opus was the best arm of the kit's reviewer eval at that time
(`docs/agent-evals/087-reviewer-ab.md`, first `REVIEWER:` line: precision 0.12). The eval was then rescored (a finding
one severity level from the label matches) and rerun: Sonnet with the redact-gate prompt reached precision
0.29 (the latest `REVIEWER:` line in that file, `model=sonnet`), level with the checkers' 0.28, at $0.10 per case. The
Human approved Sonnet as the default on 2026-11-07. ADRs are superseded, never edited in place, so 0017's line about the
default is outdated and this ADR records the current rule.

Rejected: editing ADR 0017 in place (the brain keeps decisions append-only); keeping `opus` (the rescored eval no
longer names it).

## Decision

- `orchestrator.reviewerModel` defaults to `sonnet`. A project may still set another model; never Haiku (INV-1 is
  preserved — the reviewer stays off Haiku).
- A change of default follows the reviewer eval's `REVIEWER:` line in `docs/agent-evals/087-reviewer-ab.md`: the
  default is the model that line names, changed by a plan that cites the line.
- Everything else in ADR 0017 stands (the loop is a script; two model calls; the merge pin; the guard hooks).

## Consequences

- A run's review runs on the model the latest measurement names.
- The default can no longer drift from the measured evidence: a new `REVIEWER:` line that names another model needs a
  plan to change the default.

## Review

At review-by: does the latest `REVIEWER:` line in `docs/agent-evals/087-reviewer-ab.md` still name `sonnet`? Has the
reviewer's measured precision reached 0.50, so `reviewerMode` can switch to `gate`?
