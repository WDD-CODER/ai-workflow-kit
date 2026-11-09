# Orchestrator validation — real mode — 2026-11-09

**VALIDATION: PASS — 1 of 1 cases passed**

- Kit under test: working tree at d2d488a
- Mode: real `claude` calls (Sonnet), each case in its own sandbox
- Every verdict comes from the sandbox's own files (status.json, run notes, calls.csv, git log), quoted below. No model reads them.
- Input tokens used: 92789 of the 3000000 cap

| Case | Behaviour (plan) | Verdict | Seconds | Why |
| --- | --- | --- | --- | --- |
| V2 | a sibling test needs no scope line (101) | PASS | 98 | plan 902 merged with src/price.test.mjs changed and no scope line for it |

## V2 — a sibling test needs no scope line (plan 101): PASS

plan 902 merged with src/price.test.mjs changed and no scope line for it

```text
status.json phase: finished
status.json plans.902: merged
git log origin/orch/val-v2: 5ca9d88 Merge feat/902-bulk-price into orch/val-v2 (plan 902)
calls.csv: 11 rows, 92789 input tokens
run-plans.mjs exit 0; its last lines:
  RUN_PLANS: plan 902 builder (sonnet, tier build: no invariant named, round 0)
  (node:16204) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
  (Use `node --trace-deprecation ...` to show where the warning was created)
  RUN_PLANS: plan 902 review PASS
  RUN_PLANS: plan 902 merged into orch/val-v2 (5ca9d88)
  RUN_PLANS: final gate on orch/val-v2 (3 command(s))
  RUN_PLANS: finished — merged 902; parked none; skipped none
  RUN_PLANS: report docs/orchestrator/runs/val-v2/report.md · local copy C:/Users/danwe/AppData/Local/Temp/kit-rp-PxM2dM/val-app/.claude/orchestrator-runs/val-v2.md · calls C:/Users/danwe/AppData/Local/Temp/kit-rp-PxM2dM/val-app/.claude/orchestrator-runs/val-v2/calls.csv
git diff --name-only origin/main origin/orch/val-v2: docs/brain/run-log.md, docs/orchestrator/runs/val-v2/report.md, docs/orchestrator/runs/val-v2/status.json, plans/902-bulk-price.plan.md, src/price.mjs, src/price.test.mjs
```
