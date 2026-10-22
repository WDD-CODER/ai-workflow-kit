# Plan 014 — The Orchestrator Workflow: Run Saved Plans Unattended Into One Run Branch (excerpt)

Eval-case excerpt: only the state requirement and the sub-task that builds the state script are kept. The rest of the
plan's changes (workflow script, preflight, installer, tests) are outside this case and are not in diff.patch.

## Functional Requirements

### Must Have (P0)
- [ ] Readiness (D9): `plan-order --json` → waves; one readiness agent per plan.
- [ ] Per plan: builder (in its slot, scope-guarded) → gate → finders in parallel → verifier → security → merger
  (serialised; build + tests before push). The plans of one wave run at the same time.
- [ ] State: git is the ledger; `scripts/orch-state.mjs` writes `status.json` after every step (plan, state, round, sha,
  model per agent, free disk) and rebuilds the done set from anchored merge subjects; timestamps come in through the
  workflow's `args`; every count in a message comes from that file or an anchored git command run in the same turn.

## Atomic Sub-tasks

- [x] A2: Add a state script the workflow calls for everything a workflow script cannot do itself — write status.json, rebuild merged plans from anchored merge subjects, report free disk, check the merge folder is clean — core/scripts/orch-state.mjs, core/scripts/lib/
