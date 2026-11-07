---
status: accepted
date: 2026-11-07
review-by: 2027-05-07
supersedes: 0016-judgment-roles-run-on-a-pinned-strong-model (the start-tier rule only)
---

# 0020. Only a plan that changes or deviates from an invariant starts its builder on the judgment tier

Supersedes: 0016 (the start-tier rule only)
Arch-approved: Human 2026-11-07 (`approve arch change INV-1` in chat)

## Context

ADR 0016 started the first builder on the judgment tier (Opus) for any plan whose Architecture Impact names an
invariant other than `INV-none`, `preserves` included. Almost every kit plan writes `INV-1: preserves`, so almost every
first builder ran on Opus though the plan left the invariant as it was. The first real run of `run-plans.mjs` (run
`first`, 2026-11-07) also showed the dry run printing `--model sonnet` while the real call used `--model opus`: the two
picked the model in two places.

Rejected: keeping the rule and narrowing INV-1's `Touches` instead (plans would still start on Opus for any other
invariant they only preserve); starting every plan on build and relying on escalation alone (a plan that rewrites a
registered rule deserves the strong tier from the start).

## Decision

- The first builder of a plan starts on `models.judgment` only when its Architecture Impact `changes` or `deviation`s
  an invariant. An entry whose kind cannot be read also starts there (fail safe).
- `preserves`, `INV-none` and a plan without the section start on `models.build`.
- The dry run and the real run build the builder's argv from one function (`builderCall()` in `scripts/run-plans.mjs`);
  the dry run prints the tier and why (`tier: build (INV-1 preserves)`).
- `calls.csv` records the model passed after `--model` on the call.
- Unchanged from 0016: `models.judgment` names a model (never inherit, never Haiku); a failed plan's fresh builder runs
  on it; if that builder fails, the plan parks for the Human.

## Consequences

Easier: most plans build on Sonnet; the dry run is the call the run makes, so a reader can trust it.
Harder / accepted: a plan that only preserves a sensitive invariant is built by the build tier first and reaches the
judgment tier only through escalation.

## Review

At the review-by date, compare fix rounds, escalations and parks of `preserves` plans against `changes` plans in the
run log. Many `preserves` plans escalating → widen the start rule again.
