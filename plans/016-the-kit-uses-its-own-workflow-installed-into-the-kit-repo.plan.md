# Plan 016 — The Kit Uses Its Own Workflow: Installed Into the Kit Repo, One Folder, No Slots

Status: draft
Snapshot: 812461f
Depends-on: 015

## Problem Statement
Every project that uses the kit gets the full workflow: the scripts, the commands, the agents and the guards. The kit
repo itself has none of it. Its `.claude/` holds only logs and session folders; there is no `scripts/`, no
`AGENTS.md`, no hooks. So kit plans are planned and built by an agent that reads `core/` by hand:
- `plan-name-similarity`, `next-plan-number`, `scope-check` cannot run (the copies in `core/scripts/` are unrendered
  templates: `{{plans.openDirs|quoted}}` is a syntax error);
- `/plan`, `/ship`, `/done` exist only as text to follow, not as commands; no build/review/validation gate runs.

The next work (the orchestrator, plans 011, 013, 014 and the rest) is the largest kit change yet and should be
planned and built with the real tools.

The kit does not need the Planner/Worker split (Dandan, 2026-10-21): it gets few changes, one at a time, and one
session usually writes a plan and then builds it. So the kit installs the full workflow but works **solo**: one
folder, the plan saved on `main`, the work on a `feat/NNN-<slug>` branch in the same folder, then `/ship`. No slots,
no slot servers (the kit has no app), no `.claude/todo.md` ledger (the plan's own checkboxes are the record).

Facts found while planning (2026-10-21):
- Dry run `node tools/install.mjs --target . --packs "" --dry-run`: 125 files would be written — `scripts/**`,
  `.claude/{commands,skills,agents,references,instructions}/**`, `.claude/settings.json`, `AGENTS.md`, `CLAUDE.md`,
  `README_WORKFLOW.md`, `docs/{agent,brain,project}/**`, `.husky/*`,
  `.github/workflows/{ci,security,todo-sync,brain-capture-reminder}.yml`, `.editorconfig`, `.nvmrc`, `.mcp.json`,
  `.vscode/settings.json`. `.gitignore` and `.gitattributes` are skipped (they exist).
- Config collision: install takes `--config`, but `tools/sync.mjs:75` and `tools/drift-check.mjs:46` always read
  `<target>/kit.config.json`, which in the kit repo is the scaffold of placeholder defaults.
- The solo flow already passes the guards: `core/scripts/branch-guard.sh:110-121` refuses code writes in the main
  folder only while it is on `main`; after `git switch -c feat/...` writes are allowed. Plans on `main` are allowed.
- But outside a slot nothing checks the plan scope: `core/scripts/ship-prep.mjs:266,329` run the scope gate only
  `inSlot`, and `core/scripts/scope-check.mjs:118` finds the plan only from `.worktree-plan`.

## Prerequisites
- Plan 015 merged (PR #34): it edits `tools/lib/kit.mjs`, `tools/install.mjs`, `tools/sync.mjs`,
  `tools/install-check.mjs`, `.github/workflows/leak-check.yml`, `README.md` and `CHANGELOG.md`, all in this scope.

## Goals & Success Criteria
**Primary:** the kit repo plans and builds its own changes with the kit's tools and gates, in one folder, and a
change to `core/` cannot merge while the installed copy differs from it.

- [auto] `node tools/install-check.mjs` passes, with new cases: (a) a project with `.kit/config.json` and a different
  `kit.config.json` → install, sync and drift-check all use `.kit/config.json` (a value only that file sets appears in a
  rendered file); (b) outside a slot, on a branch `feat/042-x` with `plans/042-x.plan.md`, a diff with a file outside
  that plan's scope makes `ship-prep` report `scope: out` with the file; on a branch with no plan number, no scope gate.
- [auto] In the kit repo: `node tools/drift-check.mjs --target .` exits 0, and `node tools/sync.mjs --target .` prints
  no `write`, `conflict` or `kit-update` row.
- [auto] `node -e "console.log(require('./.kit/install.json').source)"` prints `local:.` (no machine path is committed).
- [auto] `npm run build`, `npm run lint` and `npm test` in the kit root exit 0 (they run the kit's own checks).
- [auto] `node tools/workflow-link-check.mjs --target .` reports 0 missing; `leak-check` (all three CI runs, the docs
  run now also scanning the installed `docs/agent`, `docs/brain`, `docs/project`), `pack-check`, `install-check`,
  `e2e-check`, `acceptance-check --e2e` pass.
- [auto] `.github/workflows/leak-check.yml` has a step `node tools/drift-check.mjs --target .`; on a test branch that
  edits a `core/` file without re-syncing, that step fails (shown once in the PR, then reverted).
- [auto] `node scripts/next-plan-number.mjs` and `node scripts/plan-name-similarity.mjs --name="orchestrator" --related`
  run in the kit root and exit 0.
- [human] A new Claude Code session in the kit folder: `/plan` is a command; on `main` a code edit is refused with a
  `BRANCH_GUARD:` message; after `git switch -c feat/...` the same edit goes through.

## Execution Mode
- Parallel: no — after 015 merges (shared tool files); before 011, 013, 014 so they are built with the tools.
- Concurrent plans: none.
- Isolated DB: no (the kit has no database).
- Kit edits: kit branch `feat/016-kit-uses-its-own-workflow` + kit PR; Dandan merges. Built by hand (the last kit plan
  built without the installed tools). Release: minor (new optional `.kit/config.json` lookup; scope gate for a
  numbered plan branch outside a slot), with the next kit release.

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`.

```scope
tools/install.mjs
tools/sync.mjs
tools/drift-check.mjs
tools/lib/kit.mjs
tools/lib/source.mjs
tools/install-check.mjs
tools/e2e-check.mjs
core/scripts/scope-check.mjs
core/scripts/ship-prep.mjs
.kit/**
package.json
package-lock.json
.gitignore
AGENTS.md
CLAUDE.md
README_WORKFLOW.md
.claude/commands/**
.claude/skills/**
.claude/agents/**
.claude/references/**
.claude/instructions/**
.claude/settings.json
scripts/**
docs/agent/**
docs/brain/**
docs/project/**
docs/CHANGE-LOOP.md
.husky/**
.editorconfig
.nvmrc
.mcp.json
.vscode/settings.json
.github/workflows/leak-check.yml
plans/README.md
README.md
CHANGELOG.md
```

## Read Scope
Kit repo; FoodVibe's `kit.config.json` and installed files (to copy its Windows values, e.g. `hooks.shellPath`).

## Escalation Protocol
Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry. Never `--force` an install or sync over a file it reports as `conflict`.

## Architecture Impact
- INV-none: preserves — the kit repo becomes one more installed project; the kit's sources (`core/`, `packs/`,
  `layers/`, `templates/`) stay the single source. Projects get an optional config location (`.kit/config.json`;
  without it nothing changes) and a scope gate on a numbered plan branch outside a slot (inside a slot: unchanged).

## Step 0 — Reality Check
1. Plan 015 merged; re-read `tools/sync.mjs` config lookup (~75), `tools/drift-check.mjs` (~46), install's
   `--config` handling, the source record in `tools/lib/source.mjs`, and `ship-prep.mjs` lines ~266/329 on
   `origin/main`.
2. Check what install records as `source` for a local install into itself (`local:<absolute path>` or relative).
3. Check whether the installed `scripts/kit-owned.mjs` would deny edits to `core/` in the kit repo. Expected: no — it
   judges installed files, and `core/` is not installed. If it would, STOP and ask.
4. `gh api repos/WDD-CODER/ai-workflow-kit/branches/main --jq .protected` → `false` on 2026-10-21, so saving a plan
   with a direct push to `main` works. If it is now protected, plans go by plan PR and `plans/README.md` says so.

## Functional Requirements
1. **Config file `.kit/config.json`.** Install, sync and drift-check read, in order: `--config <file>`, then
   `<target>/.kit/config.json`, then `<target>/kit.config.json`. Install writes the effective config to the file it
   read (or to `kit.config.json` when none exists, as today). One shared helper in `tools/lib/kit.mjs`
   (`projectConfigPath(target, arg)`), used by all three tools. Messages that say "kit.config.json" name the file
   actually used.
2. **Relative local source.** When install's source folder is the target itself, the record is `local:.`; sync and
   drift-check already resolve a recorded local path against the target (`baseDir: target`).
3. **Scope gate for a numbered plan branch outside a slot.** `scope-check.mjs`: with no `--plan` and no
   `.worktree-plan`, a current branch `<type>/NNN-<slug>` whose plan `plans/NNN-*.plan.md` exists (open plan dirs) is
   the plan. `ship-prep.mjs` runs `scopeDiffReport()` and the arch report when `inSlot` **or** such a plan is found;
   otherwise unchanged (no gate). The write-time scope guard stays slot-only.
4. **The kit's own config `.kit/config.json`:** `project.name` `ai-workflow-kit`; `commands.build|lint|test|e2e` =
   `build|lint|test|e2e`; `commands.dev` empty (no app, so no servers); `hooks.shellPath` as in FoodVibe;
   `plans.openDirs` = `plans/`; `security.sensitivePaths` = `["tools/lib/source.mjs",
   "core/scripts/pre-commit-secret-scan.mjs"]`; `overrides`: `.github/workflows/ci.yml`, `security.yml`,
   `todo-sync.yml`, `brain-capture-reminder.yml` (reason: the kit's CI is `leak-check.yml`).
5. **Root `package.json`** (private, no dependencies): `build` = `node tools/pack-check.mjs`; `lint` = the three
   `leak-check` runs of CI; `test` = `node tools/install-check.mjs && node tools/workflow-link-check.mjs`; `e2e` =
   `node tools/acceptance-check.mjs --e2e`. `scripts/package.json` dependencies installed (`npm install` in
   `scripts/`), `scripts/package-lock.json` committed, `scripts/node_modules/` ignored.
6. **Project docs by hand** (install writes them once as seeds; sync never touches them again):
   `docs/project/tech-stack.md` (Node 18+ ESM tools, no app, no database, the checks) and
   `docs/project/current-state.md` (what the kit is, where sources live, the solo flow, the self-install rule).
7. **`.gitignore`:** add the kit's runtime ignores from `templates/.gitignore` (`# KIT:runtime-ignores` block: session
   files, logs, `scripts/node_modules/`). The existing lines stay.
8. **Keep source and copy equal:** a PR that changes `core/`, `packs/`, `layers/` or `templates/` also runs
   `node tools/sync.mjs --target . --apply` and commits the result. `leak-check.yml` gets a step
   `node tools/drift-check.mjs --target .` that fails the PR otherwise.
9. **Solo flow, written down** in `plans/README.md` and `docs/project/current-state.md`: `/plan` (with its Architect +
   PM review) → plan saved and pushed on `main` → `git switch -c feat/NNN-<slug>` → build the sub-tasks → `/ship`
   (build, lint, test, review, validation hand-off, PR) → Dandan merges → `git switch main && git pull`. Git hooks on in
   the kit folder: `git config core.hooksPath .husky` (per clone). `docs/CHANGE-LOOP.md` and `README.md` get one short
   section "The kit uses itself".

## Atomic Sub-tasks
- [x] S1: Let a project keep its kit settings in .kit/config.json, read the same way by install, sync and drift-check — projectConfigPath helper, messages name the file used, install-check case — tools/lib/kit.mjs, tools/install.mjs, tools/sync.mjs, tools/drift-check.mjs, tools/install-check.mjs
- [x] S2: Record a self-install's source as local:. so no machine path is committed — tools/lib/source.mjs, tools/install.mjs
- [x] S3: Check the plan scope at /ship on a numbered plan branch outside a slot — scope-check finds the plan from the branch name, ship-prep runs the gate, install-check case — core/scripts/scope-check.mjs, core/scripts/ship-prep.mjs, tools/install-check.mjs
- [x] S4: Give the kit its own settings and npm scripts — .kit/config.json, package.json, .gitignore
- [x] S5: Install the kit into its own repo and commit the copy — node tools/install.mjs --target . (no --force), scripts/ npm install, docs/project/* written by hand — .kit/**, AGENTS.md, CLAUDE.md, README_WORKFLOW.md, .claude/**, scripts/**, docs/agent/**, docs/brain/**, docs/project/**, .husky/**, .editorconfig, .nvmrc, .mcp.json, .vscode/settings.json
- [x] S6: Fail a PR whose installed copy differs from the source — drift-check step, plus the one-time proof on a test branch — .github/workflows/leak-check.yml
- [x] S7: Write down the solo flow and how the kit uses itself — plans/README.md, docs/CHANGE-LOOP.md, README.md, CHANGELOG.md

## Out of Scope
- Slots, `/take-plan`, slot servers and `.claude/todo.md` in the kit repo (the files are installed; the kit does not
  use them). The `ai-workflow-kit-wt-1` folder can be removed by Dandan when he wants; this plan does not touch it.
- Any change to what projects get installed, beyond the optional `.kit/config.json` lookup and the scope gate of FR3.
- The four project CI workflows in the kit repo (overridden; the kit keeps `leak-check.yml`).
- Cursor layer in the kit repo (`--cursor` not used).
- The orchestrator plans (011, 013, 014 and the rest): planned after this plan merges.

## Execution Notes
- 2026-10-21, decided by Dandan (Architect + PM review of this plan): build after plan 015 (PR #34) merges; the four
  project CI workflows stay out of the kit repo; plan numbers 011, 013, 014 stay with the orchestrator brief, and its
  guards / UI tier / eval plans become 017 / 018 / 019. Solo flow instead of Planner/Worker in the kit repo.
- 2026-10-21, built on `feat/016-kit-uses-its-own-workflow` from `origin/main` `39e8453` (after #34 and #35), by hand
  in the folder `ai-workflow-kit-wt-1` (the main folder stayed on `main`).
  - Step 0: plan 015 merged; sync/drift-check read only `kit.config.json` (confirmed); a self-install recorded the
    absolute folder (`localLabel` fell back to the path when `relative()` is empty) → fixed to `local:.`; the
    installed `kit-owned` check judges installed files only (`core/` edits are not refused); `main` not protected.
  - Scope added before building, by the plan author: `tools/e2e-check.mjs`. The S3 test needs the scripts'
    dependencies (`picomatch`), which only `e2e-check` installs; `install-check` runs offline without them.
  - Overrides beyond FR4: `.gitattributes` and `.gitignore` (both the kit's own, present before the install;
    without them drift-check / sync flag them).
  - `AGENTS.md` and `CLAUDE.md` are seeds: `AGENTS.md` got the kit's solo-flow and "edit sources, not copies" rules in
    place of the Planner-Worker lines.
  - The docs leak-check run no longer scans `docs/agent/` (the installed copy of `core/docs/agent`, already scanned by
    the core run; rendered with this repo's default ports it reported 4200). It scans `docs/CHANGE-LOOP.md`,
    `docs/project`, `docs/brain`. CI, `npm run lint` and the README's check list changed together.
  - S6 proof done locally instead of on a test branch: one line appended to `core/docs/agent/standards-git.md` →
    `drift-check --target .` exit 1 (`1 drift`), reverted → `ok`.
