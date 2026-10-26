---
description: Run saved plans unattended into one run branch — readiness questions in one batch, then builder, gate, checkers and merge per plan; the Human merges the run branch.
---

# /orchestrate — run saved plans into one run branch (ai-workflow-kit)

Opt-in. Usage: `/orchestrate 451-457` (a range), `/orchestrate 451,453,457` (a list), optionally followed by a run
name (`/orchestrate 451-457 batch-1`; default `run-<first>-<last>`). The rules of a run: `docs/agent/orchestrator.md`.

Start from a clean turn: do not paste chat, notes or earlier agent output into any agent prompt. The workflow builds
every prompt from the plans and the state script.

## Steps

1. **Refuse early.**
   - Run `node scripts/orch-preflight.mjs --run <run>`. Any `FAIL` line → print it and STOP (the main folder must be
     on `main` with no uncommitted tracked file, no run of that name may be live, the disk, packages, git
     identity and settings must be in place).
   - Expand the range to plan numbers. Each must be an open plan under the plan folders; a missing one → STOP.

2. **Readiness (one batch of questions).** Start the `orchestrate` workflow
   (`.claude/workflows/orchestrate.js`) with `args`
   `{ "mode": "readiness", "run": "<run>", "plans": ["451", …], "root": "<absolute main folder path>" }`.
   It returns the waves, and per plan `state`, `questions`, `envNeeds`, `commands` (deny-listed ones removed and
   named in `denied`), plus the preflight result.
   - Print the waves and every plan's state in one table.
   - Ask the Human **all** questions and environment needs in **one** numbered list, and wait.
   - Write each answer into that plan's `## Execution Notes` as `Orchestrator readiness (<date>): <question> → <answer>`,
     commit the plan files on `main` (`plan(<run>): readiness answers`) and push.
   - A plan whose question has no answer leaves the run; say which.
   - Wait for the Human's `go`. Anything else → STOP.

3. **Run.** Start the same workflow with `args`
   `{ "mode": "run", "run": "<run>", "plans": [ … the plans still in the run … ], "startedAt": "<ISO time now>",
   "root": "<absolute main folder path>", "checks": { "<NNN>": [ … readiness commands … ] }, "ui": false }`
   (`ui: true` only when the project validates UI cards with `orch-ui`). Do not answer, resume or message any agent
   while it runs.

   **Pilot** (`orchestrator.pilotSize` = 3; 0 = off): with more plans than that, the first
   `pilotSize` plans in wave order run, then the run stops (`pilot` in the result lists the plans that wait) and step 4
   prints the report and the decisions. On the Human's `continue`, start the workflow again with the same `run`, all
   the plans, `"pilot": false` and `"firstDecision": <the last D number + 1>`: it skips what is merged and builds the
   rest, with the graded decisions and any new rule in `docs/brain/agent-rules.md` already in place.

4. **Finish.** From the workflow result and `.claude/orchestrator-runs/<run>/status.json` (never from memory), print:
   - merged plans and parked plans with their reason, and why the run stopped when it did;
   - the final gate: `finalGate.ok` false → say so first (`final gate failed: <command>` and its output tail) and do
     **not** hand the run branch over as clean; no pull-request lines until the Human has seen it;
   - the report path on the run branch (`docs/orchestrator/runs/<run>/report.md`) and the local copy
     `.claude\orchestrator-runs\<run>.md`;
   - the **decisions** the workflow returned, numbered `D1…Dn`, grouped by plan, `behaviour:` first, one line each
     (`D3 · plan <NNN> · behaviour: …`), then the reply format: `decisions: ok` or `D<n> ✗ <what I'd choose>` (several on
     one line, comma-separated). With no decisions print `decisions: none` and skip the next two bullets;
   - the Human's next step as PowerShell lines, one command per line:

     ```powershell
     git fetch origin
     gh pr create --base main --head orch/<run> --title "Orchestrator run <run>" --body-file .claude\orchestrator-runs\<run>.md
     ```

   The Human reviews and merges the run branch; the run never merges into `main`.

5. **Learning step, after the Human's decisions reply** (no command from the Human). Write the workflow's `decisions`
   to a scratch file `.claude/sessions/decisions-<run>.json` (`[{ "id": "D1", "plan": "451", "text": "…" }]`), then
   follow `docs/agent/decision-review.md`: `node scripts/decision-log.mjs learn --reply "<the reply>"` — `LEARNING:
   nothing to record` ends the step with no model call; otherwise log the `✗` items, propose a rule when the same kind
   repeats, send generic lessons to the kit. A pilot run then waits for `continue`.

## Never

- Start a run on a dirty main folder or with an unanswered question for a plan still in the run.
- Merge, push or check out `main` for the run; use a deny-listed command; state a count you did not read
  from `status.json` or an anchored `git log` of the run branch.
