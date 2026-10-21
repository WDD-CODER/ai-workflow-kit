# TECH STACK — AUTHORITATIVE SOURCE — ai-workflow-kit
> `AGENTS.md` and `CLAUDE.md` defer to this file. Edit HERE only.

## Stack
- Node.js 18+ ESM tools (`tools/*.mjs`), Node built-ins and the git CLI only. PowerShell wrappers (`kit-*.ps1`) for
  Windows. No app, no frontend, no backend, no database, no dev server.
- Sources: `core/`, `packs/`, `layers/`, `templates/`. They are what projects install.
- The kit is also installed into itself: `scripts/`, `.claude/`, `docs/agent/`, `docs/brain/`, `AGENTS.md`,
  `CLAUDE.md` are **rendered copies** of the sources. Never edit a copy; edit the source, then run
  `node tools/sync.mjs --target . --apply`. CI (`drift-check`) fails a PR whose copy differs.

## Hard conventions
- Build gate: `npm run build` (`pack-check`) must pass before any commit.
- Lint gate: `npm run lint` (the three `leak-check` runs of CI): no project names, ports or machine paths in the sources.
- Test gate: `npm run test` (`install-check`, `workflow-link-check`). Before a PR also `npm run e2e`
  (`acceptance-check --e2e`) and `node tools/e2e-check.mjs`.
- Stack-neutral core: a fact about one project never goes into `core/`; it goes into a pack, a layer or a config key.
- Semver (`CHANGELOG.md`): a major release says what a project must do; minor and patch never need action.

## Approved dependencies
None in the kit tools (Node built-ins + git). The installed workflow scripts use `picomatch` (`scripts/package.json`).
New dependencies need explicit Plan Contract approval before they are installed.
