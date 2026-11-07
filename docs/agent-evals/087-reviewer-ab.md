### plan-reviewer

| Run | Recall | Precision | Noise | Errors | Spread (recall / precision / noise) | Cost (USD) |
| --- | --- | --- | --- | --- | --- | --- |
| before | 0.28 | 0.28 | 0.44 | 1 | 0.00 / 0.00 / 0.00 | 6.41 |
| redact | 0.20 | 0.09 | 0.79 | 0 | 0.22 / 0.08 / 0.00 | 5.50 |
| opus-redact-gate | 0.46 | 0.12 | 0.86 | 0 | 0.13 / 0.04 / 0.03 | 18.29 |
| after | 0.24 | 0.10 | 0.76 | 0 | 0.04 / 0.02 / 0.09 | 7.36 |

Verdicts, redact vs before:

| Figure | Before | After | s | d | Verdict |
| --- | --- | --- | --- | --- | --- |
| recall | 0.28 | 0.20 | 0.22 | 0.43 | no real change |
| precision | 0.28 | 0.09 | 0.08 | 0.15 | regressed |
| noise | 0.44 | 0.79 | 0.00 | 0.05 | regressed |
| errors | 1.00 | 0.00 | 0.00 | 2.00 | no real change |
| cost | 0.26 | 0.22 | 0.00 | 0.00 | reported |

Verdicts, opus-redact-gate vs before:

| Figure | Before | After | s | d | Verdict |
| --- | --- | --- | --- | --- | --- |
| recall | 0.28 | 0.46 | 0.13 | 0.26 | no real change |
| precision | 0.28 | 0.12 | 0.04 | 0.08 | regressed |
| noise | 0.44 | 0.86 | 0.03 | 0.06 | regressed |
| errors | 1.00 | 0.00 | 0.00 | 2.00 | no real change |
| cost | 0.26 | 0.73 | 0.00 | 0.00 | over +20 % |

Verdicts, after vs before:

| Figure | Before | After | s | d | Verdict |
| --- | --- | --- | --- | --- | --- |
| recall | 0.28 | 0.24 | 0.04 | 0.09 | no real change |
| precision | 0.28 | 0.10 | 0.02 | 0.05 | regressed |
| noise | 0.44 | 0.76 | 0.09 | 0.17 | regressed |
| errors | 1.00 | 0.00 | 0.00 | 2.00 | no real change |
| cost | 0.26 | 0.29 | 0.00 | 0.00 | reported |


## How to read this (plan 087)

- **before** = the 2026-10-22 Sonnet runs of the four checkers (`orch-check-bugs`, `-plan`, `-rules`, `orch-verify`),
  summed case by case into one report by `node tools/agent-eval.mjs --combine … --as plan-reviewer`
  (`docs/agent-evals/runs/087-checkers-sonnet-2026-10-22/`). Those reports carry no per-run totals, so its spread is
  0 and `s` is the reviewer arm's spread. Each checker was scored on its own role's cases only; the reviewer is scored
  on all 25 (`--role all`, verifier cases read as their kept candidates).
- **redact** = `plan-reviewer` on Sonnet, `--redact` (plan without its Execution Notes, diffs only).
  **after** = the same plus `--with-gate` (`gate.json`; only the 3 verifier cases have one).
  **opus-redact-gate** = `after` on `--model opus` (run because arm 2's precision is below 0.50, as the plan's Critical
  Question says). 25 cases × 2 runs each, 0 schema errors in all three reviewer arms.
- Exact totals:

  | Arm | tp / fn / fp | Recall | Precision | Cost per case (USD) |
  | --- | --- | --- | --- | --- |
  | before (four checkers) | 13 / 33 / 33 | 0.2826 | 0.2826 | 0.256 |
  | redact (Sonnet) | 9 / 37 / 89 | 0.1957 | 0.0918 | 0.220 |
  | redact-gate (Sonnet) | 11 / 35 / 97 | 0.2391 | 0.1019 | 0.294 |
  | opus-redact-gate (Opus) | 21 / 25 / 159 | 0.4565 | 0.1167 | 0.731 |

  Opus finds the most (recall 0.46, but within noise of the checkers' 0.28 by the tool's d = 0.26) and reports the
  most unlabelled findings (159 over 50 runs), at 2.9× the checkers' cost per case. All three reviewer arms report
  8–10 unlabelled findings per labelled one (Opus 7.6, Sonnet 8.8 and 9.9); both clean bug cases got false alarms.
- First runs, discarded: the two Sonnet arms had 4 and 5 invalid results before the prompt said `line` is one whole
  number (kept in `docs/agent-evals/runs/087-first-redact*/`); a first Opus run stopped on the account's 5-hour usage
  limit (7 `claude exited 1` results) and was rerun whole after the reset, with no prompt change.
- Choice rule (fixed in plan 087's Step 0 before any run): the highest recall among arms with precision ≥ 0.50; no
  arm reaches 0.50, so the arm with the highest precision wins, and the reviewer is **not yet trustworthy as a
  blocking gate** — plan 088 runs it in `advisory` mode (findings listed, never park a plan).

REVIEWER: model=opus prompt=redact-gate because precision 0.12 is the highest of the three arms (sonnet redact-gate 0.10, sonnet redact 0.09) and no arm reaches 0.50 — not yet a blocking gate, advisory only

## 2026-11-07 — reviewer + orch-verify (Sonnet, redact-gate), evidence only

New arm **sonnet-verify-redact-gate**: `plan-reviewer` on Sonnet (`--redact --with-gate`), then `orch-verify` on Sonnet
on the reviewer's problems (written as the case's `candidates.json`, same redaction and gate rules); only the problems
orch-verify kept (verdict `keep`, confidence ≥ 80, at its severity) are scored. 25 cases × 2 runs, `--role all`,
`--case-list docs/agent-evals/baseline-2026-10-22.cases.txt`, 0 runner errors, 0 invalid results. Report:
`docs/agent-evals/runs/plan-reviewer-verify-sonnet-redact-gate/plan-reviewer.json`. The runner (outside the repo)
calls `claudeRunner()` twice per case and run; when the reviewer reports nothing (14 of 50 runs) orch-verify is not called.

Table (`node tools/agent-eval-ab.mjs --before docs/agent-evals/runs/087-checkers-sonnet-2026-10-22 --after docs/agent-evals/runs/plan-reviewer-redact-gate --arm redact=docs/agent-evals/runs/plan-reviewer-redact --arm opus-redact-gate=docs/agent-evals/runs/plan-reviewer-opus-redact-gate --arm sonnet-verify-redact-gate=docs/agent-evals/runs/plan-reviewer-verify-sonnet-redact-gate`; the file above was not regenerated):

### plan-reviewer

| Run | Recall | Precision | Noise | Errors | Spread (recall / precision / noise) | Cost (USD) |
| --- | --- | --- | --- | --- | --- | --- |
| before | 0.28 | 0.28 | 0.44 | 1 | 0.00 / 0.00 / 0.00 | 6.41 |
| redact | 0.20 | 0.09 | 0.79 | 0 | 0.22 / 0.08 / 0.00 | 5.50 |
| opus-redact-gate | 0.46 | 0.12 | 0.86 | 0 | 0.13 / 0.04 / 0.03 | 18.29 |
| sonnet-verify-redact-gate | 0.13 | 0.10 | 0.67 | 0 | 0.00 / 0.01 / 0.02 | 4.99 |
| after | 0.24 | 0.10 | 0.76 | 0 | 0.04 / 0.02 / 0.09 | 7.36 |

Verdicts, redact vs before:

| Figure | Before | After | s | d | Verdict |
| --- | --- | --- | --- | --- | --- |
| recall | 0.28 | 0.20 | 0.22 | 0.43 | no real change |
| precision | 0.28 | 0.09 | 0.08 | 0.15 | regressed |
| noise | 0.44 | 0.79 | 0.00 | 0.05 | regressed |
| errors | 1.00 | 0.00 | 0.00 | 2.00 | no real change |
| cost | 0.26 | 0.22 | 0.00 | 0.00 | reported |

Verdicts, opus-redact-gate vs before:

| Figure | Before | After | s | d | Verdict |
| --- | --- | --- | --- | --- | --- |
| recall | 0.28 | 0.46 | 0.13 | 0.26 | no real change |
| precision | 0.28 | 0.12 | 0.04 | 0.08 | regressed |
| noise | 0.44 | 0.86 | 0.03 | 0.06 | regressed |
| errors | 1.00 | 0.00 | 0.00 | 2.00 | no real change |
| cost | 0.26 | 0.73 | 0.00 | 0.00 | over +20 % |

Verdicts, sonnet-verify-redact-gate vs before:

| Figure | Before | After | s | d | Verdict |
| --- | --- | --- | --- | --- | --- |
| recall | 0.28 | 0.13 | 0.00 | 0.05 | regressed |
| precision | 0.28 | 0.10 | 0.01 | 0.05 | regressed |
| noise | 0.44 | 0.67 | 0.02 | 0.05 | regressed |
| errors | 1.00 | 0.00 | 0.00 | 2.00 | no real change |
| cost | 0.26 | 0.20 | 0.00 | 0.00 | reported |

Verdicts, after vs before:

| Figure | Before | After | s | d | Verdict |
| --- | --- | --- | --- | --- | --- |
| recall | 0.28 | 0.24 | 0.04 | 0.09 | no real change |
| precision | 0.28 | 0.10 | 0.02 | 0.05 | regressed |
| noise | 0.44 | 0.76 | 0.09 | 0.17 | regressed |
| errors | 1.00 | 0.00 | 0.00 | 2.00 | no real change |
| cost | 0.26 | 0.29 | 0.00 | 0.00 | reported |


Before and after verify, inside this arm (same 50 runs, per finding with the scorer's `matchFindings`):

| Stage | Findings | tp / fn / fp | Recall | Precision | Cost (USD) |
| --- | --- | --- | --- | --- | --- |
| reviewer alone (raw problems) | 82 | 7 / 39 / 75 | 0.15 | 0.09 | 2.41 |
| after orch-verify (kept) | 61 | 6 / 40 / 55 | 0.13 | 0.10 | 2.41 + 2.58 = 4.99 |

- orch-verify dropped 21 of 82 findings: 7 refuted, 14 kept below confidence 80. Of those 21, 20 were fp and 1 was a
  tp (`orch-check-plan/fixed-010-scope-and-done-when` run 1, `.kit/install.json:6` minor scope finding, kept at
  confidence 20). It changed one kept severity (major → blocker).
- It removed 27 % of the fp (75 → 55) and precision moved 0.09 → 0.10: still about 9 unlabelled findings per labelled
  one, far from 0.50. 46 of the 55 surviving fp are on `plan.md` ("ticked sub-task / Done-when item not in the diff");
  orch-verify confirms them because the case diffs hold only the slice around the labelled bug. Sample:
  `docs/agent-evals/087-fp-sample.md`.
- The reviewer stage of this arm found less than the earlier redact-gate arm on the same settings (7 vs 11 tp, 75 vs
  97 fp): run-to-run variance of the reviewer, not an effect of verify.
- Cost: $4.99 for 50 runs ($0.20 per case), below the reviewer-only redact-gate arm's $7.36; the verify call costs
  about as much as the review call.

No new REVIEWER: line — evidence for the Human's decision.

## 2026-11-07 — fixed scorer (plan 091)

New arm **sonnet-redact-gate-091** (`after` in the table): `node tools/agent-eval.mjs --agent .claude/agents/plan-reviewer.md --cases docs/agent-evals/cases --runs 2 --model sonnet --redact --with-gate --role all --case-list docs/agent-evals/baseline-2026-10-22.cases.txt --json`,
run through a spend-capped wrapper of the same `claudeRunner()` (cap $6, outside the repo). 25 cases × 2 runs, 0 runner
errors, 0 invalid results, no rerun. Report: `docs/agent-evals/runs/plan-reviewer-sonnet-redact-gate-091/plan-reviewer.json`.
What changed against the earlier arms: severity matches within one level (blocker ~ major, major ~ minor); on
`orch-check-bugs/` and `orch-verify/` cases a `plan.md` finding of category `done-when`, `scope` or a sub-task id is
**unscored** (neither tp nor fp); the prompt says the diff is the whole change under review.

**The earlier arms were scored with the old scorer** (exact severity, every plan.md finding scored, no diff sentence in
the prompt); their raw findings were not kept, so they cannot be rescored — their rows below are as printed before
(`n/a` unscored), not like-for-like with the new arm.

Table (`node tools/agent-eval-ab.mjs --before docs/agent-evals/runs/087-checkers-sonnet-2026-10-22 --after docs/agent-evals/runs/plan-reviewer-sonnet-redact-gate-091 --arm redact=docs/agent-evals/runs/plan-reviewer-redact --arm redact-gate=docs/agent-evals/runs/plan-reviewer-redact-gate --arm opus-redact-gate=docs/agent-evals/runs/plan-reviewer-opus-redact-gate --arm sonnet-verify-redact-gate=docs/agent-evals/runs/plan-reviewer-verify-sonnet-redact-gate`):

| Run | Recall | Precision | Noise | Unscored | Errors | Spread (recall / precision / noise) | Cost (USD) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| before | 0.28 | 0.28 | 0.44 | n/a | 1 | 0.00 / 0.00 / 0.00 | 6.41 |
| redact | 0.20 | 0.09 | 0.79 | n/a | 0 | 0.22 / 0.08 / 0.00 | 5.50 |
| redact-gate | 0.24 | 0.10 | 0.76 | n/a | 0 | 0.04 / 0.02 / 0.09 | 7.36 |
| opus-redact-gate | 0.46 | 0.12 | 0.86 | n/a | 0 | 0.13 / 0.04 / 0.03 | 18.29 |
| sonnet-verify-redact-gate | 0.13 | 0.10 | 0.67 | n/a | 0 | 0.00 / 0.01 / 0.02 | 4.99 |
| after | 0.15 | 0.29 | 0.34 | 0 | 0 | 0.04 / 0.01 / 0.10 | 2.51 |

Verdicts, after vs before:

| Figure | Before | After | s | d | Verdict |
| --- | --- | --- | --- | --- | --- |
| recall | 0.28 | 0.15 | 0.04 | 0.09 | regressed |
| precision | 0.28 | 0.29 | 0.01 | 0.05 | no real change |
| noise | 0.44 | 0.34 | 0.10 | 0.20 | no real change |
| errors | 1.00 | 0.00 | 0.00 | 2.00 | no real change |
| cost | 0.26 | 0.10 | 0.00 | 0.00 | reported |

- Exact totals: tp 7 / fn 39 / fp 17, unscored 0; recall 0.1522, precision 0.2917; per run recall 0.17 / 0.13,
  precision 0.29 / 0.30; cost $2.51 ($2.02 run 1, $0.49 run 2; $0.10 per case).
- Unscored is 0: with the diff sentence in the prompt the reviewer reported no plan-step finding on `plan.md` in a bug
  or verify case, so the fp fall (97 in the earlier redact-gate arm → 17) comes from the prompt, not from the unscored rule.
- By case role (tp / fn / fp): bugs 2 / 24 / 12 (14 cases), plan 1 / 9 / 3, rules 4 / 0 / 1, verify 0 / 6 / 1. The
  reviewer now finds less on the bug cases; 12 of the 17 fp are on five planted / fixed bug cases (2–3 each), which may
  be findings near the labelled bug that miss its line or rule — not checkable, the raw findings are not kept.
- Precision 0.29 reaches the checkers' 0.28 (no real change by the tool's d = 0.05); recall 0.15 is below their 0.28
  (regressed). Still far from the 0.50 that `orchestrator.reviewerMode` gate would need.

REVIEWER: model=sonnet prompt=redact-gate scorer=091 precision=0.29 recall=0.15 — review.ship=reviewer when precision >= 0.28: yes
