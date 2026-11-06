### plan-reviewer

| Run | Recall | Precision | Noise | Errors | Spread (recall / precision / noise) | Cost (USD) |
| --- | --- | --- | --- | --- | --- | --- |
| before | 0.28 | 0.28 | 0.44 | 1 | 0.00 / 0.00 / 0.00 | 6.41 |
| redact | 0.20 | 0.09 | 0.79 | 0 | 0.22 / 0.08 / 0.00 | 5.50 |
| after | 0.24 | 0.10 | 0.76 | 0 | 0.04 / 0.02 / 0.09 | 7.36 |

Verdicts, redact vs before:

| Figure | Before | After | s | d | Verdict |
| --- | --- | --- | --- | --- | --- |
| recall | 0.28 | 0.20 | 0.22 | 0.43 | no real change |
| precision | 0.28 | 0.09 | 0.08 | 0.15 | regressed |
| noise | 0.44 | 0.79 | 0.00 | 0.05 | regressed |
| errors | 1.00 | 0.00 | 0.00 | 2.00 | no real change |
| cost | 0.26 | 0.22 | 0.00 | 0.00 | reported |

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
  **after** = the same plus `--with-gate` (`gate.json`; only the 3 verifier cases have one). 25 cases × 2 runs each,
  0 schema errors in both arms.
- Exact totals: before tp 13 / fn 33 / fp 33 (recall 0.2826, precision 0.2826); redact tp 9 / fn 37 / fp 89
  (recall 0.1957, precision 0.0918); after (redact-gate) tp 11 / fn 35 / fp 97 (recall 0.2391, precision 0.1019).
  The reviewer finds about as much as the checkers (recall within noise) but reports roughly three times as many
  findings that match no label; both clean bug cases got false alarms in every arm.
- A first run of both arms (prompt without the "`line` is one whole number" sentence) had 4 and 5 invalid results;
  its reports are kept in `docs/agent-evals/runs/087-first-redact*/` (redact recall 0.22 / precision 0.11, gate 0.13 / 0.07).
- Choice rule (fixed in plan 087's Step 0 before any run): the highest recall among arms with precision ≥ 0.50; no
  arm reaches 0.50, so the arm with the highest precision wins, and the reviewer is **not yet trustworthy as a
  blocking gate** — plan 088 runs it in `advisory` mode (findings listed, never park a plan).

REVIEWER: model=sonnet prompt=redact-gate because precision 0.10 is the highest of the two arms (redact 0.09) and no arm reaches 0.50 — not yet a blocking gate, advisory only
