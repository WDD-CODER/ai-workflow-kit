# Sweep Stale Todos

Scan `todo.md` for plan sections where all items are `[x]` and no safety exceptions apply. Archive qualifying sections via `node scripts/todo-archive.mjs` into numbered `.claude/todo-archive/NNN.md` volumes (max 300 lines).

## When to Run

- Automatically during session-end (prompted by `session-end.mdc`)
- After a series of commits
- Manually on demand

---

## Steps

Do not Read .claude/todo.md in full.

### Step 1 — Sweep
Run:
```bash
node scripts/todo-query.mjs sweep
```
This identifies all-`[x]` plan sections (excluding any containing `(deferred)`, `(skipped)`, or `[~]` — reported as "contains deferred items"), then verifies each remaining candidate against `git log --oneline -i --grep=<plan number>` and, if `gh` is available, `gh pr list --state merged --search <plan number>`. Each candidate comes back marked `verified` or `unverifiable`.

### Step 4 — Archive via script
If Step 1's sweep marked any candidate **unverifiable**, stop and report them under Sections Kept — do **not** run the script until the Human confirms.

Otherwise run:

```bash
node scripts/todo-archive.mjs
```

The script moves every all-`[x]` section (skipping deferred/skipped/`[~]`) from `todo.md` into the latest `.claude/todo-archive/NNN.md` volume, rolling to `NNN+1` when an append would exceed 300 lines. No hand-edits to a monolithic `todo-archive.md`.

### Step 6 — Report

```markdown
## Stale Todo Sweep — [Date]

### Sections Archived
- Plan NNN: [title] — N items (verified: [commit hash or PR #])

### Sections Kept
- Plan NNN: N/M items done
- Plan NNN: all [x] but contains deferred items
- Plan NNN: all [x] but no git verification found — manual review needed
- Plan NNN: all [x] but plan too recent (< 7 days)
```
