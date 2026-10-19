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

### 003 — Stack-neutral core, part 1: install, slots and runtime files

What a project must do:
1. Every `commands.*` value in `kit.config.json` must be an npm **script name** (`"build"`), not a command
   (`"npm run build"`, which rendered as `npm run npm run build`). Install and sync now stop with exit 2 and name
   the value to use; change it, then re-run. `commands.lintStaged` stays a full command.
2. After the sync, run `npm install` inside `scripts/` once in the main folder and commit
   `scripts/package-lock.json`. The workflow scripts' dependency (`picomatch`) now lives in the kit-managed
   `scripts/package.json`; slots reinstall it when that lockfile changes. Until the lockfile exists, the scripts
   still find `picomatch` in the root `node_modules` when it is there. A CI job that runs the workflow scripts
   from a clean checkout without the root install needs that install too. (Not `npm install --prefix scripts`: npm 10 then runs the root
   package's lifecycle scripts, e.g. a `prepare: husky` that is not installed yet.)
3. A project that keeps its own `AGENTS.md` (an `overrides` entry) gets `AGENTS.workflow.md` as a `new` file:
   add the line `@AGENTS.workflow.md` under `@AGENTS.md` in `CLAUDE.md` (a seed, so sync does not change it).
4. A project without the angular pack whose slot frontend started only because
   `src/environments/environment.local.ts` existed: set `commands.dev` (and, as needed, `slots.feExec`,
   `slots.fePortArgs`, `slots.feMatcher`, `slots.feEnvFile`) in `kit.config.json`. With the angular pack nothing
   changes: it supplies today's command (`npm exec -- ng serve -c slot --port <port>`) and env file.
5. A node-express project without a root frontend whose `kit.config.json` still says `commands.dev: "dev"` (older
   installs copied that pack default into the written config): set `commands.dev` to `""`, or slots would start
   `npm run dev -- --port <port>` as a frontend. Install and sync print a `NOTE` while `commands.dev` is set and every
   `slots.fe*` value is the kit default. A real frontend with the default `slots.fePortArgs` (`--port {port}`) must
   fail on a busy port; add its strict-port flag if it would move to another port.
6. Optional: the `.gitignore` skeleton (a seed) lists three more runtime paths (`.claude/*.log`,
   `.claude/.last-npm-install-hash-scripts`, `scripts/node_modules/`). Copy them into your `.gitignore` if you
   like; `take-plan` already adds the whole list to `.git/info/exclude`.

#### Added
- `scripts/local-excludes.mjs`: the single list of runtime files (slot markers, logs, install hashes, session
  state). It appends the list idempotently to `$(git rev-parse --git-common-dir)/info/exclude` (`--check` exits 1
  when an entry is missing). The `.gitignore` skeleton is rendered from it; install, `take-plan` (before its
  dirty check) and the worktree-setup skill run it, so a fresh clone whose `.gitignore` the project owns is no
  longer refused with "uncommitted or untracked changes".
- `scripts/package.json` (kit-managed, `picomatch` ^4.0.7; its `type` mirrors the root `package.json`, so the
  project's own `scripts/*.js` keep their module type). `install --install-deps` runs
  `npm install` inside `scripts/`; `take-plan` and `slot-serve` install it when `scripts/package-lock.json`
  changes (hash in `.claude/.last-npm-install-hash-scripts`); the root devDependency note no longer lists it.
- `AGENTS.workflow.md`: when the project owns `AGENTS.md` (in `overrides`, or present and not installed by the
  kit), the kit's `AGENTS.md` skeleton is rendered there as a managed file with a header saying who owns what,
  and the `CLAUDE.md` skeleton imports both.
- Config keys `slots.feExec`, `slots.fePortArgs` (default `["--port", "{port}"]`), `slots.feMatcher`,
  `slots.feEnvFile`; the angular pack fills them with its current values. Placeholder filter `|json`.
- `kit-sync`, `kit-drift` and install skip a missing kit file the project's git ignores: state `ignored`
  (sync, drift-check) and `SKIP-IGNORED` (install), instead of `new` / `missing`.
- e2e: a refused claim commit, a fresh clone with its own `.gitignore`, the config-driven frontend dev server
  (started, kept, stopped), the scripts' own install, and `.kit/install.json` in scope. install-check: full
  commands refused, `AGENTS.workflow.md` (pre-existing and overridden `AGENTS.md`), ignored paths, sensitive
  paths and frontend values from config, an i18n folder hotspot, the browser line, the `.gitignore` runtime list.

#### Changed
- The slot frontend dev server comes from config: `commands.dev` names the npm script (no such script in
  `package.json` = no frontend) and `slot-serve` runs `npm run <dev> -- <fePortArgs>`, or
  `npm exec -- <feExec> <fePortArgs>`; `slots.feMatcher` recognises its processes (default `run <dev>`) and
  `slots.feEnvFile` is the optional env file whose `.slot` copy gets the slot's backend port. The port
  arguments must make the server fail on a taken port, never move to another one. It was Angular-only
  (`environment.local.ts` + `ng serve`).
- The node-express pack no longer sets `commands.dev` (`"dev"`): core now reads it as the frontend script, and
  nothing read it before.
- `ship-prep` reads `security.sensitivePaths`: a regex string replaces the built-in sensitive-path regex (the
  default when unset), a list of globs adds to it.
- `project.i18nFile` may be a glob or a folder (`src/locales/` → `src/locales/**`) as well as a file or a
  comma-separated list; every entry is an append-only hotspot.
- `tools.browser` left at its default no longer renders "Browser tool: browser tool." in the `AGENTS.md`
  skeleton; the line keeps only the browser-check guidance.
- Dropped the unused config key `commands.npm`.

#### Fixed
- `take-plan` no longer half-claims a slot when the claim commit fails (e.g. a pre-commit hook): it restores
  the plan file, returns the slot to its detached commit, deletes the new branch and prints
  `TAKE_PLAN: claim commit failed: …`. It checks the result and names any step that did not undo, and a merged
  PR's old remote branch is deleted only after the claim commit succeeded.
- `scope-check` always allows `.kit/install.json` (kit-sync re-records it), so it is never `scope: out`.

### 004 — Stack-neutral core, part 2: CI, commands, tech debt and rules by pack

What a project must do:
1. Nothing, for a project on the angular (and node-express) pack: its CI keeps the `server-tests` job, the full
   `npm run <commands.lint>` and the enforced critical audit, and its commands keep the same Angular rules (they now
   come from the pack). Sync shows the changed managed files as `kit-update`.
2. A project whose CI can't be green for code or dependencies it does not own (an upstream copy, a stale lockfile, a
   legacy codebase): set `ci.install` (e.g. `"npm install --no-audit --no-fund"`), `ci.lintScope: "changed"` (ESLint on
   the changed files only; needs ESLint in the root `node_modules`) and/or `ci.appAuditMode: "report"` in
   `kit.config.json`, then sync. An `overrides` entry for `.github/workflows/ci.yml` or `security.yml` kept only for
   that, or only to drop the backend job, can go: sync, check the rendered file, remove the override.
3. A project with no backend leaves `paths.serverRoot` empty: `ci.yml` and `security.yml` then render no server job
   or step (no more `npm ci --prefix ` with nothing after it, no `working-directory: server`).
4. `security.yml` now also audits the workflow scripts' dependencies (`scripts/package.json`) at `critical` when
   `scripts/package-lock.json` is committed (003, item 2), and `ci.yml` installs them inside `scripts/` before
   `npm run test:scripts`.
5. Optional: record a tech-debt baseline once — `node scripts/techdebt-report.mjs scan --write-baseline`, commit
   `<paths.sharedDocs>/techdebt-baseline.json` — so the `techdebt` skill reports `NEW_DEBT: yes|no` against it
   instead of the whole legacy count. A project that overrides `.claude/skills/techdebt/SKILL.md` can add the `scan`
   step to its copy.
6. A project without the angular pack keeps the `.prettierrc.json` it got as a seed (sync never deletes seeds);
   delete it if its code style differs. New installs get it only with the angular pack, and not when the project
   already has a prettier config.

#### Added
- Config keys `ci.install` (default `npm ci`), `ci.lintScope` (`all` default | `changed`) and `ci.appAuditMode`
  (`enforce` default | `report`). `changed` lints the changed `*.ts *.tsx *.js *.jsx *.mjs *.cjs` files: a PR against
  its base, a push against `github.event.before` (a new branch: `HEAD~1`; nothing to compare = pass). `report` runs
  the app audit with `set +e` and writes the result to `$GITHUB_STEP_SUMMARY` plus a `::warning`; the `scripts/`
  audit stays enforced.
- Conditional blocks in kit files: `KIT:if <key>` / `KIT:else` / `KIT:end` (as `# …` or `<!-- … -->` lines; `key`,
  `!key`, `key=value`, `key!=value`). The backend job and steps in `ci.yml` and `security.yml` render only with
  `paths.serverRoot`.
- Pack fragments: a pack's `fragments` file (`FRAGMENTS.md`, not installed) fills `PACK:<name>` marker lines in core
  files. The angular pack supplies the style rules of `/feat`, `/fix`, `/refactor`, `/security`, their styling and
  auth skill lines, its pre-commit hooks (`pre-commit-no-semi` before the secret scan, `pre-commit-security-grep`
  after it, as before) and its tech-debt greps.
- The pack contract: `pack.json` `provides` names what a pack supplies for core references — `conventionsDoc`,
  `backendDoc`, `styleSkill`, `authSkill`, `docsMapSkill`, `docsMapCheck`, `cssSection`, `componentsSection` — as the
  config keys `stack.<key>` (a project may set its own). Core uses each only inside `KIT:if stack.<key>` with a
  fallback, so a project with no pack gets no dangling path. `pack-check` fails on an unguarded contract key, a key
  no pack provides, a provided file, skill or section that does not exist, a fragment that fills no marker, and a
  core file that names a file or skill only a pack ships.
- `tools/workflow-link-check.mjs`: every backticked path, `node scripts/…` and `npm run <script>` in the installed
  commands, skills, agents, `docs/agent`, Cursor rules and `AGENTS.md`/`CLAUDE.md` must exist (runtime files and
  examples skipped). Without arguments it checks installs with packs `[]`, angular, node-express and both;
  `--target <dir>` checks a project. install-check runs it on each of its fixtures; kit CI runs both.
- `techdebt-report.mjs scan`: counts `any`, `@ts-ignore`, `eslint-disable`, `console.log`, TODO/FIXME and files over
  300 lines in the project's own `.ts .tsx .js .jsx .mjs .cjs .html .css .scss` files (tracked files under
  `paths.srcRoot`, kit-managed files left out, tests left out for `any` and `console.log`), plus the pack's
  `techdebtRules` (angular: legacy `@Input`/`@Output`, `BehaviorSubject`, trailing semicolons), and compares with
  `<paths.sharedDocs>/techdebt-baseline.json`: `NEW_DEBT: yes|no` (`unknown` without a baseline). `--write-baseline`,
  `--strict` (exit 1 on new debt), `--list`. The `techdebt` skill runs it; its `PACK:techdebt` marker is filled by
  the pack.
- Pack seeds: `pack.json` `seeds` marks pack files that are written once, optionally with `skipWhenPresent` (install
  `SKIP-PRESENT`, a sync `NOTE`).
- install-check: CI renders with and without `paths.serverRoot` and with every `ci.*` mode (actionlint on every
  rendered workflow when it is installed; kit CI installs a pinned, checksum-verified actionlint and requires it),
  the link check per fixture, no `KIT:`/`PACK:` directive left in a render, style rules and the prettier seed only
  with the angular pack, the pre-commit hook order, a prettier seed skipped next to `prettier.config.js`, and the
  tech-debt scan (core and angular rules, baseline, `--strict`).
- `standards-git.md` and `/ship`: pass `-R <owner>/<repo>` (from `git remote get-url origin`) on every `gh` call —
  in a fork `gh` targets the parent repo — and edit a PR with `gh api -X PATCH repos/<owner>/<repo>/pulls/<n>
  -F body=@<file>` when `gh pr edit` fails on the Projects (classic) deprecation.

#### Changed
- Core commands carry no stack style rules: `/feat`, `/fix`, `/refactor` and `/security` say "Match the file's
  existing style; never reformat untouched lines" and take the rest from the pack. `/review`, `/fix`,
  `/docs-refresh`, `/security`, the techdebt skill and `pr-check-fix-loop.md` reach the conventions doc, backend
  standards, styling, auth and docs-map skills through the pack contract; `/fix` "Loads by area" names the pack's
  real standards-doc sections.
- `.prettierrc.json` moved from `templates/` to the angular pack (a seed).
- `ci.yml`: `server-tests` runs inside `paths.serverRoot` (`working-directory`) instead of `npm --prefix`; the gate's
  `needs` is a block list; the docs-only path filter drops three patterns `*.md` already covered (shellcheck SC2221).

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
