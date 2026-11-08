# Plan 098 — A run never waits for the Human and never wastes a build

Status: draft
Depends-on: 095
Snapshot: 78cf1cec50085b1fd7b7dba3fd4ce9101cceabb4
Source: the first real orchestrator runs on an installed project (kit v2.1.0), audited 2026-11-08 (`docs/brain/first-run-audit-2026-11-08.md`, added by S1). The Human's brief of 2026-11-08, with the Planner's review answered `go`. Reliability fix, allowed in the freeze; no new capability.

## Problem Statement
The audit's Part 4 lists what cost the first runs hours and tokens:

1. `/orchestrate` step 2 hands the Human a terminal line and waits for `start`: one run waited 7 h 40 min for that word.
2. A background run that the harness kills for low memory is not relaunched; the Human was sent to a terminal.
3. The reviewer default is `advisory`, so two correct STOPs (a missing test; a removed form section) merged anyway. Plan 097 enforces the review for every plan without `Reviewer: advisory`, but the config default `orchestrator.reviewerMode` is still `advisory`.
4. The builder call uses the gate's timeout (`GATE_TIMEOUT_MIN`, 15 min, `run-plans.mjs` l.539): a builder was killed at 901 s and its work and tokens were lost, then escalated to the judgment model for the same problem.
5. A builder ESCALATE on scope (a file outside the scope, an `approved:` path) goes to a judgment-tier builder, which cannot widen the scope either: 3 judgment calls, 1.65 M input tokens, all parked "replan needed".
6. The dry run does not run the test-file scope check the gate runs, and ignores a stale `feat/<NNN>` left by an earlier run: one run said `WOULD START: yes`, then parked 3 plans in 20 s.
7. A park leaves `feat/<NNN>`; the next run reuses it. The Human had to delete branches in a terminal.
8. A check command the plan's author wrote that the runner cannot run is dropped with a run note (`check command dropped, not run`, l.509): a plan merged without its own server tests.

## Goals & Success Criteria
**Primary:** after `WOULD START: yes`, a run needs nothing from the Human until its end, and no model call is spent on a problem only a plan edit can fix.

- [auto] `docs/brain/first-run-audit-2026-11-08.md` exists and `npm run lint` passes (the public copy carries no project name, path or port).
- [auto] `docs/brain/error-review.md` has the four rows listed in S2 (`grep -c "^| 2026-11-08 | run-517" docs/brain/error-review.md` ≥ 4).
- [auto] `.claude/commands/orchestrate.md` (installed copy) has no reply-`start` step: `grep -c "reply \`start\`" .claude/commands/orchestrate.md` = 0; it says to run the line at once after `WOULD START: yes`, to relaunch a killed background run once after `orch-state stop`, and its watch line starts with `cd "`.
- [auto] `node --test tools/test/run-plans.test.mjs` passes, with tests that fail on today's code:
  (a) a builder call gets `orchestrator.builderTimeoutMin` (default 45) as its timeout, the gate keeps `gateTimeoutMin`; a builder timeout keeps the plan's worktree and branch (the work is saved to `park/<run>-<NNN>`, never removed);
  (b) a builder result `ESCALATE` naming a file outside the scope or an `approved:` path parks the plan `replan needed: …` at once — no judgment-tier call (the fake claude records zero further calls);
  (c) a plan whose Done-when names a check command the runner would drop is `NOT READY` in the dry run and in the real run (a readiness problem, not a note);
  (d) the dry run reports the same test-file scope problem the gate would (a changed test outside the scope's test lines) and fails on a `feat/<NNN>` that is not based on the current run branch;
  (e) with no `--reviewer-mode` flag and `orchestrator.reviewerMode` unset, a plan with `Reviewer: advisory` is reviewed as `gate`.
- [auto] `node --test tools/test/orchestrator-park-branch.test.mjs` passes, with a test that fails today: parking a plan renames `feat/<NNN>` to `park/<run>-<NNN>` (local and remote), so `plan-info` of the next run cuts a fresh `feat/<NNN>` from the new run branch.
- [auto] `kit.config.json` has `"reviewerMode": "gate"` and `"builderTimeoutMin": 45`; `docs/agent/orchestrator.md` describes both.
- [auto] `npm run build`, `npm run lint`, `npm test` and `node tools/drift-check.mjs --target .` pass (the builder runs the kit sync with apply first; it is a step, not a check — under rule (c) a Done-when line names only checks the runner can run).
- [human] After a kit release and `kit-sync` on the installed project, one `/orchestrate` starts the run right after its dry run with no reply asked for, and a plan parked in an earlier run starts on a fresh branch (reply `ok`).

## Execution Mode
- Parallel: no.
- Concurrent plans: none.
- Isolated DB: no.
- Run: `/orchestrate 095,098,099` on the kit (the Human pre-approved the merges, 2026-11-08). The run merges into `orch/<run>`; after the final gate passes and the `[human]` cards come back `done`, `orch/<run>` merges into `main` by a PR.
- Fallback: when the dry run says `WOULD START: no`, append one line with the date and the reason to `docs/brain/error-review.md` first, then build this plan by the solo flow (`feat/098-<slug>` in the main folder, then `/ship`).

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspot `CHANGELOG.md`.

```scope
docs/brain/first-run-audit-2026-11-08.md
docs/brain/error-review.md
core/.claude/commands/orchestrate.md
.claude/commands/orchestrate.md
core/docs/agent/orchestrator.md
docs/agent/orchestrator.md
core/scripts/run-plans.mjs
scripts/run-plans.mjs
core/scripts/orch-state.mjs
scripts/orch-state.mjs
kit.config.json
tools/test/run-plans.test.mjs
tools/test/orchestrator-park-branch.test.mjs
CHANGELOG.md
```

Nine source files plus the changelog; the other lines are the copies `sync` writes.

## Read Scope

Entire repo, plus `~/.claude/private/first-run-audit-2026-11-08.public.md` (the cleaned audit S1 copies).

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a step needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry.

## Architecture Impact
- INV-1: preserves — the builder and judgment tiers stay; a scope ESCALATE now parks instead of escalating, because the judgment tier cannot change a plan's scope either. The dry run and the real run share the new readiness checks.

## Step 0 — Reality Check
1. `run-plans.mjs`: the builder call (l.539, `timeoutMs: GATE_TIMEOUT_MIN * 60_000`), the ESCALATE branches (l.548–549) and the escalation to the judgment builder (l.618–639); the dropped checks (`lintPlan` l.326–356, the note at l.509).
2. `orch-state.mjs`: `plan-info` (where `feat/<NNN>` is reused, `reused branch` at l.843) and `park-save` (l.1005–1021, `park/<run>-<NNN>`): decide whether the rename belongs in `park-save` or in a park step of its own.
3. Where the gate's test-file scope check lives (`scope-check --tests` vs the run's test-file gate, `docs/agent/orchestrator.md` l.71–72): the dry run calls the gate's function, not a second copy.
4. `kit.config.json` l.116–125 and `tools/lib/kit.mjs` `orchestratorProblems`: `builderTimeoutMin` is read with a clamp (1–180, else 45) in `run-plans.mjs`, so `kit.mjs` needs no change. If a test shows `orchestratorProblems` rejects an unknown key, STOP and offer `approved: tools/lib/kit.mjs`.

## Atomic Sub-tasks
- [x] S1: Put the first-run audit in the brain as the record these fixes come from — copy the cleaned public copy as it is — docs/brain/first-run-audit-2026-11-08.md
- [x] S2: Add to the error review the four leftovers that stay a line, not a fix — the per-plan manifest check runs the main folder's tree, not the plan's; the app's e2e base URL is hard-coded instead of read from the environment; decision-review.md names an `/orchestrate` step 5 that does not exist; a replan reason says "on the run branch" while plans live on main — docs/brain/error-review.md
- [x] S3: Write the failing tests first for the timeout, the scope park, the dropped check, the dry run and the reviewer default — cases (a)–(e) — tools/test/run-plans.test.mjs
- [x] S4: Write the failing test that a park renames the plan branch so the next run starts clean — tools/test/orchestrator-park-branch.test.mjs
- [x] S5: Give the builder its own longer timeout and keep its work when it runs out — builderTimeoutMin, keep the worktree — core/scripts/run-plans.mjs, kit.config.json
- [x] S6: Park a scope problem at once instead of paying a stronger model that cannot fix it — ESCALATE on scope or approved: path → park "replan needed" — core/scripts/run-plans.mjs
- [x] S7: Make the dry run refuse what the real run would refuse — the gate's test-file check, a stale feat branch, a check the runner cannot run — core/scripts/run-plans.mjs
- [x] S8: Rename a parked plan's branch so nobody has to delete it — feat/NNN → park/run-NNN on park — core/scripts/orch-state.mjs
- [x] S9: Make the reviewer's STOP park by default — reviewerMode "gate" — kit.config.json, core/docs/agent/orchestrator.md
- [x] S10: Start the run as soon as the dry run says yes, and relaunch it once if it is killed — no reply-start step, watch line with cd — core/.claude/commands/orchestrate.md, core/docs/agent/orchestrator.md
- [x] S11: Resync the installed copies, run every check, add the changelog entry — CHANGELOG.md

## Technical Considerations
- A scope ESCALATE that parks still keeps the builder's work on `park/<run>-<NNN>` (the existing `park-save`), so a replan can start from it.
- The renamed branch name is the one `park-save` already writes, so a park that saved work and a park that renamed the branch end in the same place.
- Relaunching a killed run happens once; a second kill stops and reports it, so a machine short of memory does not loop.

## Out of Scope
Visibility (the console log, `watch`, the model per call), the end-of-run cards and the builder slot pool: plan 099. The four lines of S2 are recorded only, not fixed. The sensitive-diff review and the Bash prefixes: plan 095.

## Critical Questions
None open. (Answered `go` on 2026-11-08: numbers 098/099; the public audit copy; order 095 → 098 → 099; the fallback to the solo flow, logged first in `docs/brain/error-review.md`; the merge of `orch/<run>` into `main` is pre-approved.)

## Execution Notes
- S1, S2 done before the run by the Planner session: merged in ee80ad8 (PR #119). The error review already existed (a table), so S2 added four rows to it. The builder does not redo them; the Done-when checks for S1 and S2 already pass.
