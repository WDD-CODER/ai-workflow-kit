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
