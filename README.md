# ai-workflow-kit

A copy-distributed Planner-Worker AI workflow (Claude Code, optional Cursor layer): plans, slots, scope guards, `/ship` pipeline and a brain of lessons. Extracted from FoodVibe (ADR 0015, plans 328-332).

**Status:** phase 4 of 5 (installer, sync and template skeletons). Local only, no remote. FoodVibe still owns its own workflow files until phase 5.

## Install into a project

```powershell
.\kit-install.ps1 -Target ..\my-app -Packs angular -Cursor        # add -YesChef for the "Yes chef!" gate, -DryRun to preview
.\kit-sync.ps1    -Target ..\my-app                               # later: what would a newer kit change? (writes nothing)
.\kit-sync.ps1    -Target ..\my-app -Apply                        # write only new + kit-update files
```

The `.ps1` files are thin wrappers; the engine is `node tools/install.mjs` / `node tools/sync.mjs` (Node 18+), so the same flags work as `--target --packs --cursor --yes-chef --dry-run --force --allow-unfilled` on any OS.

- Config: `-Config <file>`, else `<target>/kit.config.json`, else the kit defaults plus each pack's `configDefaults`. The installer writes the effective config to `<target>/kit.config.json` when absent. Required keys (`project.name`, `commands.build|lint|test`, `hooks.shellPath`) missing -> exit 2, nothing written. Other empty keys render `(not set)` and are listed.
- Never overwrites an existing file (reported `SKIP-EXISTING`) unless `-Force`.
- `<target>/.kit/install.json` records what was installed and each file's hash. Commit it; sync reads it.
- Core, pack and Cursor-layer files are **managed** (sync updates them when you have not edited them). Files from `templates/` are **seeds**: written once, never updated.
- Sync states: `new`, `kit-update`, `local-only`, `conflict` (never overwritten), `removed-from-kit`, `deleted-locally`.
- `.claude/settings.json` has no machine paths: only `${CLAUDE_PROJECT_DIR}` and `hooks.shellPath` (default `C:/Program Files/Git/bin/bash.exe` on Windows when present, else `bash`).
- No raw Playwright MCP is installed anywhere.

## Layout

| path | what |
| --- | --- |
| `core/` | Stack-neutral workflow files at the paths a target project receives them, plus the transferred and generalized brain lessons. Placeholders look like `{{git.mainBranch}}`. |
| `packs/angular/`, `packs/node-express/` | Stack packs. `pack.json` contract: `standardsDoc`, `skills`, `cursorRules`, `gotchas`, `validation` (npm script names), optional `configDefaults` and `agentsFragment` (rows the installer adds to the `AGENTS.md` skeleton). |
| `layers/cursor/` | Optional Cursor layer (`.cursor/commands`, rules, `mcp.json` without raw Playwright). |
| `templates/` | The 17 skeletons: `AGENTS.md`, `CLAUDE.md`, `docs/brain/*`, `docs/project/*` (was `_shared/`), `.gitignore`, `.mcp.json`, `.nvmrc`, `.prettierrc.json`, HLD/PRD templates; `templates/cursor/` only with `-Cursor`. |
| `kit.config.json` | Every key a placeholder can name (39). Conventions: `slots.fePorts/bePorts` are base ports (slot N = base + N); `paths.srcRoot/serverRoot` end with `/`. |
| `kit.json` | Kit version recorded into each install. |
| `tools/install.mjs`, `tools/sync.mjs`, `tools/lib/kit.mjs` | Installer, sync and the shared render/plan engine. |
| `tools/leak-check.mjs` | Core, layers and templates must not name a framework or a project; packs (`--project-only`) must not name the project. |
| `tools/pack-check.mjs` | Every pack satisfies the `pack.json` contract. |
| `tools/install-check.mjs` | Installs three fixtures into temp dirs and checks them (no git needed). |
| `.github/workflows/leak-check.yml` | Runs all four checks on push and PR. |

Placeholder filters (code contexts): `{{paths.hotspots|quoted}}` -> `'a', 'b'`, `|dquoted`, `|glob` -> `{a,b}`, `|alt` -> `a|b` (regex alternation, metacharacters escaped; used by the shell guards with `{{plans.openDirs|alt}}`).

A `<!-- PACK:<stack> -->` marker in a core file is a hint for where pack content belongs; the installer does not yet inject pack text there (the pack's own standards doc carries it).

## Rules

- Core speaks to the stack only through `kit.config.json`, using npm script names, never raw framework commands.
- Lessons marked `Status: draft` were generalized from FoodVibe lessons and need review before they are relied on.
- Checks (exit 0 = clean): `node tools/leak-check.mjs`, `node tools/leak-check.mjs --root packs --project-only`, `node tools/pack-check.mjs`, `node tools/install-check.mjs`.
