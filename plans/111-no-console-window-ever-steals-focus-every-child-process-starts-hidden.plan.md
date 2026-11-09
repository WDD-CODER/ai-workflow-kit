# Plan 111 — No console window ever steals focus: every child process the kit starts is hidden

Status: draft
Depends-on: none
Snapshot: e282b67
Source: the Human, 2026-11-09 (FoodVibe session, run-518): console windows keep flashing open and shut while runs, servers and gates work; each one takes keyboard focus from whatever the Human is typing in. No new capability; a Windows behaviour fix across the kit's scripts.

## Problem Statement
1. **Windows pop up and steal focus.** On Windows, a console program (`git`, `gh`, `pnpm`, `node`, `cmd`) started by a process that has no console of its own gets a new, visible console window. It opens, takes focus, and closes when the program ends. The Human loses their typing focus many times per run.
2. **Why the kit's processes have no console.** On Windows, Node's `detached: true` means no console at all, so every console child started without `windowsHide: true` gets its own visible window. **v3.0.1 already fixed the orchestrator run:** the supervisor starts `run-plans.mjs` not detached on Windows with `windowsHide: true` (`detachedOptions(fd, { console: true })` in `core/scripts/run-supervisor.mjs`), so the run has one hidden console that all its git and node calls share; the supervisor's own three `spawnSync` calls pass `windowsHide: true`. The Human watched the real-run test on 2026-11-09: no window flashed. Still open: the supervisor process itself is still detached (only its own hidden calls run there), dev servers from `slot-procs.mjs`, hooks run by Claude Code, and every other script that runs from a console-less parent.
3. **Only a few calls hide today.** Of about 330 `spawn` / `spawnSync` / `exec*` calls outside tests (40 files in `core/scripts`, 26 in `tools`, 2 in `packs`), about 24 pass `windowsHide: true`: the supervisor's `detachedOptions`, the builder and reviewer (`lib/claude-run.mjs`), the gate (`lib/plan-gate.mjs`) and the dev servers (`lib/slot-procs.mjs`). Everything else, e.g. every `git` / `gh` call in `orch-state.mjs` (14), `decision-log.mjs` (14), `run-plans.mjs` (12), `take-plan.mjs` (10), `lib/orch-run.mjs` (10), opens a window when its parent has no console.
4. **Nothing stops a new call from bringing it back.** No test or lint looks at child-process options.

## Goals & Success Criteria
**Primary:** during a full `/orchestrate` run, a `/take-plan` with `slot-serve`, and a `/ship`, no console window appears on the Human's screen, and nothing else about those flows changes.

- [auto] One shared helper, `core/scripts/lib/proc.mjs`, wraps `spawn`, `spawnSync`, `execFile`, `execFileSync`, `exec`, `execSync` and always sets `windowsHide: true`. A call may pass `{ showWindow: true, why: '<reason>' }` only for a step that needs the Human's own input; no call does today.
- [auto] Every child-process call under `core/scripts/**`, `tools/**` and `packs/**/scripts/**` (tests excluded) goes through `lib/proc.mjs` (or, in `tools/` and `packs/`, a copy of the same few lines when they cannot import from `core/`). `node --test tools/test/no-console-window.test.mjs` passes: it scans those folders and fails on any direct `child_process` import or call outside `lib/proc.mjs`, naming the file and line; a `showWindow: true` without a `why` also fails.
- [auto] Unit test for `lib/proc.mjs`: each wrapper passes `windowsHide: true` through, keeps every other option and the return value unchanged (stdout, status, signal, error), and `showWindow: true` drops it.
- [auto] Output, exit codes, timeouts and the `taskkill /T` kill paths behave as before: the existing tests (`tools/test/*.test.mjs`, `npm test`, `npm run build`, `npm run lint`, `node tools/drift-check.mjs --target .`) pass unchanged.
- [auto] Detached starts (supervisor, dev servers) keep `windowsHide: true`, and the run keeps v3.0.1's hidden console (`detachedOptions` with `console: true`, not detached on Windows — `tools/test/run-supervisor.test.mjs` checks it); Step 0 item 3's check of the dev servers is recorded under Execution Notes with the Node version, and the same hidden-console start is used for them only if that check shows a window.
- [human] On FoodVibe, after `kit-sync` of the release: run one `/orchestrate` plan and one `slot-serve` start while typing in another window; no console window appears and focus never moves (reply `ok`, or `failed:` with roughly when a window appeared).

## Execution Mode
- Parallel: no.
- Concurrent plans: none.
- Isolated DB: no.
- Run: **solo flow** (`git switch -c feat/111-<slug>` from `origin/main`, build here, then `/ship`). Not `/orchestrate`: the change touches the run scripts themselves.
- After the merge: a minor release (no project action beyond `kit-sync`); FoodVibe syncs it with `kit-sync -Ref vX.Y.Z -Apply`.

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspots `CHANGELOG.md` and `docs/brain/error-review.md`.

```scope
core/scripts/**
scripts/**
tools/**
packs/*/scripts/**
docs/project/**
kit.json
CHANGELOG.md
docs/brain/error-review.md
docs/brain/gotchas.md
```

## Read Scope

Entire repo.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a step needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry.

## Architecture Impact
- INV-1: preserves — no model call, tier, setting or agent changes; only the window flag on child processes.

## Step 0 — Reality Check
1. List every child-process call outside tests: `grep -rnE "\b(spawn|spawnSync|execFile|execFileSync|execSync|exec)\(" core/scripts tools packs --include=*.mjs --include=*.js --include=*.cjs`, plus `child_process` imports. Note which already pass `windowsHide` (expected: `run-supervisor.mjs`, `lib/claude-run.mjs`, `lib/plan-gate.mjs`, `lib/slot-procs.mjs`).
2. `scripts/**` is the kit's own installed copy of `core/scripts/**`: change `core/`, then resync the copy (as plan 110 did); never hand-edit `scripts/` alone.
3. Detached + hidden on Windows: the run's case is settled by v3.0.1 (a detached process has no console, so its children flash; the fix is not detached + `windowsHide`, which gives one hidden console the children share). Check the dev servers the same way: start one with `slot-procs.mjs` as it is and watch for windows while it serves and its tools run; if one shows, give it the same hidden-console start as the run. Do not change `detachedOptions` again.
4. `shell: true` calls on Windows (`pnpm.cmd`, `npm.cmd`): `windowsHide` must reach `cmd.exe` too; the helper passes it on every call.
5. Anything that needs the Human's input in a console (a login, a prompt): expected none. If one exists, it gets `showWindow: true` with its `why`.

## Atomic Sub-tasks
- [ ] S1: Write the failing scan test that lists every child-process call outside the helper — tools/test/no-console-window.test.mjs
- [ ] S2: Add the shared helper and its unit test — always hidden, `showWindow` only with a reason — core/scripts/lib/proc.mjs, tools/test/proc.test.mjs
- [ ] S3: Move every call in core/scripts to the helper, file by file, keeping options and return values — core/scripts/**
- [ ] S4: Move every call in tools/ and packs/ scripts the same way — tools/**, packs/*/scripts/**
- [ ] S5: Check the dev servers' detached start the way v3.0.1 fixed the run, and give them a hidden console only if a window still shows — core/scripts/lib/slot-procs.mjs
- [ ] S6: Document the rule in one line where scripts are written, and add a gotcha entry — docs/project/**, docs/brain/gotchas.md
- [ ] S7: Resync the installed copy, run every check, and release it — scripts/**, kit.json, CHANGELOG.md

## Technical Considerations
- `windowsHide` only sets how the child's window is shown (hidden). It does not change stdio, exit codes, environment, timeouts or kill behaviour, and it is ignored on macOS and Linux. Grandchildren of a hidden console child share its hidden console, so `pnpm` → `ng` stays hidden too.
- Opening a browser (`start <url>`, `open`) still works: only the `cmd` window behind it is hidden; the browser is a normal app window.
- Windows opened by other programs (Claude Code itself, Cursor, Windows updates) are outside the kit and stay out of scope.
- The diff is wide but mechanical: one import and one call name per site. Keep each file's change to that; no refactors on the way.

## Out of Scope
Changing what any script runs or prints; Claude Code's own hook runner; any machine-wide Windows setting (`ForegroundLockTimeout` and similar do not reliably stop new console windows on Windows 11).

## Critical Questions
None open.

## Execution Notes
- 2026-11-09 Planner: v3.0.1 (plan 110, merge c6a627d) already hides the orchestrator run on Windows (see Problem Statement 2); Done-when, Step 0 item 3 and S5 now cover only what is left. The helper (S2–S4) and the scan test (S1) are unchanged: they keep the rest of the kit hidden and stop new calls from bringing windows back.
