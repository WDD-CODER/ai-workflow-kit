---
name: brief-detection
description: Recognizes a pasted Plan Contract, a structured brief, or a feature request written in plain prose in the user's message, and gates it before any other tool call — a Plan Contract goes to the Planner protocol or save-plan; a brief or a feature request gets the a/b/c choice (refine it with the Architect + PM review / plan it with /plan / just discuss). Use whenever a message has markdown H2 headers like `## Goal`, `## Scope`, `## Steps`, `## Rules`, `## Done when`, `## Milestones`, `## Atomic Sub-tasks` or a `# Plan` title, and whenever a message in the main folder asks in a few sentences to build, add, change, fix or remove something in the product — from any source (human paste, Cursor, another agent).
user-invocable: false
---

# Brief Detection Gate

Source-agnostic: it does not matter who sent the brief. The point of the gate is that a pasted plan or a feature request is a *proposal* until the Human says otherwise. Acting on it on sight has cost whole sessions, and so has skipping the review.

**Main folder or slot?** Several rules below depend on it. The SessionStart context tells you: an `IDLE SLOT` or `WORKER` line means a `{{slots.nameFormat}}` slot. Without that line, run `git branch --show-current` — the one tool call this gate allows before it is done (read-only). `main` in a folder with no `.worktree-root` file is the main folder.

## 1. Plan Contract shape check (always first)

Treat the text as a **Plan Contract** (not a brief) when any of these hold:

- it contains `## Milestones` or `## Atomic Sub-tasks` (case-insensitive)
- its H1 matches `# Plan …` or contains `Plan Contract`

Only the message's own top-level headers count: ignore headers inside fenced blocks or under a fixture / example section. A message whose top level has `## Goal` + `## Steps` + `## Done when` is a brief that *contains* a plan, not a Plan Contract — go to §2.

Then check `git branch --show-current`:

- **On `main` (Planner):** say `Detected Plan Contract — routing to the Planner protocol` and hand off to `.claude/commands/plan.md` Planner protocol steps 0–6 (Architect + PM review, pull, todo sync, overlap check, save-plan, commit, push). The review comes first: a received plan is checked against the codebase and its gaps shown before anything is saved. The Planner never starts the work; it ends on step 6's message.
- **Inside a `{{slots.nameFormat}}` slot (Worker, mid-brief save):** say `Detected Plan Contract — routing to save-plan` and hand off to `.claude/skills/save-plan/SKILL.md` Phase 0. No Architect + PM review here: that runs on every plan the Planner saves, and Workers do not author plans.

No a/b/c gate for a Plan Contract, and no plan file written here — save-plan does that.

## 2. Which gate (only when it is not a Plan Contract)

Count these H2 headers (case-insensitive) in the user's message:

`## Goal`/`## Objective` · `## Files to check first`/`## Scope`/`## Files` · `## Steps`/`## Implementation`/`## Tasks` · `## Rules`/`## Constraints`/`## Out of Scope` · `## Done when`/`## Success Criteria`/`## Acceptance`

| The message | Gate |
| --- | --- |
| 3+ markers | structured brief gate (§3) |
| fewer markers, and a feature request in prose (below), in the main folder | feature request gate (§3) |
| anything else | no gate — answer normally |

**A feature request in prose** meets all three:

- It asks to build, add, change, fix or remove something in the product.
- It is longer than one sentence.
- It does not end with a question mark.

It is never a feature request when it is:

- a question, or chat about the product — also a request phrased as a question ("Can you add X? …"): answer it, and offer the gate in one line if it turns out to be a change request;
- a small change: one file, a typo or a one-line fix ("Fix the typo in the header."). In the main folder, say in one line that code changes are made in a slot (`/feat`, or a plan), without the gate;
- a slash command, or `execute plan NNN`;
- a request to run, check, explain or review something;
- an answer to a question you just asked;
- sent in a `{{slots.nameFormat}}` slot (a Worker's messages are about its own plan).

When unsure, do not gate.

**Examples**

| Message | Gate |
| --- | --- |
| Add a favourites filter to the product list. Customers keep losing the items they reorder every week. | feature request |
| We need to export the order list as a CSV file. The warehouse prints it every morning. | feature request |
| Why does the order total round 0.5 up to 1? | none |
| Run the tests and tell me what fails. | none |
| Can you add a dark mode toggle? The header has room for it. | none (a question) |
| Fix the typo in the header. It says "Ordres". | none (a small change) |
| Can you explain how the slot ports are chosen? I keep mixing them up. | none |

## 3. Gate output (terse, no preamble)

Structured brief:

```
Detected structured brief: {one-line goal}.
{N} steps · {M} rules · {K} done-when criteria

How should I handle this?
a. Refine it with a review — the Architect + PM review, nothing saved (default)
b. Plan it — /plan reviews it and saves the plan; a Worker takes it in a slot
c. Discussion only — no review, no plan
```

Feature request in prose:

```
Looks like a feature request: {one-line goal}.
a. refine it with a review (default) · b. /plan it · c. just discuss
```

Stop and wait. Anything other than an explicit `b` or `c` ("yes", "go", blank) means **a**.

| Choice | Then |
| --- | --- |
| a | Run the **Architect + PM review** in `.claude/commands/plan.md` on the brief as written (its "On a brief" rules: codebase facts, Human decisions, testability, overlap). Print the `ARCHITECT + PM REVIEW` block, then ask its `open:` questions. Save nothing and write no plan. When the gaps are settled, offer **b**. |
| b | **Main folder (Planner):** run `/plan` with the brief. `/plan` reviews it, the Human approves it, and save-plan saves and pushes it. End with `/plan`'s hand-off: a Worker claims the plan in a free slot with `take-plan` ("execute plan NNN"). The Planner does not start the work. **In a slot (Worker):** if the brief belongs to this slot's plan, add its tasks to that plan (save-plan's mid-flight sync) and stay inside the plan's scope. Otherwise say it needs a plan from the main folder. |
| c | Acknowledge it and treat it as documentation. No review, no plan. |

## Scope of this skill

It writes no code and no plan files, reads no `docs/brain/`, pre-loads no standards, and invokes no other agent — the review and the save-plan hand-off are the same agent continuing.
