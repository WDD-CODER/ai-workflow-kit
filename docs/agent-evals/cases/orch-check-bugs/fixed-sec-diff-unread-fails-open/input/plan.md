# Plan 014 — The Orchestrator Workflow: Run Saved Plans Unattended Into One Run Branch (excerpt)

Eval-case excerpt: only the requirements the state script serves are kept. The rest of the plan's changes (workflow
script, preflight, installer, tests) are outside this case and are not in diff.patch.

## Functional Requirements

### Must Have (P0)
- [ ] Per plan: builder (in its slot, scope-guarded) → gate → finders in parallel → verifier → security (only when the
  diff touches `security.sensitivePaths` or names auth/permission code) → UI validator (when 018 is present) → merger
  (serialised; build + tests before push).
- [ ] State: git is the ledger; `scripts/orch-state.mjs` writes `status.json` after every step and rebuilds the done
  set from anchored merge subjects.

## Atomic Sub-tasks

- [x] A2: Add a state script the workflow calls for everything a workflow script cannot do itself — write status.json, rebuild merged plans from anchored merge subjects, report free disk, check the merge folder is clean; `diff` says whether the security reviewer must run — core/scripts/orch-state.mjs, core/scripts/lib/
