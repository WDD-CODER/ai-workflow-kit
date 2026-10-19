# Changelog

All notable changes to the kit. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [semver](https://semver.org/): a major release says what a project must do; minor and patch
releases never need action. (Before 1.0.0, a minor bump could change how projects install or sync.)

Releases are git tags `vX.Y.Z` with a GitHub release. Install or upgrade to one with
`--source github:WDD-CODER/ai-workflow-kit --ref vX.Y.Z` (see the README).

## [Unreleased]

### 002 — Planner always runs the Architect and Product Manager review

What a project must do:
1. `kit-sync` shows `.claude/references/prd-template.md` and `hld-template.md` as `conflict` whenever the
   project's copy differs from the kit's (they were seeds and are now kit-managed; sync never overwrites them).
   For each: move the project-only lines from your copy into the file named by `paths.planChecks` (default
   `docs/project/plan-checks.md`; set the key in `kit.config.json` to use another path), then take the kit
   version (copy the rendered kit file over yours) and re-run sync — it reports `same` and records the file as
   managed. To keep your own copy instead, add an `overrides` entry (`{ "path": ".claude/references/prd-template.md",
   "reason": "…" }`).
2. `kit-drift` now compares both templates byte for byte, like every other core file. A kept copy needs the
   `overrides` entry above, or drift-check exits 1.
3. Optional: `AGENTS.md` is a seed, so existing projects do not get the new rule. Paste this bullet under
   `## Hard rules`, after the "Architecture invariants" bullet:
   ```
   - **Architect + PM review (Planner):** the Planner is the Architect and the Product Manager. Every plan the Planner saves — written here or received from Claude.ai, Cursor or another agent — gets `/plan`'s `## Architect + PM review (always)` before it is saved, plus this project's own checks in `{{paths.planChecks}}` when that file exists. A received plan is reviewed, not silently rewritten.
   ```
   Replace `{{paths.planChecks}}` with your path.

#### Added
- `/plan` has a `## Architect + PM review (always)` section. It runs on every plan the Planner saves — plans
  it writes and briefs or Plan Contracts it receives — and checks it against the fetched main branch:
  Architecture Impact filled, every named file and symbol exists or is marked new, the standards doc and
  existing patterns followed, scope exact; testable success criteria with tagged Done-when items, Out of Scope,
  backend / auth / security / data impact named, smallest full-value version, every step concrete enough to run
  without asking. It prints one `ARCHITECT + PM REVIEW` block (`no gaps` or one line per gap with a fix); a
  received plan is reviewed, not rewritten, and a gap the Human rejects is noted in the plan's Execution Notes.
  The Planner protocol runs it as step 0 (after `git fetch`), and `brief-detection` routes a Plan Contract
  pasted on main through it.
- `kit-sync`: a file recorded as a seed that the kit now ships as managed is a `conflict` unless it already
  matches the kit (then `same`, recorded as managed). Its recorded hash is the project's own copy (`--adopt`
  records whatever is there), so "unchanged since install" no longer lets sync overwrite it.
- `install-check`: a promoted-seed case (customised copy → `conflict`, `--apply` leaves it), a fourth fixture
  (angular + node-express + Cursor), and an assertion in every fixture that each path `/plan` and the
  `workflow-map.md` `/plan` row load exists.
- `.claude/references/prd-template.md` and `hld-template.md` are kit-managed core files (they were seeds), so
  every project gets the files `/plan` loads, sync keeps them current and `kit-drift` compares them. The PRD template names backend,
  auth, security, data and project-check lines; the HLD template's "Alternatives Considered" table is replaced
  by `### Why this design`.
- Config key `paths.planChecks` (default `docs/project/plan-checks.md`): the project's own planning checklist,
  which the review adds when the file exists. Documented in `kit.config.json`, the README and the `AGENTS.md`
  skeleton.

#### Changed
- Roles: the Planner (Claude Code in the main folder) is the Architect and the Product Manager; Claude.ai or
  another tool may draft. `/plan` no longer says "Claude.ai by default"; `workflow-map.md` §1 and flow F1,
  `README_WORKFLOW.md` (title, roles, cost routing, authoritative files), `/feat`, `save-plan` and `/review-it`
  wording follow.
- `/plan`, `/feat`, `workflow-map.md` and `README_WORKFLOW.md` point at `{{paths.sharedDocs}}/tech-stack.md` and
  `current-state.md` instead of a `/_shared/` folder that is not installed, and `README_WORKFLOW.md` names
  `docs/agent/` instead of a `.claude/rules/` folder that does not exist.

## [1.0.5] - 2026-10-18

Fixes found installing the kit into a React + Vite project. Sync to pick them up (`kit-sync -Ref v1.0.5 -Apply`);
nothing else to do.

### Fixed
- Git hooks: `.husky/pre-commit` had no shebang, so git without the husky wrapper (`core.hooksPath=.husky`)
  could not run it on Windows and every commit failed. Both hooks now start with `#!/usr/bin/env sh` and
  `set -e`, lint-staged runs only when it is installed, and install and sync write the hooks as executable
  (chmod 755 and `git add --chmod=+x`). The install note names both ways to enable the hooks.
- SessionStart: the context sat under `decision`, where Claude Code ignores it, so the slot role and the
  resumed session state never reached the session; and quotes or newlines in the session-state file broke
  the JSON. The output is now built in node, with `additionalContext` directly under `hookSpecificOutput`.
- CI: the `gitleaks` job asks for `contents: read` and `pull-requests: read` and posts no comments
  (`GITLEAKS_ENABLE_COMMENTS: false`), so it runs with a read-only default token.
- Python: the session-manifest hook runs through `scripts/run-python.sh` (first of `python3`, `python`, `py`
  that works, else a quiet no-op), and `ship-prep` tries the same three and prints a warning instead of
  silently falling back to the full dirty-file list.
- pre-push: a push to main that only moves closed plans into a range folder (`plans/300-400/…`) is allowed.
- todo-sync: when GitHub refuses to let Actions open the PR, the run deletes its `chore/todo-sync-*` branch
  and prints an error naming the repo setting. Install output and the README's first-time setup list it.
- Stale references: `save-plan` named a pre-commit script that only one pack ships, `workflow-map.md` named
  `.claude/todo-archive.md` (it is the folder `.claude/todo-archive/`, written by todo-sync), example plan
  names came from a real project, `/docs-refresh` used Cursor's subagent type (`general-purpose` in Claude
  Code), and `/security` had a garbled step and leftover "three-agent" wording.

### Added
- `tools/e2e-check.mjs` cases: a project without husky runs the hooks (first commit passes, a staged fake key
  is refused); SessionStart prints valid JSON on each branch; pre-push accepts a range-folder plan and still
  refuses code.

## [1.0.4] - 2026-10-18

Security fixes from an automated review. Sync to pick them up (`kit-sync -Ref v1.0.4 -Apply`); nothing else to do.

### Security
- `brain-capture-reminder.yml`: the PR title was pasted into the job's shell script and written to
  `$GITHUB_ENV` under a fixed `EOF` delimiter, so a crafted title could run commands or set variables. PR fields
  now reach the script only through `env:`, the PR number is checked to be numeric, and every multi-line value
  uses a random delimiter.
- `.claude/settings.json`: `Bash(*)` stays allowed, but `permissions.deny` now refuses git-hook bypasses
  (`--no-verify`, `commit -n`, `core.hooksPath`) and force pushes, and `permissions.ask` asks before
  `git reset --hard`, `git clean` and `rm -rf` on absolute, home or `.git` paths. These were human-only by rule;
  now Claude Code enforces it.

## [1.0.3] - 2026-10-18

Kit tooling only; no installed file changes, nothing for a project to do.

### Added
- `tools/e2e-check.mjs`: installs the kit into a fresh project and runs one plan through the whole cycle
  (Planner save, branch and push guards, slot claim, scope guard, ship-prep, push, merge, ledger close-out,
  slot release, drift and sync). A local bare repository stands in for GitHub. CI runs it on Linux and
  Windows for every push and PR, so a release cannot ship a broken cycle.

## [1.0.2] - 2026-10-18

Fixes found by running a fresh project (installed from GitHub) through plan, take-plan and ship. Nothing for a project to do.

### Fixed
- Scope guard: in a project with no i18n file or hotspots, the hotspot list rendered `''`, picomatch threw, and
  the guard failed open (every write allowed, `/ship` reported `scope: out`). Empty entries are dropped.
- `todo-query append` starts `.claude/todo.md` when it does not exist yet, so the first save-plan works.
- `pre-push`: the first push to an empty remote no longer prints a git error.
- Slot `npm install` no longer triggers the DEP0190 warning on Windows.
- `/plan` command text no longer shows `(retired)` placeholders.

## [1.0.1] - 2026-10-18

Installer fix; no managed file changes, nothing for a project to do.

### Fixed
- `kit-install` listed the Node built-in `net` as a devDependency (and `--install-deps` installed the
  unrelated npm package `net`). Built-ins now come from `module.builtinModules`.
- `--install-deps` no longer triggers Node's DEP0190 warning on Windows.

## [1.0.0] - 2026-10-18

First stable release: the source project runs on kit-sync.

### Added
- `kit-install --adopt` (`-Adopt`): brings a project that already carries the workflow under kit-sync. It
  writes only `.kit/install.json` and refuses while the drift check finds an undeclared difference.
  `--no-cursor` (`-NoCursor`) on install.
- `docs/CHANGE-LOOP.md`: how a kit change reaches projects (kit PR → release → `kit-sync -Ref`), semver
  rules for releases, and what to do with a fix found inside a project.

### Changed
- The scope guard's note for a kit-owned file in a plan's scope now says to make the same change in the kit
  and release it, so the next kit-sync sees a matching file.
- Versioning: from `1.0.0`, minor and patch releases never ask a project to act.

### Fixed
- `drift-check` no longer reports an overridden seed as "not a managed kit file".

## [0.5.0] - 2026-10-18

First tagged release.

### Added
- Install, sync and drift-check from a tagged GitHub release: `--source github:<owner>/<repo> --ref <tag>`
  (`-Source` / `-Ref` on the `.ps1` wrappers). The tag is fetched shallow into a per-user cache
  (`~/.cache/ai-workflow-kit/<owner>/<repo>/<tag>/`, or `$AI_WORKFLOW_KIT_CACHE`) and reused while the tag
  still points to the same commit. A tag that moved after it was cached is refused.
- `.kit/install.json` records `source`, `ref` and `commit`. Sync and drift-check use them when no
  `--source` is given; `sync --ref <tag> --apply` upgrades and records the new release. A ref that does not
  exist fails with `ref <tag> not found` before anything is written.
- `--source <kit folder>` for kit development; a plain run records `local:<path>`.
- `leak-check` accepts files as `--root`, and `KIT_LEAK_TERMS` adds private terms from the caller's
  environment. CI also checks `README.md` and `CHANGELOG.md`.
- This changelog, a rewritten README and the release steps.

### Changed
- Workflow files name "the Human" instead of a person.

### Fixed
- `take-plan.mjs` imports `mkdirSync`; a resumed claim no longer crashes.
- `/take-plan` prints only the plan brief at claim time; validation cards stay at close-out (`/done`, `/ship`).

## [0.4.0] - 2026-10-17

Phases 4 to 6A, never tagged. Projects installed from a local kit folder.

### Added
- Installer (`tools/install.mjs`), sync (`tools/sync.mjs`) and the 17 template skeletons; `.ps1` wrappers.
- Drift check (`tools/drift-check.mjs`, `kit-drift.ps1`): byte-for-byte comparison of every managed file.
- Project overrides in `kit.config.json`: install skips them, sync reports `override`, never `conflict`.
- Brain lessons install as seeds (written once, never updated).
- Ownership guard, architecture-invariants gate, plain-language validation cards, open plan folders
  (`plans.openDirs`), automatic plan close-out on merge, skills v2 (14 → 10 skills with scripts and evals).
- Slot dev servers on demand, orphan sweep, per-run slot server logs, plain explanatory titles on Atomic Sub-tasks.

### Fixed
- Squash-merge detection, stale session pointers, todo-sync counting, LF line endings for byte-exact
  comparisons on Windows, and placeholders that rendered wrong in a real project.

## [0.3.0] - 2026-10-02

### Added
- Stack packs (`packs/angular`, `packs/node-express`) with the `pack.json` contract, the optional Cursor
  layer, and the generalized brain lessons.

## [0.2.0] - 2026-10-01

Phases 1 and 2, before this repository existed: the workflow was extracted from its source project into a
stack-neutral `core/` with `{{placeholder}}` config keys and a leak check.

[Unreleased]: https://github.com/WDD-CODER/ai-workflow-kit/compare/v1.0.5...HEAD
[1.0.5]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.0.5
[1.0.4]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.0.4
[1.0.3]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.0.3
[1.0.2]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.0.2
[1.0.1]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.0.1
[1.0.0]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.0.0
[0.5.0]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v0.5.0
