# Kit plans

Plans for changing the kit itself live here, not in a project that uses the kit.

- Name: `plans/NNN-<slug>.plan.md`, numbered from `001` in this repo (independent of any project's plan numbers).
- Shape: the same Plan Contract shape projects use (Status, Snapshot, Read-Write Scope, Architecture Impact,
  Atomic Sub-tasks with plain titles, Done-when tagged `[auto]` / `[human]`).
- Execution: open the session in the kit folder, on the branch the plan names; work goes through a kit PR and,
  when the plan says so, a release (`docs/CHANGE-LOOP.md`).
- Steps that touch a project (for example the final `kit-sync` into it) run in that project, as its plan
  step says, and are shipped there with its own workflow.
- Done plans move to `plans/done/`.
- This folder is not installed into projects and is not scanned by `leak-check`; still, keep machine paths
  and private data out of it.
