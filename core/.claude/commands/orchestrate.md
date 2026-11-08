---
description: Run saved plans unattended into one run branch with scripts/run-plans.mjs — starts it right after a dry run that says WOULD START yes, relaunches a killed run once, reads the result from status.json; the Human merges the run branch.
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

After `WOULD START: yes`, run this line at once with `run_in_background` — ask for no reply, the dry run was the
check:

```
node scripts/run-plans.mjs --run <run> --plans <NNN,NNN>
```

Print the line that follows the run from any terminal (the main folder's absolute path, quoted):

```
cd "<main folder>"; node scripts/orch-state.mjs watch --run <run>
```

Do not poll it; when it ends, go to 4.

## 3. A run the harness killed

When the background run ends without its last line (`RUN_PLANS_JSON`) — killed for low memory, or by the harness —
run `node scripts/orch-state.mjs stop --run <run> --reason "killed by the harness"` and relaunch the same line once
with `run_in_background` (merged plans are left out). A second kill: stop, and report both kills; never relaunch
again, never send the Human to a terminal for it.

## 4. The result

Read `.claude/orchestrator-runs/<run>/status.json` and print: merged, parked (each with its reason), skipped (each with
its reason), `stopReason` when set, the report (`.claude/orchestrator-runs/<run>.md`) and `calls.csv` beside the status
file. A run stopped with `rate-limit` is relaunched with the same command after the limit resets (merged plans are left
out). The Human merges `{{orchestrator.runBranchPrefix}}<run>`; never merge it, never touch `{{git.mainBranch}}`.
