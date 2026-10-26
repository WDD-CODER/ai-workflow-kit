# Orchestrator — run saved plans unattended into one run branch

An opt-in second workflow beside the Planner/Worker flow. Nothing changes unless the Human starts a run with
`/orchestrate <plans>`. A run checks everything first, asks every open question in one batch, then runs without
anyone: per plan a builder, a gate, independent checkers and a merge into one run branch
`{{orchestrator.runBranchPrefix}}<run>` — never into `{{git.mainBranch}}`. The Human gets one report and merges the run
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
| `runBranchPrefix` | `{{orchestrator.runBranchPrefix}}` | Prefix of the run branch every plan of a run merges into |
| `maxFixRounds` | `{{orchestrator.maxFixRounds}}` | How many times problems go back to a builder before the plan is parked |
| `minFreeDiskGb` | `{{orchestrator.minFreeDiskGb}}` | Free disk the environment check asks for, before the run and before a retry |
| `pilotSize` | `{{orchestrator.pilotSize}}` | A run with more plans than this builds the first `pilotSize` plans in wave order, stops with the report and the numbered decisions, and starts the rest on the Human's `continue`; 0 = off |

## The run

1. **Readiness.** `plan-order --json` gives the waves. One `orch-readiness` agent per plan reports open questions,
   environment needs and the commands the plan will run; `orch-preflight.mjs` checks the environment (with
   `commands.dev` set, the dev server must answer on the base port or start through `scripts/slot-serve.mjs`; a failed
   start stops the run before any builder). The command
   asks the Human every question in **one batch**, writes each answer into that plan's `## Execution Notes` (a plan
   commit on `{{git.mainBranch}}`), and leaves out a plan whose question stays unanswered. Then the Human says `go`.
2. **Start.** `orch-state.mjs init` creates `{{orchestrator.runBranchPrefix}}<run>` from `origin/{{git.mainBranch}}` (or reuses it on a
   relaunch), pushes it, and adds the merge folder `<repo>-orch-merge-<run>` beside the main folder.
3. **Per plan, wave by wave** (plans of one wave in parallel; plans that share scope — a lock group — one after the
   other):
   - builder (`orch-builder`, in its own folder `<repo>-orch-<run>-<NNN>` on `feat/NNN-<slug>`, scope-guarded);
   - gate (`orch-gate`): the project checks plus the plan's own check commands from readiness — only `npm run
     <script in package.json>`, `node tools/…`, `node scripts/…` or `node --test <files>` (any other is dropped with
     a run note); exactly one result per command, or the gate fails;
   - finders in parallel (`orch-check-plan`, `orch-check-bugs`, `orch-check-rules`, and `orch-security` only when the
     diff touches a sensitive path or its added lines name auth, permission, password, token or role code), then `orch-verify` on every candidate;
   - the `[ui]` cards (below): each card's own e2e test, run by a gate; the UI validator (`orch-ui`) only for a
     failed or unscriptable card, and only when the run is started with the UI step on (`args.ui`);
   - merger (`orch-merge`), one at a time: `git merge --no-ff --no-commit`, the checks, then the commit
     `Merge <plan branch> into {{orchestrator.runBranchPrefix}}<run> (plan NNN)` and the push. A conflict or a failing check aborts the
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
5. **Report.** `orch-state.mjs finish` writes `docs/orchestrator/runs/<run>/report.md` and a copy of `status.json` to
   the run branch, and copies the report to `.claude/orchestrator-runs/<run>.md` in the main folder (gitignored), so
   it opens without a branch switch.

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
- **Start tier.** A plan whose `## Architecture Impact` names an invariant other than `INV-none` starts its builder on
  the `judgment` tier; otherwise on `build`.
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
  `^Merge \S+ into {{orchestrator.runBranchPrefix}}<run> \(plan NNN\)$` on the run branch. A relaunch with the same run name rebuilds the
  done set from those subjects and never redoes a merged plan.
- `status.json` (`.claude/orchestrator-runs/<run>/status.json`) is written only by `orch-state.mjs`, after every step:
  per plan its state, round, builder tier, sha, reason, free disk and the model and effort each agent echoed.
- Times come from `orch-state.mjs` and the workflow's `args` (`startedAt`); the workflow script has no clock.
- Every count in a message comes from `status.json` or an anchored git command run in the same turn.
- A relaunch while a run of that name is live (status `running`, updated in the last 2 hours) is refused; after a
  crash, `node scripts/orch-state.mjs stop --run <run> --reason "<why>"` ends it first.

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

Merged, parked and why; the decisions agents took, numbered `D1…Dn` and grouped by plan with the `behaviour:` ones
first (every `seen:` defect an agent noticed is among them), and the reply format `decisions: ok` | `D<n> ✗ <what I'd
choose>` for the Human to grade (`docs/agent/decision-review.md`); the models each agent ran on; what only the Human can do — one
validation list, numbers running on: a **screenshot grid per page** (one row per `[ui]` card of a merged plan: title,
verdict with who checked it — script or browser — and the round, and a thumbnail link to each screenshot; kept in
`status.json` as `uiCards`), then **plan drift** in its own section (no severity, not a bug: update the card or the
plan), then the `[ui]` cards no one could check and every `[human]` item of the merged plans, which name no page, per
plan — still shown to the Human as cards — and a decision for each parked plan; and the
PowerShell lines that open the pull request of the run branch. The end-of-run message prints the report path and those lines.
