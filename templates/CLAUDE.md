# CLAUDE.md — {{project.name}}

@AGENTS.md

## Claude Code–only addendum

- **Branch guard:** `scripts/branch-guard.sh` runs on Edit/Write via `.claude/settings.json` PreToolUse — blocks writes on `{{git.mainBranch}}`.
- **Session hooks:** SessionStart runs `scripts/session-startup.sh`; PostToolUse runs the session-manifest hook.
- **Subagents:** Prefer project agents under `.claude/agents/` when a command explicitly invokes them. Do not invent orchestration beyond the command file.
<!-- KIT:yes-chef -->
