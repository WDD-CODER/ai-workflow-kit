---
description: Run saved plans unattended into one run branch — readiness questions in one batch, then builder, gate, checkers and merge per plan; the Human merges the run branch.
---

# /orchestrate — run saved plans into one run branch ({{project.name}})

Opt-in. Usage: `/orchestrate 451-457` (a range), `/orchestrate 451,453,457` (a list), optionally followed by a run
name (`/orchestrate 451-457 batch-1`; default `run-<first>-<last>`) and the word `ask` (`/orchestrate 451 ask`: wait
for `go` even when readiness has nothing to ask). The rules of a run: `docs/agent/orchestrator.md`.

Start from a clean turn: do not paste chat, notes or earlier agent output into any agent prompt. The workflow builds
every prompt from the plans and the state script.

## Steps

1. **Refuse early.**
   - Expand the range to plan numbers. Each must be an open plan under the plan folders; a missing one → STOP.
   - Run `node scripts/orch-preflight.mjs --run <run> --plans <NNN,NNN,…>`. Any `FAIL` line → print it and STOP (the
     main folder must be on `{{git.mainBranch}}` with no uncommitted tracked file, no run of that name may be live and
     no live run may hold one of these plans or a plan whose scope overlaps one of them, the disk, packages, git
     identity and settings must be in place).

2. **Readiness (one batch of questions).** Start the `orchestrate` workflow
   (`.claude/workflows/orchestrate.js`) with `args`
   `{ "mode": "readiness", "run": "<run>", "plans": ["451", …], "root": "<absolute main folder path>" }`.
   It returns the waves, and per plan `state`, `questions`, `envNeeds`, `commands` and `mainCommands` (deny-listed
   ones removed and named in `denied`), plus the preflight result and `askHuman`.
   - Print the waves and every plan's state in one table.
   - A command readiness dropped because its file does not exist in the project (and the plan does not create it) is
     in `denied` with the reason and in `missingFiles`: tell the Human, it needs a plan fix, not a builder.
   - `askHuman` false (every plan `ready`, no question, no environment need, no missing check file, no main-folder command,
     preflight ok) and the request did not say `ask` → print `nothing to ask — starting the run` and go to step 3 at
     once. No `go` is waited for: the preflight of step 1 already refused everything a pause would have caught.
   - Otherwise ask the Human **all** questions and environment needs in **one** numbered list, and wait. When
     `mainApproval` is not empty, the list ends with a block headed `Runs from the main folder (your live .env,
     database, server) — go allows it:` with one line per `mainApproval` entry (`<NNN>: <command>`). This block alone —
     no question, no environment need — still waits for `go`: a main-folder command runs in the live environment, and
     the run refuses to start without the approval (`stopped: main-approval`).
   - Write each answer into that plan's `## Execution Notes` as `Orchestrator readiness (<date>): <question> → <answer>`,
     commit the plan files on `{{git.mainBranch}}` (`plan(<run>): readiness answers`) and push.
   - A plan whose question has no answer leaves the run; say which.
   - Wait for the Human's `go`. Anything else → STOP.

3. **Run.** Start the same workflow with `args`
   `{ "mode": "run", "run": "<run>", "plans": [ … the plans still in the run … ],
   "root": "<absolute main folder path>", "checks": { "<NNN>": [ … readiness commands … ] },
   "mainChecks": { "<NNN>": [ … readiness mainCommands … ] }, "mainApproved": true, "ui": false }`
   (`ui: true` only when the project validates UI cards with `orch-ui`; no start time — `init` reads its own clock;
   `mainChecks` are the plans' `[auto:main]` commands, run from the main folder after each plan's gate — leave a plan
   out of it when it has none; `"mainApproved": true` only after the Human's `go` in step 2, and left out when there
   are no `mainChecks` — the workflow refuses to start a run with `mainChecks` and no approval). Do not answer, resume
   or message any agent while it runs.

   Tell the Human, in one line, how to see whether the run is stuck while it works — in a second terminal:

   ```powershell
   node scripts/orch-state.mjs watch --run <run>
   ```

   It prints one line and exits: `RUNNING`, `FINISHED`, `STOPPED: <why>` or `STUCK: plan <NNN> · <state> · no progress
   for <n> min · last: <note>` (exit code 1; `orchestrator.staleMin` = {{orchestrator.staleMin}} minutes, or the same
   reason noted twice in a row). A dead agent is retried once on `orchestrator.fallbackModel`
   ({{orchestrator.fallbackModel}}); a plan is parked after `orchestrator.maxAgentCallsPerPlan` agent calls or the same
   failure twice in a row, and writes at most `orchestrator.maxNotesPerPlan` run notes.

   **Pilot** (`orchestrator.pilotSize` = {{orchestrator.pilotSize}}; 0 = off): with more plans than that, the first
   `pilotSize` plans in wave order run, then the run stops (`pilot` in the result lists the plans that wait) and step 4
   prints the report and the decisions. On the Human's `continue`, start the workflow again with the same `run`, all
   the plans, `"pilot": false` and `"firstDecision": <the last D number + 1>`: it skips what is merged and builds the
   rest, with the graded decisions and any new rule in `docs/brain/agent-rules.md` already in place.

4. **Finish.** From the workflow result and `.claude/orchestrator-runs/<run>/status.json` (never from memory), print:
   - first, when the result's `stuck` is set (the run ended on a limit: `agent-call limit`, `same reason twice`, or
     `run stopped with an error`), that line as it is — `STUCK: …` — before anything else; when the session's own model
     was the one that died, say the Human can switch it with `/model`;
   - merged plans and parked plans with their reason, and why the run stopped when it did; `reportCommitted` false →
     say the report exists only as the local copy and why the run branch did not get it;
   - the final gate: `finalGate.ok` false → say so first (`final gate failed: <command>` and its output tail) and do
     **not** hand the run branch over as clean; no pull-request lines until the Human has seen it;
   - the report path on the run branch (`docs/orchestrator/runs/<run>/report.md`) and the local copy
     `.claude\orchestrator-runs\<run>.md`;
   - when the report has an `App errors since the run started` section: its command and its lines as the report shows
     them (the project's own output — a line such as `no entries` means none); never run the log command again;
   - the **decisions** the workflow returned, numbered `D1…Dn`, grouped by plan, `behaviour:` first, one line each
     (`D3 · plan <NNN> · behaviour: …`), then the reply format: `decisions: ok` or `D<n> ✗ <what I'd choose>` (several on
     one line, comma-separated). When the result's `decisionsDropped` counts are not all zero, add one line
     `dropped <n> confirmation line(s) (not decisions)` with the total — they cost no note and need no grade. With no
     decisions print `decisions: none` and skip the next two bullets;
   - the Human's next step as PowerShell lines, one command per line:

     ```powershell
     git fetch origin
     gh pr create --base {{git.mainBranch}} --head {{orchestrator.runBranchPrefix}}<run> --title "Orchestrator run <run>" --body-file .claude\orchestrator-runs\<run>.md
     ```

   The Human reviews and merges the run branch; the run never merges into `{{git.mainBranch}}`.

5. **Learning step, after the Human's decisions reply** (no command from the Human). Write the workflow's `decisions`
   to a scratch file `.claude/sessions/decisions-<run>.json` (`[{ "id": "D1", "plan": "451", "text": "…" }]`), then
   follow `docs/agent/decision-review.md`: `node scripts/decision-log.mjs learn --reply "<the reply>"` — `LEARNING:
   nothing to record` ends the step with no model call; otherwise log the `✗` items, propose a rule when the same kind
   repeats, send generic lessons to the kit. A pilot run then waits for `continue`.

## Never

- Start a run on a dirty main folder or with an unanswered question for a plan still in the run.
- Merge, push or check out `{{git.mainBranch}}` for the run; use a deny-listed command; state a count you did not read
  from `status.json` or an anchored `git log` of the run branch.
