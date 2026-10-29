# Plan 029 — Orchestrator survives a blocked model and says when it is stuck: merge-folder packages, model fallback, loop limits and a watch command

Status: draft
Depends-on: none
Snapshot: 7109f6143c2566b502f1fe8994b16b60f1a6b911

## Problem Statement

A FoodVibe orchestrator run of plan 504 (2026-10-28, kit v1.9.0) built the plan and passed every check, then merged
nothing and kept running for hours. Four kit gaps caused it:

1. **The merge folder has no packages.** `orch-state.mjs init` (`core/scripts/orch-state.mjs`, `init()`) creates
   `<repo>-orch-merge-<run>` with `git worktree add` and installs nothing. Plan 028's `ensureDeps` runs only for builder
   folders, so the merge step's `npm run build` failed with `'ng' is not recognized`. The environment check passed
   (it looks at the main folder), the run retried once, failed the same way and parked a finished plan. The same failure
   stopped run-412-497.
2. **A blocked model stalls the session.** The Human's orchestrator session got "Sonnet 5.5's safeguards flagged this
   message" on every reply, whatever they typed. `agent()` returns `null` when a subagent dies on a terminal API error;
   the workflow has no second model to try, so such a step is parked or retried on the same model.
3. **A finished run looks stuck.** After the park, the run wrote about 30 closing notes. Every `note` (and every `set`)
   is a `kit-runner` agent call (`orchestrate.js` `note` → `state` → `runner`), so a note loop is a long agent loop. No
   cap exists on notes or on agent calls per plan.
4. **Nothing tells the Human a run is stuck.** `status.json` has `updatedAt`, but nothing reads it. A run that makes no
   progress, or repeats one error, looks the same as a slow one.

## Goals & Success Criteria

**Primary:** a run whose merge folder lacks packages is fixed before the merge; an agent that dies is retried once on a
second model; a loop is cut by a hard limit; and the Human can ask any time "is this run stuck?" and get one line.

- [auto] `node --test tools/test/*.test.mjs` passes with new cases: `init` installs the merge folder's packages and reports an environment failure when `scripts/` lacks picomatch; a reused merge folder with packages is left alone.
- [auto] `node --test tools/test/*.test.mjs` passes with new cases for `watch`: a running run whose `updatedAt` is older than `orchestrator.staleMin` prints `STUCK: plan <NNN> · <state> · no progress for <n> min · last: <note>` and exits 1; a fresh one prints `RUNNING` and exits 0; a finished or stopped run prints its phase and exits 0; two plan notes with the same reason in a row print `STUCK … same reason twice`.
- [auto] `node --test tools/test/*.test.mjs` passes with new cases: `orchestrator.fallbackModel` accepts `inherit`, `haiku`-free model names and full `claude-` ids, and install and sync refuse a Haiku value; `orchestrator.staleMin` and `orchestrator.maxNotesPerPlan` reject anything but a whole number in their range.
- [auto] `node tools/orchestrator-e2e.mjs` passes on a scratch project: a merge folder created by `init` has `node_modules` in the root and in `scripts/`, and a stub agent that returns `null` once is retried once with the fallback model (the run note `model fallback` names both models) and not a third time.
- [auto] `node --test tools/test/*.test.mjs` passes with new cases: a gate that returns 1 of 8 results reruns the 7 missing commands and starts no builder round; a run whose plans are all parked still returns a report path; `checkProblem` drops `node scripts/kit-owned.mjs --write` and keeps `node scripts/kit-owned.mjs`.
- [auto] `node --test tools/test/*.test.mjs` passes with new cases: `stop` on a run whose plan holds a clean slot prints `plan <NNN>: slot wt-<n> released` and the slot is detached with no `.worktree-plan`; a slot with an uncommitted file is kept and the line says why.
- [auto] `node tools/install-check.mjs`, `node tools/e2e-check.mjs`, `node tools/workflow-link-check.mjs`, `node tools/drift-check.mjs --target .` and `node tools/leak-check.mjs` pass.
- [x] [human] Run `/orchestrate` on one small FoodVibe plan after syncing: the merge step finishes without a parked plan, and `node scripts/orch-state.mjs watch --run <run>` in a second terminal prints `RUNNING` while it works. (Human `done`, 2026-10-29 — see Execution Notes, project run of one plan.)

## Execution Mode
- Parallel: no
- Concurrent plans: none
- Isolated DB: no

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/**
templates/**
layers/cursor/**
tools/**
scripts/**
.claude/**
docs/agent/**
docs/brain/**
kit.config.json
README_WORKFLOW.md
.kit/install.json
CHANGELOG.md
```

## Read Scope

Entire repo. Analysis and architectural suggestions are expected.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry.

## Architecture Impact

`docs/brain/invariants.md` holds the template only (no `INV-n` entries), so no invariant is reachable. A Worker runs
`node scripts/scope-check.mjs --arch --plan=<this file>` and keeps this line if it reports `ARCH: ok`.

- INV-none: preserves — no invariant is registered; the change adds config keys, one script command and workflow limits only.

## Step 0 — Reality Check

Runs only when `scope-check.mjs --drift` reports `REALITY: drift`. Check the listed commits
by symbol (do not re-run the whole reality check from scratch) and print one line per commit:
`ok` or `conflict: <what>`. All `ok` → continue. STOP for a go only on a `conflict` (a symbol,
line or file this plan names was removed, renamed or rewritten).

## User Stories
- As the Human, I want a finished plan to reach the run branch, so that a missing `node_modules` in one folder never costs a whole run.
- As the Human, I want a blocked model to cost one retry on another model, so that the run keeps going without me typing into a frozen session.
- As the Human, I want one line that says "STUCK" and why, so that I act on a loop in minutes, not hours.

## Functional Requirements

### Must Have (P0)
- A1: merge-folder packages — `core/scripts/orch-state.mjs` `init()` calls `ensureDeps({ mainRoot: root, dst: mf, serverRoot: SERVER_ROOT, pm: PM })` (`core/scripts/lib/orch-folders.mjs`) after the merge folder is created or reused; `ok: false` → `fail(…, { envFailure: true })` naming the folder; the env-only preflight (`core/scripts/orch-preflight.mjs --env-only`) also checks `scripts/node_modules/picomatch` in the merge folder when the run name is passed.
- A2: model fallback — `core/.claude/workflows/orchestrate.js` gets one helper `ask(prompt, opts)` that calls `agent()` and, when it returns `null`, calls it once more with `model: FALLBACK_MODEL` and logs a run note `model fallback: <role> <first model> → <second model>`; every `agent(...)` call in the file goes through it. `FALLBACK_MODEL` is `{{orchestrator.fallbackModel}}` (default `opus`; `inherit` = no fallback). A second `null` is returned as is, so the caller's existing park or environment path handles it. A `review`-tier agent (checkers, verifier, security, UI) never falls back to Haiku: the key refuses Haiku values.
- A3: loop limits — in `orchestrate.js`: (a) at most `orchestrator.maxNotesPerPlan` (default 12) run notes per plan, then one final note `notes capped` and no more; (b) the same failure reason (`failure.why`, trimmed to 120 characters) twice in a row at the same step parks the plan at once as `same reason twice: <why>`, with no further fix round; (c) at most `orchestrator.maxAgentCallsPerPlan` (default 60) agent calls per plan, then the plan is parked as `agent-call limit`. A parked plan's closing steps write one note, not one per step.
- A4: `watch` command — `core/scripts/orch-state.mjs watch --run <name> [--stale-min <n>]` reads `status.json` only (no git, no agent, no model): prints `RUNNING`, `FINISHED`, `STOPPED: <reason>` or `STUCK: plan <NNN> · <state> · no progress for <n> min · last: <note>`; `STUCK` exit code 1, the rest 0. Stale = phase `running` and `updatedAt` older than `orchestrator.staleMin` (default 10). It also prints `STUCK` for two consecutive notes of one plan with the same text. Helpers live in `core/scripts/lib/orch-run.mjs` so tests call them without a run.

- A5: lost gate results — in `core/.claude/workflows/orchestrate.js`, when the gate returns fewer results than commands (run-504, round 0: 1 of 8), only the missing commands run again, once; a fix round and a builder start only for a command that came back `fail`. A command still missing after that rerun is an environment failure (existing path), not a code failure.
- A6: a report every time — the workflow always runs `finish` (the report, the decisions list) when it ends, also when every plan is parked or the last plan parked at an environment failure; today run-504 ended "paused" with no report.
- A7: no invented start time — `core/.claude/commands/orchestrate.md` step 3 stops passing `startedAt`; `orch-state.mjs init` already falls back to its own clock (`args.started || nowIso()`), and the workflow takes the start from `init`'s answer.
- A8: no check that writes files — `checkProblem` in `core/.claude/workflows/orchestrate.js` also drops a plan check command that carries a `--write`, `--apply`, `--fix` or `--update` argument (run-504 passed `kit-owned.mjs --write` as a gate command); a run note says why.
- A9: slots given back when a run stops — `core/scripts/orch-state.mjs stop` and `finish` release every slot the run still holds (`status.plans[n].slot`, through the existing `releaseSlot`: a slot with uncommitted files or unpushed commits is kept and the line says why), so a run that ends on an environment failure leaves no `wt-N` with a stale `.worktree-plan` (run-412-497 left wt-1 claiming plan 485 until the next `take-plan`); `release` itself is unchanged.

### Should Have (P1)
- B1: the command text — `core/.claude/commands/orchestrate.md` step 3 tells the Human the watch line to run in a second terminal (`node scripts/orch-state.mjs watch --run <run>`), and step 4 prints a `STUCK` line first, before the merged and parked lists, when the run ended on a limit.
- B2: config keys — `kit.config.json` (with its `$comment`) and `tools/lib/kit.mjs` validation for `orchestrator.fallbackModel` (`inherit`, `sonnet`, `opus`, `fable` or a `claude-` id that is not Haiku), `orchestrator.staleMin` (1–240), `orchestrator.maxNotesPerPlan` (1–100) and `orchestrator.maxAgentCallsPerPlan` (10–500).

### Nice to Have (P2)
- C1: docs and brain — `core/docs/agent/orchestrator.md` (settings table, "The run" section), `core/docs/agent/model-routing.md` (a fallback is a sub-agent `model:` option, so rule 1 still holds), `core/docs/brain/gotchas/agent-workflow.md` ("a merge folder without packages parks a finished plan", "every note is an agent call"), `CHANGELOG.md`.

## UI/UX Notes
- None.

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [x] A1: Install the merge folder's packages when a run starts, so the merge step can build — core/scripts/orch-state.mjs, core/scripts/orch-preflight.mjs, core/scripts/lib/orch-folders.mjs
- [x] A2: Retry a dead agent once on a second model — core/.claude/workflows/orchestrate.js
- [x] A3: Cut loops with three hard limits: notes per plan, a repeated reason, agent calls per plan — core/.claude/workflows/orchestrate.js
- [x] A4: Add `orch-state.mjs watch`, a one-line "is this run stuck" check that reads only `status.json` — core/scripts/orch-state.mjs, core/scripts/lib/orch-run.mjs
- [x] A5: Rerun only the gate commands that returned nothing, instead of a whole builder round — core/.claude/workflows/orchestrate.js
- [x] A6: Always write the report and decisions list when a run ends, also when plans are parked — core/.claude/workflows/orchestrate.js
- [x] A7: Stop passing a made-up start time; let `init` use the real clock — core/.claude/commands/orchestrate.md, core/.claude/workflows/orchestrate.js
- [x] A8: Refuse a plan check command that writes files (`--write`, `--apply`, `--fix`, `--update`) — core/.claude/workflows/orchestrate.js
- [x] A9: Give every slot back when a run stops or finishes, so no slot keeps a stale plan claim — `stop` and `finish` call `releaseSlot` for each `plans[n].slot` still set; kept slots say why — core/scripts/orch-state.mjs, tools/test/orchestrator-folders.test.mjs
- [x] A10: Close the race with a parallel Planner session — `scripts/free-merged-slots.mjs` (session start and /plan step 2) frees a claimed, clean slot whose branch is an ancestor of origin/main; the run branch starts equal to origin/main, so in wave 1 a fresh builder branch looks merged until its first file change. `orch-state init` gives the run branch its own first commit (empty, "orch(<run>): run start"), and free-merged-slots leaves alone any slot whose .worktree-plan belongs to a live run (status.json running). One test for each — core/scripts/orch-state.mjs, core/scripts/free-merged-slots.mjs, tools/test/
- [x] A11: Refuse a second run that shares a plan or scope with a live run — preflight today refuses only a live run of the same name; lock groups are computed inside one run only. Print which plans/files overlap — core/scripts/orch-preflight.mjs, tools/test/
- [x] A12: Start tier — `scripts/lib/orch-run.mjs` startTier() puts a builder on the judgment tier for any named invariant, even "preserves" (plans 419 and 497 started on inherit = Opus with only "preserves" lines; 10 of 17 open FoodVibe plans would too). Judgment only for kind "changes"/"deviation" or no kind; "preserves" starts on build. Test: a plan with only "preserves" lines starts on build — core/scripts/lib/orch-run.mjs, tools/test/orchestrator.test.mjs
- [x] A13: docs/agent/orchestrator.md — how to run beside a Planner: /orchestrate in a second Claude Code session in the main folder; the main folder must be clean at readiness, `go` and `continue`; never edit a plan in the run; never start from a wt-N slot; one run at a time; update "Start tier" to match A12 — core/docs/agent/orchestrator.md
- [x] A14: An environment failure at the merge retries the merge only — `merge()` marks its failure `stage: 'merge'`; after the environment check passes, `runPlan` calls `merge(ctx)` again with no builder, gate or checkers (run-497-419 restarted both plans from the builder, about 13 minutes each, for a merge folder without packages); the env-only preflight also checks the merge folder's root `node_modules` when the main folder has one. Tests: unit (a merge env failure once → one builder, two merge calls) and e2e — core/.claude/workflows/orchestrate.js, core/scripts/orch-preflight.mjs, tools/test/orchestrator.test.mjs, tools/orchestrator-e2e.mjs
- [x] B1: Tell the Human about `watch` and print `STUCK` first in the final report — core/.claude/commands/orchestrate.md
- [x] B2: Add and validate the four new `orchestrator.*` keys — kit.config.json, tools/lib/kit.mjs
- [x] C1: Document the keys, the fallback and the limits, and record the two traps in the brain — core/docs/agent/orchestrator.md, core/docs/agent/model-routing.md, core/docs/brain/gotchas/agent-workflow.md, CHANGELOG.md
- [x] T1: Add the unit cases and the e2e cycle for the merge folder, `watch`, the fallback and the limits — tools/test/orchestrator.test.mjs, tools/test/orchestrator-folders.test.mjs, tools/orchestrator-e2e.mjs, tools/install-check.mjs
- [x] R1: Re-render the installed copies with sync and check drift — .claude/, scripts/, docs/agent/, .kit/install.json

## Technical Considerations
- Dependencies: plan 028 (`ensureDeps`, `listSlots`, `commands.testCi`, `project.packageManager`), already merged in v1.9.0; plan 026's check-command allowlist is untouched.
- New files needed: none (new commands and helpers live in existing files).
- Model changes: `status.json` gains no field; `watch` reads `updatedAt`, `phase`, `plans[n].state` and `notes`, which exist.
- Backend / API: none.
- Auth and validation: new config values are validated at install and sync (A2, B2); `watch` takes `--run` through the existing run-name check.
- Security surface: `watch` reads one gitignored file and runs nothing. The fallback adds no tool or permission to any agent; it only changes `model:` on a retry, and a review agent never gets Haiku.
- Data / migration: none.
- Project checks: `docs/project/plan-checks.md` does not exist in this repo.
- The workflow script has no clock (`Date.now()` throws), so time-based stuck detection cannot live in it; that is why `watch` is a separate command and A3 limits are counters.
- Windows: `watch` and the merge-folder install are exercised by `tools/orchestrator-e2e.mjs` locally; CI runs Ubuntu on PRs, Windows on `main` and tags.

## Out of Scope
- More than one orchestrator run at a time, and the separate planner / orchestrator folders (a follow-up plan once the Human's run report is in).
- Switching the orchestrator session's own model: only the Human can do that with `/model`. The kit tells them to when a run ends on a dead agent.
- Phone or desktop notifications (`PushNotification` is a Claude Code tool a script cannot call); `watch` prints the line, and a project can wrap it.
- Retrying on the same model, or retrying more than once.
- FoodVibe's own files (it gets this in a sync PR).
- Follow-ups from the run-504 report, each for a later plan: the preflight asks for a dev server only when a plan needs the app; a post-merge `[human]` item is deferred automatically instead of asked; the plan format gains a "files likely touched" field; `git log` allowed as a read-only check command.

## Critical Questions
- Q: The Human's run wrote about 30 closing notes. Do you have FoodVibe's `status.json` to read the real note texts? A: not needed — the run report (2026-10-28) gives the count (about 30 one-note agents in 4.5 minutes) and the cause (one agent per note); the limits in A3 stand.
- Q: Default for `orchestrator.fallbackModel`: `opus` or `inherit`? A: opus (Human, 2026-10-28)
- Q: Default `orchestrator.staleMin`: 10 or 15 minutes? A: 10 (Human, 2026-10-28, "recommended")

## Execution Notes
- Built 2026-10-29 on `feat/029-orchestrator-survives-a-blocked`. Step 0: `scope-check --drift` named `81c6dc4` (security.yml audit, guards mod, pr-check-fix-loop, install-check) → ok, no symbol this plan names. Evidence: `node --test tools/test/*.test.mjs` 163 pass; `node tools/orchestrator-e2e.mjs` 74 cases; install-check, e2e-check (53), workflow-link-check, leak-check (3 roots), drift-check, scope/arch/tags checks and `npm run build` all pass.
- Deviations from the contract, made while building: (1) "same reason twice" compares the failure's `fingerprint` — the reason plus, for a gate, the last output line — so a gate that fails on the same command with a new error still gets its fix rounds (the e2e's plan 202 needs that); (2) the agent-call counter counts every `ask` keyed by plan (runner calls included) and is checked before each stage, the park's own `set` is never blocked; (3) `ensureDeps` installs with `--no-package-lock` when a folder has no lock file, or the new lock made the merge folder dirty and `clean` failed; (4) the e2e scratch project's root has no lock file, so `init` installs the merge folder's `scripts/` packages only (the root line says "no package-lock.json in .: nothing installed") — the root install is covered by the existing `ensureDeps` unit tests; (5) A6 also wraps the wave loop in try/catch, so an exception reaches `stop` + `finish`; the workflow result carries `stuck`, `reportCommitted`, `startedAt`, `agentCalls` and `notes` for the command.
- The `[human]` item was validated on 2026-10-29 by syncing the project from this branch (`local:` source) and running one small project plan (5 sub-tasks, all `[auto]`): `watch` printed `RUNNING` through the run and `STOPPED` at the end; `init` installed the merge folder's root, `scripts/` and backend packages; the merge step hit an environment failure, retried merge-only once (A14) and parked the plan with a report (A6) instead of rebuilding; the notes cap fired at 12. Timeline: readiness 6 min, build 8 min, gate + checkers 4 min, two merge attempts 6 min, notes 2 min. The merge failure was the project's own bug (a script requiring a transitive package, plus a log check that needs `.env` and the live database and so can never run in the merge folder); the Human merged by hand after running those checks from the main folder.
- Leftovers for a later plan (from that run): the merge step runs only build and scope checks, lint and tests once at the final gate; a plan can tag a check as one that runs from the main folder (needs `.env` or the live database); role instructions allow notes for deviations, escalations and findings only (11 of 15 notes were confirmations); the readiness pause is skipped when no plan has questions or environment needs.
- A14 added on 2026-10-29 from the Planner's report on FoodVibe run-497-419 (environment-failure rebuild loop): its items (a) install in the merge folder and (c) a report on every end are A1 and A6; (b) the merge-only retry is A14.
- A10–A13 added by the Human on 2026-10-29 (mid-brief; facts checked on main @ 7a5aa78 and FoodVibe run run-497-419): the slot race with a parallel Planner session, a second run overlapping a live one, the start tier for "preserves" lines, and how to run beside a Planner.
- Run-504 report (2026-10-28): 34.5 minutes end to end for about 6 minutes of building; gate round 0 returned 1 of 8 results and started a builder round that changed nothing; both merge attempts failed `'ng' is not recognized`; about 30 one-note agents ran in 4.5 minutes; `startedAt` in `status.json` was a value the model made up; no report was written. Plan 028 held: gates took about 3 minutes and no builder ran `npm ci` (slot wt-2 had packages).
- Packages in the merge folder go through `ensureDeps`: with `project.packageManager: pnpm` that is `pnpm install --frozen-lockfile` (hard links from one shared store, no file copies, same drive only); with npm (FoodVibe today) it is `npm ci`, a full install. Switching a project to pnpm is the project's own step (plan 028 Out of Scope).
- Origin: the Human's FoodVibe run of plan 504 (2026-10-28) and the design talk the same day: "a fallback to another model instead of trying Sonnet again and again, and a way to show the user that something is stuck in a loop".
- Evidence from the run (reported by the orchestrator session): merge folder `foodVibe1.0-orch-merge-run-504` had no `node_modules`; `npm run build` failed `'ng' is not recognized`; retried once, parked at 13:18; about 30 note agents after that.
- Evidence in this repo (Planner, 2026-10-28): `core/scripts/orch-state.mjs` `init()` calls `git worktree add` for the merge folder and nothing else; `ensureDeps` is called only from `worktree()`; `note` = `state([...])` = `runner(...)` = one `kit-runner` agent.
- The Workflow API returns `null` from `agent()` after a terminal API error (retries included) and also when the Human skips an agent; A2 treats both as "retry once", which is harmless for a skip.
- A9 added by the Planner on 2026-10-28 from the FoodVibe plan-505 workflow report: wt-1 still carried `.worktree-plan` = plan 485 from run 412-497, which stopped on the merge-folder failure before any `release`. `release()` (`orch-state.mjs:450`) runs only on merge or park today.
