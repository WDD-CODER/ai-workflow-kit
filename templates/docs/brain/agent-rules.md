# Agent rules

Short rules each orchestrator role reads before it starts, learned from decisions the Human graded wrong (`docs/agent/decision-review.md`). One section per role: `builder` (read by `orch-builder` and `/take-plan`), `checkers` (the three finders and the verifier), `readiness`, `ui`. Each section is capped at 30 lines and 2,400 characters (`node scripts/decision-log.mjs rules --check`): to add a rule when a section is full, merge or drop an older one. A rule marked `(pending — seen once)` was started by the first graded mistake of its kind; the second one promotes it. `enforce candidates` lists mistakes a check, a hook or a test could catch instead of a rule; no agent reads that section.

## builder

- When the plan does not describe a behaviour (on edit, leave, cancel or error), do the simplest thing and log it as a `behaviour:` decision; never add a dialog, confirmation or automatic action.

## checkers

## readiness

## ui

## enforce candidates
