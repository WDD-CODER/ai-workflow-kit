# Plan 110 — A run started by the supervisor no longer crashes before it starts, and a test runs the real run script under it

Status: done
Depends-on: none
Snapshot: da43c3c
Source: plan 106's validation run, 2026-11-09 (case V1, fake mode, working tree at bf79f22): every run that `scripts/run-supervisor.mjs` starts crashes before its first step. Since v3.0.0 `/orchestrate` starts every run that way, so `/orchestrate` cannot run any plan on v3.0.0. Bug fix, allowed in the freeze; no new capability. The Human asked for this plan on 2026-11-09.

## Problem Statement
1. **Every supervised run crashes at start.** Under the supervisor, `run-plans.mjs` gets `RUN_SUPERVISOR_LOG=1`, so `CONSOLE_LOG` is `null` (l.701, its output already goes to the console log). l.703 still calls `mkdirSync(dirname(CONSOLE_LOG))`, which throws `TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string. Received null`. The supervisor reads the run as `refused: run-plans.mjs ended before the run started (exit 1)` and ends. Evidence (the sandbox's console log):
   ```
   SUPERVISOR: launch 1 · … node …/scripts/run-plans.mjs --run val-v1 --plans 901
   RUN_PLANS: crashed — TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string. Received null
       at main (file:///…/scripts/run-plans.mjs:703:15)
   SUPERVISOR: done — refused: run-plans.mjs ended before the run started (exit 1)
   ```
2. **No test ran the real run script under the supervisor.** `tools/test/run-supervisor.test.mjs` replaces it with a fake child (`RUN_SUPERVISOR_RUN_PLANS`), so the crash shipped in v3.0.0 with every check green.

## Goals & Success Criteria
**Primary:** `/orchestrate` on an installed project starts, builds and merges a plan through the supervisor, and a kit test proves it on every pull request.

- [auto] `node --test tools/test/run-supervisor.test.mjs` passes, with a new test that fails on today's code: in a scratch project (`tools/test/lib/run-plans-fixture.mjs` `makeProject`, the fake `claude`), the supervisor's foreground entry (run-supervisor.mjs with --supervise) runs the installed `scripts/run-plans.mjs` (no `RUN_SUPERVISOR_RUN_PLANS`) and exits 0; `status.json` says `finished`, the plan is `merged`, `supervisor.json` has one launch of kind `finished`, and the console log has no `RUN_PLANS: crashed` line.
- [auto] `grep -n "dirname(CONSOLE_LOG)" core/scripts/run-plans.mjs` prints nothing outside an `if (CONSOLE_LOG)` guard; a run without the supervisor still writes its own console log (an existing test in `tools/test/run-plans.test.mjs` covers it, or the new test checks it).
- [auto] Release v3.0.1: `kit.json` version `3.0.1` and a `## [3.0.1] - <date>` section in `CHANGELOG.md` that says, in one line, that `/orchestrate` crashed at start on v3.0.0 and which file to sync. No project action, so a patch release.
- [auto] `npm run build`, `npm run lint`, `npm test`, every kit tool test (node --test over tools/test) and `node tools/drift-check.mjs --target .` pass (the kit sync with apply runs first; it is a step, not a check).
- [human] On FoodVibe, after syncing v3.0.1, `/orchestrate` on one plan reaches `building` in `node scripts/orch-state.mjs watch` (reply `ok`). Plan 106's case V1 checks the same in a sandbox once 106 is merged.

## Execution Mode
- Parallel: no.
- Concurrent plans: none.
- Isolated DB: no.
- Run: **solo flow** (`git switch -c fix/110-<slug>` from `origin/main`, build here, then `/ship`). Not `/orchestrate`: it is the thing that is broken.
- After the merge: tag `v3.0.1` on the merged `main` and publish the GitHub release (the Human approves the merge).

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspots `CHANGELOG.md` and `docs/brain/error-review.md`.

```scope
core/scripts/run-plans.mjs
scripts/run-plans.mjs
tools/test/run-supervisor.test.mjs
tools/test/run-plans.test.mjs
tools/test/lib/run-plans-fixture.mjs
kit.json
CHANGELOG.md
docs/brain/error-review.md
core/scripts/run-supervisor.mjs
scripts/run-supervisor.mjs
```

## Read Scope

Entire repo.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a step needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry.

## Architecture Impact
- INV-1: preserves — one guard on a log-folder call and one test; no model call, tier, setting or agent changes.

## Step 0 — Reality Check
1. `core/scripts/run-plans.mjs` l.331–340 (`CONSOLE_LOG`, `say`) and l.699–705: l.702 already makes the console log's folder, so l.703 is only needed when `CONSOLE_LOG` is set. Check every other use of `CONSOLE_LOG` for the same null.
2. `core/scripts/run-supervisor.mjs` `runChild` (sets `RUN_SUPERVISOR_LOG: '1'`) and the `--supervise` entry: the test runs that entry in the foreground, so it ends when the run ends.
3. `tools/test/run-supervisor.test.mjs`: where the fake child is used, and whether the scratch-project fixture already works from it (the supervisor's leftover sweep runs `orphan-sweep.mjs` and `free-merged-slots.mjs` in the project).
4. Plan 106's fixture changes (`kitRef`, `files`, `env` options) are on `feat/106-validation-run`, not on `main`: use only what `main` has.

## Atomic Sub-tasks
- [x] S1: Write the failing test that runs the real run script under the supervisor to a merged plan — tools/test/run-supervisor.test.mjs
- [x] S2: Stop the run script from crashing when the supervisor owns its console log — guard the folder call on CONSOLE_LOG — core/scripts/run-plans.mjs
- [x] S2b: Give the supervised run one hidden console so no window flashes for each command on Windows — not detached on Windows, windowsHide on the supervisor's own calls — core/scripts/run-supervisor.mjs
- [x] S3: Resync the installed copy, run every check, and release it as v3.0.1 — kit.json, CHANGELOG.md

## Technical Considerations
- The fix is one guard; the test is the larger part, and the one that matters: it is the first kit test that runs the real `run-plans.mjs` as the supervisor's child.
- The test must stay quick (one toy plan, fake builder): it runs in the CI job `kit-tests` with every other tool test.

## Out of Scope
Plan 106 (the validation tool); FoodVibe's bugs 5 and 6 from runs 536/540 (a half-deleted builder folder on Windows, a relaunch that skips a cut-off final gate) — their own plan.

## Critical Questions
None open.

## Execution Notes
- 2026-11-09 Builder: the new test failed on today's code with the crash (`RUN_PLANS: crashed — TypeError … run-plans.mjs:703`); with the guard, `node --test tools/test/run-supervisor.test.mjs` → pass 11, fail 0.
- 2026-11-09 Human (`approved: core/scripts/run-supervisor.mjs`, `approved: scripts/run-supervisor.mjs`): the first real-run test flashed a console window per command (the run was a detached, console-less process on Windows). S2b gives the run one hidden console; the Human watched the next test runs: "no window flashed! its fixet".
- Kit tool tests (node --test over tools/test): 570 of 572 pass; the 2 fails were time limits under load (guards.test.mjs "under 2000 ms", run-plans-ask.test.mjs at 120 s), neither runs the supervisor; both files alone → pass 42, fail 0.
- Evidence: npm run build → exit 0; npm run lint → exit 0; npm test → exit 0; drift-check → KIT_DRIFT: ok, exit 0.
