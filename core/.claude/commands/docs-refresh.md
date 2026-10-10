# /docs-refresh — On-Demand Documentation Refresh

Regenerates breadcrumbs, updates key exports, and prunes stale entries.

On-demand command (not part of `/ship`). Run after structural changes
(new components, services, or modules).

Repo root = **workspace cwd** (never hardcode a machine path).

## When to use

- After adding or removing {{stack.name}} components/services/modules
- After a large refactor that changes component names or file paths
- Before creating a PR that adds structural changes
- On demand: "update breadcrumbs", "refresh docs", "sync breadcrumbs"

## Execution

Invoke the `breadcrumbs` skill from the repo root (cwd):

1. Read `.claude/skills/breadcrumbs/SKILL.md` (it runs `node scripts/breadcrumbs-check.mjs` first)
2. Follow the skill's steps to refresh breadcrumbs and documentation

Or spawn a general agent with a **path-free** prompt:

```
Agent(
  subagent_type: "generalPurpose",
  description: "Refresh breadcrumbs and project docs",
  prompt: "Run the breadcrumbs skill from the workspace repo root (cwd). Refresh breadcrumbs.md at major seams, prune stale entries, update key exports. Do not use any hardcoded absolute machine path."
)
```

## What it does

- Refreshes `breadcrumbs.md` at component/service/module seams
- Prunes stale entries (deleted files, renamed components)
- Updates key exports section
- Output: list of files updated

## What it does NOT do

- Does not modify application code
- Does not create plan files
- Does not run `npm run {{commands.build}}`
