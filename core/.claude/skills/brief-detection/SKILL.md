---
name: brief-detection
description: Recognizes a pasted structured brief or Plan Contract in the user's message and gates execution — Plan Contracts route to the Planner protocol or save-plan, briefs get the a/b/c choice (refine / execute / discuss) before any tool call. Use whenever a message contains markdown H2 headers like `## Goal`, `## Scope`, `## Steps`, `## Rules`, `## Done when`, `## Milestones`, `## Atomic Sub-tasks`, or a `# Plan` title, from any source (human paste, Cursor, another agent).
user-invocable: false
---

# Brief Detection Gate

Source-agnostic: it does not matter who sent the brief. The point of the gate is that a pasted plan is a *proposal* until the Human says otherwise; executing it on sight has cost whole sessions.

## 1. Plan Contract shape check (always first)

Treat the text as a **Plan Contract** (not a brief) when any of these hold:

- it contains `## Milestones` or `## Atomic Sub-tasks` (case-insensitive)
- its H1 matches `# Plan …` or contains `Plan Contract`

Then check `git branch --show-current`:

- **On `{{git.mainBranch}}` (Planner):** say `Detected Plan Contract — routing to the Planner protocol` and hand off to `.claude/commands/plan.md` Planner protocol steps 1–6 (pull, todo sync, overlap check, save-plan, commit, push). The Planner never starts execution; it ends on step 6's message.
- **Inside a `{{slots.nameFormat}}` slot (Worker, mid-brief save):** say `Detected Plan Contract — routing to save-plan` and hand off to `.claude/skills/save-plan/SKILL.md` Phase 0.

No a/b/c gate for a Plan Contract, and no plan file written here — save-plan does that.

## 2. Brief markers (only when it is not a Plan Contract)

Count these H2 headers (case-insensitive) in the user's message:

`## Goal`/`## Objective` · `## Files to check first`/`## Scope`/`## Files` · `## Steps`/`## Implementation`/`## Tasks` · `## Rules`/`## Constraints`/`## Out of Scope` · `## Done when`/`## Success Criteria`/`## Acceptance`

| Markers | Action |
| --- | --- |
| 3+ | show the gate below |
| 2 | ambiguous — do not gate, just answer |
| 0–1 | not a brief |

## 3. Gate output (terse, no preamble)

```
Detected structured brief: {one-line goal}.
{N} steps · {M} rules · {K} done-when criteria

How should I handle this?
a. Refine first — discuss before any execution (default)
b. Execute as-is — /feat (or /plan → one milestone → /review-it)
c. Discussion only — no execution
```

Stop and wait. Anything other than an explicit `b` or `c` ("yes", "go", blank) means **a**.

| Choice | Then |
| --- | --- |
| a | discussion mode; do not trigger `/plan` or execution |
| b | `/feat` (or `/plan` with the brief); after the Human approves the Plan Contract, execute **one milestone**, write the session file, stop, then `/review-it` |
| c | acknowledge and treat as documentation |

## Scope of this skill

It writes no code and no plan files, reads no `docs/brain/`, pre-loads no standards, and invokes no other agent — the save-plan hand-off is the same agent continuing.
