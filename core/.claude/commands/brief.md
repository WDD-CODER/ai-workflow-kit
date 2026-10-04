---
description: Capture or generate a session brief — source of truth for validation and session-wrap evaluation
allowed-tools: Read, Write, Grep, Glob, Bash
---

# /brief

Create a session brief. The brief is the contract that the /ship
agent evaluates against.

## Usage

- `/brief <description>` — generate brief from your description (proactive)
- `/brief` — auto-generate from session activity (retroactive)

## Step 1: Detect Mode

- If the user provided a description after `/brief` → **Proactive mode**
- If no description → **Retroactive mode**

## Step 2a: Proactive Mode

1. Parse the user's description
2. **Parent plan (required when executing from a Plan Contract):** identify `plans/<NNN>-*.plan.md`. If the brief extends an existing plan, record that path.
   - **Disk check (hard stop):** If a parent plan path is named and the file does **not** exist on disk → **STOP**. Do not write `brief.md`. Tell the Human the named plan is missing and offer exactly:
     `run save-plan now | proceed ad-hoc (parent plan: none) | cancel`
   - If the brief extends an existing plan that **does** resolve, and mid-flight work adds stages, append `[ ]` Atomic Sub-tasks to that plan **and** `.claude/todo.md` before execution (see `.claude/skills/save-plan/SKILL.md` Phase 4).
3. Generate session ID: `YYYY-MM-DD-{2-4-word-slug}` (lowercase, no special chars)
4. **Collision check:** If `.claude/sessions/{session-id}/` already exists → append `-2`, `-3`, etc.
5. Write brief to `.claude/sessions/{session-id}/brief.md` using template:

```markdown
## Goal
[one sentence from user input]

## Parent plan
[plans/NNN-slug.plan.md — or "none (ad-hoc)"]

## Scope
[inferred files/modules — or "TBD"]

## Out of Scope
[anything excluded — or "None stated"]

## Success Criteria
- [ ] criterion 1
- [ ] criterion 2

## Session ID
{session-id}
```

6. Print brief verbatim to user
7. Ask: "Brief captured. Confirm or adjust before I continue."
8. On confirmation → done. On adjustment → update brief.md, re-confirm.

## Step 2b: Retroactive Mode

1. Gather session activity:
   - `git diff --stat` (what files changed)
   - `git log --oneline -10` (recent commits)
   - Read `.claude/todo.md` for `[x]` tasks completed today
   - Scan conversation for key decisions and changes
2. Infer Parent plan from `.claude/todo.md` / conversation when known.
   - **Disk check (hard stop):** If a parent plan path is inferred/named and the file does **not** exist on disk → **STOP**. Do not write `brief.md`. Offer:
     `run save-plan now | proceed ad-hoc (parent plan: none) | cancel`
3. Synthesize into a brief using the same template (include Parent plan when known — or `none (ad-hoc)` after Human chooses ad-hoc)
4. Generate session ID from the synthesized goal
5. **Collision check:** same as Step 2a
6. Print: "Reconstructed from session activity. Adjust as needed."
7. On confirmation → write to `.claude/sessions/{session-id}/brief.md`
8. On adjustment → update, re-confirm.

## Completion

Output: `Session: .claude/sessions/{session-id}`

This line threads the brief through the session lifecycle — picked up by `/ship`
(legacy /ship automation is gone).
