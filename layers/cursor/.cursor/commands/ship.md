---
description: Session end — build, review, lane-aware commit approval, merge gate
---

Follow `.claude/commands/ship.md` exactly, including the Phase 0 lane classification (FAST / ULTRA-TRIVIAL / REGULAR) and `docs/agent/standards-git.md` for the Merge Gate. Same pipeline as Claude Code — this file exists only so `/ship` autocompletes in Cursor's command palette.

Cursor has no hook that checks the hand-off, so hold these yourself:

- `[human]` Done-when items and no cards answered in this session → stop at Phase 4: start the servers first (every page URL in the cards answers), show the HOW TO VALIDATE cards as plain text grouped by place (`docs/agent/job-validation.md` → Format; each value to type alone on its own line), and wait. **Y** alone does not validate them; commit only after `done` / `verified` / `approved` or `ok:` answers covering every card (`done Y` answers both). Print the "Open all pages" line with the cards.
- No PR and no merge before that reply, unless the Human said "merges pre-approved" for this run — then show the cards after the merge and leave the `[human]` items `[ ]` until the Human replies.
