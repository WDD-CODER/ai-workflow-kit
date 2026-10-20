# Plan 010 — Slot Serve Installs Packages That Are Missing, Not Only Ones That Changed

Status: draft
Snapshot: 5704089

## Problem Statement
On 2026-10-20 a FoodVibe Worker in `wt-3` handed the Human 12 validation checks while the slot's servers were off.
The global hook `~/.claude/hooks/validation-handoff.mjs` (Stop) and kit plan 009 (end-of-work cards, servers first)
now cover the hand-off itself. One cause is still open: when the servers were started, `server` failed because its
packages were not installed (`cross-env` missing).

Root cause: `npmInstallIfChanged()` in `core/scripts/lib/slot-procs.mjs` installs only when the lockfile's hash
differs from `.claude/.last-npm-install-hash-<dir>`. In `wt-3` that hash file was from 2026-10-06 and still matched,
while `server/node_modules` was missing or incomplete — so the install was skipped and the start failed late. The same
function runs in `take-plan.mjs`, so a claimed slot can carry the gap too.

### How the brief's items are covered
| Brief item | Where |
| --- | --- |
| Stop hook: cards in the final message → run `slot-serve`, keep the agent working on a failed start | Done: global hook `~/.claude/hooks/validation-handoff.mjs` (machine-wide, Stop). It reads the page URLs in the cards, starts `scripts/slot-serve.mjs` in a slot, re-checks, and blocks with the error. |
| No servers for `[auto]` or read-only checks; `[human:app]` / `[human:read]` tags | Not needed: the hook starts servers only when the cards contain app URLs. Kit plan 009 Out of Scope already rejects new tags for this reason. |
| Nothing outside a slot | The hook uses `slot-serve` only when `.worktree-root` exists; `slot-serve` refuses outside a slot. |
| Card header / doc rule in `job-validation.md` | Kit plan 009 (V2, V3). |
| `slot-serve` installs missing `server/node_modules` | **This plan.** |

## Prerequisites
- none. (Independent of 009: different files.)

## Goals & Success Criteria
**Primary:** a slot whose packages are missing gets them installed by `slot-serve` / `take-plan` before any server
starts, so a hand-off never fails on a missing package.

- [auto] `node --test tools/test/` passes, with cases for the new install check: lockfile hash unchanged but
  `node_modules` missing → install needed; hash unchanged and `node_modules` present → not needed; hash changed →
  needed; no lockfile → not needed.
- [auto] In a FoodVibe slot after the sync, with servers off and `server/node_modules` renamed away,
  `node scripts/slot-serve.mjs` prints `npm install ran in server (packages missing)` and then
  `SLOT_SERVE: be=<port> started`. The Worker restores nothing by hand; the new `node_modules` is the result.
- [auto] Kit release tagged; `kit-sync -Ref <tag> -Apply` on FoodVibe reports no `conflict` rows.
- [human] In a FoodVibe `wt-N` slot with servers off, a finished job's cards arrive with the app already answering at
  the page URLs in the cards (shared with kit plan 009's [human] item — one check covers both).

## Execution Mode
- Parallel: yes — 009 edits docs and commands only; this plan edits `core/scripts/lib/slot-procs.mjs`,
  `core/scripts/slot-serve.mjs`, `core/scripts/take-plan.mjs`.
- Concurrent plans: 009.
- Isolated DB: no.
- Kit edits: kit branch `feat/010-slot-serve-missing-packages` + kit PR; Dandan merges and gives the go for the release.

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`.

```scope
core/scripts/lib/slot-procs.mjs
core/scripts/slot-serve.mjs
core/scripts/take-plan.mjs
tools/test/**
CHANGELOG.md
```

## Read Scope
Kit repo; FoodVibe's rendered copies of the files above; `~/.claude/hooks/validation-handoff.mjs` (read only).

## Escalation Protocol
Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry. Project sync `conflict` rows: STOP, never `--force`. Tags and releases: wait
for Dandan's go.

## Architecture Impact
- INV-none: preserves — kit workflow script; projects get it through `kit-sync`. No app, server or schema file.

## Step 0 — Reality Check
Re-read `npmInstallIfChanged` and `installDirs` on `origin/main`; if 009 or another merge changed them, apply the
changes below to that text.

## Functional Requirements
1. **Pure check:** new exported `installNeed(dir, hashPath)` in `slot-procs.mjs` returns `null` (no install),
   `'missing'` (lockfile exists, hash matches, but `<dir>/node_modules` or `<dir>/node_modules/.package-lock.json` is
   absent) or `'changed'` (hash differs or no hash file). No lockfile → `null`. No side effects, so it can be tested
   without running npm.
2. **Install:** `npmInstallIfChanged` uses `installNeed`; it still writes the hash after a successful install, and
   returns the reason (truthy) instead of `true`, so callers can print it. Keep the function name (callers in
   projects' copies) or rename in all three files at once.
3. **Messages:** `slot-serve.mjs` prints `npm install ran in <label> (packages missing|lockfile changed)`;
   `take-plan.mjs` line ~362 prints the same reason instead of always "(lockfile changed)".
4. **Failure:** an install that fails keeps today's `fail(...)` but adds the exact command to run by hand:
   `npm install` run in `<dir>`.
5. **Tests:** `tools/test/slot-procs-install.test.mjs` (new; kit-only, `node --test`) builds temp dirs with a
   lockfile, a hash file and optional `node_modules`, and checks the four cases from Done-when.

## Atomic Sub-tasks
- [ ] D1: Notice when a slot's packages are missing even though the lockfile did not change — installNeed returns missing/changed/null — core/scripts/lib/slot-procs.mjs
- [ ] D2: Install the missing packages before starting servers and say why — reason in the slot-serve and take-plan messages, exact manual command on failure — core/scripts/slot-serve.mjs, core/scripts/take-plan.mjs
- [ ] D3: Prove the four install cases with a small test — tools/test/slot-procs-install.test.mjs
- [ ] D4: Release and bring it into FoodVibe — CHANGELOG entry, kit PR, release tag on Dandan's go, then kit-sync -Ref <tag> -Apply in FoodVibe, the missing-packages run in a slot, and /ship there — CHANGELOG.md

## Out of Scope
- The global hook and `~/.claude/CLAUDE.md` (machine-wide, already in place; not kit files).
- `job-validation.md`, take-plan close-out, ship gate, card format — kit plan 009.
- New plan tags such as `[human:app]` / `[human:read]` (see the table above).

## Execution Notes
