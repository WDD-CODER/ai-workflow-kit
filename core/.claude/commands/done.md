---
description: Validate a finished job (chat path) — close-out ask, then mark matching todos [x]
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# /done — Job validation (chat path)

Lightweight path when a job finished in chat and the Human is **not** running full `/ship`.  
Follow `docs/agent/job-validation.md` Path B exactly.

## Steps

Do not Read .claude/todo.md in full.

1. Identify the job just completed (this chat / Human-named task).
2. Run `node scripts/todo-query.mjs open` (add `--plan NNN` when the job maps to a known plan) and find matching open `[ ]` items — and the plan's Atomic Sub-tasks (same IDs when present).
3. Read the plan's Done-when tags (`job-validation.md` Path B). **All `[auto]`:** run each check, print the `VERIFIED BY AGENT` block (raw command + output), mark with `node scripts/todo-query.mjs mark --line N[,N…] --auto-verified` (plan file only inside a `{{slots.nameFormat}}` slot), run step 4's archive, and **do not wait**. **Any `[human]`/untagged item:** print `VERIFIED BY AGENT` on top (if any `[auto]`), then the close-out block (HOW TO VALIDATE listing only the `[human]` items, then JOB DONE) and **wait** (unless the Human’s invoking message already contains a validation phrase: `done` / `mark done` / `mark it` / `verified` / `approved` / `LGTM for this job`):

```text
HOW TO VALIDATE
- {action} → {expected result}
- …

JOB DONE — awaiting your validation
Matched todos (still [ ]):
  - …
Reply: done  |  not yet  |  verify  |  edit list
```

Bullet rules: `docs/agent/job-validation.md` → **HOW TO VALIDATE checklist**. Never omit HOW TO VALIDATE (use a one-line no-user-visible-effect note if needed).

4. On **`done`** (or equivalent validation phrase):
   - Mark matching items `[x]` via `node scripts/todo-query.mjs mark --line N[,N…]`
   - Run `node scripts/todo-archive.mjs` to move any fully-`[x]` plan sections into `.claude/todo-archive/NNN.md` volumes (max 300 lines)
   - If committing in this turn → stage todo/plan files with that commit
   - Else → leave marks on disk and report: `Todo: marked [x] (uncommitted — include in next commit)`
5. On **`not yet`** → leave `[ ]`; ask what remains.
6. On **`edit list`** → revise matches; re-show block; wait again.
7. On **`verify`** → walk checklist items per job-validation optional agent-verify; re-show JOB DONE; wait.

## Hard rules

- Never self-mark `[human]` or untagged items without Human validation.
- Never invent completion for unrelated open todos.
- Never show JOB DONE without HOW TO VALIDATE above it.
- `/ship` Approve **Y** remains the formal path (todos in the same ship commit). Use `/done` when there is no ship.
