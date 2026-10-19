# ai-workflow-kit

A Planner-Worker AI workflow for Claude Code (optional Cursor layer), copied into a project and kept in
sync from tagged releases: plans with a read-write scope, parallel worker slots, scope guards, a `/ship`
pipeline with a merge gate, validation cards, and a brain of lessons.

**Status:** `v1` — the source project runs on kit-sync. Releases follow semver: a minor or patch release never
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
.\kit-install.ps1 -Target ..\my-app -Source github:WDD-CODER/ai-workflow-kit -Ref v1.0.0 -Packs angular -Cursor
```

- `-Source github:<owner>/<repo> -Ref <tag>` fetches exactly that release (a shallow `git fetch` of the tag)
  into a per-user cache, `~/.cache/ai-workflow-kit/<owner>/<repo>/<tag>/` (override with
  `$env:AI_WORKFLOW_KIT_CACHE`), and installs from it. The cache is reused while the tag still points to
  the same commit; a tag that moved is refused. Offline, a cached release is used with a note.
- Without `-Source`, the kit you run the script from is installed (kit development). `-Source <folder>`
  installs from another kit checkout.
- `-Packs angular,node-express` picks stack packs, `-Cursor` adds the Cursor layer, `-YesChef` the
  "Yes chef!" gate, `-DryRun` previews, `-Force` overwrites existing files (never overrides).
- `<project>/.kit/install.json` records what was installed: kit version, `source`, `ref`, `commit`, packs
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
  (e.g. `npm install --no-audit --no-fund` for a lockfile the project can't fix). The workflow scripts' own
  dependencies are always audited at `critical` (when `scripts/package-lock.json` is committed). No backend
  (`paths.serverRoot` empty) = no `server-tests` job and no server step.
- **CI secret scan.** The `gitleaks` job in `ci.yml` asks for `contents: read` and `pull-requests: read`
  and posts no PR comments (`GITLEAKS_ENABLE_COMMENTS: false`), so it works with the default read-only
  token. A repository owned by an organization (not a personal account) also needs a `GITLEAKS_LICENSE`
  secret (see the gitleaks-action docs).

## Sync (see what a newer kit changes)

```powershell
.\kit-sync.ps1  -Target ..\my-app                 # dry-run from the recorded source + ref, writes nothing
.\kit-sync.ps1  -Target ..\my-app -Apply          # write only new + kit-update files
```

States: `new`, `kit-update` (written on `-Apply`), `local-only`, `conflict` (never overwritten — resolve by
hand), `removed-from-kit`, `deleted-locally`, `override`, `ignored` (missing, and the project's git ignores
it: never written). Drift-check reports such a file as `ignored`, not `missing`.

## Upgrade to another release

```powershell
.\kit-sync.ps1  -Target ..\my-app -Ref v1.1.0          # what would v0.6.0 change? writes nothing
.\kit-sync.ps1  -Target ..\my-app -Ref v1.1.0 -Apply   # apply it and record ref v0.6.0 in install.json
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
.\kit-install.ps1 -Target ..\my-app -Adopt -Source github:WDD-CODER/ai-workflow-kit -Ref v1.0.0
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
| `packs/angular/`, `packs/node-express/` | Stack packs. `pack.json` contract: `standardsDoc`, `skills`, `cursorRules`, `gotchas`, `validation` (npm script names), optional `configDefaults`, `agentsFragment`, `provides` (what the pack supplies for core references: `conventionsDoc`, `backendDoc`, `styleSkill`, `authSkill`, `docsMapSkill`, `docsMapCheck`, `cssSection`, `componentsSection`, read as `stack.<key>`), `fragments` (a `FRAGMENTS.md` whose `## <name>` sections fill core `PACK:<name>` markers: style rules, pre-commit hooks, tech-debt greps), `seeds` (pack files written once; `skipWhenPresent` skips one when the project has an equivalent) and `techdebtRules` (rules for `techdebt-report.mjs scan`). |
| `layers/cursor/` | Optional Cursor layer (`.cursor/commands`, rules, `mcp.json` without raw Playwright). |
| `templates/` | Skeletons: `AGENTS.md`, `CLAUDE.md`, `docs/brain/*`, `docs/project/*`, `.gitignore`, `.mcp.json`, `.nvmrc`; `templates/cursor/` only with `-Cursor`. |
| `kit.config.json` | Every key a placeholder can name. `slots.fePorts/bePorts` are base ports (slot N = base + N); `paths.srcRoot/serverRoot` end with `/`; `paths.planChecks` (default `docs/project/plan-checks.md`) is the project's own planning checklist, which `/plan`'s Architect + PM review adds when the file exists — optional, never written by the kit. `commands.*` are npm script names; `commands.dev` + `slots.feExec`, `slots.fePortArgs`, `slots.feMatcher`, `slots.feEnvFile` describe the slot frontend dev server (filled by a stack pack); `project.i18nFile` may be a file, glob or folder (`src/locales/`); `security.sensitivePaths` as a regex string replaces `ship-prep`'s built-in sensitive paths, as a list of globs adds to them; `tools.browser` left at its default is not named in `AGENTS.md`; `ci.install` (default `npm ci`), `ci.lintScope` (`all` / `changed`) and `ci.appAuditMode` (`enforce` / `report`) shape the CI workflows, and an empty `paths.serverRoot` renders no backend job or step. The `$comment` scaffold documents every key. |
| `kit.json` | Kit version (semver), recorded into each install. |
| `tools/install.mjs`, `tools/sync.mjs`, `tools/drift-check.mjs` | Installer, sync and drift check. |
| `tools/lib/kit.mjs`, `tools/lib/source.mjs` | Render/plan engine; release fetch + cache. |
| `tools/leak-check.mjs`, `tools/pack-check.mjs`, `tools/install-check.mjs`, `tools/e2e-check.mjs`, `tools/workflow-link-check.mjs` | Checks (below). |
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
node tools/pack-check.mjs                                              # every pack meets the pack.json contract
node tools/install-check.mjs                                           # installs fixtures; sync, drift, local + GitHub sources (offline)
node tools/e2e-check.mjs                                               # a fresh project through plan -> take-plan -> ship -> merge -> close-out
node tools/workflow-link-check.mjs                                     # every path the installed workflow docs name exists (packs [], angular, node-express, both)
```

`install-check` also runs `actionlint` on every workflow it renders when `actionlint` is on the PATH (or `ACTIONLINT`
names it); kit CI installs a pinned, checksum-verified release and sets `KIT_REQUIRE_ACTIONLINT=1`.
`node tools/workflow-link-check.mjs --target ..my-app` checks an installed project.

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
