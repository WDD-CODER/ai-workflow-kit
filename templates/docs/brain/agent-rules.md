# Agent rules

Short rules every builder reads before it starts, learned from decisions the Human graded wrong (`docs/agent/decision-review.md`). Capped at 30 lines and 2,400 characters (`node scripts/decision-log.mjs rules --check`): to add a rule when full, merge or drop an older one.

- When the plan does not describe a behaviour (on edit, leave, cancel or error), do the simplest thing and log it as a `behaviour:` decision; never add a dialog, confirmation or automatic action.
