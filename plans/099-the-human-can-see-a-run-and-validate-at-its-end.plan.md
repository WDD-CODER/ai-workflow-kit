# Plan 099 — The Human can see a run and validate at its end

Status: draft
Depends-on: 098
Snapshot: 78cf1cec50085b1fd7b7dba3fd4ce9101cceabb4
Source: the first real orchestrator runs on an installed project, audited 2026-11-08 (`docs/brain/first-run-audit-2026-11-08.md`, Parts 3 and 4). The Human's brief of 2026-11-08, with the Planner's review answered `go`. Reliability fix, allowed in the freeze; no new capability.

## Problem Statement
1. **The run is invisible while it runs.**
   - `run-plans.mjs` writes no console log of its own; the one log that existed came from the caller's `>` redirect, and a relaunch overwrote it.
   - `status.json` has `models: {}` for every plan.
   - `orch-state.mjs watch` prints only `RUNNING` / `STUCK`, although stage, round, tier and the times are already in `status.json` and `calls.csv`.
2. **Validation is not part of the run's end.**
   - `/orchestrate` step 4 stops at the report. The agent then asked the Human to reply `cards`, and a dead frontend went unnoticed until the Human asked for the ports.
   - A second run started beside a running one on a machine short of memory.
3. **`decision-log.mjs grade` writes in the main folder** (`docs/brain/decision-grades.jsonl` on `main`); a commit had to be moved to the run branch by hand.
4. **Builders take the Human's `wt-N` slots** when `orchestrator.useSlots` is on (the default in `kit.config.json`): one slot sat on a plan branch during a run.

## Goals & Success Criteria
**Primary:** while a run runs, one command shows where each plan is and on which model; at its end the cards come with servers that answer, and nothing the run writes lands on `main` or in a Human's slot.

- [auto] `node --test tools/test/run-plans.test.mjs` passes, with tests that fail on today's code:
  (a) a run (fake claude) writes `.claude/orchestrator-runs/<run>.console.log`, and a second launch of the same run appends to it — the first launch's lines are still there;
  (b) after each model call `status.json` has `plans.<NNN>.models` with the stage, tier and model of that call (`builder`/`sonnet`, `reviewer`/`sonnet`, …).
- [auto] `node --test tools/test/orchestrator.test.mjs` passes, with tests that fail today:
  (c) `watch` prints one line per plan: state, round, tier and model, minutes since the last state change, and the plan's last `calls.csv` row;
  (d) with `orchestrator.useSlots` unset, `plan-info --with-worktree yes` never picks a `wt-N` slot; builder folders come from the run's own pool, at most `orchestrator.concurrency` folders at once.
- [auto] `node --test tools/test/decision-log.test.mjs` passes, with a test that fails today: `grade --run <run>` run in a folder on `main` writes nothing and exits 2 with a line naming the run branch's folder; given that folder, it writes there.
- [auto] `.claude/commands/orchestrate.md` (installed copy) says, at the run's end:
  - serve `orch/<run>` in an idle slot (`node scripts/slot-serve.mjs --ref orch/<run>`) when a card needs the app;
  - check that every card URL answers, before the cards and again when the Human replies;
  - print the cards without being asked;
  - start a second run beside a running one only when free memory is at least 4 GB.
  (`grep -c "4 GB" .claude/commands/orchestrate.md` ≥ 1.)
- [auto] `kit.config.json` has `"useSlots": false`; `docs/agent/orchestrator.md` describes the console log, the per-plan `watch` and the builder pool.
- [auto] `npm run build`, `npm run lint`, `npm test` and `node tools/drift-check.mjs --target .` pass (the builder runs `node tools/sync.mjs --target . --apply` first; it is a step, not a check).
- [human] After a kit release and `kit-sync` on the installed project, one `/orchestrate` run: `watch` shows each plan's stage and model while it runs, and at its end the cards arrive with every page answering, with no reply asked for first (reply `ok`).

## Execution Mode
- Parallel: no.
- Concurrent plans: none.
- Isolated DB: no.
- Run: in the same run as 095 and 098 (`/orchestrate 095,098,099`); merges pre-approved by the Human on 2026-11-08, `orch/<run>` into `main` by a PR after the final gate and the `[human]` cards.
- Fallback: when the dry run says `WOULD START: no`, append one line with the date and the reason to `docs/brain/error-review.md` first, then build this plan by the solo flow (`feat/099-<slug>`, then `/ship`).

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspots `CHANGELOG.md` and `docs/brain/error-review.md`.

```scope
core/scripts/run-plans.mjs
scripts/run-plans.mjs
core/scripts/orch-state.mjs
scripts/orch-state.mjs
core/scripts/lib/orch-run.mjs
scripts/lib/orch-run.mjs
core/scripts/decision-log.mjs
scripts/decision-log.mjs
core/.claude/commands/orchestrate.md
.claude/commands/orchestrate.md
core/docs/agent/orchestrator.md
docs/agent/orchestrator.md
kit.config.json
tools/test/run-plans.test.mjs
tools/test/orchestrator.test.mjs
tools/test/decision-log.test.mjs
CHANGELOG.md
docs/brain/error-review.md
```

Ten source files plus the two append-only logs; the other lines are the copies `sync` writes.

## Read Scope

Entire repo.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a step needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry.

## Architecture Impact
- INV-1: preserves — the console log, the model per call and `watch` read what the run already does; the builder pool changes where a builder's folder lives, not which tier builds.

## Step 0 — Reality Check
1. `run-plans.mjs`: where it prints (`RUN_PLANS:` lines) and `modelCall` (l.539) — one write path for the console log and the `models` entry.
2. `orch-state.mjs` `watch` (l.1463) and `lib/orch-run.mjs` `watchLine`: `watch` keeps its `ORCH_JSON` line and its exit codes; the per-plan lines come before it.
3. `orch-state.mjs` `plan-info` (l.829–843, `USE_SLOTS`, `listSlots`, the own folder): name the pool folder and how a finished plan frees its folder.
4. `decision-log.mjs grade` (l.506) and the `orch(<run>): decision grades` commit in `orch-state.mjs` (l.1395–1409): which folder `grade` must write in so that commit picks it up.
5. `lib/orch-run.mjs` `freeGb`: the 4 GB check uses it; say in `orchestrate.md` which command prints it.

## Atomic Sub-tasks
- [ ] S1: Write the failing tests first for the console log, the model per call, watch, the pool and the grade folder — cases (a)–(d) and the grade test — tools/test/run-plans.test.mjs, tools/test/orchestrator.test.mjs, tools/test/decision-log.test.mjs
- [ ] S2: Make the run keep its own log that a relaunch adds to instead of erasing — <run>.console.log, append — core/scripts/run-plans.mjs
- [ ] S3: Record which model every call ran on, so the status file says it — plans.NNN.models — core/scripts/run-plans.mjs
- [ ] S4: Let watch show each plan's stage, round, model, elapsed time and last call — per-plan lines before ORCH_JSON — core/scripts/orch-state.mjs, core/scripts/lib/orch-run.mjs
- [ ] S5: Give builders their own folders so the Human's slots stay free — pool of orchestrator.concurrency, useSlots false — core/scripts/orch-state.mjs, kit.config.json
- [ ] S6: Keep decision grades off main by writing them where the run branch is — grade refuses a main folder — core/scripts/decision-log.mjs
- [ ] S7: End a run with working pages and the cards, without being asked — serve, check URLs, print cards, 4 GB rule for a second run — core/.claude/commands/orchestrate.md, core/docs/agent/orchestrator.md
- [ ] S8: Resync the installed copies, run every check, add the changelog entry — CHANGELOG.md

## Technical Considerations
- The console log is appended per line as the run prints, so a killed run keeps everything up to the kill.
- Token counts during a call stay out (the audit: `spawnClaude` buffers stdout); `watch` shows the last finished call instead.
- `useSlots: false` changes the scaffold default only; a project that set `useSlots: true` keeps it, and the pool rule still caps the folders.

## Out of Scope
Streaming tokens during a call; the builder's live output; the four leftovers in `docs/brain/error-review.md`; everything in plan 098 (start without `start`, timeouts, parks, the dry run, the reviewer default).

## Critical Questions
None open. (Answered `go` on 2026-11-08: the builder pool's size is `orchestrator.concurrency`, 2 by default; the fallback is logged first in `docs/brain/error-review.md`.)

## Execution Notes
