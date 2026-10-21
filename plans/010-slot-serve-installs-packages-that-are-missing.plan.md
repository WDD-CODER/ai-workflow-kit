# Plan 010 — Slot Serve Installs Packages That Are Missing, Not Only Ones That Changed

Status: active
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

- [auto] `node --test "tools/test/*.test.mjs"` passes, with cases for the new install check: lockfile hash unchanged but
  `node_modules` missing → install needed; hash unchanged, lockfile lists no packages, no `node_modules` → not needed; hash unchanged and `node_modules` present → not needed; hash changed →
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
scripts/lib/slot-procs.mjs
scripts/slot-serve.mjs
scripts/take-plan.mjs
.kit/install.json
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
   `'missing'` (lockfile exists and lists packages besides the root, hash matches, but `<dir>/node_modules` or `<dir>/node_modules/.package-lock.json` is
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
- [x] D1: Notice when a slot's packages are missing even though the lockfile did not change — installNeed returns missing/changed/null — core/scripts/lib/slot-procs.mjs
- [x] D2: Install the missing packages before starting servers and say why — reason in the slot-serve and take-plan messages, exact manual command on failure — core/scripts/slot-serve.mjs, core/scripts/take-plan.mjs
- [x] D3: Prove the four install cases with a small test — tools/test/slot-procs-install.test.mjs
- [ ] D4: Release and bring it into FoodVibe — CHANGELOG entry, kit PR, release tag on Dandan's go, then kit-sync -Ref <tag> -Apply in FoodVibe, the missing-packages run in a slot, and /ship there — CHANGELOG.md

## Out of Scope
- The global hook and `~/.claude/CLAUDE.md` (machine-wide, already in place; not kit files).
- `job-validation.md`, take-plan close-out, ship gate, card format — kit plan 009.
- New plan tags such as `[human:app]` / `[human:read]` (see the table above).

## Execution Notes
- 2026-10-21 orchestrator run (branch `feat/010-slot-serve-missing-packages` off `orch/orchestrator-v1` 4a144cc),
  no Human available.
- Step 0 skipped: `node scripts/scope-check.mjs --drift --plan=plans/010-...plan.md` → `REALITY: clean`, exit 0.
- D1: `installNeed(dir, hashPath)` + `installReason(need)` exported from `core/scripts/lib/slot-procs.mjs`;
  `npmInstallIfChanged` keeps its name, returns `'changed'|'missing'|false`, rewrites the hash after a successful
  install, and a failed install throws `<npm error> - run \`npm install\` in <dir> by hand` (both callers show it).
- D2: `slot-serve.mjs` prints `SLOT_SERVE: npm install ran in <label> (packages missing|lockfile changed)`;
  `take-plan.mjs` prints `TAKE_PLAN: npm install ran in <label> (<reason>)` instead of always "(lockfile changed)".
- D3: `tools/test/slot-procs-install.test.mjs` (imports the installed `scripts/lib/slot-procs.mjs`, since the core
  source has template placeholders). `node --test tools/test/slot-procs-install.test.mjs` → 7 pass, 0 fail.
- Decision: the Done-when command `node --test tools/test/` fails on Node v24.18.0 with `Cannot find module
  '...\tools\test'` (a bare directory is not a test target there). Equivalent run used:
  `node --test "tools/test/*.test.mjs"` → tests 20, pass 20, fail 0. Not wired into `tools/e2e-check.mjs` (outside
  this plan's scope; the plan names no wiring).
- Smoke (temp folder, real npm): lockfile hash matching, `node_modules` renamed away → `npmInstallIfChanged` returned
  `missing`, printed reason `packages missing`, package reinstalled; second call → `false`.
- `node tools/sync.mjs --target . --apply` → exit 0, `3 kit-update, 0 conflicts`.
- scope extended: scripts/lib/slot-procs.mjs, scripts/slot-serve.mjs, scripts/take-plan.mjs — the kit repo's
  installed copies of the three core sources, rewritten by the required sync (AGENTS.md; CI drift-check)
  (orchestrator, no Human available).
- Kit checks, all exit 0: `npm run build` (PACK_CHECK ok), `npm run lint` (LEAK_CHECK ok ×3), `npm run test`
  (WORKFLOW_LINK_CHECK ok), `npm run e2e` (ACCEPTANCE_CHECK ok — 122 checks), `node tools/e2e-check.mjs`
  (E2E_CHECK ok — 47 cases), `node tools/drift-check.mjs --target .` (KIT_DRIFT ok — 0 undeclared differences).
- D4 partly: CHANGELOG `### Fixed` entry written. Kit PR, release tag, FoodVibe kit-sync, the FoodVibe slot run and
  /ship there are left open (other project / Dandan's go) — D4 stays unticked.
- Checker round 1 (fix):
  - major fixed: `installNeed` returned `missing` forever for a lockfile with no packages (npm never creates
    `node_modules` there), so every slot-serve run reinstalled and stopped the servers. It now returns `missing` only
    when the lockfile lists a package besides the root (v2/v3 `packages` keys other than `""`, or v1 `dependencies`;
    an unreadable lockfile counts as having packages) — `core/scripts/lib/slot-procs.mjs` `lockHasDeps`. New tests:
    no-dependency lockfile → `null`; v1 lockfile with dependencies → `missing`. `node --test
    tools/test/slot-procs-install.test.mjs` → tests 9, pass 9, fail 0. Real-npm replay (temp `server/` with
    package.json `{"name":"z","version":"1.0.0"}` and a root-only lockfile): run1 `changed`, `node_modules` exists
    `false`, run2 `false` (no reinstall, so no `stopAll`).
  - minor fixed: `.kit/install.json` added to the scope block — scope extended: .kit/install.json, rewritten by the
    required sync (commit field and sha256 values) (orchestrator, no Human available).
  - minor fixed: the Done-when command now reads `node --test "tools/test/*.test.mjs"` (the bare-directory form exits 1
    on Node v24.18.0) → tests 22, pass 22, fail 0.
  - `node tools/sync.mjs --target . --apply` → exit 0 (`1 kit-update, 0 conflicts`). Kit checks, all exit 0:
    `npm run build` (PACK_CHECK ok), `npm run lint` (LEAK_CHECK ok ×3), `npm run test` (INSTALL_CHECK ok,
    WORKFLOW_LINK_CHECK ok), `npm run e2e` (ACCEPTANCE_CHECK ok — 122 checks), `node tools/e2e-check.mjs`
    (E2E_CHECK ok — 47 cases), `node tools/drift-check.mjs --target .` (KIT_DRIFT ok — 0 undeclared differences).
