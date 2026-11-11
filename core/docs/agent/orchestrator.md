# Orchestrator — run saved plans unattended into one run branch

An opt-in second workflow beside the Planner/Worker flow. Nothing changes unless the Human starts a run. A run checks
everything first and refuses to start while a plan has an open question, then runs without anyone: per plan a builder,
a gate, a reviewer and a merge into one run branch `{{orchestrator.runBranchPrefix}}<run>` — never into
`{{git.mainBranch}}`. The Human gets one report and merges the run branch himself.

The loop is code (the kit's ADR 0017, "the orchestrator loop is a script"): `scripts/run-plans.mjs` runs it in a
terminal, and only the builder and the reviewer are model calls. `/orchestrate` prints the line to run, starts it on
`start` and reads the result from `status.json`.

## Pieces

| Piece | File | Does |
| --- | --- | --- |
| Loop | `scripts/run-plans.mjs` | The run as one script: readiness lint, preflight, order, per plan builder → gate → review → merge, the fix round and the escalation, the park, the final gate, the report. `--dry-run` prints all of it and calls no model |
| Headless calls | `scripts/lib/claude-run.mjs` | One agent file run once with `claude -p` (the four context-saving flags, the tier's model, the agent's tools); rate-limit detection. The kit's agent eval uses the same code |
| Gate | `scripts/lib/plan-gate.mjs` | The check commands by script in the plan's folder, with the gate time limit; the receipt (`gate-receipt.json` under the folder's `.claude/`, kept out of git) |
| Review | `scripts/lib/plan-review.mjs` | The reviewer's prompt (plan without its Execution Notes, the diff, the gate receipt), its result validator, the verdict computed from the problems |
| Merge | `scripts/lib/plan-merge.mjs` | `git merge --no-ff` in the merge folder, `merge-verify` (the pin), the merge checks, one push |
| Order | `scripts/lib/run-order.mjs` | Waves and edges from `plan-order.mjs --json`, what a park blocks (`onPark`) |
| Supervisor | `scripts/run-supervisor.mjs` | Starts the run detached from the session, sweeps what dead runs left, relaunches after a death (3 times) or a rate limit, waits for free memory |
| Command | `.claude/commands/orchestrate.md` | The dry run first, the supervisor line, the watch line, the result from `status.json` |
| State | `scripts/orch-state.mjs` | Every file, git and time step: run branch, merge folder, builder folders, `status.json`, hand-off files, the merge pin, the park, the report |
| Preflight | `scripts/orch-preflight.mjs` | Environment checks before the run and before a retry: disk, database, packages, dev server and backend (started when missing), git identity, remote, main folder, settings, a live run; per plan the code a commit guard would refuse, `[ui]` roles with no login recipe, leftovers of earlier runs |
| Agents | `.claude/agents/orch-builder.md`, `.claude/agents/plan-reviewer.md` | One job each; shared contract in `docs/agent/agent-roles.md` |

## Settings (`kit.config.json` → `orchestrator`)

`run-plans.mjs` runs one plan at a time unless `--concurrency 2` is given. Keys an older loop read and nothing reads
now are ignored by install and sync with a `NOTE orchestrator: <key> removed` line.

| Key | This project | Meaning |
| --- | --- | --- |
| `runBranchPrefix` | `{{orchestrator.runBranchPrefix}}` | Prefix of the run branch every plan of a run merges into |
| `maxFixRounds` | `{{orchestrator.maxFixRounds}}` | How many times problems go back to a build-tier builder before the plan escalates or parks |
| `minFreeDiskGb` | `{{orchestrator.minFreeDiskGb}}` | Free disk the environment check asks for, before the run and before a retry |
| `onPark` | `{{orchestrator.onPark}}` | What a parked plan stops: `dependents` = only the later plans that depend on it or share its files (each is `skipped` with the reason), `all` = every later plan |
| `gateTimeoutMin` | `{{orchestrator.gateTimeoutMin}}` | Minutes one gate command (and one `prepare` script) may run |
| `staleMin` | `{{orchestrator.staleMin}}` | Minutes without a `status.json` update after which `orch-state.mjs watch` prints `STUCK` |
| `mergeChecks` | `{{orchestrator.mergeChecks}}` | What the merge step runs on the merged tree: `build` = the project build plus the plan's scope check, `full` = the plan's whole check list on every merge |
| `ciMirror` | `{{orchestrator.ciMirror|json}}` | CI commands (`npm run <script>`, `pnpm run <script>`, `node scripts/…` or `node tools/…`, no write flag) the final gate runs after the project checks and the kit manifest check. Install and sync print a `NOTE ci-mirror:` line for each CI command the final gate does not run; they never write the list |
| `prepare` | `{{orchestrator.prepare|json}}` | Files the gate generates before the tests: `{ "missing": "<path>", "script": "<npm script>", "in": "<folder, default .>" }`, run as `node scripts/orch-state.mjs prepare …` first in every plan gate and the final gate, only when the path is absent |
| `useSlots` | `{{orchestrator.useSlots|json}}` | Whether a builder takes an idle `{{slots.nameFormat}}` slot before making its own folder. The scaffold says `false`: builders get folders of their own (one per plan in flight, at most `concurrency`), and the Human's slots stay free |
| `reviewerMode` | `{{orchestrator.reviewerMode}}` | What a reviewer STOP does (default `gate`): `advisory` = a run note, the plan still merges; `gate` = one fix round with the findings, then the plan parks (and a review that could not run parks). `advisory` applies only to a plan whose `## Execution Mode` says `Reviewer: advisory` (any other plan is reviewed as `gate`), and never to a diff that touches a sensitive path (ship-prep's check, `security.sensitivePaths` included): that diff is always `gate`. `--reviewer-mode` overrides it for one run, within the same two rules |
| `reviewerModel` | `{{orchestrator.reviewerModel}}` | The model `.claude/agents/plan-reviewer.md` runs on (`--model`). Never Haiku: install and sync refuse it |
| `rateLimitWaitMin` | `{{orchestrator.rateLimitWaitMin}}` | Minutes to wait after a rate or usage limit before that call runs once more; a second limit stops the run (`stopped: rate-limit`) |

## The run

`node scripts/run-plans.mjs --run <run> --plans <NNN,NNN>`: `/orchestrate` starts it through
`node scripts/run-supervisor.mjs --run <run> --plans <NNN,NNN>` as soon as the dry run says `WOULD START: yes` (no reply
asked for); the supervisor runs it outside the session and brings it back (The supervisor, below). The Human follows it with
`cd "<main folder>"; node scripts/orch-state.mjs watch --run <run>`: one line for the run, then one per plan (state,
round, tier and the model of its latest call, minutes in that state, its last `calls.csv` row). `status.json` holds
`plans.<NNN>.models.<stage>` (model, tier, start time) from the moment each call starts, and a real run appends every
line it prints to `.claude/orchestrator-runs/<run>.console.log` (a relaunch adds to it). Every step is code except the
two marked **model**.

1. **Readiness lint.** `plan-order.mjs --json` gives the waves (plans already merged into the run branch are left
   out). Per plan: `scope-check.mjs --deps`, `--arch` and `--tags`; the branch name; an open `Q:` in `## Critical
   Questions` refuses the run; the backticked commands of the open `[auto]` items, held to the check allowlist and to
   `orch-state.mjs check-files`: a check the runner cannot run, or whose file neither exists nor is created by the plan,
   makes the plan not ready (never a dropped note). The gate's own test-file check runs on the check files the plan
   creates and on what an existing `feat/<NNN>` changed. A `feat/<NNN>` an earlier run left that is not built on
   the run branch (or `{{git.mainBranch}}` before the run branch exists) is not a refusal: the dry run prints `WILL RENAME`
   (the rename at the plan's start, below). Then `orch-preflight.mjs`. A plan that is not ready, or a failed preflight, refuses the whole run before
   anything is created (exit 1). `--dry-run` stops here and prints the waves, the lint, the preflight, the gate
   commands and the exact `claude -p` lines — the builder's from the same `builderCall()` the run uses, with its
   start tier and why (`tier: build (INV-1 preserves)`).
2. **Start.** `orch-state.mjs init` (run branch, merge folder, `status.json`). A heartbeat (`touch`) keeps
   `status.json` fresh while a builder works, so `watch` prints `RUNNING`.
3. **Per plan, wave by wave** (plans that share files run one after the other):
   - `plan-info --with-worktree`: the plan's own folder on `feat/<NNN>-<slug>`. The run branch is merged into the plan
     branch first, so the builder reads the current plan (the plan's own file keeps the run branch's text and the builder's
     ticks). **Rename at start:** a `feat/<NNN>` that is stale (neither it nor the run branch holds the other, and this
     run's `status.json` does not hold the plan) is renamed to `park/stale-<NNN>` here and on origin, a fresh
     `feat/<NNN>` is cut from the run branch, and a run note names both branches. A branch based on the run branch is
     reused as before (its work is kept).
   - **Resume rule:** a relaunch of the same run continues a plan from its saved work when its last stop was not its own
     code — `process died`, `timed out`, `environment`, `rate-limit` or an answered question. With a
     `park/<run>-<NNN>` branch, `feat/<NNN>` is cut from it; the round counter and the tier continue, and the builder's
     prompt carries the hand-off (`.claude/sessions/orch-<run>/handoff-<NNN>.md`, written when none exists). A
     `feat/<NNN>` that holds commits the run branch does not (the run died after the build) is reused with the next step
     the gate on those commits, not a new builder. A plan parked for its own code (`same reason twice`, fix rounds used,
     `replan needed`) is not resumed this way: it starts again from the run branch, as before.
   - **model — builder** (`orch-builder.md` on `models.build`, or `models.judgment` when the plan's Architecture
     Impact `changes` or `deviation`s an invariant — INV-1; `preserves` stays on `models.build`). Its `decisions` and `notDone` are recorded; its `pass` is never read. The script checks the folder is
     committed and ahead of the run branch, and pushes it.
   - **gate**: `plan-gate.mjs` runs `prepare`, build, lint and test, the kit manifest check, the scope check (the
     script's own copy, on the scope as the run branch holds it) and the plan's `[auto]` commands. An environment
     error reruns once (a pass on that rerun is recorded with `orch-state.mjs flake`), then the environment check
     probes the failed command's own precondition, then the gate runs once more without a fix round.
   - `orch-state.mjs diff --no-notes`: the changed files, the test-file gate (a changed test file no scope line names
     is a blocker) and the plan copy without its Execution Notes. A test file next to a file the scope covers (its path
     minus `.spec.`/`.test.`/`_spec.`/`_test.`, same folder or a `__tests__/` directly under it) needs no line, unless
     its diff removes an `expect(`/`assert`/`it(`/`test(`/`describe(` line (`sibling test weakened`); any other test
     location needs a scope line, and the dry run flags a test path the plan names that has none.
   - **model — reviewer** (`plan-reviewer.md` on `reviewerModel`, no write tool, a detached review folder at the
     checked head). The verdict is computed from its `blocker`/`major` problems.
   - **merge** (one at a time): `git merge --no-ff` in the merge folder with the anchored subject, `merge-verify`
     (the merge commit's second parent must be the checked head, else the folder goes back to `HEAD^` and the plan
     parks), the `mergeChecks`, one push of the run branch. **Plan-file rule:** when the only conflicts of the merge
     are in `plans/**` files, the merge is completed with the run branch's copy of those files (a plan file is the
     Planner's and the Human's, never the builder's) and a run note names the file; a conflict in any other file fails
     as before. When the run branch's copy of the plan file differs from the one the builder started from, the script
     (not an agent) records it: a run note `plan <NNN> changed during the run: <commit> <author> — <subject>`, a
     `## Plans changed during the run` section in the report (the diff, 40 lines), one line under the plan's
     `## Execution Notes` committed by the merge step, and a run warning for a `plan(NNN):` commit whose subject has
     under 10 characters of reason.
   - **A failure**: one fix round on the same tier with the findings; a second failure with a new reason gets
     `handoff --reset-base` and one fresh judgment-tier builder; the same reason twice, or a failure after that,
     asks (below). A park or an ask runs `orch-state.mjs park`: the work saved on `park/<run>-<NNN>`, the folder
     removed, and `feat/<NNN>` renamed to `park/<run>-<NNN>` here and on origin.
   - **Parked at once, no further model call:** a builder stopped idle — no wall clock; 15 minutes with no file changed
     in its folder, `node_modules` and `.git` left out (its work is kept on `park/<run>-<NNN>`, never reset), a refused
     review, a pin failure, an environment failure, a worktree that cannot be made. A park skips only what `onPark`
     names; the run goes on.
   - **Asks.** Every question a run raises is one file, `.claude/orchestrator-runs/<run>/asks/<NNN>-<n>.json`:
     `{ id, plan, kind, question, options[], recommendation, humanOnly, context }` (the recommended option is stored
     first; `context` holds the stop's reason, the goal line, the files, the failing check's tail and the builder's
     proposal). The asks: a builder `ESCALATE` about the scope (no judgment-tier builder: it cannot widen a scope), a
     `db-write`, a judgment-tier `planChange` or `ESCALATE`, any `ESCALATE` that names its kind, the same reason twice,
     the fix rounds used up (kind `technical`, the park recommended), and an enforced review that could not run after
     one retry (kind `review`). A build-tier `ESCALATE` with no kind still gets the judgment builder. `humanOnly` is
     true for `data`, `privacy`, `product`, `design`, `production`, `spend` (the two hard limits), `decision-stale`,
     `db-write` and for a question with no kind; false for `scope`, `technical`, `environment` and `review`. The plan's
     state is `asking`; it blocks exactly what a park would, but those plans are held, not skipped, and the rest of
     the run goes on. `watch` prints each open ask as a card with its answer command. When every other plan has ended,
     the run polls the answers every 30 s, each ask for up to `ASK_WAIT_MIN` (180, fixed in `run-plans.mjs`), while
     `watch` still says `RUNNING`. `node scripts/orch-state.mjs answer --run <run> --id <id> --choice <n>` (or
     `--text "<answer>"`) writes `<id>.answer.json` with `by: human`; a `park:` option parks; a `scope` answer that
     names paths adds them to the plan's scope on the run branch first; any other answer resumes the plan in the same
     run through the resume rule above (its saved work, its round and tier, the hand-off), with the answer as
     `ANSWER` in the builder's prompt, and then the plans it held. An answer file with `by: advisor` on a `humanOnly`
     ask is refused with a run note and the ask stays open. An unanswered ask parks its plan with its question in the
     run notes; a plan asks at most 3 times in one run.
4. **Final gate** on the run branch (`prepare`, the project checks, the manifest check, `ciMirror`). Every one of
   those commands is also in each plan's own gate (the manifest check reads the plan's folder), so the final gate finds
   nothing a plan's gate did not. When it still fails on a command whose output names a file that exactly one merged
   plan changed, that plan gets **one fix round** in its folder (its own tier, counted against `maxFixRounds`), a
   re-merge and a second final gate; `finalGate.blamed` in the run's JSON names the plan. A second failure, a failure
   that names no single plan or a plan with no round left stops the run as before.

**ensure-env, retries and undone items** (code, no model):

- **ensure-env** (`lib/orch-folders.mjs`): before the builder, the gate, the merge checks, the final gate and a park, the
  folder gets its packages: an install with the lockfile in the root, in the backend folder (`paths.serverRoot`) and in
  `scripts/`. A tree whose lockfile hash equals its `.claude/.last-npm-install-hash*` marker and that has `node_modules` is
  skipped. A gate or merge check that ends with an environment failure (a busy file, a port, a network error, `'ng' is not
  recognized`) runs ensure-env with a clean reinstall of the failing tree (at most once per folder and tree) before its one
  retry, instead of the same command again; the run note says the folder was installed or reinstalled.
- **State and git calls:** an `orch-state` call with no readable `ORCH_JSON` is asked again up to 3 times, 2 s apart, for a
  read command and for `set`, `touch`, `diff`, `plan-info`, `merge-ready` and `note` with an id; any other command fails as
  before. `git fetch` and `git push` in the run's helpers retry up to 3 times, 5 s apart, on `incorrect old value`,
  `cannot lock ref` or a network error; a failed park still saves the work to `park/<run>-<NNN>`.
- **Long Windows paths:** the preflight's `git longpaths` check sets `core.longpaths true` in the repository config when it
  is not (`OK git longpaths (set to true)`), or prints the exact command when that fails.
- **Undone items:** a builder result whose `notDone` names an open `[auto]` or `[ui]` Done-when item fails the gate with
  `Done-when item left undone: <item>` and takes a fix round. When the reason names a backend, database or dev server,
  the main folder's servers are started (`scripts/slot-serve.mjs --main`) first.
5. **Report.** The builders' `behaviour:` / `seen:` / `removes:` decisions go in one `decisions` call; `finish`
   writes the report. Exit 0 = every plan merged, 2 = some parked or skipped. `calls.csv` in the run's folder has one
   row per model call and gate command; its `model` is the value passed after `--model` on that call.

## Live view

For fleet's run panel (`mods/README.md`), the run also writes, in the run's folder (local and git-ignored; nothing
reads them back into a run):

- `live-<NNN>.json` per plan (`live-final.json` for the final gate), by `scripts/lib/run-live.mjs`, in-process:
  `step` and `stepAt` on each state change; `gate: { index, total, command, startedAt }` before each gate check;
  `builder: { tools, lastTool, lastTarget, tokensIn, tokensOut, at }` from the builder's stream. A new step clears the
  last one's lines. Writes are best-effort (temp file and rename; at most one every 2 s, a step change at once).
- `builder-<NNN>.events.jsonl`: every event of the builder's streamed call, one per line, for evidence.

## The supervisor

`scripts/run-supervisor.mjs` makes a run survive its session (a Claude Code session's clean-up of background shells
can kill a run mid-build). It calls no model and decides nothing a plan's tiers decide (INV-1).

- **Start.** It starts itself detached (its own process group, `windowsHide`, stdout and stderr appended to
  `.claude/orchestrator-runs/<run>.console.log`), prints `SUPERVISOR_STARTED <pid>` and the launcher exits at once.
  Checked on Windows 11: after the launcher exits, `taskkill /T /F` of the shell that ran it leaves
  the supervisor alive, so `child_process.spawn` with `detached` + `unref()` is the launch (no `Start-Process`
  needed); a launcher that stayed alive would take the child down with its tree. run-plans.mjs is started detached
  too (a dead supervisor leaves the run alive) and, under the supervisor, does not append the console log itself
  (one writer).
- **Sweep.** At start and again when the run ends: `orphan-sweep.mjs`, `free-merged-slots.mjs --no-fetch --no-sweep`,
  then `worktree-clean.mjs`'s sweep of every kit-made worktree git lists (builders, merge and review folders, agent
  folders `-review-*`, `-fix-*`, `-scratch-*`, `-kit-*`, `-sync-*`, `.claude/worktrees/*`; never a slot or another
  folder). Removed when clean, its run not live, not in a hand-off, not on `park/…`, not locked, and its work is safe
  elsewhere: a branch merged into `origin/{{git.mainBranch}}` or (a builder) the run branch, or with its upstream gone;
  a detached folder whose commit is on an origin branch. A merge folder stays until its run branch is merged (grade
  and lessons still use it). `git worktree remove`
  without `--force` (3 tries), then a scripted delete for a Windows folder git cannot empty; the branch is kept. One
  `SUPERVISOR_SWEEP:` line per folder; a folder that cannot be removed is a kept line, never a stop.
- **After each launch** (from `status.json`): `finished`, `stopped` for any reason but a rate limit, or a refusal
  before `init`: done. Still `running` — the process died: the death is written with
  `orch-state.mjs stop --reason "process died (exit <code>)"` (slots go back) and the same command is launched again
  (merged plans are left out), at most `MAX_RELAUNCHES` (3) times; the next death stops the run with
  `supervisor gave up after 3 relaunches: <cause>`. `rate-limit`: relaunched after the reset time the error names
  (plus one minute), else after `rateLimitWaitMin`; these do not count against the 3, and their waits stop at 6 hours.
- **Memory.** Before a relaunch, free memory (`os.freemem()`, `freeMemGb` in `lib/orch-run.mjs`; `--free-mem` prints
  it) below `MIN_FREE_MEM_GB` (4) waits, re-checked every 2 minutes up to 60, then stops with `low memory: <n> GB free`.
- The two limits are fixed in code, the way `BUILDER_IDLE_MIN` is; no setting. `supervisor.json` beside `status.json`
  holds its pid, every launch, the relaunches and the waits. Every stop stays in `status.json` `stops[]`
  (`{ at, reason, attempt }`); `stopReason` is the latest, and the report lists every stop under `## Stops`.

## Model calls

| Stage | Agent | Model | Folder | When |
| --- | --- | --- | --- | --- |
| `builder` | `orch-builder.md` | `models.build` (`models.judgment` when the plan changes or deviates from an invariant) | the plan's own folder | once per plan |
| `builder fix` | `orch-builder.md` | the same tier | the plan's own folder | after the first failure, with the findings |
| `judgment builder` | `orch-builder.md` | `models.judgment` | the plan's folder, reset to the base | after a second failure with a new reason |
| `reviewer` | `plan-reviewer.md` | `orchestrator.reviewerModel` | a read-only review folder at the checked head | after each passing gate |

Two calls per plan normally, five at worst. Every call is `claude -p --output-format json --system-prompt-file <agent
body> --setting-sources local --strict-mcp-config --disable-slash-commands --no-session-persistence --model <model>
--tools <agent tools> --allowedTools <…>`. The builder streams instead (`--output-format stream-json --verbose`, for
the live view): its last `result` event is read exactly as the JSON answer, and a rate limit is read only from that
result, stderr, `api_error_status` or a `rejected` rate_limit_event, never from tool output. The builder also gets `--settings` with only the main folder's `PreToolUse`
guard hooks; a hook's deny wins over `--allowedTools`. With no such hooks the run refuses to start: a builder never runs
unguarded. The reviewer gets its read tools and no Bash (its diff and the gate receipt come inline in the prompt), and
is refused when the review folder holds a `.claude/settings.local.json`.
`RUN_PLANS_CLAUDE` replaces `claude` (tests pass a fake).

## Running beside a Planner session

- Start a run from the main folder on `{{git.mainBranch}}`, clean — never from a `{{slots.nameFormat}}` slot. Never edit a plan
  that is in a run.
- One run at a time per plan and per file: the preflight refuses a plan of a live run (status `running`, updated in
  the last two hours) or one whose scope overlaps it. After a crash, `orch-state.mjs stop --run <run> --reason "<why>"`.
- `free-merged-slots` leaves every slot a live run holds alone, and removes a merged run's merge folder
  (`<repo>-orch-merge-<run>`) once it is clean and its branch is merged; then it runs `worktree-clean.mjs`'s sweep.
- No agent deletes a folder itself: `node scripts/worktree-clean.mjs --path <folder>` (or `--sweep`) does, by the
  rules above, and prints why it kept one.
- To validate a run branch in an idle slot: `node scripts/slot-serve.mjs --ref <branch>` there. `/orchestrate` does it
  itself at a run's end when a card needs the app, checks every card URL answers, and prints the cards unasked.
- `decision-log.mjs grade` refuses a folder on `{{git.mainBranch}}` (exit 2, naming `<repo>-orch-merge-<run>`): the
  grades are committed on the run branch, never on `{{git.mainBranch}}`.
- A second run beside a running one starts only with at least 4 GB of free memory (`node scripts/run-supervisor.mjs --free-mem`).

## State rules

- **Git is the ledger.** A plan counts as merged only by the anchored subject
  `^Merge \S+ into {{orchestrator.runBranchPrefix}}<run> \(plan NNN\)$` on the run branch; a relaunch rebuilds the done
  set from those subjects and never redoes a merged plan.
- `status.json` (`.claude/orchestrator-runs/<run>/status.json`) is written only by `orch-state.mjs`: per plan its state,
  round, tier, sha, reason, `checkedHead`, `calls[]`, flakes and the facts `lessons` turns into lesson lines (fix-round
  causes, escalations, the final gate's result). A lesson line names a fact the code produced, or there is no line.
- Every count in a message comes from `status.json` or an anchored git command run in the same turn.
- A database write the plan does not list is answered in the builder's worktree with `ESCALATE: db-write <command>`;
  the run asks the Human (kind `db-write`, Human-only) and only that plan waits.

## Merges

- Merging a plan into `{{orchestrator.runBranchPrefix}}<run>` is the run's own step and is never asked, including a
  dependent plan that starts after the plan it depends on is merged into `{{orchestrator.runBranchPrefix}}<run>`. The
  run calls git from the script, never through the Bash tool, so no permission rule touches it.
- The merge of `{{orchestrator.runBranchPrefix}}<run>` into `{{git.mainBranch}}` is the Human's: `permissions.ask` in
  `.claude/settings.json` holds `Bash(gh pr merge*)`, so Claude Code asks the Human before any PR merge, in every
  permission mode. A push to `{{git.mainBranch}}` is not asked (the Planner pushes plan files there); `branch-guard.sh`
  and the pre-push hook limit what a push may carry.
- No plan's Execution Mode may pre-approve that merge.

## Never

- Merge into, push to or check out `{{git.mainBranch}}` from a run; the Human merges the run branch.
- Use a command on the deny list (`docs/agent/agent-roles.md`); the merge folder is kept clean with `git merge --abort`.
- Write the Human's uncommitted files, run unbounded background commands, or state a count it did not compute.

## The report

Merged, parked and why; the builders' decisions numbered `D1…Dn` under `## Decisions` (every `removes:` line first) with
the reply format `decisions: ok` | `D<n> ✗ <what I'd choose>` (`docs/agent/decision-review.md`); `## Run notes`; the
models each call ran on; `## Flaky checks` when there are any; one validation list of what only the Human can do —
the `[ui]` cards per page with their screenshots, plan drift, every `[human]` item of the merged plans and a decision
per parked plan; and the PowerShell lines that open the pull request of the run branch.
