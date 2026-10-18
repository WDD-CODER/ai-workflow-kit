# Changelog

All notable changes to the kit. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [semver](https://semver.org/); while the kit is `0.x`, a minor bump may change how
projects install or sync, and the entry says what to do.

Releases are git tags `vX.Y.Z` with a GitHub release. Install or upgrade to one with
`--source github:WDD-CODER/ai-workflow-kit --ref vX.Y.Z` (see the README).

## [Unreleased]

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

[Unreleased]: https://github.com/WDD-CODER/ai-workflow-kit/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v0.5.0
