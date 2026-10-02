---
status: accepted
date: 2026-09-15
review-by: 2027-03-15
---

# 0007. `/ship fast` decouples approval cadence from lane classification

## Context

`.claude/commands/ship.md` originally overloaded the word "fast" with two unrelated things:
(1) how much review a diff gets (Phase 0's FAST/REGULAR classification, and the review depth
Phase 2 runs based on it), and (2) how many times the Human gets asked to approve (Phase 4's
single-combined-reply vs. two-separate-stops). `/ship fast` forced both at once — skipping
real classification *and* collapsing the approval gates — because the only diffs that got the
convenient one-reply flow were ones Phase 0 (or a forced override) called small and safe.

This bit on a 2-file/46-line pure checkbox-flip diff: it was 6 lines over the FAST size cutoff,
so it classified REGULAR and needed two separate manual replies (commit, then merge) purely to
rubber-stamp already-clean work — nothing in between needed an actual decision. The fix the
Human wanted was narrower than "let me force FAST lane": they explicitly did not want
classification/review depth ever skipped (a diff touching `server/routes/auth.js` must still
get full review, always), they only wanted the *approval count* to drop from two to one when
nothing flagged a problem.

## Decision

Split the two concerns. Phase 0 classification is never forced by `fast` anymore — it always
runs for real, identical to bare `/ship` (only `/ship regular` still force-overrides, and only
in the safe direction of *more* scrutiny). `/ship fast` now means: after Phase 0 classifies
honestly and Phase 2 reviews at whatever depth that calls for, if nothing stopped the pipeline,
collapse Phase 4 + Phase 4.5 into one approval instead of two — regardless of which lane got
picked. A genuine review finding still hard-stops before Phase 4 is reached; `fast` never
touches that gate.

## Consequences

Easier: a Human confident about a change (including changes real classification put in
REGULAR) can say "ship fast" and get one approval covering commit through merge, without
granting a review-depth shortcut in the same breath. Harder / accepted: the word "fast" now
means two adjacent-but-different things across the file's history (old ADR-less behavior vs.
this one) — anyone reading an old session transcript that mentions `/ship fast` before
2026-09-15 is reading the old, classification-forcing meaning. No migration needed since this
is prompt-driven tooling, not a script with callers to update.

## Review

At the review-by date, check whether the `fast` flag has actually been used on REGULAR-lane
diffs as intended (single approval, full review still ran) — if usage data or session
transcripts show it consistently landing on small/FAST diffs only, the split may not have been
worth the added prose complexity and could be reconsidered.
