---
description: List all registered skills, triggers, and scope
allowed-tools: Read, Glob, Bash
---

# /skills — List Available Skills

Show all registered skills with trigger patterns and file locations.

## Execution (fast path — default)

1. **Do not** read every `SKILL.md`. **Do not** call MCP / memory tools.
2. Read `AGENTS.md` → `## Skill triggers` and print that table as-is. AGENTS.md is the single
   source of truth for the trigger list; this command is just a discoverability surface — it
   no longer keeps its own copy.
3. Optional freshness (one cheap check only):
   - `Glob` `.claude/skills/*/SKILL.md` under the repo `.claude/skills/` only (ignore `claude-workflow-sdk/` and other trees).
   - Compare the skill-dir name set to the `File` column paths in AGENTS.md's table.
   - **Exclude retired dirs** even if present on disk: `mp-search`, `nightly-audit`, `worktree-session-end`, `execute-debugging`.
   - If sets match → done. If they differ → tell the Human AGENTS.md's Skill triggers table is
     stale (name the mismatch) and ask them to update it there — this command does not maintain
     a parallel registry to rebuild from.
4. Do **not** invent skills that are not on disk. Do **not** list retired skills.

## Notes

- `copilot-instructions.md` §0 was retired in the three-agent cutover.
- Slash commands live in `.claude/commands/` — use `/commands`. Skills are separate from commands.
- When adding/removing a skill, update `AGENTS.md`'s `## Skill triggers` table — not this file.
- Do not list retired skills (`mp-search`, `nightly-audit`, `worktree-session-end`, `execute-debugging`) even if mentioned in archives.
