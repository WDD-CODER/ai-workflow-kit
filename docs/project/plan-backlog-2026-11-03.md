# Plan backlog report — 2026-11-03

Written by the Planner after a kit-learn session. Source: `kit-prevalidate` runs on six plans, a research pass over the 14 plans not yet built, and `origin/main` at 2e00691. "Unverified" means the research pass could not confirm it in code. Plan files are the record; this page is a dated snapshot and goes stale — re-run the checks before acting on a row.

## 1. Plans whose work merged but which are still open

Boxes with `file:line` evidence were ticked on 2026-11-03 (commit bd9cd9f). Nothing below was closed: `plan-close.mjs` ignores `[human]` items, so it would close 030 and 046 over an unvalidated check.

| Plan | Merged work | Still open because | What closes it |
| --- | --- | --- | --- |
| 030 Orchestrator learns run to run | feat(030) commits | `[human]` item (Done-when, plan line 137) | After a FoodVibe run: lesson lines in `docs/brain/agent-lessons/check-bugs.md`, `planner.md` and `docs/brain/run-log.md`; a `D<n> ✗` reply gives a `## checkers` rule marked pending and a new folder under `docs/agent-evals/cases/`; the report's last line starts `Trend`. Needs a `kit-sync` into FoodVibe first |
| 035 Skill improver | S0–S9 | S10 is dated (open until 2026-11-17); `[human]` lines 49–50; line 128 unticked (files exist, no `file:line` evidence yet) | One nightly PR `chore/skill-improve-<skill>-<date>` validated and merged; on or after 2026-11-17 a one-page review from `~/.claude/skill-improver/spend.jsonl` |
| 036 Workflow scout | C0–C5 (v1.13.0) | C6, C7, C8 and P0 line 118 not started; `[human]` lines 44–45 | Scout run once by hand in the first project, weekly routine scheduled after the Human's go, "Which were useful?" boxes ticked in the PR |
| 046 kit-learn | all Atomic Sub-tasks | `[human]` line 67 | `/kit-learn` in a kit session: at most 5 cards with real `file:symbol` causes, a one-line reply produces a plan draft with `Source: brain issue <id>` and a `K<n>` lesson line; a week later a dismissed card does not return |
| 057 /ship learns | feat(057), PR #85 | H1 (line 186) and `[human]` line 58 | After the next kit release and sync into FoodVibe: one plain `/ship` on a Worker plan with a `seen:` decision — checker pipeline ran, `- review:` line in Execution Notes, row in `docs/brain/follow-ups.md`, `ship-<NNN>` row in `decision-grades.jsonl`, then `/plan` lists the follow-up |
| 058 Preflight starts main servers | PR #86 | H1 (line 218) and `[human]` lines 69–72 | After the next release and sync: with no dev server running, `/orchestrate` on two small plans shows `OK dev server`; a plan with an `[auto:main]` item starts the backend on `dev:local` and `.claude/be.log` exists. Two stub processes (PIDs 28276, 5916) from a hung test may still run. A1's failing-first test was never run before the fix; the Human may untick A1 |

## 2. The 14 plans not yet built

| Plan | Title | Date | Depends-on | Already covered by | Recommendation |
| --- | --- | --- | --- | --- | --- |
| 047 | Learning loop runs nightly, earns autonomy per category | 2026-10-30 | 046, 035 | Not built. Overlaps 048 on `tools/skill-improver/**` | keep, blocked until 046 and 035 close |
| 048 | Agents improve by measurement: scorer, case set, eval-gated improver | 2026-10-30 | 030, 035, 046, 049 | Extends closed 019, 021, 049 | keep, blocked by 030, 035, 046; re-check 030 is still needed (064–067 overtook part of it, unverified) |
| 050 | Script-passed cards shown as a glance group | 2026-11-01 | 049 | Not built | merge into plan 069 (see section 3) |
| 051 | Repeated same-check cards merge into one | 2026-11-01 | 050 | Not built (unverified) | merge into plan 069 |
| 052 | Skip cards for untouched areas a test covers | 2026-11-01 | 051 | Not built (unverified) | merge into plan 069 |
| 053 | End-of-run list in the plain-text card layout | 2026-11-01 | 052 | 022 covers the ship hand-off only (unverified) | merge into plan 069 |
| 054 | Reported card failure reproduced by a short test, two fix attempts | 2026-11-01 | 053 | Not built (unverified) | keep, separate; depends on 069 |
| 056 | Kit script is a main-folder check only when listed; removals never triaged away | 2026-11-02 | none | Not built: denylist `MAIN_TRY_NOT_A_CHECK` at `orch-state.mjs:486`; `duplicateOf` forces `noise` at `orchestrate.js:1352` | keep (reported as fail-open; not independently read) |
| 060 | Readiness flags tests that loop over every entity type | 2026-11-02 | 063 | 063 merged, dependency met | keep |
| 061 | Parked plan reruns without plan-file conflicts; branches track their own remote | 2026-11-02 | none | 059/062/064 touched the same files, not this logic | keep; line references refreshed 2026-11-03 |
| 065 | Lesson lines carry the run's code-made fact or nothing | 2026-11-02 | none | Builds on merged 064 | keep, build before 066 |
| 066 | Repeated lessons counted on one line, routed to the right role | 2026-11-02 | 065 | Extends 064's routing | keep, after 065 |
| 067 | A repeated lesson fact becomes a proposed kit lesson | 2026-11-02 | 066 | Builds on 046 | keep; the live `[human]` check is blocked by 046 |
| 068 | Environment-failure retry checks the command that failed | 2026-11-03 | none | Only 058 is related | keep |

## 3. Plan 069 (draft, not saved at the time of writing)

Merges 050–053 into one plan: they run strictly in order (`plan-order`: one lane, 050 → 051 → 052 → 053 → 054, no parallel wave), share the same files (`job-validation.md`, `orchestrator.md`, `done-when.mjs`, `orchestrate.js`, `orch-report.md`, the two test files, `CHANGELOG.md`), and no open plan outside the chain depends on them except 054. Plan 054 would depend on 069.

## 4. Why merged plans stay open, and where a check could run

`standards-git.md` already says `/ship` must tick the plan's Atomic Sub-tasks in the same commit as the job. Nothing verifies the ticks, and `todo-sync.yml` has no model, so it only closes plans whose boxes are already ticked. An orchestrated plan merges into the run branch with its boxes unticked.

- **Best place: `/ship` Phase 4 step 1, before the commit.** On a plan branch, run `kit-prevalidate` on the plan, tick `DONE` rows that carry `file:line`, stage the plan file in the same commit, and list the `TODO` and `[human]` rows in the approval text.
- **Orchestrator:** after `mergeStep` in `core/.claude/workflows/orchestrate.js`, run the same check and put the result in the report.
- **Not CI.** The main session re-checks every `DONE` row before ticking (as `auto-solve` Phase 2 does). Not built.
