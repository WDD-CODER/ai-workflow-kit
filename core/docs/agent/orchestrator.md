# Orchestrator — run saved plans unattended into one run branch

An opt-in second workflow beside the Planner/Worker flow. Nothing changes unless the Human starts a run. A run checks
everything first and refuses to start while a plan has an open question, then runs without anyone: per plan a builder,
a gate, a reviewer and a merge into one run branch `{{orchestrator.runBranchPrefix}}<run>` — never into
`{{git.mainBranch}}`. The Human gets one report and merges the run branch himself.

The loop is code (the kit's ADR 0017, "the orchestrator loop is a script"): `scripts/run-plans.mjs` runs it in
a terminal, and only the builder and the reviewer are model calls. The older loop, the workflow
`.claude/workflows/orchestrate.js` started by `/orchestrate`, drives every step through a model and stays until a
later kit release removes it; its own run is described in "The workflow's run" below.

## Pieces

| Piece | File | Does |
| --- | --- | --- |
| Loop | `scripts/run-plans.mjs` | The run as one script: readiness lint, preflight, order, per plan builder → gate → review → merge, the fix round and the escalation, the park, the final gate, the report. `--dry-run` prints all of it and calls no model |
| Headless calls | `scripts/lib/claude-run.mjs` | One agent file run once with `claude -p` (the four context-saving flags, the tier's model, the agent's tools); rate-limit detection. The kit's agent eval uses the same code |
| Gate | `scripts/lib/plan-gate.mjs` | The check commands by script in the plan's folder, with the gate time limit; the receipt (`gate-receipt.json` under the folder's `.claude/`, kept out of git) |
| Review | `scripts/lib/plan-review.mjs` | The reviewer's prompt (plan without its Execution Notes, the diff, the gate receipt), its result validator, the verdict computed from the problems |
| Merge | `scripts/lib/plan-merge.mjs` | `git merge --no-ff` in the merge folder, `merge-verify` (the pin), the merge checks, one push |
| Order | `scripts/lib/run-order.mjs` | Waves and edges from `plan-order.mjs --json`, what a park blocks (`onPark`) |
| Command | `.claude/commands/orchestrate.md` | Starts the workflow from a clean turn: readiness, the batched questions, `go`, the run, the final instructions |
| Workflow | `.claude/workflows/orchestrate.js` | The older model-driven loop (no file, git or clock access); a later kit release removes it |
| State | `scripts/orch-state.mjs` | Every file, git and time step: run branch, merge folder, builder folders, `status.json`, hand-off files, the merge pin, the report |
| Preflight | `scripts/orch-preflight.mjs` | Environment checks before the run and before a retry: disk, database, packages, dev server (started when missing), backend (started for a plan with an `[auto:main]` item), git identity, remote, main folder, settings, a live run; `--ui` before any browser step: the pages' servers, the QA login, the backend from the page's origin |
| Role agents | `.claude/agents/orch-builder.md`, `.claude/agents/plan-reviewer.md` (the script); `.claude/agents/orch-*.md` (the workflow) | One job each; shared contract in `docs/agent/agent-roles.md` |
| Runner | `.claude/agents/kit-runner.md` | Runs the state and preflight commands for the workflow only (mechanical tier); the script needs none |

## Settings (`kit.config.json` → `orchestrator`)

`run-plans.mjs` reads `runBranchPrefix`, `maxFixRounds`, `minFreeDiskGb` (through the preflight), `onPark`,
`gateTimeoutMin`, `staleMin`, `mergeChecks`, `ciMirror`, `prepare`, `useSlots` (through `orch-state.mjs worktree`),
`reviewerMode`, `reviewerModel` and `rateLimitWaitMin`; it runs one plan at a time unless `--concurrency 2` is given.
`concurrency` is the workflow's only. The workflow's old keys (`pilotSize`, `fallbackModel`, `maxNotesPerPlan`,
`maxAgentCallsPerPlan`, `triage`, `triageMinAgreement`, `triageMinGraded`) are removed: the workflow keeps their last
defaults (pilot 3, fallback `opus`, 12 notes, 60 calls, triage `shadow`) until it is removed, and install and sync
ignore a project value with a `NOTE orchestrator: <key> removed` line.

| Key | This project | Meaning |
| --- | --- | --- |
| `runBranchPrefix` | `{{orchestrator.runBranchPrefix}}` | Prefix of the run branch every plan of a run merges into |
| `maxFixRounds` | `{{orchestrator.maxFixRounds}}` | How many times problems go back to a builder before the plan is parked |
| `minFreeDiskGb` | `{{orchestrator.minFreeDiskGb}}` | Free disk the environment check asks for, before the run and before a retry |
| `onPark` | `{{orchestrator.onPark}}` | What a parked plan stops: `dependents` = only the later plans that depend on it or share its files (each is `skipped` with the reason), `all` = every later plan, the earlier behaviour |
| `staleMin` | `{{orchestrator.staleMin}}` | Minutes without a `status.json` update after which `orch-state.mjs watch` prints `STUCK` |
| `mergeChecks` | `{{orchestrator.mergeChecks}}` | What the merge step runs on the merged tree: `build` = the project build plus the plan's scope check (lint and tests passed in the plan's gate and run once more at the final gate), `full` = the plan's whole check list on every merge |
| `ciMirror` | `{{orchestrator.ciMirror|json}}` | CI commands (`npm run <script>`, `pnpm run <script>`, `node scripts/…` or `node tools/…`, no write flag) the final gate runs after the project checks and the kit manifest check, so a green run is a green pull request. Install and sync print a `NOTE ci-mirror:` line for each workflow command the final gate does not run; they never write the list |
| `reviewerMode` | `{{orchestrator.reviewerMode}}` | What a STOP of the single reviewer does in `run-plans.mjs`: `advisory` = recorded in the run notes, the plan still merges; `gate` = one fix round with the findings, then the plan parks. `advisory` until the reviewer's measured precision reaches 0.50 in the kit's reviewer eval; `--reviewer-mode` overrides it for one run |
| `reviewerModel` | `{{orchestrator.reviewerModel}}` | The model `run-plans.mjs` runs `.claude/agents/plan-reviewer.md` on, passed as `--model` (the kit's agent eval measured `opus` best; the agent file's own `model:` line stays on `models.review`). Never Haiku: install and sync refuse it |
| `rateLimitWaitMin` | `{{orchestrator.rateLimitWaitMin}}` | Minutes `run-plans.mjs` waits after a call hits a rate or usage limit before it retries that call once; a second limit stops the run (`stopped: rate-limit`) |
| `prepare` | `{{orchestrator.prepare|json}}` | Files the gate generates before the tests: a list of `{ "missing": "<repo-relative path>", "script": "<npm script>", "in": "<repo-relative folder, default .>" }`. Each entry is a first gate command of every plan gate and of the final gate (`node scripts/orch-state.mjs prepare --missing <path> --script <name> [--in <folder>]`): it runs `{{project.packageManager}} run <script>` in the folder only when `<path>` is absent, and fails with the last 20 output lines and the entry when the path is still missing. Not in the merge step's `build` list. Install and sync refuse an absolute path, a `..`, a script that is a full command or an unknown field |

## The run

`node scripts/run-plans.mjs --run <run> --plans <NNN,NNN>` in a terminal (PowerShell or bash); the Human follows it with
`node scripts/orch-state.mjs watch --run <run>`. Every step below is code except the two marked **model**.

1. **Readiness lint, by script.** `plan-order.mjs --json` gives the waves (plans already merged into the run branch are
   left out). Per plan: `scope-check.mjs --deps`, `--arch` and `--tags`; the plan branch name; every `Q:` of
   `## Critical Questions` whose answer is `A: open` (or missing) is printed and refuses the run; the backticked commands
   of the open `[auto]` Done-when items, an `npx …` one mapped to the package.json script that runs it, each held to the
   check allowlist (one that is not allowed is dropped with the reason) and to `orch-state.mjs check-files`. Then
   `orch-preflight.mjs` (which starts a missing dev server or backend, as below). A plan that is not ready, or a failed
   preflight, refuses the whole run before anything is created (exit 1). `--dry-run` stops here and prints the waves,
   each plan's lint, the preflight, the gate commands and the exact `claude -p` lines.
2. **Start.** `orch-state.mjs init` (run branch, merge folder, `status.json`); the builder's lessons from `context`. A
   heartbeat (`orch-state.mjs touch`) keeps `status.json` fresh while a builder works, so `watch` prints `RUNNING`.
3. **Per plan, wave by wave** (one plan at a time; `--concurrency 2` runs two plans of a wave at once; plans that share
   files run one after the other):
   - `plan-info --with-worktree`: the plan's own folder on `feat/<NNN>-<slug>`.
   - **model — builder** (`orch-builder.md` on `models.build`, or `models.judgment` when the plan names an invariant;
     cwd = the plan's folder). Its result is read for `decisions` and `notDone`; its `pass` is never read. The script
     then checks the folder is committed, the branch is ahead of the run branch, and pushes it.
   - **gate**: `plan-gate.mjs` runs `prepare`, the project build, lint and test (`testCi` first), the kit manifest check
     when the project has a manifest, the scope check and the plan's own `[auto]` commands, each with `gateTimeoutMin`;
     an environment error reruns once, then the environment check, then the gate once more without a fix round. The
     builder's guard hooks run during the build (see "Model calls"); the gate checks the scope once more as the
     backstop — with trusted code: the script's own copy, never the branch's `scripts/scope-check.mjs`, on
     the scope as the run branch holds it (a builder cannot widen it; a changed `scripts/**` or `.claude/**` copy the
     scope does not name fails). The manifest check is the main folder's copy run against the plan's folder.
   - `orch-state.mjs diff --no-notes`: the changed files, the test-file gate, and the plan copy without its
     `## Execution Notes` (the reviewer never reads the builder's own account); origin must hold the commit the gate ran on.
   - **model — reviewer** (`plan-reviewer.md` on `reviewerModel`, no write tool, cwd = a detached review folder at the
     checked head, removed after). The verdict is computed from its `blocker`/`major` problems. `reviewerMode`
     `advisory` records a STOP as a run note; `gate` treats it like a failed gate.
   - **merge** (one at a time): `git merge --no-ff origin/<plan branch>` in the merge folder with the anchored subject,
     `orch-state.mjs merge-verify` (the merge commit's second parent must be the checked head; a branch that moved after
     its checks is refused with both shas, the merge folder goes back to `HEAD^`, the plan parks), the `mergeChecks`
     build, then one push of the run branch.
   - **A failure** (gate, enforced review, merge conflict): one fix round on the same tier with the findings; a second
     failure with a new reason gets `handoff --reset-base` and one fresh judgment-tier builder (INV-1); the same reason
     twice, or a failure after that, parks the plan: `orch-state.mjs park` (plan-park.mjs: the work saved on
     `park/<run>-<NNN>`, the folder removed), then `release`. A park skips only the later plans that depend on it or
     share its files (`onPark`); the run goes on.
   - **A rate or usage limit** on a call: the plan is `env-paused`, the run waits `rateLimitWaitMin`, the same call runs
     once more; a second limit stops the run (`stopped: rate-limit`), the plans not started are `skipped`, and the
     Human relaunches the same command after the reset (merged plans are left out from git).
4. **Final gate** on the run branch in the merge folder (`prepare`, the project checks, the manifest check, `ciMirror`).
5. **Report.** The builders' `behaviour:` / `seen:` / `removes:` decisions are recorded in one `decisions` call; then
   `orch-state.mjs finish` writes the report (unchanged). Exit 0 = every plan merged, 2 = some parked or skipped.
   `.claude/orchestrator-runs/<run>/calls.csv` has one row per model call and per gate command:
   `plan,stage,model,seconds,input_tokens,output_tokens,exit`; `status.json` keeps each plan's `calls[]` and `checkedHead`.

## Model calls

Builder, builder fix, judgment builder, reviewer — everything else is code.

| Stage | Agent | Model | Folder | When |
| --- | --- | --- | --- | --- |
| `builder` | `orch-builder.md` | `models.build` (`models.judgment` when the plan names an invariant) | the plan's own folder | once per plan |
| `builder fix` | `orch-builder.md` | the same tier | the plan's own folder | after the first failure, with the findings |
| `judgment builder` | `orch-builder.md` | `models.judgment` | the plan's folder, reset to the base | after a second failure with a new reason (`handoff --reset-base`) |
| `reviewer` | `plan-reviewer.md` | `orchestrator.reviewerModel` | a read-only review folder at the checked head | after each passing gate |

Two calls per plan normally, five at worst, then the plan parks. Every call is
`claude -p --output-format json --system-prompt-file <agent body> --setting-sources local --strict-mcp-config
--disable-slash-commands --no-session-persistence --model <model> --tools <agent tools> --allowedTools <…>`.
`--setting-sources local` loads no project settings, so the builder also gets `--settings` with a file the script
writes in the run's folder (`orchestrator-runs/<run>/builder-settings.json` under the main folder's `.claude/`): only
the `PreToolUse` hooks of the main folder's `.claude/settings.json` (branch, plan-write, scope and write guards), run
from the main folder as in a normal session. A hook's deny wins over `--allowedTools`. The builder keeps a bare Bash
only while those hooks are loaded (else `Bash(git:*)`, `Bash(npm run:*)`, `Bash(pnpm run:*)`, `Bash(node:*)`); the reviewer gets `Read,Grep,Glob,Bash(git diff:*),Bash(git show:*),Bash(node --test:*)`
(never a bare Bash) and `--disallowedTools Edit,Write,MultiEdit,NotebookEdit`, and is refused (the plan parks) when the
review folder holds its own `.claude/settings.local.json` — the one settings file `--setting-sources local` still reads.
`RUN_PLANS_CLAUDE` replaces `claude` (tests pass a fake).

## The workflow's run (until the workflow is removed)

1. **Readiness.** `plan-order --json` gives the waves. One `orch-readiness` agent per plan reports open questions,
   environment needs and the commands the plan will run; `orch-preflight.mjs` checks the environment and starts what is
   missing: with `commands.dev` set, a frontend that does not answer on the base port is started by
   `scripts/slot-serve.mjs --main --servers fe` (`<pm> run <commands.dev>`, no port arguments); a plan with an open
   `[auto:main]` item gets the main folder's backend the same way (`--servers be`: `<pm> run <commands.devLocal>` in
   `server/`, or `commands.devRemote` when the request said `remote`; default scripts `dev:local` / `dev:remote`). A
   server that answers is never touched; a held port is refused with its holder named, never killed; a failed start
   stops the run before any builder with the server's own log lines (`fe.log` / `be.log` under `.claude/`) and the
   exact command. It never asks the Human to start a server. The servers it started stay up after the run, like
   hand-started ones; `node scripts/slot-stop.mjs --main` stops only those (recorded in `.main-serve-pids` under
   `.claude/`). The command
   asks the Human every question in **one batch**, writes each answer into that plan's `## Execution Notes` (a plan
   commit on `{{git.mainBranch}}`), and leaves out a plan whose question stays unanswered. Then the Human says `go` —
   unless there was nothing to ask (`askHuman` false: every plan ready, no question, no environment need, no main-folder
   command, preflight ok), when the run starts at once; `/orchestrate … ask` keeps the pause.
2. **Start.** `orch-state.mjs init` creates `{{orchestrator.runBranchPrefix}}<run>` from `origin/{{git.mainBranch}}` (or reuses it on a
   relaunch), adds the merge folder `<repo>-orch-merge-<run>` beside the main folder, gives the branch an empty first
   commit `orch(<run>): run start` (a builder branch cut from it is then never an ancestor of `origin/{{git.mainBranch}}`, so a
   Planner session's `free-merged-slots` cannot free a slot the run holds) and pushes it. The merge folder gets its
   packages (`ensureDeps`, the same install a builder folder gets): the merge step runs the project checks there, and a
   worktree starts without `node_modules`. A folder that cannot be provisioned is an environment failure before any
   builder runs. `init` reads its own clock for `startedAt`; the command passes no time.
3. **Per plan, wave by wave** (plans of one wave in parallel; plans that share scope — a lock group — one after the
   other):
   - builder (`orch-builder`, scope-guarded, on `feat/NNN-<slug>`): in an idle permanent slot when there is one
     (`{{slots.nameFormat}}` detached, no `.worktree-plan`, clean; `orchestrator.useSlots`), else in its own folder
     `<repo>-orch-<run>-<NNN>`. A slot is marked with `.worktree-plan` while the plan builds and given back
     (`orch-state.mjs release`: detached again, marker removed) when the plan is merged or parked; a slot with uncommitted
     or unpushed work stays claimed and the run says why. A slot already has its packages, so a builder in a slot installs
     nothing; a folder of its own installs once before the builder starts (with pnpm, quickly: one shared store).
     Packages are never linked in from the main folder: on Windows git follows a junction when it removes a worktree
     and would delete the main folder's packages. At most `orchestrator.concurrency` builders run at once (default 2).
     The plan branch is made with `--no-track` (its upstream is never a run branch; a reused branch whose upstream is
     anything but its own remote branch, such as this or an earlier run's branch, loses it) and the builder pushes with `git push -u origin <branch>`. A branch from an earlier
     run is reused and the run branch merged into it; when that merge conflicts in the plan's own file only, the script
     resolves it — the run branch's text, with the builder's ticked sub-tasks and its own Execution Notes lines put back
     (`mergePlanFile`) — and any other conflict parks the plan with the conflicted paths;
   - gate (`orch-gate`): first the `orchestrator.prepare` commands (generated files the tests need), then the project
     checks, then `node scripts/kit-manifest-check.mjs` when the project has a kit manifest (a plan that adds an inventoried
     file or an ADR is sent back as `unclassified: <path>` until the manifest lists it; the merge step never runs it); the project checks are (`commands.build`, `commands.lint`, and `commands.testCi` when set, else
     `commands.test`; run with `{{project.packageManager}} run`; each stopped after `orchestrator.gateTimeoutMin`
     minutes and reported as a fail, never a hang — a watch-mode test script is the usual cause, and preflight warns about
     it) plus the plan's own check commands from readiness — only `{{project.packageManager}} run
     <script in package.json>`, `node tools/…`, `node scripts/…` or `node --test <files>` (any other is dropped with
     a run note). A kit script that pushes, opens a pull request or writes run, plan or slot state (`kit-feedback`,
     `orch-state`, `decision-log`, `take-plan`, `slot-serve`, `sync`, …) is never a check, whatever its folder; the
     project's own check scripts are; a script run with `--write`, `--apply`, `--fix` or `--update` is not a check
     either. An `npx <tool> <args>` check runs as the package.json script whose body is exactly that command
     (readiness asks `orch-state.mjs scripts`; `npx eslint .` → `{{project.packageManager}} run lint`); one no script runs
     is denied with the reason, shown in the readiness summary under `dropped npx checks:` and in the run report, and
     never stops the run — the gate still runs the project's build and tests. Exactly one result per command: a result the gate lost (a run got 1 of 8 back) makes the gate run only the
     missing commands again, once, with no builder round; a command still missing after that is an environment failure.
     A result for a command not asked for, or two for one command, is a fail. When the plan has `[auto:main]` items,
     a second gate then runs their commands from the main folder (below);
   - finders in parallel (`orch-check-plan`, `orch-check-bugs`, `orch-check-rules`, and `orch-security` only when the
     diff touches a sensitive path or its added lines name auth, permission, password, token or role code), then `orch-verify` on every candidate;
   - the `[ui]` cards (below): each card's own e2e test, run by a gate; the UI validator (`orch-ui`) only for a
     failed or unscriptable card, and only when the run is started with the UI step on (`args.ui`);
   - merger (`orch-merge`), one at a time: `git merge --no-ff --no-commit`, the merge checks (`orchestrator.mergeChecks`
     = `{{orchestrator.mergeChecks}}`: `build` runs the project build plus the plan's scope check only — lint and
     tests passed in the gate and run once more at the final gate; `full` runs the plan's whole list), then the commit
     `Merge <plan branch> into {{orchestrator.runBranchPrefix}}<run> (plan NNN)` and the push. A conflict or a failing check aborts the
     merge (`git merge --abort`) and goes back to the builder as a problem.
4. **Wave gate.** With `onPark` = `{{orchestrator.onPark}}`: a parked plan skips only the later plans that depend on it
   (directly or through a chain; reason `depends on parked <NNN>`, naming the parked plan the chain starts from) or share
   its files (a scope-overlap edge of the plan order; reason `shares files with parked <NNN>`, and what depends on those);
   every other plan still runs, and a run note says how many go on. Inside one wave, a lock-group member after a parked
   member is skipped the same way. With `onPark` = `all`, or when the plan order carries no `edges`, a wave with a parked
   plan is the last one: later waves are not started (`skipped`). A `stopRun` (the merge folder is not clean) and a
   failed final gate stop the run in both modes, and the pilot still stops it after `pilotSize` plans.
   **Pilot.** With `pilotSize` set and more plans than it, only the first `pilotSize` plans (wave order) run; the rest
   are `skipped` with the reason "pilot", the run stops, and the report and the numbered decisions go to the Human.
   `continue` relaunches the same run with `pilot: false`: merged plans are skipped from git, the rest are built with
   the graded decisions and any new rule in `docs/brain/agent-rules.md` in place (`docs/agent/decision-review.md`).
   **Final gate.** After the last wave, one `orch-gate` runs the `orchestrator.prepare` commands first, then the project's build, lint and test commands on the run
   branch (the merge folder) once, plus `node scripts/kit-manifest-check.mjs` when the project has a kit manifest
   (the manifest.json under docs/workflow-kit; the pull request's rules job runs the check; a run once finished green and its pull
   request failed on three test fixtures no manifest entry classified), plus every command in `orchestrator.ciMirror`
   (`{{orchestrator.ciMirror|json}}`; deduplicated, in that order; a command that fails the plan-check allowlist is dropped
   with the run note `ci-mirror check dropped, not run: <why>`). A failure is a finding in the report
   (`Stopped: final gate failed: <command> — <output tail>`, and the command's output) and the run branch is not handed
   over as clean; a merge can break a test no plan's own checks cover. The result is stored in `status.finalGate`. A lesson
   about a failure goes only to the roles that could have caught it, by the failing command's kind (`FINAL_GATE_ROLES` in
   `lib/orch-run.mjs`): `test` to `check-bugs` and `check-plan`, `lint` to `check-rules`, `build` to `check-bugs`, the kit
   manifest check to `readiness`; a ci-mirror or unknown command teaches nobody and `security` never receives one. After
   the Human fixes the cause and re-runs the gate, `node scripts/orch-state.mjs final-gate --run <name> --result ok` records
   the pass: the `final gate …` misses and the final gate's stop reason are removed, and the report (local copy and the run
   branch's) and the run-log row are rewritten from the stored result in the same call (a run that has no report yet gets
   it from `finish`). `--result failed [--command …]` records another failure the same way.
5. **Report.** `orch-state.mjs finish` runs every time the workflow ends — after the last wave, when every plan parked,
   and when a step threw (the run is then stopped with `run stopped with an error: …`). It writes the local copy
   `.claude/orchestrator-runs/<run>.md` in the main folder first (gitignored, opens without a branch switch), then
   `docs/orchestrator/runs/<run>/report.md` and a copy of `status.json` on the run branch; a merge folder that is dirty
   or cannot fast-forward keeps the local copy and the result says `reportCommitted: false` with the reason. `stop` and
   `finish` both give every slot the run still holds back (`releaseSlot`: a slot with uncommitted or unpushed work is
   kept and the line says why), so a run that ends on an environment failure leaves no `{{slots.nameFormat}}` with a stale
   `.worktree-plan`. When `commands.logQuery` is set, `finish` runs it once from the main folder (no shell; only
   `node scripts/…` or `node tools/…`), with `--since=plan-start` replaced by the run's start time, and the report gets
   an `App errors since the run started` section: the command, its exit code and its first 20 lines, never parsed.
   After the local copy is written, and before the branch commit, `finish` also runs `node scripts/brain.mjs send --run
   <run>` in a child process killed after 15 s and prints its one `BRAIN:` line: the run's facts go to the kit's private
   store, or wait in the local queue (`docs/agent/kit-brain.md`). It never changes the exit code or the report.
   `{{git.mainBranch}} untouched` stays `yes` when the only files that changed on `{{git.mainBranch}}` during the run are
   plan files and `.claude/todo.md` (the Planner's own pushes); the line counts them.
   **Learning** (no model call): `finish` also appends the lesson lines of the run to
   `docs/brain/agent-lessons/<role>.md` and this run's row to `docs/brain/run-log.md` (and fills the `✗` columns of the
   earlier rows from `decision-log.md`), both in the merge folder and in the report's commit, and ends the report with
   `Context added by learning: 3.1k chars across 10 roles` and one trend line (`node scripts/orch-state.mjs trend`;
   `Trend: first logged run` with fewer than two rows). At the next launch one `orch-state.mjs context` call (per
   launch, not per plan) reads the lessons, the rules sections and the last three run-log rows, and the workflow puts
   `LESSONS`, `RULES` and `RECENT_RUNS` as JSON arrays of lines in the matching role tasks (`docs/agent/agent-roles.md`
   rule 11). A project without the seeds gets `[]` until its first run writes them. What learns what, and the caps:
   `docs/agent/decision-review.md` §0.

**Environment failures** never cost a fix round: the plan pauses, `orch-preflight.mjs --env-only --run <run>` checks
disk, database and packages (the main folder's and the merge folder's), and the plan is retried once — from the
builder when the failure came before the merge, and as **the merge step only** when the merge failed (the branch is
already built and verified; a run once rebuilt both its plans from the builder for a merge folder without packages). A
second environment failure parks the plan with the reason.

## A check whose file does not exist

Readiness asks `orch-state.mjs check-files` about every file a check command names (`node tools/…`, `node scripts/…`,
the files after `node --test`). A file that is neither in the main folder nor named in the plan's own text (a plan may
create its script) can never pass, whatever a builder does — a run once spent fix rounds and a stronger builder on a
check for a kit script a project does not have. Such a command is dropped, named in `denied` with the reason and
listed in `missingFiles`, and `askHuman` becomes true so the Human sees it before the run.

## Checks that run from the main folder

A Done-when item tagged `[auto:main]` is an `[auto]` check that reads the live environment — the backend's `.env`, a
database, the log store — which a builder worktree and the merge folder never have (secrets are not copied into
folders git removes). Readiness puts its command under `mainCommands`, `/orchestrate` passes them as `mainChecks`,
and right after the plan's worktree gate passed a second `orch-gate` runs them with the main folder as `FOLDER`. Only
a project script qualifies (`node scripts/…`, `node tools/…`, no write flag): a `… run <script>` or `node --test`
belongs in the worktree and is dropped with a run note. A failure is a real failure, `gate (main folder): <command>`,
and goes to the builder like any gate failure. The main folder's code is `origin/{{git.mainBranch}}`, not the plan
branch, so a main check proves the side effects of the plan's own checks (a clean log after its tests ran), never the
plan's code. The merge step and the final gate never run them.

A check that reads a slot's plan-start stamp (`--since=plan-start`, `.slot-plan-start`) is slot-only and is dropped at
launch with the note `main-folder check dropped, not run: … needs a slot's plan-start stamp`. `take-plan` writes that
stamp in a `{{slots.nameFormat}}` slot; a run never takes a plan that way, so the main folder has no stamp, and its
servers run `origin/{{git.mainBranch}}` anyway. A run once spent three fix rounds and a restart on such a check. The
report's `App errors since the run started` section (`commands.logQuery`, above) covers the same question for the run.

A main check always waits for `go`. It is the one place in a run where a plan-supplied command touches the Human's
live environment, so readiness lists every one under `mainApproval` (`<NNN>: <command>`), `askHuman` is true, and
`/orchestrate` shows them in its list and waits — even when nothing else is open. After `go` the command passes
`"mainApproved": true` to the run; without it the workflow refuses to start (`stopped: main-approval`, before `init`,
no state file). A run with no `[auto:main]` item is unchanged and still starts on its own.

**A delegated answer** (the Human replies `decide yourself`, `defaults` or `you choose`) never approves a main-folder
command nobody has seen run: the Planner is the only reviewer, and `go` inside a delegated reply proves nothing. For
each `mainApproval` line the Planner runs `orch-state.mjs main-try --run <run> --plan <NNN> --cmd "<command>"` once from
the main folder; it refuses what `mainCheckProblem` refuses, runs the rest with no shell under the gate timeout, records
`{ plan, cmd, exit, at }` in `.claude/orchestrator-runs/<run>/main-tries.json` and prints `MAIN_TRY: <command> exit
<n>`. The run is started with `"mainDelegated": true`; it reads `orch-state.mjs main-tries --run <run>` once after
`init` and keeps only a command that exited 0 for that plan in the last 2 hours (the window preflight uses for a live
run). Any other is left out with the run note `main-folder check dropped: not seen passing from the main folder —
<command>` — no second question. Without `mainDelegated` nothing changes.

The run-start approval list only holds commands that can run: a command `mainCheckProblem` refuses (a slot-only
`--since=plan-start` check among them) never stops the run on `main-approval`; it gets the `main-folder check dropped,
not run` note at its plan.

## What a plan claims

A plan says things about the code — "the editor has 3 row-delete handlers", "every number box is tap-to-edit" — and a
builder trusts them, so a wrong one is found after the merge as a decision to grade. The readiness agent checks them in
the same call (no extra agent, `judgment` tier): at most 8 claims per plan, in plan order — a number next to a code noun,
a named file or symbol said to have or do something, and every `every|all|each <noun>` goal (a file the plan marks new
is skipped). A count or name is searched in the code and the real count goes in `found` with `file:line`. An "every X"
is searched in the whole repo and each hit (at most 10) goes through `scope-check.mjs --file`; the `SCOPE: out` hits are
listed. Every mismatch is a plan question with a default: a wrong count → `build for what the code has; the builder logs
the difference as seen:`; an "every X" with hits outside scope → `widen scope to these files, or leave them as
follow-ups?`, default `leave them as follow-ups` (a delegated answer lists those files in the plan's Execution Notes
readiness line). The workflow validates `claims` like the other readiness fields: past 8 valid claims the rest is
reported as `claimsOver`, an invalid one (no `claim` or no `found`) as a question to check by hand. Cost: about 8–16k
input tokens per plan for the Grep and scope calls.

## A dead agent, a loop, and "is it stuck?"

- **Model fallback.** Every agent call goes through one helper in the workflow. An agent that returns nothing (it died
  on a terminal API error — a blocked model, for one — or the Human skipped it) is called once more on
  `orchestrator.fallbackModel` (`{{orchestrator.fallbackModel}}`), and a run note says `model fallback: <label> <first
  model> → <second>`. A second nothing goes to the caller's park or environment path as before. `inherit` turns the
  retry off. The key refuses a Haiku value: a review agent (the checkers, the verifier, security, UI) never falls back
  to Haiku. Only the orchestrator session's own model is out of reach: the Human switches it with `/model`.
- **A bad copy of a state line.** Every state command (`orch-state.mjs init / worktree / set / …`) reaches the
  workflow as a `kit-runner` agent's copy of its `ORCH_JSON` line — the workflow has no file access. A copy that does
  not parse (a run once parked a plan at `worktree` on a line the command had printed well) is retried once at effort
  `medium`, and a run note says `runner retry: <label> — first attempt: <error>`; the error carries the parser's
  message, the first non-ASCII character (`non-ASCII U+201C at 11`) and the raw line, JSON-escaped. A second bad copy
  parks the plan with that error and `after 2 attempts`. `note` and `finish` are never retried (a note would be written
  twice; `finish` commits the report); every other command is idempotent — `worktree` reuses the folder or slot the
  plan already holds (`plan-info --with-worktree` makes it in the same call). A `\r`, backticks around the line and text after the closing brace parse without a retry.
- **Limits per plan**, counted in the workflow (it has no clock): at most `maxNotesPerPlan` run notes (a note makes no
  agent call of its own — it is queued and rides on the plan's next `set`; a run once wrote about 30
  closing notes in 4.5 minutes as 30 calls), then one last `notes capped` note;
  the same failure reason twice in a row at the same step (`gate: …`, `checker: …`, `ui: …`, `merge: …`, trimmed to
  120 characters) parks the plan at once as `same reason twice: <why>`; at most `maxAgentCallsPerPlan` agent calls, then
  the plan is parked as `agent-call limit`. A parked plan closes with one state write, not a note per step.
- **`watch`.** `node scripts/orch-state.mjs watch --run <run> [--stale-min <n>]` reads `status.json` only (no git, no
  agent, no lock) and prints one line: `RUNNING`, `FINISHED`, `STOPPED: <reason>`, or `STUCK: plan <NNN> · <state> · no
  progress for <n> min · last: <note>` when the phase is `running` and `updatedAt` is older than `orchestrator.staleMin`
  (`{{orchestrator.staleMin}}` minutes), or `STUCK: plan <NNN> · <state> · same reason twice: <note>` when one plan's
  last two notes say the same thing. `STUCK` exits 1, the rest 0 — a project can wrap it in a loop or a notifier. The
  `/orchestrate` command tells the Human the line to run in a second terminal, and prints a `STUCK` line first in its
  final report when the run ended on a limit.

## Running beside a Planner session

`/orchestrate` runs in a **second Claude Code session in the main folder** — never from a `{{slots.nameFormat}}` slot (the
preflight refuses a main folder that is not on `{{git.mainBranch}}`, and a slot is a builder's folder). Rules that keep the
two sessions apart:

- The main folder must be clean (no uncommitted tracked file) at readiness, at `go` and at `continue`: the readiness
  answers are a plan commit on `{{git.mainBranch}}`, and a run never writes the main folder itself.
- Never edit a plan that is in a run: a builder reads it from its branch, and the readiness answers are the last plan
  change before `go`. New tasks go to the plan after the run, or to a new plan.
- One run at a time per plan and per file: the preflight (`--plans`) refuses a run that names a plan of a live run or a
  plan whose Read-Write Scope overlaps one of its plans (lock groups exist only inside one run). A live run is one whose
  `status.json` says `running` and was updated in the last two hours.
- The Planner's `free-merged-slots` (session start, `/plan` step 2) leaves alone every slot a live run holds (by slot
  path or plan branch in `status.json`); the run gives its slots back itself.
- After the Human merges the run branch, `free-merged-slots` also removes the run's merge folder
  (`<repo>-orch-merge-<run>`): only when the run is not live, the folder has no uncommitted file and the run branch is
  merged into `origin/{{git.mainBranch}}` (or its remote branch is gone). It never forces the removal and keeps the local
  branch; a folder it cannot remove (a server still running in it) is reported as `left alone — <why>`.
- To validate a run branch in an idle slot, run `node scripts/slot-serve.mjs --ref <branch>` there: the slot is
  checked out detached at `origin/<branch>` and marked `.worktree-validating`, `scripts/lib/slot.mjs --list` shows
  `detached validating <branch> since <time>`, and neither a run nor `take-plan` claims it. `node scripts/slot-stop.mjs`
  ends it (the SessionEnd hook does too).

## The [ui] cards

A plan's `[ui]` Done-when items (`docs/agent/job-validation.md` Tier 1b) are checked cheapest first:

1. **Script.** The builder writes one short e2e test per item that saves a screenshot, and returns `uiCards`: card
   (the item's text — a card covers only the item it equals, never by part of the title), page, test command,
   screenshot path. The test command passes the same allowlist as the plan's check commands; any other is not run (a
   run note says why) and the card counts as one no script can check. A gate (`orch-gate`, label `ui-gate`) runs each
   test. A pass is recorded in `status.json` with `via: script` and its screenshot, and never reaches the browser
   agent. The items are the `[ui]` bullets of the plan's Done-when sections only (Goals & Success Criteria, Success
   Criteria, Done when).
2. **Environment.** Before any browser step, `orch-preflight.mjs --ui --pages <the cards' pages> [--login <url>]
   [--api <url>]` (`args.uiLogin` / `args.uiApi`, or `ORCH_UI_LOGIN_URL` / `ORCH_UI_API_URL`; the QA user comes from
   `ORCH_QA_USER` / `ORCH_QA_PASSWORD` in the environment and is never printed). A page server that does not
   answer, a login that fails or a backend the page's origin cannot reach **stops before the browser agent**: the plan
   is parked with the reason in `status.json`, and no fix round is spent.
3. **Browser.** `orch-ui` gets at most 5 cards per agent (`docs/agent/agent-roles.md` rule 10: 12 cards run as 3 fresh
   agents, one after the other), only the failed and unscriptable ones (`CARDS`), the "pre-checked — skip" list
   (`PRE_CHECKED`) and the known findings (`KNOWN_FINDINGS`: the failed scripts' output, earlier rounds' UI
   findings). Verdicts: `pass`, `fail` (a `major` finding back to the builder) or `plan-drift` — the plan says X,
   the app has Y: no severity, no fix round, its own section of the report.

With the UI step off, a failed script is a finding for the builder, and a card no script can check is kept as
`unchecked` for the Human.

## Pass, fix rounds and escalation

- **Pass is computed, never read.** A role result's own `pass` flag is ignored: the workflow computes it from the
  gate results, the finders' problems and the verifier's verdicts (a kept `blocker` or `major` with confidence ≥ 80
  fails). A finder that says `pass: true` next to a `major` problem is a fail, and the run notes it.
- **Start tier (INV-1).** A plan whose `## Architecture Impact` names any invariant other than `INV-none` — `preserves`,
  `changes`, `deviation`, or one named without saying which — starts its builder on the `judgment` tier, a pinned
  strong model (`models.judgment`, default `opus`, never `inherit`); a plan with `INV-none` or no Architecture Impact
  starts on `build` (Sonnet by default).
- **Fix loop.** The first problem goes back to a builder on the same tier with the findings (round 1). When that fix
  round fails too — whatever `maxFixRounds` is — or when a builder returns `ESCALATE` or `blocked`, a **fresh** builder
  on the `judgment` tier takes over. It reads the hand-off file (`.claude/sessions/orch-<run>/handoff-<NNN>.md`), the
  plan and `git diff` — never the first builder's transcript or receipt. The script writes that file: `Done:` (the
  sub-task ids ticked in the plan file on the branch, and the branch diff's files) and `Failed:` (the failing checks
  with their tail and the round's open findings as `id file:line rule`), plus the tried step, output tail and replan
  verdict. A failure on the judgment-tier builder that took over parks the plan as `needs the Human`; no third
  builder is started. `maxFixRounds` bounds the build-tier fix rounds only.
- **Test files are guarded by script.** A changed test file (`*.test.*`, `*.spec.*`, `*_test.*`, `*_spec.*`, `test_*`,
  or under a `test`, `tests`, `spec`, `specs`, `e2e`, `cypress`, `playwright`, `__tests__`, `__snapshots__` or `__mocks__`
  folder at any depth; case-insensitive; a rename counts as a change of the old path too) that no line of the plan's
  `## Read-Write Scope` itself names (`tools/test/**`, `src/a.test.ts`; a broad folder glob such as `tools/**` does not
  list the tests under it) is a `blocker` finding. The scope is read from the plan as the run branch (or, for
  `scope-check --diff`, the base ref) holds it, never from the branch's own copy: a test location the Human approves
  mid-run must be in the plan on the base first. The finding is
  `no scope line names a test location`, raised by `orch-state.mjs diff` (`testsOutOfScope`) before any finder runs.
  `scope-check.mjs --diff` prints `SCOPE: test-out <path>` and exits 1 for the same files, so `/ship` gets it too.
- **No progress stops the plan.** Two fix rounds in a row whose builder ends on the head sha the round started on park
  the plan with `no progress: head <sha> unchanged across 2 fix rounds (fix rounds used: n of maxFixRounds)`, before
  the gate runs again.
- **Replan verdict.** A builder that returns `blocked` or `ESCALATE` also returns `planChange: { needed, why }`; every
  escalation writes `replan: yes|no — <why>` into the hand-off file and `status.json`. A judgment-tier builder with
  `needed: true` parks the plan with `replan needed: <why>` instead of using another round.
- **The builder's receipt.** The result also carries `done`, `notDone` and `checksRun`. It is recorded (`notDone` in
  the run notes and the hand-off), never trusted: a `checksRun` pass that the gate failed adds the note `receipt
  contradicts gate: <command>`, and pass still comes from the gate. The receipt never reaches the finders.
- **The verifier sees the gate.** The verify task carries `GATE` — each command, its status and a 20-line tail from
  the same round's worktree gate. It is evidence only and never decides pass.
- **Environment failures cost no round.** A builder, gate or merger that reports an environment failure (disk, network,
  a database that is down, a temp folder in use) pauses the plan (`env-paused`), runs `orch-preflight.mjs --env-only`,
  and retries once when it passes. A failing check or a second environment failure parks the plan with the reason,
  and the wave gate skips what depends on it (the whole run with `onPark` = `all`).
- **A gate env-fail probes the failed command.** When gate commands end `env-fail`, the check also gets
  `--probe "<command>"` for each one and tests that command's own precondition from its text, never by running it:
  `node <file>` → the file exists in the root folder; `npm|pnpm run <name>` → the script is in `package.json` and
  `node_modules` exists. A failed probe parks the plan with its message; when no command has a precondition the check
  can test, the plan parks at once with `environment: no precondition can be checked for <commands>` — a retry would
  only repeat the failure. A probe that passes keeps the one retry. Lost gate results and builder or merge environment
  failures name no command and keep the generic check.

## Runner calls

The workflow only (`run-plans.mjs` runs every state, git and preflight step itself — see "Model calls"). Every shell
command of a workflow run goes through a `kit-runner` agent (a model call), because the workflow script has no file,
git or clock access and no way to run a script itself (checked against the harness globals). So the count of runner
calls is the lever. What already saves calls:

- **Notes** are queued, not called: the queued notes of a plan ride on that plan's next `set` (`--notes-b64`, a base64
  JSON list — the runner re-types a command, and a plain argument is cut at 400 characters), and any still queued go on
  `stop` and `finish`. A note therefore reaches `status.json` at the plan's next state write, not at once; a run that
  dies between two writes loses the notes queued since the last one (the `STUCK` check reads the state and `updatedAt`,
  which every `set` refreshes, so it is not affected).
- **Decisions** are one call: `orch-state.mjs decisions --run <run> --b64 <base64 of a JSON list>` records every
  decision and every repeat marker in order, with the rules of `decision` for each item, all-or-nothing (a bad item
  exits 1 and writes nothing).
  Every queued note has an id (launch, plan, number) that the script records, so the same note sent twice (a runner
  rerun, a queue re-sent after a failed call) is written once.
- **Flakes** are queued like notes and ride on `set` / `stop` / `finish` (`--flakes-b64`). The workflow makes the command
  one line of at most 300 characters before queueing, and a flake the script cannot record is skipped with a
  `WARN — flake skipped` line instead of failing the `set` / `stop` / `finish` it rode on.
- **`plan-info --with-worktree`** answers for the plan's folder too (`wt`, what `worktree` prints) in one call; the
  separate `worktree` call remains for the retry after an environment failure.

The inventory (every `state(` / `runner(` call site of `orchestrate.js`; a test checks that the `Sites` column adds up
to the number of sites in the file). `parsed` = the script reads the answer to branch; `write-only` = it only records.
`done` = already one call; `merge` / `keep` = recommendation for a follow-up.

| Group | Commands | Sites | Parsed or write-only | Recommendation |
| --- | --- | --- | --- | --- |
| Learning context | `context` | 1 | parsed | keep: one call per launch |
| Plan state | `set` (setPlan) | 1 | write-only (the answer is only checked for ok) | merge: the sets that change no state (round, roles, facts, card) could ride on the next state-changing set; the state-changing ones are the `watch` progress signal and stay separate |
| Stop and report | `stop`, `finish` (one helper) | 1 | stop write-only, finish parsed | done: both carry the queued notes and flakes; a failed call puts the queue back, and note ids make a re-send safe |
| Plan order | `order` | 2 | parsed | keep: the order decides the waves |
| Preflight | `orch-preflight.mjs` (run, ui env, env check) | 4 | parsed | keep: the preflight is its own script |
| Readiness file check | `check-files` | 1 | parsed | keep |
| Package scripts | `scripts` | 1 | parsed | keep: once per run |
| Diff | `diff` | 1 | parsed | keep: once per round |
| Merge folder | `clean` | 1 | parsed | keep |
| Plan start | `plan-info`, `worktree` (first call, retry) | 3 | parsed | done: `plan-info --with-worktree` is one call; `worktree` stays only as the retry after an environment failure |
| Hand-off | `handoff` | 1 | parsed | keep: the path comes from the script |
| Run start | `init` | 1 | parsed | keep |
| Main tries | `main-tries` | 1 | parsed | merge: into `init` when the run delegates main-folder checks (follow-up) |
| Slot give-back | `release` | 1 | write-only | merge: into the plan's last `set` (follow-up); after a park's teardown it finds no slot to release |
| Park teardown | `park` (runs `plan-park.mjs`: servers, `park-save`, session lock, slot or own folder, local `park/` branch, `park-record`) | 1 | parsed | done: one call replaces `park-save` and the slot give-back of a parked plan with a folder; safe to repeat |
| Merge only | `merge-ready` | 1 | parsed | keep: once per plan in merge mode |
| Decisions | `decisions` | 1 | write-only | done: one call for N decisions |

In the workflow no call is `script-only`: its runtime cannot run a script without a model, so every row that stays
needs the runner. `run-plans.mjs` makes every one of them script-only; the workflow and this table go together.

## State rules

- **Git is the ledger.** A plan counts as merged only by the anchored subject
  `^Merge \S+ into {{orchestrator.runBranchPrefix}}<run> \(plan NNN\)$` on the run branch. A relaunch with the same run name rebuilds the
  done set from those subjects and never redoes a merged plan.
- `status.json` (`.claude/orchestrator-runs/<run>/status.json`) is written only by `orch-state.mjs`, after every step:
  per plan its state, round, builder tier, sha, reason, free disk and the model and effort each agent echoed.
  **Lesson facts**  — the workflow queues them in memory and they ride on the plan's next `set` call, so they
  cost no agent call; `orch-state.mjs lessons` (also run by `finish`) turns them into lesson lines with no model call:

  | Field (per plan) | Set by | Meaning |
  | --- | --- | --- |
  | `roundCauses[]` | `set --round-cause "round 2: <why>"` | the reason a fix round began (`checker: major src/x.ts:12 <rule>`, `gate: <command>`, …) |
  | `causeFacts[]`, `diffFiles[]` | `set --causes-b64` (rides on the same `set` as `--round-cause`) | what the code knows about a fix round, stored by the script: for a gate failure the command and the first path of the branch diff the failing output names; for a checker failure each finding's `id`, its `INV-n` rule when `docs/brain/invariants.md` holds it, and its file when it is in the diff. `diffFiles` is git's own list for the plan branch against the run branch (40 paths at most); a path a model wrote is kept only when git lists it |
  | `escalations[]` | `handoff` | `{ step, check }` of each escalation to a fresh judgment-tier builder |
  | `verify` | `set --candidates --refuted --refuted-rules --verify-by --late-low --reappeared` | the verifier's totals for the plan so far: candidates and refuted, per finder (`byRole`), refuted rule names, problems kept below the threshold that later mattered (`lateLow`) and refuted ones that came back (`reappeared`) |
  | `misses[]` | `set --miss "<what>"` | a `[ui]` card failed after the checkers passed that plan (older runs also hold `final gate …` entries; a passing final gate removes them) |
  | `finalGate` (run level) | `finish --final-gate ok\|failed [--final-gate-command "<cmd>"] [--final-gate-plans N]`, or by hand `final-gate --run <name> --result ok\|failed [--command "<cmd>"] [--plans N]` | `{ ok, command, at, attempt, blamed[] }`: the final gate's latest result, the failing command and the one plan whose changed file the failure names (none when two plans changed it). `attempt` counts changed outcomes; the same call twice is a retry and changes nothing. The lesson routing, the report and the run-log row all read this one place |
  | `gateEvents[]` | `set --gate-event "<text>"` | `timed out: <command>`, `env-fail rerun: <command>` |
  | `ready`, `asked[]` | `set --ready yes\|no --asked "q1 \|\| q2"` | whether readiness called the plan ready (from `args.asked`), and the questions it had to ask |
  | `uiCards[].regressed` | `set --card …` | the card passed earlier and fails now |

  **A lesson line names a fact the code produced, or there is no line.** Fix-round lines are `fix round caused by: <command
  kind> failed at <diff file>` (the file left out when no failing file is in the diff) or `fix round caused by: finding <id>
  (rule INV-n) in <file>`; a parked plan gives `parked: <prefix>` only for the fixed start of the reason that `park()` writes
  (`same reason twice`, `agent-call limit`, `no progress`, `replan needed`, `hand-off file`, `worktree`, `environment`, `UI
  environment blocked`, or the ending `— needs the Human`), never the model text after it; the final-gate line is `missed: the
  final gate failed (<kind>: <file>)`. A cause, reason, rule or question with no such fact gives no line, and no `asked about`
  line is written (the readiness question is the agent's text). A rule name counts as registered only when it is an `INV-n`
  id of `docs/brain/invariants.md`.

  Not derived from transcripts: a fact is a field the workflow wrote when it happened. The literal "card failed in the
  browser after its script had passed" cannot happen (a passing script card never reaches the browser agent); the `ui`
  lesson is the card that **regressed** (passed in one round, failed in a later one).
- Times come from `orch-state.mjs` and the workflow's `args` (`startedAt`); the workflow script has no clock.
- Every count in a message comes from `status.json` or an anchored git command run in the same turn.
- A relaunch while a run of that name is live (status `running`, updated in the last 2 hours) is refused; after a
  crash, `node scripts/orch-state.mjs stop --run <run> --reason "<why>"` ends it first.

## A plan that will fail is stopped before its builder

- **Code a commit guard refuses.** The run's preflight (`orch-preflight.mjs --plans`) reads the code each plan
  *prescribes* — its fenced code blocks (not ```` ```scope ````) and inline code spans, never prose, and none of the
  sections that only describe the plan (Problem Statement, Goals, Out of Scope, Critical Questions, Execution Notes,
  Step 0, Architecture Impact, the scope sections) — and runs it through
  every installed `scripts/pre-commit-*.mjs` guard that exports `scanGuardText(text, file)`
  (`scripts/lib/plan-guard-scan.mjs`). A hit parks the plan before any builder: `preflight: guard <script> line <n>:
  <rule> — plan line <n>: <text>`; a plan that depends on it is skipped. The security guard
  (`pre-commit-security-grep.mjs`) also reports a log call of a variable assigned from a PII-named expression earlier in
  the file. Its one exception is a comment (`//`, `/*` or `<!--`) on the log line it excuses, `// security-grep-allow:
  <reason of 10+ characters>`, printed when the guard passes the line; it never excuses an innerHTML hit, and no path,
  folder or setting turns the guard off.
- **A [ui] card role with no login.** `ui.logins` in the project config is a list of login recipes, one per role —
  `[{ "role": "<role>", "url": "<login page>", "userEnv": "<ENV_NAME>", "passEnv": "<ENV_NAME>" }]`, environment
  variable **names** only, never values. A card names its role as `as the <role> user` (or `role: <role>`); preflight warns `ui login: no recipe
  for role <role> (plan NNN card <n>)`, and when recipes exist, `no role named` for a card without one. `--ui --role
  <role>` logs in with that recipe.
- **Leftovers of earlier runs.** Preflight lists, one warning line each: a `feat/NNN-*` branch (local or on origin) of
  a plan in the run that is not in the run branch, every `park/*` branch, a slot holding a `.worktree-plan` marker or a
  branch, and an `<repo>-orch-<run>-<NNN>` builder folder still on disk. They are run notes; the run goes on.
- **The park branch.** When a plan is parked, the builder's uncommitted work (tracked changes and new files, never an
  ignored one) is committed as `WIP: park <run> <NNN>` on the fixed branch `park/<run>-<NNN>` — on top of that branch
  when an earlier park made it — and pushed (`orch-state.mjs park-save`). The plan branch is not touched. Then the
  folder is cleaned and a slot is given back. Nothing uncommitted makes no branch; a failed push keeps the folder as it
  was, with a run note. The workflow runs all of a park's teardown as one call, `node scripts/orch-state.mjs park --run <run>
  --plan <NNN> --reason-b64 <b64>`, which runs `node scripts/plan-park.mjs` (a Human runs that script directly): the folder's dev servers stopped, `park-save`, the folder's `.claude/.session-lock`
  deleted, a slot released or the plan's own builder folder removed (`git worktree remove --force`, only after the work
  was saved), the local `park/<run>-<NNN>` branch deleted once origin holds the same commit, and the park recorded once
  in status.json (`orch-state.mjs park-record`: `plans[NNN].park`). It exits 0 and logs every step; run again, it
  changes nothing — so a Human can run it after a stopped run too.
- **A database write the plan does not list.** `orch-state.mjs worktree` writes the marker `orch-builder.json` into the
  builder worktree's own git dir (run, plan, plan path, branch and the run branch's commit). Only there, the scope guard
  answers a migration, a seed or a raw database-client write (`scripts/lib/db-write.mjs`) that is not a line of the
  code the plan prescribes — read from that commit, never from the builder's copy — with `ESCALATE: db-write <command>`
  before it runs. The builder returns `ESCALATE`; the run parks that plan with `ask: …` and records a decision forced to
  `ask` (`forced: db-write`); the other plans go on. A Human session and a Worker slot have no marker and are judged as
  before.
- **Merge only.** `args.mode: "merge"` resumes a run at the merge: for each plan `orch-state.mjs merge-ready` checks
  that `status.json` recorded the head that passed its gate and checkers (`checkedHead`: the full sha the state
  script's `diff` read for the checkers, written by `set --checked-head` just before the merge) and that the plan
  branch on origin is still exactly at it; then that commit is merged with no builder, gate or checker, and the final
  gate runs. Every merge with a checked head is pinned to it: the merge agent refuses a branch that moved after its
  checks. Any other plan is refused with the reason and nothing is
  merged.
- **Decisions on a relaunch.** The decisions the command shows for grading are this launch's and every earlier
  launch's that has no grade row for this run yet (`decisionsInView`); `finish` returns those as `earlierDecisions`.

## Never

- Merge into, push to or check out `{{git.mainBranch}}` from a run; the Human merges the run branch.
- Answer or resume a worker agent, or relay chat into agents: every agent starts from a clean prompt the workflow
  builds.
- Use a command on the deny list (`docs/agent/agent-roles.md`); the merge folder is kept clean with
  `git merge --abort`, never with a destructive command.
- Write the Human's uncommitted files: the run refuses to start while the main folder has uncommitted tracked files.
- Run unbounded background commands; long output goes to a file and only its tail is read.
- State a count it did not compute.

## The report

Merged, parked and why; the decisions agents took, each listed once (a repeat in other words is an `also:` line) and
numbered `D1…Dn` — under `## Decisions`: `### To grade`, `### Accepted by triage`, `### Follow-ups`, `### Noise` and
`### Not triaged`, after the line `triage: <mode> · agreement (last 50): <n>% · collapsed: <n> · ask: <n> · follow-ups: <n>`
(every `seen:` defect an agent noticed is among them, and every `removes:` line — a user-facing behaviour a builder took away — comes first of all; those three kinds are the only ones kept: a confirmation or
evidence line an agent put in `decisions` is dropped and counted, `dropped <n> confirmation line(s)`), and the reply
format `decisions: ok` | `D<n> ✗ <what I'd choose>` for the Human to grade (`docs/agent/decision-review.md`); the
run notes under `## Run notes`; the
models each agent ran on; what only the Human can do — one
validation list, numbers running on: first a card per `removes:` decision of a merged plan (`### Removed behaviour — check
before merging the PR`), then a **screenshot grid per page** (one row per `[ui]` card of a merged plan: title,
models each agent ran on; **Flaky checks** (only when `status.json` has any: a check that passed only on the gate's own
rerun after an env-fail, or on the next gate with no new commit — recorded by `orch-state.mjs flake` in
`plans[NNN].flakes[]`, the final gate's in `flakes[]`; the run goes on and the fix round it cost stays spent, the record is
what lets the Human fix the test); what only the Human can do — one
validation list, numbers running on: a **screenshot grid per page** (one row per `[ui]` card of a merged plan: title,
verdict with who checked it — script or browser — and the round, and a thumbnail link to each screenshot; kept in
`status.json` as `uiCards`), then **plan drift** in its own section (no severity, not a bug: update the card or the
plan), then the `[ui]` cards no one could check and every `[human]` item of the merged plans, which name no page, per
plan — still shown to the Human as cards — and a decision for each parked plan; and the
PowerShell lines that open the pull request of the run branch. The end-of-run message prints the report path and those lines.
