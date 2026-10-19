# How a kit change reaches a project

The kit repository is the source of truth for every managed workflow file. A project never edits those files
on its own: it changes them in the kit, the kit cuts a release, and the project upgrades with `kit-sync`.
The only exceptions are the paths a project lists in its `kit.config.json` `overrides`.

```
kit branch + PR  ->  merge  ->  tag vX.Y.Z + GitHub release  ->  project: kit-sync -Ref vX.Y.Z -Apply  ->  /ship
```

## 1. Change the kit

- Open the session in the kit folder (its own hooks and checks apply there), on a branch off `main`.
- Edit `core/`, `packs/`, `layers/`, `templates/` or `tools/`. Write lessons and comments for any project:
  `leak-check` fails on project names, machine paths, ports and project history.
- Add a line under `## [Unreleased]` in `CHANGELOG.md`: what changed, and what a project must do, if anything.
- Run the checks (`node tools/leak-check.mjs`, the `--project-only` runs, `pack-check`, `install-check`,
  `e2e-check`, `workflow-link-check`; the README's **Checks**), open a PR, and merge once CI is green.

## 2. Cut a release

Follow the README's **Releasing** steps: bump `kit.json`, date the CHANGELOG entry, merge, then tag the merge
commit `vX.Y.Z` and publish the GitHub release. Pick the number by semver:

- **patch** (`1.0.1`): a fix, wording, a check; nothing a project has to do.
- **minor** (`1.1.0`): a new file, command, config key or pack feature; existing projects keep working.
- **major** (`2.0.0`): a project must act — a renamed file, a removed key, a changed install layout. The
  CHANGELOG entry says exactly what to do.

Never move a published tag. A wrong release is fixed by the next one.

## 3. Upgrade a project

From the kit folder (or any kit checkout):

```powershell
.\kit-sync.ps1 -Target ..\my-app -Ref vX.Y.Z           # dry-run: what would this release change?
.\kit-sync.ps1 -Target ..\my-app -Ref vX.Y.Z -Apply    # write new + kit-update files, record the ref
```

- `conflict` rows are never overwritten. Resolve each by hand: take the kit's version, or declare the path an
  override with a reason. Never edit `.kit/install.json` to make a conflict go away.
- Then, on a branch in the project, build and run its checks, and `/ship` the result as one commit:
  `chore(kit): sync ai-workflow-kit vX.Y.Z`. `.kit/install.json` is part of that commit.

## 4. A fix found inside a project

A bug in a managed file found while working in a project goes back to the kit first:

1. Note it (file, what is wrong, how it showed up). Don't patch the project copy.
2. Fix it in the kit (step 1), release it (step 2), upgrade the project (step 3).
3. If the project cannot wait for a release, make the fix on the project's branch **and** in the kit in the
   same session. The next `kit-sync` then sees an identical file (`same`), or a `conflict` that shows the two
   copies drifted apart.

A change that only fits one project is not a kit change: list the path under `overrides` in that project's
`kit.config.json` with the reason, and keep the project's own copy.

## 5. Bring an existing project under kit-sync

A project that already carries the workflow (copied by hand or installed before `.kit/install.json`
existed) is adopted once:

```powershell
.\kit-drift.ps1   -Target ..\my-app -Source github:WDD-CODER/ai-workflow-kit -Ref vX.Y.Z   # must say KIT_DRIFT: ok
.\kit-install.ps1 -Target ..\my-app -Adopt -Source github:WDD-CODER/ai-workflow-kit -Ref vX.Y.Z
```

`-Adopt` writes only `.kit/install.json` and refuses while any managed file differs from the release outside
the declared overrides. Commit that file; from then on the project upgrades with step 3.
