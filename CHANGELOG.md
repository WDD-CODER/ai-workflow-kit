# Changelog

All notable changes to the kit. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [semver](https://semver.org/): a major release says what a project must do; minor and patch
releases never need action. (Before 1.0.0, a minor bump could change how projects install or sync.)

Releases are git tags `vX.Y.Z` with a GitHub release. Install or upgrade to one with
`--source github:WDD-CODER/ai-workflow-kit --ref vX.Y.Z` (see the README).

## [Unreleased]

### Added
- **Style QA browser sweep: `node scripts/styleqa/run.mjs --layers=sweep`.** Playwright opens every page × state × width of the page map, an in-page probe measures layout (L1–L6), native-looking controls (U1), off-token values (T1–T3) and tap targets (G5), axe checks colour contrast (A1), and bounded screenshots (at most 4 viewport-high segments) are attached to each finding. A request guard aborts every non-GET request, so a run never writes to the server. New pack-contract key `styleqaRoutes` (the angular pack reads the router file) powers a map check that fails on a route in neither `pages` nor `excluded`; `--changed` limits the run to changed pages. `@playwright/test` and `@axe-core/playwright` come from the project (the engine stops with the install line when missing).
- **Style QA engine, static layer: `node scripts/styleqa/run.mjs`.** It reads the project's stylesheets and lists the literals that bypass the design tokens: S1 a literal px width in a media query, S2 a colour literal outside the token definitions, S3 a font-size literal, each with file and line. Every finding has an ID that survives unrelated edits, is `new`, `known` or `gone`, and goes into one report (`.claude/styleqa/report.md`, git-ignored) ordered for fixing: summary, shared components to fix once, per page, rails, static findings by file. No token or credential reaches the report. Settings are the new `styleqa.*` keys of `kit.config.json` (install and sync refuse a bad value, naming the key); the page map is the project's own `docs/qa/styleqa-pages.json` (`--pages` takes a slug or an alias, `--list` prints them; an unknown name stops the run with every valid one). A theme-facts seed, `docs/qa/styleqa-theme.md`, ships too. The browser sweep and `/styleqa` come next.

### Fixed
- **The run reads its merged plans from origin, not from a stale local run branch.** The dry run passed the local run branch to `plan-order.mjs`, so a local branch left behind by `git worktree add -b` put plans already merged on `origin/<run branch>` back into wave 1. The run now fetches and reads `origin/<run branch>`, and the local branch only when origin has none. A local branch that is not in origin's history prints one warning line with both SHAs.
- **A question nobody answers no longer parks its plan after 3 hours.** A park costs a full relaunch, while waiting costs nothing, and the Human may simply be away. Now an ask still open after `ASK_WAIT_MIN` (180 min) gets one run note, `ask <id> still open after <n> min — still waiting` (again at most once an hour), and stays answerable. Only an ask unanswered for `ASK_PARK_MIN` (24 h) parks, so a run still ends some day.
- **Merging main into a run branch no longer clashes in `docs/brain/run-log.md`.** Every run appends its row at the same place, so about 10 merges in 2 days stopped on that file. The installed `.gitattributes` now marks the run log `merge=union`, and the run-log reader keeps one row per run, so a row both sides rewrote is folded and the next run writes a clean log. Only this kit file merges this way, never code. A project that keeps its own `.gitattributes` adds the line `docs/brain/run-log.md merge=union` itself.

## [3.2.2] - 2026-11-12

Patch: no project action. Sync it between orchestrator runs, never during one. A plan scope line that is only a test
file's name (`x.spec.ts`) now stops the save and the dry run: write it as the path from the repo root.

### Fixed
- **A run branch made from another run branch no longer rebuilds that run's plans.** `plan-order.mjs --merged-from git` (the dry run's waves) counted a plan as done only from a merge into the same branch, so a chained batch put the previous batch's merged dependencies back into wave 1. A merge into any run branch in the branch's history now counts.
- **`orch-state.mjs watch` says `STARTING` for a run the supervisor is still starting.** Until run-plans.mjs wrote its first state (after its preflight and plan lint, about 2 minutes), watch failed with "no run", and the `/orchestrate` wait loop ended at once. The supervisor now writes supervisor.json before its first launch, watch prints `STARTING` (exit 0) while it is alive, and the loop waits on `RUNNING` or `STARTING`.
- **`next-plan-number.mjs` no longer crashes in a repository with many branches.** With about 290 refs and 600 plan files each it threw "Maximum call stack size exceeded". It now keeps a running maximum and reads each commit's plans once, so refs at the same commit cost one `git ls-tree`.
- **A builder may change a test beside a file it is allowed to change, assertions included.** The run refused such a test when its diff changed an assertion, which any behaviour change needs, so plans stopped for an `approved:` after two lost builder rounds. The reviewer now judges a changed assertion against the plan (`weakened test`). `scope-check --tests` runs the run's own test-file check on the test paths the plan names (`warn`, with the line to add), and a scope line that is only a test's file name is `SCOPE_TESTS: bad` (exit 1) and a dry-run problem.

## [3.2.1] - 2026-11-11

Patch: no project action. Sync it before a long orchestrator run.

### Fixed
- **A run no longer holds every plan's builder folder on disk until it ends.** A 13-plan run needed about 18 GB because 3.2.0 removed builder folders only at the run's end. Now, when a plan that built in its own folder merges, `orch-state.mjs release` removes that folder at once with `worktree-clean.mjs`'s rules (clean, not parked, not in a hand-off, its branch in `origin/<run branch>`); the branch is kept, and a folder it cannot remove is one line, never a stop.

## [3.2.0] - 2026-11-10

Minor: no project action. Sync it, and the folders agents left beside the project are cleaned up on the next sweep.

### Added
- **The kit removes the worktree folders it and its agents made, by script, without asking the Human**. `scripts/worktree-clean.mjs` judges every kit-made worktree `git worktree list` shows (`<repo>-orch-*` builders, merge and review folders, `<repo>-review-*`, `-fix-*`, `-scratch-*`, `-kit-*`, `-sync-*`, `.claude/worktrees/*`; never a `wt-N` slot or a folder you made) and removes one when it is clean, its run is not live, no hand-off names it, it is not on `park/…`, and its work is safe elsewhere (merged, upstream gone, a detached commit on an origin branch; a merge folder waits until its run branch is merged). `git worktree remove` without `--force`, 3 tries, then a scripted delete for a Windows folder git cannot empty. Every kept folder gets one reason line; nothing stops to ask for a delete. The run supervisor sweeps at a run's end as well as its start, and `free-merged-slots.mjs` (the Planner's sync) sweeps too.
- **Agents never delete a folder themselves.** `/review-it` makes and removes its review folder with the script (also after an early STOP), `/fix` and the git-workflow gotcha use `worktree-clean.mjs add … / remove …` for a scratch checkout, and `.claude/settings.json` allows `node scripts/worktree-clean.mjs` by name, so auto mode does not refuse it (auto mode drops the blanket `Bash(*)` rule).

### Fixed
- **`prune-merged-worktrees.sh` no longer force-deletes.** It ran `git worktree remove --force … || rm -rf` on a merged `.claude/worktrees/*` folder without checking it was clean; it now hands each folder to `worktree-clean.mjs --path`.

## [3.1.3] - 2026-11-10

Patch: no project action. Sync it to get the plan-name limit.

### Fixed
- **The mods marketplace installs on Windows without `core.longpaths`.** `claude plugin marketplace update ai-workflow-kit-mods` failed with "Filename too long" on a 194-character plan path. The 12 plan files over 140 characters are renamed to short slugs (their titles stay), and a kit test (`tools/test/path-length.test.mjs`) fails on any tracked path over 140.
- **A new plan's file name stays short.** `scripts/plan-write-guard.sh` refuses a new plan file whose name is over 100 characters, and save-plan says the slug is a short form of the title, so a closed plan's path stays well under the limit.

## [3.1.2] - 2026-11-10

Patch: no project action. Update fleet (`claude plugin update fleet@ai-workflow-kit-mods`) to get it.

### Fixed
- **The running step's clock is readable** (fleet 0.6.2). The run panel drew `build ▶1:45`; in a terminal that draws ▶ wide, the arrow covered the first digit. It is now `build ▶ 1:45`.

## [3.1.1] - 2026-11-10

Patch: no project action. Update fleet (`claude plugin update fleet@ai-workflow-kit-mods`) to get it.

### Fixed
- **The fleet ship badge counts only this session's files** (fleet 0.6.1). It counted every line of `git status` in the folder, so old untracked folders and another session's work showed as `● 3 files → /ship` in a session that had changed nothing. Now what was already changed when the session started shows apart, quieter, as `+3 not this session`, until this session edits it; `/health` says the same.

## [3.1.0] - 2026-11-09

Minor: no project action. Sync it and update fleet (`claude plugin update fleet@ai-workflow-kit-mods`) to see a run live.

### Added
- **The fleet run panel shows a run live** (fleet 0.6.0). Per plan: a step bar (build · gate · review · merge) with each finished step's time and a clock that ticks every second on the running one; the model, round and tokens; at the gate, the check running now (`gate 4/16: pnpm run test:ci · 0:42`); while building, the builder's last tool and file, its tool count and tokens so far. The run line has the elapsed time and total tokens. Fleet re-reads every 5 s while a run is live.
- **The run writes a live file per plan.** `scripts/run-plans.mjs` writes `.claude/orchestrator-runs/<run>/live-<NNN>.json` (step, gate check, builder activity; `scripts/lib/run-live.mjs`) and keeps the builder's stream in `builder-<NNN>.events.jsonl`. The builder's call streams (`--output-format stream-json --verbose`); its result is read exactly as before, and a rate limit is read only from the result, stderr or a rejected rate-limit event, never from tool output.

### Fixed
- **The run chip appears without a new message.** Fleet only started watching after a `Workflow` call, but `/orchestrate` starts the run with a Bash call to `scripts/run-supervisor.mjs`, so the chip showed up only after the next answer. Fleet now starts watching on that call. Its dead workflow-journal reader is removed.

## [3.0.2] - 2026-11-09

Patch: no project action. Three fixes found by real runs and by the new validation run.

### Fixed
- **A builder writes the test beside a scoped file instead of asking.** The gate already allowed it (3.0.0), but the builder's instructions did not say so, so a real builder stopped with `ESCALATE: scope` on `x.spec.ts` next to a scoped `x.ts` (`.claude/agents/orch-builder.md`).
- **A leftover builder folder no longer parks its plan.** On Windows `git worktree remove` can fail on `node_modules` ("Directory not empty") and leave a folder that is no longer a worktree; the next run parked the plan with "is on (no branch)". Now a park deletes what git left, and a run that finds such a folder removes it (or renames it aside) and makes a fresh one.
- **A relaunch runs a final gate that was cut off.** A run stopped during its final gate, with every plan merged, said "nothing to build" on relaunch and never finished. Now it runs the final gate only and finishes (the dry run says `WOULD START: yes — the final gate only`).

### Added
- **Kit only: the orchestrator's behaviours are proved in a sandbox.** `node tools/validate-orchestrator.mjs` stages five cases (a run that survives its session, a sibling test, a plan file edited mid-run, missing packages in the merge folder, a question that stops only its plan) in throwaway projects and decides PASS or FAIL from the run's own files, quoted in one report. Fake mode runs in CI (`kit-tests`); `--mode real` uses Sonnet under a token cap; `--kit-ref v2.1.0` is the negative control. `/validate-run` runs it and prints the report (`docs/agent/kit-validation.md`). Nothing is rendered into a project.

## [3.0.1] - 2026-11-09

Patch: no project action. Sync it before the next `/orchestrate` — on 3.0.0 every run crashed at start.

### Fixed
- **A run started by the supervisor no longer crashes before it starts.** On 3.0.0 `scripts/run-plans.mjs` called `dirname()` on a null console-log path whenever `scripts/run-supervisor.mjs` started it (which `/orchestrate` always does), so every run ended at once with `TypeError [ERR_INVALID_ARG_TYPE]` and the supervisor read it as refused. A new test in `tools/test/run-supervisor.test.mjs` runs the real `run-plans.mjs` under the supervisor to a merged plan.
- **A supervised run no longer flashes a console window for each command on Windows.** The supervisor starts the run with a hidden console of its own (not detached on Windows), and every `git` and `node` call the run makes shares it; before, each one opened and closed a window and took the focus. Elsewhere the run still starts in its own process group.

## [3.0.0] - 2026-11-09

Major: three project actions, all listed below with **Project action:** — keep the kit's guard hooks in
`.claude/settings.json` to run `/orchestrate`; add `Reviewer: advisory` to a plan's `## Execution Mode` to keep its
review advisory (the default is now `gate`); set `orchestrator.useSlots: true` if builders should use the `wt-N` slots.

### Fixed
- **Every run folder repairs its environment, and a plan's gate runs what the final gate runs.** `ensure-env` installs the root, backend and `scripts/` packages (skipped when the lockfile hash is unchanged) before the builder, the gate, the merge checks, the final gate and a park; an environment failure gets a clean reinstall of the failing tree before its one retry. An `orch-state` call with no readable answer is asked again (3 times, 2 s apart, for read and repeatable commands), `git fetch`/`git push` retry on a transient error, and the preflight turns on `core.longpaths` on Windows. Each plan's gate also runs `orchestrator.ciMirror` and the manifest check on the plan's own folder; a final-gate failure naming a file one merged plan changed gives that plan one fix round; a builder's `notDone` Done-when item fails the gate instead of merging.
- **A run asks one plan at a time through one ask file, and no PR merges without the Human.** Every question a run raises (a builder `ESCALATE` or `planChange`, a `db-write`, the same reason twice, the fix rounds used up, a review that could not run after one retry) is one file `.claude/orchestrator-runs/<run>/asks/<NNN>-<n>.json` with its kind, question, options, recommendation and whether only the Human may answer it. Only that plan waits (`asking`); what it would block is held, and the rest of the run goes on. Once every other plan has ended the run polls the answers for up to 180 minutes (fixed in code), then parks an unanswered plan with its question in the report. `orch-state.mjs watch` prints each open ask as a card; `orch-state.mjs answer --run <run> --id <id> --choice <n>` (or `--text`) answers it, and the plan resumes in the same run from its saved work with the answer in the builder's task; a scope answer adds its paths to the plan's scope first. An advisor's answer to a Human-only ask is refused. The builder names its question's kind in its result (`docs/agent/agent-roles.md`). `docs/agent/orchestrator.md` says merging a plan into the run branch is the run's own step, and merging the run branch into main is the Human's.
- **Plan-file conflicts resolve themselves, and a relaunch resumes a plan from its saved work.** A merge whose only conflicts are in `plans/**` is completed with the run branch's copy (a run note names the file); any other conflict still fails. A plan file changed on the run branch during the run is recorded by the script (a run note, a `## Plans changed during the run` report section, one `## Execution Notes` line, a warning for a `plan(NNN):` commit with under 10 characters of reason). A stale `feat/<NNN>` is renamed to `park/stale-<NNN>` at the plan's start (the dry run prints `WILL RENAME`, not a refusal). A relaunch continues a plan that stopped for a reason that was not its code (death, time limit, environment, rate limit) from `park/<run>-<NNN>` with its round, tier and hand-off, or runs the gate on a built `feat/<NNN>`; a plan parked for its own code is rebuilt as before.
- A plan may change the test file next to a file its scope lists (`x.component.spec.ts` beside `x.component.ts`, same
  folder or a `__tests__/` directly under it) without a scope line; a sibling test whose diff removes an assertion is
  refused (`sibling test weakened`), any other test location still needs a line, and the dry run flags a test path a
  plan names that its scope does not cover. The reviewer stops a test made easier to pass.
- **A run survives its session.** `scripts/run-supervisor.mjs` starts `run-plans.mjs` detached from the Claude Code session (its output appended to `.claude/orchestrator-runs/<run>.console.log`), sweeps what dead runs left, relaunches a run whose process died up to 3 times (after waiting for 4 GB of free memory, up to an hour), and relaunches a rate-limited run after the reset (waits capped at 6 hours). Both limits are fixed in code, not settings. `orch-state.mjs stop` keeps every stop in `status.json` `stops[]`, and the report lists them under `## Stops`.
- **The Human can see a run and validate at its end.** `scripts/run-plans.mjs` appends every line it prints to `.claude/orchestrator-runs/<run>.console.log` (a relaunch adds to it); `status.json` names the model, tier and start time of every call under `plans.<NNN>.models` while the call runs; `orch-state.mjs watch` prints one line per plan (state, round, tier and model, minutes in that state, the last `calls.csv` row). `/orchestrate` ends a run by serving the run branch in an idle slot when a card needs the app, checking every card URL answers and printing the cards unasked, and starts a second run beside a running one only with 4 GB of free memory. `decision-log.mjs grade` refuses a folder on the main branch. The scaffold now says `orchestrator.useSlots: false`, so builders never take the Human's slots. **Project action:** a project that wants builders in its `wt-N` slots sets `orchestrator.useSlots: true`.
- **A run never waits for the Human and never wastes a build.** `/orchestrate` starts the run right after `WOULD START: yes` (no reply `start`) and relaunches a killed background run once. A builder has no wall-clock limit any more: it is stopped only after 15 minutes in which no file in its folder changed (a fixed limit, not a setting), and its work is kept on `park/<run>-<NNN>`. A builder ESCALATE on scope parks the plan `replan needed` at once. The dry run refuses what the real run refuses (test-file scope, a stale `feat/<NNN>`, a check command the runner cannot run). Parking renames `feat/<NNN>` to `park/<run>-<NNN>`. `orchestrator.reviewerMode` now defaults to `gate`.

### Security
- **`scripts/run-plans.mjs` always enforces the review of a sensitive diff, and no headless agent gets an interpreter-wide Bash prefix.** A plan whose diff touches a sensitive path (ship-prep's own check, now exported as `isSensitive`, with `security.sensitivePaths` included) is reviewed as `gate` even when its `## Execution Mode` says `Reviewer: advisory` or the run says `--reviewer-mode advisory`: a reviewer STOP gets one fix round, then the plan parks, and a review that could not run parks the plan instead of leaving a note. The reviewer is pre-approved its read tools only (`git diff`, `git show` and `node --test` are gone: a prefix cannot refuse `git diff --output`, and `node --test` ran any test file the reviewed diff brought; its diff and receipt come inline). `BUILDER_BASH` is removed: `allowedTools()` throws for a writing agent without guard hooks, and a run (and its dry run) refuses to start when `.claude/settings.json` has no `PreToolUse` hooks. **Project action:** keep the kit's guard hooks in `.claude/settings.json` to run `/orchestrate`.

### Changed
- **`docs/brain/human-decisions.md` holds 205 more of the Human's decisions (kit repository only).** Mined from the planning chats of the kit and the app project (2026-09-30 → 2026-11-08), anonymised, as D31–D235 in the Decisions table, with a new `taken?` column and a `status` per row: `in force`, `in force (app)`, `superseded by D<n>`, `frozen`, `done` (a one-time decision: test material, never a default) or `open`. `/plan` and `run-plans.mjs` answer `default per D<n>` from it as before; only `in force` rows answer. D16 is superseded by D234: no advisor agent for now. The rules mined with the rows are sections 2.1 and 2.2. No project action.
- **`scripts/run-plans.mjs` checks the Human's recorded decisions and two hard limits before any build.** A Critical Question answered `A: default per D<n>` stands only while D<n> is `in force` in `docs/brain/human-decisions.md`; a superseded, frozen, open or missing row, or no file, makes the plan not ready with `default per D<n>: decision is <status> — ask the Human`. A question that names production (`production`, `prod`, `live`, whole words) and a database or folder needs the Human's own answer (`A: (Human, <date>) …`), never a default. A run option above what the plan's `## Execution Mode` asks for is refused: `--concurrency 2` needs `Concurrent plans: <another plan of the run>`, `--reviewer-mode advisory` needs `Reviewer: advisory`, `--db remote` needs `Database: remote`. The config default `orchestrator.reviewerMode: advisory` is never refused but applies only to a plan with the `Reviewer: advisory` line; every other plan's review is enforced (`gate`). The builder's task carries both limits word for word. The file is read, never written. **Project action:** add `Reviewer: advisory` to a plan's `## Execution Mode` to keep its review advisory.
- **`/plan`'s Architect + PM review answers a question from the Human's recorded decisions instead of asking.** When `docs/brain/human-decisions.md` exists, the review reads its Decisions table first; a row whose status is `in force` and answers the question becomes `default per D<n>: …` in the draft, and no `open:` line is written. Superseded, frozen and open rows answer nothing; two `in force` rows that disagree are asked about, with both ids. The file is read, never written; without it the review behaves as before. No project action.

## [2.1.0] - 2026-11-07

### Fixed
- **`kit-sync -Apply -Prune` removes a project override of a file the kit retired.** Until now such an override only printed `NOTE override <path> is not a file this kit ships`, so a deleted command stayed in the project (an installed project kept `.claude/commands/auto-solve.md`). The files the kit deleted are listed in `tools/retired-files.json` (seeded with the nine files deleted with the workflow runtime). A dry run prints `pruned-override <path> — override of a file the kit retired (on --apply --prune)`; with `--apply --prune` the entry leaves the config's `overrides` (other entries and the formatting stay), and the file is deleted when unchanged since the kit shipped it, or moved to `.kit/pruned/<path>` when the project changed it. An override of a path the kit never shipped stays a NOTE and is never touched. No project action.

### Removed
- **The orphaned `docs/brain/triage-calibration.md` (kit repository only).** Nothing has read or written it since `decision-log.mjs stats` stopped writing it; the kit-owned `docs/agent/kit-lessons/triage-calibration.md` stays. ADR `docs/brain/decisions/0019-run-plans-reviewer-default-is-sonnet.md` supersedes ADR 0017 for the reviewer default only: `orchestrator.reviewerModel` defaults to `sonnet`, and a change of default follows the reviewer eval's `REVIEWER:` line. No project action.
- **The workflow runtime and what only it used (ADR `docs/brain/decisions/0018-workflow-runtime-deleted-checkers-kept.md`).** `scripts/run-plans.mjs` runs the loop, so these files are deleted from `core/` and from every installed copy on `kit-sync` (`--prune`): `.claude/workflows/orchestrate.js`, `.claude/commands/auto-solve.md`, `.claude/agents/orch-gate.md`, `.claude/agents/orch-merge.md`, `.claude/agents/orch-report.md`, `.claude/agents/orch-triage.md`, `.claude/agents/orch-readiness.md`, `.claude/agents/kit-runner.md`, `.claude/agents/kit-prevalidate.md`; in the kit repository also the test fixtures `tools/fixtures/orchestrator/readiness.mjs` and `tools/fixtures/orchestrator/decisions-499-502.mjs`. Every one is recoverable from `fd212e1` (`git show fd212e1:<path>`). `orch-state.mjs` loses `trend`, `main-try`, `main-tries` and the `--notes-b64` / `--flakes-b64` / `--causes-b64` queues; `decision-log.mjs stats` no longer writes `triage-calibration.md`. The five checker agents and `/review-it` stay (`review.ship = checkers`). `orch-preflight.mjs` checks the kept files (`run-plans.mjs`, `orch-builder.md`, `plan-reviewer.md`) instead of the deleted ones; `STALE_RENDER` now follows `scripts/run-plans.mjs`. `orchestrator.md` (137 lines), `agent-roles.md` (94), `model-routing.md` (57) and `workflow-map.md` describe only what exists. A size budget, `tools/size-budget.json`, is enforced by `tools/test/size-budget.test.mjs` (in `npm test` and CI): 24 command files (target 10), 10 agent files (back to 5 when `review.ship` switches to `reviewer`), per-file line limits, `AGENTS.md` ≤ 70 lines, instruction load ≤ 800, 15 orchestrator keys (target 12). Kit version 2.1.0. No project action: the old runtime's leftover keys are dropped with a `NOTE orchestrator: <key> removed` line, as before.

### Changed
- **Only a changed invariant starts the builder on Opus, and the dry run shows the real builder call (INV-1, ADR `docs/brain/decisions/0020-only-a-changed-invariant-starts-on-the-judgment-tier.md`).** A plan's first builder starts on `models.judgment` only when its Architecture Impact `changes` or `deviation`s an invariant (or names one with an unreadable kind); `preserves`, `INV-none` and no section start on `models.build`. `run-plans.mjs --dry-run` builds the builder's argv with the same `builderCall()` as the real call and prints `tier: <tier> (<why>)`, e.g. `tier: build (INV-1 preserves)`; its JSON carries each plan's builder argv. `calls.csv` records the model passed after `--model`. Nothing for a project to do.
- **`/ship` in 79 lines, its checks in code.** Phase 1 is `node scripts/ship-prep.mjs --gate --lane <lane>`: build, lint, the tests on REGULAR, the plan ledger and the override check by `spawnSync`, one `GATE:` line each, exit 1 on the first failure — no `kit-runner` (`/review-it` step 2 runs the same gate). The REGULAR review follows `review.ship`: `checkers` (default, unchanged) runs `/review-it`, the new `reviewer` runs `node scripts/lib/plan-review.mjs --branch <current> --base origin/<main>` (the single reviewer outside a run: agent file and role contract read from the base, a detached review folder, no write tool, the plan out of the diff, a gate receipt in the git folder bound to the tree), `light` runs `/review`. The tree keeps one `Review:` line instead of the six-lens block. Decision grading, the learning step and brain capture run only with the new `review.learn` = `on` (default `off`); install and sync refuse other values of either key. The Commit-vs-PR judgment and "After opening a PR" moved to `docs/agent/standards-git.md`; the grade and learn commands to `docs/agent/decision-review.md`. New `node tools/instruction-load.mjs` sums a worker's five instruction files (exit 1 above 600). Projects: nothing to do — `review.ship` stays `checkers`; set `review.learn` to `on` to keep grading decisions at `/ship`.
- **The agent eval scores what a reviewer sees, and `run-plans.mjs` reviews on Sonnet.** A finding one severity level from the label matches (blocker ~ major, major ~ minor; never blocker ~ minor). On `orch-check-bugs/` and `orch-verify/` cases, whose diff is only a slice of the real commit, a `plan.md` finding of category `done-when`, `scope` or a sub-task id is not scored: a new `unscored` figure in the report, the table and the A/B table. The eval prompt says the diff is the whole change under review. `orchestrator.reviewerModel` defaults to `sonnet` (was `opus`); a project that set it keeps its value. On the fixed eval, Sonnet `--redact --with-gate` scores recall 0.15, precision 0.29 on the 25 baseline cases ($2.51 for 25 × 2; `docs/agent-evals/087-reviewer-ab.md`).
- **The orchestrator as one script: `node scripts/run-plans.mjs --run <name> --plans <NNN,NNN>`.** Readiness lint, preflight, order, state, gate, merge and report are code; only the builder (`orch-builder.md`) and the single reviewer (`plan-reviewer.md`, now on `orchestrator.reviewerModel`, default `opus`) are model calls, each one headless `claude -p` with the four context-saving flags (`scripts/lib/claude-run.mjs`, which the kit's agent eval now uses too). Per plan: builder → gate (script, with a receipt; the scope and manifest checks are the main folder's trusted copies) → review (advisory by default, `orchestrator.reviewerMode`) → `git merge --no-ff` pinned by `orch-state.mjs merge-verify` (the merge commit's second parent must be the checked head) → one push. One fix round, then one fresh judgment-tier builder, then a park that skips only the plans that depend on it. A rate or usage limit pauses for `orchestrator.rateLimitWaitMin` (default 30) and retries once. `--dry-run` prints the waves, the lint, the preflight and every command, and calls no model; `--concurrency 2` runs two plans of a wave at once (default 1). Each run writes `calls.csv`; `orch-state.mjs watch` works as before. `/orchestrate` is now a short command that runs the dry run, prints the `run-plans.mjs` line and starts it on `start`; the workflow file stays for now. The workflow-only keys `orchestrator.pilotSize`, `fallbackModel`, `maxNotesPerPlan`, `maxAgentCallsPerPlan`, `triage`, `triageMinAgreement` and `triageMinGraded` are removed: install and sync ignore a project value with a `NOTE orchestrator: <key> removed` line. Optional for a project: delete those keys from its config; `sync --apply` installs the script.
- **One blinded reviewer, measured.** A new agent, `plan-reviewer` (review tier), reads only the plan's criteria, the branch diff and the gate receipt and returns the finder schema plus `verdict: PASS|STOP` under three rules against a false STOP. On the kit's 25 eval cases (2 runs, blinded, with the gate output) it matches the four checkers' recall within noise (Opus 0.46, Sonnet 0.24, checkers 0.28) at much lower precision (Opus 0.12, Sonnet 0.10, checkers 0.28). The measurement picks Opus, but no arm reaches the 0.50 precision bar, so it is not yet a blocking gate: the next plan runs it advisory (`docs/agent-evals/087-reviewer-ab.md`). The kit eval scores any agent on every case (`node tools/agent-eval.mjs --role all`, the default for an agent that is not a checker), sums role reports into one (`--combine … --as … --out`), and its scratch copy now holds only what the prompt shows (redacted plan, no hidden file, `gate.json` only with `--with-gate`). Nothing for a project to do; the agent is installed but not used by any command yet.
- **Four cheap orchestrator fixes.** The checkers (the three finders, the security reviewer and the verifier, in a run and in `/review-it`) read a copy of the plan without its `## Execution Notes` (`orch-state.mjs plan-info --no-notes` writes `.claude/orchestrator-runs/<run>/plan-<NNN>.reviewed.md`) and no longer run `git log`, so they grade the diff, not the builder's account of it. An escalation to the judgment-tier builder resets the plan's folder to the branch's base after the hand-off file is written (`handoff --reset-base`; `origin/<branch>` follows with a lease, the discarded head is kept as `resetFrom` in status.json), and the fresh builder re-implements the plan instead of patching the failed diff. A fourth `Edit|Write|MultiEdit` hook (`node scripts/lib/guard.mjs write`) runs every `scripts/pre-commit-*.mjs` that exports `scanGuardText` over the text being written and refuses a hit at once (`GUARD <script> line <n>: <rule>`) instead of at the commit after the whole build. A park is torn down by one idempotent script, `node scripts/plan-park.mjs --plan <NNN> [--run <name>] --reason "<why>"`: servers stopped, work saved on `park/<run>-<NNN>`, the session lock deleted, the slot freed or the plan's own folder removed, the local park branch deleted, the park recorded once. Nothing for a project to do; `sync --apply` adds the hook.
- **Cleanup after the reliability run.** A lesson line keeps a file path up to six folders deep (most app paths fit now). After a gate `env-fail`, the probe looks for the failed command's file or script in the folder the gate ran in (`orch-preflight.mjs --probe-dir`), so a check file only the plan's branch adds gets its retry. `node scripts/seed-check.mjs` and `seed-checker.mjs` are no longer asked about as a seed write; any other `seed*` script still is. `/ship` stages `.kit/install.json` when sync rewrote it, so `main` no longer holds a stale manifest. `install-check` reads `--target=<dir>` like `--target <dir>`. The slot-serve port tests and the guard speed test no longer flake under a loaded full suite on Windows. Nothing for a project to do.
- **Small orchestrator and kit fixes.** A final gate that re-runs ok clears the earlier `final gate failed` notes. `scope-check` stops with one usage line (exit 2) when `--diff`, `--plan` or `--base` comes without a value. Readiness asks about a plan that changes code and names no test location, before any builder starts, and that park reason now reads "no scope line names a test location". Park and stop reasons ride base64-encoded (`--reason-b64`), so quotes, brackets and `$` no longer break the call. The report lists every builder tier a plan ran on. `sync` (dry run) and `drift-check` print `STALE_RENDER: .claude/workflows/orchestrate.js — run sync --apply` when `orchestrator.prepare` or `orchestrator.ciMirror` changed since the last sync. Cards never ask the Human to stop slot servers. `node tools/install-check.mjs --target <dir>` prints `RULES_SECTION_MISSING` for each per-role section a project's `docs/brain/agent-rules.md` lacks, and `sync --apply` appends the empty header. A lesson line takes only the finding ids and paths the code makes. The runner agent runs a state write it is given and never refuses it. Nothing for a project to do; run `sync --apply` to get the missing rule headers.
- **A parked plan reruns without parking on its own plan file.** When a relaunch merges the run branch into a reused plan branch and the only conflict is the plan file, `orch-state.mjs worktree` resolves it. The run branch's text is kept, with the builder's ticked sub-tasks and its Execution Notes lines put back (`mergePlanFile` in `scripts/lib/orch-run.mjs`). Any other conflict still parks, now naming every conflicted path. Plan branches are created with `--no-track`, so their upstream is never a run branch, and a reused branch that tracks anything but its own remote branch (this run's or an earlier run's branch) loses that upstream. Builders push with `git push -u origin <branch>`. Nothing for a project to do.
- **The orchestrator stops a plan that will fail before its builder starts.** The run's preflight parks a plan whose prescribed code (fenced blocks and inline code spans) a pre-commit guard refuses, naming the guard line and the plan line, and warns about a `[ui]` card role with no login recipe (new `ui.logins` in the project config: environment variable names only) and about leftovers of earlier runs (plan and `park/*` branches, occupied slots, builder folders). The security guard (`pre-commit-security-grep.mjs`) now catches a log call of a variable assigned from a PII-named expression, and accepts one explained exception per line: `// security-grep-allow: <reason>`. A parked plan's uncommitted work is pushed on `park/<run>-<NNN>` and its slot given back. In a builder's worktree only, a migration, seed or raw database write the plan does not list is refused with `ESCALATE: db-write <command>` and becomes a question for the Human. `/orchestrate … merge` (`args.mode: "merge"`) merges a plan already built and checked, at its recorded checked head, with no builder, gate or checker. A relaunch shows the earlier launch's ungraded decisions instead of `ask: 0`. Optional for a project: add `ui.logins` when its `[ui]` cards log in as more than one role.
- **A gate env-fail probes the failed command.** The environment check after a gate `env-fail` gets `--probe "<command>"` per failed command (`orch-preflight.mjs`): `node <file>` → the file exists; `npm|pnpm run <name>` → the script and `node_modules` exist; anything else has no precondition. A failed probe parks the plan with its message; when no command can be probed the plan parks at once instead of repeating the failure. Lost gate results and builder or merge environment failures keep the old check. Nothing for a project to do.
- **CI runs every kit tool test.** A new `kit-tests` job in `leak-check.yml` runs `node --test "tools/test/*.test.mjs"` on Ubuntu on every pull request, beside `leak-check`; `tools/test/ci-coverage.test.mjs` fails when the job or its steps go missing or a test file falls outside the glob. The final-gate ciMirror test now holds in the kit root too. `docs/CHANGE-LOOP.md` names the local checks, keeps `e2e-check` and `acceptance-check --e2e` in CI, and adds the run scorecard (`docs/brain/scorecard.md`). Nothing for a project to do.
- **Orchestrator lesson lines name a fact the code produced, or nothing.** Fix-round lines carry the failing command kind and the diff file, or the checker finding id (and its `INV-n` rule); a parked plan's line carries only the code-written start of the park reason; the final-gate line carries the kind and the failing file. The category-only lines (`parked: other`, `other rule`, `another failure`, `an open question`, the asked-about line) are no longer written. The script stores the facts (`causeFacts`, `diffFiles`) inside the existing `set` call.

## [2.0.0] - 2026-11-02

**Action for projects (major):** a project whose config sets `models.judgment` to `inherit` or a Haiku value is refused
by sync (`KIT_SYNC: STOP`, nothing written). Set it to `"opus"` (the new default), `"sonnet"`, `"fable"` or a non-Haiku
`claude-` id before syncing. A config with no `models.judgment` key needs nothing.

### Changed
- **The orchestrator's gate runs the kit manifest check for every plan, and can prepare generated files before the tests.** A plan that adds a script, agent, command, skill or ADR now fails its own gate with `unclassified: <path>`
  until the manifest lists it, instead of failing the final gate with no builder left; the merge step still never runs it.
  New optional `orchestrator.prepare` (list of `{ missing, script, in }`, default `[]`): each entry is a first gate command
  (`node scripts/orch-state.mjs prepare`) of every plan gate and of the final gate that runs the project's npm script only
  when the path is absent, so server tests no longer fail in a fresh worktree. Install and sync refuse an absolute path,
  a `..`, a script that is a full command or an unknown field. The readiness agent asks when a plan adds an inventoried
  file without `manifest.json` in scope, and the builder is told the per-plan gate runs the check.
- **A lesson from a final-gate failure now reaches only the role that could have caught it, and a by-hand re-run corrects the
  record.** The run's `status.json` keeps the final gate's result (`finalGate`: ok, failing command, attempt, blamed plan), sent
  with the existing `finish` call. Lessons are routed by the failing command's kind (test to `check-bugs` and `check-plan`,
  lint to `check-rules`, build to `check-bugs`, the manifest check to `readiness`; anything else, and `security`, none) instead
  of to every finder. New `orch-state.mjs final-gate --run <name> --result ok|failed`: after a pass it removes the old
  `final gate` misses and stop reason and rewrites the report and the run-log row from the stored result (a lesson line
  already written at the failure stays, for the role the routing named).
- **An orchestrator run makes far fewer model calls for plain bookkeeping.** Run notes no longer cost a runner call each:
  they are queued and ride on the plan's next state write (`orch-state.mjs set --notes-b64`), and any still queued go on
  `stop` and `finish`; the per-plan note cap counts queued notes. Every decision of a run is one call
  (`orch-state.mjs decisions --b64`, all-or-nothing). Flakes are queued the same way, and `plan-info --with-worktree`
  makes the plan's folder in the same call. `orchestrator.md` lists every runner call site with a recommendation. No
  action needed; a run that dies between two state writes loses the notes queued since the last one.
- **The orchestrator's judgment tier is pinned to a strong model (INV-1).** `models.judgment` now defaults to
  `opus`; install and sync refuse `inherit` and any Haiku value for it, naming INV-1 - a project that set it to `inherit`
  (or all tiers to `inherit` to turn routing off) must name a model. Readiness and the fresh builder always run on it. A plan
  whose Architecture Impact names any invariant but `INV-none` starts on it; other plans start on Sonnet. After one failed
  fix round (whatever `orchestrator.maxFixRounds` is) a fresh judgment-tier builder takes over from a hand-off file the
  script writes (`Done:` from the plan's ticked sub-tasks and the branch diff, `Failed:` from the gate and checker results),
  and if it fails too the plan is parked as `needs the Human`.

### Added
- **`/kit-learn`: the kit turns run evidence into a problem ledger, problem cards, plans and kit-owned lessons** (kit
  repository only). `tools/kit-learn.mjs collect` reads the kit brain, keeps one ledger entry per problem (runs, projects,
  minutes lost, first and last seen, last kit version, status `open | planned | fixed | regressed | dismissed`) and prints it
  ranked by `minutesLost × (1 + ln(runs)) × (projects ≥ 2 ? 1.5 : 1)`, regressed first. A fixed problem whose signature comes
  back from a run whose kit contains the fix (`git merge-base --is-ancestor`) is `regressed`. The session writes at most 5
  cards (cause as `file:symbol`, what should have caught it, options, a recommendation); one reply line (`ok`, `I1 plan`,
  `I2 lesson builder`, `I3 dismiss <why>`, …) goes through `apply`, which records a `proposals` row per card, so a rejected idea
  stays rejected until 2 more runs bring it back. `plan-check` holds a plan from a brain issue to a regression test.
  `docs/agent/kit-lessons/<role>.md` are the kit's own lessons per role (2,000 characters, id-based `tools/kit-lessons.mjs`
  edits, retired only for a positive reason), handed to every role before the project's own; `kit-learn.mjs lessons` reports
  exposures and recurrences, `trend` shows whether the kit gets better, `triage-prior` calibrates a new project's triage from
  every project's grades. The graders (`agent-eval`, the signature code, the leak and secret checks, `tools/test/**`) are
  protected from the loop. The kit-side database role is a Human step (`docs/agent/kit-brain.md`, Setup 8).
- **`/ship` learns from every Worker plan.** Every decision the Human grades at `/ship` is stored, `ok` ones too, under a
  run name stable per plan (`ship-<NNN>`): `decision-log.mjs pending` lists the plan's ungraded `- decision:` lines with ids
  that never repeat, and `grade --mark` tags the graded lines, so a later session does not list them again. A `seen:`
  defect becomes a follow-up row that `/plan`'s follow-ups check shows. A REGULAR `/ship` on a plan branch now reviews with
  the `/review-it` checker pipeline (`review.ship`: `checkers`, the default, or `light` for the single `/review` pass), with
  one fix-and-recheck by the verifier only; `/ship fast` keeps the light review unless the diff touches a sensitive path
  (ADR 0015 supersedes 0007). `/review-it` hands each checker its own lessons (the kit's first) and the `## checkers`
  rules, read from the main folder. Each review writes one fact line (mode, kept, dropped, rechecked, minutes, models) to
  the plan's Execution Notes.
- **The orchestrator preflight starts the main folder's servers itself.** A frontend that does not answer is started by
  `scripts/slot-serve.mjs --main` (`<pm> run <commands.dev>`), and a plan with an open `[auto:main]` item gets the main
  folder's backend on the local database (`commands.devLocal`) — or the remote one (new `commands.devRemote`) when the
  request says `/orchestrate … remote`. No install and no environment changes in the main folder; a held port is refused
  with its holder named; a failed start stops the run with the server's own log lines. A project with `commands.dev` set
  no longer needs its dev server started by hand before `/orchestrate`. `slot-stop.mjs --main` stops only what the
  preflight started; a slot's backend now also runs `commands.devLocal` instead of a fixed `dev:local`.

## [1.13.0] - 2026-11-01

### Added
- **Plans are told to name their test location.** `/plan`, the PRD template and `save-plan` now say that when a step
  changes code that has tests, a scope line must name the test location itself (a tests folder glob or a single test
  file), because a code-folder glob does not cover the tests under it. `scope-check.mjs --tests --plan=<p>` is a
  warning-only shape lint for it (`SCOPE_TESTS: ok | warn | skipped`; docs-only plans are exempt) that `save-plan` runs
  with its other shape checks; it reuses the test-path helper of the test-file gate.
- **The kit brain: every run sends its facts to a private store.** `scripts/brain.mjs` builds documents from a run's
  `status.json` with no model call and no network until it sends (runs, plans with minutes per phase, events with a
  signature that matches the same failure across runs and projects, graded decisions, the Planner's by-hand toil lines,
  lessons) and inserts them into a MongoDB Atlas cluster the kit owner keeps. `orch-state.mjs finish`, `decision-log.mjs
  grade` and, when `KIT_BRAIN_URI` is set, `kit-feedback.mjs` send at their end; a machine that is offline or not set up
  queues the documents under `~/.kit-brain/queue` and the next send drains them; a send never changes a run's exit code or
  report. Secrets and code are cut before anything is queued. Token counts per phase and per role are read from the
  Workflow transcripts, or `null` when the format is not recognised. `tools/brain-query.mjs` (kit repository only) prints
  runs, repeated problems and a per-kit-version trend. New config `brain.projectId` and `brain.enabled`; install and sync
  refuse a connection string in any `brain.*` value (it lives in `KIT_BRAIN_URI`). `scripts/pre-commit-secret-scan.mjs`
  exports its pattern list and no longer runs its git check when imported. Setup and schema: `docs/agent/kit-brain.md`.
- **Orchestrator checkers hardening.** A changed test file that no scope line naming a test location lists is now a
  blocker found by script (`scope-check --diff` prints `SCOPE: test-out <path>`; `orch-state diff` returns
  `testsOutOfScope`), before any finder runs. Two fix rounds that end on the same head sha park the plan
  (`no progress`); a builder's `blocked`/`ESCALATE` result carries `planChange` and a judgment-tier `needed: true`
  parks the plan (`replan needed`); the builder result carries a `done` / `notDone` / `checksRun` receipt that is
  recorded, never trusted; the verifier gets the round's gate (`GATE`). `tools/agent-eval-ab.mjs` compares two
  eval runs with script-computed verdicts; `agent-eval.mjs` gains `--case-list`, `--redact`, `--with-gate` and the
  run-to-run spread. Redaction of the builder's notes for the finders was measured and not adopted.
- **The orchestrator learns from run to run.** Scripts write what a run knows, with no model call: lesson
  lines built from fixed templates (a rule name, a file kind, a count) go to one short file per role under
  `docs/brain/agent-lessons/<role>.md` (`readiness`, `builder`, `check-plan`, `check-bugs`, `check-rules`, `security`,
  `verify`, `ui`, `gate`, `planner`; at most 40 lines / 3,000 characters, oldest out first), and one row per run goes to
  `docs/brain/run-log.md` (20 rows, older ones rolled into one line; the `✗` columns are filled by the next run). Every
  orchestrator role gets its lessons as `LESSONS` (and `RULES`, `RECENT_RUNS`) in its task, marked as data that cannot
  override its instructions; `orch-readiness` asks once, before the run, about a reason that parked a plan in two of the
  last three runs. `docs/brain/agent-rules.md` has a section per role (`builder`, `checkers`, `readiness`, `ui`; 30 lines
  / 2,400 characters each) and a rule starts at the first graded `✗` (`(pending — seen once)`, promoted by the second).
  A graded `checker-miss: yes` also gives a `## checkers` rule and an eval case (`decision-log.mjs case`) without a
  command; a mistake a check could catch is listed under `## enforce candidates` instead. The report ends with the
  character budget of what the next run injects and a trend line (`orch-state.mjs trend`). New seeds under `docs/brain/` (nothing a project must do; a project without them gets `LESSONS: []` until
  its first run writes them); **projects with `docs/workflow-kit/manifest.json`:** classify `docs/brain/run-log.md` and
  `docs/brain/agent-lessons/*` before the next run, or the final gate's manifest check fails. A project's existing
  `agent-rules.md` (no sections) keeps working: it counts as the `builder` section.
- **A parked plan stops only the plans that need it.** New `orchestrator.onPark` (`dependents`, default; `all` is the
  old behaviour): a park skips only the later plans that depend on it (`depends on parked <NNN>`) or share its files
  (`shares files with parked <NNN>`), with the reason in the report; every other plan still runs. `orch-state.mjs order`
  now returns the unmet `edges`. A `stopRun`, a failed final gate and the pilot still stop the run.
- **`removes:` is a third decision type, listed first.** A builder that removes or narrows user-facing behaviour the plan
  does not name logs `removes: <what users lose> — reverse: <how>`; the run report lists it first and adds a card under
  "What only the Human can do". `orch-check-plan` reports an unlogged removed handler or input as `major`
  (stack-specific signals in the angular and react-vite packs).
- **Workflow scout: a weekly page of what is new for your setup.** New `/scout` command collects Claude Code and
  community news since its last run, keeps what fits the project's own files and opens one pull request with
  `docs/scout/<date>.html`: top 5 to adopt, "native feature now replaces your custom part" callouts, community picks
  with license, stars and last commit, and a "Which were useful?" checkbox list. New `scripts/scout/render.mjs`
  (JSON report into a fixed page template; cursors in `docs/scout/state.json`; nothing new = no page) and
  `scripts/scout/pr.mjs` (pull request through `gh api`, which cloud scheduled runs allow). Both refuse secrets,
  machine paths and transcript text. New seed `docs/scout/sources.json` holds the sources and caps. Proposals only.
- **A run ends clean.** `orchestrator.ciMirror` (list, default `[]`) names CI commands the final gate runs after the
  project checks and the kit manifest check; install and sync validate it and print a `NOTE ci-mirror:` line for each
  workflow command the gate does not run. A check that passed only on a rerun (the gate's env-fail rerun, or the next
  gate on the same commit) is recorded as a flake (`orch-state.mjs flake`, `plans[NNN].flakes[]`, `flakes[]`) and shown in
  the report as `## Flaky checks`. `plan-close.mjs` closes a fully ticked plan that never had a todo section and skips one
  the todo-sync bot already closed on `origin/<main>`. `free-merged-slots.mjs` removes the clean merge folder of a merged
  run. `slot-serve.mjs --ref <branch>` serves a branch in an idle slot for validation (`.worktree-validating`); the slot
  views show `validating`, `idleSlot` and `take-plan` skip it and `slot-stop.mjs` ends it.
- **Decision triage.** A run lists each decision once: a repeat in other words (a fix round, a checker, a relaunch) is
  merged in code and shown as `also:`. Decisions are records in `status.json` (no longer notes, so never cut by
  `maxNotesPerPlan`), and a relaunch numbers on without `firstDecision`. One `orch-triage` call per run (new agent,
  `review` tier) recommends a verdict per decision; the code re-applies the hard rules. New `orchestrator.triage`
  (`shadow`, default; `off`; `filter`), `triageMinAgreement` (0.9) and `triageMinGraded` (20). After the Human's reply,
  `decision-log.mjs grade` writes every graded decision to `docs/brain/decision-grades.jsonl`, `stats --write` keeps
  `docs/brain/triage-calibration.md`, graded `seen:` items become rows in `docs/brain/follow-ups.md` (listed by
  `/plan`'s review via `follow-ups --open`), and `orch-state.mjs brain-commit` commits them on the run branch. The
  report's `## Decisions taken` is now `## Decisions` plus `## Run notes`. **Projects with `docs/workflow-kit/manifest.json`:**
  classify the three new `docs/brain` files (`decision-grades.jsonl`, `triage-calibration.md`, `follow-ups.md`) before
  the next run, or the final gate's manifest check fails.
- **Readiness checks what a plan claims against the code.** Up to 8 claims per plan (a count next to a code noun, a
  named symbol said to do something, an "every X" goal) are searched in the code in the same readiness call; a wrong
  count or an "every X" with hits outside the plan's scope becomes a question with a default.
- **A delegated readiness answer never approves a main-folder command nobody saw pass.** New `orch-state.mjs main-try`
  and `main-tries`; a run started with `mainDelegated` keeps only the commands that exited 0 from the main folder.
- **`npx` checks are kept as project scripts.** An `npx <tool> …` check maps to the package.json script that runs it,
  or is listed under `dropped npx checks:` in the readiness summary and the run report; `/plan` writes
  `<pm> run <script>` checks.
- **A run no longer pauses for `go` on a main-folder command it would drop** (a slot-only `--since=plan-start` check).
- **The run report lists the app errors logged during the run.** When `commands.logQuery` is set, `orch-state.mjs
  finish` runs it once from the main folder with `--since=plan-start` replaced by the run's start time and adds an
  `App errors since the run started` section (command, exit code, first 20 lines).
- **The final gate runs the kit manifest check.** A project with `docs/workflow-kit/manifest.json` gets
  `node scripts/kit-manifest-check.mjs` in the run's final gate, so a file no manifest entry classifies fails the
  run, not the pull request's rules job.
- **An override cannot drop a step the kit requires.** The kit's `ci.yml` and `security.yml` mark load-bearing steps
  with `# KIT:required`; `.kit/install.json` records them (`required`). New `scripts/override-check.mjs` (CI `lint` step
  **Kit override check**, `/ship` Phase 1, `--list`) and `kit-drift` (`override-missing-step`) fail by name when an
  overridden workflow lacks one. The kit's own checkout is skipped.
- **A slot merge deletes the branch only when the repo does not.** New `scripts/branch-autodelete-check.mjs` reads
  GitHub's `delete_branch_on_merge` setting and the pull-request workflows and prints `auto`, `manual` or `unknown`;
  on `auto` the merge skips `git push origin --delete`, and a branch that is already gone is never reported as open.
- **Fleet shows orchestrator run progress in the dock** (fleet 0.5.0). While an `/orchestrate` run is live in the
  checkout, the dock shows `run <name> NN%`; pressing it (or `r`) opens one plain line per plan (stage, time in it,
  what the current agent is doing, from the workflow journal) and the run's `orch-state.mjs watch` line, in the
  warning colour on `STUCK`. Read-only and token-free: it reads `status.json` and the journal and runs `watch`.

- **Nightly skill improver.** `tools/skill-improver/` (evidence, picker, runner with a reusable `lib/` core and
  a `--target` switch), the `/improve-skill` command, the blind `skill-judge` agent (review tier, never Haiku) and
  `kit-skill-improver.ps1` (daily 02:10, AC power only, never catches up). One skill per night, a PR only when the new
  version beats the old one on its evals; hard token cap, path guard and leak guard; every run prints its billing mode
  and logs tokens and dollars to `~/.claude/skill-improver/spend.jsonl`. See the README section "Skill improver".

### Fixed
- **A run no longer stalls on a slot-only check.** A main-folder check that reads a slot's plan-start stamp
  (`--since=plan-start`, `.slot-plan-start`) is dropped at launch with a note; it could never pass from the main
  folder and once cost three fix rounds and a restart. Readiness leaves it out of `mainCommands`.
- **"main untouched" ignores the Planner's plan pushes.** The run report says `untouched: yes` when only plan files
  and `.claude/todo.md` changed on main during the run, and counts them.
- **A plan number counts the plan files on every branch.** `next-plan-number.mjs` read plan files only in the
  checkout, on `origin/<main>` and in the main worktree, and took the rest from branch names shaped
  `<type>/NNN-<slug>`, so two plans saved on a `plan/<slug>` branch were invisible and their number was offered
  again. It now reads `plans/` on every local and remote branch (one `ls-tree` per ref), whatever the branch is called.
- **A slot recorded under another spelling of its path is still the same slot.** `releaseRunSlots` and
  `free-merged-slots` matched a run's recorded slot to `git worktree list` by string, so a Windows 8.3 short name
  (`RUNNER~1`) or an alias was reported "no longer a worktree" and the held slot was forgotten while still checked
  out. Both now compare canonical paths (`samePath` in `orch-folders.mjs`). The Windows e2e on `main` is green again.

## [1.12.0] - 2026-10-29

### Fixed
- **A bad copy of a state line no longer parks a plan.** The orchestrator reads every `orch-state.mjs` result as a
  `kit-runner` agent's copy of its `ORCH_JSON` line; a run once parked a plan at `worktree` on a line the command had
  printed well. A copy that does not parse is now asked for once more (effort `medium`), with a run note `runner
  retry: … — first attempt: <error>`; `note` and `finish` are never retried. A second bad copy parks the plan with the
  parser's message, the first non-ASCII character and the raw line (JSON-escaped), instead of the bare `unreadable
  ORCH_JSON`. A `\r`, backticks around the line and text after the closing brace parse without a retry.

### Security
- **A run with a main-folder check always waits for `go`.** An `[auto:main]` command runs in the live main folder
  (`.env`, database, server), and since 1.11.0 a run with nothing to ask started on its own — a review flagged that
  such a command could run with no `go`. Readiness now lists every main-folder command under `mainApproval` and makes
  `askHuman` true; `/orchestrate` shows them and waits, then passes `"mainApproved": true`; the workflow refuses to
  start a run with `mainChecks` and no approval (`stopped: main-approval`, before `init`). A run without `[auto:main]`
  items still starts on its own.

### Changed
- **Quotes stay legible in run notes and reasons.** The workflow's shell quoting turns `"` and backticks into `'` and
  a backslash into `/` (instead of a space), so a raw JSON sample in a note or a park reason keeps its shape.
- **The runner runs only its list.** `kit-runner.md` says it in so many words — no `git pull`, `git checkout`,
  `git fetch` or install to prepare the folder — and copies an asked-for output line character for character; the
  orchestrator marks its state command `[capture]` so the runner's own full-output rule applies.

## [1.11.0] - 2026-10-29

### Added
- **A light merge step.** `orchestrator.mergeChecks` (`build`, the default, or `full`): the merge step runs the
  project build plus the plan's own scope check on the merged tree, not the whole check list — lint and tests
  passed in the plan's gate and run once more at the final gate on the run branch. A merge once cost three full test
  passes per plan, on the serial path where the run's wall time goes. `full` keeps the old behaviour.
- **Checks that run from the main folder.** A Done-when item tagged `[auto:main]` is an `[auto]` check that reads
  the live environment (`.env`, a database, a log) a worktree and the merge folder never have. Readiness lists its
  command under `mainCommands`, `/orchestrate` passes `mainChecks`, and the run executes them from the main folder in
  a second gate right after the plan's worktree gate (project scripts only: `node scripts/…`, `node tools/…`); a
  failure is a real failure (`gate (main folder): <command>`) with a builder fix round. Neither the merge step nor the
  final gate runs them. The Done-when lint accepts the tag.
- **A check for a file that does not exist is refused at readiness.** `orch-state.mjs check-files` names the check
  files that are neither in the main folder nor created by the plan; readiness drops those commands with the reason
  and asks the Human, instead of the run spending fix rounds and a stronger builder on a check no builder can fix.
- **No pause when there is nothing to ask.** The readiness result carries `askHuman`; when every plan is ready with
  no question and no environment need and the preflight passed, `/orchestrate` starts the run at once instead of
  waiting for `go`. The word `ask` in the request keeps the pause.

### Changed
- **Decisions are `behaviour:` and `seen:` entries only.** The workflow drops every other `decisions` line an agent
  returns (confirmations, evidence — a run once had 11 of 15) and only counts them (`decisionsDropped`, printed as
  `dropped <n> confirmation line(s)`): each kept line is a run note (an agent call) and a line the Human grades. The
  gate, UI and builder role files no longer ask for confirmation entries; `agent-roles.md` rule 9 says where the rest
  goes.

## [1.10.0] - 2026-10-29

### Added
- **The orchestrator survives a blocked model and says when it is stuck.** A dead agent (one that returned
  nothing — a terminal API error, a blocked model) is retried once on `orchestrator.fallbackModel` (default `opus`;
  `inherit` = no retry; never Haiku) with a run note naming both models. Hard limits per plan: `orchestrator.maxNotesPerPlan`
  (default 12; every run note is one runner agent call), `orchestrator.maxAgentCallsPerPlan` (default 60, then the plan
  is parked as `agent-call limit`), and the same failure reason twice in a row parks the plan at once. New command
  `node scripts/orch-state.mjs watch --run <run>`: one line from `status.json` only — `RUNNING`, `FINISHED`,
  `STOPPED: <why>` or `STUCK: plan <NNN> · <state> · no progress for <n> min · last: <note>` (exit 1) after
  `orchestrator.staleMin` minutes (default 10) or the same note twice in a row. `/orchestrate` tells the Human the line
  to run in a second terminal and prints `STUCK` first when a run ended on a limit.
- **Running beside a Planner session.** `orch-state.mjs init` gives the run branch an empty first commit, so a builder
  branch cut from it is never an ancestor of `origin/main` and `free-merged-slots` cannot free a slot the run holds;
  `free-merged-slots` also leaves alone every slot a live run holds. The preflight (`--plans`) refuses a second run that
  names a plan of a live run or a plan whose scope overlaps one of its plans. `docs/agent/orchestrator.md` gains
  "Running beside a Planner session".

### Fixed
- **The merge folder has its packages.** `orch-state.mjs init` installs them (the same `ensureDeps` as a builder
  folder); the env-only preflight checks the merge folder too. A run lost a finished plan to `'ng' is not recognized`
  in the merge step.
- A gate that returns fewer results than commands reruns only the missing commands, once, with no builder round; a
  command still missing after that is an environment failure.
- An environment failure at the merge retries the merge only, after the environment check: no builder, gate or
  checkers run again for a branch that is already verified (a run rebuilt two plans from the builder for a merge
  folder without packages).
- The report and the decisions list are written every time a run ends — also when every plan parked or a step threw;
  the local copy comes first, so a dirty merge folder no longer means no report (`reportCommitted: false` says why).
- `init` reads its own clock for `startedAt`; the command no longer passes a made-up time.
- A plan check command carrying `--write`, `--apply`, `--fix` or `--update` is dropped with a run note (a run passed
  `kit-owned.mjs --write` as a gate command).
- `stop` and `finish` give every slot the run still holds back, so a run that ends on an environment failure leaves no
  `wt-N` with a stale `.worktree-plan`.
- A plan whose Architecture Impact lines only `preserves` invariants starts on the build tier; judgment is for
  `changes`, `deviation` or an unreadable line (two runs started on the main session's model for "preserves" lines).

### Changed

- `security.yml` renders the production audit by `project.packageManager`: a pnpm project runs
  `pnpm audit --prod --audit-level critical` (it reads `pnpm-lock.yaml`; `npm audit` fails without a
  `package-lock.json`) in the root and server steps and in `ci.appAuditMode: report`; npm projects render as before.
  The kit-managed `scripts/` audit stays npm. `install-check` renders a pnpm project and asserts it.

### Fixed

- `/ship` lane: on a plan branch (a slot, or a `feat/NNN-…` branch) every dirty file counts, not only the ones the
  session manifest saw through Edit/Write — shell edits, `git rm` and generated lockfiles were left out and a 22-file
  package-manager move was classified FAST. `package.json`, lockfiles (`pnpm-lock.yaml` included), `kit.config.json`
  and `.github/workflows/**` now take the REGULAR lane whatever `security.sensitivePaths` says. `ship-prep.mjs`
  exports `laneFor` and `BUILD_RE` for the tests and runs nothing when imported.
- `/ship` step 3: one `git add` call, stop on a non-zero exit before the commit (a relisted staged deletion once left
  a partial commit).
- `ensureDeps` (orchestrator builder folders) prints `WARN … pnpm ignored build scripts (…)` with the package names
  pnpm 10 skipped; `worktree-setup` says to list them in `pnpm.onlyBuiltDependencies`.
- `/plan` review: a plan that changes a kit-coupled string (install command, lockfile, package manager in `ci.yml`)
  lists `docs/workflow-kit/manifest.json` and runs `kit-manifest-check.mjs`. `CHANGE-LOOP.md` names the plain
  `node tools/sync.mjs` call for agents whose shell refuses `.ps1`.
- `mods/guards` 0.2.1: the guard re-reads the branch on every edit, so `git switch -c chore/…` in the Planner
  folder counts at once instead of every edit being denied as "on main" until the session restarts.

## [1.9.0] - 2026-10-28

### Added
- **A test command for the orchestrator gate that exits.** `commands.testCi` (an npm script name, optional) is run by the gate instead of `commands.test`. The preflight prints a `WARN gate` line when the test script is a watch mode (`vitest` without `run`, `jest --watch`, or a match of the new `orchestrator.watchTestPattern`, a regular expression a project writes for its own framework, e.g. `ng\s+test(?!.*--watch=false)`), and every gate and merge-check command is stopped after `orchestrator.gateTimeoutMin` minutes (default 15) and reported as a fail. **Projects with a watch-mode `test` script:** add a script that exits (e.g. `test:ci` running `ng test --watch=false --browsers=ChromeHeadless`) and set `commands.testCi` to it.
- **Orchestrator builders use idle slots.** A plan builds in an idle `wt-N` slot (detached, clean, no `.worktree-plan`) when there is one, so it installs nothing (a slot already has its packages); else in its own folder, which installs once before the builder starts. `orch-state.mjs release` gives the slot back after the plan merges or parks (never one with uncommitted or unpushed work). Packages are not linked in from the main folder: on Windows `git worktree remove --force` follows a `node_modules` junction and deletes the target. `orchestrator.useSlots` (default true) turns the slot use off, `orchestrator.concurrency` (1-3, default 2) caps parallel builders, and a relaunched plan tells its builder to continue from the commits already on its branch.
- **pnpm.** `project.packageManager` (`npm` default, or `pnpm`) picks the install and run commands in CI, the slot setup and install check, and the orchestrator; with pnpm set, `ci.install` must be a pnpm command (install and sync refuse the npm default). The kit-managed `scripts/` package stays on npm. The security workflow's `npm audit` step is unchanged.

## [1.8.0] - 2026-10-27

### Removed
- **The session-state file.** `/ship` no longer writes `docs/session-state-<branch>.md`, session start no longer reads it, and the Stop and PreCompact hooks no longer check or remind about it. Where work stands is in git, the PR and the plan (checkboxes and `## Execution Notes`); a loose end for the Human goes in the PR body. Scripts `write-session-state.mjs` and `session-state-path.mjs` are gone, the branch/scope guards no longer exempt the file, and the `guards` mod no longer injects it (its `stateInjectChars` option is removed); the fleet mod's `/handoff` writes an untracked `.claude/sessions/handoff-<branch>.md`.
  **Projects:** run `kit-sync -Prune` to delete the two scripts. A project's own `docs/session-state*.md` is never touched by sync; delete it when you like.

## [1.7.1] - 2026-10-26

### Security
- The orchestrator no longer runs a kit script that pushes or changes state (`kit-feedback`, `orch-state`, `decision-log`, `take-plan`, `slot-serve`, `sync`, …) as a plan's check command; a project's own check scripts still run.
- `kit-feedback --text-file` reads only a scratch file under the OS temp folder or `.claude/sessions/`, never a dotfile or a `..` path.

## [1.7.0] - 2026-10-26

### Added

- Decision review and learning loop. Builders no longer invent behaviour a plan does not describe: such a choice gets
  the simplest option and a `behaviour:` decision (a defect noticed but not fixed is a `seen:` decision with
  `file:line`). The run report and the `/ship` close-out number the decisions `D1…Dn`; the Human replies once with
  `decisions: ok` or `D<n> ✗ <what I'd choose>`. When something is graded wrong the learning step runs by itself:
  `scripts/decision-log.mjs` logs it to `docs/brain/decision-log.md`, a mistake that repeats becomes a rule in
  `docs/brain/agent-rules.md` (capped at 30 lines and 2,400 characters; builders read only this file), and
  `scripts/kit-feedback.mjs` (`/kit-feedback`) sends a general lesson to the kit as a pull request under
  `feedback/inbox/` — refusing project names, project paths and code. Nothing graded wrong costs no model call.
  Procedure: `docs/agent/decision-review.md`. New seeds (written once): `docs/brain/decision-log.md`,
  `docs/brain/agent-rules.md`; `docs/brain/index.md` and `AGENTS.md` mention them for new installs.
- `orch-readiness` asks product questions for a plan that changes interactive behaviour and does not say what happens
  on edit, leave, cancel or error.
- `orchestrator.pilotSize` (integer 0–10, default 3, 0 = off): a run with more plans than that builds the first plans,
  stops with the report and the decisions, and starts the rest on the Human's `continue`.
- The orchestrator runs the project's full build and test once on the run branch after the last merge; a failure is a
  finding in the report and the branch is not handed over as clean.
- Eval cases may be labelled `human-verdict <date>:`; such cases stay in the project's own cases.

### Changed

- A checking agent gets at most 5 items: the UI validator's cards run in batches of 5, each a fresh agent.
- A project does nothing; rendered files that change (`kit-update`): the orchestrator workflow, command and docs,
  `.claude/agents/orch-builder.md`, `orch-readiness.md`, `orch-report.md`, `.claude/commands/ship.md`, `take-plan.md`,
  `docs/agent/*.md`; new: `.claude/commands/kit-feedback.md`, `scripts/decision-log.mjs`, `scripts/kit-feedback.mjs`.

## [1.6.0] - 2026-10-26

### Changed

- Validation cards are plain terminal text: `PAGE:`/`URL:` lines, `[1]` numbers and the labels Before, Do,
  Expect, Fail; no WHY line, colors, emoji or circled digits. Every value the Human types or pastes sits alone on its own
  line, in English; the app's own language only as literal app data. A card says "(needs [n] done first)" when it uses data another card
  creates. A project does nothing; rendered files that change (`kit-update`): `docs/agent/job-validation.md`,
  `.claude/commands/ship.md`, `.claude/commands/done.md`, `.claude/commands/take-plan.md`, `.cursor/commands/done.md`,
  `.cursor/commands/ship.md`, `AGENTS.md`.
- The validation hand-off is faster: the Human may answer page by page (`ok: <numbers>`,
  `failed: <numbers> <what you saw>`), and the agent starts fixing a failed card at once and re-shows it as
  `(re-check: fixed)`. The cards header carries one pasteable line that opens every page (`Start-Process` in PowerShell).
  The agent prepares the data a card needs in the slot's dev database and puts the real id in the URL. A project does
  nothing; the rendered files that change are the same as in the card-layout entry above.

## [1.5.0] - 2026-10-22

The orchestrator run's follow-ups: the gaps its checkers left open, each closed with a test.

### What a project must do

Nothing. Rendered files that change (`kit-update`): `.claude/workflows/orchestrate.js`, `.claude/agents/orch-merge.md`,
`.claude/commands/review-it.md`, `.claude/settings.json` (the Bash matcher gains a plan-file guard),
`docs/agent/orchestrator.md`, `scripts/plan-order.mjs`, `scripts/take-plan.mjs`, `scripts/orch-state.mjs`,
`scripts/orch-preflight.mjs`, `scripts/lib/guard.mjs`, `scripts/lib/plan-deps.mjs`, `scripts/lib/done-when.mjs`,
`scripts/lib/slot-procs.mjs`, `docs/agent/standards-git.md`, `docs/agent/workflow-map.md`. A project with `commands.dev` set now needs its dev server answering on the base port
(or startable by `scripts/slot-serve.mjs`) before `/orchestrate` starts a run.

The validating agents' model tier adds nothing a project must do: the new tier `models.review` takes the project's own
`models.analysis` when the project set that and not `review` (so an `opus`, `fable`, `inherit` or `claude-` id project
keeps its validators where they were, and the all-`inherit` routing-off setup stays off), and `sonnet` otherwise — what
the validating agents ran on before. Rendered files that change: `.claude/agents/orch-check-plan.md`,
`orch-check-bugs.md`, `orch-check-rules.md`, `orch-verify.md`, `orch-security.md`, `orch-ui.md` (model from
`models.review`), `.claude/agents/git-agent.md` (`omitClaudeMd: true`), `.claude/commands/review-it.md`,
`docs/agent/model-routing.md`. A project that set `models.analysis` to Haiku keeps its checkers on Sonnet now.

### Added

- `models.review`: the model tier of every validating agent — the three finders, the verifier, the
  security and UI validators, and so `/review-it`'s checkers. Default `sonnet` (or the project's own non-Haiku
  `models.analysis` when `review` is unset); install and sync refuse `haiku` or a
  `claude-haiku-*` id for it, naming the key (a review is never done by the weakest model). `models.analysis` keeps
  `kit-prevalidate`, `orch-merge`, `techdebt` and `/docs-refresh`.
- The kit's own agent-eval case set: 25 cases under `docs/agent-evals/cases/` for `orch-check-bugs`,
  `orch-check-plan`, `orch-check-rules` and `orch-verify`, built from this repo's history — problems a checker found
  and a later commit fixed with a test (`fixed by <sha>`), plans that passed with no finding (`clean:`), and planted
  bugs (`planted:`). `tools/test/eval-cases.test.mjs` refuses a label without one of those sources;
  `tools/fixtures/agent-evals/stub-perfect.mjs` proves the set parses without a model call.
- `docs/agent-evals/BASELINE.md`: recall, precision, noise, tokens and cost per model (Opus, Sonnet) for each of the
  four roles, two runs per case, and the cheapest model per role within 0.05 of the best.

### Changed

- `git-agent` starts without the project instructions (`omitClaudeMd: true`, like `kit-runner`): its prompt carries
  everything it needs. The field needs Claude Code v2.1.271 or later and is ignored before that.

- Guards: strict mode for complex shell writes on guarded folders. A Bash command that writes and uses `$(…)`,
  `${…}`, backticks, `<(…)`/`>(…)`, `[[`, `((`, `$'…'`/`$"…"` or `eval` is refused (`BRANCH_GUARD:` /
  `SCOPE_GUARD:` "… the guard cannot verify every target") unless every write in it is a top-level redirect or
  `tee`/`cp`/`mv`/`install`/`ln`/`touch`/`truncate`/`sed -i`/`perl -i` to a plain literal path the reader found.
  Why: five review rounds each found a new shell construct (quoted or unclosed `[[`, a redirect before `[[`,
  `<((…))`, `${…}`, `\${`/`$${`, process-substitution words, ANSI-C `$'…'` quoting) that hid a write from the reader;
  the rule stops that by failing closed. Use the Write/Edit tool or a plain redirect to a literal path instead.
  Commands without those constructs are judged exactly as before.

### Fixed

- A `[ui]` card's test command passes the same allowlist as the plan's check commands; any other is not run, a run
  note says why, and the card counts as unscripted.
- `plan-order` and `take-plan` share one "already done" rule (`planDoneReason`): Status: finished, or at least one
  sub-task `[x]` and none open — `plan-order` no longer schedules a plan that is already on `main`.
- The guards' Bash reader follows writes inside `$( … )` and backticks, reads `>` inside `[[ … ]]` and `(( … ))` as a
  comparison, and sees a command after a reserved word (`if cp a b`). The Bash matcher runs the plan-file rule too
  (`node scripts/lib/guard.mjs plan`): a shell command that writes a new, name-similar `plans/*.plan.md` is denied.
- The orchestrator preflight proves the dev server answers, or starts it, when `commands.dev` is set; a failed start
  stops the run before any builder.
- `/review-it <branch>` reviews that branch (`origin/<main>...<ref>`, in a temporary detached worktree when it is not
  the current branch), not always `HEAD`.
- A `Depends-on:` line stops at a dash: a note after it (`— after release 1.3`) adds no plan numbers.
- `agent-eval`: `model: inherit` passes no `--model`; an agent with Bash runs only on a runner that isolates each case
  (the default one now runs every case in a scratch copy of its input folder).
- `orch-state`: a stale lock is taken over by an atomic rename with a token check. This closes the common race of two
  takers removing the same stale lock; a window of microseconds remains (a fresh lock moved by mistake cannot be put
  back when a third process created one in between), so two owners at once stay possible, just very unlikely.
- The Bash write guard reads a quoted or escaped `[[` (`'[['`, `"[["`, `\[\[`) as a plain word, not the test keyword;
  a `[[` the command leaves unclosed fails closed (every `>` target inside it counts as a write); and the `$(…)` and
  backtick substitutions inside `(( … ))` / `$(( … ))` are read for writes like any other.
- `[ui]` items are read from the Done-when sections only, and a card covers only the item whose text it equals.
- The merge agent's steps match the orchestrator's merge prompt (`--no-ff --no-commit`, the checks, then the commit).
- `slot-serve`'s "packages missing" check works with npm 6 (no `node_modules/.package-lock.json`).
- The kit repo sets `paths.hotspots` (`CHANGELOG.md`, `README.md`), so they no longer put every kit plan in one lock
  group.

## [1.4.0] - 2026-10-22

The kit uses its own workflow: it is installed into the kit repo and works solo (plan on `main`, build on a
`feat/NNN-<slug>` branch in the same folder, `/ship`).

### What a project must do

Nothing. Two optional changes reach projects with the next sync: `.kit/config.json`, when present, is read before
`kit.config.json` by install, sync and drift-check; and `/ship` checks the plan scope of a `feat/NNN-<slug>` branch
outside a slot too. Rendered files that change (`kit-update`): `scripts/scope-check.mjs`, `scripts/ship-prep.mjs`,
`.claude/commands/review-it.md`, `.claude/agents/kit-runner.md`, `docs/agent/model-routing.md`,
`docs/agent/workflow-map.md`; new: eleven `.claude/agents/orch-*.md` and `docs/agent/agent-roles.md`. A new config
key `models.build` (default `sonnet`) is optional; a project that turned the routing off (every tier `inherit`) sets `models.build: "inherit"` too.
The orchestrator is opt-in: nothing runs until `/orchestrate`. New rendered files: `.claude/workflows/orchestrate.js`,
`.claude/commands/orchestrate.md`, `docs/agent/orchestrator.md`, `scripts/orch-state.mjs`, `scripts/orch-preflight.mjs`,
`scripts/lib/orch-run.mjs`; changed: `.claude/commands/commands.md`, `scripts/local-excludes.mjs` (adds
`.claude/orchestrator-runs/` to the runtime ignores). New optional config keys `orchestrator.runBranchPrefix`
(default `orch/`), `orchestrator.maxFixRounds` (default `2`) and `orchestrator.minFreeDiskGb` (default `5`).
The `[ui]` Done-when tag is optional: existing `[auto]` / `[human]` plans keep working. Rendered files that change:
`docs/agent/job-validation.md`, `docs/agent/orchestrator.md`, `.claude/skills/save-plan/SKILL.md`,
`.claude/references/prd-template.md`, `.claude/commands/ship.md`, `.claude/commands/done.md`,
`.claude/agents/orch-builder.md`, `.claude/agents/orch-ui.md`, `.claude/workflows/orchestrate.js`,
`scripts/orch-preflight.mjs`, `scripts/orch-state.mjs`, `scripts/scope-check.mjs`, `scripts/lib/orch-run.mjs`; new:
`scripts/lib/done-when.mjs`.

### Added
- The `[ui]` validation tier: a Done-when item a script can check in the running app (one page, one
  action, one asserted text or element, a screenshot) sits between `[auto]` and `[human]`
  (`docs/agent/job-validation.md` Tier 1b). The save-plan shape lint is now a command,
  `node scripts/scope-check.mjs --tags --plan=<p>` (`DONE_WHEN_TAGS: ok`; `[ui`, `[UI]` and untagged items are
  rejected). In the orchestrator the builder writes one short e2e test per `[ui]` item and reports `uiCards`; a gate
  runs them; a passing card is recorded with its screenshot and never reaches the browser agent; `orch-ui` sees only
  failed or unscriptable cards, with a "pre-checked — skip" list and the known findings, and returns pass / fail /
  plan-drift. Before any browser step `orch-preflight.mjs --ui` checks the pages' servers, the QA login and the
  backend from the page's origin; a blocked environment parks the plan with the reason and costs no fix round. The
  run report shows a screenshot grid per page, plan drift in its own section with no severity, and the cards no one
  could check for the Human. Tests: `tools/test/ui-tier.test.mjs` (in `e2e-check`) and five new cases in
  `tools/orchestrator-e2e.mjs`.
- The orchestrator workflow (opt-in): `/orchestrate 451-457` runs saved plans unattended into one run branch
  `orch/<run>` — never into `main`; the Human merges the run branch. Readiness first (`plan-order --json` waves, one
  `orch-readiness` agent per plan, `scripts/orch-preflight.mjs`), every open question asked in one batch and written
  into the plans' Execution Notes, then `go`. Per plan: builder → gate → finders in parallel → verifier → security
  (sensitive paths only) → UI validator (when turned on) → merger, one merge at a time with the checks before the
  push. `pass` is computed from the verified problem lists, never taken from a model; a plan whose Architecture
  Impact names an invariant other than `INV-none` starts on the judgment tier; a persisting failure, an `ESCALATE` or a
  second finding starts a fresh judgment-tier builder from the hand-off file; `orchestrator.maxFixRounds` rounds, then
  the plan is parked and its wave is the last. Environment failures (disk, database, network) cost no fix round: the
  plan pauses, the environment check runs and the plan is retried once. Rules: `docs/agent/orchestrator.md`.
- `.claude/workflows/orchestrate.js` (the installer ships the workflows folder): no file, git or clock access; every
  such step is `scripts/orch-state.mjs` run by the mechanical runner — run branch, merge folder, builder folders,
  `status.json` after every step (state, round, tier, sha, model per agent, free disk), hand-off files, and the report
  (`docs/orchestrator/runs/<run>/report.md` on the run branch, copied to the gitignored
  `.claude/orchestrator-runs/<run>.md`). Git is the ledger: a relaunch rebuilds the merged plans from the anchored
  subjects `Merge <branch> into orch/<run> (plan NNN)` and redoes none.
- `orchestrator.runBranchPrefix`, `orchestrator.maxFixRounds`, `orchestrator.minFreeDiskGb`: install and sync refuse a
  bad value naming the key.
- `tools/orchestrator-e2e.mjs`: the installed workflow run end to end on a scratch project with stub role agents
  (diamond in wave order, fix-then-pass, an environment failure that costs no round, `pass: true` next to a `major`
  treated as a fail, a parked plan stopping the wave, escalation, a relaunch rebuilt from git);
  `tools/test/orchestrator.test.mjs` for the pure rules and the config validation. Both run in `e2e-check`.
- Role agents for the orchestrator, each with a pinned model and effort from `models.*`: `orch-readiness`
  (judgment), `orch-builder` (new `models.build` tier, escalation to judgment; no Agent or SendMessage tool),
  `orch-gate` and `orch-report` (mechanical), the finders `orch-check-plan`, `orch-check-bugs`, `orch-check-rules`,
  the verifier `orch-verify`, `orch-security` (sensitive paths only, read-only), `orch-ui` and `orch-merge`
  (analysis). `docs/agent/agent-roles.md` holds their shared contract: one job, non-interactive, evidence for every
  claim, a JSON result naming its own model and effort, no deny-listed command.
- `models.build`: the tier for agents that write code, validated like the other tiers (install and sync refuse
  `models.build: gpt-4` naming the key).
- A shared result validator for the kit's checks (`tools/lib/agent-result.mjs`): requires `model` and `effort`,
  computes `pass` from the verified problems and rejects a result whose own `pass` disagrees;
  `tools/test/agent-contracts.test.mjs` runs every agent's documented example through it (in `e2e-check`).
- Agent eval harness (kit-side tool): `node tools/agent-eval.mjs --agent <agent.md> --cases <dir> --runs 2` runs one
  agent file against labelled cases and prints recall, precision, run-to-run noise, tokens and cost per case with a
  total line; `--model <id>` compares one agent file across models; `--min-recall` / `--min-precision` exit 1 below
  the threshold. Findings match by `file`, `rule` and `severity` (line ±3, text ignored). The default runner calls
  Claude Code non-interactively and refuses a write-capable agent unless `--allow-write`. Generic checker and
  verifier cases ship in `tools/fixtures/agent-evals/`; real cases live in each project. New rendered file:
  `docs/agent/agent-evals.md` (the case shape). `tools/test/agent-eval.test.mjs` runs in `e2e-check`.
- Plans declare what they need first: a `Depends-on: NNN, MMM` (or `none`) header line, in the plan template and
- Plans declare what they need first: a `Depends-on: NNN, MMM` (or `none`) header line, in the plan template and
  the save-plan lint. One parser (`scripts/lib/plan-deps.mjs`) reads it — plus legacy prose such as
  `Prerequisite: plan NNN merged`, so old plans need no edit — for every tool.
- `scripts/plan-order.mjs`: the run order of any set of plans — waves (what can run in parallel), lanes, lock groups
  derived from Read-Write Scope overlap (config hotspots and the i18n file left out) and the reason of every edge;
  text or `--json`. A cycle or a missing dependency exits 1 and names the plans. With `--branch <b> --merged-from
  git`, a plan counts as merged only on the exact subject `Merge <src> into <b> (plan NNN)`.
- `scope-check.mjs --deps --plan=<path>`: `DEPENDS_ON: ok` or `DEPENDS_ON: missing` (exit 1).
- `take-plan.mjs` refuses a plan whose dependency is not merged with `NOT_READY: plan NNN (<title>) is not merged`
  (the same check as before, now on the shared parser and the `Depends-on:` line).
- `.kit/config.json` project config, read before `kit.config.json` (for a project whose `kit.config.json` is
  something else; messages name the file used). A kit installed into itself records its source as `local:.`.
- The kit repo carries the installed workflow (`.kit/config.json`, a root `package.json` that runs the checks), and
  CI runs `drift-check --target .` so the installed copy always equals the sources.

### Changed
- `/review-it` reviews a Worker branch with the checker pipeline: three finders in parallel (plan, bugs, rules; plus
  security on sensitive paths), a verifier that drops a finding only on a concrete refutation, a confidence ≥ 80
  threshold and a do-not-report list; it keeps its `kit-runner` call for the commands and no longer reads a session
  handoff file.
- `scope-check.mjs`: with no `--plan` and no slot plan, a `<type>/NNN-<slug>` branch's plan is the plan.
  `ship-prep.mjs` runs the scope gate in a slot **or** on such a branch (a branch that names no plan: no gate, as
  before).
- Write guards judge the file being written, whoever launched the agent. Tests first
  (`tools/test/guards.test.mjs`, also run by `tools/e2e-check.mjs`): a main-folder session writing into a slot was
  already judged by the slot's guard; what failed, and is fixed:
  - **Bash writes are guarded.** `.claude/settings.json` runs `branch-guard.sh` and `scope-guard.sh` on `Bash` too;
    redirects, heredocs, `tee`, `sed -i` / `perl -i`, `cp` / `mv` / `install` targets and `touch` get the same path
    rules, read-only commands pass, and a target the guard cannot resolve (`$VAR`, `$(...)`) is refused where a write
    needs a check.
  - **Merge folders are held to their plan.** Outside a slot, a branch other than `main` that names a plan —
    `.worktree-plan` (e.g. an `orch/<run>` merge folder) or `<type>/NNN-<slug>` — is scope-guarded; `ship-prep.mjs`
    uses the same rule (`scopedPlanPath` in `scripts/lib/slot.mjs`, `--scoped-plan` prints it).
  - **Runtime files on `main`.** `.claude/sessions/**`, `.claude/.session-state-path` and `.claude/.plan-write-ack`
    are no longer refused by the branch guard.
  - **Speed.** Both guards are one node process (`scripts/lib/guard.mjs`): the branch and git dirs are read from files,
    no git call on the allow path (`KIT_GUARD_TRACE=1` prints `GUARD_GIT_CALLS: <n>`), no python. Rendered files that
    change: `scripts/scope-guard.sh`, `scripts/branch-guard.sh`, `scripts/lib/slot.mjs`, `scripts/ship-prep.mjs`,
    `.claude/settings.json` (`kit-update`); `scripts/lib/guard.mjs` (`new`).

### Fixed
- Security: guards fail closed on a guarded folder; orchestrator check commands allowlisted, state arguments
  validated. `scripts/lib/guard.mjs` refuses a write it cannot judge (empty or unparseable input, no file path, an
  error, a sibling worktree's guard with no answer, a scope check that crashes, a shell target it cannot resolve while
  any worktree of the repository is guarded) and allows it only where nothing is guarded. The orchestrator: plan
  branch slugs are `[a-z0-9-]` only and any other branch is refused; extra check commands are `npm run <script in
  package.json>`, `node tools/…`, `node scripts/…` or `node --test <files>` (anything else dropped with a run note); a
  gate that leaves a check out or reports an unknown one fails; `orch-state.mjs` takes `--key=value`, refuses unknown
  flags (`--root` among them) and unsafe `[ui]` card values, and treats a diff it cannot read in full as sensitive.
- `slot-serve.mjs` and `take-plan.mjs` install a folder's packages when they are missing (no
  `node_modules/.package-lock.json`), not only when its lockfile changed: a stale `.last-npm-install-hash-*` no
  longer hides a missing `server/node_modules`. They print `npm install ran in <label> (packages missing|lockfile
  changed)`, and a failed install names the exact command to run by hand. New pure check `installNeed(dir,
  hashPath)` in `scripts/lib/slot-procs.mjs`. Rendered files that change (`kit-update`): `scripts/lib/slot-procs.mjs`,
  `scripts/slot-serve.mjs`, `scripts/take-plan.mjs`.

The validation hand-off moves to the end of the work: a finished plan with `[human]` items now ends with the
servers running and HOW TO VALIDATE cards grouped by page, before any `/ship`, PR or merge.

Model routing per task. Steps that only run commands or gather evidence now go to sub-agents on a cheaper
model; planning, review, fixes and code writing stay on the main session's model. New `docs/agent/model-routing.md`
holds the rules: no `model:` on an inline command (a model switch re-reads the whole conversation uncached, twice),
delegate only when a step reads a lot and returns little, `ESCALATE: <reason>` instead of a guess, the main session
re-checks any agent result that skips work or blocks a merge, and one hand-off file format for passing a failed step
to a stronger agent.

- New config key `models` (`mechanical` = `haiku`, `analysis` = `sonnet`, `judgment` = `inherit`). A value must be
  `haiku`, `sonnet`, `opus`, `fable`, `inherit` or a full model id starting `claude-`; install and sync refuse anything
  else. All three `inherit` turns the routing off.
- New agents `.claude/agents/kit-runner.md` (mechanical: runs commands, returns exit codes and verbatim error lines)
  and `.claude/agents/kit-prevalidate.md` (analysis: auto-solve's DONE / TODO / BLOCKED table). `git-agent` gets the
  mechanical tier.
- `/ship` Phase 1, `auto-solve` Phase 4 and `/review-it` step 3 hand their commands to `kit-runner`; `auto-solve`
  Phase 2 uses `kit-prevalidate` and re-checks every DONE row; `auto-solve` Phase 3's parallel agents name
  `model: "inherit"`; `/docs-refresh`'s agent call passes the analysis tier.
- `github-sync` (mechanical) and `techdebt` (analysis) run as forked skills. A question the fork cannot ask comes
  back as an `ASK:` line, and the main session asks it. On a rebase conflict github-sync now runs `git rebase --abort`
  before stopping (it used to leave the conflict in place), so the checkout is never left mid-rebase.
- In Cursor (no sub-agents) `/ship` and `/review-it` run those commands inline, as before.
- SessionStart prints a `MODEL_ROUTING:` line when `CLAUDE_CODE_SUBAGENT_MODEL` or
  `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` would override the agent files' models.

Mods from the kit's own marketplace. The three Claude Code mods (fleet, guards, ship-pilot) now live in this
repository under `mods/`, served by `.claude-plugin/marketplace.json` (`ai-workflow-kit-mods`), so a project gets them
on every machine and a mod change reaches those machines with a kit release.

- New config key `mods`: `enabled` (default `[]`; `fleet`, `guards`, `ship-pilot` — others are refused) and
  `marketplaceRepo` (default this repository). With a mod enabled, install and sync write the marketplace
  (`autoUpdate: true`) and one `enabledPlugins` entry per mod into `.claude/settings.json`.
- fleet 0.4.0: the status line shows when the 5-hour window resets (`5h 62% ↻14:30 (2h10m)`), `/health` and the
  limit notices name both reset times, and every session shows a notice when the 5-hour window refreshes (the 95%
  notice is re-armed for the new window). Port bases come from the kit-rendered `scripts/lib/slot.mjs` when fleet's own
  options are empty. The 95% notice fires once per window.
- guards 0.2.0: its append-only hotspots come from the kit-rendered `scripts/scope-check.mjs` (the same list `/ship`'s
  scope check uses) when its option is empty.
- ship-pilot 0.4.0: no behaviour change (one shared copy from the marketplace).
- CI runs `leak-check` on the mods (their tests are fixtures and are not scanned). Cloud sessions do not get the mods.

### What a project must do (continued)

Nothing. Sync and commit. Rendered files that change (`kit-update`): `docs/agent/job-validation.md`,
`.claude/commands/take-plan.md`, `.claude/commands/ship.md`, `.claude/commands/done.md`, `AGENTS.md` and, with the
Cursor layer, `.cursor/commands/done.md` and `.cursor/commands/ship.md`. A project that
overrides one of these files can copy the new "Servers first", Format and Close-out text by hand.

Model routing: nothing either; the new config key `models` has defaults. To change a tier, set `models.<tier>` in `kit.config.json`; to keep
every step on the main model, set all three to `inherit`. `templates/CLAUDE.md` is a seed, so an existing project's
`CLAUDE.md` does not get the new pointer to `docs/agent/model-routing.md` (optional to add by hand).

Mods: nothing unless you want them. To turn them on, set `mods.enabled` in `kit.config.json`, sync, commit, and accept
the folder's trust dialog once. Replacing a local directory marketplace: see the README's **Mods**.

### Changed
- `job-validation.md`: a Core rule for the hand-off (cards only when a human is needed, only once the work is
  finished, before `/ship`, a PR or a merge; after the merge only when merges are pre-approved). "Servers first" is a
  hard step: every page URL in the cards answers before they are shown. Cards are grouped by page in click order
  (`▸ page — full URL` lines, numbers running on, a last group for checks outside the app); the header's `app:` field
  is gone. New reply word `failed: <numbers>`.
- `/take-plan`: a final step "Close-out" — `[auto]` evidence, then servers, cards and the wait before `/ship`; also
  for several plans run in one session.
- `/ship` Phase 4 and `/done`: with `[human]` items and no answered cards, the gate starts the servers and shows the
  cards first. **Y** alone is commit/push consent and no longer validates `[human]` items (`done Y` answers both).
- Cursor layer `/done` and `/ship`: the same rules spelled out, since Cursor has no hook that checks them.
- `AGENTS.md`: the Job validation rule names the hand-off; `/ship` **Y** alone no longer counts as validation.

## [1.3.1] - 2026-10-19

The Planner's Architect + PM review now reaches every brief, including a feature request written in plain prose, and
shows what it changed. `/plan`, the PRD template and save-plan describe one plan shape. Plus three tool fixes: the
PowerShell wrappers take an absolute folder, `e2e-check --project` explains missing dependencies and env files, and
`workflow-link-check` no longer fails on a gitignored runtime file.

### What a project must do

Nothing. Sync (`kit-sync -Ref v1.3.1`, then `-Apply`) and commit. Rendered files that change (`kit-update`):
`.claude/skills/brief-detection/SKILL.md`, `.claude/commands/plan.md`, `.claude/references/prd-template.md`,
`.claude/skills/save-plan/SKILL.md`, `scripts/plan-name-similarity.mjs`, `docs/agent/workflow-map.md` (the
`brief-detection` row and diagram line) and, with the Cursor layer, `.cursor/rules/brief-detection-must-use-skill.mdc`.
No config key is new. A project that overrides `docs/agent/workflow-map.md` can update its `brief-detection` row and
diagram line by hand to the new trigger and routes.

### Changed
- `brief-detection`: in the main folder, a feature request in prose (asks to build, add, change, fix or remove
  something; longer than one sentence; not a question) gets a short gate:
  `a. refine it with a review (default) · b. /plan it · c. just discuss`. A question, a slash command, a request to
  run or explain something, an answer, a request phrased as a question ("Can you add …?"), a small change (one file,
  a typo, a one-line fix), or any message in a slot gets no gate. The structured-brief gate has the same choices. The
  main-folder test is the one tool call allowed before the gate (or the SessionStart slot line). The workflow map's `brief-detection` row and the Cursor rule say the same.
- Option **a** (the default) runs `/plan`'s Architect + PM review on the brief and saves nothing (it used to skip the
  review). On a brief the review checks codebase facts, Human decisions, testability and overlap only; missing plan
  sections are not gaps until `/plan`, and there are no `fixed:` lines. Option **b** hands to `/plan` → save-plan → a Worker claims the plan in a slot with `take-plan`; it no
  longer says to run a milestone, which the Planner never does.
- `/plan`'s review block lists `fixed: <gap> → <change>` and `open: <gap> — <question>` lines, also on a plan the
  Planner wrote itself; `no gaps` only when both lists are empty. It always runs the overlap search (below); a plan it
  finds is an `open:` line only when it may be the same work or shares a file, the rest go on one `checked:` line.
- One plan shape: `/plan` no longer asks for "numbered milestones and a Verify command per milestone". The PRD
  template's Atomic Sub-tasks are the milestones, and each `[auto]` success criterion names its exact check. The
  template gains `## Execution Notes` (where `/plan` writes gaps the Human kept), and `## Critical Questions` says its
  own `Q: … A: …` format instead of pointing at a format `brief-detection` never defined. save-plan says the same.
- `plan-name-similarity`, new flags for the review: `--stem` matches words by stem (`favourite` = `favorites`,
  `recipes` = `recipe`); `--related` (implies `--stem`) searches the text of every plan, open and closed (rare words
  weigh most) and prints `PLAN_RELATED`; `--scope="glob,…"` (a bare `--scope` with `--file`: that plan's scope block)
  prints `PLAN_SCOPE_OVERLAP` for open plans whose Read-Write Scope shares a file (a path without a glob counts as the
  file and as the folder). Without these flags the output is v1.3.0's, line for line, so save-plan's gate and
  `plan-write-guard.sh` behave as before.
- `e2e-check --project`: stops before cloning with `install dependencies in <path> first` when the project or its
  `scripts/` has no `node_modules`, or one that lacks most declared packages (a broken install; a few missing are a
  NOTE); copies `<paths.serverRoot>.env` (when git ignores it) into the scratch slots, as the slot setup does for a real
  slot, and deletes the copies when the run ends, also on Ctrl+C or a kill; without that file the slot dev server
  cases are `SKIP` with the reason (the summary line adds `, N skipped`).
- `workflow-link-check`: a path a doc names that does not exist but the project's git ignores is counted as `runtime`
  (`N runtime (gitignored)`), not missing.

### Fixed
- `kit-sync.ps1`, `kit-install.ps1`, `kit-drift.ps1`: an absolute `-Target` (or `-Config`) failed under Windows
  PowerShell 5 (`Join-Path` glued it onto the current folder). Paths now resolve as PowerShell does: relative,
  absolute, drive-relative (`C:name`), root-relative (`\name`). A trailing slash (`.\my-app\`, tab completion) is
  dropped; it used to end the argument in `\"` and swallow the arguments after it, such as `-Apply`.
- `plan-name-similarity` missed existing plans worded differently from the request: titles only, exact words, and a
  0.8 score. See `--stem` / `--related` above (the review uses them; the default gate is unchanged).

### Checks
- `install-check`: the rendered Planner instructions agree (the prose rule, the gate text, examples that obey the
  rule, option a reviews and saves nothing, option b hands to `/plan`, save-plan and `take-plan`, the `fixed:` /
  `open:` / `checked:` block, the brief-only review, the small-change and question-form exceptions, the overlap search,
  one plan shape); `plan-name-similarity` default output equal to v1.3.0's on a fixture, `--stem`, `--related`, and
  `--scope` overlap cases (bare folder, trailing slash, `src/**`; not `*.md`, `src/app/*.ts`, a sibling folder); the
  three PowerShell wrappers with relative, absolute, trailing-slash, spaced, drive-relative and root-relative paths,
  and `-Apply` after a trailing slash (Windows).
- `workflow-link-check`: a fixture with a gitignored runtime path (runtime when ignored, missing when not).
- `acceptance-check --e2e`: `e2e-check --project` on a clone without `node_modules` stops before cloning.

## [1.3.0] - 2026-10-19

Follow-ups from the first v1.2.0 syncs: the CI unit-test job can be softened or turned off, sync cleans up the files a
release stopped shipping, the adoption report prints the real slot frontend command, and four optional config keys let a
project keep its own wording in the angular pack and `/review-it` without an override.

### What a project must do

Nothing. Every new key is optional, and with none set every rendered file is the same as in v1.2.0 except
`scripts/lib/slot-procs.mjs` (`kit-update`, same behaviour) and the new `scripts/lib/fe-command.mjs` (`new`). Sync
(`kit-sync -Ref v1.3.0`, then `-Apply`) and commit both.

A project that keeps its own classification of the kit's `scripts/` files (a manifest or an ownership list its own
check reads) must register `scripts/lib/fe-command.mjs` there (a core, copied file), or that check reports it as
unclassified.

### Overrides you can drop

Set the key, drop the `overrides` entry, run sync, and check the rendered file (a file that differs from your copy is a
`conflict`: take the kit's version, or keep the override).

- `.github/workflows/ci.yml`, kept only because the test job could not pass (no test script, or the test command fails
  on code you do not own): set `ci.testMode` to `skip` (no test job) or `if-present` (passes when there is no such
  script).
- `.claude/skills/cssLayer/SKILL.md` (angular pack), kept for a "the UI is right-to-left" line: `project.uiDirection:
  "rtl"` (the line names `project.uiLocale` when it is set: a display phrase such as `Arabic RTL`, not a locale code).
- `docs/agent/standards-angular.md`, kept for a project-specific **Logic** line: `docs.domainSummary` (the line becomes
  `* **Logic**: <summary>.`).
- `.claude/commands/review-it.md`, kept for a log-query step: `commands.logQuery` (the full command that prints the
  errors logged since the plan started) adds a **Logs** check and its table row.
- `.claude/skills/angularComponentStructure/SKILL.md`, kept for the icon library: `project.icons.library`,
  `project.icons.component`, `project.icons.registry` (the same keys fill the icon line of `docs/agent/conventions.md`).
  A copy that also words the translation line differently keeps its override, or takes the kit's line.
- A `removed-from-kit` row for a file you already deleted disappears on the next `-Apply` (the record is dropped).

### Added
- `ci.testMode` (`run` default | `if-present` | `skip`): `run` renders the test job as before (byte-identical),
  `if-present` runs `npm run --if-present <commands.test>`, `skip` renders no `test` job and nothing needs it. Install and
  sync refuse any other value (exit 2), like the other `ci.*` modes. The adoption report's CI row names the mode and fails
  when the job and the mode disagree.
- `kit-sync --prune` (`kit-sync.ps1 -Prune`): with `--apply`, a managed file the kit no longer ships that is unchanged
  since install (its hash equals the record) is deleted and its record dropped; an edited one or a seed stays on disk and
  only its record is dropped (`released`). A CRLF checkout of an unchanged file counts as unchanged. Never touched:
  overrides, upstream-owned paths, a record outside the project, and a record that differs from a shipped path only in
  letter case (a case-only rename: its record is dropped, the file stays). Without `--prune` nothing is deleted, and a
  dry-run prints what `--prune` would do. The summary line gains `N pruned` and `N released`.
- Optional wording keys, unset = the v1.2.0 lines: `commands.logQuery` (`/review-it` Logs check), `project.uiDirection`
  (`rtl` | `ltr`; refused otherwise), `project.icons.library` / `component` / `registry`, `docs.domainSummary`.
  Install and sync refuse a `commands.logQuery` with `|` or a backtick (it is shown in a Markdown table and code span).
- `scripts/lib/fe-command.mjs`: the pure builder of the slot frontend command (`frontendCommand`), used by
  `slot-procs.mjs` (`frontendArgs`) and by `tools/adoption-report.mjs`.
- Checks: `install-check` renders `ci.testMode` run / if-present / skip (actionlint in kit CI), refuses bad `ci.testMode`
  and `project.uiDirection` values, runs `sync --prune` on unchanged / edited / seed / override / missing records, imports
  each fixture's rendered `slot-procs.mjs` to check `frontendArgs`, and checks each wording key set and unset;
  `acceptance-check` checks the adoption report's frontend row on the Angular and React-Vite fixtures.

### Changed
- `kit-sync --apply` drops the record of a `removed-from-kit` file that is already gone (it showed as
  `removed-from-kit` on every run).

### Fixed
- `adoption-report`: the `frontend dev server` row printed `npm run <commands.dev> -- <slots.fePortArgs>` and ignored
  `slots.feExec`; it now prints the command a slot runs (angular pack: `npm exec -- ng serve -c slot --port {port}`).

## [1.2.0] - 2026-10-19

The core no longer assumes a stack: "core + stack pack + layers". The frontend dev server, CI jobs, style rules,
tech-debt rules and the references core commands make come from the packs and from config, a project without a
backend gets no backend job, and a new **React + Vite** pack, a **Supabase** layer and an **upstream-owned** layer (for
a repo that is a copy of someone else's) join the Angular and Node/Express packs. The installer detects the stack when
none is named. The Planner always runs an Architect + Product Manager review before it saves a plan. New checks
prove an install on fixture projects end to end. Released as a minor version by choice, although several changes need a
step in existing projects (below): read that list before you sync.

### What a project must do

Run `kit-sync -Ref v1.2.0` (dry-run) first; it lists every change. Then:

1. **`commands.*` are npm script names.** Every `commands.*` value in `kit.config.json` must be a script name
   (`"build"`, `"dev"`), not a command (`"npm run build"`, which rendered as `npm run npm run build`). Install and sync
   stop with exit 2 and name the value to use. `commands.lintStaged` stays a full command.
2. **Name the stack for a core-only install.** With no `--packs` and no `stack.packs`, install now detects the packs and
   layers, prints them with the reason for each and installs them only after `--yes`; when nothing matches it stops
   (exit 2) instead of installing the core alone. For the stack-neutral core only, pass `--packs ""` (PowerShell
   `-Packs ''`) or set `"stack": { "packs": [] }`. This applies to `--config <file>` too: a config file without a `stack`
   now exits 2 the same way. Detection never includes the `upstream-owned` layer by itself (every fork clone has an
   `upstream` remote): it prints it as a suggestion, and you add it with `--layers`. Installed projects are not affected:
   sync uses the recorded packs. Install stops (exit 2) when `kit.config.json` `stack.packs` / `stack.layers` and
   `.kit/install.json` disagree — make them match.
3. **PRD and HLD templates.** `kit-sync` shows `.claude/references/prd-template.md` and `hld-template.md` as `conflict`
   whenever the project's copy differs from the kit's (they were seeds and are now kit-managed; sync never overwrites
   them). For each: move the project-only lines into the file named by `paths.planChecks` (default
   `docs/project/plan-checks.md`), then take the kit version (copy the rendered kit file over yours) and re-run sync —
   it reports `same` and records the file as managed. To keep your own copy, add an `overrides` entry instead; drift-check
   now compares both templates byte for byte, so a kept copy needs it.
4. **Workflow script dependencies.** After the sync, run `npm install` inside `scripts/` once in the main folder and
   commit `scripts/package-lock.json` (not `npm install --prefix scripts`: npm 10 then runs the root package's
   lifecycle scripts). The dependency (`picomatch`) lives in the kit-managed `scripts/package.json`; until the lockfile
   exists the scripts still find it in the root `node_modules` when it is there. Slots reinstall it when the lockfile
   changes; CI installs it inside `scripts/` and audits it report-only once the lockfile is committed; a later
   `kit-sync --apply` that changes `scripts/package.json` refreshes the lockfile (commit it with the sync, or run the
   command sync prints when that install fails).
5. **A project that keeps its own `AGENTS.md`** (an `overrides` entry, or `ownership.upstreamPaths`) gets
   `AGENTS.workflow.md` as a `new` file: add the line `@AGENTS.workflow.md` under `@AGENTS.md` in `CLAUDE.md` (a seed,
   so sync does not change it).
6. **Slot frontend dev server.** It comes from `commands.dev` + `slots.fe*`. With the angular pack nothing changes (the
   pack supplies `npm exec -- ng serve -c slot --port <port>` and the env file); the react-vite pack supplies
   `npm run dev -- --port <port> --strictPort`. Any other project whose slot frontend started only because
   `src/environments/environment.local.ts` existed: set `commands.dev` (and, as needed, `slots.feExec`,
   `slots.fePortArgs`, `slots.feMatcher`, `slots.feEnvFile`). A backend-only project whose `kit.config.json` still says
   `commands.dev: "dev"` (older node-express installs copied it): set it to `""`. Install and sync print a `NOTE` while
   `commands.dev` is set and every `slots.fe*` value is the default; the default `--port {port}` is right only for a
   server that fails on a busy port.
7. **Backend.** A project that has a backend must set `paths.serverRoot` (e.g. `"server/"`, which the node-express pack
   sets): with it empty, `ci.yml` and `security.yml` render no server job or step. Install and sync print a `NOTE` when
   `server/package.json` exists and the key is empty.
8. **CI for code the project does not own** (an upstream copy, a stale lockfile, a legacy codebase): set `ci.install`,
   `ci.lintScope: "changed"` (ESLint on the project's own changed files; needs ESLint in the root `node_modules`) and/or
   `ci.appAuditMode: "report"` — or use the `upstream-owned` layer, which sets all three. Install and sync refuse (exit 2)
   any other value of the two modes. An `overrides` entry for `ci.yml` or `security.yml` kept only for this, or only to
   drop the backend job, can go.
9. **React + Vite projects that forked kit files.** Add the stack with `kit-sync --packs react-vite --layers
   supabase[,upstream-owned]` (dry-run, then `--apply` records it in `.kit/install.json` **and** in `kit.config.json`
   `stack.packs` / `stack.layers` — a hand-edited config that still says `packs: []` makes a later install stop; a
   project-owned `AGENTS.md` is a seed, so copy the pack's hard rules and skill triggers in from a scratch install). On
   the `upstream-owned` layer a plan cannot add a dependency: `package.json` is upstream's (the scope guard denies it,
   `ship-prep` flags a shell change to it). Move `.gitignore`, `AGENTS.md`, `package.json` (and
   any other upstream-owned file) from `overrides` to `ownership.upstreamPaths` — the `upstream-owned` layer's default
   already lists `.gitignore`, `AGENTS.md`, `package.json` and `package-lock.json`. Then these overrides can be dropped,
   because the kit now covers what they were forked for (drop the entry, sync, check the rendered file; keep an
   override only for a real project difference): `scripts/slot-serve.mjs`, `scripts/take-plan.mjs`,
   `scripts/lib/slot-procs.mjs`, `.claude/skills/worktree-setup/SKILL.md` (Vite slot server, `scripts/package.json`,
   local excludes); `.husky/pre-commit`, `.husky/pre-push` (shebang, optional lint-staged, closed plans in range
   folders); `.github/workflows/ci.yml`, `security.yml` (no backend job, `ci.*` keys), `brain-capture-reminder.yml`
   (title injection), `todo-sync.yml` (the repo-setting error); `.claude/settings.json`, `scripts/ship-prep.mjs`,
   `scripts/session-startup.sh` (Python fallback, SessionStart JSON); `scripts/techdebt-report.mjs`,
   `.claude/skills/techdebt/SKILL.md` (`scan`, `.tsx`, pack rules); `.claude/commands/feat.md`, `fix.md`, `refactor.md`,
   `security.md`, `docs-refresh.md`, `commands.md` (Angular style rules, breadcrumbs); `.claude/skills/save-plan/SKILL.md`,
   `docs/agent/workflow-map.md` (stale paths, pack skill rows). An override for `.vscode/settings.json` that upstream's
   `.gitignore` ignores is not needed either (`ignored`). A tech-debt baseline written with other rule names: re-run
   `node scripts/techdebt-report.mjs scan --write-baseline`.
10. Optional: record a tech-debt baseline once (`node scripts/techdebt-report.mjs scan --write-baseline`, commit
    `<paths.sharedDocs>/techdebt-baseline.json`) so the `techdebt` skill reports `NEW_DEBT: yes|no` against it.
11. Optional: `AGENTS.md` is a seed, so existing projects do not get the Planner review rule. Paste this bullet under
    `## Hard rules`, after the "Architecture invariants" bullet, with your `paths.planChecks` path:
    ```
    - **Architect + PM review (Planner):** the Planner is the Architect and the Product Manager. Every plan the Planner saves — written here or received from Claude.ai, Cursor or another agent — gets `/plan`'s `## Architect + PM review (always)` before it is saved, plus this project's own checks in `{{paths.planChecks}}` when that file exists. A received plan is reviewed, not silently rewritten.
    ```
12. Optional: a project without the angular pack keeps the `.prettierrc.json` it got as a seed (sync never deletes
    seeds); delete it if its code style differs. The `.gitignore` skeleton (a seed) lists three more runtime paths
    (`.claude/*.log`, `.claude/.last-npm-install-hash-scripts`, `scripts/node_modules/`); `take-plan` already adds the
    whole list to `.git/info/exclude`.

### 002 — Planner always runs the Architect and Product Manager review

#### Added
- `/plan` has a `## Architect + PM review (always)` section. It runs on every plan the Planner saves — plans
  it writes and briefs or Plan Contracts it receives — and checks it against the fetched main branch:
  Architecture Impact filled, every named file and symbol exists or is marked new, the standards doc and
  existing patterns followed, scope exact; testable success criteria with tagged Done-when items, Out of Scope,
  backend / auth / security / data impact named, smallest full-value version, every step concrete enough to run
  without asking. It prints one `ARCHITECT + PM REVIEW` block (`no gaps` or one line per gap with a fix); a
  received plan is reviewed, not rewritten, and a gap the Human rejects is noted in the plan's Execution Notes.
  The Planner protocol runs it as step 0 (after `git fetch`), and `brief-detection` routes a Plan Contract
  pasted on main through it.
- `kit-sync`: a file recorded as a seed that the kit now ships as managed is a `conflict` unless it already
  matches the kit (then `same`, recorded as managed). Its recorded hash is the project's own copy (`--adopt`
  records whatever is there), so "unchanged since install" no longer lets sync overwrite it.
- `install-check`: a promoted-seed case (customised copy → `conflict`, `--apply` leaves it), a fourth fixture
  (angular + node-express + Cursor), and an assertion in every fixture that each path `/plan` and the
  `workflow-map.md` `/plan` row load exists.
- `.claude/references/prd-template.md` and `hld-template.md` are kit-managed core files (they were seeds), so
  every project gets the files `/plan` loads, sync keeps them current and `kit-drift` compares them. The PRD template names backend,
  auth, security, data and project-check lines; the HLD template's "Alternatives Considered" table is replaced
  by `### Why this design`.
- Config key `paths.planChecks` (default `docs/project/plan-checks.md`): the project's own planning checklist,
  which the review adds when the file exists. Documented in `kit.config.json`, the README and the `AGENTS.md`
  skeleton.

#### Changed
- Roles: the Planner (Claude Code in the main folder) is the Architect and the Product Manager; Claude.ai or
  another tool may draft. `/plan` no longer says "Claude.ai by default"; `workflow-map.md` §1 and flow F1,
  `README_WORKFLOW.md` (title, roles, cost routing, authoritative files), `/feat`, `save-plan` and `/review-it`
  wording follow.
- `/plan`, `/feat`, `workflow-map.md` and `README_WORKFLOW.md` point at `{{paths.sharedDocs}}/tech-stack.md` and
  `current-state.md` instead of a `/_shared/` folder that is not installed, and `README_WORKFLOW.md` names
  `docs/agent/` instead of a `.claude/rules/` folder that does not exist.

### 003 — Stack-neutral core, part 1: install, slots and runtime files

#### Added
- `scripts/local-excludes.mjs`: the single list of runtime files (slot markers, logs, install hashes, session
  state). It appends the list idempotently to `$(git rev-parse --git-common-dir)/info/exclude` (`--check` exits 1
  when an entry is missing). The `.gitignore` skeleton is rendered from it; install, `take-plan` (before its
  dirty check) and the worktree-setup skill run it, so a fresh clone whose `.gitignore` the project owns is no
  longer refused with "uncommitted or untracked changes".
- `scripts/package.json` (kit-managed, `picomatch` ^4.0.7; its `type` mirrors the root `package.json`, so the
  project's own `scripts/*.js` keep their module type). `install --install-deps` runs
  `npm install` inside `scripts/`; `take-plan` and `slot-serve` install it when `scripts/package-lock.json`
  changes (hash in `.claude/.last-npm-install-hash-scripts`); the root devDependency note no longer lists it.
- `AGENTS.workflow.md`: when the project owns `AGENTS.md` (in `overrides`, or present and not installed by the
  kit), the kit's `AGENTS.md` skeleton is rendered there as a managed file with a header saying who owns what,
  and the `CLAUDE.md` skeleton imports both.
- Config keys `slots.feExec`, `slots.fePortArgs` (default `["--port", "{port}"]`), `slots.feMatcher`,
  `slots.feEnvFile`; the angular pack fills them with its current values. Placeholder filter `|json`.
- `kit-sync`, `kit-drift` and install skip a missing kit file the project's git ignores: state `ignored`
  (sync, drift-check) and `SKIP-IGNORED` (install), instead of `new` / `missing`.
- e2e: a refused claim commit, a fresh clone with its own `.gitignore`, the config-driven frontend dev server
  (started, kept, stopped), the scripts' own install, and `.kit/install.json` in scope. install-check: full
  commands refused, `AGENTS.workflow.md` (pre-existing and overridden `AGENTS.md`), ignored paths, sensitive
  paths and frontend values from config, an i18n folder hotspot, the browser line, the `.gitignore` runtime list.

#### Changed
- The slot frontend dev server comes from config: `commands.dev` names the npm script (no such script in
  `package.json` = no frontend) and `slot-serve` runs `npm run <dev> -- <fePortArgs>`, or
  `npm exec -- <feExec> <fePortArgs>`; `slots.feMatcher` recognises its processes (default `run <dev>`) and
  `slots.feEnvFile` is the optional env file whose `.slot` copy gets the slot's backend port. The port
  arguments must make the server fail on a taken port, never move to another one. It was Angular-only
  (`environment.local.ts` + `ng serve`).
- The node-express pack no longer sets `commands.dev` (`"dev"`): core now reads it as the frontend script, and
  nothing read it before.
- `ship-prep` reads `security.sensitivePaths`: a regex string replaces the built-in sensitive-path regex (the
  default when unset), a list of globs adds to it.
- `project.i18nFile` may be a glob or a folder (`src/locales/` → `src/locales/**`) as well as a file or a
  comma-separated list; every entry is an append-only hotspot.
- `tools.browser` left at its default no longer renders "Browser tool: browser tool." in the `AGENTS.md`
  skeleton; the line keeps only the browser-check guidance.
- Dropped the unused config key `commands.npm`.

#### Fixed
- `take-plan` no longer half-claims a slot when the claim commit fails (e.g. a pre-commit hook): it restores
  the plan file, returns the slot to its detached commit, deletes the new branch and prints
  `TAKE_PLAN: claim commit failed: …`. It checks the result and names any step that did not undo, and a merged
  PR's old remote branch is deleted only after the claim commit succeeded.
- `scope-check` always allows `.kit/install.json` (kit-sync re-records it), so it is never `scope: out`.

### 004 — Stack-neutral core, part 2: CI, commands, tech debt and rules by pack

A project on the angular (and node-express) pack keeps its CI (`server-tests`, the full `npm run <commands.lint>`, the
enforced critical audit) and the same Angular rules, now from the pack; sync shows the changed files as `kit-update`.

#### Added
- Config keys `ci.install` (default `npm ci`), `ci.lintScope` (`all` default | `changed`) and `ci.appAuditMode`
  (`enforce` default | `report`). `changed` lints the changed `*.ts *.tsx *.js *.jsx *.mjs *.cjs` files minus the
  kit-managed ones (`.kit/install.json`): a PR's merge commit against its base side (`HEAD^1`), a push against
  `github.event.before` (a new branch: `HEAD~1`; nothing to compare = pass); a failing `git diff` fails the step.
  `report` runs the app audit with `set +e` and writes the result to `$GITHUB_STEP_SUMMARY` plus a `::warning`.
- `kit-sync --apply` refreshes `scripts/package-lock.json` (`npm install` inside `scripts/`) when it writes
  `scripts/package.json` and the project has that lockfile.
- Conditional blocks in kit files: `KIT:if <key>` / `KIT:else` / `KIT:end` (as `# …` or `<!-- … -->` lines; `key`,
  `!key`, `key=value`, `key!=value`). The backend job and steps in `ci.yml` and `security.yml` render only with
  `paths.serverRoot`.
- Pack fragments: a pack's `fragments` file (`FRAGMENTS.md`, not installed) fills `PACK:<name>` marker lines in core
  files. The angular pack supplies the style rules of `/feat`, `/fix`, `/refactor`, `/security`, their styling and
  auth skill lines, its pre-commit hooks (`pre-commit-no-semi` before the secret scan, `pre-commit-security-grep`
  after it, as before) and its tech-debt greps.
- The pack contract: `pack.json` `provides` names what a pack supplies for core references — `conventionsDoc`,
  `backendDoc`, `styleSkill`, `authSkill`, `docsMapSkill`, `docsMapCheck`, `cssSection`, `componentsSection` — as the
  config keys `stack.<key>` (a project may set its own). Core uses each only inside `KIT:if stack.<key>` with a
  fallback, so a project with no pack gets no dangling path. `pack-check` fails on an unguarded contract key, a key
  no pack provides, a provided file, skill or section that does not exist, a fragment that fills no marker, and a
  core file that names a file or skill only a pack ships.
- `tools/workflow-link-check.mjs`: every backticked path, `node scripts/…` and `npm run <script>` in the installed
  commands, skills, agents, `docs/agent`, Cursor rules and `AGENTS.md`/`CLAUDE.md` must exist (runtime files and
  examples skipped). Without arguments it checks installs with packs `[]`, angular, node-express and both;
  `--target <dir>` checks a project. install-check runs it on each of its fixtures; kit CI runs both.
- `techdebt-report.mjs scan`: counts `any`, `@ts-ignore`, `eslint-disable`, `console.log`, TODO/FIXME and files over
  300 lines in the project's own `.ts .tsx .js .jsx .mjs .cjs .html .css .scss` files (tracked files under
  `paths.srcRoot`, kit-managed files left out, tests left out for `any` and `console.log`), plus the pack's
  `techdebtRules` (angular: legacy `@Input`/`@Output`, `BehaviorSubject`, trailing semicolons), and compares with
  `<paths.sharedDocs>/techdebt-baseline.json`: `NEW_DEBT: yes|no` (`unknown` without a baseline). `--write-baseline`,
  `--strict` (exit 1 on new debt), `--list`. The `techdebt` skill runs it; its `PACK:techdebt` marker is filled by
  the pack.
- Pack seeds: `pack.json` `seeds` marks pack files that are written once, optionally with `skipWhenPresent` (install
  `SKIP-PRESENT`, a sync `NOTE`).
- install-check: CI renders with and without `paths.serverRoot` and with every `ci.*` mode (actionlint on every
  rendered workflow when it is installed; kit CI installs a pinned, checksum-verified actionlint and requires it),
  the link check per fixture, no `KIT:`/`PACK:` directive left in a render, style rules and the prettier seed only
  with the angular pack, the pre-commit hook order, a prettier seed skipped next to `prettier.config.js`, and the
  tech-debt scan (core and angular rules, baseline, `--strict`).
- `standards-git.md` and `/ship`: pass `-R <owner>/<repo>` (from `git remote get-url origin`) on every `gh` call —
  in a fork `gh` targets the parent repo — and edit a PR with `gh api -X PATCH repos/<owner>/<repo>/pulls/<n>
  -F body=@<file>` when `gh pr edit` fails on the Projects (classic) deprecation.

#### Changed
- Core commands carry no stack style rules: `/feat`, `/fix`, `/refactor` and `/security` say "Match the file's
  existing style; never reformat untouched lines" and take the rest from the pack. `/review`, `/fix`,
  `/docs-refresh`, `/security`, the techdebt skill and `pr-check-fix-loop.md` reach the conventions doc, backend
  standards, styling, auth and docs-map skills through the pack contract; `/fix` "Loads by area" names the pack's
  real standards-doc sections.
- `.prettierrc.json` moved from `templates/` to the angular pack (a seed).
- `ci.yml`: `server-tests` runs inside `paths.serverRoot` (`working-directory`) instead of `npm --prefix`; the gate's
  `needs` is a block list; the docs-only path filter drops three patterns `*.md` already covered (shellcheck SC2221).

### 005 — React-Vite pack, upstream-owned layer and adoption checks

#### Added
- `packs/react-vite/`: React + Vite + TypeScript standards (`standards-react.md`: server state in the query library,
  caller-scoped query keys, one session source, typed data access, realtime cleanup, lazy routes that reload once on a
  missing chunk, Tailwind tokens, right-to-left-safe utilities) and conventions; the `react-component-structure`,
  `cssLayer` and `auth-and-logging` skills; Vite gotchas; the pack contract (`conventionsDoc`, `styleSkill`, `authSkill`,
  `cssSection`, `componentsSection`; no docs-map skill, so `/docs-refresh` takes its fallback); fragments for
  `/refactor`, `/security`, the `techdebt` skill and the `workflow-map.md` skill rows; tech-debt rules `inner-html`,
  `banned-state`, `raw-fetch`; config defaults: `commands.dev: "dev"`, `slots.fePortArgs` with `--strictPort`, the Vite
  process matcher, base port 5173, `paths.routesFile` and the `src/App.tsx` hotspot, no backend.
- Layers beyond Cursor: `layers/<name>/layer.json` takes the optional fields of `pack.json` and applies after the packs;
  `--layers` on install, sync and drift-check, `stack.layers` in the config, `layers` in `.kit/install.json`.
  `layers/supabase/`: Supabase backend standards (`standards-supabase.md`, the `backendDoc` contract key), gotchas,
  sensitive paths, the `ui-table-call` tech-debt rule. `layers/upstream-owned/`: `ownership.upstreamPaths`, CI defaults
  (`ci.install: npm install --no-audit --no-fund`, `ci.lintScope: changed`, `ci.appAuditMode: report`), the `/pull-copy`
  command (rebase on `upstream/main`, never resolve a conflict, the force-push left to the Human), gotchas and a hard
  rule.
- Config key `ownership.upstreamPaths` (globs): matching kit files are never written by install and count as
  `override` in sync and drift-check; a matching `AGENTS.md` sends the rules to `AGENTS.workflow.md`; a matching
  `package.json` gets no devDependencies; in a slot `scope-check` prints `SCOPE: upstream <path>` and the scope guard
  denies it ("upstream-owned, not an `approved:`"), even when the plan lists it; `ship-prep`'s scope check names it.
- Stack detection: `pack.json` / `layer.json` `detect` rules (`deps` in the root or backend `package.json`, a `path`, a
  `gitRemote`). With no `--packs` and no `stack.packs`, install prints `KIT_INSTALL: detected packs=[…] layers=[…]` with a
  reason per entry, writes nothing until `--yes`, then records the stack in `kit.config.json`. node-express is detected
  from the backend folder only (an SSR frontend lists `express` in the root); a `suggestOnly` rule (the `upstream`
  remote → `upstream-owned`) is printed as a suggestion and never installed by `--yes`. Install stops when
  `kit.config.json` `stack.*` and `.kit/install.json` disagree; `adoption-report` flags it.
- `ownership.upstreamPaths` takes `**`, `*`, `?` and a trailing `/` only (the syntax the kit's matcher and the scope
  guard's read alike): install and sync refuse braces, character classes and `!`; `pack-check` checks pack and layer
  defaults.
- `kit-sync --packs / --layers` add a pack or layer to an installed project (`--apply` records them in
  `.kit/install.json` and `kit.config.json`); `kit-install.ps1
  -Layers -Yes`, `kit-sync.ps1 -Packs -Layers`. Every tool flag also takes `--flag=value` (PowerShell 5 drops an empty
  argument, so the wrappers pass `--packs=`).
- `tools/e2e-check.mjs --project <path>`: the e2e cycle on a scratch copy of a real installed project — slots borrow its
  `node_modules` through junctions (removed with `rmdir`, also from exit and signal handlers when the run is
  interrupted; the source checked intact afterwards; never delete its temp folder recursively while a link is there);
  `/pull-copy` and the e2e use the upstream's own default branch (`refs/remotes/upstream/HEAD`); the plan commit runs the
  hooks; claim, guards (hotspot, upstream-owned path), the slot dev server, ship, merge, close-out, a Planner close-out
  push into a range folder, `/pull-copy` (replay, refused force-push, conflict abort) with an upstream, drift-check, the
  maintenance scripts and SessionStart JSON.
- `tools/adoption-report.mjs --target <dir> [--markdown <file>]`: one row per workflow part (install record, managed
  files, stack vs detection, each Claude Code hook and git hook, hooks enabled, scripts dependencies, runtime ignores,
  kit rules loaded, npm scripts, frontend dev server, doc links, CI) with `ok` / `warn` / `fail`.
- `tools/acceptance-check.mjs [--e2e]` and `tools/fixtures/make-fixture.mjs`: Angular + Express, React-Vite + Supabase and
  an upstream-owned React-Vite copy (double quotes and semicolons, no husky, an `upstream` remote). Each: detection, install,
  link check, drift-check with no hand-written override, rendered CI, adoption report, the first commit through the hooks;
  `--e2e` then runs `e2e-check --project` on the two React-Vite fixtures. Kit CI runs it on Linux and Windows.
- install-check: a React-Vite + Supabase fixture, the React tech-debt rules, stack detection (proposal, `--yes`, nothing
  matching, explicit packs win) and the upstream-owned layer; workflow-link-check covers react-vite and both layers.
- `pack-check` checks layers too, plus `detect` rules and `techdebtRules` patterns.

#### Changed
- `install` with no `--packs`, no `stack.packs` and no recorded packs detects the stack and stops until `--yes` (exit 2),
  instead of installing the core alone (what-to-do item 2).
- `workflow-map.md` §4 has a `PACK:workflow-map:skills` marker for the pack's skill rows (no pack section = no line).
- `workflow-map.md` and `README_WORKFLOW.md` name `.cursor/commands/` and `contractor-role.mdc` only with the Cursor
  layer (new builtin `kit.cursor` for `KIT:if`): an install without `--cursor` (e.g. the angular pack alone) had two
  dangling references. Renders with `--cursor` are unchanged.

## [1.0.5] - 2026-10-18

Fixes found installing the kit into a React + Vite project. Sync to pick them up (`kit-sync -Ref v1.0.5 -Apply`);
nothing else to do.

### Fixed
- Git hooks: `.husky/pre-commit` had no shebang, so git without the husky wrapper (`core.hooksPath=.husky`)
  could not run it on Windows and every commit failed. Both hooks now start with `#!/usr/bin/env sh` and
  `set -e`, lint-staged runs only when it is installed, and install and sync write the hooks as executable
  (chmod 755 and `git add --chmod=+x`). The install note names both ways to enable the hooks.
- SessionStart: the context sat under `decision`, where Claude Code ignores it, so the slot role and the
  resumed session state never reached the session; and quotes or newlines in the session-state file broke
  the JSON. The output is now built in node, with `additionalContext` directly under `hookSpecificOutput`.
- CI: the `gitleaks` job asks for `contents: read` and `pull-requests: read` and posts no comments
  (`GITLEAKS_ENABLE_COMMENTS: false`), so it runs with a read-only default token.
- Python: the session-manifest hook runs through `scripts/run-python.sh` (first of `python3`, `python`, `py`
  that works, else a quiet no-op), and `ship-prep` tries the same three and prints a warning instead of
  silently falling back to the full dirty-file list.
- pre-push: a push to main that only moves closed plans into a range folder (`plans/300-400/…`) is allowed.
- todo-sync: when GitHub refuses to let Actions open the PR, the run deletes its `chore/todo-sync-*` branch
  and prints an error naming the repo setting. Install output and the README's first-time setup list it.
- Stale references: `save-plan` named a pre-commit script that only one pack ships, `workflow-map.md` named
  `.claude/todo-archive.md` (it is the folder `.claude/todo-archive/`, written by todo-sync), example plan
  names came from a real project, `/docs-refresh` used Cursor's subagent type (`general-purpose` in Claude
  Code), and `/security` had a garbled step and leftover "three-agent" wording.

### Added
- `tools/e2e-check.mjs` cases: a project without husky runs the hooks (first commit passes, a staged fake key
  is refused); SessionStart prints valid JSON on each branch; pre-push accepts a range-folder plan and still
  refuses code.

## [1.0.4] - 2026-10-18

Security fixes from an automated review. Sync to pick them up (`kit-sync -Ref v1.0.4 -Apply`); nothing else to do.

### Security
- `brain-capture-reminder.yml`: the PR title was pasted into the job's shell script and written to
  `$GITHUB_ENV` under a fixed `EOF` delimiter, so a crafted title could run commands or set variables. PR fields
  now reach the script only through `env:`, the PR number is checked to be numeric, and every multi-line value
  uses a random delimiter.
- `.claude/settings.json`: `Bash(*)` stays allowed, but `permissions.deny` now refuses git-hook bypasses
  (`--no-verify`, `commit -n`, `core.hooksPath`) and force pushes, and `permissions.ask` asks before
  `git reset --hard`, `git clean` and `rm -rf` on absolute, home or `.git` paths. These were human-only by rule;
  now Claude Code enforces it.

## [1.0.3] - 2026-10-18

Kit tooling only; no installed file changes, nothing for a project to do.

### Added
- `tools/e2e-check.mjs`: installs the kit into a fresh project and runs one plan through the whole cycle
  (Planner save, branch and push guards, slot claim, scope guard, ship-prep, push, merge, ledger close-out,
  slot release, drift and sync). A local bare repository stands in for GitHub. CI runs it on Linux and
  Windows for every push and PR, so a release cannot ship a broken cycle.

## [1.0.2] - 2026-10-18

Fixes found by running a fresh project (installed from GitHub) through plan, take-plan and ship. Nothing for a project to do.

### Fixed
- Scope guard: in a project with no i18n file or hotspots, the hotspot list rendered `''`, picomatch threw, and
  the guard failed open (every write allowed, `/ship` reported `scope: out`). Empty entries are dropped.
- `todo-query append` starts `.claude/todo.md` when it does not exist yet, so the first save-plan works.
- `pre-push`: the first push to an empty remote no longer prints a git error.
- Slot `npm install` no longer triggers the DEP0190 warning on Windows.
- `/plan` command text no longer shows `(retired)` placeholders.

## [1.0.1] - 2026-10-18

Installer fix; no managed file changes, nothing for a project to do.

### Fixed
- `kit-install` listed the Node built-in `net` as a devDependency (and `--install-deps` installed the
  unrelated npm package `net`). Built-ins now come from `module.builtinModules`.
- `--install-deps` no longer triggers Node's DEP0190 warning on Windows.

## [1.0.0] - 2026-10-18

First stable release: the source project runs on kit-sync.

### Added
- `kit-install --adopt` (`-Adopt`): brings a project that already carries the workflow under kit-sync. It
  writes only `.kit/install.json` and refuses while the drift check finds an undeclared difference.
  `--no-cursor` (`-NoCursor`) on install.
- `docs/CHANGE-LOOP.md`: how a kit change reaches projects (kit PR → release → `kit-sync -Ref`), semver
  rules for releases, and what to do with a fix found inside a project.

### Changed
- The scope guard's note for a kit-owned file in a plan's scope now says to make the same change in the kit
  and release it, so the next kit-sync sees a matching file.
- Versioning: from `1.0.0`, minor and patch releases never ask a project to act.

### Fixed
- `drift-check` no longer reports an overridden seed as "not a managed kit file".

## [0.5.0] - 2026-10-18

First tagged release.

### Added
- Install, sync and drift-check from a tagged GitHub release: `--source github:<owner>/<repo> --ref <tag>`
  (`-Source` / `-Ref` on the `.ps1` wrappers). The tag is fetched shallow into a per-user cache
  (`~/.cache/ai-workflow-kit/<owner>/<repo>/<tag>/`, or `$AI_WORKFLOW_KIT_CACHE`) and reused while the tag
  still points to the same commit. A tag that moved after it was cached is refused.
- `.kit/install.json` records `source`, `ref` and `commit`. Sync and drift-check use them when no
  `--source` is given; `sync --ref <tag> --apply` upgrades and records the new release. A ref that does not
  exist fails with `ref <tag> not found` before anything is written.
- `--source <kit folder>` for kit development; a plain run records `local:<path>`.
- `leak-check` accepts files as `--root`, and `KIT_LEAK_TERMS` adds private terms from the caller's
  environment. CI also checks `README.md` and `CHANGELOG.md`.
- This changelog, a rewritten README and the release steps.

### Changed
- Workflow files name "the Human" instead of a person.

### Fixed
- `take-plan.mjs` imports `mkdirSync`; a resumed claim no longer crashes.
- `/take-plan` prints only the plan brief at claim time; validation cards stay at close-out (`/done`, `/ship`).

## [0.4.0] - 2026-10-17

Phases 4 to 6A, never tagged. Projects installed from a local kit folder.

### Added
- Installer (`tools/install.mjs`), sync (`tools/sync.mjs`) and the 17 template skeletons; `.ps1` wrappers.
- Drift check (`tools/drift-check.mjs`, `kit-drift.ps1`): byte-for-byte comparison of every managed file.
- Project overrides in `kit.config.json`: install skips them, sync reports `override`, never `conflict`.
- Brain lessons install as seeds (written once, never updated).
- Ownership guard, architecture-invariants gate, plain-language validation cards, open plan folders
  (`plans.openDirs`), automatic plan close-out on merge, skills v2 (14 → 10 skills with scripts and evals).
- Slot dev servers on demand, orphan sweep, per-run slot server logs, plain explanatory titles on Atomic Sub-tasks.

### Fixed
- Squash-merge detection, stale session pointers, todo-sync counting, LF line endings for byte-exact
  comparisons on Windows, and placeholders that rendered wrong in a real project.

## [0.3.0] - 2026-10-02

### Added
- Stack packs (`packs/angular`, `packs/node-express`) with the `pack.json` contract, the optional Cursor
  layer, and the generalized brain lessons.

## [0.2.0] - 2026-10-01

Phases 1 and 2, before this repository existed: the workflow was extracted from its source project into a
stack-neutral `core/` with `{{placeholder}}` config keys and a leak check.

[Unreleased]: https://github.com/WDD-CODER/ai-workflow-kit/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v2.0.0
[1.13.0]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.13.0
[1.12.0]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.12.0
[1.11.0]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.11.0
[1.10.0]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.10.0
[1.9.0]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.9.0
[1.8.0]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.8.0
[1.7.1]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.7.1
[1.7.0]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.7.0
[1.6.0]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.6.0
[1.5.0]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.5.0
[1.4.0]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.4.0
[1.3.1]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.3.1
[1.3.0]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.3.0
[1.2.0]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.2.0
[1.0.5]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.0.5
[1.0.4]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.0.4
[1.0.3]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.0.3
[1.0.2]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.0.2
[1.0.1]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.0.1
[1.0.0]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.0.0
[0.5.0]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v0.5.0
