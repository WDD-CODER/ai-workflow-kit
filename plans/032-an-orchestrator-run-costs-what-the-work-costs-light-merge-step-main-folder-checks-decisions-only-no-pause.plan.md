# Plan 032 — An orchestrator run costs what the work costs: a light merge step, checks that run from the main folder, decisions only, and no pause when there is nothing to ask

Status: draft
Track: code — here (kit)
Snapshot: d922f7adae224bb58a88b9dc2abcdd8632840c90
Depends-on: none

## Problem Statement

The first project run on kit v1.10.0 (one plan, 5 sub-tasks, all `[auto]`) took 26 minutes for about 2 minutes of
code change. Where the time went: readiness + waiting for `go` 6 min; build 8 min; gate + checkers 4 min; the merge
step 6 min (build + lint + tests on the merged tree, twice); 15 decision notes 2 min. Four things are the kit's to fix:

1. **The merge step reruns every check.** `merge(ctx)` hands `orch-merge` the same `ctx.checks` as the plan gate
   (`core/.claude/workflows/orchestrate.js`, the `CHECKS: ctx.checks` line): project build + lint + tests plus the
   plan's own commands. The final gate then runs build + lint + tests once more on the run branch. For a 5-minute
   test suite that is three passes per plan where one and a half would do. Merges are serial, so this is the one cost
   that grows with the number of plans.
2. **A check that needs the main folder can never pass.** A plan's `[auto]` item that reads the live backend's log
   database (a `node scripts/…` script that needs the backend's `.env` and the running server) passes the allowlist,
   runs in the builder's worktree (where a copied `.env` happened to exist) and then fails in the merge folder, which
   has no `.env` by design. The run parked a built and verified plan on it; the Human ran the check by hand from the
   main folder and merged. Nothing lets a plan say "this check runs from the main folder".
3. **Every confirmation becomes a numbered decision and an agent call.** `take()` in `orchestrate.js` keeps every
   `decisions` entry any role returns; `orch-gate.md` and `orch-ui.md` ask for confirmation entries outright ("say in
   `decisions` that it was rerun"); the builder's example output has no `behaviour:`/`seen:` prefix; the finders,
   verifier and merger get a `decisions` field with no rule. 11 of the 15 decisions were "I checked X, fine". Each one
   is a run note (one `kit-runner` call) and a line the Human grades.
4. **The run waits for `go` when there is nothing to ask.** `orchestrate.md` step 2 waits for `go` even when every
   plan is `ready` with no questions and no environment needs (the preflight already passed in step 1).

Expected effect on the measured run: the merge step drops from about 3 minutes to about 1 per attempt (build + scope
only), the readiness wait disappears when nothing is open, and the decision notes fall from 15 to the 4 real ones.
For 3–5 plans the saving is about 4 minutes per plan on the serial merge path, which is where the wall time goes.

## Goals & Success Criteria

**Primary:** one plan with a 5-minute check suite costs one gate pass in its worktree, a build-only merge, and one
full pass at the final gate; a check a plan marks as main-folder runs there; only `behaviour:` and `seen:` entries
reach the Human; a run with nothing to ask starts on its own.

- [auto] `node --test tools/test/*.test.mjs` passes with new cases: the merge step's CHECKS follow `orchestrator.mergeChecks` (`build` → the build command plus the plan's scope-check command when the plan had one; `full` → `ctx.checks` as today); the final gate still runs build + lint + tests; a plan with `mainChecks` runs them through a second `orch-gate` call with `FOLDER` = the main folder after the worktree gate passed, never at the merge or the final gate; a failing main check is a real failure (`gate (main folder): <command>`) that starts a builder fix round; a main check that is not `node scripts/…` / `node tools/…` is dropped with a note; `take()` keeps `behaviour:` / `seen:` entries and drops the rest, and the dropped count per plan is in the result (`decisionsDropped`) with no run note; `readiness()` returns `askHuman` false only when every plan is ready with no questions and no environment needs and the preflight is ok.
- [auto] `node tools/orchestrator-e2e.mjs` passes: run `zeta`'s merge stub records CHECKS = the build command plus the scope-check command, no lint, no tests; a new run `iota` with a plan whose readiness returns one `mainCommands` entry shows an `orch-gate` call with `FOLDER` = the scratch project root and that command, and the merge stub's CHECKS without it; the readiness result of run `alpha` carries `askHuman: false`.
- [auto] `node tools/install-check.mjs` passes: `orchestrate.md` step 2 says the run starts without `go` when `askHuman` is false and names the `ask` word that forces the pause; `orchestrator.md` has the `mergeChecks` row and the "Checks that run from the main folder" section; `orch-gate.md` and `orch-ui.md` no longer ask for a `decisions` confirmation; `kit.config.json` renders `MERGE_CHECKS_MODE = "build"`; install and sync refuse `orchestrator.mergeChecks: "tests"`.
- [auto] `node scripts/scope-check.mjs --tags --plan=<a plan with an [auto:main] item>` prints `DONE_WHEN_TAGS: ok`, and the Done-when lint still refuses `[main]`, `[Auto]` and an untagged item (`tools/test/ui-tier.test.mjs`).
- [auto] `node tools/e2e-check.mjs`, `node tools/workflow-link-check.mjs`, `node tools/drift-check.mjs --target .`, `node tools/leak-check.mjs` and `npm run build` pass.
- [human] One project run of a plan with an `[auto:main]` log check: `watch` prints `RUNNING`, the merge step takes about a build's time, the main check passes from the main folder, and the report lists only `behaviour:` / `seen:` decisions plus a dropped-confirmations count.

## Execution Mode

- Parallel: no (kit repo, solo flow)
- Concurrent plans: 030 (role lessons) and 031 (required steps) also edit `orchestrate.js`, `orchestrate.md` and `orchestrator.md`; whichever merges second rebases.
- Isolated DB: no

## Read-Write Scope

```scope
core/.claude/workflows/orchestrate.js
core/.claude/commands/orchestrate.md
core/.claude/agents/orch-merge.md
core/.claude/agents/orch-gate.md
core/.claude/agents/orch-ui.md
core/.claude/agents/orch-builder.md
core/.claude/agents/orch-readiness.md
core/.claude/agents/orch-report.md
core/scripts/lib/done-when.mjs
core/scripts/lib/orch-run.mjs
core/docs/agent/orchestrator.md
core/docs/agent/agent-roles.md
core/docs/brain/gotchas/agent-workflow.md
kit.config.json
tools/lib/kit.mjs
tools/install-check.mjs
tools/test/orchestrator.test.mjs
tools/test/orchestrator-folders.test.mjs
tools/test/ui-tier.test.mjs
tools/orchestrator-e2e.mjs
tools/fixtures/orchestrator/plans.mjs
CHANGELOG.md
scripts/**
.claude/**
docs/agent/**
docs/brain/**
.kit/install.json
plans/032-*.plan.md
```

## Read Scope

Entire repo.

## Escalation Protocol

A file outside the scope is needed → STOP, name the file, the change and why; offer `approved: <path>`; append it to
the scope block; retry.

## Architecture Impact

- INV-none: preserves — kit orchestrator tooling only; no project app file. The merge step still merges only a
  branch the gate and the checkers passed; the final gate keeps the full project checks, so the run branch is handed
  over with the same guarantee as today. A main-folder check is read-only by construction (scripts only, no write
  flags, the main folder is clean per preflight).

## Reuse Check

- Merge checks — family: `PROJECT_CHECKS` / `checkProblem` in `orchestrate.js` — rung: 2 — why: a second constant built the same way, filtered by the same allowlist; no new mechanism.
- Main-folder gate — family: `gateAgent(ctx, commands, label)` — rung: 2 — why: the same agent call with `FOLDER` = the root; the gate result handling (`known` / `missing` / `twice`) is reused through `gate()` with a `ctx` whose `wt.path` is the root.
- Done-when tag — family: `DONE_WHEN_TAGS` / `doneWhenTagProblems` in `done-when.mjs` — rung: 2 — why: one more accepted spelling (`auto:main`), same lint.
- Decision filter — family: `take()` — rung: 2 — why: one regex in the existing collector.
- Readiness auto-start — family: `readiness()` return value + `orchestrate.md` step 2 — rung: 2 — why: one computed flag and one sentence.

## Step 0 — Reality Check

`node scripts/scope-check.mjs --drift --plan=<this plan>`. On `REALITY: drift`, re-read `orchestrate.js` `merge()`,
`gate()`, `take()`, `readiness()` and `runPlan()`'s `checks` line and the three agent files named above; plans 030 and
031 may have merged first.

## User Stories

- As the Human, a run of 3–5 plans finishes in the time the project's own checks need, not three times that.
- As a plan author, I can mark a check that reads the live environment and the run knows where to run it.
- As the Human grading a run, I read the decisions agents took, not their confirmations.

## Functional Requirements

1. **Light merge step (A1).** `kit.config.json` `orchestrator.mergeChecks: "build"` (`build` | `full`; `$comment`
   sentence). `orchestrate.js`: `const MERGE_CHECKS_MODE = {{orchestrator.mergeChecks|json}}`; in `runPlan`,
   `ctx.mergeChecks` = mode `full` → `ctx.checks`; mode `build` → the `{{commands.build}}` entry of `PROJECT_CHECKS`
   plus every entry of `ctx.checks` that matches `/scope-check\.mjs/` (the plan's scope check is seconds and guards
   the merge's own concern). `merge(ctx)` passes `CHECKS: ctx.mergeChecks`; the merge-retry path (plan 029 A14) uses
   the same list. `orch-merge.md` says which checks it gets and why ("the plan's gate and the final gate run the
   rest"). `tools/lib/kit.mjs` `orchestratorProblems` refuses any other value.
2. **Checks from the main folder (A2).** `done-when.mjs`: `DONE_WHEN_TAGS` gains `auto:main` (`[auto:main]` is an
   `[auto]` item whose command runs from the main folder: it reads the live environment — `.env`, a database, a
   log — that a worktree and the merge folder never have). `orch-readiness.md`: a `[auto:main]` item's command goes
   to a new `mainCommands` list (readiness schema: `mainCommands: strList`, optional); `orchestrate.md` step 3
   passes `"mainChecks": { "<NNN>": [ … ] }`. `orchestrate.js` `runPlan`: `mainChecks` = `A.mainChecks[nnn]`
   filtered by `checkProblem` and limited to `node scripts/…` / `node tools/…` (a `run <script>` or `node --test` is
   dropped with the note `main-folder check dropped: <cmd> — only node scripts/… or tools/… run from the main
   folder`). After `gate(ctx)` passes and before the checkers: when `mainChecks.length`,
   `gate({ ...ctx, wt: { path: ROOT }, checks: mainChecks, main: true })` (label `gate <NNN> main`); its failure is a
   real failure with `why: 'gate (main folder): <cmd>'`, `check`, `tail` → the builder fix round as for any gate
   failure. Never run at the merge (not in `ctx.mergeChecks`) or at the final gate. The lost-result rerun (plan 029
   A5) applies as is. The main folder's code is `origin/<main>`, not the plan branch: the doc says a main check is
   for live side effects (logs, data), not for the plan's own code.
3. **Decisions only (A3).** `take()` keeps an entry only when it matches `/^(behaviour|seen):/i` (after trim);
   everything else is counted per plan and returned as `decisionsDropped: { <nnn>: n }` in the run result; the
   command prints `dropped <n> confirmation line(s)` after the decisions list (no run note, no agent call).
   `COMMON.decisions` gets a description: only `behaviour: …` (a choice the plan did not settle, with how to reverse
   it) and `seen: file:line …` (a defect outside the job); evidence and confirmations are not decisions.
   `orch-gate.md` → "report the second run in that command's `tail`"; `orch-ui.md` → "say so in the card's own text
   field" (the field `SCHEMA.ui` has); `orch-builder.md` example → `"decisions": ["behaviour: kept the old flag as an
   alias — reverse: drop the alias"]`; `orch-report.md` adds the dropped count line; `agent-roles.md` rule 9 gains
   one sentence: "Anything else you want to say goes in your result's own fields, never in `decisions`."
4. **No pause when there is nothing to ask (A4).** `readiness()` returns `askHuman: boolean` = any plan has
   `state !== 'ready'` or `questions.length` or `envNeeds.length`, or the preflight is not ok. `orchestrate.md`
   step 2: print the table; when `askHuman` is false, print `nothing to ask — starting the run` and go to step 3
   without waiting; when true, the list + `go` as today. `/orchestrate <plans> ask` (the word `ask` anywhere in the
   arguments) forces the pause. The doc's "Then the Human says `go`" sentence gains the condition.
5. **Docs and changelog (C1).** `orchestrator.md`: settings row `mergeChecks`; "The run" step text for the merge
   (build + scope only), a new short section "Checks that run from the main folder" (`[auto:main]`, what qualifies,
   why the merge folder has no `.env`), the decisions paragraph (two kinds only, dropped count), the readiness
   paragraph (auto-start, `ask`). One gotcha in `agent-workflow.md`: a check that needs `.env` or a live database
   cannot pass in the merge folder — mark it `[auto:main]` (What hurt / Why the obvious fix is wrong — copying `.env`
   into worktrees spreads secrets and hides the dependency / What to do). `CHANGELOG.md` Unreleased: Added
   (`mergeChecks`, `[auto:main]`, auto-start) and Changed (decisions filter). No project names.
6. **Tests (T1).** Listed in Success; plus `tools/install-check.mjs` render / doc / refusal asserts;
   `tools/fixtures/orchestrator/plans.mjs` gains plan 206 with one `[auto:main]` item for run `iota`; the e2e call
   recorder also records `CHECKS` of the merge stub and `FOLDER` of every gate call.
7. **Render (R1).** `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .`.

## UI/UX Notes

- None (kit tooling).

## Atomic Sub-tasks

- [ ] A1: Give the merge step its own short check list so a merge costs a build, not the whole suite — orchestrator.mergeChecks (build default | full), ctx.mergeChecks = build + the plan's scope check, orch-merge gets it, merge-retry uses it, config validated — core/.claude/workflows/orchestrate.js, core/.claude/agents/orch-merge.md, kit.config.json, tools/lib/kit.mjs
- [ ] A2: Let a plan mark a check that runs from the main folder, where the live environment is — [auto:main] accepted by the Done-when lint, readiness returns mainCommands, the command passes mainChecks, a second gate call with FOLDER = root after the worktree gate, scripts only, failure = real failure, never at merge or final gate — core/scripts/lib/done-when.mjs, core/.claude/agents/orch-readiness.md, core/.claude/commands/orchestrate.md, core/.claude/workflows/orchestrate.js
- [ ] A3: Keep only real decisions so the Human grades choices, not confirmations — take() keeps behaviour:/seen:, counts the rest as decisionsDropped, the command and the report print the count; schema description; gate, ui, builder and agent-roles wording — core/.claude/workflows/orchestrate.js, core/.claude/agents/orch-gate.md, core/.claude/agents/orch-ui.md, core/.claude/agents/orch-builder.md, core/.claude/agents/orch-report.md, core/docs/agent/agent-roles.md, core/.claude/commands/orchestrate.md
- [ ] A4: Start the run on its own when readiness has nothing to ask — readiness() returns askHuman; step 2 starts the run when false; the word ask forces the pause — core/.claude/workflows/orchestrate.js, core/.claude/commands/orchestrate.md
- [ ] C1: Explain the four changes in the docs, one gotcha and the changelog — mergeChecks row, main-folder section, decisions and readiness paragraphs, one gotcha, Unreleased entries — core/docs/agent/orchestrator.md, core/docs/brain/gotchas/agent-workflow.md, CHANGELOG.md
- [ ] T1: Prove each change with tests that would fail today — unit tests (merge CHECKS, main gate call and folder, dropped main command, decisions filter and count, askHuman), e2e (zeta merge CHECKS, run iota, askHuman), install-check (render, docs, refusals), Done-when tag test — tools/test/orchestrator.test.mjs, tools/test/ui-tier.test.mjs, tools/orchestrator-e2e.mjs, tools/fixtures/orchestrator/plans.mjs, tools/install-check.mjs
- [ ] R1: Render the kit's own copies and check drift — scripts/, .claude/, docs/agent/, docs/brain/, .kit/install.json

## Out of Scope

- Running `commands.logQuery` automatically as a main-folder check for every plan (it needs judgment: "an entry not
  explained by the plan"; `/review-it` keeps that).
- Copying `.env` into worktrees or the merge folder.
- Parallel merges, or merging without any check.
- Bisecting which merged plan broke the final gate when several merged (plan 030's run log records the miss; the
  report names the merged plans in order).
- The project's own test speed (a 4-minute test pass is the floor the kit cannot move).
- Plan 030's lessons, rules per role and run log; plan 031's required-step markers.

## Critical Questions

- Q: Should the merge step keep lint? A: no — the final gate runs it once on the run branch, and a lint failure there names the file. `full` is one config word away.
- Q: Why a tag (`[auto:main]`) and not a readiness-agent guess? A: the plan author knows which check reads the live environment; a tag is lint-checked and visible in the plan, a guess is not.
- Q: Why drop confirmations in `take()` instead of only asking agents to stop? A: the wording helps but the filter is what guarantees the count; a dropped line costs nothing, a kept one costs an agent call and a grading line.
- Q: Does auto-start remove a safety stop? A: the preflight in step 1 already refuses a dirty main folder, a live run, a scope overlap and missing packages; `go` only added a pause. `ask` keeps it for whoever wants it.

## Execution Notes

- Origin: the Human's run of one project plan on kit v1.10.0 (2026-10-29): 26 minutes end to end, merge step 6 min
  over two attempts, 15 decisions (11 confirmations), 6 min readiness + `go`, a log check that needs `.env` parked
  the plan at the merge. Plan 029's Execution Notes list the same four leftovers.
