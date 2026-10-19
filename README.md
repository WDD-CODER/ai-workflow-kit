# ai-workflow-kit

A Planner-Worker AI workflow for Claude Code (optional Cursor layer), copied into a project and kept in
sync from tagged releases: plans with a read-write scope, parallel worker slots, scope guards, a `/ship`
pipeline with a merge gate, validation cards, and a brain of lessons.

**Status:** `v2` — projects run on kit-sync; stack packs for Angular, Node/Express and React + Vite. Releases follow semver: a minor or patch release never
asks a project to act; a major one says what to do in [CHANGELOG.md](CHANGELOG.md).

**License:** none. Copyright © the author, all rights reserved. The repository is private; installing from
`github:` needs git credentials that can read it (the same ones `git clone` uses). No permission to copy,
modify or redistribute is granted.

## Requirements

Node 18+ and the git CLI. Windows, macOS and Linux. The `.ps1` files are thin PowerShell wrappers; the
engine is `node tools/*.mjs`, so every flag below also works as `--target --source --ref …` on any OS.

## Install into a project

Clone the kit once (any folder), then install a tagged release into your project:

```powershell
git clone https://github.com/WDD-CODER/ai-workflow-kit.git
cd ai-workflow-kit
.\kit-install.ps1 -Target ..\my-app -Source github:WDD-CODER/ai-workflow-kit -Ref v1.3.0 -Packs angular -Cursor
```

Not sure which packs fit? Leave `-Packs` out: the installer detects the stack (see [Packs and layers](#packs-and-layers)),
prints what it found and why, and installs it only after `-Yes`.

- `-Source github:<owner>/<repo> -Ref <tag>` fetches exactly that release (a shallow `git fetch` of the tag)
  into a per-user cache, `~/.cache/ai-workflow-kit/<owner>/<repo>/<tag>/` (override with
  `$env:AI_WORKFLOW_KIT_CACHE`), and installs from it. The cache is reused while the tag still points to
  the same commit; a tag that moved is refused. Offline, a cached release is used with a note.
- Without `-Source`, the kit you run the script from is installed (kit development). `-Source <folder>`
  installs from another kit checkout.
- `-Packs angular,node-express` picks stack packs (`-Packs ''` = the stack-neutral core only), `-Layers
  supabase,upstream-owned` adds layers, `-Cursor` adds the Cursor layer, `-YesChef` the "Yes chef!" gate, `-DryRun`
  previews, `-Force` overwrites existing files (never overrides). With no `-Packs` and no `stack.packs` in the config,
  the stack is detected and `-Yes` confirms it.
- `<project>/.kit/install.json` records what was installed: kit version, `source`, `ref`, `commit`, packs, layers
  and each file's hash. **Commit it** — sync and drift-check read it.
- Config: `-Config <file>`, else `<project>/kit.config.json`, else the kit defaults plus each pack's
  `configDefaults`. The installer writes the effective config to `<project>/kit.config.json` when absent.
  Required keys (`project.name`, `commands.build|lint|test`, `hooks.shellPath`) missing → exit 2, nothing
  written. Other empty keys render `(not set)` and are listed.
- `commands.*` are npm **script names** (`"build"`), never commands: a value like `"npm run build"` makes
  install and sync stop with exit 2 and name the script to use (`commands.lintStaged` is the one full command).
- A kit file the project's `.gitignore` ignores is not written (`SKIP-IGNORED`): it would never reach a clone.
- A project that keeps its own `AGENTS.md` (listed in `overrides`, or present before install) gets the kit's
  rules in `AGENTS.workflow.md` (managed, synced) instead; the `CLAUDE.md` skeleton imports both. A
  `CLAUDE.md` that already exists needs the line `@AGENTS.workflow.md` (install prints a `NOTE`).

### First-time setup in the project

- **Git hooks.** The `.husky/*` hooks are plain `sh` scripts with a shebang, so they run with husky
  (`"prepare": "husky"`, then `npm run prepare`) or without it (`git config core.hooksPath .husky`). The
  installer stages them as executable (`git add --chmod=+x`); lint-staged runs only when it is installed.
- **Workflow script dependencies.** The scripts' own npm dependencies (`picomatch`) are in the kit-managed
  `scripts/package.json`, so the project's `package.json` needs none of them: run `npm install` inside `scripts/`
  (or install with `-InstallDeps`) and commit `scripts/package-lock.json`. Slots reinstall them when that
  lockfile changes (`take-plan`, `slot-serve`).
- **Runtime files.** Slot markers, logs and install hashes are listed once, in `scripts/local-excludes.mjs`;
  the `.gitignore` skeleton is rendered from it, and install, `take-plan` and the worktree-setup skill add it to
  `.git/info/exclude`, so a fresh clone stays clean even when the project keeps its own `.gitignore`.
- **Frontend dev server in slots.** `slot-serve` starts `npm run <commands.dev> -- <slots.fePortArgs>` (or
  `npm exec -- <slots.feExec> <slots.fePortArgs>`), `{port}` = the slot's frontend port; a stack pack supplies
  the values. The arguments must make the server fail when its port is taken (e.g. a strict-port flag), never
  move to another port. The kit default `["--port", "{port}"]` is only right for a server that already fails on a busy
  port; add the strict-port flag otherwise (install and sync print a `NOTE` while `commands.dev` is set and every
  `slots.fe*` value is the default). No `commands.dev` script in `package.json` = no frontend.
- **todo-sync needs one repo setting.** Settings → Actions → General → Workflow permissions → tick
  "Allow GitHub Actions to create and approve pull requests". Without it every merge's todo-sync run fails
  at `gh pr create`; the run deletes its `chore/todo-sync-*` branch and prints an error naming the setting.
- **CI for code the project does not own.** `ci.lintScope: "changed"` lints only the changed
  `*.ts *.tsx *.js *.jsx *.mjs *.cjs` files (PR base; a push: the commit before it), `ci.appAuditMode: "report"` writes
  the app's `npm audit` to the job summary and a warning instead of failing, and `ci.install` replaces `npm ci`
  (e.g. `npm install --no-audit --no-fund` for a lockfile the project can't fix). `ci.testMode` shapes the unit-test job:
  `run` (default) runs `npm run <commands.test>`, `if-present` runs it with `--if-present` (no such script = pass),
  `skip` renders no test job (e.g. a copy whose `package.json` is upstream's and has no tests). The workflow scripts' own
  dependencies (kit-managed) are audited report-only, and `kit-sync --apply` refreshes `scripts/package-lock.json` when it
  updates them. Kit-managed files are never linted by the changed-files lint. No backend
  (`paths.serverRoot` empty) = no `server-tests` job and no server step; install and sync print a `NOTE` when
  `server/package.json` exists while the key is empty.
- **CI secret scan.** The `gitleaks` job in `ci.yml` asks for `contents: read` and `pull-requests: read`
  and posts no PR comments (`GITLEAKS_ENABLE_COMMENTS: false`), so it works with the default read-only
  token. A repository owned by an organization (not a personal account) also needs a `GITLEAKS_LICENSE`
  secret (see the gitleaks-action docs).

## Packs and layers

A project gets the stack-neutral core plus what fits its stack, and nothing else: only the chosen packs and layers
are copied.

| | name | what it adds |
| --- | --- | --- |
| pack | `angular` | Angular standards and conventions, component / styling / auth / folder-map skills, Cursor rules, the no-semicolon pre-commit check, tech-debt rules, the `ng serve -c slot` slot server |
| pack | `node-express` | Backend standards for a Node / Express / MongoDB server in `server/`, the server CI job |
| pack | `react-vite` | React + Vite + TypeScript standards and conventions, `react-component-structure`, `cssLayer` (Tailwind tokens, `cn()`, logical RTL-safe classes) and `auth-and-logging` skills, Vite gotchas, tech-debt rules (`inner-html`, `banned-state`, `raw-fetch`), the Vite slot server (`npm run dev -- --port N --strictPort`) |
| layer | `supabase` | Supabase backend standards (row-level security first, SECURITY DEFINER vs invoker RPCs, edge-function auth), gotchas, sensitive paths, the `ui-table-call` tech-debt rule. A layer, so a React project without Supabase does not get it |
| layer | `upstream-owned` | For a repo that is a copy of someone else's (an AI app builder's app, a client repo): `ownership.upstreamPaths`, CI defaults for code that is not ours (`ci.lintScope: changed`, `ci.appAuditMode: report`, `ci.install: npm install --no-audit --no-fund`) and the `/pull-copy` command |
| layer | `cursor` | Cursor commands and rules (`-Cursor`) |

**Detection.** With no `-Packs` and no `stack.packs`, `install` reads the project: `@angular/core` → `angular`;
`vite` + `react` → `react-vite`; `express` in the backend's `package.json` (`server/` or `paths.serverRoot`, not the
root, where an SSR frontend may list it) → `node-express`; a `supabase/` folder or `@supabase/supabase-js` →
`supabase`. It prints `KIT_INSTALL: detected packs=[…] layers=[…]` with the reason for each and writes nothing (exit 2)
until `-Yes`; then it installs them and records `stack.packs` / `stack.layers` in `kit.config.json`. An `upstream` git
remote only **suggests** `upstream-owned` (every fork clone has one): it is printed, never installed by `-Yes`; add it
with `-Layers`. Nothing matches → exit 2 (name the packs, or `-Packs ''`). An explicit `-Packs` or `stack.packs` always
wins; install stops when `stack.packs` / `stack.layers` and `.kit/install.json` disagree. Each rule lives in its
`pack.json` / `layer.json` (`detect`, optionally `suggestOnly`), so a new pack brings its own.

**Upstream-owned files.** `ownership.upstreamPaths` (globs; the layer's default is `.gitignore`, `AGENTS.md`,
`package.json`, `package-lock.json`, a project list replaces it) are files another repo owns. Install never writes
them, sync and drift-check report them as `override` (no hand-written override needed), an upstream-owned
`AGENTS.md` sends the kit's rules to `AGENTS.workflow.md`, an upstream-owned `package.json` gets no devDependencies
(the hooks run through `core.hooksPath`), and in a slot the scope guard denies them — "upstream-owned, not an
`approved:`", even when a plan lists them. `/pull-copy` rebases `main` on `upstream/main`, refuses to resolve a
conflict, and leaves the force-push to the Human.

Adding a pack or layer to an installed project: `kit-sync -Packs react-vite -Layers supabase` (dry-run), then
`-Apply` records the new lists in `.kit/install.json` and `kit.config.json`.

## Sync (see what a newer kit changes)

```powershell
.\kit-sync.ps1  -Target ..\my-app                 # dry-run from the recorded source + ref, writes nothing
.\kit-sync.ps1  -Target ..\my-app -Apply          # write only new + kit-update files
.\kit-sync.ps1  -Target ..\my-app -Apply -Prune   # also delete the files the kit stopped shipping (unchanged ones)
```

States: `new`, `kit-update` (written on `-Apply`), `local-only`, `conflict` (never overwritten — resolve by
hand), `removed-from-kit`, `deleted-locally`, `override`, `ignored` (missing, and the project's git ignores
it: never written), `pruned`, `released`. Drift-check reports an ignored file as `ignored`, not `missing`.

Files the kit stopped shipping (`removed-from-kit`) stay on disk. A record whose file is already gone is dropped on
every `-Apply` (`pruned`). `-Prune` (with `-Apply`) cleans up the rest: a managed file unchanged since install is
deleted (a CRLF checkout of it counts as unchanged); an edited one or a seed stays and only its record is dropped
(`released`: the project's own file from then on). Never touched: overrides, upstream-owned paths, a record outside
the project, and a record that differs from a shipped path only in letter case (its record is dropped, the file
stays). Without `-Prune` nothing is deleted. A dry-run prints what `-Prune`
would do.

## Upgrade to another release

```powershell
.\kit-sync.ps1  -Target ..\my-app -Ref v1.3.0          # what would v1.3.0 change? writes nothing
.\kit-sync.ps1  -Target ..\my-app -Ref v1.3.0 -Apply   # apply it and record ref v1.3.0 in install.json
```

Read the release's CHANGELOG entry first. A ref that does not exist fails with `ref <tag> not found` and
writes nothing. To move a local-folder install to GitHub, pass `-Source github:<owner>/<repo> -Ref <tag>`
once.

How a change travels from the kit into projects (kit PR → release → `kit-sync -Ref`), and what to do with a
fix found inside a project: [docs/CHANGE-LOOP.md](docs/CHANGE-LOOP.md).

## Adopt a project that already has the workflow

A project that carries the workflow files but has no `.kit/install.json` (copied by hand, or installed before
the file existed):

```powershell
.\kit-install.ps1 -Target ..\my-app -Adopt -Source github:WDD-CODER/ai-workflow-kit -Ref v1.3.0
```

`-Adopt` writes only `.kit/install.json`: the hash of every managed file and every present seed, the declared
overrides, and the source, ref and commit. It needs `kit.config.json` and refuses (nothing written) while the
drift check finds any difference outside the overrides, or when `.kit/install.json` already exists. Cursor
layer: `-Cursor` / `-NoCursor`, else "a `.cursor/` folder exists". Run `kit-sync` right after: it should
report 0 conflicts.

## Drift check

```powershell
.\kit-drift.ps1 -Target ..\my-app                 # do the project's files match the kit, minus overrides?
```

Read-only. Renders every managed file with the project's `kit.config.json` from the recorded release (or
`-Source`/`-Ref`) and compares byte for byte: `KIT_DRIFT: ok — 0 undeclared differences, N overrides`.
Works before install too.

## Overrides

A managed file the project deliberately keeps different, for good (e.g. a CI file with an extra install
step). List each one in `<project>/kit.config.json`:

```json
"overrides": [{ "path": ".github/workflows/ci.yml", "reason": "root npm ci for the schema build" }]
```

Exact installed paths only (no globs), and every entry needs a `reason`. Install skips them
(`SKIP-OVERRIDE`, even with `-Force`); sync reports them as `override` and `-Apply` never writes them;
drift-check accepts any content. An override naming a file the kit does not ship is reported as a `NOTE`.

## What gets installed

- Core, pack and Cursor-layer files are **managed**: sync updates them while you have not edited them.
- `templates/` and the brain lessons (`docs/brain/**`, which the project keeps appending to) are **seeds**:
  written once, never updated or drift-checked.
- `.claude/settings.json` has no machine paths: only `${CLAUDE_PROJECT_DIR}` and `hooks.shellPath`
  (default: Git for Windows' bash when present, else `bash`).
- No raw Playwright MCP is installed anywhere.

## Layout

| path | what |
| --- | --- |
| `core/` | Stack-neutral workflow files at the paths a project receives them (including the PRD/HLD templates in `.claude/references/`), plus the generalized brain lessons. Placeholders look like `{{git.mainBranch}}`. |
| `packs/angular/`, `packs/node-express/`, `packs/react-vite/` | Stack packs. `pack.json` contract: `standardsDoc`, `skills`, `cursorRules`, `gotchas`, `validation` (npm script names), optional `configDefaults`, `agentsFragment`, `provides` (what the pack supplies for core references: `conventionsDoc`, `backendDoc`, `styleSkill`, `authSkill`, `docsMapSkill`, `docsMapCheck`, `cssSection`, `componentsSection`, read as `stack.<key>`), `fragments` (a `FRAGMENTS.md` whose `## <name>` sections fill core `PACK:<name>` markers: style rules, pre-commit hooks, tech-debt greps), `seeds` (pack files written once; `skipWhenPresent` skips one when the project has an equivalent), `techdebtRules` (rules for `techdebt-report.mjs scan`) and `detect` (`{ order, anyOf: [rules] }`, each rule `deps` / `path` / `gitRemote`: the installer's stack detection). |
| `layers/supabase/`, `layers/upstream-owned/` | Layers: add-ons that are not a stack. `layer.json` takes the optional fields of `pack.json` (no standards doc); layers apply after the packs. |
| `layers/cursor/` | Optional Cursor layer (`.cursor/commands`, rules, `mcp.json` without raw Playwright). |
| `templates/` | Skeletons: `AGENTS.md`, `CLAUDE.md`, `docs/brain/*`, `docs/project/*`, `.gitignore`, `.mcp.json`, `.nvmrc`; `templates/cursor/` only with `-Cursor`. |
| `kit.config.json` | Every key a placeholder can name. `slots.fePorts/bePorts` are base ports (slot N = base + N); `paths.srcRoot/serverRoot` end with `/`; `paths.planChecks` (default `docs/project/plan-checks.md`) is the project's own planning checklist, which `/plan`'s Architect + PM review adds when the file exists — optional, never written by the kit. `commands.*` are npm script names; `commands.dev` + `slots.feExec`, `slots.fePortArgs`, `slots.feMatcher`, `slots.feEnvFile` describe the slot frontend dev server (filled by a stack pack); `project.i18nFile` may be a file, glob or folder (`src/locales/`); `security.sensitivePaths` as a regex string replaces `ship-prep`'s built-in sensitive paths, as a list of globs adds to them; `tools.browser` left at its default is not named in `AGENTS.md`; `ci.install` (default `npm ci`), `ci.lintScope` (`all` / `changed`), `ci.appAuditMode` (`enforce` / `report`) and `ci.testMode` (`run` / `if-present` / `skip`) shape the CI workflows, and an empty `paths.serverRoot` renders no backend job or step; `stack.packs` / `stack.layers` name the stack, `ownership.upstreamPaths` the upstream-owned files. Optional project wording (unset = the generic lines): `commands.logQuery` (a full command) adds a Logs check to `/review-it`; `project.uiDirection: "rtl"` makes the angular styling skill say the UI is right-to-left (naming `project.uiLocale`, a display phrase such as `Arabic RTL`, not a locale code); `commands.logQuery` may not contain `|` or a backtick; `project.icons.library` / `component` / `registry` name the icon library in the angular component skill and conventions; `docs.domainSummary` replaces the angular standards doc's pointer to `docs.domainStandards` with a one-line list of the domain rules. The `$comment` scaffold documents every key. |
| `kit.json` | Kit version (semver), recorded into each install. |
| `tools/install.mjs`, `tools/sync.mjs`, `tools/drift-check.mjs` | Installer, sync and drift check. |
| `tools/lib/kit.mjs`, `tools/lib/source.mjs` | Render/plan engine; release fetch + cache. |
| `tools/adoption-report.mjs` | Which workflow parts an installed project has and whether each works (hooks, git hooks, scripts dependencies, links, CI, stack). |
| `tools/leak-check.mjs`, `tools/pack-check.mjs`, `tools/install-check.mjs`, `tools/e2e-check.mjs`, `tools/workflow-link-check.mjs`, `tools/acceptance-check.mjs` | Checks (below). `tools/fixtures/` builds the fixture projects the acceptance check installs into. |
| `.github/workflows/leak-check.yml` | Runs every check on push and pull request. |

Placeholder filters (code contexts): `{{paths.hotspots|quoted}}` → `'a', 'b'`, `|dquoted`, `|glob` →
`{a,b}`, `|alt` → `a|b` (regex alternation, metacharacters escaped), `|json` → the value as a JS/JSON literal
(a string stays a string, a list a list).

Line directives, applied before placeholders (each on a line of its own, as `# …` or `<!-- … -->`):
`KIT:if <key>` / `KIT:else` / `KIT:end` keep or drop lines by the config (`key`, `!key`, `key=value`, `key!=value`;
set = not empty), and `PACK:<name>` is replaced by the `## <name>` section of each selected pack's `FRAGMENTS.md`
(none = the line is dropped). Core uses a pack contract key (`{{stack.styleSkill}}` …) only inside
`KIT:if stack.<key>` with a fallback; `pack-check` enforces it.

## Checks

Exit 0 = clean. CI runs all of them.

```
node tools/leak-check.mjs                                              # core, layers, templates: no framework/project names
node tools/leak-check.mjs --root packs --project-only                  # packs: no project names
node tools/leak-check.mjs --root README.md --root CHANGELOG.md --root docs --project-only
node tools/pack-check.mjs                                              # every pack and layer meets the pack.json contract
node tools/install-check.mjs                                           # installs fixtures; sync, drift, detection, local + GitHub sources (offline)
node tools/e2e-check.mjs                                               # a fresh project through plan -> take-plan -> ship -> merge -> close-out
node tools/workflow-link-check.mjs                                     # every path the installed workflow docs name exists (each pack and layer)
node tools/acceptance-check.mjs --e2e                                  # Angular, React-Vite and upstream-owned fixture projects, then e2e --project
```

`node tools/e2e-check.mjs --project ..\my-app` runs the e2e cycle on a scratch copy of a real installed project
(slots borrow its `node_modules` through junctions, removed with `rmdir`; nothing reaches GitHub), including the slot
dev server and, with an `upstream` remote, `/pull-copy`. It stops before cloning with `install dependencies in <path>
first` when the project or its `scripts/` has no `node_modules`, or one that lacks most declared packages (a broken
install). It copies the backend's `<paths.serverRoot>.env` (when git ignores it) into the scratch slots, as the slot
setup does, and deletes the copies when the run ends, also on Ctrl+C; without that file the slot dev server cases are
`SKIP` with the reason. `node tools/adoption-report.mjs --target ..\my-app` lists each workflow part with `ok` /
`warn` / `fail`.

`install-check` also runs `actionlint` on every workflow it renders when `actionlint` is on the PATH (or `ACTIONLINT`
names it); kit CI installs a pinned, checksum-verified release and sets `KIT_REQUIRE_ACTIONLINT=1`.
`node tools/workflow-link-check.mjs --target ..\my-app` checks an installed project; a path a doc names that does not
exist but the project's `.gitignore` ignores (a log written at run time) is counted as `runtime`, not missing.

`KIT_LEAK_TERMS="name,email,host"` adds private terms to any leak-check run without putting them in this
repo.

## Releasing

1. All kit work merged to `main`; CI green on `main`.
2. Private-data sweep: `KIT_LEAK_TERMS="<your names, emails, hosts>" node tools/leak-check.mjs --root core --root packs --root layers --root templates --root tools --root README.md --root CHANGELOG.md --root docs --project-only`
   — only the declared detection lists and generic defaults may show.
3. On a release branch: bump `kit.json` `version`, move `## [Unreleased]` into `## [X.Y.Z] - <date>` in
   `CHANGELOG.md` (and the compare links), PR, merge.
4. Tag the merge commit and publish:

   ```
   git checkout main
   git pull --ff-only
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <the CHANGELOG entry>
   ```

5. Prove it: install `-Source github:WDD-CODER/ai-workflow-kit -Ref vX.Y.Z` into a scratch folder and check
   `.kit/install.json` records that ref and the tag's commit.

Never move a published tag: installs that cached it refuse it. Fix forward with a new patch version.

## Rules

- Core speaks to the stack only through `kit.config.json`, using npm script names, never raw framework commands.
- Lessons marked `Status: draft` were generalized from the source project's lessons and need review before they are relied on.
