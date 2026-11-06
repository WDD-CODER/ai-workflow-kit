# Plan 087 — One blinded reviewer, measured against the five checkers on the kit's cases

Status: draft
Depends-on: none
Snapshot: fd212e119ef16c0b26ebfaf6b44f450fee26d8f5
Source: kit audit 2026-11-06, plan D; `docs/agent-evals/BASELINE.md` (2026-10-22); 10-31 audit "redact builder claims (eval A/B on the 25 cases)".

## Problem Statement
The review step costs five Sonnet agents and two fix rounds per plan and catches 25–33 % of planted bugs at 22–38 % precision (BASELINE.md). Opus is worse on the same cases (recall 0.19, precision 0.12) at three times the cost. The sources (Hamel Husain) say a judge is a classifier: pick its prompt and model by measurement against labels, never by tier. The kit has the tools (`tools/agent-eval.mjs` with `--redact` and `--with-gate`, `tools/agent-eval-ab.mjs`) and the 25 labelled cases; the one reviewer prompt that will replace the five checkers does not exist yet and has never been measured.

## Goals & Success Criteria
**Primary:** a single reviewer agent file exists, is measured on the kit's cases blinded (no `## Execution Notes`) and with the gate output, and its model is chosen by the measurement.

- [auto] `core/.claude/agents/plan-reviewer.md` exists: `model: {{models.review}}`, `effort: high`, `omitClaudeMd: true`, tools `Read, Grep, Glob, Bash` (Bash only for `git diff`, `git show` and running one test file); inputs it names: the plan's `## Goals & Success Criteria`, `## Functional Requirements` and `## Out of Scope`, the diff `BASE...BRANCH`, the gate receipt — and nothing else; three rules that prevent a false STOP (changed lines only; trust the gate output; a STOP needs a criterion or a concrete failing input); output = the shared finder schema of `docs/agent/agent-roles.md` with `verdict: PASS|STOP`; `node --test tools/test/agent-contracts.test.mjs` passes with the new file in its list.
- [auto] `docs/agent-evals/runs/plan-reviewer-redact/plan-reviewer.json` and `docs/agent-evals/runs/plan-reviewer-redact-gate/plan-reviewer.json` exist (the folders R3/R4 write), produced by `node tools/agent-eval.mjs --agent .claude/agents/plan-reviewer.md --cases docs/agent-evals/cases --runs 2 --model sonnet --redact [--with-gate] --json`, each with 25 cases × 2 runs and zero schema errors.
- [auto] `node tools/agent-eval-ab.mjs --before <the 2026-10-22 Sonnet checker runs found in Step 0 item 2> --after docs/agent-evals/runs/plan-reviewer-redact-gate --arm redact=docs/agent-evals/runs/plan-reviewer-redact --out docs/agent-evals/087-reviewer-ab.md` writes the verdict table (recall, precision, noise, cost per role) and the file ends with one line `REVIEWER: model=<sonnet|opus> prompt=<arm> because <figure>` chosen by the rule in Step 0.
- [auto] `docs/agent-evals/BASELINE.md` gains a section "2026-11 — single reviewer" with the table and the chosen model; `docs/agent/model-routing.md` names `plan-reviewer` under the `review` tier.
- [auto] `npm run build`, `npm run lint`, `npm test`, `node --test "tools/test/*.test.mjs"` pass; sync then drift-check report no drift.
- [human] Read `docs/agent-evals/087-reviewer-ab.md` once: the chosen arm is the one you would pick from the numbers (reply `ok` or name the arm you prefer and why).

## Execution Mode
- Parallel: no.
- Concurrent plans: none. Runs after 086 (its redaction is the same idea, but this plan's eval uses the eval tool's own `--redact`, so there is no code dependency).
- Isolated DB: no.
- Cost: 2 arms × 25 cases × 2 runs = 100 headless `claude -p` calls on Sonnet (≈ the 2026-10-22 baseline's cost per arm, ~$3 equivalent). The Opus arm is optional and off by default (see Critical Questions).

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspot `CHANGELOG.md`.

```scope
core/.claude/agents/plan-reviewer.md
.claude/agents/plan-reviewer.md
core/docs/agent/agent-roles.md
docs/agent/agent-roles.md
core/docs/agent/model-routing.md
docs/agent/model-routing.md
docs/agent-evals/BASELINE.md
docs/agent-evals/087-reviewer-ab.md
docs/agent-evals/runs/**
tools/agent-eval.mjs
tools/lib/agent-eval/**
tools/test/agent-contracts.test.mjs
tools/test/agent-eval.test.mjs
CHANGELOG.md
```

## Read Scope

Entire repo, and the baseline runs under `docs/agent-evals/runs/`.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry.

## Architecture Impact
- INV-1: preserves — the new agent is on the `review` tier key; Haiku stays refused for it.
- INV-none otherwise: one new agent file and eval reports; no pipeline change yet (plan 088 wires it in).

## Step 0 — Reality Check
1. Read `tools/lib/agent-eval/score.mjs`: does a case carry a role, and does the scorer accept an agent whose name is not one of the four checker roles? If it keys the expected findings by role, add `--role all` (R1 below) so every case counts for the one reviewer; if it already scores any agent against every case, R1 is a no-op — record which.
2. Read `docs/agent-evals/runs/`: confirm the 2026-10-22 Sonnet runs for the four checker roles exist (the "before" arm); if they sit in another folder, use that path in the A/B command and note it.
3. The choice rule, fixed before the numbers are seen: the arm with the highest recall among arms whose precision is ≥ 0.50 wins; no arm reaches 0.50 precision → the arm with the highest precision wins and the report says the reviewer is not yet trustworthy as a blocking gate (plan 088 then runs it in `advisory` mode: findings are listed, never park a plan).

## Atomic Sub-tasks

- [ ] R1: Let the eval score any agent against every case regardless of role (`--role all`, default when the agent is not one of the four checker names) — tools/lib/agent-eval/score.mjs, tools/agent-eval.mjs, tools/test/agent-eval.test.mjs
- [ ] R2: Write `plan-reviewer.md`: one job (does the diff satisfy the plan's criteria without a regression on the changed lines), inputs limited to criteria + diff + gate receipt, the three anti-false-STOP rules, the finder result schema plus `verdict`; add it to the agent list the contracts test checks and to agent-roles.md's role table — core/.claude/agents/plan-reviewer.md, core/docs/agent/agent-roles.md, tools/test/agent-contracts.test.mjs
- [ ] R3: Run arm 1 — `--model sonnet --redact --json` → `docs/agent-evals/runs/plan-reviewer-redact/plan-reviewer.json` — docs/agent-evals/runs/**
- [ ] R4: Run arm 2 — `--model sonnet --redact --with-gate --json` → `docs/agent-evals/runs/plan-reviewer-redact-gate/plan-reviewer.json` — docs/agent-evals/runs/**
- [ ] R5: A/B against the 2026-10-22 Sonnet checker runs: `node tools/agent-eval-ab.mjs --before <baseline dir> --after docs/agent-evals/runs/plan-reviewer-redact-gate --arm redact=docs/agent-evals/runs/plan-reviewer-redact --out docs/agent-evals/087-reviewer-ab.md`; apply the Step 0 rule; append the `REVIEWER:` line — docs/agent-evals/087-reviewer-ab.md
- [ ] R6: Record the result: BASELINE.md section, model-routing.md row (`plan-reviewer` → review tier; the chosen model when it differs from `models.review`), CHANGELOG — docs/agent-evals/BASELINE.md, core/docs/agent/model-routing.md, CHANGELOG.md
- [ ] T1: Resync the installed copies, run every check — CHANGELOG.md

## Technical Considerations
- Dependencies: `tools/lib/agent-eval/run.mjs` (`claudeRunner`, `claudeArgs` — `claude -p --output-format json --system-prompt-file`), the 25 cases under `docs/agent-evals/cases/`, `tools/agent-eval-ab.mjs` (d = max(0.05, 2s) rule: with 25 cases most differences are "within noise" — that is a finding, not a failure; report it as the A/B tool prints it).
- New files: `plan-reviewer.md`, the two run folders, `087-reviewer-ab.md`.
- Backend / API: none. Auth and validation: none. Security surface: none. Data / migration: none.

## Out of Scope
- Growing the case set past 25 (the sources ask for 100–200; that is the frozen plan 048's job once runs produce labelled failures).
- Wiring the reviewer into `/ship` or the runner (plans 088, 089).
- The Opus arm (see below).

## Critical Questions
- Q: Run a third arm on Opus (`--model opus --redact --with-gate`, +50 calls, ~3× the cost of a Sonnet arm)? A: no — the 2026-10-22 baseline already shows Opus below Sonnet on these cases; rerun it only if arm 2's precision is below 0.50.

## Execution Notes
