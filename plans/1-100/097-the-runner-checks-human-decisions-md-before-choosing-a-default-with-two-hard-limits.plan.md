# Plan 097 — the runner checks human-decisions.md before choosing a default, with two hard limits

Status: done
Depends-on: 058, 096
Snapshot: b2fd7b5
Source: Human, 2026-11-07 — plan 096's request item 2: "the same lookup before choosing a default. Add two hard limits
from section 4: never choose more autonomy or more spend than the plan asks for; never treat a database or folder as
production without an explicit human answer." Run after 058. Reliability rule, no new capability; no new agent, no model
call added.

## Problem Statement
`core/scripts/run-plans.mjs` refuses a plan with an `A: open` Critical Question (`openQuestions`, l.125; `lintPlan`,
l.223) but reads nothing of the Human's recorded decisions. A plan whose question `/plan` answered `default per D<n>`
(plan 096) runs even when D<n> has since been superseded or frozen. Nothing in the runner stops a run whose options ask
for more than the plan does (`--concurrency 2`, `--reviewer-mode advisory`, `--db remote`), and nothing stops the
builder from treating a database or folder as production on its own reading (D22, Q06 in
`docs/brain/human-decisions.md` section 4).

## Goals & Success Criteria
**Primary:** before any build, the runner accepts a `default per D<n>` answer only when D<n> is `in force` in
`docs/brain/human-decisions.md`, and refuses a run that asks more autonomy or spend than the plan, or that treats a
database or folder as production with no Human answer.

- [auto] `node --test tools/test/run-plans.test.mjs` passes, with new cases that fail on today's code:
  (a) a plan whose Critical Question reads `A: default per D18 …` with D18 `in force` in a fixture
  `human-decisions.md` is ready; the same with D18 `superseded by D40`, `frozen`, `open` or no D18 row is refused with
  `default per D18: decision is <status> — ask the Human` and no model call;
  (b) no `human-decisions.md` in the repo: an `A: default per D<n>` answer is refused the same way (no silent pass);
  (c) only lines of the plan's `## Execution Mode` count (Q1), matched case-insensitively with an exact value:
  `--concurrency 2` is refused `more autonomy than plan NNN asks for: --concurrency 2` unless a `Concurrent plans: NNN`
  line names another plan of the same run (`Concurrent plans: none`, a plan outside the run, or no line → refused);
  `--reviewer-mode advisory` is refused the same way without a `Reviewer: advisory` line; `--db remote` is refused
  `more spend/risk than plan NNN asks for: --db remote` without a `Database: remote` line; the same words in Critical
  Questions or free text ask for nothing;
  (d) a Critical Question is a production question (Q2) when it holds `production`, `prod` or `live` as a whole word
  (case-insensitive) and also names `database`, `db`, `cluster`, `atlas`, `folder` or `server`; answered only by
  `default per D<n>` it is refused `production needs an explicit Human answer (plan NNN Q<n>)`, and with a Human answer
  (`A: (Human, <date>) …`) it is ready; `product`, `producer` or `live` with no database/folder word never trigger it;
  a question the matcher cannot classify with certainty is refused and asked (a false refusal is fine, a silent default
  is not);
  (e) the builder prompt carries both hard limits word for word (string test on `builderPrompt`).
- [auto] `node scripts/run-plans.mjs --dry-run --plans <fixture>` prints each refusal above and `modelCalls: 0`.
- [auto] `run-plans.mjs` only reads `docs/brain/human-decisions.md` — never writes it (test: file bytes unchanged after
  a run of the fake runner).
- [auto] `npm run build`, `npm run lint`, `npm test`, `node --test "tools/test/*.test.mjs"` pass;
  `node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .` report no drift.

## Execution Mode
- Parallel: no. Concurrent plans: none.
- Solo kit flow: `feat/097-<slug>` in this folder, then `/ship`. Run after 058.

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspot
`CHANGELOG.md`.

```scope
core/scripts/run-plans.mjs
scripts/run-plans.mjs
tools/test/run-plans.test.mjs
```

(The installed copy `scripts/run-plans.mjs` is rewritten by `node tools/sync.mjs --target . --apply`.)

## Read Scope

Entire repo.

## Escalation Protocol

If a step needs a file outside the `## Read-Write Scope` (a fixture folder, `scripts/run-plans.mjs` if sync does not
cover it): STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append the path to the scope
block and retry.

## Architecture Impact
- INV-1: preserves — the dry run and the real run share the same lint path; the new refusals sit in `lintPlan`, which
  both use. No invariant changed.

## Step 0 — Reality Check
1. Read `run-plans.mjs` `openQuestions` (l.125), `lintPlan` (l.207), `parseArgs` (l.173–193) and `builderPrompt`;
   confirm where the run options meet each plan's lint.
2. Read `docs/brain/human-decisions.md` section 1: the status column's values and the id format (`D<nn>`).
3. Confirm how plans write a Human answer today in `## Critical Questions` (e.g. plan 094's `Q1 (answered, Human
   2026-11-07)`), so (d)'s "explicit Human answer" matches the real shape.

## Atomic Sub-tasks
- [x] R1: Write the failing tests (a)–(e) first — tools/test/run-plans.test.mjs
- [x] R2: Read the Decisions table (status by id) once per run; an `A: default per D<n>` answer is open unless D<n> is `in force` — core/scripts/run-plans.mjs
- [x] R3: Refuse run options above the plan's own ask (concurrency, reviewer mode, remote DB) — core/scripts/run-plans.mjs
- [x] R4: A production question needs a Human answer, never a default; both hard limits go into the builder prompt — core/scripts/run-plans.mjs
- [x] R5: Sync, run every check, changelog — CHANGELOG.md

## Out of Scope
Matching a question to a decision by meaning (that is `/plan`'s job, plan 096; the runner checks only the id it was
given); writing to `human-decisions.md`, `readiness-answers.jsonl` or lessons (frozen until 090); a new agent or model
call.

## Critical Questions
- Q1: Which plan text counts as "the plan asks for" concurrency 2, advisory review and the remote database?
  A: (Human, 2026-11-08) Only explicit lines in the plan's `## Execution Mode`, nowhere else (not Critical Questions,
  not free text): concurrency 2 → `Concurrent plans: NNN` naming another plan in the same run (`none` = refuse);
  advisory review → a line `Reviewer: advisory`; remote database → a line `Database: remote`. A missing line means the
  plan does not ask for it. Case-insensitive match on the line, exact value.
- Q2: Is the production keyword list (`production`, `prod`, `live`) enough?
  A: (Human, 2026-11-08) Keep the three words, matched as whole words only, case-insensitive, and only when the same
  question also names a database or folder (`database`, `db`, `cluster`, `atlas`, `folder`, `server`). `prod` must not
  match inside words like `product` or `producer`. When in doubt, refuse and ask the Human: a false refusal is fine, a
  silent default is not.

## Execution Notes
- Step 0: 058 is merged (PR 86, PR 106) though its plan file still says draft; the dependency is met. The config default `orchestrator.reviewerMode` is `advisory`.
- decision: behaviour: the config default `advisory` (no `--reviewer-mode` flag) is not refused — that would stop every run — but applies only to a plan with a `Reviewer: advisory` line; any other plan's review runs as `gate` (less autonomy, the safe side of the hard limit), printed on the plan's `decisions:` lint line. An explicit `--reviewer-mode advisory` is refused per (c). Existing tests: plan 457 (advisory STOP merges) gained `Reviewer: advisory`, plans 465/466 (`--concurrency 2`) gained `Concurrent plans:` lines.
- seen: `docs/agent/orchestrator.md` and the `kit.config.json` `$comment` still describe `reviewerMode: advisory` as applying to every plan; both are outside this plan's scope.
- review: checkers kept 1 dropped 0 rechecked 0 minutes 10 models check-plan=sonnet,check-bugs=sonnet,check-rules=sonnet (minor bugs-1: `default per D1` did not match the table's `D01` — fixed, ids normalised, test added)
- test: failing first — the five 097 tests failed on today's code (5/5); after: `node --test tools/test/run-plans.test.mjs` 27/27, `node --test "tools/test/*.test.mjs"` 499 pass 0 fail, build, lint (0 leaks), sync + drift-check no drift.
