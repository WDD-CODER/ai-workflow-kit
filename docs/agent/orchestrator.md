# Orchestrator — run saved plans unattended into one run branch

An opt-in second workflow beside the Planner/Worker flow. Nothing changes unless the Human starts a run. A run checks
everything first and refuses to start while a plan has an open question, then runs without anyone: per plan a builder,
a gate, a reviewer and a merge into one run branch `orch/<run>` — never into
`main`. The Human gets one report and merges the run branch himself.

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
| Command | `.claude/commands/orchestrate.md` | The dry run first, the line for the Human, `start` in the background, the watch line, the result from `status.json` |
| State | `scripts/orch-state.mjs` | Every file, git and time step: run branch, merge folder, builder folders, `status.json`, hand-off files, the merge pin, the park, the report |
| Preflight | `scripts/orch-preflight.mjs` | Environment checks before the run and before a retry: disk, database, packages, dev server and backend (started when missing), git identity, remote, main folder, settings, a live run; per plan the code a commit guard would refuse, `[ui]` roles with no login recipe, leftovers of earlier runs |
| Agents | `.claude/agents/orch-builder.md`, `.claude/agents/plan-reviewer.md` | One job each; shared contract in `docs/agent/agent-roles.md` |

## Settings (`kit.config.json` → `orchestrator`)

`run-plans.mjs` runs one plan at a time unless `--concurrency 2` is given. Keys an older loop read and nothing reads
now are ignored by install and sync with a `NOTE orchestrator: <key> removed` line.

| Key | This project | Meaning |
| --- | --- | --- |
| `runBranchPrefix` | `orch/` | Prefix of the run branch every plan of a run merges into |
| `maxFixRounds` | `2` | How many times problems go back to a build-tier builder before the plan escalates or parks |
| `minFreeDiskGb` | `5` | Free disk the environment check asks for, before the run and before a retry |
| `onPark` | `dependents` | What a parked plan stops: `dependents` = only the later plans that depend on it or share its files (each is `skipped` with the reason), `all` = every later plan |
| `gateTimeoutMin` | `20` | Minutes one gate command (and one `prepare` script) may run |
| `staleMin` | `10` | Minutes without a `status.json` update after which `orch-state.mjs watch` prints `STUCK` |
| `mergeChecks` | `build` | What the merge step runs on the merged tree: `build` = the project build plus the plan's scope check, `full` = the plan's whole check list on every merge |
| `ciMirror` | `["node tools/pack-check.mjs","node tools/drift-check.mjs --target .","node tools/install-check.mjs","node tools/workflow-link-check.mjs","node tools/e2e-check.mjs","node tools/acceptance-check.mjs --e2e"]` | CI commands (`npm run <script>`, `pnpm run <script>`, `node scripts/…` or `node tools/…`, no write flag) the final gate runs after the project checks and the kit manifest check. Install and sync print a `NOTE ci-mirror:` line for each CI command the final gate does not run; they never write the list |
| `prepare` | `[]` | Files the gate generates before the tests: `{ "missing": "<path>", "script": "<npm script>", "in": "<folder, default .>" }`, run as `node scripts/orch-state.mjs prepare …` first in every plan gate and the final gate, only when the path is absent |
| `useSlots` | `false` | Whether a builder takes an idle `wt-N` slot before making its own folder |
| `reviewerMode` | `advisory` | What a reviewer STOP does: `advisory` = a run note, the plan still merges; `gate` = one fix round with the findings, then the plan parks. `--reviewer-mode` overrides it for one run |
| `reviewerModel` | `sonnet` | The model `.claude/agents/plan-reviewer.md` runs on (`--model`). Never Haiku: install and sync refuse it |
| `rateLimitWaitMin` | `30` | Minutes to wait after a rate or usage limit before that call runs once more; a second limit stops the run (`stopped: rate-limit`) |

## The run

`node scripts/run-plans.mjs --run <run> --plans <NNN,NNN>` in a terminal; the Human follows it with
`node scripts/orch-state.mjs watch --run <run>`. Every step is code except the two marked **model**.

1. **Readiness lint.** `plan-order.mjs --json` gives the waves (plans already merged into the run branch are left
   out). Per plan: `scope-check.mjs --deps`, `--arch` and `--tags`; the branch name; an open `Q:` in `## Critical
   Questions` refuses the run; the backticked commands of the open `[auto]` items, held to the check allowlist and to
   `orch-state.mjs check-files` (a check whose file neither exists nor is created by the plan is dropped with the
   reason). Then `orch-preflight.mjs`. A plan that is not ready, or a failed preflight, refuses the whole run before
   anything is created (exit 1). `--dry-run` stops here and prints the waves, the lint, the preflight, the gate
   commands and the exact `claude -p` lines — the builder's from the same `builderCall()` the run uses, with its
   start tier and why (`tier: build (INV-1 preserves)`).
2. **Start.** `orch-state.mjs init` (run branch, merge folder, `status.json`). A heartbeat (`touch`) keeps
   `status.json` fresh while a builder works, so `watch` prints `RUNNING`.
3. **Per plan, wave by wave** (plans that share files run one after the other):
   - `plan-info --with-worktree`: the plan's own folder on `feat/<NNN>-<slug>`.
   - **model — builder** (`orch-builder.md` on `models.build`, or `models.judgment` when the plan's Architecture
     Impact `changes` or `deviation`s an invariant — INV-1; `preserves` stays on `models.build`). Its `decisions` and `notDone` are recorded; its `pass` is never read. The script checks the folder is
     committed and ahead of the run branch, and pushes it.
   - **gate**: `plan-gate.mjs` runs `prepare`, build, lint and test, the kit manifest check, the scope check (the
     script's own copy, on the scope as the run branch holds it) and the plan's `[auto]` commands. An environment
     error reruns once (a pass on that rerun is recorded with `orch-state.mjs flake`), then the environment check
     probes the failed command's own precondition, then the gate runs once more without a fix round.
   - `orch-state.mjs diff --no-notes`: the changed files, the test-file gate (a changed test file no scope line names
     is a blocker) and the plan copy without its Execution Notes.
   - **model — reviewer** (`plan-reviewer.md` on `reviewerModel`, no write tool, a detached review folder at the
     checked head). The verdict is computed from its `blocker`/`major` problems.
   - **merge** (one at a time): `git merge --no-ff` in the merge folder with the anchored subject, `merge-verify`
     (the merge commit's second parent must be the checked head, else the folder goes back to `HEAD^` and the plan
     parks), the `mergeChecks`, one push of the run branch.
   - **A failure**: one fix round on the same tier with the findings; a second failure with a new reason gets
     `handoff --reset-base` and one fresh judgment-tier builder; the same reason twice, or a failure after that,
     parks the plan (`orch-state.mjs park`: the work saved on `park/<run>-<NNN>`, the folder removed). A park skips
     only what `onPark` names; the run goes on.
4. **Final gate** on the run branch (`prepare`, the project checks, the manifest check, `ciMirror`).
5. **Report.** The builders' `behaviour:` / `seen:` / `removes:` decisions go in one `decisions` call; `finish`
   writes the report. Exit 0 = every plan merged, 2 = some parked or skipped. `calls.csv` in the run's folder has one
   row per model call and gate command; its `model` is the value passed after `--model` on that call.

## Model calls

| Stage | Agent | Model | Folder | When |
| --- | --- | --- | --- | --- |
| `builder` | `orch-builder.md` | `models.build` (`models.judgment` when the plan changes or deviates from an invariant) | the plan's own folder | once per plan |
| `builder fix` | `orch-builder.md` | the same tier | the plan's own folder | after the first failure, with the findings |
| `judgment builder` | `orch-builder.md` | `models.judgment` | the plan's folder, reset to the base | after a second failure with a new reason |
| `reviewer` | `plan-reviewer.md` | `orchestrator.reviewerModel` | a read-only review folder at the checked head | after each passing gate |

Two calls per plan normally, five at worst. Every call is `claude -p --output-format json --system-prompt-file <agent
body> --setting-sources local --strict-mcp-config --disable-slash-commands --no-session-persistence --model <model>
--tools <agent tools> --allowedTools <…>`. The builder also gets `--settings` with only the main folder's `PreToolUse`
guard hooks; a hook's deny wins over `--allowedTools`. The reviewer gets read tools and `git diff` / `git show` /
`node --test` only, never a bare Bash, and is refused when the review folder holds a `.claude/settings.local.json`.
`RUN_PLANS_CLAUDE` replaces `claude` (tests pass a fake).

## Running beside a Planner session

- Start a run from the main folder on `main`, clean — never from a `wt-N` slot. Never edit a plan
  that is in a run.
- One run at a time per plan and per file: the preflight refuses a plan of a live run (status `running`, updated in
  the last two hours) or one whose scope overlaps it. After a crash, `orch-state.mjs stop --run <run> --reason "<why>"`.
- `free-merged-slots` leaves every slot a live run holds alone, and removes a merged run's merge folder
  (`<repo>-orch-merge-<run>`) once it is clean and its branch is merged.
- To validate a run branch in an idle slot: `node scripts/slot-serve.mjs --ref <branch>` there.

## State rules

- **Git is the ledger.** A plan counts as merged only by the anchored subject
  `^Merge \S+ into orch/<run> \(plan NNN\)$` on the run branch; a relaunch rebuilds the done
  set from those subjects and never redoes a merged plan.
- `status.json` (`.claude/orchestrator-runs/<run>/status.json`) is written only by `orch-state.mjs`: per plan its state,
  round, tier, sha, reason, `checkedHead`, `calls[]`, flakes and the facts `lessons` turns into lesson lines (fix-round
  causes, escalations, the final gate's result). A lesson line names a fact the code produced, or there is no line.
- Every count in a message comes from `status.json` or an anchored git command run in the same turn.
- A database write the plan does not list is answered in the builder's worktree with `ESCALATE: db-write <command>`;
  the run parks that plan with an `ask:` decision.

## Never

- Merge into, push to or check out `main` from a run; the Human merges the run branch.
- Use a command on the deny list (`docs/agent/agent-roles.md`); the merge folder is kept clean with `git merge --abort`.
- Write the Human's uncommitted files, run unbounded background commands, or state a count it did not compute.

## The report

Merged, parked and why; the builders' decisions numbered `D1…Dn` under `## Decisions` (every `removes:` line first) with
the reply format `decisions: ok` | `D<n> ✗ <what I'd choose>` (`docs/agent/decision-review.md`); `## Run notes`; the
models each call ran on; `## Flaky checks` when there are any; one validation list of what only the Human can do —
the `[ui]` cards per page with their screenshots, plan drift, every `[human]` item of the merged plans and a decision
per parked plan; and the PowerShell lines that open the pull request of the run branch.
