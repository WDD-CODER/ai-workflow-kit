---
status: accepted
date: 2026-11-02
review-by: 2027-05-02
---

# 0016. Judgment roles run on a pinned strong model; a failed fix round hands over to a fresh strong builder

## Context

`models.judgment` defaulted to `inherit` (the main session's model). The orchestrator's readiness check and the fresh
builder that takes over after a failure both run on that tier, so a session on a weak model judged readiness and
rebuilt a failed plan on the same weak model. The first orchestrator test run (finding F9) showed it. A plan that only
`preserves` an invariant also started on `build`, so the plans that touch a registered rule were not built by the
strong tier.

Rejected: keeping `inherit` as an option with a warning (the weak-session case stays possible and nobody reads the
warning); a dated model id in the kit (goes stale — the `opus` alias is resolved by Claude Code at run time).

## Decision

INV-1 (`docs/brain/invariants.md`), approved by the Human on 2026-11-02 (`approve arch change INV-1`):

- `models.judgment` names a model, default `opus`; install and sync refuse `inherit` and any Haiku value for it.
- Readiness and the fresh builder always run on it, as an explicit `model` on the call.
- A plan whose Architecture Impact names any invariant other than `INV-none` starts its builder on it.
- Builders otherwise start on the build tier (Sonnet). After one failed fix round, whatever `maxFixRounds` is, a fresh
  judgment-tier builder takes over from the hand-off file, the plan and the branch diff. The script writes that file
  (`Done:` from the plan's ticked sub-tasks and the branch diff, `Failed:` from the gate and checker results), never
  from the failed builder's receipt or transcript.
- If that builder fails too, the plan is parked as `needs the Human`. No third builder is started.

## Consequences

Easier: a hard plan is never judged or rebuilt by a weak session model; the Human sees where a failure stopped.
Harder / accepted: projects that set `models.judgment` to `inherit` (or all tiers to `inherit` to turn routing off) are
refused at install and sync until they name a model, and their readiness and escalation calls cost Opus. Plans that
name an invariant (even only `preserves`) start on Opus; INV-1's `Touches` is narrow on purpose so most plans stay
`INV-none` and build on Sonnet.

## Review

At the review-by date, compare Opus-start plans against Sonnet-start plans in the run log: fix rounds, escalations and
parked plans per plan. Many Opus starts that Sonnet would have built in one round → narrow the start rule.
