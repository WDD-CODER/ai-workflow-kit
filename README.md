# ai-workflow-kit

A Planner-Worker AI workflow for Claude Code (optional Cursor layer), copied into a project and kept in
sync from tagged releases: plans with a read-write scope, parallel worker slots, scope guards, a `/ship`
pipeline with a merge gate, validation cards, and a brain of lessons.

**Status:** `v1` — the source project runs on kit-sync. Releases follow semver: a minor or patch release never
asks a project to act; a major one says what to do in [CHANGELOG.md](CHANGELOG.md).

**License:** none. Copyright © the author, all rights reserved. The repository is public so it can be read
and installed by its author's projects; no permission to copy, modify or redistribute is granted.

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

## Sync (see what a newer kit changes)

```powershell
.\kit-sync.ps1  -Target ..\my-app                 # dry-run from the recorded source + ref, writes nothing
.\kit-sync.ps1  -Target ..\my-app -Apply          # write only new + kit-update files
```

States: `new`, `kit-update` (written on `-Apply`), `local-only`, `conflict` (never overwritten — resolve by
hand), `removed-from-kit`, `deleted-locally`, `override`.

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
| `core/` | Stack-neutral workflow files at the paths a project receives them, plus the generalized brain lessons. Placeholders look like `{{git.mainBranch}}`. |
| `packs/angular/`, `packs/node-express/` | Stack packs. `pack.json` contract: `standardsDoc`, `skills`, `cursorRules`, `gotchas`, `validation` (npm script names), optional `configDefaults` and `agentsFragment`. |
| `layers/cursor/` | Optional Cursor layer (`.cursor/commands`, rules, `mcp.json` without raw Playwright). |
| `templates/` | Skeletons: `AGENTS.md`, `CLAUDE.md`, `docs/brain/*`, `docs/project/*`, `.gitignore`, `.mcp.json`, `.nvmrc`, `.prettierrc.json`, HLD/PRD templates; `templates/cursor/` only with `-Cursor`. |
| `kit.config.json` | Every key a placeholder can name. `slots.fePorts/bePorts` are base ports (slot N = base + N); `paths.srcRoot/serverRoot` end with `/`. |
| `kit.json` | Kit version (semver), recorded into each install. |
| `tools/install.mjs`, `tools/sync.mjs`, `tools/drift-check.mjs` | Installer, sync and drift check. |
| `tools/lib/kit.mjs`, `tools/lib/source.mjs` | Render/plan engine; release fetch + cache. |
| `tools/leak-check.mjs`, `tools/pack-check.mjs`, `tools/install-check.mjs` | Checks (below). |
| `.github/workflows/leak-check.yml` | Runs every check on push and pull request. |

Placeholder filters (code contexts): `{{paths.hotspots|quoted}}` → `'a', 'b'`, `|dquoted`, `|glob` →
`{a,b}`, `|alt` → `a|b` (regex alternation, metacharacters escaped).

## Checks

Exit 0 = clean. CI runs all of them.

```
node tools/leak-check.mjs                                              # core, layers, templates: no framework/project names
node tools/leak-check.mjs --root packs --project-only                  # packs: no project names
node tools/leak-check.mjs --root README.md --root CHANGELOG.md --root docs --project-only
node tools/pack-check.mjs                                              # every pack meets the pack.json contract
node tools/install-check.mjs                                           # installs fixtures; sync, drift, local + GitHub sources (offline)
node tools/e2e-check.mjs                                               # a fresh project through plan -> take-plan -> ship -> merge -> close-out
```

`KIT_LEAK_TERMS="name,email,host"` adds private terms to any leak-check run without putting them in this
public repo.

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
