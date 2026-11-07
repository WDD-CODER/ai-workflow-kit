# Plan 091 — Eval scorer matches what a reviewer sees, and the runner's reviewer goes back to Sonnet

Status: draft
Depends-on: none
Snapshot: b3abe93
Source: Human decision 2026-11-07 on the 087 evidence (`docs/agent-evals/087-fp-sample.md`, `087-reviewer-ab.md` § 2026-11-07).

## Problem Statement
The 087 evidence shows the eval partly measures its own cases, not the reviewer:
1. 57 of 75 false positives (46 of 55 after `orch-verify`) are `plan.md` findings "a ticked sub-task / Done-when item has no change in the diff". A case's `diff.patch` holds only the slice of the real commit around the labelled bug, so those findings are true for what the reviewer is shown.
2. A finding on the labelled bug's own file and line with `blocker` where the label says `major` counts as one fp plus one fn (`tools/lib/agent-eval/compare.mjs:40` compares severity exactly).
3. The eval prompt (`casePrompt` in `tools/lib/agent-eval/run.mjs`) never says the diff is the whole change, so a reviewer reasonably reports the plan's other sub-tasks as missing.
The runner's reviewer model is `opus` (088, from 087's line); the Human chose Sonnet until the fixed eval says otherwise.

## Goals & Success Criteria
**Primary:** the scorer and the prompt match what a reviewer sees; one Sonnet arm is rerun on the fixed eval; `run-plans.mjs` reviews on Sonnet.

- [auto] `node --test tools/test/agent-eval.test.mjs` passes with new cases: (a) a finding equal to an expected one except severity one level apart (`blocker`↔`major`, `major`↔`minor`) is a tp; two levels apart (`blocker`↔`minor`) is not; (b) on a case under `orch-check-bugs/` or `orch-verify/`, an actual finding on `plan.md` whose rule category is `done-when`, `scope` or a sub-task id (`/^[a-z]+\d+$/` after normalising, e.g. `a2`, `d1`, `m6`) is neither tp nor fp (counted in a new `unscored` figure); the same finding on an `orch-check-plan/` or `orch-check-rules/` case is scored as today; (c) `casePrompt` contains one sentence saying the diff is the whole change under review (no other commit belongs to it, so a plan step without a change in the diff is not a finding by itself).
- [auto] `docs/agent-evals/runs/plan-reviewer-sonnet-redact-gate-091/plan-reviewer.json` exists, produced by `node tools/agent-eval.mjs --agent .claude/agents/plan-reviewer.md --cases docs/agent-evals/cases --runs 2 --model sonnet --redact --with-gate --role all --case-list docs/agent-evals/baseline-2026-10-22.cases.txt --json`, 25 cases × 2 runs, zero runner errors and zero invalid results; eval spend ≤ $6 (one rerun of failing cases allowed inside that budget).
- [auto] `docs/agent-evals/087-reviewer-ab.md` gains a section `## 2026-11-07 — fixed scorer (plan 091)` with the new arm's table (recall, precision, noise, unscored, cost) next to the earlier arms' figures as printed before, a one-line note that the earlier arms were scored with the old scorer (their raw findings were not kept, so they cannot be rescored), and ends with one new line `REVIEWER: model=sonnet prompt=redact-gate scorer=091 precision=<p> recall=<r> — review.ship=reviewer when precision >= 0.28: <yes|no>`.
- [auto] `orchestrator.reviewerModel` defaults to `sonnet` in `kit.config.json` and `.kit/config.json`; `scripts/run-plans.mjs` renders `const REVIEWER_MODEL = "sonnet"`; `docs/agent/orchestrator.md` and `docs/agent/model-routing.md` say the default is `sonnet` (Human 2026-11-07, until the fixed eval says otherwise); `tools/install-check.mjs` and `tools/test/run-plans.test.mjs` assert `sonnet`.
- [auto] `npm run build`, `npm run lint`, `npm test`, `node --test "tools/test/*.test.mjs"`, `node tools/orchestrator-e2e.mjs` pass; `node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .` report no drift.
- [human] Read the new section of `docs/agent-evals/087-reviewer-ab.md`: the `REVIEWER:` line's yes/no decides whether plan 089's `review.ship` switches to `reviewer` (reply `ok` or the value you want).

## Execution Mode
- Parallel: no. Runs before 089 and 090 (Human order: 091 → 089 → 090).
- Isolated DB: no.
- Cost: one Sonnet arm, 50 headless calls (≈ $5–7 at the 087 rates).

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspot `CHANGELOG.md`.

```scope
tools/lib/agent-eval/**
tools/agent-eval.mjs
tools/agent-eval-ab.mjs
tools/test/agent-eval.test.mjs
tools/test/run-plans.test.mjs
tools/test/orchestrator.test.mjs
tools/install-check.mjs
docs/agent-evals/087-reviewer-ab.md
docs/agent-evals/BASELINE.md
docs/agent-evals/runs/**
docs/agent/agent-evals.md
core/docs/agent/agent-evals.md
core/docs/agent/orchestrator.md
docs/agent/orchestrator.md
core/docs/agent/model-routing.md
docs/agent/model-routing.md
core/scripts/run-plans.mjs
scripts/run-plans.mjs
kit.config.json
.kit/config.json
tools/lib/kit.mjs
CHANGELOG.md
```

## Read Scope

Entire repo, the case folders under `docs/agent-evals/cases/`.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry. In this run: `tools/test/**` and `tools/lib/**` are pre-approved.

## Architecture Impact
- INV-1: preserves — the reviewer stays off Haiku (`sonnet` is a non-Haiku model; install and sync keep refusing Haiku for `orchestrator.reviewerModel` and `models.review`).
- INV-none otherwise: the eval's scoring and prompt, and one config default.

## Step 0 — Reality Check
1. Read `tools/lib/agent-eval/compare.mjs` (`findingMatches`, `matchFindings`, `compareCase`) and how `scoreRun` in `run.mjs` passes the case's role: confirm where the case folder's role (`orch-check-bugs/…`) is known at scoring time.
2. Read `casePrompt` in `run.mjs`: the new sentence goes into the shared prompt for every agent (checkers and reviewer alike).
3. List where `reviewerModel` / `"opus"` is asserted for the reviewer (`tools/install-check.mjs` ~995 and ~1027, `tools/test/run-plans.test.mjs` ~191, ~286, ~386, `core/docs/agent/orchestrator.md` ~50, `core/docs/agent/model-routing.md` ~47); print `ok` / `conflict:` per item.

## Atomic Sub-tasks

- [ ] E1: Count a finding one severity level away from the label as a match — severity order blocker > major > minor, adjacent levels match — tools/lib/agent-eval/compare.mjs, tools/test/agent-eval.test.mjs
- [ ] E2: Stop scoring plan-step findings on plan.md in bug and verify cases, where the case diff is only a slice — category done-when, scope or a sub-task id; new `unscored` figure in the report and the A/B table — tools/lib/agent-eval/compare.mjs, tools/lib/agent-eval/run.mjs, tools/agent-eval-ab.mjs, tools/test/agent-eval.test.mjs
- [ ] E3: Tell every evaluated agent that the diff is the whole change under review — one sentence in casePrompt — tools/lib/agent-eval/run.mjs, tools/test/agent-eval.test.mjs, core/docs/agent/agent-evals.md
- [ ] E4: Run the reviewer back on Sonnet in run-plans until the fixed eval says otherwise — orchestrator.reviewerModel default sonnet; docs and asserts follow — kit.config.json, .kit/config.json, core/docs/agent/orchestrator.md, core/docs/agent/model-routing.md, tools/install-check.mjs, tools/test/run-plans.test.mjs
- [ ] E5: Rerun one reviewer arm on the fixed eval and record the result — Sonnet, --redact --with-gate, 25 cases × 2 runs; append the section and the REVIEWER: line — docs/agent-evals/runs/**, docs/agent-evals/087-reviewer-ab.md, docs/agent-evals/BASELINE.md
- [ ] T1: Resync the installed copies, run every check, add the changelog entry — CHANGELOG.md

## Technical Considerations
- `unscored` findings are left out of tp, fp and noise; recall's denominator is unchanged (expected findings).
- The 087 arms were scored with the old scorer and their raw findings were not kept, so the new section compares the fixed-scorer arm with old-scorer numbers; the note says so. Comparing like with like needs a rerun of the checkers' baseline, which is out of scope here.
- Backend / API: none. Auth and validation: none. Security surface: none. Data / migration: one config default changes; a project that set `orchestrator.reviewerModel` keeps its value.

## Out of Scope
- Re-running the four checkers' baseline or the Opus arm on the fixed scorer.
- Rewriting the cases' diffs to hold the whole commit.
- Switching `review.ship` (plan 089 owns the key; the Human decides from this plan's REVIEWER line).
- `orch-verify` chaining (Human: not in the runner).

## Critical Questions
- none (Human decisions 2026-11-07: severity within one level; plan.md done-when/scope findings unscored on bug and verify cases; prompt says the diff is the whole change; reviewer Sonnet, redact-gate, advisory).

## Execution Notes
- decision: behaviour: rule (b) also covers a sub-task-id category (`A2:`, `D1:`), because the fp sample shows most "ticked sub-task not in the diff" findings carry the sub-task id as their category, not `done-when`; reverse by dropping the id pattern in E2.
- validated: plan 087 [human] reviewer report — Human 2026-11-07: ok, with this plan as the decision (fix the eval first; runner reviewer Sonnet redact-gate advisory; no orch-verify chaining).
- validated: plan 088 [human] dry-run part — Human 2026-11-07: ok (`node scripts/run-plans.mjs --dry-run --run goal-check --plans 089` from main: WOULD START: yes, no model call). The real-run part is plan 058 H1, after this plan.
