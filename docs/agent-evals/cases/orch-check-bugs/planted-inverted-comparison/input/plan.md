# Plan 014 — The Orchestrator Workflow: Run Saved Plans Unattended Into One Run Branch (excerpt)

Eval-case excerpt: only the readiness preflight requirement and its sub-task are kept. The rest of the plan's changes
(workflow script, state script, installer, tests) are outside this case and are not in diff.patch.

## Functional Requirements

### Must Have (P0)
- [ ] Readiness (D9): `plan-order --json` → waves; one readiness agent per plan (Step 0, Done-when tiers present, scope
  sane, env needs); script preflight (free disk, DB reachable, dev servers start, git identity set, required settings);
  one batched question list.
- [ ] Environment failures do not consume a round: pause the plan, retry once after the env check, then stop the wave
  with the reason.

New config key `orchestrator.minFreeDiskGb` (default 5): the free disk the environment check asks for before a run.

## Atomic Sub-tasks

- [x] A3: Add the readiness preflight so environment problems are found before the run, not by a builder — disk, database, dev servers, git identity, settings; prints one line per problem — core/scripts/orch-preflight.mjs
