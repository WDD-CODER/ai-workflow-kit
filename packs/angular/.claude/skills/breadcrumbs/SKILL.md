---
name: breadcrumbs
description: Creates and refreshes the `breadcrumbs.md` navigation maps that live at {{project.name}}'s major seams (`{{paths.srcRoot}}core/`, `core/services`, `core/models`, `core/components`, `shared/`, `pages/`), pruning stale entries and stray files. Use after adding a `pages/<x>/` or any top-level subtree, after moving or deleting files, before a PR that reshaped folders, from `/docs-refresh`, or when the user says "update docs", "breadcrumbs", "refresh the maps" or asks what a directory contains.
allowed-tools: Bash(node scripts/breadcrumbs-check.mjs *)
---

# breadcrumbs

A `breadcrumbs.md` is a 30-second orientation for a folder: what each sub-folder and primary file is for. They exist only at the six seams — a map in every leaf folder is noise that rots faster than it helps.

## 1. Check (script)

```bash
node scripts/breadcrumbs-check.mjs
```

For each seam it prints `OK`/`MISSING`, every `stale entry` (a path the file mentions that no longer exists) and every `not mentioned` child, plus any `STRAY` breadcrumb outside a seam. Exit 0 means nothing to do — say so and stop.

## 2. Fix what it found

- `MISSING` → create the file (format below).
- `stale entry` → remove or correct the line.
- `not mentioned` → add a line, *if* the item earns one: a sub-folder, a `.service.ts` / `.model.ts` / `.component.ts`, a guard, a pipe. Specs and index files don't.
- `STRAY` → delete it.

For each line you write, read the file's header or class name so the description says what it *does*, not what it is called (`recipe.service.ts — CRUD + ledger math for recipes` beats `recipe service`).

## Format

```markdown
# <seam path> — breadcrumbs

| Entry | Purpose |
| --- | --- |
| `services/` | Root-provided singletons; see `services/breadcrumbs.md` |
| `recipe.service.ts` | CRUD + ingredient-ledger math for recipes |

## Key exports
`RecipeService`, `Recipe`, `authGuard`
```

Keep it a table; keep every path in backticks (the checker reads them).

## 3. Verify and finish

Re-run the script until it prints `BREADCRUMBS: clean`, then report `Breadcrumbs refreshed at <seams touched>` (or `clean, nothing changed`).
