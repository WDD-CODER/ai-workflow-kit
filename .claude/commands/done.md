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
3. Read the plan's Done-when tags (`job-validation.md` Path B). A `[ui]` item counts as agent-checked when its own e2e test passes (the project's e2e command, `commands.e2e` — servers up first) — evidence `✓ [ui] {item} — {test} → pass; screenshot {path}`; a failing or unscriptable one falls back to `[human]` and gets a card (`job-validation.md` Tier 1b). **All `[auto]`/`[ui]`:** run each check, print the `VERIFIED BY AGENT` block (raw command + output), mark with `node scripts/todo-query.mjs mark --line N[,N…] --auto-verified` (plan file only inside a `wt-N` slot), run step 4's archive, and **do not wait**. **Any `[human]`/untagged item:** first run "Servers first" (`job-validation.md`: start the servers — `node scripts/slot-serve.mjs` in a slot — and make every page URL in the cards answer; no app check → no servers), then print `VERIFIED BY AGENT` on top (if any `[auto]`), then the close-out block (HOW TO VALIDATE with a card for only the `[human]` items, then JOB DONE) and **wait** (unless the Human’s invoking message already contains a validation phrase: `done` / `mark done` / `mark it` / `verified` / `approved` / `LGTM for this job`):

```text
HOW TO VALIDATE - {N} checks on {P} places
Reply any time, page by page: ok: <numbers> | failed: <numbers> <what you saw> | done | not yet | verify
Open all pages (paste in PowerShell):
Start-Process "{url 1}"; Start-Process "{url 2}"
==========================================================

PAGE: {Page name}
URL:  {full URL}

[1] {plain title}
    Before: {only when needed}
    Do:
      a) {action}, paste:
         {exact value, alone on its line}
    Expect: {success}
    Fail:   {only when needed}

[2] …

==========================================================

PLACE: {exact window}

[3] …

JOB DONE — awaiting your validation
Matched todos (still [ ]):
  - …
Reply: ok: <numbers>  |  failed: <numbers>  |  done  |  not yet  |  verify  |  edit list
```

Card rules: `docs/agent/job-validation.md` → **Format** and **Card rules** (plain terminal text, grouped by place in click order, numbers run on; every value to type alone on its own line, in English unless it is literal Hebrew app data). Never omit HOW TO VALIDATE (use a one-line no-user-visible-effect note if needed). No `/ship`, PR or merge until the Human answered.

4. On **`done`** (or equivalent validation phrase):
   - Mark matching items `[x]` via `node scripts/todo-query.mjs mark --line N[,N…]`
   - Run `node scripts/todo-archive.mjs` to move any fully-`[x]` plan sections into `.claude/todo-archive/NNN.md` volumes (max 300 lines)
   - If committing in this turn → stage todo/plan files with that commit
   - Else → leave marks on disk and report: `Todo: marked [x] (uncommitted — include in next commit)`
5. On **`not yet`** → leave `[ ]`; ask what remains. On **`failed: <numbers>`** → leave `[ ]`; start fixing those checks at once (do not wait for the other pages), re-check, re-show only their cards as `(re-check: fixed)`; wait again. On **`ok: <numbers>`** → record exactly those cards as validated and keep waiting for the rest (`job-validation.md` → "Faster hand-off"). Print the "Open all pages" line only after the servers answer, and seed the data the cards need yourself.
6. On **`edit list`** → revise matches; re-show block; wait again.
7. On **`verify`** → walk checklist items per job-validation optional agent-verify; re-show JOB DONE; wait.

## Hard rules

- Never self-mark `[human]` or untagged items without Human validation.
- Never invent completion for unrelated open todos.
- Never show JOB DONE without HOW TO VALIDATE above it.
- `/ship` Approve **Y** remains the formal path (todos in the same ship commit). Use `/done` when there is no ship.
- Cards are shown once, here. A later `/ship` prints `VALIDATED BY HUMAN` and never repeats them (`job-validation.md` → "When that moment is").
