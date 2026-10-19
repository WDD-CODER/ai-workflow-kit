# Plan 007 — Kit Follow-ups: CI Test Mode, Sync Prune, Adoption-Report Fix, FoodVibe Backports

Status: draft
Snapshot: d83bae1

## Problem Statement
The v1.2.0 syncs into FoodVibe (PR #424) and agentdesk (PR #11) left four gaps:
1. **CI test job can't be turned off.** `core/.github/workflows/ci.yml` always runs `npm run {{commands.test}}`. A project with no unit tests (agentdesk: `package.json` is upstream's, no `test` script, full-repo lint has ~6,000 upstream errors) can't pass that job, so agentdesk keeps `ci.yml` as an override and drifts from every later CI fix.
2. **Sync never removes stale records.** `tools/sync.mjs` reports `removed-from-kit` ("kept, delete by hand") but keeps the record in `.kit/install.json` forever. agentdesk deleted `.prettierrc.json` by hand and still shows `1 removed-from-kit` on every dry-run.
3. **adoption-report prints the wrong frontend command.** The `frontend dev server` row builds `npm run <commands.dev> -- <fePortArgs>` and ignores `slots.feExec`. For the angular pack the real command (`frontendArgs()` in `core/scripts/lib/slot-procs.mjs`) is `npm exec -- ng serve -c slot --port <port>`. Display only.
4. **FoodVibe overrides that a kit parameter could retire.** PR #424 lists 5 overrides that differ from the v1.2.0 render by only 1–3 lines of project wording:
   - `.claude/skills/cssLayer/SKILL.md` (1 line: "The UI is Hebrew RTL")
   - `docs/agent/standards-angular.md` (1 line: the domain-logic line)
   - `.claude/skills/angularComponentStructure/evals/evals.json` (2 lines)
   - `.claude/commands/review-it.md` (the log-query step and its table row)
   - `.claude/skills/angularComponentStructure/SKILL.md` (3 lines: Lucide, `app.config.ts`, Hebrew)

Release the fixes as **v1.3.0** (minor: new optional config keys, nothing a project must do), then sync both projects and drop the overrides the release covers.

## Prerequisites
- agentdesk PR #11 merged (agentdesk on v1.2.0 with its 8 overrides).
- FoodVibe on v1.2.0 (PR #424, merged `ccf06865`).

## Goals & Success Criteria
- [auto] `ci.testMode` (`run` default | `if-present` | `skip`): `run` renders today's job byte-identical; `if-present` renders `npm run --if-present {{commands.test}}`; `skip` renders no `test` job and nothing `needs: test`. actionlint passes on all three renders.
- [auto] `kit-sync --apply`: a `removed-from-kit` record whose file is already gone is dropped from `.kit/install.json` with no flag. With `--prune`: a managed file unchanged since install (hash equals the record) is deleted and its record dropped; an edited managed file or any seed is kept on disk and only its record is dropped (it then shows as `local-only`). Without `--prune` nothing on disk is deleted. Dry-run prints what `--prune` would do.
- [auto] adoption-report's frontend row prints the same command `frontendArgs()` builds: on the Angular fixture `npm exec -- ng serve -c slot --port {port}`, on the React-Vite fixture `npm run dev -- <fePortArgs>`. The row reuses one shared function, not a second copy of the logic.
- [auto] Each FoodVibe backport candidate is either parameterised (FoodVibe's render with its config becomes byte-identical to its override, so the override can be dropped) or recorded in Execution Notes as "stays an override" with the reason. Other projects' renders are unchanged unless the new key is set.
- [auto] `install-check`, `pack-check`, `e2e-check`, `workflow-link-check`, `acceptance-check --e2e`, `leak-check` all pass; CHANGELOG `[1.3.0]` lists the new keys and which overrides they let a project drop.
- [auto] Tag + GitHub release `v1.3.0` after Dandan's go.
- [auto] FoodVibe `kit-sync -Ref v1.3.0 -Apply`: 0 unresolved `conflict`; `npx ng build`, `node scripts/kit-owned.mjs --check`, `node scripts/kit-manifest-check.mjs`, drift-check pass; `overrides` shorter by every candidate the release covers.
- [auto] agentdesk `kit-sync -Ref v1.3.0 -Apply --prune` with `ci.testMode` set: `ci.yml` override dropped, `0 removed-from-kit`, CI green on the sync PR.
- [human] Dandan merges the kit PR, gives the tag go, and merges both project sync PRs.

## Execution Mode
- **Parallel:** no. One kit branch `feat/007-kit-follow-ups` from a kit `wt-N` slot; project syncs from each project's `wt-N` slot.
- **Concurrent plans:** none.
- **Isolated DB:** no.
- **Kit edits:** kit PR; Dandan merges; tag after Dandan's go.

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`.

```scope
core/**
packs/**
layers/**
tools/**
kit.config.json
kit.json
kit-sync.ps1
docs/**
CHANGELOG.md
README.md
.github/workflows/**
```

**Outside this repo:** the two project syncs (C7, C8), each on a branch in that project's `wt-N` slot: `.kit/**`, `kit.config.json`, and the kit-managed files `kit-sync -Apply` writes or `--prune` deletes. FoodVibe also: `docs/workflow-kit/**` (manifest + `kit-owned.json` regeneration). Kit GitHub repo: PR, tag, release.

## Read Scope
Kit repo; FoodVibe and agentdesk repos (their overrides, `kit.config.json`, `.kit/install.json`, CI runs).

## Escalation Protocol
Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append the path to the scope block and retry. Project sync `conflict` rows: STOP and show them, never `--force`. A backport that would change the render for a project that doesn't set the new key: STOP and ask. Tags and releases: wait for Dandan's go.

## Architecture Impact
- INV-none: preserves — kit templates, tools and config keys; projects get them only through `kit-sync`. No app, server or schema file.

## Step 0 — Reality Check
- Kit `main` clean at or after the Snapshot; agentdesk PR #11 merged; both projects' `.kit/install.json` on `v1.2.0`.
- Render each FoodVibe backport candidate with FoodVibe's config and diff it against FoodVibe's override; write the exact differing lines into Execution Notes before choosing keys.
- Check how `KIT:if key=value` handles a key with a default (`tools/lib/kit.mjs`), so `ci.testMode` can default to `run` in `kit.config.json`.

## Design
- **`ci.testMode`** in kit defaults (`"run"`). `ci.yml`: `# KIT:if ci.testMode=skip` drops the job; the run line is `npm run {{commands.test}}` or `npm run --if-present {{commands.test}}`. install/sync refuse any other value (exit 2, `commandProblems`), same as other enums. The `upstream-owned` layer does **not** change the default: a project chooses it.
- **Sync prune** in `tools/sync.mjs`: auto-drop records of `removed-from-kit` files that are missing; `--prune` (`kit-sync.ps1 -Prune`) deletes unchanged managed files and drops records of edited files and seeds. Overrides are never touched. The summary line gains `N pruned`.
- **adoption-report:** move the command-building part of `frontendArgs()` into a pure function that takes the config values (no module-level config read), used by both `slot-procs.mjs` and `tools/adoption-report.mjs`. Rendered `slot-procs.mjs` output for FoodVibe stays byte-identical in behaviour.
- **Backports:** prefer existing keys and `PACK:` fragments; add a new key only when no existing one fits. Likely shapes (Step 0 confirms): a UI-language/direction key for the "Hebrew RTL" lines; an icon-library key for Lucide; an optional `commands.logQuery` for the `/review-it` step (no key = step not rendered); the domain-logic line through an existing `paths.*` doc key. A candidate whose wording is truly FoodVibe-only stays an override.

## Atomic Sub-tasks
- [ ] C0: Check the prerequisites and record the exact override diffs — Step 0 — this plan file
- [ ] C1: Let a project skip or soften the CI unit-test job — `ci.testMode` key, ci.yml conditionals, validation, install-check renders for run / if-present / skip — `core/.github/workflows/ci.yml`, `kit.config.json`, `tools/lib/**`, `tools/install-check.mjs`
- [ ] C2: Let sync clean up files the kit stopped shipping — auto-drop missing records, `--prune` flag, dry-run preview, install-check cases (unchanged / edited / seed / override / missing) — `tools/sync.mjs`, `kit-sync.ps1`, `tools/install-check.mjs`
- [ ] C3: Show the real frontend command in the adoption report — shared pure command builder, Angular and React-Vite fixture assertions — `core/scripts/lib/slot-procs.mjs`, `tools/adoption-report.mjs`, `tools/acceptance-check.mjs`
- [ ] C4: Turn FoodVibe's small wording overrides into kit settings — one key or fragment per candidate per C0, or a recorded "stays an override" — `packs/angular/**`, `core/**`, `kit.config.json`
- [ ] C5: Document the new keys and release notes — README config section, CHANGE-LOOP prune note, CHANGELOG `[1.3.0]` with "overrides you can drop" — `README.md`, `docs/**`, `CHANGELOG.md`, `kit.json`
- [ ] C6: Release v1.3.0 — all checks, kit PR, merge after Dandan's review, tag + GitHub release after Dandan's go — kit repo
- [ ] C7: Sync FoodVibe to v1.3.0 and drop the covered overrides — dry-run, set the new keys, Apply, delete the covered `overrides` entries, ng build, kit-owned + manifest checks, /ship — `../foodVibe1.0` slot
- [ ] C8: Sync agentdesk to v1.3.0 and drop its CI override — set `ci.testMode`, Apply with `--prune`, delete the `ci.yml` override, CI green, /ship — `../agentdesk` slot

## Out of Scope
- agentdesk's other 7 overrides (pack skills/docs it keeps for project-specific symbols, `docs-refresh.md`, `standards-supabase.md`).
- A docs-map skill for the React-Vite pack (`/docs-refresh` fallback).
- Extra CI steps a project wants in place of the test job (agentdesk's scripts install + link check): a later plan if more than one project needs it.

## Execution Notes
