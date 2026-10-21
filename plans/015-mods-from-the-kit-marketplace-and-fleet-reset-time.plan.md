# Plan 015 — Mods From the Kit's Marketplace, Kept in Sync; fleet Shows When the 5-Hour Window Resets

Status: in-progress
Snapshot: 53ca2c6

## Problem Statement
The three Claude Code mods (fleet, guards, ship-pilot) live in a local folder on one PC that is not a git repo, and are
installed from it as a local directory marketplace. Nothing reaches another machine, and the installed copies are
already out of date (fleet 0.1.2 installed vs 0.3.1 in the source, ship-pilot 0.2.0 vs 0.3.0). Their defaults are one
project's values (guards' hotspots `public/assets/data/dictionary.json,…`, fleet's ports 4200/3000), so they cannot
serve any other project.

fleet shows `5h N%` in the status line but not when the window resets, and notifies only at 95% — never when the window
refreshes and the full limit is back.

Facts from the Claude Code docs (plugins: marketplace-reference, loading, install, cli-reference, mods; read
2026-10-21), which shape the design:
- A marketplace at a GitHub repo's root can list plugins by relative path (`"source": "./mods/fleet"`); once the
  marketplace is registered, a relative-path plugin loads from the marketplace's copy, with nothing else to install.
- Project `.claude/settings.json` can declare it: `extraKnownMarketplaces` (applied after the folder's workspace-trust
  dialog) and `enabledPlugins` (`"<plugin>@<marketplace>": true`). `"autoUpdate": true` on the marketplace entry
  refreshes it at session start (off by default for non-official marketplaces).
- A plugin that sets `version` in `plugin.json` updates only when the version is bumped.
- A private GitHub marketplace uses the machine's own git credentials (gh credential helper, SSH); there is no token
  field.
- Cloud sessions load neither plugins nor marketplaces from repo settings. **Cloud is out of scope** (Dandan,
  2026-10-21): the mods assist the Human at his machines.
- `claude plugin marketplace remove` from the last scope also uninstalls its plugins and deletes their saved options.

## Prerequisites
- none. Independent of 012 (open PR #33) and 011 / 013 / 014 (parallel session): different files, except
  `CHANGELOG.md` `[Unreleased]` (keep every entry when merging).

## Goals & Success Criteria
**Primary:** any project that turns the mods on gets them on every machine where Dandan opens it, and a mod change
reaches those machines with a kit release and no manual copying; fleet shows the 5-hour reset time and announces the
refresh in every session.

- [auto] `claude plugin validate .` (the kit root marketplace) and `claude plugin validate mods/<mod>` exit 0 for all
  three; `claude plugin test mods/<mod>` passes for all three, with the new fleet cases below.
- [auto] `node tools/install-check.mjs` passes, with a fixture where `mods.enabled` lists the three mods (settings.json
  gets the marketplace and the three `enabledPlugins` entries, valid JSON) and one where it is empty (neither key).
- [auto] `node tools/leak-check.mjs --root mods --project-only` reports 0 leaks (no project's paths, ports or names in
  the mods); the other kit checks pass.
- [auto] fleet tests: reset time formatting (`↻14:30 (2h10m)`, local time), countdown, the refresh notice fires once
  per window per session when `resetsAt` passes, re-schedules when `resetsAt` changes, re-arms the 95% notice in the
  new window, and shows nothing before the first `resetsAt` arrives.
- [human] On Dandan's PC after the release and the FoodVibe sync: opening FoodVibe installs/loads the three mods from
  GitHub at the source versions (`/plugin` shows fleet 0.4.0, guards 0.2.0, ship-pilot 0.4.0); the status line shows
  `5h N% ↻HH:MM (XhYm)`; when a window resets, every open FoodVibe session shows the refresh notice.
- [human] A version bump to one mod, released and synced, reaches the PC at the next session start with no command.

## Execution Mode
- Parallel: yes — new `mods/` tree, `.claude-plugin/`, `core/.claude/settings.json`, config and tools.
- Concurrent plans: 012 (PR #33), 011/013/014 (parallel session).
- Isolated DB: no.
- Kit edits: kit branch `feat/015-mods-marketplace-fleet-reset` + kit PR; Dandan merges and gives the go for the
  release (minor: new config key, existing projects keep working with the mods off).

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`.

```scope
mods/**
.claude-plugin/**
core/.claude/settings.json
kit.config.json
tools/lib/kit.mjs
tools/install.mjs
tools/sync.mjs
tools/install-check.mjs
.github/workflows/leak-check.yml
README.md
CHANGELOG.md
```

## Read Scope
Kit repo; the mods' source folder on Dandan's PC (`claude-mods-deliverable/layers/claude-code-mods/`, read and copy
only); FoodVibe's `kit.config.json` and `.claude/settings.json` (read only).

## Escalation Protocol
Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry. Project sync `conflict` rows: STOP, never `--force`. Tags and releases: wait
for Dandan's go. Never run `claude plugin marketplace remove` or `uninstall` on Dandan's machine — those steps are his.

## Architecture Impact
- INV-none: preserves — kit distribution and an opt-in config key; no app, server or schema file.
- Supersedes the 2026-10-14 approach (copy the mods into each project's `.claude/mods/` with placeholders rendered, the
  `0001-feat-kit-claude-code-mods-layer…` patch): the mods no longer contain placeholders, so one shared copy served
  from the kit's marketplace replaces per-project copies. The patch is not applied.

## Step 0 — Reality Check
Compare the mod sources on the PC with this plan: versions fleet 0.3.1, guards 0.1.1, ship-pilot 0.3.0; fleet's
`refreshHealth` in `hooks/register.tsx` reads `usage.rateLimits` (`kind`, `percentUsed`, `resetsAt?: string` ISO 8601
per the generated types). A newer source version → bring that one in and note it in Execution Notes.

## Functional Requirements
1. **Bring the mods in:** copy `fleet/`, `guards/`, `ship-pilot/` (each with `.claude-plugin/plugin.json`, `hooks/`,
   `tests/`, `types/`, `tsconfig.json`) to `mods/<mod>/`, plus the folder's `README.md` and `SECURITY.md` as
   `mods/README.md`, `mods/SECURITY.md`. Leave out `.claude-plugin/types/` (generated, gitignored by its own
   `.gitignore`), `TOKEN-REPORT.md`, `WORKFLOW-CHANGES.md`, `evidence/`, `backups/`. Drop the `author.email` field.
   `mods/` is not installed into projects (it is not under `core/`, `packs/`, `layers/` or `templates/`).
2. **Marketplace at the kit root:** `.claude-plugin/marketplace.json`, name `ai-workflow-kit-mods`, owner as today,
   `plugins[].source` = `./mods/<mod>`, descriptions as today. Versions live in each `plugin.json` only (never also in
   the marketplace entry).
3. **Project defaults instead of one project's values:** guards reads its hotspots and fleet its port bases from the
   project's `kit.config.json` (`paths.hotspots`, `project.i18nFile`, `slots.fePorts`, `slots.bePorts`) when the
   matching `userConfig` value is empty; the `userConfig` defaults become `""` / `0` (= use the project's). No
   `kit.config.json` and no `userConfig` value → no hotspots, and fleet's port features stay off. Tests cover both
   sources. Bumps: guards 0.2.0, ship-pilot 0.4.0 (unchanged code apart from removing project values, if any).
4. **Config key `mods`** in `kit.config.json`: `enabled` (list of mod names, default `[]`, each one of `fleet`,
   `guards`, `ship-pilot` — install and sync refuse others) and `marketplaceRepo` (default
   `WDD-CODER/ai-workflow-kit`). Documented in the `$comment`.
5. **Settings render:** when `mods.enabled` is non-empty, install and sync write into the project's
   `.claude/settings.json` an `extraKnownMarketplaces.ai-workflow-kit-mods` entry
   (`{ "source": { "source": "github", "repo": "<marketplaceRepo>" }, "autoUpdate": true }`) and one
   `enabledPlugins` entry per mod (`"<mod>@ai-workflow-kit-mods": true`), next to the existing
   `security-guidance` entry. Empty list → neither key. The rendered file is valid JSON in both cases.
6. **fleet 0.4.0 — reset time:** store `fiveHourResetsAt` / `sevenDayResetsAt` in the `health` atom. Status line
   `5h 62% ↻14:30 (2h10m)` (local time, countdown); `/health` line
   `limits: 5h 62% (resets 14:30, in 2h10m) · 7d 30% (resets Fri 09:00)`; the 95% notice and the ≥80% `/handoff` hint
   say when the window resets. Nothing is shown before the first `resetsAt` of the session.
7. **fleet 0.4.0 — refresh notice in every session:** when the five-hour `resetsAt` is known, schedule
   `$.clock.after(resetsAt - now, …)`; on fire, notify `5-hour window refreshed — full limit available again` in this
   session (no cross-session marker, no phone push — Dandan, 2026-10-21), and re-arm the 95% notice. A changed
   `resetsAt` cancels and re-schedules the timer.
8. **CI:** `.github/workflows/leak-check.yml` adds `node tools/leak-check.mjs --root mods --project-only`. The
   `claude plugin validate` / `test` runs are documented in the README's **Checks** (the CI runner has no Claude Code
   CLI); the Worker runs them and pastes the output in Execution Notes.
9. **Updates, documented in the README (new section "Mods"):** a mod change bumps its `plugin.json` version and ships
   in a kit release; `autoUpdate: true` brings it to each machine at its next session start. Manual fallback:
   `claude plugin marketplace update ai-workflow-kit-mods`, then `claude plugin update <mod>@ai-workflow-kit-mods`.
   A private kit repo needs the machine's git credentials (`gh auth login`, `gh auth setup-git`). Cloud sessions do not
   get the mods.
10. **Hand-over on Dandan's PC (his steps, listed in the README and the PR):** after the FoodVibe sync installs from
    GitHub and `/plugin` shows the new versions, remove the old local directory marketplace
    (`claude plugin marketplace remove <its name>`). Warn: removal also uninstalls what came from it and deletes its
    saved options — re-enter fleet's `pushUrl` in `/config` if it was set.

## Atomic Sub-tasks
- [ ] M1: Bring the three mods into the kit without one project's paths or private data — mods/**
- [ ] M2: Serve them from a marketplace at the kit root — .claude-plugin/marketplace.json
- [ ] M3: Let guards and fleet take hotspots and ports from the project's kit config — mods/guards/**, mods/fleet/**
- [ ] M4: Turn the mods on per project with one config key, rendered into settings.json by install and sync — kit.config.json, tools/lib/kit.mjs, tools/install.mjs, tools/sync.mjs, core/.claude/settings.json, tools/install-check.mjs
- [ ] M5: Show when the 5-hour window resets and announce the refresh in every session — mods/fleet/** (0.4.0)
- [ ] M6: Check the mods in CI and document updates and the hand-over — .github/workflows/leak-check.yml, README.md
- [ ] M7: Release and bring it into FoodVibe — CHANGELOG entry, kit PR, tag on Dandan's go, `mods.enabled` set in FoodVibe's kit.config.json, kit-sync -Ref <tag> -Apply, /ship there; Dandan's PC steps from requirement 10 — CHANGELOG.md

## Out of Scope
- Cloud sessions (decided 2026-10-21).
- Phone push for the refresh notice; a cross-session dedup marker.
- New mod features beyond the reset time and the project defaults.
- Removing the old local marketplace or uninstalling anything on Dandan's machine (his step).

## Execution Notes
