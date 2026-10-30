# Plan 040 — An orchestrator run never stalls on a slot-only check, reports app errors, and checks the manifest before the PR

Status: draft
Depends-on: none
Snapshot: 5a24a28

## Problem Statement

FoodVibe's run-499-502 (kit v1.12.0; the orchestrator files on `origin/main` are unchanged since that tag)
merged all four plans but lost about an hour and three Human round trips to kit gaps:

1. **A check that can only pass in a slot parked a plan.** FoodVibe's `plan-checks.md` puts
   `node scripts/log-query.mjs --since=plan-start --level=error` in every plan. `plan-start` is the time
   `take-plan.mjs` writes to `.claude/.slot-plan-start` — only in a slot. Readiness listed it as an `[auto:main]`
   command, the run ran it from the main folder (`orchestrate.js` second gate), it failed with
   `.slot-plan-start not found`, and plan 500 spent three builder fix rounds on it before parking (~50 min). Even
   if it had a stamp, the main folder serves main's code, not the plan's, so the check could not prove anything
   about the plan.
2. **The run's checks differ from the PR's CI.** CI's `rules` job runs `node scripts/kit-manifest-check.mjs`; no
   run gate does. Builders added three test fixtures, the run finished green, and PR #487 failed on
   `KIT_MANIFEST: FAIL — 3 unclassified`. The same failure hit a day earlier.
3. **A false alarm in the report.** "main untouched: NO" fired because the Planner pushed a plans-only commit to
   main mid-run (`lib/orch-run.mjs` `formatReport` compares SHAs only).

The Human chose (2026-10-30): drop slot-only checks from runs, and put "app errors since the run started" in the
report instead.

## Goals & Success Criteria
**Primary:** a run never builds or parks on a check that cannot pass from the main folder; the report shows app
errors since the run started; a missing manifest entry fails the run, not the PR.

- [auto] `node --test tools/test/orchestrator.test.mjs` passes, with new tests: a main check containing
  `--since=plan-start` is dropped at launch with a note naming the reason and is never run; the final gate runs
  `node scripts/kit-manifest-check.mjs` when the run's init reports a manifest and not otherwise; `formatReport`
  prints `untouched: yes` with a plans-only line when only `plans/**/*.plan.md` or `.claude/todo.md` changed on
  main, and `NO` when any other file changed; the report prints the app-errors section from the log command's
  output, with `--since=plan-start` replaced by the run's start time.
- [auto] `npm run build` passes.
- [auto] `node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .` reports no drift.
- [human] The next FoodVibe orchestrator run (after a kit sync) whose plans carry the `log-query --since=plan-start`
  item runs without parking on it, and its report shows the "App errors since the run started" section.

## Execution Mode
- Parallel: no
- Concurrent plans: none
- Isolated DB: no

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/.claude/workflows/orchestrate.js
core/scripts/orch-state.mjs
core/scripts/lib/orch-run.mjs
core/.claude/agents/orch-readiness.md
core/.claude/commands/orchestrate.md
core/docs/agent/orchestrator.md
core/docs/brain/gotchas/agent-workflow.md
tools/test/orchestrator.test.mjs
tools/orchestrator-e2e.mjs
.claude/**
scripts/**
docs/agent/**
docs/brain/**
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

- INV-none: preserves — `docs/brain/invariants.md` holds only the template entry; no invariant is touched.

## Step 0 — Reality Check

Runs only when `scope-check.mjs --drift` reports `REALITY: drift`. Check the listed commits by symbol
(`mainCheckProblem`, `formatReport`, the final-gate block, `finish()` in `orch-state.mjs`) and print one line per
commit: `ok` or `conflict: <what>`. STOP for a go only on a `conflict`.

## User Stories
- As the Human, I want an overnight run to never spend fix rounds on a check that cannot pass outside a slot, so
  a plan is not parked for an environment reason.
- As the Human, I want the morning report to show the app errors logged during the run, so I don't have to query
  the log by hand.
- As the Human, I want the run to fail on what the PR's CI would fail on, so a green run means a green PR.

## Functional Requirements

### Must Have (P0)
- [ ] A main-folder check that uses `--since=plan-start` or reads `.slot-plan-start` is dropped at launch with a
  note; it never runs and never costs a fix round.
- [ ] The run report has an "App errors since the run started" section when `commands.logQuery` is set.

### Should Have (P1)
- [ ] The final gate runs `node scripts/kit-manifest-check.mjs` when the project has `docs/workflow-kit/manifest.json`.

### Nice to Have (P2)
- [ ] "main untouched" ignores commits that change only plan files and `.claude/todo.md`.

## UI/UX Notes
- Report text only. The app-errors section shows the command, its exit code and at most 20 output lines in a
  fenced block; it never parses or counts the project's output format.

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [ ] A1: Drop a main-folder check that only works in a slot before the run starts, with a clear note — `mainCheckProblem` returns `<cmd>: --since=plan-start needs a slot's plan-start stamp; the main folder has none — the report lists app errors since the run started instead` when the command matches `/--since=plan-start\b|\.slot-plan-start/`; the existing `main-folder check dropped, not run:` note carries it — core/.claude/workflows/orchestrate.js
- [ ] A2: Tell readiness not to list a slot-only log check as a main-folder command — step 3: a command with `--since=plan-start` is slot-only; leave it out of `mainCommands` (the run reports app errors since the run started instead) — core/.claude/agents/orch-readiness.md
- [ ] A3: Put the app errors logged during the run into the report — in `finish()`, when `'{{commands.logQuery}}'` is non-empty and starts with `node scripts/` or `node tools/`: replace `--since=plan-start` with `--since=<status.startedAt>`, run it from the main folder with `spawnSync('node', args, { shell: false, timeout: 60000 })` (args split on spaces), pass `appErrors: { command, exit, lines (first 20 non-empty stdout/stderr lines) }` or `{ command, error }` to `formatReport`, which prints `## App errors since the run started` with the command, the exit code and the lines in a fenced block; unset → no section — core/scripts/orch-state.mjs, core/scripts/lib/orch-run.mjs
- [ ] A4: Run the kit manifest check at the end of the run, the same check the PR's rules job runs — `init()` adds `kitManifest: existsSync(join(root, 'docs/workflow-kit/manifest.json'))` to its emit; the final gate's checks become `[...PROJECT_CHECKS, ...(init.kitManifest ? ['node scripts/kit-manifest-check.mjs'] : [])]`; a failure is reported like any final-gate failure — core/scripts/orch-state.mjs, core/.claude/workflows/orchestrate.js
- [ ] A5: Stop the report calling main touched when only plan files changed there — `finish()` passes `mainChangedFiles` (`git diff --name-only <mainShaAtStart> origin/<main>`) to `formatReport`; untouched is yes when the list is empty or every path matches `^plans/.*\.plan\.md$` or `^\.claude/todo\.md$`, printed as `untouched: yes — <n> plan/todo file(s) changed on main`; any other path → `NO` as today — core/scripts/orch-state.mjs, core/scripts/lib/orch-run.mjs
- [ ] A6: Show the app-errors section in the Human's summary after a run — step 4 summary: quote the report's app-errors lines, or `app errors: none logged` when the output is the project's empty marker; never run the log command again — core/.claude/commands/orchestrate.md
- [ ] C1: Explain slot-only checks and the new report sections in the docs — main-folder section of the orchestrator doc (dropped slot-only checks, app-errors section, manifest check at the final gate); one gotcha entry "a slot-only check in an orchestrator run" (what hurt: run-499-502; what to do: leave it to the report); Unreleased entry — core/docs/agent/orchestrator.md, core/docs/brain/gotchas/agent-workflow.md, CHANGELOG.md
- [ ] T1: Prove each change with tests that fail on today's code — the four cases in the first Done-when item; extend the e2e stub only if it asserts the final-gate check list — tools/test/orchestrator.test.mjs, tools/orchestrator-e2e.mjs
- [ ] R1: Render the kit's own installed copies and check drift — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .` — scripts/, .claude/, docs/agent/, docs/brain/, .kit/install.json

## Technical Considerations
- Dependencies: `orchestrate.js` (`mainCheckProblem`, the init call at ~734, the final gate at ~818), `orch-state.mjs`
  (`init()`, `finish()`), `lib/orch-run.mjs` (`formatReport`). Reuses the existing `main-folder check dropped` note
  path and `gate()`; no new agent.
- New files needed: none.
- Model changes: `formatReport` takes two optional inputs, `appErrors` and `mainChangedFiles`; both absent keep
  today's output, so the existing report test still passes.
- Backend / API: none.
- Auth and validation: `commands.logQuery` is Human-set config (install and sync already refuse a pipe or a
  backtick); A3 runs it only when it is `node scripts/…` or `node tools/…`, with `shell: false`.
- Security surface: A3 runs one config command from the main folder at finish, after the Human launched the run;
  it is read-only by contract (`commands.logQuery` "prints the errors"), and plan 034's main-approval rule covers
  plan-supplied commands, not this config one. The log output goes into the run report on the run branch: the
  20-line cap keeps it short; logs must not carry secrets (already a project rule).
- Data / migration: none. The kit manifest gains no new file (no new files).

## Out of Scope
- FoodVibe's own change (its `docs/agent/plan-checks.md` line "slot work only; orchestrator runs read app errors in
  the morning report") — the FoodVibe Planner does it after the kit sync.
- `plan-close` for a plan without a todo section, removing merged `orch-merge-run-*` worktrees, a `slot-serve --ref`
  "validating" state, `npx` → `pnpm run` in plan checks — later plans.
- The flaky ProductFormComponent spec and the mongodb-memory-server CI download — FoodVibe-only.
- A progress view in the dock — plan 039.

## Critical Questions
- Q: Slot-only checks in runs — drop them or make them work? A: drop them in runs, and report app errors since the run started (Human, 2026-10-30).

## Execution Notes
- Source: FoodVibe run-499-502 workflow report (rows 1, 2, 5) and the Human's choice on 2026-10-30.
