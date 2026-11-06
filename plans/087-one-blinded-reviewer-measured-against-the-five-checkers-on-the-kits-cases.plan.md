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

- [x] R1: Let the eval score any agent against every case regardless of role (`--role all`, default when the agent is not one of the four checker names) — tools/lib/agent-eval/score.mjs, tools/agent-eval.mjs, tools/test/agent-eval.test.mjs
- [x] R2: Write `plan-reviewer.md`: one job (does the diff satisfy the plan's criteria without a regression on the changed lines), inputs limited to criteria + diff + gate receipt, the three anti-false-STOP rules, the finder result schema plus `verdict`; add it to the agent list the contracts test checks and to agent-roles.md's role table — core/.claude/agents/plan-reviewer.md, core/docs/agent/agent-roles.md, tools/test/agent-contracts.test.mjs
- [x] R3: Run arm 1 — `--model sonnet --redact --json` → `docs/agent-evals/runs/plan-reviewer-redact/plan-reviewer.json` — docs/agent-evals/runs/**
- [x] R4: Run arm 2 — `--model sonnet --redact --with-gate --json` → `docs/agent-evals/runs/plan-reviewer-redact-gate/plan-reviewer.json` — docs/agent-evals/runs/**
- [x] R5: A/B against the 2026-10-22 Sonnet checker runs: `node tools/agent-eval-ab.mjs --before <baseline dir> --after docs/agent-evals/runs/plan-reviewer-redact-gate --arm redact=docs/agent-evals/runs/plan-reviewer-redact --out docs/agent-evals/087-reviewer-ab.md`; apply the Step 0 rule; append the `REVIEWER:` line — docs/agent-evals/087-reviewer-ab.md
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
- Step 0 item 1 — conflict: the eval keys cases by role. `findCases(casesDir, agent.name)` reads only `cases/<agent name>/`, so `plan-reviewer` finds no case; `scoreRun` refuses a result whose `role` is not the agent name, and the shared validator (`tools/lib/agent-result.mjs`, outside this plan's scope) refuses any role outside its ROLES list. R1 is not a no-op: `--role all` (default for any agent that is not one of the four checkers) reads every `<role>/<case>` folder, names a case `<role>/<case>`, and validates a non-ROLES result with a reviewer validator in `tools/lib/agent-eval/reviewer.mjs` (the finder schema plus `verdict`).
- Step 0 item 2 — conflict: the 2026-10-22 Sonnet checker runs exist, but as flat files `docs/agent-evals/runs/<role>.sonnet.json` next to the Opus ones, and `agent-eval-ab.mjs` compares only roles present in both folders (`plan-reviewer` is in none of them). The before arm is therefore one report that sums the four Sonnet files case by case, written by `node tools/agent-eval.mjs --combine … --as plan-reviewer` to `docs/agent-evals/runs/087-checkers-sonnet-2026-10-22/plan-reviewer.json`; the A/B command uses that folder as `--before`. The old reports carry no per-run totals, so the before arm has no spread (s = the reviewer arm's spread).
- Step 0 item 3 — ok: rule fixed before any run: among the reviewer arms (`redact`, `redact-gate`) the arm with the highest recall whose precision is ≥ 0.50 wins; none reaches 0.50 → the arm with the highest precision wins and the report says the reviewer is not yet a trustworthy blocking gate (088 runs it advisory).
- decision: behaviour: Step 0 rule ties — equal recall (or equal precision in the fallback) → the higher precision (or recall), then the lower cost per case; still tied → `redact` (no gate input, the simpler arm). Set before the numbers.
- decision: behaviour: R3/R4 run on the 25 baseline cases with `--case-list docs/agent-evals/baseline-2026-10-22.cases.txt` (the Done-when asks for 25 cases; the case folder now holds 27 — plan 042 added two). Reversible: drop the flag.
- decision: behaviour: in `--role all` an `orch-verify` case's `keep` verdicts become expected findings (the kept candidate's file, line and severity; rule = its category plus the orch-check-bugs prompt categories, the same set the 2026-10-22 bug relabel accepts), and `candidates.json` (other agents' output) is neither shown nor copied to the agent. Other case inputs (e.g. `AGENTS.md` in the rules cases) stay as the checkers saw them.
- decision: behaviour: the real runner's scratch copy now matches the prompt — `--redact` writes the redacted `plan.md` into the copy and `gate.json` is copied only with `--with-gate` — so the blinded agent cannot read the builder's notes or the gate from its working folder (049's runs could).
- decision: behaviour: the reviewer validator lives in `tools/lib/agent-eval/reviewer.mjs` (in scope) instead of `tools/lib/agent-result.mjs` (not in scope); plan 088 moves it into the shared validator when it wires the reviewer in.
- R1 done: `--role <name>|all` (`caseScope`; default `all` for a non-checker), `findCases(…, 'all')` over every `<role>/<case>`, `verdictsAsFindings`, `hide` (prompt and scratch copy), redacted plan copy, `validateReviewerResult` (`tools/lib/agent-eval/reviewer.mjs`), `--combine … --as … --out` (`tools/lib/agent-eval/combine.mjs`); `score.mjs` needed no change (it already sums any cases). `node --test tools/test/agent-eval.test.mjs tools/test/eval-cases.test.mjs` → tests 33, pass 33, fail 0; on the real cases `--role all` + the baseline case list gives 25 cases (27 without it).
- R2 done: `core/.claude/agents/plan-reviewer.md` (model `{{models.review}}` → installed `sonnet`, effort high, omitClaudeMd, tools Read, Grep, Glob, Bash; inputs, three anti-false-STOP rules, rule categories = the three finders' vocabularies, finder schema + `verdict`), `plan-reviewer` row in agent-roles.md's result table, two contract tests (`REVIEWERS` list). Sync → `KIT_SYNC: applied — 1 new, 1 kit-update`; drift-check `KIT_DRIFT: ok`; `node --test tools/test/agent-contracts.test.mjs` → 27/27; `node --test "tools/test/*.test.mjs"` → tests 540, pass 540, fail 0.
- R3/R4 first run failed the "zero schema errors" item: redact 4 invalid results, redact-gate 5 (problems whose `line` was not one whole number; one invalid-JSON reply). Fix: the reviewer prompt now says `line` is always one whole number ≥ 1 (never a range or null) and the JSON block must escape quotes; synced, contracts 27/27. First-run reports kept in `docs/agent-evals/runs/087-first-redact/` and `087-first-redact-gate/`. Rerun of both arms (100 more Sonnet calls; 200 in all, $26.80 measured: 5.89 + 8.05 first, 5.50 + 7.36 rerun).
- R3 done: `node tools/agent-eval.mjs --agent .claude/agents/plan-reviewer.md --cases docs/agent-evals/cases --case-list docs/agent-evals/baseline-2026-10-22.cases.txt --runs 2 --model sonnet --redact --json` → `docs/agent-evals/runs/plan-reviewer-redact/plan-reviewer.json`: 25 cases × 2 runs, 0 errors, recall 0.1957, precision 0.0918, cost $5.50.
- R4 done: same plus `--with-gate` → `docs/agent-evals/runs/plan-reviewer-redact-gate/plan-reviewer.json`: 25 × 2, 0 errors, recall 0.2391, precision 0.1019, cost $7.36.
- R5 done: before = `--combine` of the four 2026-10-22 Sonnet reports (recall 0.2826, precision 0.2826, $6.41). `agent-eval-ab.mjs` → recall "no real change" for both arms, precision and noise "regressed" for both. Step 0 rule: no arm ≥ 0.50 precision → highest precision = `redact-gate` (0.1019 vs 0.0918); `REVIEWER: model=sonnet prompt=redact-gate …`, advisory only.
- decision: behaviour: the plan's Critical Question says to rerun on Opus when arm 2's precision is below 0.50 (it is 0.10); the Opus arm was not run (the main session set it off for this build). Open for the Human: run it (+50 calls, ~3× a Sonnet arm) or keep Sonnet.
