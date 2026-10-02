# Glossary

- **Second brain (`docs/brain/`)** — distilled durable project memory (brief, decisions, patterns, gotchas, glossary). History and reasoning only — not current work status (`docs/session-state.md`, `.claude/todo.md`). See [how-it-works.md](./how-it-works.md).
- **Brain capture auto-write** — agents propose brain entries at push / PR / Merge Gate with the full draft shown; the entry then writes automatically on the reply that closes the gate (`Y` / `merge` / `later` / `open-pr-only`) unless the Human replies `no brain` / `skip brain`, or `brain edit …` to revise first. See [[0006-auto-write-brain-capture-by-default]].
- **Plan Contract** — a saved plan under `plans/` with a `## Read-Write Scope`; a Worker writes only inside it.
- **Slot** — one of the permanent Worker worktrees (`{{slots.nameFormat}}`), each with its own dev-server ports.
- **Hotspot** — an append-only shared file (`{{paths.hotspots}}`): add to it, never rewrite or remove an entry without escalating.

<!-- Add this project's domain terms below, one bullet each. -->
