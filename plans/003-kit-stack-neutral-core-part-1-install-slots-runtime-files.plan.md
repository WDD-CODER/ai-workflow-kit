# Plan 003 — Kit Stack-Neutral Core Part 1: Install, Slots and Runtime Files

Status: draft
Snapshot: b0ba42501af952fc23566a1885fab53af57e6686

## Problem Statement
The kit is built as "Angular + Express + the project owns every file". The React + Vite adoption (hand-off `handoff/2026-10-18-react-vite-adoption.md`, local only, never commit) had to fork 23 kit files to get there. This plan makes the **install and slot runtime** stack-neutral: the dev server, runtime ignore rules, script dependencies, kit rules and config validation stop assuming Angular and project-owned root files. Plan 004 does the same for CI, commands and tech-debt rules; plan 005 adds the React-Vite pack and releases everything as **v1.2.0**.

Hand-off issues in this plan:
- **I-2** `take-plan` half-claims when the claim commit fails (branch created, plan staged, no commit).
- **I-4** runtime ignore rules don't reach a fresh clone when `.gitignore` is project/upstream-owned → `TAKE_PLAN: uncommitted or untracked changes present`.
- **I-5** `commands.*` accept full commands and render `npm run npm run build` (14 files).
- **I-9** kit rules never load when the project owns `AGENTS.md`.
- **I-10** frontend dev server is Angular-only (`SLOT_SERVE: this project has no dev servers to start`).
- **I-11** workflow scripts need deps (`picomatch`) the project can't add to its `package.json`.
- **I-19** `.kit/install.json` changes show as `scope: out` in Worker plans.
- **I-20** config keys no template reads (`security.sensitivePaths`, `commands.npm`).
- **I-22** drift reports gitignored target files as missing; **I-26** `project.i18nFile` allows only one file; **I-27** `tools.browser` default renders "Browser tool: browser tool."

## Prerequisites
- Plan 002 merged into kit `main` and `v1.1.0` released.

## Goals & Success Criteria
- [auto] e2e: a pre-commit hook that exits 1 during `take-plan`'s claim → slot stays detached and idle, no branch left, output `TAKE_PLAN: claim commit failed: …`.
- [auto] e2e from a plain `git clone` of a fixture whose `.gitignore` is in `overrides` → `take-plan` succeeds (runtime paths excluded via `info/exclude`).
- [auto] `install-check` with `commands.build: "npm run build"` → exit 2 with a clear message (or auto-strips to `build`; pick one and test it); no render contains `npm run npm run`.
- [auto] `install-check` with a pre-existing `AGENTS.md` → `AGENTS.workflow.md` written with no `{{`, and the rendered `CLAUDE.md` imports both.
- [auto] Dev server from config: Angular fixture still starts `ng serve -c slot` (pack values); a fixture with `commands.dev: "dev"` + Vite values starts `fe=<port>`, re-run says `kept`, `slot-stop` frees the port.
- [auto] `scripts/package.json` is kit-managed; install runs `npm install --prefix scripts`; `take-plan`/`slot-serve` re-install when `scripts/package-lock.json` changes.
- [auto] `scope-check.mjs` treats `.kit/install.json` as always allowed; `ship-prep` reads sensitive paths from `security.sensitivePaths` (current regex as default).
- [auto] Kit `leak-check`, `pack-check`, `install-check`, `e2e-check` pass on Linux and Windows CI. No release in this plan (CHANGELOG `[Unreleased]`).
- [auto] FoodVibe safety: `kit-sync` dry-run from this kit branch into FoodVibe (local source) lists only expected rows and 0 `conflict`; in a scratch clone of FoodVibe with that sync applied, `node scripts/slot-serve.mjs` in a slot starts the Angular dev server as before.

## Execution Mode
- **Parallel:** no. Session opened in the kit folder. FoodVibe is read and cloned to scratch only; no FoodVibe commit in this plan.
- **Concurrent plans:** no other kit plan; 004 starts after this merges.
- **Isolated DB:** no.
- **Kit edits:** kit branch `feat/003-neutral-core-runtime` + kit PR; Dandan merges. No tag.

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`.

```scope
core/**
packs/angular/**
packs/node-express/**
templates/**
tools/**
kit.config.json
docs/**
CHANGELOG.md
README.md
```

**Outside this repo:** FoodVibe: read only, plus a scratch clone under the session scratchpad for the safety test (N8); notes go in this plan file. No FoodVibe commit.

## Read Scope
Kit repo, FoodVibe repo, the hand-off (§1, §3 I-2/4/5/9/10/11/19/20/22/26/27, Appendix A).

## Escalation Protocol
Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append the path to the scope block and retry. A change that would make FoodVibe need a new `overrides` entry: STOP and show it.

## Architecture Impact
- INV-none: preserves — kit install/runtime scripts only; FoodVibe app, server and schemas untouched.

## Step 0 — Reality Check
- 002 merged; kit `main` clean. Re-read each issue above against kit `main`; one `ok` / `already fixed` line each.
- Decide and write here: I-5 refuse vs auto-strip (recommend refuse, exit 2 — explicit beats magic).

## Design
- **take-plan (I-2):** claim commit in a try block; on failure `git reset -q --soft HEAD`, `git switch --detach origin/<main>`, `git branch -D <branch>`, print the reason.
- **local-excludes (I-4):** new `core/scripts/local-excludes.mjs` holds the runtime ignore list (single source); appends idempotently to `$(git rev-parse --git-common-dir)/info/exclude`, `--check` mode. `templates/.gitignore` runtime block is rendered from it. Run by install, `take-plan` (before the dirty check) and worktree-setup.
- **commands validation (I-5):** `install.mjs` and `sync.mjs` refuse a `commands.*` value starting with `npm run `; scaffold comment says "npm script names (e.g. `build`), not commands".
- **AGENTS.workflow.md (I-9):** when `AGENTS.md` is in `overrides` or exists and isn't kit-installed, render the template to `AGENTS.workflow.md` (managed, header says who owns what); `templates/CLAUDE.md` imports both. FoodVibe keeps its kit-installed `AGENTS.md` (no change).
- **Dev server by config (I-10):** `slot-procs.mjs` reads `commands.dev`, `slots.fePortArgs`, `slots.feMatcher`; `hasFrontend()` = the dev script exists. Angular pack supplies `ng serve -c slot` args, `environment.slot.ts` generation and the `NG_SERVE` matcher, so FoodVibe behaviour is unchanged. Keep `--strictPort`-style "fail, don't hop ports" as a documented requirement for any pack.
- **scripts/package.json (I-11):** kit-managed `scripts/package.json` (`picomatch` 4.0.7+), `npm install --prefix scripts` at install and in slot setup; hash its lockfile like the root one. For FoodVibe (root `package.json` already has picomatch) this is additive.
- **I-19:** `.kit/install.json` in `scope-check.mjs` GENERATED list. **I-20:** render `SENSITIVE_PATHS_RE` from `security.sensitivePaths`; drop `commands.npm` if unused. **I-22:** drift/install skip target paths the target's `.gitignore` ignores (report `ignored`). **I-26:** `project.i18nFile` accepts a glob/folder for hotspots. **I-27:** `tools.browser` default omits the line.
- Each new or renamed config key: scaffold + parameters doc + CHANGELOG `[Unreleased]`.

## Atomic Sub-tasks
- [x] N0: Check which runtime issues are still open and pick refuse versus auto-strip — Step 0 — `plans/003-kit-stack-neutral-core-part-1-install-slots-runtime-files.plan.md`
- [x] N1: Leave the slot clean when claiming a plan fails halfway — rollback on claim-commit failure + e2e case — `core/scripts/take-plan.mjs`, `tools/e2e-check.mjs`
- [x] N2: Keep runtime files ignored in fresh clones even when the project owns its gitignore — local-excludes script as the single list; install, take-plan and worktree-setup run it — `core/scripts/local-excludes.mjs`, `templates/.gitignore`, `core/.claude/skills/worktree-setup/SKILL.md`
- [x] N3: Refuse full commands where the config expects npm script names — install and sync validation, scaffold wording, install-check case — `tools/{install,sync,install-check}.mjs`, `kit.config.json`
- [x] N4: Load the kit rules even when the project owns its AGENTS file — AGENTS.workflow.md render + CLAUDE.md imports both — `tools/install.mjs`, `templates/{AGENTS,CLAUDE}.md`
- [x] N5: Start any stack's dev server in slots from config instead of Angular-only code — slot-procs reads config; Angular pack supplies today's values — `core/scripts/{slot-serve,take-plan}.mjs`, `core/scripts/lib/slot-procs.mjs`, `packs/angular/**`
- [x] N6: Give workflow scripts their own package file so projects needn't edit theirs — kit-managed scripts/package.json, install --prefix scripts, lockfile hash — `core/scripts/package.json`, `tools/install.mjs`, `core/scripts/{take-plan,slot-serve}.mjs`
- [x] N7: Fix the smaller config and drift gaps from the adoption — install.json always in scope, sensitive paths from config, ignored files skipped, i18n glob, browser default — `core/scripts/{scope-check,ship-prep}.mjs`, `tools/{drift-check,install}.mjs`, `kit.config.json`
- [x] N8: Prove FoodVibe still works with the changed kit before merging — local-source kit-sync dry-run (0 conflicts) and scratch-clone slot-serve test; notes file — this plan file
- [ ] N9: Run all kit checks and open the kit PR — leak-check, pack-check, install-check, e2e-check (Linux + Windows); CHANGELOG Unreleased — kit repo

## Out of Scope
CI workflows, core command style rules, tech-debt scan (004); React-Vite pack, upstream-owned layer, release (005).

## Execution Notes

Run under plan 006 (autonomous run): branch `feat/003-neutral-core-runtime` from `feat/002-planner-review`
(`1c931af`, PR #24, not merged yet), stacked PR. Plan 006 replaces "002 merged + v1.1.0 released" and "Dandan
merges": no tag, no release, no `kit.json` bump; CHANGELOG `### 003 — …` under `## [Unreleased]`.

### N0 — Reality check (against the 002 branch)
- I-2 open: the claim (`switch -c` → Status active → `add` → `commit`) had no rollback.
- I-4 open: the runtime list lived only in `templates/.gitignore` (a seed); nothing wrote `info/exclude`.
- I-5 open: install only noted a missing script; sync did nothing.
- I-9 open: `AGENTS.md` (seed) was simply skipped when present or overridden.
- I-10 open: frontend = `src/environments/environment.local.ts` exists, start = `npm exec -- ng serve -c slot`,
  matcher `NG_SERVE`, in both `take-plan.mjs` and `slot-serve.mjs`.
- I-11 open: install told the project to `npm install -D husky picomatch`.
- I-19 open: `GENERATED` in `scope-check.mjs` lacked `.kit/install.json`.
- I-20 open: `SENSITIVE_PATHS_RE` hard-coded in `ship-prep.mjs`; `commands.npm` read by no file.
- I-22 open: drift-check/install had no ignore handling.
- I-26 partly fixed already: hotspots are picomatch globs, so `src/locales/**` worked; a folder did not.
- I-27 open: kit default `tools.browser: "browser tool"` → "Browser tool: browser tool." in `AGENTS.md`.
- Overlap with 001/002: none of these were touched by 001 (hooks, SessionStart, run-python, pre-push ranges,
  todo-sync) or 002 (templates, plan review). 002's promoted-seed rule in `sync.mjs` is kept as is.

### Decisions
- **I-5: refuse, exit 2** (plan + hand-off recommendation: explicit beats magic). Install and sync print
  `STOP — commands.build is "npm run build" — … set it to "build"` and write nothing. Any value starting with
  `npm ` counts (`npm run x`, `npm run-script x`, `npm test`). `commands.lintStaged` and `commands.dbBackup` are
  not script names and are not checked.
- **Frontend keys:** the Design's three keys plus two, so the angular pack reproduces today's start command
  byte for byte (FoodVibe STOP rule): `slots.feExec` (optional binary run with `npm exec --` instead of
  `npm run <commands.dev> --`) and `slots.feEnvFile` (optional env file the frontend needs; its `.local` → `.slot`
  copy gets the slot's backend port — the old `environment.slot.ts` generation, now driven by the key).
  Angular pack: `feExec ["ng","serve"]`, `fePortArgs ["-c","slot","--port","{port}"]`, the old `NG_SERVE` regex,
  `feEnvFile src/environments/environment.local.ts`. Kit default `fePortArgs ["--port","{port}"]`, matcher default
  `run <commands.dev>`. `hasFrontend()` = `commands.dev` names a `package.json` script (and `feEnvFile` exists when set).
  A process matching `feMatcher` also counts as a dev-chain process, so a stack whose CLI is not in the built-in
  list is still recognised. Pack list values under `slots.*` are not merged across packs (first pack wins).
- **node-express pack drops `commands.dev: "dev"`:** core now reads `commands.dev` as the root frontend script;
  that default named the backend's script and nothing read it. FoodVibe sets `commands.dev: "start"` itself.
- **`scripts/package.json` `type`** is rendered from the root `package.json` (`kit.scriptsType`, default
  `commonjs`): a nested `package.json` without `type` would flip a project's own `scripts/*.js` from ESM to CJS.
  `install` runs `npm install --prefix scripts` under `--install-deps` (the existing flag; install-check runs
  offline), otherwise prints the command. `take-plan` / `slot-serve` install it when `scripts/package-lock.json`
  changes (no restart of running servers for it). No lockfile yet = skipped (an install would create an untracked
  lockfile in the slot).
- **`security.sensitivePaths`**: rendered with a new `|json` filter so the script can tell a string from a list.
  A regex string replaces the built-in regex (FoodVibe's value is exactly the old regex → identical behaviour);
  a list of globs (what the packs ship) is added to it; unset → the old regex.
- **I-22 `ignored`**: install, sync and drift-check all skip a *missing* kit file that `git check-ignore` says the
  target ignores (tracked files are never ignored by git). Sync was added for consistency, so a file install
  skipped is not written by the next `--apply`.
- **I-27**: the kit default stays `"browser tool"` (managed files keep their wording); the `AGENTS.md` skeleton
  drops only the tool name when the project/pack did not set `tools.browser` (`kit.browserSet`).
- **I-9**: `AGENTS.workflow.md` replaces the `AGENTS.md` seed in the plan when the project owns `AGENTS.md`;
  heading `# AGENTS.workflow.md — <project>` plus a kit-managed note. Without `.kit/install.json` (drift-check on a
  hand-copied project, `--adopt`) only an `overrides` entry counts. CLAUDE.md marker `<!-- KIT:agents-workflow -->`.
- **local-excludes** runs always (harmless when `.gitignore` already has the entries); the list is parsed by
  `tools/lib/kit.mjs` from the `KIT:runtime-ignores` block, so the `.gitignore` skeleton is rendered from it.
- No scope paths added (everything is under `core/**`, `packs/**`, `templates/**`, `tools/**`,
  `kit.config.json`, `README.md`, `CHANGELOG.md` and this plan).

### Evidence (`[auto]` Done-when)
- Claim rollback: e2e `PASS a refused claim commit rolls back: slot detached and idle, no branch left, clean tree`
  (a pre-commit that exits 1 via `GIT_CONFIG_*` env for that one call; output `TAKE_PLAN: claim commit failed: …`)
  and `PASS after the rollback the same slot claims the plan normally`. Mutation (rollback removed): FAIL.
- Fresh clone, `.gitignore` in `overrides`: e2e `PASS fresh clone with its own .gitignore: take-plan claims
  (runtime files in .git/info/exclude)` (also `git status --porcelain` empty, `local-excludes --check` exit 0).
  Mutation (no `ensureLocalExcludes` call): FAIL with `TAKE_PLAN: uncommitted or untracked changes present`.
- Full commands: `node tools/install.mjs --target <dir>` with `commands.build: "npm run build"` →
  `KIT_INSTALL: STOP — commands.build is "npm run build" — commands.* take npm script names, not commands: set it
  to "build"`, exit 2, only `kit.config.json` in the folder. install-check covers install and sync (exit 2,
  install.json unchanged) and asserts no render in any fixture contains `npm run npm run`.
- `AGENTS.md` pre-existing (and overridden): install-check — `AGENTS.workflow.md` has `## Hard rules`, no `{{`,
  recorded `managed`; `AGENTS.md` untouched; `CLAUDE.md` has `@AGENTS.md` and `@AGENTS.workflow.md`; sync 0/0/0,
  drift-check ok.
- Dev server: install-check evaluates the rendered constants — angular fixture `start` / `ng serve` /
  `-c slot --port {port}` / env file; core fixture kit defaults. e2e (stand-in strict-port server, `commands.dev:
  "dev"`, `fePortArgs ["--port","{port}","--strictPort"]`): `PASS slot-serve starts the frontend from commands.dev
  (fe=47201 started)`, `PASS slot-serve again keeps it (fe=47201 kept)`, `PASS slot-stop stops it and frees the port`.
- `scripts/package.json`: e2e `PASS install --install-deps installs the workflow scripts' own dependencies` (lockfile
  written, no `picomatch` in the root devDependency list) and `PASS take-plan installs the scripts/ dependencies when
  their lockfile is new to the slot`; install-check asserts the file in every fixture (`picomatch`, `type`).
- `.kit/install.json`: e2e `PASS scope-check always allows .kit/install.json`. Sensitive paths: install-check —
  core fixture regex `only-this` replaces the default (`package.json` not sensitive), angular globs add to it.
- Checks (final run before push; see the PR body for the last lines): leak-check ×3, pack-check, install-check,
  e2e-check (42 cases) all ok locally on Windows; Linux + Windows CI on the PR.

### N8 — FoodVibe safety (read-only; scratch clone under the session scratchpad)
- `node tools/sync.mjs --target ../foodVibe1.0 --source .` → `KIT_SYNC: dry-run — 3 new, 20 kit-update,
  2 conflicts, 26 local-only, 0 deleted-locally, 0 removed-from-kit, 20 overrides`. Conflicts: exactly
  `.claude/references/hld-template.md` and `.claude/references/prd-template.md` (expected from 002). No `ignored`
  row, no new override needed, FoodVibe `git status` clean.
- Rows 003 adds over the 002 branch (same dry-run from `1c931af`: 1 new, 15 kit-update): `new`
  `scripts/local-excludes.mjs`, `scripts/package.json`; `kit-update` `.claude/skills/worktree-setup/SKILL.md`,
  `scripts/lib/slot-procs.mjs`, `scripts/scope-check.mjs`, `scripts/slot-serve.mjs`, `scripts/take-plan.mjs`
  (`save-plan/SKILL.md` and `ship-prep.mjs` were kit-update already and change again). Rendered-file diff
  002 → 003 for FoodVibe: only those files plus the `.gitignore` seed (not synced). `CLAUDE.md`/`AGENTS.md`
  renders unchanged.
- Rendered FoodVibe values: `frontendArgs(4201)` = `["exec","--","ng","serve","-c","slot","--port","4201"]` (the old
  command), `hasFrontend` true, the `ng serve` matcher; `ship-prep` sensitive regex source identical to the old one.
- Scratch clone (`git clone --no-hardlinks`, push URL disabled, `core.longpaths`), sync `--apply` from the slot
  (`applied — 3 new, 20 kit-update, 2 conflicts …`), `npm ci`, folder `foodVibe1.0-wt-7` (ports 4207/3007, free; no
  real slot uses 7). Backend disabled in the clone (`server/package.json` renamed) so no local database is touched;
  the backend code path is unchanged by 003. `node scripts/slot-serve.mjs` → `SLOT_SERVE: fe=4207 started`; the
  listener is `node …\@angular\cli\bin\ng.js serve -c slot --port 4207`, root `npm-cli.js exec -- ng serve -c slot
  --port 4207`; `environment.slot.ts` written with `http://localhost:3007`; HTTP 200. Re-run → `fe=4207 kept`.
  `node scripts/slot-stop.mjs` → `stopped PID … (recorded: node.exe npm-cli.js exec -- ng serve -c slot --port
  4207)`, port 4207 free, no node process left. Scratch clone deleted afterwards.
