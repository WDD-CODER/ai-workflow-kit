---
description: Validate a finished chat job — mark todos after Human confirm
---

Follow `.claude/commands/done.md` and `docs/agent/job-validation.md` exactly.

Cursor has no hook that checks the hand-off, so hold these yourself:

- Cards only when a check needs the Human. Every Done-when item `[auto]` → the `VERIFIED BY AGENT` evidence, no cards, no servers.
- Servers first: before the cards, start the servers (`node scripts/slot-serve.mjs` in a slot, else the project's dev command) and open every page URL the cards name. Fix a failed start before the hand-off.
- Cards are plain text grouped by place in click order: header `HOW TO VALIDATE - {N} checks on {P} places`, one `PAGE:` and `URL:` pair per page with its cards under it, numbers running on as `[1]`, `[2]`, checks outside the app in a last `PLACE:` group named by window. Every value the Human types or pastes sits alone on its own line, in English unless it is literal app-language data (`docs/agent/job-validation.md` → Format).
- Wait for `done` / `verified` / `not yet` / `failed: <numbers>` before any `/ship`, PR or merge.
