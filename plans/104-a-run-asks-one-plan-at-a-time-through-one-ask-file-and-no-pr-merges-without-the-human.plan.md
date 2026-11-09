# Plan 104 — A run asks one plan at a time through one ask file, and no PR merges without the Human

Status: draft
Depends-on: 100, 102
Snapshot: 99037d4
Source: the stops audit of 16 FoodVibe runs, mapped on 2026-11-08 (the "tech" and "Human" rows, the questions the session asked, and PR #523). The Human took every recommendation on 2026-11-08. This plan prepares the place the advisor (decided 2026-11-01, built later) will answer. It adds no advisor. Reliability fix, allowed in the freeze.

## Problem Statement
1. **A question parks the plan, and the run forgets it.**
   - `replan needed`, `same reason twice`, `fix rounds used … — needs the Human`, `ESCALATE: db-write` and `review could not run` all park the plan.
   - The question lives only in a park reason. The Human answers in chat, the session or the Planner edits the plan, and a new run starts. The waits ran from 4 h (#19, #20) to never (#22: plan 513 still open).
2. **The session asks questions code or a technical judgment could answer.** Examples: "go / go 1-2" after failed cards, "open pr / wait", "how strong should the fix be", "restart?". Each one waits for the Human like a product question does.
3. **When the advisor arrives, it has nowhere to answer.** Today every question is free text in a chat.
4. **A PR was merged without the Human's approval.** PR #523 (gate timeout 15 → 45) broke the Human's standing rule, which today is enforced only by memory.

## Goals & Success Criteria
**Primary:** every question a run raises is one ask file for one plan. Only that plan waits; the run goes on with the rest. An answer resumes the plan in the same run. Each ask says whether only the Human may answer it, so the advisor later answers the others through the same file. No PR merges unless the Human confirms it in the Claude Code permission prompt.

- [auto] `node --test tools/test/run-plans-ask.test.mjs` passes, with tests (fake claude) that fail on today's code:
  (a) A builder `ESCALATE` or `planChange`, `same reason twice`, the fix rounds running out, or a review that could not run after one retry writes `.claude/orchestrator-runs/<run>/asks/<NNN>-<n>.json`. The file holds `{ id, plan, kind, question, options[], recommendation, humanOnly, context }`. The plan's state becomes `asking`, and other plans that don't depend on it or share its files go on;
  (b) `humanOnly` is true for kinds `data`, `privacy`, `product`, `design`, `production`, `spend`, `decision-stale` and `db-write`. It is false for `scope`, `technical`, `environment` and `review`. The builder agent's ESCALATE format names the kind, and an ESCALATE with no kind is `humanOnly: true`;
  (c) When every other plan of the run has ended, the run waits for answers, polling every 30 s for up to `ASK_WAIT_MIN` (180, fixed in `run-plans.mjs`). `watch` still shows `RUNNING`, with one line per open ask. After the wait, an unanswered plan is parked with its question in the report, as today;
  (d) `node scripts/orch-state.mjs answer --run <run> --id <id> --choice <n>` (or `--text "<answer>"`) writes `<id>.answer.json` with `by: human`. The plan resumes in the same run from its saved work (plan 102's resume), with the answer in the builder's prompt. An answer of kind `scope` that names paths adds them to the plan's scope on the run branch first;
  (e) An answer file with `by: advisor` on a `humanOnly` ask is refused with a run note, and the ask stays open.
- [auto] `node --test tools/test/orchestrator.test.mjs` passes, with a test that fails today: `watch` prints each open ask as one plain-text card. The card shows the question, the numbered options, the recommendation marked first, and the exact `answer` command to copy.
- [auto] `.claude/commands/orchestrate.md` (installed copy) tells the session to print every open ask card as soon as it appears, without waiting for the run's end. It also says the session never asks the Human a `humanOnly: false` question that the run's own recommendation already answers, unless the Human asked to be asked. The command stays under the 60-line limit `tools/install-check.mjs` l.1015 enforces, and `node tools/install-check.mjs` passes.
- [auto] `core/.claude/settings.json` `permissions.ask` holds `Bash(gh pr merge*)`, `Bash(git push origin main*)` and `Bash(git push * main*)`, so Claude Code asks the Human before any of them. `docs/agent/orchestrator.md` says three things. First, merging a plan into `orch/<run>` is the run's own step and is never asked. That includes a dependent plan starting after the plan it depends on is merged into `orch/<run>`. Second, the merge of `orch/<run>` into the project's `main` is the Human's. Third, no plan's Execution Mode may pre-approve that merge. A test checks that no rule in `permissions.ask` matches the run's own `git merge` / `git push origin orch/<run>` (the run calls git from the script, not through the Bash tool).
- [auto] The wait is fixed in code, the way `BUILDER_IDLE_MIN` is (`run-plans.mjs` l.57–59): `export const ASK_WAIT_MIN = 180` in `run-plans.mjs`, with the test-only overrides `RUN_PLANS_ASK_WAIT_MS` and `RUN_PLANS_ASK_POLL_MS`. `kit.config.json` gets no new orchestrator key (size budget `orchestratorKeys`: 15 of 15). A test asserts the scaffold has no `askWaitMin`, and `node --test tools/test/size-budget.test.mjs` passes.
- [auto] `core/.claude/agents/orch-builder.md` stays within its 120-line budget (113 lines at bf8926e): the ESCALATE kind adds at most 7 lines, or the kind list moves to `docs/agent/agent-roles.md` and the agent file names it.
- [auto] `npm run build`, `npm run lint`, `npm test` and `node tools/drift-check.mjs --target .` pass (the builder runs the kit sync with apply first; it is a step, not a check).
- [human] On the installed project, a run where one plan asks a scope question and another plan builds. The other plan merges while the first waits. Answer with the printed command, and the first plan resumes and merges in the same run (reply `ok`).

## Execution Mode
- Parallel: no.
- Concurrent plans: none.
- Isolated DB: no.
- Run: in the same run as 100–103. `orch/<run>` merges into `main` only by a PR the Human approves.
- Fallback: when the dry run says `WOULD START: no`, append one line with the date and the reason to `docs/brain/error-review.md` first, then build this plan by the solo flow (`feat/104-<slug>`, then `/ship`).

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspots `CHANGELOG.md` and `docs/brain/error-review.md`.

```scope
core/scripts/run-plans.mjs
scripts/run-plans.mjs
core/scripts/orch-state.mjs
scripts/orch-state.mjs
core/scripts/lib/orch-run.mjs
scripts/lib/orch-run.mjs
core/.claude/agents/orch-builder.md
.claude/agents/orch-builder.md
core/.claude/commands/orchestrate.md
.claude/commands/orchestrate.md
core/.claude/settings.json
.claude/settings.json
core/docs/agent/orchestrator.md
docs/agent/orchestrator.md
core/docs/agent/agent-roles.md
docs/agent/agent-roles.md
tools/test/run-plans-ask.test.mjs
tools/test/orchestrator.test.mjs
tools/test/lib/run-plans-fixture.mjs
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
- INV-1: preserves — a resumed plan keeps its tier. An answer does not reset the escalation, so a plan that was on the judgment tier stays on it.
- The two hard limits (`HARD_LIMITS` in `run-plans.mjs`) map to the `humanOnly` kinds `spend` and `production`. They are never answered by anyone but the Human.

## Step 0 — Reality Check
1. Every `park(` call in `run-plans.mjs` (15 at bf8926e; `HARD_LIMITS` is l.165) and its reason. List which ones become an ask (the kinds above) and which stay a park: a refused review, a pin failure, a worktree that cannot be made.
2. The builder agent's result contract (`orch-builder.md`, 113 of 120 lines; `parseResult` in `lib/claude-run.mjs` l.257; the scope test `isScopeEscalation` in `run-plans.mjs` l.401): where `ESCALATE`, `blocker` and `planChange` are read, and how a `kind` is added without breaking older answers.
3. The wave loop (`run-plans.mjs` l.763, `unitsOf`) and `afterPark` in `lib/run-order.mjs` l.79: an `asking` plan blocks exactly what a parked plan blocks, until it is answered.
4. Whether Claude Code applies `permissions.ask` in the permission modes the Human's sessions use, including auto mode and `--dangerously-skip-permissions`. If one mode skips it, add a `PreToolUse` hook in the same settings file that refuses the three commands unless the Human types `merge approved <pr>` in chat, and record which way was used.
5. Plan 102's resume entry point: the answer resumes through it, not a second path.

## Atomic Sub-tasks
- [x] S1: Write the failing tests first for writing an ask, Human-only kinds, waiting, answering and a refused advisor answer — cases (a)–(e) — tools/test/run-plans-ask.test.mjs
- [x] S2: Write the failing test that watch prints an open ask as a card with the command to answer it — tools/test/orchestrator.test.mjs
- [x] S3: Turn each question a run raises into one ask file that only its own plan waits on — core/scripts/run-plans.mjs, core/scripts/lib/orch-run.mjs
- [x] S4: Let the builder say what kind of question it has, within the agent file's line budget — the kind in ESCALATE — core/.claude/agents/orch-builder.md, core/docs/agent/agent-roles.md
- [x] S5: Add the answer command, and resume the plan in the same run — core/scripts/orch-state.mjs, core/scripts/run-plans.mjs
- [x] S6: Show open asks in watch, and tell the session to print them at once — core/scripts/orch-state.mjs, core/.claude/commands/orchestrate.md
- [x] S7: Make Claude Code ask the Human before any PR merge or push to main — core/.claude/settings.json, core/docs/agent/orchestrator.md
- [x] S8: Fix the answer wait in code with a test-only override, resync the installed copies, run every check, add the changelog entry — ASK_WAIT_MIN — core/scripts/run-plans.mjs, tools/test/run-plans-ask.test.mjs, CHANGELOG.md

## Technical Considerations
- The advisor will be one more writer of `<id>.answer.json` with `by: advisor`. Nothing in the run changes when it arrives.
- An ask's `context` holds what the asker needs to answer without opening the run: the failing check's tail, the files, the plan's goal line, and the builder's proposal.
- The session that prints the cards is still the Human's channel today. The cards are plain text, readable in the CLI, with one copy-ready answer command per card.

## Out of Scope
The advisor agent itself (decided 2026-11-01: after about a month of runs with the learning loop). Validation cards at the run's end (plan 099).

## Critical Questions
None open. (The Human took the recommendation on 2026-11-08: a question stops only its own plan, and the run goes on with the rest.)

## Execution Notes
- Step 0 (builder, on orch/run-100 at 8abf802): 1. 15 `park(` calls in run-plans.mjs. They become asks: scope ESCALATE (`replan needed`), judgment-tier `planChange`, `ESCALATE: db-write`, `same reason twice`, fix rounds used, a gate-mode review that could not run (after one new retry). They stay parks: worktree, `stopped:`, builder idle, both environment parks, a refused review, the pin failure, the merge environment failure, the hand-off file failure. 2. `ESCALATE`, `blocker` and `planChange` are read in run-plans.mjs right after `parseResult` (lib/claude-run.mjs, unchanged). A kind is added as an optional `ask` object or an `ESCALATE: <kind>` blocker prefix; an older answer without either still works (scope by text, else `unstated` = Human-only). 3. `unitsOf` plus `afterPark`/`blockedBy` decide what a park blocks; an asking plan uses the same `afterPark`, but its blocked plans are held instead of skipped. 4. The Claude Code docs (permission-modes.md: "doesn't auto-approve … in any mode, including `bypassPermissions` … Tools matched by an explicit ask rule"; auto mode: "Explicit ask rules still force a prompt") say `permissions.ask` prompts in every mode, so no PreToolUse hook is needed. In `claude -p` an ask rule has no one to answer and is denied. 5. Plan 102's entry point is `resumeOf`/`resumeKind` in run-plans.mjs (plus `plan-info --from-branch`); the answer resumes through it (`resumeKind({ answered: true })` → `park`).
- S1: tools/test/run-plans-ask.test.mjs covers cases (a)–(e) with a fake claude; it failed on the old code (`runPlans.builderAsk is not a function`, `undefined !== 180`). Result: see S8.
- S2: orchestrator.test.mjs `104 watch prints each open ask as one card` (red before: no card lines); plus the S7 rule-matching test and a `todo` test for settings.json (the Planner's half).
- S3: run-plans.mjs `ask()`/`writeAsk`/`builderAsk`/`askOptions`, the hold/release wave logic and `waitForAnswers`; lib/orch-run.mjs `HUMAN_ONLY_KINDS`, `OPEN_KINDS`, `humanOnlyAsk`, `askCard`, the `asking` state. The scenario run in run-plans-ask.test.mjs: 702 merged while 701 and 704 asked, and 703 was held.
- S5: `orch-state.mjs answer --run <run> --id <id> --choice <n> | --text "<answer>"` writes `<id>.answer.json` (by: human). Scenario run: 701 got a scope answer, its scope was extended on orch/asks, it resumed from park/asks-701 with ANSWER in its prompt and merged; then 703 and 704 merged.
- S6 (code half): `watch` prints one card per open ask and `asks[]` in ORCH_JSON. orchestrate.md is the Planner's.
- S7 (docs half): core/docs/agent/orchestrator.md `## Merges` makes the three statements. settings.json is the Planner's.
- S8: `export const ASK_WAIT_MIN = 180` plus the test-only overrides; no kit.config.json key, and a test checks the scaffold has none. Ran `node tools/sync.mjs --target . --apply`. Results: `npm run build` → 0; `npm run lint` → 0; `node --test tools/test/run-plans-ask.test.mjs` → pass 4, fail 0; `node --test tools/test/orchestrator.test.mjs` → 0 (pass 78, todo 1 = settings.json); `node --test tools/test/size-budget.test.mjs` → 0; `node tools/drift-check.mjs --target .` → 0 (KIT_DRIFT: ok); scope-check against origin/orch/run-100 → 0 (SCOPE: ok). The CHANGELOG has an entry. `npm test` (full) is left to the Planner. Existing tests run with RUN_PLANS_ASK_WAIT_MS=1: orchestrator-resume.test.mjs pass 4/4. run-plans.test.mjs was stopped early (slow machine); the runs it finished (main, gated, sens-a, sens-b) gave the states and reasons its assertions expect.
- 2026-11-09 Planner (solo goal; the run-100 run was stopped for low memory before this plan built): the `.claude/` half by hand, because an unattended builder is refused edits under `.claude/`. S4: orch-builder.md points at the ask format in agent-roles.md (115 of 120 lines). S6: orchestrate.md prints each ASK card as soon as it appears, with the answer line (57 of install-check's 60). S7: core/.claude/settings.json `permissions.ask` holds `Bash(gh pr merge*)`, `Bash(git push origin main*)`, `Bash(git push * main*)`; the S7 todo test now runs and passes.
- 2026-11-09 Planner: fresh review 1 (Opus) STOP — a park in a run's last wave was not kept as a root, so a plan an ask held could run when freed; fixed (every park is a root) with an end-to-end test (it also passes on the old code: a guard, not a reproduction). Review 2 STOP — the session's wait woke only at the run's end, so a card was never printed mid-run; fixed (the wait also wakes on a new ASK line). Review 3 PASS, with minors left: a free-text scope answer adds every path it names; a technical ask's retry option says "judgment-tier" but the resume keeps the stopped tier; onPark "all" is not applied to freed plans; an open ask is ended when the run stops, so a relaunch does not wait on it; the answer file is written without an atomic rename.
- 2026-11-09 Planner: checks after round 2, with RUN_PLANS_ASK_WAIT_MS=1 RUN_PLANS_ASK_POLL_MS=50 set in the shell: npm run build → 0; npm run lint → 0; node --test tools/test/run-plans-ask.test.mjs → 0; node --test tools/test/orchestrator.test.mjs → 0; node tools/install-check.mjs → 0; node --test tools/test/size-budget.test.mjs → 0; node tools/drift-check.mjs --target . → 0; scope-check → 0; node --test tools/test/orchestrator-resume.test.mjs → 0; node --test tools/test/run-supervisor.test.mjs → 0; node --test tools/test/run-plans.test.mjs → 0; npm test → 0.
- 2026-11-09 Planner: NOT merged yet — the shared fixture tools/test/lib/run-plans-fixture.mjs (outside the scope) needs `RUN_PLANS_ASK_WAIT_MS: '1', RUN_PLANS_ASK_POLL_MS: '50'`, or the run tests wait 180 min per ask in CI. Waiting for the Human's `approved: tools/test/lib/run-plans-fixture.mjs`.
