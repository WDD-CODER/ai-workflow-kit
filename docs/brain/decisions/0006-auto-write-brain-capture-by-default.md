---
status: accepted
date: 2026-07-20
review-by: 2027-01-31
supersedes: 0003 (confirm-to-write clause only)
---

# 0006 — Auto-write brain capture by default; opt-out per ship

## Context

ADR 0003 made brain capture auto-evoked at push/PR/Merge Gate, but kept a mandatory
separate Human reply (`brain approve` / `brain skip` / `brain edit …`) before any write,
distinct from the code approval (`Y` / `merge`). In practice this produced two different
behaviors in the same pipeline: `/ship` Phase 4 already rides the code-approval `Y` for
brain writes (`docs/agent/brain-capture.md` — "no separate Y/N for the brain entry"), but
the Phase 4.5 Post-push Merge Gate required its own separate `brain approve` token. On
2026-07-20 this inconsistency surfaced directly: a Human replied `merge` to close the
Merge Gate and the agent withheld the already-shown, already-gate-passed gotcha draft
pending a second, separate reply — friction the Human then asked to remove.

ADR 0004 (full-draft proposals + usefulness gate) is the reason unsupervised proposals
were survivable in the first place — thin one-liner slogans were the actual failure mode
being guarded against, not the absence of a second Human reply. The usefulness gate and
full-draft-body requirement stand independent of who ultimately clicks "write."

## Decision

Brain entries that already clear the ADR 0004 usefulness gate and carry a full draft body
**auto-write** on the reply that closes the surrounding gate — `Y` (Phase 4, unchanged) or
`merge` / `later` / `open-pr-only` (Phase 4.5 Merge Gate, changed). No separate `brain
approve` reply is required at either gate.

**Opt-out, not silent-write:** the Human still sees the full draft body before that reply
(unchanged — the banner + fenced draft is shown first). Saying `no brain` / `skip brain` /
`brain skip` alongside (or instead of) the gate reply drops the write for that ship —
same effect as the old `brain skip`, just no longer the required default path. `brain
edit …` still revises the draft before it writes.

This supersedes only the confirm-to-write *separate-reply* consequence of ADR 0003 (and
ADR 0002's original framing of the same). The rest of 0003 stands: capture is still
auto-evoked at push/PR/Merge Gate, drafting still happens in the agent session (never in
CI), and the usefulness gate (0004) still applies unchanged — a thin proposal still gets
skipped as `none durable` regardless of this change.

## Consequences

Easier: one fewer reply round-trip per ship; Phase 4 and Phase 4.5 now behave the same
way instead of diverging. Harder: a Human who approves a merge/push quickly without
reading the fenced draft first now accepts that draft by default rather than by a
deliberate second step — the safeguard against that is unchanged from before (the draft
is short, one screen, shown directly above the reply prompt), not a new one. Re-evaluate
if entries start landing that the Human would not have approved on a second look — that
would mean the usefulness gate alone isn't sufficient without the second reply, which
this ADR currently assumes.

## Review

At review-by: pull the entries written since 2026-07-20 — has any been flagged by the
Human as unwanted after the fact (via a later edit or removal)? If yes more than once,
reconsider whether a lightweight post-write digest (not a pre-write gate) is needed
instead of reverting to a separate approval reply.
