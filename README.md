# ai-workflow-kit

A copy-distributed Planner-Worker AI workflow (Claude Code, optional Cursor layer): plans, slots, scope guards, `/ship` pipeline and a brain of lessons. Extracted from FoodVibe (ADR 0015, plans 328-331).

**Status:** phase 3 of 5 (core, stack packs, Cursor layer, lessons). Local only, no remote. Not installable yet; the installer and the template skeletons are phase 4.

## Layout

| path | what |
| --- | --- |
| `core/` | Stack-neutral workflow files at the paths a target project receives them, plus the transferred and generalized brain lessons. Placeholders look like `{{git.mainBranch}}`. |
| `packs/angular/`, `packs/node-express/` | Stack packs. Each has a `pack.json` contract: `standardsDoc`, `skills`, `cursorRules`, `gotchas`, `validation` (npm script names). |
| `layers/cursor/` | Optional Cursor layer (`.cursor/commands`, rules, `mcp.json` without raw Playwright). |
| `kit.config.json` | Every key a placeholder can name (41). Values are empty here; a project fills its own. |
| `tools/leak-check.mjs` | Core and layers must not name a framework or a project; packs (`--project-only`) must not name the project. |
| `tools/pack-check.mjs` | Every pack satisfies the `pack.json` contract. |
| `.github/workflows/leak-check.yml` | Runs all three checks on push and PR. |

A `<!-- PACK:<stack> -->` marker in a core file marks where pack content goes.

## Rules

- Core speaks to the stack only through `kit.config.json`, using npm script names, never raw framework commands.
- Lessons marked `Status: draft` were generalized from FoodVibe lessons and need review before they are relied on.
- Checks: `node tools/leak-check.mjs`, `node tools/leak-check.mjs --root packs --project-only`, `node tools/pack-check.mjs` (exit 0 = clean).
