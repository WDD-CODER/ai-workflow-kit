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
- [ ] N0: Check which runtime issues are still open and pick refuse versus auto-strip — Step 0 — `plans/003-kit-stack-neutral-core-part-1-install-slots-runtime-files.plan.md`
- [ ] N1: Leave the slot clean when claiming a plan fails halfway — rollback on claim-commit failure + e2e case — `core/scripts/take-plan.mjs`, `tools/e2e-check.mjs`
- [ ] N2: Keep runtime files ignored in fresh clones even when the project owns its gitignore — local-excludes script as the single list; install, take-plan and worktree-setup run it — `core/scripts/local-excludes.mjs`, `templates/.gitignore`, `core/.claude/skills/worktree-setup/SKILL.md`
- [ ] N3: Refuse full commands where the config expects npm script names — install and sync validation, scaffold wording, install-check case — `tools/{install,sync,install-check}.mjs`, `kit.config.json`
- [ ] N4: Load the kit rules even when the project owns its AGENTS file — AGENTS.workflow.md render + CLAUDE.md imports both — `tools/install.mjs`, `templates/{AGENTS,CLAUDE}.md`
- [ ] N5: Start any stack's dev server in slots from config instead of Angular-only code — slot-procs reads config; Angular pack supplies today's values — `core/scripts/{slot-serve,take-plan}.mjs`, `core/scripts/lib/slot-procs.mjs`, `packs/angular/**`
- [ ] N6: Give workflow scripts their own package file so projects needn't edit theirs — kit-managed scripts/package.json, install --prefix scripts, lockfile hash — `core/scripts/package.json`, `tools/install.mjs`, `core/scripts/{take-plan,slot-serve}.mjs`
- [ ] N7: Fix the smaller config and drift gaps from the adoption — install.json always in scope, sensitive paths from config, ignored files skipped, i18n glob, browser default — `core/scripts/{scope-check,ship-prep}.mjs`, `tools/{drift-check,install}.mjs`, `kit.config.json`
- [ ] N8: Prove FoodVibe still works with the changed kit before merging — local-source kit-sync dry-run (0 conflicts) and scratch-clone slot-serve test; notes file — this plan file
- [ ] N9: Run all kit checks and open the kit PR — leak-check, pack-check, install-check, e2e-check (Linux + Windows); CHANGELOG Unreleased — kit repo

## Out of Scope
CI workflows, core command style rules, tech-debt scan (004); React-Vite pack, upstream-owned layer, release (005).
