---
description: Validate a finished chat job — mark todos after Human confirm
---

Follow `.claude/commands/done.md` and `docs/agent/job-validation.md` exactly.

Cursor has no hook that checks the hand-off, so hold these yourself:

- Cards only when a check needs the Human. Every Done-when item `[auto]` → the `VERIFIED BY AGENT` evidence, no cards, no servers.
- Servers first: before the cards, start the servers (`node scripts/slot-serve.mjs` in a slot, else the project's dev command) and open every page URL the cards name. Fix a failed start before the hand-off.
- Cards grouped by page in click order: header `HOW TO VALIDATE — {N} checks on {P} pages`, one `▸ {page} — {full URL}` line per page with its cards under it, numbers running on, checks outside the app in a last group named by window.
- Wait for `done` / `verified` / `not yet` / `failed: <numbers>` before any `/ship`, PR or merge.
