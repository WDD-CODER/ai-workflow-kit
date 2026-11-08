---
description: Run saved plans unattended into one run branch with scripts/run-plans.mjs — starts it under the supervisor right after a dry run that says WOULD START yes, reads the result from status.json; the Human merges the run branch.
---

# /orchestrate — run saved plans with run-plans.mjs ({{project.name}})

Usage: `/orchestrate <NNN,NNN,…> [<run name>] [remote]` — `remote`: a plan's main-folder backend runs on the remote
database for this run (`--db remote` added to every `run-plans.mjs` line below). The loop is a script (`docs/agent/orchestrator.md`): only the builder and the
reviewer are model calls. This command starts no workflow and no agent; it runs the script and reads its files.

## 1. Check the request

- Plan numbers only (1–4 digits, comma-separated); a run name is lower-case letters, digits and dashes (default
  `run-<first plan>`). Anything else: say what is wrong and stop.
- Run the dry run and show its output as it is:

  ```
  node scripts/run-plans.mjs --dry-run --run <run> --plans <NNN,NNN>
  ```

- `WOULD START: no — …`: stop and show the reason (an open Critical Question, a lint problem, the preflight). Fix the
  plan or the environment first; never edit around a refusal.

## 2. Start the run at once

After `WOULD START: yes`, start it at once (no reply asked; the dry run was the check):
`node scripts/run-supervisor.mjs --run <run> --plans <NNN,NNN>`. It prints `SUPERVISOR_STARTED <pid>` and returns:
the supervisor runs the run outside this session, so closing the session does not stop it. Beside a run still
running, a second one starts only with 4 GB of free memory (`node scripts/run-supervisor.mjs --free-mem`).
Print the watch line (one line per plan: state, round, tier and model, minutes in it, last `calls.csv` row; the run's
own log is `.claude/orchestrator-runs/<run>.console.log`, appended):
`cd "<main folder>"; node scripts/orch-state.mjs watch --run <run>`. To learn when it ends, start this wait as a
background shell command and go to 4 when it exits:
`until ! node scripts/orch-state.mjs watch --run <run> | grep -q '^RUNNING'; do sleep 60; done`.

## 3. Deaths and rate limits

The supervisor relaunches a run that died (up to 3 times, with 4 GB of free memory) and a run stopped by a rate
limit (after the reset). This session never relaunches a run itself and never sends the Human to a terminal for it.

## 4. The result

Read `.claude/orchestrator-runs/<run>/status.json` and print: merged, parked (each with its reason), skipped (each with
its reason), `stopReason` when set, the report (`.claude/orchestrator-runs/<run>.md`) and `calls.csv` beside the status
file; every stop is in `status.json` `stops[]`. The Human merges `{{orchestrator.runBranchPrefix}}<run>`; never merge it, never touch `{{git.mainBranch}}`.

## 5. The cards — without being asked

Right after 4, when the report lists human items: a card that needs the app → serve the run branch in an idle slot
(`node scripts/slot-serve.mjs --ref {{orchestrator.runBranchPrefix}}<run>`); check every card URL answers (fix a failed
start first); print the cards (`docs/agent/job-validation.md` → Format) at once, never after a `cards` reply; when
the Human replies, check the URLs answer again.
