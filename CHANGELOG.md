# Changelog

All notable changes to the kit. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [semver](https://semver.org/): a major release says what a project must do; minor and patch
releases never need action. (Before 1.0.0, a minor bump could change how projects install or sync.)

Releases are git tags `vX.Y.Z` with a GitHub release. Install or upgrade to one with
`--source github:WDD-CODER/ai-workflow-kit --ref vX.Y.Z` (see the README).

## [Unreleased]

## [1.2.0] - 2026-10-19

The core no longer assumes a stack: "core + stack pack + layers". The frontend dev server, CI jobs, style rules,
tech-debt rules and the references core commands make come from the packs and from config, a project without a
backend gets no backend job, and a new **React + Vite** pack, a **Supabase** layer and an **upstream-owned** layer (for
a repo that is a copy of someone else's) join the Angular and Node/Express packs. The installer detects the stack when
none is named. The Planner always runs an Architect + Product Manager review before it saves a plan. New checks
prove an install on fixture projects end to end. Released as a minor version by choice, although several changes need a
step in existing projects (below): read that list before you sync.

### What a project must do

Run `kit-sync -Ref v1.2.0` (dry-run) first; it lists every change. Then:

1. **`commands.*` are npm script names.** Every `commands.*` value in `kit.config.json` must be a script name
   (`"build"`, `"dev"`), not a command (`"npm run build"`, which rendered as `npm run npm run build`). Install and sync
   stop with exit 2 and name the value to use. `commands.lintStaged` stays a full command.
2. **Name the stack for a core-only install.** With no `--packs` and no `stack.packs`, install now detects the packs and
   layers, prints them with the reason for each and installs them only after `--yes`; when nothing matches it stops
   (exit 2) instead of installing the core alone. For the stack-neutral core only, pass `--packs ""` (PowerShell
   `-Packs ''`) or set `"stack": { "packs": [] }`. This applies to `--config <file>` too: a config file without a `stack`
   now exits 2 the same way. Detection never includes the `upstream-owned` layer by itself (every fork clone has an
   `upstream` remote): it prints it as a suggestion, and you add it with `--layers`. Installed projects are not affected:
   sync uses the recorded packs. Install stops (exit 2) when `kit.config.json` `stack.packs` / `stack.layers` and
   `.kit/install.json` disagree — make them match.
3. **PRD and HLD templates.** `kit-sync` shows `.claude/references/prd-template.md` and `hld-template.md` as `conflict`
   whenever the project's copy differs from the kit's (they were seeds and are now kit-managed; sync never overwrites
   them). For each: move the project-only lines into the file named by `paths.planChecks` (default
   `docs/project/plan-checks.md`), then take the kit version (copy the rendered kit file over yours) and re-run sync —
   it reports `same` and records the file as managed. To keep your own copy, add an `overrides` entry instead; drift-check
   now compares both templates byte for byte, so a kept copy needs it.
4. **Workflow script dependencies.** After the sync, run `npm install` inside `scripts/` once in the main folder and
   commit `scripts/package-lock.json` (not `npm install --prefix scripts`: npm 10 then runs the root package's
   lifecycle scripts). The dependency (`picomatch`) lives in the kit-managed `scripts/package.json`; until the lockfile
   exists the scripts still find it in the root `node_modules` when it is there. Slots reinstall it when the lockfile
   changes; CI installs it inside `scripts/` and audits it report-only once the lockfile is committed; a later
   `kit-sync --apply` that changes `scripts/package.json` refreshes the lockfile (commit it with the sync, or run the
   command sync prints when that install fails).
5. **A project that keeps its own `AGENTS.md`** (an `overrides` entry, or `ownership.upstreamPaths`) gets
   `AGENTS.workflow.md` as a `new` file: add the line `@AGENTS.workflow.md` under `@AGENTS.md` in `CLAUDE.md` (a seed,
   so sync does not change it).
6. **Slot frontend dev server.** It comes from `commands.dev` + `slots.fe*`. With the angular pack nothing changes (the
   pack supplies `npm exec -- ng serve -c slot --port <port>` and the env file); the react-vite pack supplies
   `npm run dev -- --port <port> --strictPort`. Any other project whose slot frontend started only because
   `src/environments/environment.local.ts` existed: set `commands.dev` (and, as needed, `slots.feExec`,
   `slots.fePortArgs`, `slots.feMatcher`, `slots.feEnvFile`). A backend-only project whose `kit.config.json` still says
   `commands.dev: "dev"` (older node-express installs copied it): set it to `""`. Install and sync print a `NOTE` while
   `commands.dev` is set and every `slots.fe*` value is the default; the default `--port {port}` is right only for a
   server that fails on a busy port.
7. **Backend.** A project that has a backend must set `paths.serverRoot` (e.g. `"server/"`, which the node-express pack
   sets): with it empty, `ci.yml` and `security.yml` render no server job or step. Install and sync print a `NOTE` when
   `server/package.json` exists and the key is empty.
8. **CI for code the project does not own** (an upstream copy, a stale lockfile, a legacy codebase): set `ci.install`,
   `ci.lintScope: "changed"` (ESLint on the project's own changed files; needs ESLint in the root `node_modules`) and/or
   `ci.appAuditMode: "report"` — or use the `upstream-owned` layer, which sets all three. Install and sync refuse (exit 2)
   any other value of the two modes. An `overrides` entry for `ci.yml` or `security.yml` kept only for this, or only to
   drop the backend job, can go.
9. **React + Vite projects that forked kit files.** Add the stack with `kit-sync --packs react-vite --layers
   supabase[,upstream-owned]` (dry-run, then `--apply` records it in `.kit/install.json` **and** in `kit.config.json`
   `stack.packs` / `stack.layers` — a hand-edited config that still says `packs: []` makes a later install stop; a
   project-owned `AGENTS.md` is a seed, so copy the pack's hard rules and skill triggers in from a scratch install). On
   the `upstream-owned` layer a plan cannot add a dependency: `package.json` is upstream's (the scope guard denies it,
   `ship-prep` flags a shell change to it). Move `.gitignore`, `AGENTS.md`, `package.json` (and
   any other upstream-owned file) from `overrides` to `ownership.upstreamPaths` — the `upstream-owned` layer's default
   already lists `.gitignore`, `AGENTS.md`, `package.json` and `package-lock.json`. Then these overrides can be dropped,
   because the kit now covers what they were forked for (drop the entry, sync, check the rendered file; keep an
   override only for a real project difference): `scripts/slot-serve.mjs`, `scripts/take-plan.mjs`,
   `scripts/lib/slot-procs.mjs`, `.claude/skills/worktree-setup/SKILL.md` (Vite slot server, `scripts/package.json`,
   local excludes); `.husky/pre-commit`, `.husky/pre-push` (shebang, optional lint-staged, closed plans in range
   folders); `.github/workflows/ci.yml`, `security.yml` (no backend job, `ci.*` keys), `brain-capture-reminder.yml`
   (title injection), `todo-sync.yml` (the repo-setting error); `.claude/settings.json`, `scripts/ship-prep.mjs`,
   `scripts/session-startup.sh` (Python fallback, SessionStart JSON); `scripts/techdebt-report.mjs`,
   `.claude/skills/techdebt/SKILL.md` (`scan`, `.tsx`, pack rules); `.claude/commands/feat.md`, `fix.md`, `refactor.md`,
   `security.md`, `docs-refresh.md`, `commands.md` (Angular style rules, breadcrumbs); `.claude/skills/save-plan/SKILL.md`,
   `docs/agent/workflow-map.md` (stale paths, pack skill rows). An override for `.vscode/settings.json` that upstream's
   `.gitignore` ignores is not needed either (`ignored`). A tech-debt baseline written with other rule names: re-run
   `node scripts/techdebt-report.mjs scan --write-baseline`.
10. Optional: record a tech-debt baseline once (`node scripts/techdebt-report.mjs scan --write-baseline`, commit
    `<paths.sharedDocs>/techdebt-baseline.json`) so the `techdebt` skill reports `NEW_DEBT: yes|no` against it.
11. Optional: `AGENTS.md` is a seed, so existing projects do not get the Planner review rule. Paste this bullet under
    `## Hard rules`, after the "Architecture invariants" bullet, with your `paths.planChecks` path:
    ```
    - **Architect + PM review (Planner):** the Planner is the Architect and the Product Manager. Every plan the Planner saves — written here or received from Claude.ai, Cursor or another agent — gets `/plan`'s `## Architect + PM review (always)` before it is saved, plus this project's own checks in `{{paths.planChecks}}` when that file exists. A received plan is reviewed, not silently rewritten.
    ```
12. Optional: a project without the angular pack keeps the `.prettierrc.json` it got as a seed (sync never deletes
    seeds); delete it if its code style differs. The `.gitignore` skeleton (a seed) lists three more runtime paths
    (`.claude/*.log`, `.claude/.last-npm-install-hash-scripts`, `scripts/node_modules/`); `take-plan` already adds the
    whole list to `.git/info/exclude`.

### 002 — Planner always runs the Architect and Product Manager review

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

A project on the angular (and node-express) pack keeps its CI (`server-tests`, the full `npm run <commands.lint>`, the
enforced critical audit) and the same Angular rules, now from the pack; sync shows the changed files as `kit-update`.

#### Added
- Config keys `ci.install` (default `npm ci`), `ci.lintScope` (`all` default | `changed`) and `ci.appAuditMode`
  (`enforce` default | `report`). `changed` lints the changed `*.ts *.tsx *.js *.jsx *.mjs *.cjs` files minus the
  kit-managed ones (`.kit/install.json`): a PR's merge commit against its base side (`HEAD^1`), a push against
  `github.event.before` (a new branch: `HEAD~1`; nothing to compare = pass); a failing `git diff` fails the step.
  `report` runs the app audit with `set +e` and writes the result to `$GITHUB_STEP_SUMMARY` plus a `::warning`.
- `kit-sync --apply` refreshes `scripts/package-lock.json` (`npm install` inside `scripts/`) when it writes
  `scripts/package.json` and the project has that lockfile.
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

### 005 — React-Vite pack, upstream-owned layer and adoption checks

#### Added
- `packs/react-vite/`: React + Vite + TypeScript standards (`standards-react.md`: server state in the query library,
  caller-scoped query keys, one session source, typed data access, realtime cleanup, lazy routes that reload once on a
  missing chunk, Tailwind tokens, right-to-left-safe utilities) and conventions; the `react-component-structure`,
  `cssLayer` and `auth-and-logging` skills; Vite gotchas; the pack contract (`conventionsDoc`, `styleSkill`, `authSkill`,
  `cssSection`, `componentsSection`; no docs-map skill, so `/docs-refresh` takes its fallback); fragments for
  `/refactor`, `/security`, the `techdebt` skill and the `workflow-map.md` skill rows; tech-debt rules `inner-html`,
  `banned-state`, `raw-fetch`; config defaults: `commands.dev: "dev"`, `slots.fePortArgs` with `--strictPort`, the Vite
  process matcher, base port 5173, `paths.routesFile` and the `src/App.tsx` hotspot, no backend.
- Layers beyond Cursor: `layers/<name>/layer.json` takes the optional fields of `pack.json` and applies after the packs;
  `--layers` on install, sync and drift-check, `stack.layers` in the config, `layers` in `.kit/install.json`.
  `layers/supabase/`: Supabase backend standards (`standards-supabase.md`, the `backendDoc` contract key), gotchas,
  sensitive paths, the `ui-table-call` tech-debt rule. `layers/upstream-owned/`: `ownership.upstreamPaths`, CI defaults
  (`ci.install: npm install --no-audit --no-fund`, `ci.lintScope: changed`, `ci.appAuditMode: report`), the `/pull-copy`
  command (rebase on `upstream/main`, never resolve a conflict, the force-push left to the Human), gotchas and a hard
  rule.
- Config key `ownership.upstreamPaths` (globs): matching kit files are never written by install and count as
  `override` in sync and drift-check; a matching `AGENTS.md` sends the rules to `AGENTS.workflow.md`; a matching
  `package.json` gets no devDependencies; in a slot `scope-check` prints `SCOPE: upstream <path>` and the scope guard
  denies it ("upstream-owned, not an `approved:`"), even when the plan lists it; `ship-prep`'s scope check names it.
- Stack detection: `pack.json` / `layer.json` `detect` rules (`deps` in the root or backend `package.json`, a `path`, a
  `gitRemote`). With no `--packs` and no `stack.packs`, install prints `KIT_INSTALL: detected packs=[…] layers=[…]` with a
  reason per entry, writes nothing until `--yes`, then records the stack in `kit.config.json`. node-express is detected
  from the backend folder only (an SSR frontend lists `express` in the root); a `suggestOnly` rule (the `upstream`
  remote → `upstream-owned`) is printed as a suggestion and never installed by `--yes`. Install stops when
  `kit.config.json` `stack.*` and `.kit/install.json` disagree; `adoption-report` flags it.
- `ownership.upstreamPaths` takes `**`, `*`, `?` and a trailing `/` only (the syntax the kit's matcher and the scope
  guard's read alike): install and sync refuse braces, character classes and `!`; `pack-check` checks pack and layer
  defaults.
- `kit-sync --packs / --layers` add a pack or layer to an installed project (`--apply` records them in
  `.kit/install.json` and `kit.config.json`); `kit-install.ps1
  -Layers -Yes`, `kit-sync.ps1 -Packs -Layers`. Every tool flag also takes `--flag=value` (PowerShell 5 drops an empty
  argument, so the wrappers pass `--packs=`).
- `tools/e2e-check.mjs --project <path>`: the e2e cycle on a scratch copy of a real installed project — slots borrow its
  `node_modules` through junctions (removed with `rmdir`, also from exit and signal handlers when the run is
  interrupted; the source checked intact afterwards; never delete its temp folder recursively while a link is there);
  `/pull-copy` and the e2e use the upstream's own default branch (`refs/remotes/upstream/HEAD`); the plan commit runs the
  hooks; claim, guards (hotspot, upstream-owned path), the slot dev server, ship, merge, close-out, a Planner close-out
  push into a range folder, `/pull-copy` (replay, refused force-push, conflict abort) with an upstream, drift-check, the
  maintenance scripts and SessionStart JSON.
- `tools/adoption-report.mjs --target <dir> [--markdown <file>]`: one row per workflow part (install record, managed
  files, stack vs detection, each Claude Code hook and git hook, hooks enabled, scripts dependencies, runtime ignores,
  kit rules loaded, npm scripts, frontend dev server, doc links, CI) with `ok` / `warn` / `fail`.
- `tools/acceptance-check.mjs [--e2e]` and `tools/fixtures/make-fixture.mjs`: Angular + Express, React-Vite + Supabase and
  an upstream-owned React-Vite copy (double quotes and semicolons, no husky, an `upstream` remote). Each: detection, install,
  link check, drift-check with no hand-written override, rendered CI, adoption report, the first commit through the hooks;
  `--e2e` then runs `e2e-check --project` on the two React-Vite fixtures. Kit CI runs it on Linux and Windows.
- install-check: a React-Vite + Supabase fixture, the React tech-debt rules, stack detection (proposal, `--yes`, nothing
  matching, explicit packs win) and the upstream-owned layer; workflow-link-check covers react-vite and both layers.
- `pack-check` checks layers too, plus `detect` rules and `techdebtRules` patterns.

#### Changed
- `install` with no `--packs`, no `stack.packs` and no recorded packs detects the stack and stops until `--yes` (exit 2),
  instead of installing the core alone (what-to-do item 2).
- `workflow-map.md` §4 has a `PACK:workflow-map:skills` marker for the pack's skill rows (no pack section = no line).
- `workflow-map.md` and `README_WORKFLOW.md` name `.cursor/commands/` and `contractor-role.mdc` only with the Cursor
  layer (new builtin `kit.cursor` for `KIT:if`): an install without `--cursor` (e.g. the angular pack alone) had two
  dangling references. Renders with `--cursor` are unchanged.

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

[Unreleased]: https://github.com/WDD-CODER/ai-workflow-kit/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.2.0
[1.0.5]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.0.5
[1.0.4]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.0.4
[1.0.3]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.0.3
[1.0.2]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.0.2
[1.0.1]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.0.1
[1.0.0]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.0.0
[0.5.0]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v0.5.0
