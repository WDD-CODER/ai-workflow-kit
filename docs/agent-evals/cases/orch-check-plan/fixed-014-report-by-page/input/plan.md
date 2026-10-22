# Plan 014 — The Orchestrator Workflow: Run Saved Plans Unattended Into One Run Branch (excerpt)

Eval-case excerpt: only the run report's requirement and the sub-task that builds the report are kept. The rest of the
plan's changes (workflow script, preflight, installer, tests) are outside this case and are not in diff.patch.

Status: active
Depends-on: 010, 011, 013, 017

## Functional Requirements

### Must Have (P0)
- [ ] Report: merged / parked / why; decisions taken; one validation list grouped by page with evidence; what only the
  Human can do. Written to `docs/orchestrator/runs/<run>/report.md` on the run branch **and** copied to
  `.claude/orchestrator-runs/<run>.md` in the main folder (gitignored).

## Atomic Sub-tasks

- [x] A2: Add a state script the workflow calls for everything a workflow script cannot do itself — write status.json, rebuild merged plans from anchored merge subjects, report free disk, check the merge folder is clean — core/scripts/orch-state.mjs, core/scripts/lib/

## Read-Write Scope

```scope
core/scripts/orch-state.mjs
core/scripts/lib/**
```
