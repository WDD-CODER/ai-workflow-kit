# Plan 005 — Kit React-Vite Pack, Upstream-Owned Layer and Adoption Checks

Status: draft
Snapshot: b0ba42501af952fc23566a1885fab53af57e6686

## Problem Statement
With a stack-neutral core (plans 003, 004), the kit can ship what the React + Vite + Supabase adoption built by hand: a `packs/react-vite/` pack, a `layers/upstream-owned/` layer for projects that are a copy of someone else's repo, and the verification tools that found the problems. Then it releases everything as **v1.2.0**, syncs FoodVibe, and the adopting project drops its forked files. Source: hand-off `handoff/2026-10-18-react-vite-adoption.md` §4, §5, §6, §7 (local only, never commit; the pack files are copied from the adopting project and generalised — no project names, people or paths reach the kit).

## Prerequisites
- Plans 003 and 004 merged into kit `main`.

## Goals & Success Criteria
Hand-off §7 acceptance test is the definition of done:
- [auto] React 18 + Vite + TS fixture (Supabase-like folders, no `server/`, upstream-owned `.gitignore`/`package.json`/`AGENTS.md`, double quotes + semicolons, no husky): `install --packs react-vite --layers upstream-owned` → `KIT_INSTALL: ok`; `workflow-link-check` → 0 missing; `drift-check` → ok with only the upstream-owned paths in `overrides`.
- [auto] `e2e-check --project <fixture>` passes every case on Windows and Linux CI, including the first commit running the hook without `--no-verify`, Vite slot server started/kept/freed, Planner close-out push accepted.
- [auto] Rendered CI on the fixture has no `--prefix ` at end of line, no server job, and lints changed files only.
- [auto] SessionStart run with a state file containing quotes and newlines → valid JSON.
- [auto] Tag + release `v1.2.0`; CHANGELOG "what a project must do" lists the `commands.*` script-name change and which overrides can be dropped.
- [auto] Stack detection: `install --target <fixture> --dry-run` with no `--packs` and no `stack.packs` prints `KIT_INSTALL: detected packs=[angular, node-express]` on an Angular+Express fixture and `packs=[react-vite] layers=[supabase]` on the React fixture, writes nothing until confirmed (`--yes` or `-Packs` given), and an Angular install contains no `packs/react-vite` file (and vice versa).
- [auto] FoodVibe `kit-sync -Ref v1.2.0 -Apply`: 0 unresolved `conflict`, `npx ng build`, `node scripts/kit-owned.mjs --check`, `node scripts/kit-manifest-check.mjs` pass; `overrides` list unchanged or shorter.
- [human] In a FoodVibe slot after the sync: `execute plan` on a small plan claims the slot, starts the Angular dev server on first need, and `/ship` works — same as before.
- [human] The adopting React project syncs to `v1.2.0` and deletes every "backport to kit" override in hand-off Appendix A (Dandan runs it there or confirms the other agent did). Then the `handoff/` folder is deleted from the kit checkout.

## Execution Mode
- **Parallel:** no. Session opened in the kit folder; FoodVibe sync PR from a `wt-N` slot.
- **Concurrent plans:** no other kit plan.
- **Isolated DB:** no.
- **Kit edits:** kit branch `feat/005-react-vite-pack` + kit PR; Dandan merges; tag after Dandan's go.

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`.

```scope
packs/react-vite/**
layers/**
tools/**
core/**
kit.config.json
docs/**
CHANGELOG.md
kit.json
README.md
.github/workflows/**
kit-install.ps1
handoff/**
```

**Outside this repo:** FoodVibe sync (V8): `../foodVibe1.0/` on a branch from a FoodVibe `wt-N` slot: `.kit/**`, `kit.config.json`, `docs/workflow-kit/**` and the kit-owned files `kit-sync -Apply` writes (`.claude/**`, `.cursor/**`, `.github/workflows/**`, `.husky/**`, `docs/agent/**`, `scripts/**`, `README_WORKFLOW.md`), plus `AGENTS.md` and `CLAUDE.md`; kit GitHub repo (PR, tag, release). The adopting React project syncs itself (V9).

## Read Scope
Kit repo, FoodVibe repo, the hand-off; the adopting project's files named in hand-off §4/§5 (read to copy and generalise; never write there — that project syncs itself).

## Escalation Protocol
Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append the path to the scope block and retry. FoodVibe sync `conflict` rows: STOP and show them, never `--force`. Tags, releases and deleting the hand-off: wait for Dandan's go.

## Architecture Impact
- INV-none: preserves — new kit pack/layer/tools and FoodVibe's kit-owned copies; no app, server or schema file.

## Step 0 — Reality Check
- 003 and 004 merged; kit `main` clean; FoodVibe `.kit/install.json` on `v1.1.0`.
- Confirm the pack contract from 004 lists every reference the React-Vite pack must satisfy.

## Design
- **`packs/react-vite/`** (hand-off §4 table): `standards-react.md` (`standardsDoc`), `conventions.md`, Supabase backend standards (decide in Step 0: inside the pack or a separate `layers/supabase/`; recommend a layer so React without Supabase works), `react-component-structure` skill, `cssLayer` skill (Tailwind tokens, `cn()`, logical RTL classes), `auth-and-logging` skill, generic Vite/Supabase gotchas, techdebt rule set, `pack.json` `configDefaults` (`commands.dev: "dev"`, `slots.fePortArgs`, `slots.feMatcher`, `stack.stateRules`, `paths.routesFile`, hotspots, `stylesheetExt: "css"`, `serverRoot: ""`), `AGENTS.fragment.md`, workflow-map rows, techdebt `PACK:stack` block. No `breadcrumbs`; `/docs-refresh` falls back cleanly.
- **`layers/upstream-owned/`:** config `ownership.upstreamPaths` (globs) that install never writes and the scope guard denies with "upstream-owned, not an `approved:`"; turns on local-excludes, `AGENTS.workflow.md`, `scripts/package.json`; CI defaults `ci.lintScope: changed`, `ci.appAuditMode: report`, `ci.install: "npm install --no-audit --no-fund"`; `/pull-copy` command (rebase on `upstream/main`, refuse to resolve conflicts, force-push left to the Human).
- **Tools (§5):** `tools/e2e-check.mjs --project <path>` mode (scratch clone of a real project, junctioned `node_modules` removed with `rmdir` only, asserts source `node_modules` intact); `tools/adoption-report.mjs` (per-part status from `.kit/install.json` + hooks + `.husky`); fixtures for Angular, React-Vite and upstream-owned run in kit CI.
- **Release:** bump `kit.json` to `1.2.0`, date the CHANGELOG, tag after Dandan's go.
- **Stack detection (installer):** packs are already opt-in (only the chosen packs are copied), but today the human must name them. Install now proposes them when neither `--packs` nor `stack.packs` is set: `@angular/core` → `angular`; `vite` + `react` → `react-vite`; `express` in the root or `paths.serverRoot` package → `node-express`; `supabase/` folder or `@supabase/supabase-js` → `supabase`; a fork `origin` with an `upstream` remote → suggest `upstream-owned`. It prints the proposal with the reason for each, writes `stack.packs`/layers into `kit.config.json` only after confirmation (`--yes`, or explicit `-Packs`), and refuses (exit 2) when nothing matches instead of installing core with dangling stack references. Detection rules live in each `pack.json` (`detect`), so a new pack brings its own rule.

## Atomic Sub-tasks
- [ ] V0: Check 003 and 004 landed and decide where the Supabase backend rules live — Step 0 — `plans/005-kit-react-vite-pack-upstream-owned-layer-adoption-checks.plan.md`
- [ ] V1: Add a React and Vite stack pack built from the files that already work — standards, conventions, skills, gotchas, techdebt rules, config defaults, fragments — `packs/react-vite/**`
- [ ] V2: Add the Supabase backend rules where React projects can opt in — backend standards + gotchas as layer or pack part per V0 — `layers/supabase/**` or `packs/react-vite/**`
- [ ] V3: Support projects that are a copy of someone else's repo without touching their files — upstream-owned layer, ownership.upstreamPaths, scope-guard message, CI defaults, pull-copy command — `layers/upstream-owned/**`, `core/scripts/scope-check.mjs`, `tools/install.mjs`
- [ ] V4: Let the end-to-end check run against a real installed project — e2e --project mode, safe junction cleanup — `tools/e2e-check.mjs`
- [ ] V5: Add an adoption report that shows which workflow parts are installed and working — adoption-report tool — `tools/adoption-report.mjs`
- [ ] V6: Run the acceptance test on Angular, React-Vite and upstream-owned fixtures in kit CI — fixtures + CI matrix (Linux + Windows) — `tools/fixtures/**`, `.github/workflows/**`
- [ ] V7: Release v1.2.0 with clear upgrade notes — CHANGELOG what-to-do, kit.json, README packs/layers section; tag after Dandan's go — kit repo
- [ ] V8: Sync FoodVibe to v1.2.0 and ship it — dry-run, Apply, ng build, kit-owned and manifest checks, /ship — `../foodVibe1.0/.kit/install.json` + files kit-sync writes
- [ ] V9: Have the React project drop its forked files and delete the hand-off — adopting project syncs v1.2.0 and removes Appendix A overrides; delete the kit handoff folder after Dandan's go — `handoff/`
- [ ] V10: Make the installer detect the project stack and install only the matching packs — pack.json detect rules, proposal + confirm, refuse when nothing matches, install-check cases for both stacks — `tools/install.mjs`, `tools/lib/**`, `packs/*/pack.json`, `kit-install.ps1`, `tools/install-check.mjs`

## Out of Scope
Porting the Python session-manifest scripts to node; the guards mod stale-scope bug (hand-off I-28, tracked under FoodVibe plan 409); upstream fixes in the friend's repo (hand-off Appendix B).
