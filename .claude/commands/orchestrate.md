---
description: Run saved plans unattended into one run branch with scripts/run-plans.mjs — prints the line to run, starts it on `start`, reads the result from status.json; the Human merges the run branch.
---

# /orchestrate — run saved plans with run-plans.mjs (ai-workflow-kit)

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

## 2. Hand the Human the line

Print the command for a PowerShell terminal in the main folder:

```
node scripts/run-plans.mjs --run <run> --plans <NNN,NNN>
```

and the line that follows the run from a second terminal:

```
node scripts/orch-state.mjs watch --run <run>
```

Then say: reply `start` to run it from here instead.

## 3. `start`

Run the same command with `run_in_background`. Do not poll it; when it ends, go to 4.

## 4. The result

Read `.claude/orchestrator-runs/<run>/status.json` and print: merged, parked (each with its reason), skipped (each with
its reason), `stopReason` when set, the report (`.claude/orchestrator-runs/<run>.md`) and `calls.csv` beside the status
file. A run stopped with `rate-limit` is relaunched with the same command after the limit resets (merged plans are left
out). The Human merges `orch/<run>`; never merge it, never touch `main`.
