# save-plan — mid-flight sync (after the plan is saved)

Read this when a brief adds a stage, a review produces fallout, the Human adds work mid-plan, or you are about to mark items `[x]`.

## Every brief names its parent plan

A brief executed from a plan carries the plan path (e.g. `plans/290-….plan.md`). Without it, nobody can append fallout to the right ledger.

## New work appears mid-plan → append first, then do it

Review fail, fallout, or a Human-added stage → add a `[ ]` Atomic Sub-task (and a milestone row if needed) **before** starting the work, so the ledger never lags the code.

| Who | Where to append |
| --- | --- |
| Worker (inside a `{{slots.nameFormat}}` slot) | the plan file **only** — `.claude/todo.md` is Planner-owned; `todo-query.mjs sync --merged` picks the change up after the branch merges |
| Planner (main folder, on `main`) | the plan file **and** `.claude/todo.md` |

## Marking done

Only after validation per `docs/agent/job-validation.md` — a Human reply (`done` / `verified` / `approved`), `/ship` **Y**, or the Tier 1 auto path. Never on `thanks`, `ok`, silence, or CI green alone.

| Who | Where to mark `[x]` |
| --- | --- |
| Worker | the plan file's own Atomic Sub-tasks only |
| Planner | the plan file and `.claude/todo.md` |

`[human]` items are marked by the Human's word, never self-marked.
