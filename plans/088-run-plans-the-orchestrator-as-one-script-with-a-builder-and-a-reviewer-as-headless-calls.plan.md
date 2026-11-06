# Plan 088 — run-plans.mjs: the orchestrator as one script, with a builder and a reviewer as headless calls

Status: draft
Depends-on: 086, 087
Snapshot: fd212e119ef16c0b26ebfaf6b44f450fee26d8f5
Source: kit audit 2026-11-06, plan B. Supersedes plan 085 (its merge pin is M4 here).

## Problem Statement
`core/.claude/workflows/orchestrate.js` runs on a workflow runtime that has no file, git or clock access (its own header, lines 13–16; `docs/agent/orchestrator.md` "Runner calls": "No call is script-only yet"). Every state write, note, diff, preflight and merge is therefore a `kit-runner` model call on Haiku, which re-types commands, mis-copies JSON and sometimes refuses a state write. Measured: run-065 — 39 agent calls, 633k tokens, 74 minutes, stuck at merge; run-513-516c — 51 calls, 755k tokens, 1 of 2 plans merged. The sources (Anthropic: simple composable patterns; Applied LLMs: deterministic code over LLM prompts, workflows over agents) and the kit's own 2026-11-05 decision point one way: the loop is code; only the builder and the reviewer are models. The kit already runs Claude headlessly this way (`tools/lib/agent-eval/run.mjs`: `claude -p --output-format json --system-prompt-file`; plan 035: with `--setting-sources local --strict-mcp-config --disable-slash-commands --no-session-persistence` a call loads ~2k tokens of context instead of ~40k).

## Goals & Success Criteria
**Primary:** `node scripts/run-plans.mjs --run <name> --plans 451,452,453` builds, gates, reviews and merges plans into `orch/<run>` with at most two model calls per plan plus one fix round, every other step in code, and continues past a parked plan.

- [auto] `node --test tools/test/run-plans.test.mjs` passes, with a fake `claude` runner (injected like `--runner` in agent-eval) and a fixture repo: (a) a plan whose fake builder returns a passing diff is gated, reviewed `PASS`, merged into `orch/<run>` with `--no-ff`, and its merge commit's second parent equals the sha the gate and the reviewer saw (`checkedHead`); (b) a plan whose gate fails once and passes after one fix round merges with exactly 3 model calls recorded (`builder`, `builder fix`, `reviewer`); (c) a plan whose gate fails twice is parked by `plan-park.mjs`, the run continues with the next plan that does not depend on it or share its files, and a dependent plan is `skipped` with the reason; (d) a reviewer `STOP` parks after one fix round; (e) a plan whose branch moved between the review and the merge is refused with both shas and parked (the 085 pin); (f) a plan with `A: open` in `## Critical Questions` is refused before any build with the question printed; (g) the fake runner returning a rate-limit error pauses the run, retries once after `rateLimitWaitMin`, then parks the run with that reason; (h) `status.json` holds for every plan `state`, `checkedHead`, `calls[]` (stage, model, seconds, tokens), and the report is written by `orch-state.mjs finish` unchanged.
- [auto] `node --test tools/test/orchestrator-merge-only.test.mjs` passes with `merge-verify` (`HEAD^2 == checkedHead`, refusal resets the merge folder to `HEAD^`) implemented in `orch-state.mjs` as plan 085 M1 specified.
- [auto] `node scripts/run-plans.mjs --dry-run --plans 086,087` prints the waves, each plan's readiness lint (`scope-check --deps`, `--arch`, `--tags`, `check-files`, npx-to-script mapping, preflight result) and the commands it would run, and calls no model (the fake runner records zero calls).
- [auto] Every `claude -p` call passes `--setting-sources local --strict-mcp-config --disable-slash-commands --no-session-persistence --output-format json`, `--model` from the tier, `--system-prompt-file` with the agent body, `--tools`/`--disallowedTools` from the agent's front matter; the builder runs with cwd = its worktree; the reviewer with cwd = the review worktree and no write tool (`tools/test/run-plans.test.mjs` asserts the argv).
- [auto] `node scripts/run-plans.mjs --run <name> --plans <n> --concurrency 2` runs two builders of the same wave in two slots; default `--concurrency 1`.
- [auto] `node scripts/orch-state.mjs watch --run <run>` works unchanged on a run the script wrote.
- [auto] `.claude/orchestrator-runs/<run>/calls.csv` exists after a run: `plan,stage,model,seconds,input_tokens,output_tokens,exit` one row per model call and per gate command.
- [auto] `/orchestrate` (the command file) is under 60 lines: it validates the plan list, prints the exact PowerShell line to run `run-plans.mjs` in a terminal, starts it with `run_in_background` when the Human says `start`, and prints the result from `status.json`; it starts no workflow.
- [auto] `npm run build`, `npm run lint`, `npm test`, `node tools/orchestrator-e2e.mjs` (rewritten to drive `run-plans.mjs`) and `node --test "tools/test/*.test.mjs"` pass; sync then drift-check report no drift.
- [human] In this goal run: `node scripts/run-plans.mjs --dry-run --run goal-check --plans 089` prints 089's wave, readiness lint and commands and calls no model (Human 2026-11-06: dry-run only now). After the goal: one real run on the next small kit plan, `node scripts/run-plans.mjs --run goal-check --plans <that plan>`: it ends merged into `orch/goal-check` or parked with a readable reason, `calls.csv` shows ≤ 3 model calls for the plan, and `node scripts/orch-state.mjs watch --run goal-check` printed `RUNNING` while it ran.

## Execution Mode
- Parallel: no.
- Concurrent plans: none; needs 086 (redacted plan, `plan-park.mjs`, `--reset-base`) and 087 (`plan-reviewer.md` + its model line) merged.
- Isolated DB: no.

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspot `CHANGELOG.md`.

```scope
core/scripts/run-plans.mjs
scripts/run-plans.mjs
core/scripts/lib/claude-run.mjs
scripts/lib/claude-run.mjs
core/scripts/lib/plan-gate.mjs
scripts/lib/plan-gate.mjs
core/scripts/lib/plan-review.mjs
scripts/lib/plan-review.mjs
core/scripts/lib/plan-merge.mjs
scripts/lib/plan-merge.mjs
core/scripts/lib/run-order.mjs
scripts/lib/run-order.mjs
core/scripts/orch-state.mjs
scripts/orch-state.mjs
core/scripts/lib/orch-run.mjs
scripts/lib/orch-run.mjs
core/scripts/orch-preflight.mjs
scripts/orch-preflight.mjs
core/scripts/plan-park.mjs
scripts/plan-park.mjs
core/.claude/commands/orchestrate.md
.claude/commands/orchestrate.md
core/.claude/agents/orch-builder.md
.claude/agents/orch-builder.md
core/.claude/agents/plan-reviewer.md
.claude/agents/plan-reviewer.md
core/docs/agent/orchestrator.md
docs/agent/orchestrator.md
core/docs/agent/model-routing.md
docs/agent/model-routing.md
kit.config.json
.kit/config.json
tools/lib/kit.mjs
tools/install.mjs
tools/sync.mjs
tools/orchestrator-e2e.mjs
tools/test/run-plans.test.mjs
tools/test/orchestrator-merge-only.test.mjs
tools/test/orchestrator.test.mjs
tools/test/lib/**
tools/test/fixtures/**
CHANGELOG.md
tools/lib/agent-eval/run.mjs
tools/lib/agent-eval/reviewer.mjs
tools/test/agent-eval.test.mjs
tools/test/agent-contracts.test.mjs
docs/brain/decisions/0017-orchestrator-loop-is-a-script.md
```

## Read Scope

Entire repo. `core/.claude/workflows/orchestrate.js` is read for the logic to carry over (`blockedBy()` ~550, `gate()` ~702, `checkers()` ~784, `merge()` ~922, `runPlan()` ~972); it is not edited here and is deleted in plan 090.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry. In the goal run: `core/scripts/lib/**`, `tools/test/**` and `tools/lib/**` are pre-approved.

## Architecture Impact
- INV-1: preserves — the builder runs on `models.build`, escalation on `models.judgment`, the reviewer on `models.review` (or the model plan 087 recorded); install and sync keep refusing Haiku for `review` and `inherit` for `judgment`.
- Changes: the orchestration loop moves from `.claude/workflows/orchestrate.js` (model-driven) to `scripts/run-plans.mjs` (code). The run branch `orch/<run>` and the rule "the run never merges into main" are unchanged. ADR: `docs/brain/decisions/NNNN-orchestrator-loop-is-a-script.md` — Arch-approved: Human 2026-11-06 (this goal).

## Step 0 — Reality Check
1. `tools/lib/agent-eval/run.mjs`: read `claudeArgs`, `claudeRunner`, how `usage` and `result` come back from `--output-format json`, and the Windows quoting branch; `claude-run.mjs` is that code moved under `core/scripts/lib/` with the four context-saving flags added (the eval tool then imports it from there).
2. `orch-state.mjs`: `init`, `plan-info --no-notes`, `worktree`, `diff`, `set`, `handoff --reset-base`, `finish`, `watch` — confirm each is callable as a function or by `spawnSync('node', [...])` from another script; prefer importing the command table over spawning.
3. `plan-order.mjs --json`: confirm it prints waves and edges; `run-order.mjs` wraps it plus `blockedBy()` moved out of `orchestrate.js`.
4. `kit.config.json` → `orchestrator`: keys that stay (`runBranchPrefix`, `maxFixRounds`, `onPark`, `gateTimeoutMin`, `concurrency`, `staleMin`, `mergeChecks`, `ciMirror`, `prepare`), keys that die with the workflow (`pilotSize`, `fallbackModel`, `maxNotesPerPlan`, `maxAgentCallsPerPlan`, `triage*`) — removed here from the config and from `tools/lib/kit.mjs` validation; new: `rateLimitWaitMin` (default 30), `reviewerMode` (`gate` | `advisory`, default from plan 087's line).
5. Claude Code's headless mode on this machine: run `claude -p "print ok" --output-format json --setting-sources local --strict-mcp-config --disable-slash-commands --no-session-persistence` once and keep the output as `tools/test/fixtures/claude-p-ok.json` (the subscription login serves it — plan 035 proved it; if it fails here, stop and show the error).

## Atomic Sub-tasks

- [x] M1: Move the headless runner into the kit: `core/scripts/lib/claude-run.mjs` exports `claudeArgs(agentFile, { model, cwd, prompt })` and `runAgent()` returning `{ result, usage, exit, seconds, error }` with the four context-saving flags, a timeout (`gateTimeoutMin` for the builder, 10 min for the reviewer), and rate-limit detection from the error text; the eval tool imports it — core/scripts/lib/claude-run.mjs, tools/lib/agent-eval/run.mjs, tools/test/run-plans.test.mjs
- [x] M2: `plan-gate.mjs`: run `PREPARE` steps, the project checks (build, lint, test or testCi), the plan's `[auto]` Done-when commands and the kit manifest check by `spawnSync` in the plan's worktree with the gate timeout; write `<worktree>/.claude/gate-receipt.json` (command, exit, seconds, last 50 lines); exit 0 / 1 / 2 (env) — core/scripts/lib/plan-gate.mjs, tools/test/run-plans.test.mjs
- [x] M3: `plan-review.mjs`: build the reviewer prompt from the redacted plan (`plan-info --no-notes`), `git diff BASE...BRANCH`, and the gate receipt; call `plan-reviewer.md` through `claude-run.mjs` with no write tool; validate the JSON against the finder schema; `verdict` PASS/STOP computed from kept `blocker`/`major` problems (never the model's flag); in `advisory` mode a STOP is recorded, not enforced — core/scripts/lib/plan-review.mjs, tools/test/run-plans.test.mjs
- [x] M4: `plan-merge.mjs` + `orch-state.mjs merge-verify`: in the merge folder `git merge --no-ff <plan branch>` at `checkedHead`, `merge-verify` (HEAD^2 == checkedHead, else reset to HEAD^ and park with both shas), the `mergeChecks` build, then push `orch/<run>` — one push per merge (plan 085 shape A) — core/scripts/lib/plan-merge.mjs, core/scripts/orch-state.mjs, tools/test/orchestrator-merge-only.test.mjs
- [x] M5: `run-order.mjs`: waves and edges from `plan-order.mjs --json`, `blockedBy(parked, later, edges)` moved from orchestrate.js, `onPark` honoured — core/scripts/lib/run-order.mjs, tools/test/run-plans.test.mjs
- [x] M6: `run-plans.mjs`, the loop: readiness lint per plan (deps, arch, tags, check-files, npx mapping, `A: open` refusal) → `orch-preflight.mjs` → `init` → per wave, `concurrency` plans at a time: `worktree` → builder (`orch-builder.md`, `models.build`; on gate or review failure one fix round with the findings; then `handoff --reset-base` and one judgment-tier builder; then park) → `plan-gate` → `plan-review` → `plan-merge` → `set` after every state change (so `watch` works) → final gate (`final-gate`, `ciMirror`) → `finish`; rate-limit pause/retry; `calls.csv`; exit 0 all merged, 2 some parked, 1 refused before start — core/scripts/run-plans.mjs, tools/test/run-plans.test.mjs
- [ ] M7: `--dry-run` and `--concurrency`; `rateLimitWaitMin` and `reviewerMode` in kit.config.json and `tools/lib/kit.mjs`; drop the dead keys with a one-line migration note in install/sync (`NOTE orchestrator: pilotSize removed`) — core/scripts/run-plans.mjs, kit.config.json, .kit/config.json, tools/lib/kit.mjs, tools/install.mjs, tools/sync.mjs
- [ ] M8: Rewrite `/orchestrate` as the thin command (validate, print the PowerShell line, `start` runs it in the background, result from status.json); rewrite `docs/agent/orchestrator.md` sections "Pieces", "The run", "Runner calls" (the table becomes "Model calls: builder, builder fix, judgment builder, reviewer — everything else is code") and the settings table; update model-routing.md's agent table — core/.claude/commands/orchestrate.md, core/docs/agent/orchestrator.md, core/docs/agent/model-routing.md
- [ ] M9: Rewrite `tools/orchestrator-e2e.mjs` to drive `run-plans.mjs` with the fake runner on the fixture repo (the old e2e drove the workflow) — tools/orchestrator-e2e.mjs, tools/test/fixtures/**
- [ ] T1: Resync, run every check, ADR file, changelog, and the `--dry-run --plans 089` of the `[human]` item (the real run waits until after the goal) — docs/brain/decisions/, CHANGELOG.md

## Technical Considerations
- Dependencies: 086 (`plan-info --no-notes`, `handoff --reset-base`, `plan-park.mjs`), 087 (`plan-reviewer.md`, the `REVIEWER:` line), `orch-preflight.mjs` (058's server start when merged; without it a down server is a preflight FAIL, never a question).
- Builder prompt: the plan path, the worktree, the branch, the base, and `LESSONS`/`RULES` for the builder section only — same task shape as `orchestrate.js builder()`; the builder's result JSON is read for `decisions` and `notDone`; its `pass` is ignored.
- Model calls per plan: builder (1) + fix round (0–1) + judgment builder (0–1) + reviewer (1, +1 after a fix) → 2 normally, 5 at worst, then park. `maxAgentCallsPerPlan` is no longer needed.
- Rate limits: a `claude -p` error containing `rate limit` / `usage limit` → `env-paused`, wait `rateLimitWaitMin`, retry the same call once; a second hit parks the run with `stopped: rate-limit` so the Human relaunches after the reset (the fleet mod shows the reset time).
- Windows: all spawns through `execFileSync`/`spawnSync` with `shell: true` only where `claude-run.mjs` needs it (the `.cmd` shim), paths quoted; no Git Bash in the loop.
- Backend / API: none. Auth and validation: none. Security surface: the builder is the only call with write tools and runs with cwd = its own worktree; the scope guard (`scope-guard.sh`) still runs inside that headless session through `settings.json` (confirm in Step 0 item 5 that hooks run under `-p`; if they do not, `plan-gate` adds a scope diff check from `scope-check.mjs` before the review — record which). Data / migration: none.

## Out of Scope
- Deleting the workflow and the retired agents (plan 090).
- `/ship` (plan 089). UI cards by script (`orch-ui` stays as is until plan 080 moves the UI check to the plan's own code).
- Parallelism above 2 and anything about the 5-hour window beyond pause-and-retry.

## Critical Questions
- Q: reviewer mode when plan 087 found precision < 0.50 — `advisory` (findings listed, plan merges) or `gate` (STOP parks)? A: `advisory` until the A/B reaches ≥ 0.50, then `gate`; the config key makes it a one-line switch.
- Q: `concurrency` default? A: 1 (decision 4 of the goal).

## Execution Notes
- Step 0 (branch feat/088-run-plans-script from origin/main d54c212; 084, 086, 087, 058 merged):
  - ok 1: `tools/lib/agent-eval/run.mjs` `claudeArgs({ agent, model, systemPromptFile })` = `-p --output-format json --system-prompt-file … [--model] [--tools] [--disallowedTools write tools]`; `claudeRunner` spawns `claude` with the prompt on stdin, cwd a scratch copy; `JSON.parse(stdout)` → `result` (the reply text), `usage` (`*_tokens`), `total_cost_usd`; Windows branch: `shell: true` and every argument wrapped in quotes (the .cmd shim).
  - conflict 2: `orch-state.mjs` is a CLI with a top-level `commands` table and `process.exit` in `emit()` — it cannot be imported; every step is `spawnSync(node, [scripts/orch-state.mjs, cmd, --k=v…])` (the existing `orchState()`-style ORCH_JSON read). `plan-info --no-notes` resets the plan's status entry to `queued` (it starts an attempt), so the review copy comes from `diff --no-notes` (what 086 settled for the workflow), not from plan-info. No `merge-verify` existed (085 never built).
  - ok 3: `plan-order.mjs --json` prints `waves`, `waveLocks`, `edges` (`met` on a done dependency), `plans`, `skipped`; `blockedBy()` is a pure function at orchestrate.js 550 and moves as is.
  - conflict 4: the dead keys (`pilotSize`, `fallbackModel`, `maxNotesPerPlan`, `maxAgentCallsPerPlan`, `triage*`) are still rendered by `.claude/workflows/orchestrate.js` (which stays until 090; an unknown placeholder stays verbatim and breaks the script) and the triage keys by `orch-state.mjs finish` (the report); `tools/install-check.mjs` (outside this scope, not pre-approved) asserts their rendered values. They stay; see M7.
  - ok 5: `claude -p "print ok" --output-format json --setting-sources local --strict-mcp-config --disable-slash-commands --no-session-persistence` → exit 0, `"result":"ok"`, 26 290 input tokens (cache creation), $0.105 — kept as `tools/test/fixtures/claude-p-ok.json`. Hooks: `--setting-sources local` loads no project `.claude/settings.json`, so the scope guard's hooks do not run inside a headless call (from the flag's meaning, not a second paid call) → `plan-gate` adds `node scripts/scope-check.mjs --diff=origin/<run branch> --plan=<plan>` to every plan gate.
- decision: behaviour: the reviewer's model is a new key `orchestrator.reviewerModel` (default `opus`, what 087 measured best), rendered into `plan-reviewer.md`'s `model:` line; install and sync refuse Haiku for it (INV-1's review rule). `models.review` (the checkers) is unchanged. Reverse: `model: {{models.review}}` and drop the key.
- decision: behaviour: `--concurrency` defaults to 1 inside run-plans.mjs (goal decision 4), not through `orchestrator.concurrency` — changing that key's default re-renders `.claude/workflows/orchestrate.js` (outside the scope); the key stays the workflow's. At most 2. Reverse: read the key.
- decision: behaviour: `orchestrator.maxFixRounds` (default 2) counts the rounds after the first build: round 1 = a fix on the same tier, round 2 = `handoff --reset-base` + one judgment-tier builder; the same reason twice in a row parks at once (the workflow's rule) — that is how (c) "gate fails twice → parked" and (d) "STOP parks after one fix round" agree with M6's judgment builder: a second failure escalates only when its reason is new. Reverse: drop the same-reason check.
- decision: behaviour: a readiness problem in any plan (an `A: open` question, a failing `scope-check --deps/--arch/--tags`, a bad branch name, a missing check file) or a failed preflight refuses the whole run before `init` (exit 1), and the dry run reports it as `WOULD START: no — <why>` with exit 0. Reverse: skip only that plan.
- decision: behaviour: headless calls pass `--allowedTools` = the agent's own `tools:` list (a `-p` call cannot answer a permission prompt; the builder must edit and run git); the eval keeps calling without it. Reverse: `allow: false` in run-plans' runAgent calls.
- decision: behaviour: a rate-limit stop keeps the plan's folder (no plan-park teardown): the relaunch continues in it. Reverse: call park() there.
- decision: behaviour: an advisory review whose reply is unreadable, or whose call fails for another reason than a limit, is a run note and the plan merges; in `gate` mode it parks (`review could not run`). Reverse: treat it as a STOP in both modes.
- M1 done: `core/scripts/lib/claude-run.mjs` (`readAgent`, `claudeArgs` with CONTEXT_FLAGS after the first five arguments the eval test pins, `runAgent` → `{ ok, text, usage, tokens, costUsd, exit, seconds, error, rateLimited, timedOut, argv }`, `spawnClaude` with taskkill of the tree on a timeout, `RATE_LIMIT_RE`); `tools/lib/agent-eval/run.mjs` imports and re-exports it. Evidence: `node --test tools/test/agent-eval.test.mjs` 27/27; run-plans.test "claude-run" 2/2.
- M2 done: `plan-gate.mjs` (`gateCommands`, `runGate` — async spawn, no shell for `node …`, npm as one shell string on Windows; env-fail rerun once; receipt with the last 50 lines, excluded via the repo's info/exclude). Evidence: run-plans.test "plan-gate" pass.
- M3 done: `plan-review.mjs` (`reviewPrompt`, `readReview`, `review`, `validateReviewerResult` moved from `tools/lib/agent-eval/reviewer.mjs`, which now re-exports it). Evidence: agent-contracts 27/27, run-plans.test "plan-review" pass.
- M4 done: `orch-state.mjs merge-verify` (+ `set --calls-b64`, `touch`), `plan-merge.mjs`. Evidence: `node --test tools/test/orchestrator-merge-only.test.mjs` 5/5 (new: accepted at the checked head; refused with both shas, merge folder back at HEAD^, origin untouched; unpinned with a note).
- M5 done: `run-order.mjs` (`runOrder`, `blockedBy` moved as is, `unitsOf`, `afterPark`). Evidence: run-plans.test "run-order" pass.
- M7 built except the dead-key removal (left unticked): `--dry-run`, `--concurrency 1|2` (default 1), `--reviewer-mode`; `orchestrator.reviewerMode` (advisory), `reviewerModel` (opus), `rateLimitWaitMin` (30) in kit.config.json with their kit.mjs checks (`.kit/config.json` takes the scaffold defaults; nothing to set). Blocked: dropping `pilotSize`, `fallbackModel`, `maxNotesPerPlan`, `maxAgentCallsPerPlan`, `triage*` — the workflow (until 090) and `orch-state.mjs finish` render them, and `tools/install-check.mjs` (out of scope, not pre-approved) asserts them; so no install/sync migration NOTE either. Follow-up for plan 090: drop the four workflow-only keys with the workflow, their kit.mjs checks, the install-check lines 994–1020 that assert them, plus the NOTE. Evidence: run-plans.test "config:" pass.
- M6 done: `core/scripts/run-plans.mjs`. Evidence: `node --test tools/test/run-plans.test.mjs` 16/16 in 166 s — (a)–(h), the escalation, argv, calls.csv, watch FINISHED/RUNNING, `--concurrency 2` overlap, default no overlap, both dry runs.
