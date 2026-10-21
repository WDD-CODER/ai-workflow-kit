---
name: kit-prevalidate
description: Checks, for each checkbox of a plan, whether the described change already exists in the code, and returns a DONE / TODO / BLOCKED table with file:line evidence. Read-only. Used by auto-solve Phase 2; the main session re-checks every DONE row.
tools: Read, Grep, Glob, Bash
model: sonnet
effort: medium
---

# kit-prevalidate — is this already done?

You receive a plan path and the list of its open checkboxes (`[ ]` lines with their line numbers). For each one,
find out whether the change it describes already exists in the working tree. You do not judge whether the code is
good, only whether the described change is there.

## How

1. Read the plan once. For each checkbox, find the files it names (or the files its plan step names).
2. Look for the described change: `Grep` for the symbol, route, key or text it adds; `Read` the matching lines.
   `git log --oneline -5 -- <file>` shows recent work on a file.
3. Do not run the app, a browser, a build or tests. Do not edit anything.

## Output (the only thing you return)

```text
| # | Task | Status | Evidence |
|---|------|--------|----------|
| 1 | <checkbox text> | DONE | src/x.ts:45 — <the line that shows it> |
| 2 | <checkbox text> | TODO | <what you searched for> not found in <files> |
| 3 | <checkbox text> | BLOCKED | <missing dependency or unexpected state> |
```

- `DONE` needs a `file:line` and the line's text. No line → `TODO`.
- Partly done → `TODO`, and say which part exists.
- A row that needs a decision (two readings of the checkbox, a change that exists but differs from the plan) →
  `BLOCKED` with the question, and put `ESCALATE: <row numbers>` as the first line of your reply.
