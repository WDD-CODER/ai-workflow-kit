# Plan 094 — kit-sync removes an override of a file the kit retired

Status: draft
Depends-on: none
Snapshot: 3f65bda387d77745ca7655782fa0be1b6c3a2664
Source: Human, 2026-11-07 — FoodVibe1.0 kept `.claude/commands/auto-solve.md` (deleted by plan 090) through `kit-sync -Apply -Prune` because it was an override. Reliability fix, allowed in the freeze; no new capability.

## Problem Statement
`tools/sync.mjs:230` only prints `NOTE override <path> is not a file this kit ships — remove it from <cfg>` for any override the kit does not plan. The entry stays, the file stays, so a command the kit deleted stays listed in the project. Core principle: the kit updates every project fully, with no partial install.

## Goals & Success Criteria
**Primary:** `kit-sync -Apply -Prune` removes the override entry of a file the kit explicitly retired and handles the file safely; a typo or project-only override is untouched.

- [auto] Dry run (no `--apply`): an override whose path is in the retired list prints `pruned-override <path> — override of a file the kit retired (on --apply --prune)` instead of the NOTE; nothing is written.
- [auto] `--apply --prune`: that entry is removed from the config's `overrides` (every other entry and the file's formatting byte-identical), the file is handled per Q1, the row prints where it went, and the `KIT_SYNC:` summary counts `N pruned-override`.
- [auto] `--apply` without `--prune`: nothing removed; the row text says `(needs --prune)`.
- [auto] An override path the kit never shipped (not in the retired list) keeps today's NOTE; its file and entry are never touched.
- [auto] `node --test tools/test/sync-retired-override.test.mjs` passes, three cases: retired + unchanged (file deleted, entry gone), retired + changed by the project (file moved to `.kit/pruned/<path>`, entry gone), never shipped (NOTE, nothing touched). Each also asserts the other overrides and the config formatting are unchanged.
- [auto] The retired list is explicit: `tools/retired-files.json` = `[{ "path", "plan", "lastSha256"? }]`, seeded from plan 090's deletion list (the nine installed paths in CHANGELOG 2.1.0; the two `tools/fixtures/**` entries are kit-repo only and excluded). "Retired" never means "not planned now": a path the kit still plans is never retired.
- [auto] If the config text cannot be edited safely (JSON.parse of the edited text must equal the old config minus that one entry), sync stops with a `KIT_SYNC: STOP` line before writing anything — no partial update.
- [auto] `npm run build`, `npm run lint`, `npm test`, `node --test "tools/test/*.test.mjs"` pass; sync then drift-check report no drift.
- [auto] Plan 090's `[human]` line now reads: "Open one Claude Code session in the kit and one in FoodVibe after `kit-sync.ps1`: `/commands` lists nothing dead and `/orchestrate` is there, and `/orchestrate --dry-run` of one plan prints its waves." (The approved size budget is 24 commands, target 10; "ten or fewer" cannot pass.)
- [auto] `CHANGELOG.md` has one entry.

## Execution Mode
- Parallel: no. Concurrent plans: none. Isolated DB: no.
- Solo kit flow: `feat/094-<slug>` in this folder, then `/ship`. Freeze exception: reliability fix.

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspot `CHANGELOG.md`.

```scope
tools/sync.mjs
tools/lib/kit.mjs
tools/retired-files.json
tools/test/sync-retired-override.test.mjs
plans/1-100/090-subtraction-delete-what-the-runner-replaced-and-a-size-budget-test.plan.md
CHANGELOG.md
```

## Read Scope

Entire repo.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry.

## Architecture Impact
- INV-1: preserves — sync still never writes an overridden path the kit ships; only entries for retired files are removed, and only with `--apply --prune`. No invariant changed.

## Step 0 — Reality Check
1. Read `tools/sync.mjs` 176–235 (`unknownOverrides`, `order`, summary line) and `tools/lib/kit.mjs` `readOverrides`; confirm `cfgName` covers both `kit.config.json` and `.kit/config.json`.
2. Confirm the nine retired paths against `git show fd212e1` and CHANGELOG 2.1.0.
3. Confirm whether `.kit/install.json` still holds a sha256 record for an overridden path (for the "unchanged" test).

## Atomic Sub-tasks
- [x] R1: Give the kit one explicit list of files it deleted, so "retired" never means "just not planned now" — retired-files.json seeded from plan 090, loader in kit.mjs — tools/retired-files.json, tools/lib/kit.mjs
- [x] R2: Make sync drop the override entry and move or delete the file of a retired path, and count it in the summary — dry-run row, safe config text edit, Q1 handling — tools/sync.mjs
- [x] R3: Prove the three cases with tests: retired and unchanged, retired and changed by the project, never shipped — tools/test/sync-retired-override.test.mjs
- [x] R4: Reword plan 090's human session check so it can pass under the approved size budget — plans/1-100/090-subtraction-delete-what-the-runner-replaced-and-a-size-budget-test.plan.md
- [x] R5: Run every check and add the changelog entry — CHANGELOG.md

## Technical Considerations
- "Unchanged" = override file text hash (CRLF-normalised, as `sameText` in sync.mjs) equals the `.kit/install.json` record for that path, else `lastSha256` from the retired list. No hash to compare → treated as changed (the safe side).
- Config edit is textual (brace-scan the object with `"path": "<p>"`, drop it and one comma), validated by re-parse; no re-serialising.

## Out of Scope
Pruning non-override retired files (existing `--prune` already does that); a retired list for packs or layers.

## Critical Questions
Q1 (answered, Human 2026-11-07): a retired override file that differs from the kit's last shipped copy is moved to `.kit/pruned/<path>` on `--apply --prune`, and sync prints where.

## Execution Notes
