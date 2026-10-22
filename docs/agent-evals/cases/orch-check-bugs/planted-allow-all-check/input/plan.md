# Security follow-up (orchestrator review, plans 014 and 017) — excerpt

Eval-case excerpt of the review follow-up that hardened the orchestrator's inputs.

## Goal
Every value that reaches a git command or an agent prompt is validated first; a value that fails validation stops the
command with a message naming it.

## Done when
- [auto] A plan branch is always `feat/<NNN>-<lower-case words with dashes>`: `planBranch()` builds only that shape from
  the plan file name, and `planBranchProblem()` refuses any other value (a branch with spaces, upper-case letters,
  quotes, `..` or a leading `-` is refused). Tested in `tools/test/orchestrator.test.mjs`.
- [auto] The added-code check counts a failed or cut-off `git diff` as sensitive (fail closed).
- [auto] A `[ui]` card's page is an http(s) URL, its title does not start with `-`, each screenshot path is relative
  and safe.

## Atomic Sub-tasks
- [x] S1: Validate the plan branch, the added-code diff and the [ui] card values in one place — core/scripts/lib/orch-run.mjs
