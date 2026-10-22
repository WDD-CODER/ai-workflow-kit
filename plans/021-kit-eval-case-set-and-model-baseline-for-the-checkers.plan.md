# Plan 021 — Kit Eval Case Set and Model Baseline for the Checkers

Status: draft
Snapshot: 305fce2
Depends-on: 019, 020

## Problem Statement
Plan 019 built the eval harness (`tools/agent-eval.mjs`), but no real case set exists, so the checker and verifier
agents run on the default model (Sonnet) with no measured recall or precision. Plan 019's `[human]` item waits on
labels Dandan has not produced yet (MVP run outcome, QA findings).

The kit's own orchestrator run (PR #37) produced labelled data whose truth is proved by code, not by a model's opinion:
problems an independent checker found that a later commit fixed and a test now covers, plans that passed with no
problem, and the security review findings that were fixed with tests. Dandan asked that the cases not be graded by the
same agent that wrote them ("make sure you're not on the same page"), so a label is accepted only when a fix commit and
a passing test back it, or when the bug is planted on purpose.

## Prerequisites
- 019 merged (harness) and 020 merged (its fixes touch the agents measured here).

## Goals & Success Criteria
**Primary:** a baseline table — recall, precision, noise, tokens and cost per model (Opus, Sonnet; Haiku is never a validator — Human rule 2026-10-22) — for
`orch-check-bugs`, `orch-check-plan`, `orch-check-rules` and `orch-verify` on 20–25 real or planted cases, recorded in
`docs/agent-evals/BASELINE.md`.

- [auto] `docs/agent-evals/cases/` holds at least 20 cases in the harness shape (`input/` + `expected.json`), each with
  a `note` naming its source: the fix commit and the test that proves the label, `clean: plan NNN passed with no
  finding`, or `planted: <what was changed>`. Checked by `node tools/agent-eval.mjs --agent .claude/agents/orch-check-bugs.md --cases docs/agent-evals/cases --runner tools/fixtures/agent-evals/stub-perfect.mjs`
  (stub runner, no model call) exiting 0 — every case parses.
- [auto] No case label comes from a model's opinion alone: `node --test tools/test/eval-cases.test.mjs` checks every
  `expected.json` `note` starts with `fixed by <sha>`, `clean:` or `planted:`, and that each `fixed by <sha>` commit
  exists in `git log`.
- [auto] `docs/agent-evals/BASELINE.md` has one table per agent with one row per model and the columns recall,
  precision, noise, tokens, cost, from runs with `--runs 2`.
- [auto] `node tools/install-check.mjs` passes with a fixture where `models.review: "haiku"` (and
  `"claude-haiku-4-5"`) makes install refuse with a message naming `models.review`; every rendered validating agent
  (`orch-check-*`, `orch-verify`, `orch-security`, `orch-ui`) carries `model: sonnet` by default.
- [auto] `npm run build`, `npm run lint`, `npm run test`, `node tools/drift-check.mjs --target .` exit 0.
- [human] Dandan reads `BASELINE.md` and picks the default model per checker role (or keeps Sonnet); the choice goes
  into `.kit/config.json` / `kit.config.json` defaults in a later change.

## Execution Mode
- Parallel: no — runs after 020; model runs are token- and memory-heavy, one at a time.
- Concurrent plans: none.
- Isolated DB: no.
- Kit edits: kit branch `feat/021-kit-eval-baseline` + kit PR; Dandan merges. Release: minor, with 020's fixes if not yet
  released (new config key `models.review`; nothing a project must do).

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`.

```scope
docs/agent-evals/**
tools/test/eval-cases.test.mjs
tools/fixtures/agent-evals/stub-perfect.mjs
core/.claude/agents/**
core/.claude/commands/review-it.md
core/docs/agent/model-routing.md
kit.config.json
.kit/config.json
.kit/install.json
tools/lib/kit.mjs
tools/install-check.mjs
.claude/agents/**
.claude/commands/**
docs/agent/**
CHANGELOG.md
```

## Read Scope

Entire repo. Analysis and architectural suggestions are expected.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside the
`## Read-Write Scope` above: STOP, tell the Human the file, the exact change, and why it can't be done in-scope; offer
`approved: <path>`; then append the path to the scope block above and retry.

## Architecture Impact
- INV-none: preserves — data and a report in the kit's own docs; no workflow rule or installed file changes.

## Step 0 — Reality Check

Runs only when `scope-check.mjs --drift` reports `REALITY: drift`. Check the listed commits by symbol and print one line
per commit: `ok` or `conflict: <what>`. STOP for a go only on a `conflict`.

## User Stories
- As Dandan, I want to pick each checker's model from measured numbers, not a guess.
- As the Planner, I want a gate that shows when a prompt change makes a checker worse.

## Functional Requirements

### Must Have (P0)
- [ ] Fixed-problem cases from the run (input = the plan + the diff before the fix commit; label = the problem the fix
  commit closed): plan 010 (`9d26599` → `daf4f2c`), 017 (`25a9a4b` → `c8342ea`), 014 (`aff848a` → `7e2bca1`),
  018 (`387d666` → `dbc4ce4`); the security follow-up (`383a7cc` → `35140fb`, one case per finding where the diff
  allows); the Windows short-path bug (`387b1ee` → `ea53cd2`).
- [ ] Clean cases (label = no finding): plans 011 (`7845500`), 013 (`9f99049`), 019 (`7dad8a7`), split into
  reviewable diffs.
- [ ] Planted cases: small diffs with one known bug each (off by one, a check that allows everything, an inverted
  comparison, a lost escape, an unchecked error path).
- [ ] Verifier cases: candidate lists mixing confirmed findings (from the fixed cases) and refutable false alarms.
- [ ] Runs: each finder and the verifier on Opus and Sonnet, `--runs 2`, one run at a time.
- [ ] Validators never run below Sonnet: a new tier `models.review` (default `sonnet`) for `orch-check-bugs`,
  `orch-check-plan`, `orch-check-rules`, `orch-verify`, `orch-security`, `orch-ui` and `/review-it`'s checkers; install
  and sync refuse `haiku` or a `claude-haiku-*` id for it, naming the key. `models.analysis` keeps its other users.

### Should Have (P1)
- [ ] `BASELINE.md` names, per role, the cheapest model whose recall and precision are within 0.05 of the best.

### Nice to Have (P2)
- none

## UI/UX Notes
- None (report file only).

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [ ] A1: Build cases from problems the run's checkers found and a later commit fixed, so each label is proved by code — plan + pre-fix diff + changed files as input, the fixed problem as the label, note "fixed by <sha>" — docs/agent-evals/cases/
- [ ] A2: Build clean cases from plans that passed with no finding, to measure false alarms — docs/agent-evals/cases/
- [ ] A3: Add planted-bug cases with one exact known answer each — docs/agent-evals/cases/
- [ ] A4: Add verifier cases that mix real findings with refutable false alarms — docs/agent-evals/cases/orch-verify/
- [ ] A5: Prove every case parses and every label has a code-backed source, before spending tokens — stub runner and a case test — tools/fixtures/agent-evals/stub-perfect.mjs, tools/test/eval-cases.test.mjs
- [ ] A0: Give validating agents their own model tier that can never be Haiku, so a review is never done by the weakest model — models.review default sonnet, refused when haiku; checker, verifier, security, UI agents and the review command use it; routing doc and install check updated — kit.config.json, .kit/config.json, tools/lib/kit.mjs, tools/install-check.mjs, core/.claude/agents/orch-check-*.md, orch-verify.md, orch-security.md, orch-ui.md, core/.claude/commands/review-it.md, core/docs/agent/model-routing.md
- [ ] A6: Run each checker and the verifier on Opus and Sonnet and write the baseline report — two runs per case, one run at a time — docs/agent-evals/BASELINE.md
- [ ] A7: Record the outcome in the changelog and the plan's notes — CHANGELOG.md

## Technical Considerations
- Dependencies: `tools/agent-eval.mjs`, `tools/lib/agent-result.mjs`, the `.claude/agents/orch-*.md` files after 020.
- New files needed: the case folders, `BASELINE.md`, the stub runner, the case test.
- Model changes: new tier `models.review` (default `sonnet`, never Haiku) for every validating agent (A0).
- Backend / API: none.
- Auth and validation: none.
- Security surface: none — cases hold kit code only; no secrets.
- Data / migration: none.
- Project checks: none.
- Cost: about 18 agent runs per case (4 agents × 2 models × 2 runs, less for role-specific cases) → roughly 1.5–3M
  tokens. Runs one at a time because the machine is low on memory.

## Out of Scope
- FoodVibe cases (MVP cards, QA findings) — they need Dandan's labels; plan 019's `[human]` item stays open for them.
- The UI validator's evals.
- Changing default models.

## Critical Questions
- none

## Execution Notes
Asked for by Dandan on 2026-10-22 ("plan and run 021 when done"), after plan 020.
