---
name: brief-detection
description: Detects structured briefs in user messages and gates execution. Source-agnostic.
---

# Brief Detection Gate

**Skill:** brief-detection
**Source-agnostic** — does not check who sent the brief.

## Trigger

### Plan Contract shape check (runs FIRST)

Before counting brief H2 markers, inspect the pasted text for Plan Contract shape.
Treat it as a **Plan Contract** (not a brief) when any of these are true:

- Contains `## Milestones` or `## Atomic Sub-tasks` (case-insensitive heading match)
- H1 matches `# Plan …` or contains `Plan Contract`

On Plan Contract shape, check `git branch --show-current`:

- **On `main` (Planner):**
  ```
  Detected Plan Contract — routing to the Planner protocol
  ```
  Hand off to `.claude/commands/plan.md` **Planner protocol**, steps 1–6 (pull, todo sync,
  overlap check, save-plan, commit, push) — not save-plan alone. The Planner never starts
  execution itself; it ends on step 6's message.
- **Inside a `{{slots.nameFormat}}` slot (Worker, mid-brief plan save):**
  ```
  Detected Plan Contract — routing to save-plan
  ```
  Hand off to `.claude/skills/save-plan/SKILL.md` **Phase 0** directly.

Do **not** show the a/b/c brief gate. Do **not** write plan files here — save-plan does.

### Brief H2 markers (only if Plan Contract shape did NOT match)

User's first message in a turn contains 3+ of these markdown H2 headers (case-insensitive):

- `## Goal` or `## Objective`
- `## Files to check first` or `## Scope` or `## Files`
- `## Steps` or `## Implementation` or `## Tasks`
- `## Rules` or `## Constraints` or `## Out of Scope`
- `## Done when` or `## Success Criteria` or `## Acceptance`

### Threshold

| Markers found | Action |
|---|---|
| 3+ (and no Plan Contract shape) | Trigger brief a/b/c gate |
| 2 | Ambiguous — do NOT auto-gate |
| 0–1 | Not a brief — no action |

## Gate Output (terse, no preamble)

```
Detected structured brief: {one-line goal extracted}.
{N} steps · {M} rules · {K} done-when criteria

How should I handle this?
a. Refine first — discuss before any execution (default)
b. Execute as-is — /feat (or /plan → Contractor one milestone → /review-it)
c. Discussion only — no execution
```

**Stop. Wait for user choice before any tool calls.**

## Routing

| Choice | Action |
|---|---|
| `a` | Discussion mode — do NOT auto-trigger `/plan` or Contractor execution |
| `b` | Invoke `/feat` (or `/plan` with the brief). After Human approves the Plan Contract: Contractor executes **one milestone**, writes `/sessions/[date].md`, stops; then `/review-it`. Do **not** invoke retired `/plan-implementation` or `/execute-it`. |
| `c` | Acknowledge, treat as documentation — no execution |

**Default:** Anything other than a/b/c (e.g., "yes", "go", blank) → option `a` (Refine first).

## Override

If Plan Contract shape also matches, still route to save-plan (shape check wins).

## What this skill does NOT do

- Does not write or modify code
- Does not write plan files under `plans/` (hands Plan Contracts to save-plan)
- Does not consult second-brain (`docs/brain/`) or optional MCP memory tools
- Does not invoke other agents (save-plan handoff is same-agent skill follow-through)
- Does not pre-load standards files
