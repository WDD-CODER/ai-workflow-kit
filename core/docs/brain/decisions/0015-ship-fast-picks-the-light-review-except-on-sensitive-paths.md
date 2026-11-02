---
status: accepted
date: 2026-11-02
review-by: 2027-05-02
supersedes: 0007-ship-fast-decouples-approval-from-classification
---

# 0015. `/ship fast` picks the light review on a REGULAR plan branch, except on sensitive paths

## Context

ADR 0007 split `/ship fast` from review depth: `fast` only collapsed the two approvals into one, and Phase 2 reviewed
at whatever depth the lane called for, because a diff touching an auth route must always get full review.

A REGULAR `/ship` on a plan branch now runs the `/review-it` checker pipeline (three finders and a verifier on the
review tier) instead of the single `/review` pass, when `review.ship` is `checkers` (the default). That makes plain
`/ship` heavier and slower. The Human wants `/ship fast` to stay quick. Applied to the new default, 0007 would make
`fast` run the full checker pipeline too.

Rejected: `fast` always picks the light review (an auth or secrets diff shipped with `fast` would lose the checkers,
the case 0007 was written for); keeping 0007 as it is (`fast` stops being fast on every plan branch).

## Decision

On a REGULAR plan branch with `review.ship` = `checkers`, `/ship fast` runs the light review (`/review`, the depth
0007 guaranteed) instead of the checker pipeline — unless `node scripts/ship-prep.mjs --json` reports a sensitive
path (`sensitiveMatches` not empty); then the checkers run as for plain `/ship`. Lane classification is unchanged
(`fast` never forces a lane), `--skip-review` keeps its meaning, and plain `/ship` and `/ship regular` keep the
checkers. The single approval of 0007 stays.

## Consequences

Easier: `/ship fast` costs what it cost before the checkers came in. A sensitive diff still gets the strongest review.
Harder / accepted: `fast` again changes review depth in one case (a plan branch with no sensitive path), so the word
means "one approval, and the light review where that is safe". The review fact line records `light (fast)`, so the
cost and the findings of the modes stay comparable.

## Review

At the review-by date, compare the `- review:` fact lines of plans shipped with `light (fast)` against `checkers`:
the findings each caught, minutes, and any defect found after a `light (fast)` ship that the checkers would have
caught. Many such misses → the sensitive-path exception is too narrow.
