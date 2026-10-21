# /docs-refresh — On-Demand Documentation Refresh

<!-- KIT:if stack.docsMapSkill -->
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

Invoke the `{{stack.docsMapSkill}}` skill from the repo root (cwd):

<!-- KIT:if stack.docsMapCheck -->
1. Read `.claude/skills/{{stack.docsMapSkill}}/SKILL.md` (it runs `node {{stack.docsMapCheck}}` first)
<!-- KIT:else -->
1. Read `.claude/skills/{{stack.docsMapSkill}}/SKILL.md`
<!-- KIT:end -->
2. Follow the skill's steps to refresh breadcrumbs and documentation

Or spawn a general agent with a **path-free** prompt:

```
Agent(
  subagent_type: "general-purpose",
  model: "{{models.analysis}}",
  description: "Refresh breadcrumbs and project docs",
  prompt: "Run the {{stack.docsMapSkill}} skill from the workspace repo root (cwd). Refresh breadcrumbs.md at major seams, prune stale entries, update key exports. Do not use any hardcoded absolute machine path."
)
```

## What it does

- Refreshes `breadcrumbs.md` at component/service/module seams
- Prunes stale entries (deleted files, renamed components)
- Updates key exports section
- Output: list of files updated
<!-- KIT:else -->
Refreshes the project's own documentation maps, when it has them.

No stack pack in this project ships a docs-map skill (the pack contract's `docsMapSkill`), so there are no
generated folder maps to refresh: skip, and say so. To refresh project docs by hand, update the files under
`docs/` that a structural change made stale (moved or deleted paths, renamed modules).

On-demand command (not part of `/ship`). Repo root = **workspace cwd** (never hardcode a machine path).
<!-- KIT:end -->

## What it does NOT do

- Does not modify application code
- Does not create plan files
- Does not run `npm run {{commands.build}}`
