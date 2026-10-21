# /docs-refresh — On-Demand Documentation Refresh

Refreshes the project's own documentation maps, when it has them.

No stack pack in this project ships a docs-map skill (the pack contract's `docsMapSkill`), so there are no
generated folder maps to refresh: skip, and say so. To refresh project docs by hand, update the files under
`docs/` that a structural change made stale (moved or deleted paths, renamed modules).

On-demand command (not part of `/ship`). Repo root = **workspace cwd** (never hardcode a machine path).

## What it does NOT do

- Does not modify application code
- Does not create plan files
- Does not run `npm run build`
