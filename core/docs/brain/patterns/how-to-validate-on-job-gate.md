# Pattern: Attach user QA bullets to the job-validation gate

## Problem

Agents finished milestones with a JOB DONE ask, but Humans had to invent what to click to verify. A separate HOW TO VALIDATE instruction existed, yet after its loader command was deleted nothing enforced it — so validation felt complete while the useful checklist never appeared.

## Solution

1. Put HOW TO VALIDATE (`action → expected result`) on the same gate both agents already must hit: `docs/agent/job-validation.md` Path A (ship Phase 4) and Path B (chat `/done`).
2. Mirror the template in `AGENTS.md`, `.cursorrules`, `done.md`, and `ship.md` — one canonical rule body, thin copies.
3. If an old instruction path must remain for archive links, replace it with a stub that points at the canonical section — never a second live copy.
4. Cover happy path and any edge/failure rule the job introduced; allow opt-in `verify` after the checklist, not an upfront ask.

## When to use

Any execution job that needs Human validation of behavior (brief, milestone, feature, bugfix).

When NOT: pure planning / architecture turns with nothing behavioral to check — still prefer a one-line “no user-visible effect” note over omitting the section if you are already in a JOB DONE / ship Y flow.

See also: [[orphaned-instruction-file-looks-wired]]
