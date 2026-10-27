# Plan 028 — Orchestrator runs finish fast: a test gate that exits, reused slots, shared dependencies and pnpm

Status: draft
Depends-on: none
Snapshot: d70250b4fe350b5b8d883d3b7731540a186edf0f

## Problem Statement

A FoodVibe orchestrator run (plans 412, 419, 497; 2026-10-27, 13:35–15:36 UTC) took about 2 hours for about 30 minutes of
coding, and merged nothing. Three kit gaps caused most of it:

1. **The gate never exits (~70 min).** `core/.claude/workflows/orchestrate.js` builds `PROJECT_CHECKS` as
   `npm run <commands.test>`. FoodVibe's `test` script is the watch-mode `ng test`: it printed its totals and hung. The
   hang caused fix rounds, an escalation and a hand-off that fixed nothing. CI already runs it with `--watch=false`.
2. **Builder folders start empty (~45 min).** `core/scripts/orch-state.mjs` (`worktree`) runs `git worktree add` into a
   new `<repo>-orch-<run>-<NNN>` folder and installs nothing. `scripts/node_modules` (picomatch) is missing, so the scope
   guard refuses every edit; then `npm ci` runs once per folder. The three permanent slots (`wt-1..3`, provisioned by
   the `worktree-setup` skill) already have dependencies, and the orchestrator ignores them.
3. **Stop and resume (~25 min)** restarts every builder from the plan; **three builders at once** on one machine made
   specs time out (5 s limits, one flaky header spec).

pnpm (one shared package store, no per-folder download) was left for later in plan 025 (2026-10-25). The Human now wants it
in this round.

## Goals & Success Criteria

**Primary:** an orchestrated plan reaches its gate with dependencies present and a gate command that exits, and builders
reuse an idle slot before a new folder is created.

- [auto] `node --test tools/test/*.test.mjs` passes with new cases: the gate uses `commands.testCi` when set and `commands.test` otherwise; a watch-mode `commands.test` with no `testCi` gives a preflight warning; `project.packageManager` rejects any value but `npm` or `pnpm`.
- [auto] `node --test tools/test/*.test.mjs` passes with new slot cases: `orch-state worktree` claims an idle slot (detached, clean, no `.worktree-plan`), writes `.worktree-plan`, never takes an occupied slot, and `release` detaches it and removes the marker.
- [auto] `node tools/orchestrator-e2e.mjs` passes on a scratch project with two plans and one idle slot: one builder runs in the slot, the other in its own folder, and neither folder runs an install step (its `node_modules` and `scripts/node_modules` are links or already present).
- [auto] `node tools/install-check.mjs`, `node tools/e2e-check.mjs`, `node tools/workflow-link-check.mjs`, `node tools/drift-check.mjs --target .` and `node tools/leak-check.mjs` pass.
- [auto] With `project.packageManager: pnpm` in a scratch project, the rendered `ci.yml`, `worktree-setup` skill and `orch-preflight.mjs` contain `pnpm install --frozen-lockfile` and `pnpm run` and no `npm ci` / `npm run`; with the default they are unchanged byte for byte.
- [human] Run `/orchestrate` on two small FoodVibe plans after syncing: the gate finishes in under 5 minutes, no builder runs `npm ci`, and the report names which slot or folder each plan used.

## Execution Mode
- Parallel: no
- Concurrent plans: none
- Isolated DB: no

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, `.claude/sessions/**`, `.worktree-*`, and the append-only
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
AGENTS.md
.kit/install.json
CHANGELOG.md
```

## Read Scope

Entire repo. Analysis and architectural suggestions are expected.

## Out of Scope

- Changing what a builder, checker or merger does, or the number of agents in a run.
- Running more than one orchestrator run at a time.
- Converting a project's existing lockfile: switching a project to pnpm (and generating its `pnpm-lock.yaml`) is the project's own step; the kit only supports it.
- FoodVibe's own `package.json` (it gets a `test:ci` script in its own sync PR, not here).
- Backend / API, auth, validation, data or migration impact: none. Security surface: the new link step writes only inside the run's own folders; no secrets are read.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry.

## Architecture Impact

`docs/brain/invariants.md` holds the template only (no `INV-n` entries), so no invariant is reachable. A Worker runs
`node scripts/scope-check.mjs --arch --plan=<this file>` and keeps this line if it reports `ARCH: ok`.

- INV-none: preserves — no invariant is registered; the change adds config keys and run-folder handling only.

## Step 0 — Reality Check

Runs only when `scope-check.mjs --drift` reports `REALITY: drift`. Check the listed commits
by symbol (do not re-run the whole reality check from scratch) and print one line per commit:
`ok` or `conflict: <what>`. All `ok` → continue. STOP for a go only on a `conflict`.

## User Stories
- As the Human, I want an orchestrator run to spend its time coding, so that a run of three plans takes minutes of waiting, not hours.
- As the Human, I want the run to use the slots I already have, so that I do not get new folders and new installs each time.
- As a project owner on pnpm, I want one shared store, so that no folder downloads packages again.

## Functional Requirements

### Must Have (P0)
- A1: gate command — `commands.testCi` (an npm script name, like every `commands.*`; unset = `commands.test`) feeds `PROJECT_CHECKS` in `core/.claude/workflows/orchestrate.js` and the matching lists in `core/scripts/orch-state.mjs` (`npmScripts`) and `core/docs/agent/orchestrator.md`; `kit.config.json` documents the key; install and sync refuse a value that is not a script name (`tools/lib/kit.mjs`).
- A2: watch-mode warning — `core/scripts/orch-preflight.mjs` prints `WARN gate:` when `commands.test` (or `testCi`) in the project's `package.json` is `ng test` without `--watch=false` / `--no-watch`, `vitest` without `run`, or `jest` with `--watch`; the run still starts. A gate command also gets a hard timeout (default 15 minutes, `orchestrator.gateTimeoutMin`, validated 1–120 in `tools/lib/kit.mjs`) in `core/.claude/agents/orch-gate.md` and the workflow.
- A3: slot claiming — `core/scripts/orch-state.mjs`: `worktree` first looks at `listSlots()` (`core/scripts/lib/slot.mjs`) for an idle slot (detached, clean, no `.worktree-plan`), writes `.worktree-plan` = the plan path, and switches to the plan branch from the run branch there; a new `release` command (called when the plan merges, is parked or the run stops) detaches the slot at the run branch tip and removes the marker. No idle slot, or `orchestrator.useSlots: false` → the existing own folder.
- A4: dependencies for every builder folder — after `git worktree add` (own folder), link `node_modules`, `scripts/node_modules` and `<paths.serverRoot>node_modules` from the main folder (junction on Windows, symlink elsewhere); if linking fails or the lockfile differs from the main folder's, run the package manager's install once and say so. `orch-preflight.mjs` `packages` runs against the builder folder before the builder starts.
- A5: pnpm — new key `project.packageManager` (`npm` default | `pnpm`, validated in `tools/lib/kit.mjs`): `core/.github/workflows/ci.yml` (setup step + `pnpm install --frozen-lockfile` / `pnpm run`), `core/.claude/skills/worktree-setup/SKILL.md`, `core/scripts/orch-state.mjs`, `core/scripts/orch-preflight.mjs` and `core/scripts/take-plan.mjs` (its install hint) read it. `ci.install` still overrides the CI install command.

### Should Have (P1)
- B1: builder concurrency — `orchestrator.concurrency` (1–3, default 2) caps parallel builders in `orchestrate.js`; the cap is also the number of slots a run may claim.
- B2: stop without a cold restart — `/orchestrate` stop waits for the current build step, commits WIP and records `resume: {step, round}` per plan in `status.json` (`orch-state.mjs`); a relaunch reads it instead of restarting at the plan.

### Nice to Have (P2)
- C1: brain gotcha "a watch-mode test command hangs a gate", plus the changelog and `docs/agent/orchestrator.md` text for every new key — core/docs/brain/gotchas/agent-workflow.md, core/docs/agent/orchestrator.md, CHANGELOG.md

## UI/UX Notes
- None.

## Atomic Sub-tasks

- [ ] A1: Let a project name a test command that exits, so a run's gate never waits on watch mode — commands.testCi in core/.claude/workflows/orchestrate.js, core/scripts/orch-state.mjs, kit.config.json, tools/lib/kit.mjs
- [ ] A2: Warn before a run when the test command would hang, and stop any gate command that runs too long — core/scripts/orch-preflight.mjs, core/.claude/agents/orch-gate.md, core/.claude/workflows/orchestrate.js, tools/lib/kit.mjs
- [ ] A3: Give each plan an idle permanent slot to build in, and free it when the plan ends — core/scripts/orch-state.mjs, core/scripts/lib/slot.mjs, core/docs/agent/orchestrator.md
- [ ] A4: Link the main folder's installed packages into every new builder folder so no builder installs anything — core/scripts/orch-state.mjs, core/scripts/orch-preflight.mjs
- [ ] A5: Let a project choose pnpm so every folder shares one package store — project.packageManager in core/.github/workflows/ci.yml, core/.claude/skills/worktree-setup/SKILL.md, core/scripts/orch-state.mjs, core/scripts/orch-preflight.mjs, core/scripts/take-plan.mjs, kit.config.json, tools/lib/kit.mjs
- [ ] B1: Cap how many builders run at once so specs stop timing out under load — orchestrator.concurrency in core/.claude/workflows/orchestrate.js, tools/lib/kit.mjs
- [ ] B2: Make a stopped run resume mid-plan instead of starting each plan again — core/scripts/orch-state.mjs, core/.claude/workflows/orchestrate.js, core/docs/agent/orchestrator.md
- [ ] C1: Record the watch-mode trap in the brain and document every new key — core/docs/brain/gotchas/agent-workflow.md, core/docs/agent/orchestrator.md, CHANGELOG.md
- [ ] T1: Add the unit cases and the e2e cycle for the gate command, the slot claim, the link step and pnpm — tools/test/, tools/orchestrator-e2e.mjs, tools/install-check.mjs
- [ ] R1: Re-render the installed copies with sync and check drift — .claude/, scripts/, docs/agent/, .kit/install.json

## Execution Notes

- Origin: FoodVibe orchestrator run 412/419/497 retrospective pasted by the Human (2026-10-27) plus the Human's two questions: why not use `wt-1..3`, and why not pnpm. Both are answered by A3 and A5.
- Decision (Human, 2026-10-27): builders claim free slots first and fall back to own folders; both get linked dependencies; pnpm is in this round.
- Convention: every `commands.*` key is an npm script name, never a full command (`kit.config.json` `$comment`; the orchestrator only accepts `npm run <script>` checks). So `testCi` is a script name; FoodVibe adds `"test:ci": "ng test --watch=false --browsers=ChromeHeadless"` in its own sync PR and sets `commands.testCi: test:ci`.
- Slot safety: a slot is idle only when `listSlots()` shows it detached with no `.worktree-plan`; a Human using a slot always wins. Release must never delete a branch with unmerged commits.
- Version: a minor (v1.9.0). Tag and release wait for the Human's go.
- Verification gap to close in T1: the junction path on Windows was not exercised by CI (Ubuntu only on PRs); run `tools/orchestrator-e2e.mjs` locally on Windows.

## Architect + PM review (Planner, 2026-10-27)

- fixed: the draft said `commands.testCi` was a raw shell string; every `commands.*` key is an npm script name and the orchestrator accepts only `npm run` checks, so it is a script name (A1).
- fixed: slot claiming now uses `.worktree-plan`, the marker `listSlots()` and the scope guard already read, instead of a new claim file (A3).
- fixed: added Out of Scope, Architecture Impact (`INV-none`), tagged every Done-when item, named files in every sub-task.
- checked: plans 020, 022, 023, 024, 025, 026 — none is the same work; 026's allowlist is why A1 stays a script name.
- open: plan 024 (draft, not built) also edits `orchestrate.js`, `orchestrator.md` and `orch-run.mjs`; plans 022 and 023 share `job-validation.md` and `ship.md` with `core/**`. Build this plan solo, never in parallel with them; whoever builds second runs the Step 0 drift check against the first one's diff.
