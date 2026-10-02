---
description: List all registered slash commands, categories, and file paths
allowed-tools: Read, Glob, Bash
---

# /commands — List Available Commands

Show all registered slash commands with short descriptions and file locations.

## Execution (fast path — default)

1. **Do not** read every command file. **Do not** call MCP / memory tools.
2. Print the **Current registry** table below as-is.
3. Optional freshness (one cheap check only):
   - `Glob` `.claude/commands/*.md` — **filenames only**.
   - Compare the filename set to the `File` column in the table.
   - If sets match → done (print table; no further reads).
   - If sets differ → run **Refresh path** once, then print the rebuilt table.
4. `/commands --refresh` (or user says "refresh") → skip straight to **Refresh path**.
5. Do **not** invent commands that are not on disk.
6. Do **not** list a retired command from the Notes "Retired" line unless its `.md` still exists (then mark `LEGACY`).

### Refresh path (only on mismatch or `--refresh`)

1. Enumerate `.claude/commands/*.md`.
2. For each file, read frontmatter `description:` if present; else first `#` heading (strip `/name —` prefix).
3. Category: `FLOW` = multi-step pipeline; `UTIL` = single-purpose / discovery.
4. Scope: `[SHARED]` = Cursor + Claude Code; `[CC]` = primarily Reviewer path.
5. Rebuild and print the table. Prefer also updating this file's embedded registry in the same change when adding/removing a command.

## Current registry

| Command | What it does | File | Category | Scope |
| --- | --- | --- | --- | --- |
| `/auto-solve` | Autonomous plan executor (legacy; prefer milestone-by-milestone Contractor) | `.claude/commands/auto-solve.md` | UTIL | SHARED |
| `/brief` | Capture or generate a session brief | `.claude/commands/brief.md` | FLOW | SHARED |
| `/cleanup` | Session & worktree pruning | `.claude/commands/cleanup.md` | UTIL | SHARED |
| `/commands` | List all registered slash commands, categories, and paths | `.claude/commands/commands.md` | UTIL | SHARED |
| `/docs-refresh` | On-demand documentation refresh (breadcrumbs + project docs) | `.claude/commands/docs-refresh.md` | UTIL | SHARED |
| `/done` | Validate a finished chat job — close-out ask, then mark matching todos `[x]` | `.claude/commands/done.md` | UTIL | SHARED |
| `/feat` | New-feature path — rules, `/plan`, Contractor + `/review-it` | `.claude/commands/feat.md` | FLOW | SHARED |
| `/fix` | Bug fix path — matching rules + elegant-fix | `.claude/commands/fix.md` | FLOW | SHARED |
| `/fix-pr-checks` | Bounded PR CI/security fix loop (2 rounds max) | `.claude/commands/fix-pr-checks.md` | FLOW | SHARED |
| `/plan` | Planning / Plan Contract path | `.claude/commands/plan.md` | FLOW | SHARED |
| `/refactor` | Refactor path — {{stack.name}}/domain rules, cssLayer, techdebt | `.claude/commands/refactor.md` | FLOW | SHARED |
| `/review-it` | Reviewer pass — plan-match, conventions, Verify; report-only by default | `.claude/commands/review-it.md` | FLOW | CC |
| `/security` | Security path — security rules + pre-commit security grep + CI | `.claude/commands/security.md` | FLOW | SHARED |
| `/ship` | Session end — build gate, chat-scoped commit (`--yes` skips wait) | `.claude/commands/ship.md` | FLOW | SHARED |
| `/review` | Judgment-only review (used by `/ship`) | `.claude/commands/review.md` | FLOW | SHARED |
| `/end-session` | Alias for `/ship` | `.claude/commands/end-session.md` | FLOW | SHARED |
| `/skills` | List all registered skills, triggers, and scope | `.claude/commands/skills.md` | UTIL | SHARED |
| `/sweep-stale-todos` | Find and close todos that are no longer relevant | `.claude/commands/sweep-stale-todos.md` | UTIL | SHARED |
| `/tune-workflow` | Propose workflow trims from real `/usage` data; applies nothing | `.claude/commands/tune-workflow.md` | UTIL | SHARED |

## Notes

- Skills are separate — use `/skills` for `.claude/skills/*/SKILL.md`.
- When adding/removing a command file, update this table in the same change.
- Retired (do not invoke; files removed in cutover): `/plan-implementation`, `/execute-it`, `/validate-agent-refs`, `/nightly-audit`, `/audit-report`, `/reflect`, `/reflect-list`, `/reflect-add-tests`.
