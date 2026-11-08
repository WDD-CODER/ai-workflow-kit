# Plan 100 — A run survives its session: a supervisor relaunches a killed run and waits out a rate limit

Status: draft
Depends-on: 098, 099
Snapshot: 99037d4
Source: the stops audit of 16 FoodVibe runs (2026-10-27 → 2026-11-08, 36 stops), mapped in the chat session on 2026-11-08 (groups F and J). The Human took every recommendation on 2026-11-08. Reliability fix, allowed in the freeze; no new capability.

## Problem Statement
1. **The run is a child of a Claude Code session.** `/orchestrate` starts `run-plans.mjs` with the session's `run_in_background`. On 2026-11-08 the session's low-memory clean-up of background shells killed run-374b while plan 535 was building (audit #34): no stop was written, `status.json` stayed `building`, and the Human found it and relaunched 37 minutes later. The live chain seen the same day: `claude.exe → bash → bash → node run-plans.mjs`.
2. **Plan 098 relaunches once, from the session.** A relaunch driven by the session dies with the session, and one try is not enough on a machine that was short of memory for an hour.
3. **A second rate-limit hit stops the run** (`stopped: rate-limit`) for the Human to relaunch after the reset, although the relaunch is always the same command.
4. **A stop's cause can be overwritten.** In run-517 attempt 1 stopped, the note "slots given back when the run stopped" was written, but the cause was lost when the next attempt set `stopReason` (audit #23).
5. **Leftovers of dead runs stay** (merge folders of unmerged runs, a merge folder no longer a worktree, a builder slot left on a merged branch) until the Human deletes them.

## Goals & Success Criteria
**Primary:** once a run starts, the death of the session, the death of the run process or a rate limit never needs the Human; he is told only when the supervisor gives up.

- [auto] `node --test tools/test/run-supervisor.test.mjs` passes, with tests (fake `run-plans` child) that fail on today's code:
  (a) a child that exits with `status.json` still `running` and no stop is recorded as `stops[]` entry `process died (exit <code>)`, and the same command is launched again with the same run name; the relaunch's `DONE already (left out)` covers the merged plans;
  (b) at most `MAX_RELAUNCHES` (3, fixed in `run-supervisor.mjs`) relaunches after a death; the next death stops the run with `supervisor gave up after 3 relaunches: <last cause>`;
  (c) before a relaunch, free memory below `MIN_FREE_MEM_GB` (4, fixed in `run-supervisor.mjs`) makes the supervisor wait and re-check every 2 minutes, up to 60 minutes, then give up with `low memory: <n> GB free`;
  (d) a child that stops with `rate-limit` is relaunched after the reset time the error names, else after `orchestrator.rateLimitWaitMin`; rate-limit relaunches do not count against `maxRelaunches`, and the total wait is capped at 6 hours;
  (e) a child that ends `finished`, or `stopped` with any other reason, is not relaunched.
- [auto] `node --test tools/test/orchestrator.test.mjs` passes, with a test that fails today: `orch-state.mjs stop` appends `{ at, reason, attempt }` to `status.json` `stops[]` and never replaces an earlier entry; `stopReason` stays the latest for older readers; the report lists every stop.
- [auto] `node --test tools/test/run-supervisor.test.mjs` passes a test that the supervisor starts the child detached (its own process group, `windowsHide`, stdio to `.claude/orchestrator-runs/<run>.console.log` in append mode), and that the launching process can exit while the child keeps running.
- [auto] `.claude/commands/orchestrate.md` (installed copy) starts the run with `node scripts/run-supervisor.mjs --run <run> --plans <NNN,…>`, which prints `SUPERVISOR_STARTED <pid>` and returns at once; it names no `run_in_background` step and no relaunch step of its own (`grep -c "run_in_background" .claude/commands/orchestrate.md` = 0). `tools/install-check.mjs` l.1015–1017 today fails an `orchestrate.md` without `run_in_background` or without the line `node scripts/run-plans.mjs --run <run> --plans <NNN,NNN>`: those assertions change to the supervisor line in the same commit, and `node tools/install-check.mjs` passes. The command stays under install-check's 60-line limit (52 lines at bf8926e).
- [auto] At start, the supervisor runs the existing leftover sweep for runs that are not live (`orphan-sweep.mjs`, `prune-merged-worktrees.sh` or their script equivalents) and prints one line per folder or branch it removed or kept, with the reason; a folder named in a parked plan's hand-off or a `park/…` branch is always kept.
- [auto] The two limits are fixed in code, the way `BUILDER_IDLE_MIN` is (`run-plans.mjs` l.57–59): `export const MAX_RELAUNCHES = 3` and `export const MIN_FREE_MEM_GB = 4` in `run-supervisor.mjs`, with the test-only overrides `RUN_SUPERVISOR_MAX_RELAUNCHES` and `RUN_SUPERVISOR_MIN_FREE_MEM_GB`. `kit.config.json` gets no new orchestrator key (size budget `orchestratorKeys`: 15 of 15). A test asserts the scaffold has neither `maxRelaunches` nor `minFreeMemGb`, and `node --test tools/test/size-budget.test.mjs` passes. `docs/agent/orchestrator.md` describes the supervisor.
- [auto] `npm run build`, `npm run lint`, `npm test` and `node tools/drift-check.mjs --target .` pass (the builder runs the kit sync with apply first; it is a step, not a check).
- [human] On the installed project (Windows), start a run with `/orchestrate`, then close that Claude Code session: the run goes on (`watch` keeps showing progress) and ends with its report (reply `ok`).

## Execution Mode
- Parallel: no.
- Concurrent plans: none.
- Isolated DB: no.
- Run: `/orchestrate 100,101,102,103,104` on the kit, after the run of 095, 098, 099 is merged into `main`. The run merges into `orch/<run>`; `orch/<run>` merges into `main` only by a PR the Human approves (not pre-approved).
- Fallback: when the dry run says `WOULD START: no`, append one line with the date and the reason to `docs/brain/error-review.md` first, then build this plan by the solo flow (`feat/100-<slug>`, then `/ship`).

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspots `CHANGELOG.md` and `docs/brain/error-review.md`.

```scope
core/scripts/run-supervisor.mjs
scripts/run-supervisor.mjs
core/scripts/run-plans.mjs
scripts/run-plans.mjs
core/scripts/orch-state.mjs
scripts/orch-state.mjs
core/scripts/lib/orch-run.mjs
scripts/lib/orch-run.mjs
core/.claude/commands/orchestrate.md
.claude/commands/orchestrate.md
core/docs/agent/orchestrator.md
docs/agent/orchestrator.md
core/scripts/orphan-sweep.mjs
scripts/orphan-sweep.mjs
core/scripts/prune-merged-worktrees.sh
scripts/prune-merged-worktrees.sh
tools/install-check.mjs
tools/test/run-supervisor.test.mjs
tools/test/orchestrator.test.mjs
CHANGELOG.md
docs/brain/error-review.md
```

## Read Scope

Entire repo.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a step needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry.

## Architecture Impact
- INV-1: preserves — the supervisor only starts, watches and relaunches `run-plans.mjs`; it calls no model and decides nothing a plan's tiers decide.

## Step 0 — Reality Check
1. What 098 and 099 left in `core/.claude/commands/orchestrate.md` (checked at bf8926e): step 2 l.24–30 (start at once with `run_in_background`, the 4 GB free-memory rule l.27–28, the appended console log l.29–30), step 3 l.32–37 (098's relaunch once), step 4 l.44–45 (a rate-limit relaunch by hand). The supervisor replaces 098's relaunch-once step and writes the same console log 099 appends to; keep one writer.
2. On Windows, a `child_process.spawn(..., { detached: true, windowsHide: true, stdio: ['ignore', fd, fd] })` child followed by `unref()`: check that `taskkill /T /F /PID <launching shell>` does not kill it (Claude Code's clean-up kills a background shell's tree). If it does, launch through `powershell -NoProfile -Command Start-Process -WindowStyle Hidden …` and record which one passed in `docs/agent/orchestrator.md`.
3. How `run-plans.mjs` reports a rate limit (`modelCall` l.567–585: one wait of `RATE_LIMIT_WAIT_MIN` l.70, then `stopReason` `rate-limit: …`; `RUN_PLANS_JSON` l.839 adds `stopped: rate-limit`): whether the error text carries a reset time, and its format.
4. `orch-state.mjs stop` (l.1528–1535, it overwrites `stopReason`) and `finish`: where `stopReason` is written and deleted (l.428, l.743), and every reader of it (`watchLine`, the report, `/orchestrate` step 4), so `stops[]` is added without breaking them.
5. `lib/orch-run.mjs` `freeGb` (l.128) measures disk; free memory is `os.freemem()`. Name the one helper both the supervisor and 099's 4 GB rule use.
6. `orphan-sweep.mjs` and `prune-merged-worktrees.sh`: what they remove today, and that neither removes a folder or branch a live run or a parked plan holds.

## Atomic Sub-tasks
- [ ] S1: Write the failing tests first for death, the relaunch cap, low memory, rate limit and a normal end — cases (a)–(e) and the detached start — tools/test/run-supervisor.test.mjs
- [ ] S2: Write the failing test that a stop is added to the run's history, never written over — stops[] — tools/test/orchestrator.test.mjs
- [ ] S3: Keep every stop's cause — stop appends to stops[], the report lists them — core/scripts/orch-state.mjs, core/scripts/lib/orch-run.mjs
- [ ] S4: Add the supervisor that starts the run on its own and brings it back after a death or a rate limit — detached child, console log, relaunch rules — core/scripts/run-supervisor.mjs
- [ ] S5: Sweep what dead runs left before a run starts, and say what was kept — the existing sweep scripts, called from the supervisor; a sweep script changes only when Step 0 item 6 finds it removes a held folder or branch — core/scripts/run-supervisor.mjs, core/scripts/orphan-sweep.mjs, core/scripts/prune-merged-worktrees.sh
- [ ] S6: Fix the relaunch cap and the free-memory floor in code, with test-only overrides and no new setting — MAX_RELAUNCHES, MIN_FREE_MEM_GB — core/scripts/run-supervisor.mjs, tools/test/run-supervisor.test.mjs
- [ ] S7: Make /orchestrate start the supervisor and return, with no relaunch of its own — and move install-check's orchestrate.md assertions to the supervisor line — core/.claude/commands/orchestrate.md, core/docs/agent/orchestrator.md, tools/install-check.mjs
- [ ] S8: Resync the installed copies, run every check, add the changelog entry — CHANGELOG.md

## Technical Considerations
- A relaunch with the same run name is safe: git is the ledger, merged plans are left out (`docs/agent/orchestrator.md`, State rules).
- Before a relaunch the supervisor writes the death as a stop (`orch-state.mjs stop --reason "process died …"`), so slots are given back the way a normal stop gives them back.
- The supervisor's own death leaves the run process alive; `watch` still works because it reads `status.json` only.
- The supervisor writes a `supervisor.json` beside `status.json` (pid, attempts, waits) so `watch` and the report can show relaunches.

## Out of Scope
Resuming a parked plan from its saved commits (plan 102); environment repair inside a folder (plan 103); questions to the Human or the advisor (plan 104).

## Critical Questions
None open. (The Human took the recommendations on 2026-11-08: up to 3 relaunches per run, only with at least 4 GB free memory, waiting otherwise.)

## Execution Notes
