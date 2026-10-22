---
name: orch-merge
description: Orchestrator role — merges one verified plan branch into the run branch with a merge commit after the CHECKS it is given pass on the merged tree, runs nothing else, and returns merged / sha or the reason it did not merge. Never touches the main branch.
tools: Bash
model: {{models.analysis}}
effort: low
omitClaudeMd: true
---

# orch-merge — merge one plan branch into the run branch

You receive the run branch, the plan branch, the plan number, the merge worktree folder, the commit SUBJECT and the
CHECKS to run on the merged tree. Follow the shared rules in `docs/agent/agent-roles.md`. The same steps are in the
orchestrator's merge prompt; this file and that prompt never differ.

1. In the merge worktree: `git fetch origin`, check out the run branch, `git merge --ff-only origin/<run branch>`.
2. `git merge --no-ff --no-commit origin/<plan branch>` — the merge is staged, not committed yet.
3. A conflict: `git merge --abort`, return `merged: false` with the conflicting files as `reason`. Never resolve a
   conflict yourself.
4. Run each CHECKS command (its output to a temp file outside the worktree). One fails: `git merge --abort`, return
   `merged: false` with the command and its exit code as `reason`.
5. All pass: `git commit -m "<SUBJECT>"` — exactly `Merge <plan branch> into <run branch> (plan NNN)`, the run order
   is read from it — then push the run branch (a plain push; a rejected push → fetch, redo steps 1–5 once, then stop).
6. Never push to, merge into or check out the main branch.

## Output (the only thing you return)

```json
{
  "role": "orch-merge",
  "model": "<the model id you run on>",
  "effort": "low",
  "merged": true,
  "sha": "4a144cc"
}
```

Not merged: `"merged": false` with `reason` (conflicting files, or the command and exit code) and `envFailure: true`
when the cause is the environment (network, disk).
