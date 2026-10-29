# Orchestrator — run saved plans unattended into one run branch

An opt-in second workflow beside the Planner/Worker flow. Nothing changes unless the Human starts a run with
`/orchestrate <plans>`. A run checks everything first, asks every open question in one batch, then runs without
anyone: per plan a builder, a gate, independent checkers and a merge into one run branch
`orch/<run>` — never into `main`. The Human gets one report and merges the run
branch himself.

## Pieces

| Piece | File | Does |
| --- | --- | --- |
| Command | `.claude/commands/orchestrate.md` | Starts a run from a clean turn: readiness, the batched questions, `go`, the run, the final instructions |
| Workflow | `.claude/workflows/orchestrate.js` | Readiness, ordering, the per-plan pipeline, the fix loop, the wave gate. No file, git or clock access |
| State | `scripts/orch-state.mjs` | Every file, git and time step the workflow needs: run branch, merge folder, builder folders, `status.json`, hand-off files, the report |
| Preflight | `scripts/orch-preflight.mjs` | Environment checks before the run and before a retry: disk, database, packages, dev server, git identity, remote, main folder, settings, a live run; `--ui` before any browser step: the pages' servers, the QA login, the backend from the page's origin |
| Role agents | `.claude/agents/orch-*.md` | One job each; shared contract in `docs/agent/agent-roles.md` |
| Runner | `.claude/agents/kit-runner.md` | Runs the state and preflight commands for the workflow (mechanical tier) |

## Settings (`kit.config.json` → `orchestrator`)

| Key | This project | Meaning |
| --- | --- | --- |
| `runBranchPrefix` | `orch/` | Prefix of the run branch every plan of a run merges into |
| `maxFixRounds` | `2` | How many times problems go back to a builder before the plan is parked |
| `minFreeDiskGb` | `5` | Free disk the environment check asks for, before the run and before a retry |
| `pilotSize` | `3` | A run with more plans than this builds the first `pilotSize` plans in wave order, stops with the report and the numbered decisions, and starts the rest on the Human's `continue`; 0 = off |
| `fallbackModel` | `opus` | The model a dead agent (one that returned nothing: a terminal API error, a blocked model) is retried on, once; `inherit` = no retry. Never Haiku: the retry may be a review agent |
| `staleMin` | `10` | Minutes without a `status.json` update after which `orch-state.mjs watch` prints `STUCK` |
| `maxNotesPerPlan` | `12` | Run notes one plan may write (every note is one runner agent call); the last one says `notes capped` |
| `maxAgentCallsPerPlan` | `60` | Agent calls one plan may make before it is parked (`agent-call limit`) |

## The run

1. **Readiness.** `plan-order --json` gives the waves. One `orch-readiness` agent per plan reports open questions,
   environment needs and the commands the plan will run; `orch-preflight.mjs` checks the environment (with
   `commands.dev` set, the dev server must answer on the base port or start through `scripts/slot-serve.mjs`; a failed
   start stops the run before any builder). The command
   asks the Human every question in **one batch**, writes each answer into that plan's `## Execution Notes` (a plan
   commit on `main`), and leaves out a plan whose question stays unanswered. Then the Human says `go`.
2. **Start.** `orch-state.mjs init` creates `orch/<run>` from `origin/main` (or reuses it on a
   relaunch), adds the merge folder `<repo>-orch-merge-<run>` beside the main folder, gives the branch an empty first
   commit `orch(<run>): run start` (a builder branch cut from it is then never an ancestor of `origin/main`, so a
   Planner session's `free-merged-slots` cannot free a slot the run holds) and pushes it. The merge folder gets its
   packages (`ensureDeps`, the same install a builder folder gets): the merge step runs the project checks there, and a
   worktree starts without `node_modules`. A folder that cannot be provisioned is an environment failure before any
   builder runs. `init` reads its own clock for `startedAt`; the command passes no time.
3. **Per plan, wave by wave** (plans of one wave in parallel; plans that share scope — a lock group — one after the
   other):
   - builder (`orch-builder`, scope-guarded, on `feat/NNN-<slug>`): in an idle permanent slot when there is one
     (`wt-N` detached, no `.worktree-plan`, clean; `orchestrator.useSlots`), else in its own folder
     `<repo>-orch-<run>-<NNN>`. A slot is marked with `.worktree-plan` while the plan builds and given back
     (`orch-state.mjs release`: detached again, marker removed) when the plan is merged or parked; a slot with uncommitted
     or unpushed work stays claimed and the run says why. A slot already has its packages, so a builder in a slot installs
     nothing; a folder of its own installs once before the builder starts (with pnpm, quickly: one shared store).
     Packages are never linked in from the main folder: on Windows git follows a junction when it removes a worktree
     and would delete the main folder's packages. At most `orchestrator.concurrency` builders run at once (default 2);
   - gate (`orch-gate`): the project checks (`commands.build`, `commands.lint`, and `commands.testCi` when set, else
     `commands.test`; run with `npm run`; each stopped after `orchestrator.gateTimeoutMin`
     minutes and reported as a fail, never a hang — a watch-mode test script is the usual cause, and preflight warns about
     it) plus the plan's own check commands from readiness — only `npm run
     <script in package.json>`, `node tools/…`, `node scripts/…` or `node --test <files>` (any other is dropped with
     a run note). A kit script that pushes, opens a pull request or writes run, plan or slot state (`kit-feedback`,
     `orch-state`, `decision-log`, `take-plan`, `slot-serve`, `sync`, …) is never a check, whatever its folder; the
     project's own check scripts are; a script run with `--write`, `--apply`, `--fix` or `--update` is not a check
     either. Exactly one result per command: a result the gate lost (a run got 1 of 8 back) makes the gate run only the
     missing commands again, once, with no builder round; a command still missing after that is an environment failure.
     A result for a command not asked for, or two for one command, is a fail;
   - finders in parallel (`orch-check-plan`, `orch-check-bugs`, `orch-check-rules`, and `orch-security` only when the
     diff touches a sensitive path or its added lines name auth, permission, password, token or role code), then `orch-verify` on every candidate;
   - the `[ui]` cards (below): each card's own e2e test, run by a gate; the UI validator (`orch-ui`) only for a
     failed or unscriptable card, and only when the run is started with the UI step on (`args.ui`);
   - merger (`orch-merge`), one at a time: `git merge --no-ff --no-commit`, the checks, then the commit
     `Merge <plan branch> into orch/<run> (plan NNN)` and the push. A conflict or a failing check aborts the
     merge (`git merge --abort`) and goes back to the builder as a problem.
4. **Wave gate.** A wave with a parked plan is the last one: later waves are not started (`skipped`).
   **Pilot.** With `pilotSize` set and more plans than it, only the first `pilotSize` plans (wave order) run; the rest
   are `skipped` with the reason "pilot", the run stops, and the report and the numbered decisions go to the Human.
   `continue` relaunches the same run with `pilot: false`: merged plans are skipped from git, the rest are built with
   the graded decisions and any new rule in `docs/brain/agent-rules.md` in place (`docs/agent/decision-review.md`).
   **Final gate.** After the last wave, one `orch-gate` runs the project's build, lint and test commands on the run
   branch (the merge folder) once. A failure is a finding in the report (`Stopped: final gate failed: <command> — <output
   tail>`, and the command's output) and the run branch is not handed over as clean; a merge can break a test no
   plan's own checks cover.
5. **Report.** `orch-state.mjs finish` runs every time the workflow ends — after the last wave, when every plan parked,
   and when a step threw (the run is then stopped with `run stopped with an error: …`). It writes the local copy
   `.claude/orchestrator-runs/<run>.md` in the main folder first (gitignored, opens without a branch switch), then
   `docs/orchestrator/runs/<run>/report.md` and a copy of `status.json` on the run branch; a merge folder that is dirty
   or cannot fast-forward keeps the local copy and the result says `reportCommitted: false` with the reason. `stop` and
   `finish` both give every slot the run still holds back (`releaseSlot`: a slot with uncommitted or unpushed work is
   kept and the line says why), so a run that ends on an environment failure leaves no `wt-N` with a stale
   `.worktree-plan`.

**Environment failures** never cost a fix round: the plan pauses, `orch-preflight.mjs --env-only --run <run>` checks
disk, database and packages (the main folder's and the merge folder's), and the plan is retried once — from the
builder when the failure came before the merge, and as **the merge step only** when the merge failed (the branch is
already built and verified; a run once rebuilt both its plans from the builder for a merge folder without packages). A
second environment failure parks the plan with the reason.

## A dead agent, a loop, and "is it stuck?"

- **Model fallback.** Every agent call goes through one helper in the workflow. An agent that returns nothing (it died
  on a terminal API error — a blocked model, for one — or the Human skipped it) is called once more on
  `orchestrator.fallbackModel` (`opus`), and a run note says `model fallback: <label> <first
  model> → <second>`. A second nothing goes to the caller's park or environment path as before. `inherit` turns the
  retry off. The key refuses a Haiku value: a review agent (the checkers, the verifier, security, UI) never falls back
  to Haiku. Only the orchestrator session's own model is out of reach: the Human switches it with `/model`.
- **Limits per plan**, counted in the workflow (it has no clock): at most `maxNotesPerPlan` run notes (every note is
  one runner agent call — a run once wrote about 30 closing notes in 4.5 minutes), then one last `notes capped` note;
  the same failure reason twice in a row at the same step (`gate: …`, `checker: …`, `ui: …`, `merge: …`, trimmed to
  120 characters) parks the plan at once as `same reason twice: <why>`; at most `maxAgentCallsPerPlan` agent calls, then
  the plan is parked as `agent-call limit`. A parked plan closes with one state write, not a note per step.
- **`watch`.** `node scripts/orch-state.mjs watch --run <run> [--stale-min <n>]` reads `status.json` only (no git, no
  agent, no lock) and prints one line: `RUNNING`, `FINISHED`, `STOPPED: <reason>`, or `STUCK: plan <NNN> · <state> · no
  progress for <n> min · last: <note>` when the phase is `running` and `updatedAt` is older than `orchestrator.staleMin`
  (`10` minutes), or `STUCK: plan <NNN> · <state> · same reason twice: <note>` when one plan's
  last two notes say the same thing. `STUCK` exits 1, the rest 0 — a project can wrap it in a loop or a notifier. The
  `/orchestrate` command tells the Human the line to run in a second terminal, and prints a `STUCK` line first in its
  final report when the run ended on a limit.

## Running beside a Planner session

`/orchestrate` runs in a **second Claude Code session in the main folder** — never from a `wt-N` slot (the
preflight refuses a main folder that is not on `main`, and a slot is a builder's folder). Rules that keep the
two sessions apart:

- The main folder must be clean (no uncommitted tracked file) at readiness, at `go` and at `continue`: the readiness
  answers are a plan commit on `main`, and a run never writes the main folder itself.
- Never edit a plan that is in a run: a builder reads it from its branch, and the readiness answers are the last plan
  change before `go`. New tasks go to the plan after the run, or to a new plan.
- One run at a time per plan and per file: the preflight (`--plans`) refuses a run that names a plan of a live run or a
  plan whose Read-Write Scope overlaps one of its plans (lock groups exist only inside one run). A live run is one whose
  `status.json` says `running` and was updated in the last two hours.
- The Planner's `free-merged-slots` (session start, `/plan` step 2) leaves alone every slot a live run holds (by slot
  path or plan branch in `status.json`); the run gives its slots back itself.

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
- **Start tier.** A plan whose `## Architecture Impact` names an invariant other than `INV-none` that it `changes` or
  is a `deviation` from — or names one without saying which — starts its builder on the `judgment` tier; a plan whose
  lines only `preserves` invariants starts on `build` (most plans preserve something; a judgment start for every one of
  them put the main session's model on plans a build-tier builder handles).
- **Fix loop.** The first problem goes back to a builder on the same tier with the findings (round 1). A persisting
  failure (round 2 and later), an `ESCALATE` or `blocked` builder, or a second finding starts a **fresh** builder on
  the `judgment` tier that reads the hand-off file (`.claude/sessions/orch-<run>/handoff-<NNN>.md`), the plan and
  `git diff` — never the first builder's transcript. A failure on that builder, or a failure when the rounds used
  reach `maxFixRounds`, parks the plan with its reason.
- **Environment failures cost no round.** A builder, gate or merger that reports an environment failure (disk, network,
  a database that is down, a temp folder in use) pauses the plan (`env-paused`), runs `orch-preflight.mjs --env-only`,
  and retries once when it passes. A failing check or a second environment failure parks the plan with the reason,
  and the wave gate stops the run.

## State rules

- **Git is the ledger.** A plan counts as merged only by the anchored subject
  `^Merge \S+ into orch/<run> \(plan NNN\)$` on the run branch. A relaunch with the same run name rebuilds the
  done set from those subjects and never redoes a merged plan.
- `status.json` (`.claude/orchestrator-runs/<run>/status.json`) is written only by `orch-state.mjs`, after every step:
  per plan its state, round, builder tier, sha, reason, free disk and the model and effort each agent echoed.
- Times come from `orch-state.mjs` and the workflow's `args` (`startedAt`); the workflow script has no clock.
- Every count in a message comes from `status.json` or an anchored git command run in the same turn.
- A relaunch while a run of that name is live (status `running`, updated in the last 2 hours) is refused; after a
  crash, `node scripts/orch-state.mjs stop --run <run> --reason "<why>"` ends it first.

## Never

- Merge into, push to or check out `main` from a run; the Human merges the run branch.
- Answer or resume a worker agent, or relay chat into agents: every agent starts from a clean prompt the workflow
  builds.
- Use a command on the deny list (`docs/agent/agent-roles.md`); the merge folder is kept clean with
  `git merge --abort`, never with a destructive command.
- Write the Human's uncommitted files: the run refuses to start while the main folder has uncommitted tracked files.
- Run unbounded background commands; long output goes to a file and only its tail is read.
- State a count it did not compute.

## The report

Merged, parked and why; the decisions agents took, numbered `D1…Dn` and grouped by plan with the `behaviour:` ones
first (every `seen:` defect an agent noticed is among them), and the reply format `decisions: ok` | `D<n> ✗ <what I'd
choose>` for the Human to grade (`docs/agent/decision-review.md`); the models each agent ran on; what only the Human can do — one
validation list, numbers running on: a **screenshot grid per page** (one row per `[ui]` card of a merged plan: title,
verdict with who checked it — script or browser — and the round, and a thumbnail link to each screenshot; kept in
`status.json` as `uiCards`), then **plan drift** in its own section (no severity, not a bug: update the card or the
plan), then the `[ui]` cards no one could check and every `[human]` item of the merged plans, which name no page, per
plan — still shown to the Human as cards — and a decision for each parked plan; and the
PowerShell lines that open the pull request of the run branch. The end-of-run message prints the report path and those lines.
