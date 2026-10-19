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
kit-sync.ps1
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
- [x] V0: Check 003 and 004 landed and decide where the Supabase backend rules live — Step 0 — `plans/005-kit-react-vite-pack-upstream-owned-layer-adoption-checks.plan.md`
- [x] V1: Add a React and Vite stack pack built from the files that already work — standards, conventions, skills, gotchas, techdebt rules, config defaults, fragments — `packs/react-vite/**`
- [x] V2: Add the Supabase backend rules where React projects can opt in — backend standards + gotchas as layer or pack part per V0 — `layers/supabase/**` or `packs/react-vite/**`
- [x] V3: Support projects that are a copy of someone else's repo without touching their files — upstream-owned layer, ownership.upstreamPaths, scope-guard message, CI defaults, pull-copy command — `layers/upstream-owned/**`, `core/scripts/scope-check.mjs`, `tools/install.mjs`
- [x] V4: Let the end-to-end check run against a real installed project — e2e --project mode, safe junction cleanup — `tools/e2e-check.mjs`
- [x] V5: Add an adoption report that shows which workflow parts are installed and working — adoption-report tool — `tools/adoption-report.mjs`
- [x] V6: Run the acceptance test on Angular, React-Vite and upstream-owned fixtures in kit CI — fixtures + CI matrix (Linux + Windows) — `tools/fixtures/**`, `.github/workflows/**`
- [x] V7: Release v1.2.0 with clear upgrade notes — CHANGELOG what-to-do, kit.json, README packs/layers section; tag after Dandan's go — kit repo (run 006: version 2.0.0, no tag — the tag waits for merge point 1)
- [ ] V8: Sync FoodVibe to v1.2.0 and ship it — dry-run, Apply, ng build, kit-owned and manifest checks, /ship — `../foodVibe1.0/.kit/install.json` + files kit-sync writes (after merge point 1: plan 006 A7, to v2.0.0)
- [ ] V9: Have the React project drop its forked files and delete the hand-off — adopting project syncs v1.2.0 and removes Appendix A overrides; delete the kit handoff folder after Dandan's go — `handoff/` (after merge point 1: plan 006 A8, to v2.0.0)
- [x] V10: Make the installer detect the project stack and install only the matching packs — pack.json detect rules, proposal + confirm, refuse when nothing matches, install-check cases for both stacks — `tools/install.mjs`, `tools/lib/**`, `packs/*/pack.json`, `kit-install.ps1`, `tools/install-check.mjs`

## Out of Scope
Porting the Python session-manifest scripts to node; the guards mod stale-scope bug (hand-off I-28, tracked under FoodVibe plan 409); upstream fixes in the friend's repo (hand-off Appendix B).

## Execution Notes

Run under plan 006 (autonomous run, step A4): branch `feat/005-react-vite-pack` from `feat/004-neutral-core-ci-commands`
(`ab260e9`, PR #26, not merged yet), stacked PR. Plan 006 replaces "Dandan merges / tag after go": no tag, no release.
Version **2.0.0** (Planner decision: 002/003 need project action, which the kit's semver rule calls major; the Human
confirms at merge point 1), not the 1.2.0 the Goals name. V8 and V9 run after merge point 1 (plan 006 A7 / A8).

### V0 — Reality check
- 003 and 004 are on the stacked branches (PRs #25, #26), not merged; this branch builds on them. Their pack contract
  (`provides`: conventionsDoc, backendDoc, styleSkill, authSkill, docsMapSkill, docsMapCheck, cssSection, componentsSection;
  `PACK:` fragments; `techdebtRules`) covers every core reference the React-Vite pack must satisfy; it provides all but
  `docsMapSkill`/`docsMapCheck` (no breadcrumbs: `/docs-refresh` takes its fallback, asserted by install-check).
- **Decision: the Supabase rules live in a layer, `layers/supabase/`** (plan + hand-off recommendation): a React project
  without Supabase gets none of them. This needed layers as a concept (only `layers/cursor/` existed, chosen by
  `--cursor`): `layers/<name>/layer.json` takes the optional `pack.json` fields, applies after the packs, is chosen with
  `--layers` / `stack.layers` and recorded in `.kit/install.json` `layers`. The Supabase backend doc is
  `docs/agent/standards-supabase.md` (provides `backendDoc`), so it never clashes with node-express's `standards-backend.md`.

### Decisions
- **Generalising the project files:** every file was rewritten as "check how this project does X" plus common shapes; no
  project name, people, product rules, counts, dates or paths beyond the usual `src/` layout. AI-builder traps went to the
  upstream-owned layer's gotchas, Supabase traps to the Supabase layer, Vite traps to the pack.
- **workflow-map skill rows:** a new `<!-- PACK:workflow-map:skills -->` marker under the §4 table (the existing
  `PACK:stack —` line is prose, not a marker). No pack section = the line is dropped, so other renders are unchanged.
- **`ownership.upstreamPaths`** (globs, own small glob matcher: tools stay built-ins only): matching kit files are
  overrides with reason "upstream-owned (ownership.upstreamPaths)" in install, sync and drift-check, so the acceptance
  fixture needs **no** hand-written override. The layer default is `.gitignore`, `AGENTS.md`, `package.json`,
  `package-lock.json` (a project list replaces it). In a slot, `scope-check --file` prints `SCOPE: upstream <path>` and the
  guard denies with "upstream-owned … not an `approved:`", even when the plan lists the path (another repo owns it).
  An upstream-owned `package.json` gets no `npm install -D husky` (hooks via `core.hooksPath`).
- **Detection (V10):** `detect: { order, anyOf: [rules] }` in each `pack.json` / `layer.json` (`deps` with `in` folders,
  `path`, `gitRemote`). It runs only when there is no `--packs`, no `stack.packs` and no packs recorded in
  `.kit/install.json` (and never for `--adopt`, sync or drift-check), so FoodVibe (`stack.packs` set) and every installed
  project are untouched. Without `--yes` it prints the proposal and exits 2 (also with `--dry-run`), writing nothing;
  `--yes` installs and records `stack.packs`/`stack.layers`; no pack matching → exit 2. Consequence: a core-only install
  must say so (`--packs ""` / `stack.packs: []`) — CHANGELOG what-to-do item 2; install-check and e2e fixtures now name it.
- **Adding a pack to an installed project:** `kit-sync --packs/--layers` (recorded on `--apply`) — needed for V9 (the
  adopting project is installed with `packs: []`). `kit-sync.ps1` got `-Packs/-Layers` (**scope added: `kit-sync.ps1`**).
  PowerShell 5 drops an empty native argument, so the wrappers pass `--packs=<list>`; `parseArgs` accepts `--flag=value`.
- **e2e `--project` (V4):** adapted from the project's own e2e, made generic (ports from `slots.fePorts`, main branch,
  repo name, hotspot, upstream-owned path, dev/build scripts from the effective config). Junctions removed with `rmdir`
  (POSIX: unlink); the temp folder is deleted only when every junction is gone, and the source `node_modules` folders are
  checked afterwards. Drift-check uses this kit when the recorded source is local.
- **Fixtures (V6):** generated by `tools/fixtures/make-fixture.mjs`, not stored as trees (a stored fixture `.gitignore`
  would apply to the kit repo). No network installs: `npm run dev` is a stand-in strict-port server named `vite.mjs`
  (matches the pack's matcher); only `scripts/` dependencies are installed. The Angular fixture installs with `--cursor`:
  the angular pack ships `.cursor/rules`, and then `workflow-map.md` / `README_WORKFLOW.md` name `.cursor/commands/` and
  `contractor-role.mdc`, which only the Cursor layer has (pre-existing gap, noted for the review, not fixed here).
- **CI:** one step `node tools/acceptance-check.mjs --e2e` in the existing Linux + Windows `e2e` matrix (about 2 minutes
  locally: three fixtures, then e2e `--project` on the two React-Vite fixtures).
- Not done (optional in the hand-off): `breadcrumbs` as an opt-in skill for React projects that own `src/`.

### Evidence (`[auto]` Done-when)
- Acceptance (hand-off §7) on the upstream-owned fixture (React 18 + Vite + TS, Supabase-like folders, no `server/`,
  upstream-owned `.gitignore`/`package.json`/`AGENTS.md`, double quotes + semicolons, no husky):
  `install --packs react-vite --layers upstream-owned` → `KIT_INSTALL: ok`; link check 0 missing; drift-check ok with an
  empty `overrides` list (upstream paths come from `ownership.upstreamPaths`); upstream files untouched, rules in
  `AGENTS.workflow.md`; rendered CI: no `--prefix` at end of line, no server job, `ESLint (changed files)`, `npm install
  --no-audit --no-fund`, report-only app audit; first commit through the hooks (core.hooksPath, no husky, no
  --no-verify); adoption-report no fail row. `node tools/acceptance-check.mjs --e2e` →
  `ACCEPTANCE_CHECK: ok — 118 checks passed (angular, react-vite, upstream-owned, e2e --project)` (Windows, local).
- e2e `--project` on both React fixtures passes every case, incl. `slot-serve starts the frontend on the slot port
  (fe=47302 started)`, `kept`, `slot-stop … frees the port`, `pre-push accepts a Planner close-out push into a range
  folder`, `/pull-copy` replay / refused force-push / conflict abort, `scope guard denies an upstream-owned path
  (.gitignore), not an approved: decision`, SessionStart JSON (state file with quotes, backslash, backtick, newline).
  Linux + Windows: kit CI e2e matrix (see PR).
- Detection: install-check — angular+express fixture `KIT_INSTALL: detected packs=[angular, node-express] layers=[]`,
  React fixture `packs=[react-vite] layers=[supabase]`, `upstream` remote → `upstream-owned`; dry-run and no `--yes` exit 2
  writing nothing; `--yes` records the stack; an angular install has no react-vite / layer file and vice versa; nothing
  matching → exit 2; `--packs ""`, `--packs`, `stack.packs` never detect; `sync --packs/--layers` adds a pack (recorded on
  `--apply`, drift ok).
- pack-check mutation (scratch copy): a wrong section name, a bad detect rule and a missing layer doc →
  `PACK_CHECK: FAIL — 3 packs + 2 layers checked, 3 problems`.
- Tag + release: not in this run (plan 006 A6, `v2.0.0`, after merge point 1). CHANGELOG `[2.0.0]` lists the `commands.*`
  script-name change and the droppable overrides.
- Final checks (local, Windows): `LEAK_CHECK: ok — 160 files` / `47 files` / `3 files, 0 leaks`;
  `PACK_CHECK: ok — 3 packs, 2 layers, 8 contract keys used by core (each provided), 0 problems`;
  `INSTALL_CHECK: ok — 5 fixtures, … stack detection, upstream-owned layer, 0 problems` (actionlint not installed locally;
  CI requires it); `E2E_CHECK: ok — 42 cases passed`; `WORKFLOW_LINK_CHECK: ok — 6 fixtures …, 0 missing`.

### FoodVibe safety (read-only)
- `node tools/sync.mjs --target ../foodVibe1.0 --source .` → `3 new, 27 kit-update, 2 conflicts, 26 local-only,
  0 deleted-locally, 0 removed-from-kit, 20 overrides`; conflicts exactly `hld-template.md`, `prd-template.md`.
- Render diff 004 → 005 with FoodVibe's config: `scripts/scope-check.mjs` (`UPSTREAM = [].concat([])`, never matches) and
  `scripts/scope-guard.sh` (a branch only `SCOPE: upstream` reaches). No CI, command-rule or dev-server change, no new
  override, no react-vite or layer file; detection never runs for it (`stack.packs` set).

### Adopting-project preview (read-only, for A8)
- `sync` stops on `commands.dev "npm run dev"` → set `"dev"`. With that and `--packs react-vite --layers
  supabase,upstream-owned` (in-memory render): `.gitignore`, `AGENTS.md` covered by `ownership.upstreamPaths`;
  `.vscode/settings.json` identical; the other 23 Appendix-A overrides differ only as older forks of what the kit now
  does → drop, sync, review. Care: `docs-refresh.md` (custom procedure), `ci.yml` (its own link-check step), the
  tech-debt baseline (old rule names: rewrite with `scan --write-baseline`).
