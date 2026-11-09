---
description: Kit repository only — run the orchestrator validation (tools/validate-orchestrator.mjs) in fake or real mode and print its report as it is, verdict first
allowed-tools: Bash, Read
---

# /validate-run — prove the orchestrator's behaviours in a sandbox

Kit repository only: this command and `tools/validate-orchestrator.mjs` are never rendered into a project. What the
cases stage and how a verdict is decided: `docs/agent/kit-validation.md`.

Usage: `/validate-run [fake|real] [V1,V3]` — the mode (default `fake`) and an optional case list.

1. Run it and wait (fake mode takes about 5 minutes, real mode up to 30 minutes per case; run real mode in the
   background, Bash `run_in_background`):

   ```
   node tools/validate-orchestrator.mjs --mode <mode> [--cases <ids>]
   ```

   Real mode: run `node tools/validate-orchestrator.mjs --mode real --dry-run` first and show its lines (the model
   calls and the token cap); it calls real `claude` on Sonnet and spends tokens.
2. Print the last `VALIDATION:` line first, as one line, then the report the tool printed, exactly as it is (the table
   and each case's quoted evidence). Never summarise a case in your own words and never change a verdict.
3. On a FAIL: give that case's `Run files of this case:` path from the report and stop. Do not fix anything, do not
   rerun with other flags and do not edit a case to make it pass; a FAIL is a finding for a new plan.
