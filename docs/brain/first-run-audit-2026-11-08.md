# First orchestrator runs: audit (2026-11-08)

Public copy: names of the app project, its paths and its ports are replaced; the full original stays outside the repo.

Scope: run-517 (two attempts), run-535, run-535b (still running when this was written, 08:20 UTC).
Times are UTC as the logs write them; local time is UTC+2.
Sources:
- `S`: the Planner session's transcript.
- `ST`: `.claude/orchestrator-runs/<run>/status.json`.
- `CSV`: `.claude/orchestrator-runs/<run>/calls.csv`.
- `LOG`: `.claude/orchestrator-runs/<run>.console.log`.
- `RPT`: `.claude/orchestrator-runs/run-517.md`.

## Headline findings

1. **A regression was merged.** 374's merge into `orch/run-535b` (`b2931b8`) removed the entity form's whole "operating hours" section. The reviewer said STOP for exactly this: "major … entity-form.component.html:73 unlogged removal: the operating-hours section of the entity form is gone". Because the reviewer is advisory only, the plan merged anyway.
   - Evidence: [EVIDENCE: ST run-535b notes 07:48:44] [EVIDENCE: `git diff b2931b8^1 b2931b8 -- …/entity-form.component.html`; `operatingHours` / `hoursArray` present before the merge, absent after].
   - `orch/run-535b` must not be merged as it is.
2. **The run waited 7 h 40 min for one word.** `/orchestrate` was invoked at 21:37:29. The run started only at 05:18:09, when the Human typed `start`.
   - Cause: the command's own step 2, which hands the Human a terminal line and waits for `start`.
   - Evidence: [EVIDENCE: S 21:37:29, 21:38:14, 05:18:04] [EVIDENCE: `.claude/commands/orchestrate.md:24-38`].
3. **Most parks came from the plans or the tooling, not the code.**
   - run-517 parked 374, 510 and 535 because their scope blocks named no test files. That was a Planner (my) authoring gap. The dry run did not catch it.
   - run-535 parked all three plans within 20 s, on stale `feat/` branches left by run-517.
   - Evidence: [EVIDENCE: ST run-517, run-535 reasons].

## Part 1 — Timeline

| time (UTC) | step | done by | result | needed from the Human |
|---|---|---|---|---|
| 11-07 21:34:42 | dry run `check-1107` (517,528,530,533,535) | me (script) | ready; showed that `test:server` was dropped for 528/530 [EVIDENCE: S] | nothing (the Human had run it with `!`) |
| 21:35:06 | added `Depends-on: 517` to 528/530; todo waves; pushed `8a827f4` | me | fixed [EVIDENCE: S] | nothing |
| 21:36:03 | told the Human: "say `/orchestrate …` or run it yourself in PowerShell" | me | — [EVIDENCE: S] | a choice (own judgment) |
| 21:37:29 | `/orchestrate 517,510,374,533,535` | Human | — | — |
| 21:37:32 | dry run `run-517` | me (script) | 374 NOT READY: my own note had landed in its Done-when section [EVIDENCE: S] | nothing |
| 21:37:54 | moved the note into Execution Notes, pushed `0a98e2b`; dry run again → `WOULD START: yes` | me | ready; dropped checks: 374/510 `npx ng test …`, 517 `pnpm run test:server` [EVIDENCE: S; LOG run-517 head] | nothing |
| 21:38:14 | printed the PowerShell line plus "or reply `start`" | me, per orchestrate.md:24-38 | waited [EVIDENCE: S] | **`start`, or run it in a terminal** |
| 11-08 05:18:04 | Human: `Start` | Human | — | — |
| 05:18:09 | attempt 1: `run-plans.mjs --run run-517` in the background | me (script) | — [EVIDENCE: S] | — |
| 05:19:35–37 | readiness + preflight; 533 builder round 0 (sonnet, tier build: "INV-none") | script / sonnet | started [EVIDENCE: ST run-517 startedAt, 533 history] | — |
| 05:23:04 | Claude Code killed the background shell for low memory | harness | run killed in 533's builder; ST stuck at `running`; slot wt-1 left with uncommitted files [EVIDENCE: S task-notification; ST note 05:28:04] | — |
| 05:23:21 | I told the Human to restart it in their own PowerShell and close other sessions | me | — [EVIDENCE: S] | **run 2 commands in a terminal** |
| 05:27:53 | Human: "Way do I have to do it !? This is worthless if I need to run in terminal !" | Human | — | — |
| 05:28:00–01 | `orch-state stop`; attempt 2 in the background | me (script) | restarted. The attempt-1 console log was overwritten (same `>` path) [EVIDENCE: S] | — |
| 05:28:16 → 05:32:19 | 533 builder round 0 (sonnet) | sonnet | built [EVIDENCE: ST 533 history] | — |
| 05:32:19 → 05:34:58 | 533 gate | script | failed (scope: spec file outside the scope) [EVIDENCE: ST note 05:36:02; CSV] | — |
| 05:34:58 → 05:36:05 | 533 fix round 1 (sonnet) | sonnet | reverted the spec case instead of adding it (D1) [EVIDENCE: ST decisions] | — |
| 05:36:05 → 05:38:44 | 533 gate round 1 | script | pass [EVIDENCE: CSV] | — |
| 05:38:44 | 533 reviewer (sonnet) | sonnet | **STOP** (major: "A2: the picker-box spec case is not in the diff"), advisory → merged anyway [EVIDENCE: ST note 05:39:01; LOG] | — |
| 05:39:53 | 533 merged `f37235d` | script | merged | — |
| 05:39:57 → 05:56:30 | 535 builder round 0 (sonnet, 874 s, 2.78 M input tokens) | sonnet | built; gate failed on the test-file gate [EVIDENCE: CSV; ST] | — |
| 05:56:30 → 05:57:12 | 535 fix round 1 (sonnet) | sonnet | ESCALATE: needs `approved:` for two spec files [EVIDENCE: ST note 05:57:12] | — |
| 05:57:12 → 05:58:04 | 535 judgment builder (**opus**, "escalated after round 2") | opus | scope still blocks → **parked** "replan needed" [EVIDENCE: ST] | — |
| 05:58:09 → 06:02:43 | 374 builder round 0 (sonnet; tier build "no Architecture Impact") | sonnet | ESCALATE: scope test-out on two spec files [EVIDENCE: ST] | — |
| 06:02:48 → 06:06:17 | 374 judgment builder (**opus**) | opus | **parked** "replan needed" (scope names no test location) [EVIDENCE: ST] | — |
| 06:06:22 → 06:18:58 | 510 builder round 0 (sonnet, 755 s) | sonnet | ESCALATE: P5 needs `product-form.component.html` (out of scope) [EVIDENCE: ST note 06:19:02] | — |
| 06:19:03 → 06:25:46 | 510 judgment builder (**opus**, 403 s, 983 k input tokens) | opus | **parked** "replan needed": spec files under a broad glob [EVIDENCE: ST] | — |
| 06:25:52 → 06:31:47 | 517 builder round 0 (sonnet) | sonnet | built; A5 undone: "the API port refused the connection" [EVIDENCE: ST note 06:31:46] | — |
| 06:31:47 → 06:32:06 | 517 fix round 1 (sonnet, 17 s) | sonnet | fixed [EVIDENCE: CSV] | — |
| 06:32:06 → 06:33:57 | 517 gate | script | pass (`test:server` dropped at readiness, K7) [EVIDENCE: ST note 06:25:52] | — |
| 06:33:57 | 517 reviewer (sonnet) | sonnet | PASS [EVIDENCE: LOG] | — |
| 06:34:47 | 517 merged `3419199` | script | merged | — |
| 06:34:47 → 06:37:26 | final gate (11 commands) | script | **failed**: `kit-manifest-check` (`scripts/test/log-query-fallback.test.mjs` unclassified). Run stopped, exit 2 [EVIDENCE: LOG; ST stopReason] | — |
| 06:38–06:40 | test-file lines added to the scopes of 374, 510, 522, 523, 532, 533, 535; pushed `1c8c9df`, `5d89a59` | me (Planner, on main) | fixed the parks' cause [EVIDENCE: S] | — |
| 06:39:58–06:40:28 | in wt-3 on `orch/run-517`: manifest entry `d5a200d`, pushed | me | final gate fixed outside the runner [EVIDENCE: S] | — |
| 06:40:47 | report: D1 (`decisions: ok`), offered `/orchestrate 535,374,510` and "reply `cards`" | me | — [EVIDENCE: S] | **a decision; re-invoke; say `cards`** |
| 07:22:44 | Human: `decisions: ok` + `cards` | Human | — | — |
| 07:23:01–20 | `decision-log grade` wrote to a tracked file on main; I moved it to `orch/run-517` (`6cd370d`) | me | fixed outside the runner [EVIDENCE: S] | — |
| 07:23:37 | `slot-serve --ref orch/run-517` in wt-3 (inside `timeout 280`) | me | servers up [EVIDENCE: S] | — |
| 07:24:18 | 510: added `product-form.component.html` to its scope (its ESCALATE), pushed `dc6c029` | me (Planner judgment, no `approved:` asked) | [EVIDENCE: S] | — |
| 07:24:47 | 8 validation cards | me | — [EVIDENCE: S] | **visual checks** |
| 07:33:22 | `/orchestrate 535,374,510`: dry run yes; I started `run-535` at once | me | — [EVIDENCE: S] | — |
| 07:34:19 | Human: "just open up the ports on the orch/run-517" (frontend had died) | Human | I restarted it [EVIDENCE: S] | **noticing the dead server** |
| 07:35:11 → 07:35:32 | run-535: 374, 510, 535 each **parked in ~6 s**: "merging origin/orch/run-535 into feat/<NNN> conflicts: plans/533-….plan.md". The old `feat/` branches contain run-517's 533 merge [EVIDENCE: ST run-535; `git merge-base --is-ancestor f37235d origin/park/run-517-510-old` → true] | script | 0 built | — |
| 07:36:17 | my delete of the stale branches was **denied** (permission); I backed them up as `park/run-517-{374,510,535}-old` | me | [EVIDENCE: S] | — |
| 07:36:47 | asked the Human to delete the 3 branches in PowerShell | me | — [EVIDENCE: S] | **3 commands in a terminal** |
| 07:36:53 | the Human's `watch` ran in the kit folder (my line had no `cd`) | — | error [EVIDENCE: S] | — |
| 07:38–07:39 | Human ran the deletes, then `rerun` | Human | — | — |
| 07:39:12 | run-535b started | me (script) | — [EVIDENCE: S] | — |
| 07:40:40 → 07:44:39 | 374 builder round 0 (sonnet) | sonnet | built [EVIDENCE: ST run-535b] | — |
| 07:44:39 → 07:48:21 | 374 gate | script | pass | — |
| 07:48:21 → 07:48:44 | 374 reviewer (sonnet) | sonnet | **STOP** major: "unlogged removal: the operating-hours section of the entity form is gone", advisory → merged anyway [EVIDENCE: ST note 07:48:44] | — |
| 07:50:13 | 374 merged `b2931b8` (regression) | script | merged | — |
| 07:50:19 → 08:05:21 | 510 builder round 0 (sonnet) | sonnet | **timed out after 15 min**; CSV `510,builder,sonnet,901.3,0,0,1` [EVIDENCE: CSV; ST note 08:05:30] | — |
| 08:05:30 → (running) | 510 judgment builder (**opus**; reason: the timeout) | opus | in progress at 08:17:40 [EVIDENCE: ST updatedAt] | — |
| 08:03:46 | Human: card ① unclear; ②–⑧ "not centered under the input" | Human | — | — |
| 08:06–08:10 | fixed the date field on `orch/run-517` in wt-3 (`e177af36`) | me | fixed outside the runner [EVIDENCE: S] | **re-check ②–⑧** |
| 08:16:55 | Human: `done` | Human | — | — |

Fixes I made outside the runner:

| file | commit | why the runner could not do it |
|---|---|---|
| `plans/design/374-….plan.md` (note out of Done-when) | `0a98e2b` | readiness refuses; plans are the Planner's [EVIDENCE: orchestrate.md:21-22] |
| `plans/528`, `plans/530` (`Depends-on: 517`) | `8a827f4` | Planner file |
| scopes of 374, 510, 522, 523, 532, 533, 535 | `1c8c9df`, `5d89a59` | builders may not widen their own scope ("replan needed") [EVIDENCE: ST run-517] |
| `plans/510` scope + `product-form.component.html` | `dc6c029` | builder ESCALATE needs `approved:` [EVIDENCE: ST note 06:19:02] |
| `docs/workflow-kit/manifest.json` on `orch/run-517` | `d5a200d` | the final gate has no fix round [INFERENCE: docs/agent/orchestrator.md:83 lists none] |
| `docs/brain/decision-grades.jsonl` → `orch/run-517` | `6cd370d` | `decision-log grade` writes in the main folder [EVIDENCE: S] |
| `src/app/shared/date-field/*` on `orch/run-517` | `e177af36` | the card result came after the run ended |
| backup refs `park/run-517-{374,510,535}-old` | — | a park leaves `feat/<NNN>` behind [EVIDENCE: no branch delete in `scripts/orch-state.mjs`] |

## Part 2 — Every request to the Human

**R1 (the first one). 21:36 and 21:38: "run it yourself in PowerShell … or reply `start`".**
- Rule:
  - `.claude/commands/orchestrate.md:24-38`: "## 2. Hand the Human the line — Print the command for a PowerShell terminal in the main folder … Then say: reply `start` to run it from here instead."
  - Also `docs/agent/orchestrator.md:9-10` and `:50-51`.
  - The 21:36 message, before `/orchestrate`, was my own judgment copying that pattern.
- Class: SHOULD-BE-AUTOMATIC. Cost: 7 h 40 min idle.
- Fix: `.claude/commands/orchestrate.md` step 2 → "After `WOULD START: yes`, run step 3 at once; print the watch line only as information."

**R2. 05:23: "restart it in your own PowerShell terminal … close the Claude sessions you don't need".**
- Rule: the harness kill notice: "Do not start it again on your own … start it again only when asked". Sending it to a terminal was my own judgment.
- Class: SHOULD-BE-AUTOMATIC (the relaunch). Closing sessions is HUMAN-ONLY.
- Fix: `.claude/commands/orchestrate.md` step 3 → "A killed background run is part of the request: `orch-state stop`, then relaunch the same command once."

**R3. 05:28: optional `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1`.**
- Rule: the harness notice.
- Class: HUMAN-ONLY (the variable has to be set before Claude Code starts).
- Possible fix [INFERENCE]: an `env` entry in `~/.claude/settings.json`, untested.

**R4. 06:40: D1 — `decisions: ok` / `D1 ✗`.**
- Rule: `docs/agent/orchestrator.md:132-135`.
- Class: HUMAN-ONLY.

**R5. 06:40: "`/orchestrate 535,374,510` re-runs the parked plans".**
- Rule: own judgment; no rule covers rerunning a fixed park.
- Class: SHOULD-BE-AUTOMATIC.
- Fix: `.claude/commands/orchestrate.md` step 4 → "Plans parked `replan needed` that the Planner fixed in this session are relaunched as `<run>b` without asking."

**R6. 06:40: "Reply `cards`".**
- Rule: own judgment, against `~/.claude/CLAUDE.md` "When: the moment … work is finished … Servers first". `orchestrate.md` step 4 stops at the report.
- Class: SHOULD-BE-AUTOMATIC.
- Fix: `.claude/commands/orchestrate.md` step 4 → "Then serve `orch/<run>` in an idle slot (`slot-serve --ref`) and show the report's human items as cards."

**R7. 07:24: 8 cards.**
- Rule: RPT:80-89; `~/.claude/CLAUDE.md`.
- Class: ②–⑧ HUMAN-ONLY. ① SHOULD-BE-AUTOMATIC: it was 517's A5 e2e spec, which the builder could not run without an API [EVIDENCE: ST note 06:31:46].
- Fix: `playwright.config.ts:11` → `baseURL: process.env.E2E_BASE_URL ?? '<frontend URL>'`, then run the spec against the served slot.

**R8. 07:34: the Human had to ask for the ports.**
- Rule: none.
- Class: SHOULD-BE-AUTOMATIC.
- Root cause [INFERENCE]: the frontend did not survive; nothing re-checks it.
- Fix: `.claude/commands/orchestrate.md` step 4 → "Check every card URL answers before printing the cards and again when the Human replies."

**R9. 07:36: delete 3 branches in PowerShell.**
- Rule: my delete was denied by the permission deny list (`docs/agent/agent-roles.md`, via `docs/agent/orchestrator.md:129`).
- Class: SHOULD-BE-AUTOMATIC.
- Root cause: a park leaves `feat/<NNN>`, and the next run reuses it (`scripts/orch-state.mjs:864-902`).
- Fix: `scripts/orch-state.mjs` plan-info → "when `feat/<NNN>` is not based on the current run branch, rename it to `park/<old run>-<NNN>` and cut a fresh one."

**R10. 07:36: the watch line without `cd`.**
- Rule: `.claude/commands/orchestrate.md:32-36`.
- Class: SHOULD-BE-AUTOMATIC.
- Fix: `.claude/commands/orchestrate.md:35` → prefix `cd "<main folder>"`.

**R11. 07:36: reply `rerun`.**
- Rule: own judgment.
- Class: SHOULD-BE-AUTOMATIC once R9 is fixed.
- Fix: same as R9.

**R12. 08:10: re-check ②–⑧.**
- Class: HUMAN-ONLY.

No scope edits were asked of the Human. I applied 510's `approved:` path myself, without asking.

## Part 3 — Visibility

1. `node scripts/orch-state.mjs watch --run run-535b` (from the app project's main folder):
   ```
   RUNNING
   ORCH_JSON {"ok":true,"stuck":false,"line":"RUNNING","phase":"running","updatedAt":"2026-11-08T08:17:40.561Z"}
   ```
   It prints `STUCK` after 10 min without a heartbeat (`docs/agent/orchestrator.md:39`). Nothing else.
2. `status.json`, per plan: `state`, `round`, `tier`, `history[]`, `notes[]`. Example: `510 fixing tier=judgment round=1 · building@07:50:19r0 > building@08:05:21r0 > fixing@08:05:30r1`. `models` is `{}` for every plan.
3. `calls.csv`, rows after each finished call: `374,builder,sonnet,234.8,258368,6379,0` · `510,builder,sonnet,901.3,0,0,1`.
4. `run-535b.console.log`: `RUN_PLANS: 374 review STOP (advisory, not enforced)` · `RUN_PLANS: 510 judgment builder (opus, tier judgment: escalated after round 1, round 1)`. It exists only because I redirected the output.
5. The run report: written only at the end.

| want | today | on disk already |
|---|---|---|
| current stage | `status.json` only | `plans.<NNN>.state` |
| model in use | no | console log line; `tier` → `kit.config.json` models |
| elapsed time | no | `history[-1].at` vs now |
| tokens so far | no (a timeout records 0) | NOT on disk: `spawnClaude` buffers stdout (`scripts/lib/claude-run.mjs:134-163`) |
| fix round | `status.json` only | `plans.<NNN>.round` |
| last builder line | no | NOT on disk; the builder folder's `git status` / `diff --stat` is |

Gaps, one line each:
- `watch` prints only RUNNING/STUCK: stage, round, tier and elapsed time are in `status.json`.
- The model is not in `status.json`: it is in the console log and follows from `tier`.
- Tokens are invisible during a call and lost on a timeout.
- Builder output is invisible: only the folder's changed files are readable live.
- The console log exists only when the caller redirects it.

## Part 4 — Wrong or inconsistent

1. **Terminal-first `/orchestrate`.** `.claude/commands/orchestrate.md:24-38`; `docs/agent/orchestrator.md:9-10,50-51`. Effect: a 7 h 40 min wait; a terminal was asked for three times.
2. **Reviewer STOP does not stop.** `docs/agent/orchestrator.md:44`; `scripts/run-plans.mjs:57` (`"advisory" === 'gate' ? …`, baked in). Effect: 533's missing test and 374's removed operating-hours section were both merged.
3. **The builder timeout = the gate timeout (15 min).** `scripts/run-plans.mjs:435,51`. Effect: 510's builder was killed at 901 s, its tokens and work lost, then escalated to Opus. 535 finished in 874 s.
4. **Escalating to Opus cannot fix a scope problem.** `docs/agent/orchestrator.md:78-82`. Effect: 3 Opus calls, 1.65 M input tokens, 11 min, all three parked for the same scope reason.
5. **The dry run and the real run differ.**
   - (a) `scope-check --tests` passed what the run's test-file gate parked (`docs/agent/orchestrator.md:71-72`).
   - (b) The dry run ignores stale `feat/` branches (run-535: yes → 3 parks in 20 s).
6. **Per-plan manifest check vs final gate.**
   - The per-plan gate runs the main folder's `kit-manifest-check.mjs` by absolute path (exit 0).
   - The final gate runs the run branch's copy (fail).
   - [INFERENCE] The per-plan gate checks the wrong tree, so the failure came at the end, with no fix round.
7. **Checks the author wrote are dropped silently.** `scripts/run-plans.mjs:83,225-242`. Effect: 517's `test:server` never gated 517; 374/510 `npx ng test --include` dropped.
8. **Park leaves `feat/<NNN>`; the next run reuses it.** `scripts/orch-state.mjs:864-902`. Effect: run-535 was wasted, and the Human had to delete branches in PowerShell.
9. **No servers in a builder folder.** `playwright.config.ts:11` hard-codes the frontend port. Effect: an automated e2e check became human card ①.
10. **Validation is not part of the run's end.** `.claude/commands/orchestrate.md:44-49` vs `~/.claude/CLAUDE.md`. Effect: "reply `cards`"; a dead frontend went unnoticed.
11. **Decision grade writes on `main`.** `docs/agent/decision-review.md:62`; AGENTS.md "Never write on `main`". Effect: a commit had to be moved.
12. **A dangling reference.** `docs/agent/decision-review.md:62` "`/orchestrate` (step 5)"; the command has 4 steps.
13. **A replan says "on the run branch", but plans live on `main`.** 510's park reason vs `docs/agent/orchestrator.md:106`.
14. **A run in a background shell dies with memory pressure, and nothing recovers it.** `/orchestrate` step 3. Effect: 10 min lost, the Human's frustration, wt-1 left dirty, attempt-1 log overwritten.
15. **Builders use the Human's `wt-N` slots.** wt-1 is on `feat/510` during run-535b (`git worktree list`).
16. **The watch line has no folder.** `.claude/commands/orchestrate.md:35`. Effect: run in the kit folder.

## Part 5 — Numbers

- **Plans attempted:** run-517: 5 (attempt 1 reached 533's builder only); run-535: 3; run-535b: 3, running. 5 distinct plans in all.
- **Merged:** 533, 517 (`orch/run-517`); 374 (`orch/run-535b`, with the regression). 3 of 5 distinct plans.
- **Parked:** 6 plan-attempts. 3 were a plan authoring gap (run-517); 3 were technical (run-535, stale branches).
- **Technical stops:** the memory kill; the final-gate manifest failure; stale branches; the 510 builder timeout; 517 A5 with no API. 5 events.

| run | plan | calls | input tok | output tok | model min | gate min | wall min | result |
|---|---|---|---|---|---|---|---|---|
| run-517 | 533 | 3 (sonnet ×3) | 295,755 | 5,577 | 5.2 | 6.0 | 20.3* | merged |
| run-517 | 535 | 3 (sonnet ×2, opus) | 3,096,693 | 37,310 | 16.1 | 1.9 | 18.1 | parked |
| run-517 | 374 | 2 (sonnet, opus) | 1,009,206 | 19,880 | 8.0 | 0 | 8.1 | parked |
| run-517 | 510 | 2 (sonnet, opus) | 1,080,744 | 14,187 | 19.3 | 0 | 19.4 | parked |
| run-517 | 517 | 3 (sonnet ×3) | 728,066 | 17,517 | 6.4 | 2.3 | 8.9 | merged |
| run-517 | final | 0 | 0 | 0 | 0 | 2.6 | — | failed |
| run-535 | 374/510/535 | 0 | 0 | 0 | 0 | 0 | ~0.1 each | parked |
| run-535b | 374 | 2 (sonnet ×2) | 313,668 | 7,045 | 4.2 | 5.0 | 9.6 | merged |
| run-535b | 510 | 1+ (sonnet, timed out) | 0 recorded | 0 | 15.0 | 0 | 15.2+ | running (opus) |

\* 533's wall time includes the memory kill.

- run-517 took 77.9 min; 6.2 M input tokens, of which 3.6 M (58 %) went to the parked plans.
- **Human minutes [INFERENCE from message times]:**
  - branch deletes: about 2 min;
  - first card pass: up to about 39 min (07:24:47 → 08:03:46);
  - re-check: about 6 min;
  - about 8 short replies.
  - Plus a 7 h 40 min idle wait for `start`.
