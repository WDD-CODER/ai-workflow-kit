# Plan 049 — checkers hardening: before / experiments / after

Status: accepted by the Human on 2026-11-01 with the four readings in "Decisions" (inconclusive redaction, a precision rule that is too tight, no claimed gain for the gate, noise of two runs).

Sonnet, 2 runs per case, the 25 cases of `BASELINE.md` (`baseline-2026-10-22.cases.txt`), today's exact-severity scorer.
Raw reports: `docs/agent-evals/runs/049-before|redact|gate|after/`. Every table and verdict below is printed by
`node tools/agent-eval-ab.mjs --before … --arm redact=… --arm gate=… --after … --adopt-rule redaction`; nothing in
the tables is typed by hand. `s` is the larger run-to-run spread of the two runs compared, `d = max(0.05, 2 × s)`.

## What was measured

| Arm | What changed | Roles |
| --- | --- | --- |
| before | the agent files on the plan's starting commit (`8c0048d`), no flag | all four |
| redact | `--redact`: the case plan without `## Execution Notes`, prompt says read diffs only | the three finders |
| gate | `--with-gate`: the case's `input/gate.json` (all project checks passed) shown to the verifier | orch-verify |
| after | the finished branch: finder prompts unchanged (redaction not adopted), verifier with `--with-gate` | all four |

## Decisions

- **Redaction (H2a / H2b): not adopted — inconclusive, not disproven.** "REJECT" in the adoption lines below means the
  rule was not met, not that redaction was shown not to work. For check-plan the threshold d = 0.80 was unreachable
  (the before-run spread was 0.40), while recall 0.20 → 0.30 and precision 0.22 → 0.33 both point up. For check-bugs
  nothing moved; check-rules went down in the experiment arm. H2b (redacted plan copies in real runs) was therefore
  not built. **Follow-up:** re-run redaction on check-plan only, 5 runs per case.
- **Verifier gets the gate (H7): kept, but not shown to be an improvement over 2026-10-22.** The 0.00 recall of the
  `before` run came from 4 invalid-JSON results (errors 4), not from the verifier missing the finding; the `after`
  recall of 0.33 equals the 2026-10-22 baseline (0.33). Cost per case rose from 0.07 (before, depressed by those
  errors) to 0.20 (after). `gate.json` is constructed, not captured. The `improved` verdict in the table compares with
  a depressed before-run; do not read it as a gain over 2026-10-22. The intermediate `gate` arm (recall 0.17, 2 errors)
  shows how much two runs of three cases move on their own.
- **The `regressed` verdicts:** the finder agents (check-bugs, check-plan, check-rules) are byte-for-byte the same in
  `before` and `after`; only the verifier changed. The check-bugs precision drop (0.20 → 0.10) is below its d = 0.40;
  it is flagged only by the "precision fell by more than 0.02" rule. That rule is too tight for noisy roles and
  should use d (a follow-up for `agent-eval-ab.mjs`). It is run-to-run noise of an unchanged agent, so nothing was
  reverted. The `regressed` verdicts in the `redact` arm (check-rules precision and noise) belong to the experiment
  that was not adopted.
- **Two runs cannot decide small effects.** Unchanged agents moved by up to 0.25 between runs: check-rules recall
  was 0.25 on 2026-10-22 and 0.50 in both the `before` and `after` runs now; check-bugs and check-plan spreads are
  0.08–0.40.
- **Not exercised by the 25 cases** (judged by their own tests): the test-file gate, replan verdict, receipt and the
  no-progress stop.
- `gate.json` for the three verify cases is constructed (all project checks passing, since each bug got past them), not
  captured from a real run.
- A first set of runs was discarded: the eval runner threw `EPERM` when deleting its scratch folder on Windows and lost
  finished results; `claudeRunner` now retries the cleanup and never throws on it.

### orch-check-bugs

| Run | Recall | Precision | Noise | Errors | Spread (recall / precision / noise) | Cost (USD) |
| --- | --- | --- | --- | --- | --- | --- |
| before | 0.19 | 0.20 | 0.57 | 1 | 0.08 / 0.06 / 0.21 | 2.40 |
| redact | 0.19 | 0.20 | 0.64 | 0 | 0.08 / 0.06 / 0.07 | 2.98 |
| after | 0.12 | 0.10 | 0.64 | 0 | 0.23 / 0.20 / 0.07 | 3.01 |

Verdicts, redact vs before:

| Figure | Before | After | s | d | Verdict |
| --- | --- | --- | --- | --- | --- |
| recall | 0.19 | 0.19 | 0.08 | 0.15 | no real change |
| precision | 0.20 | 0.20 | 0.06 | 0.13 | no real change |
| noise | 0.57 | 0.64 | 0.21 | 0.43 | no real change |
| errors | 1.00 | 0.00 | 0.00 | 2.00 | no real change |
| cost | 0.17 | 0.21 | 0.00 | 0.00 | over +20 % |

Adoption rule (redaction), redact: **REJECT orch-check-bugs — recall 0.19 → 0.19 (needs +0.15), precision 0.20 → 0.20 (must not drop)**

Verdicts, after vs before:

| Figure | Before | After | s | d | Verdict |
| --- | --- | --- | --- | --- | --- |
| recall | 0.19 | 0.12 | 0.23 | 0.46 | no real change |
| precision | 0.20 | 0.10 | 0.20 | 0.40 | regressed |
| noise | 0.57 | 0.64 | 0.21 | 0.43 | no real change |
| errors | 1.00 | 0.00 | 0.00 | 2.00 | no real change |
| cost | 0.17 | 0.21 | 0.00 | 0.00 | over +20 % |

### orch-check-plan

| Run | Recall | Precision | Noise | Errors | Spread (recall / precision / noise) | Cost (USD) |
| --- | --- | --- | --- | --- | --- | --- |
| before | 0.20 | 0.22 | 0.60 | 0 | 0.40 / 0.40 / 0.20 | 0.34 |
| redact | 0.30 | 0.33 | 0.40 | 0 | 0.20 / 0.15 / 0.20 | 0.49 |
| after | 0.20 | 0.25 | 0.40 | 0 | 0.00 / 0.13 / 0.20 | 0.61 |

Verdicts, redact vs before:

| Figure | Before | After | s | d | Verdict |
| --- | --- | --- | --- | --- | --- |
| recall | 0.20 | 0.30 | 0.40 | 0.80 | no real change |
| precision | 0.22 | 0.33 | 0.40 | 0.80 | no real change |
| noise | 0.60 | 0.40 | 0.20 | 0.40 | no real change |
| errors | 0.00 | 0.00 | 0.00 | 2.00 | no real change |
| cost | 0.07 | 0.10 | 0.00 | 0.00 | over +20 % |

Adoption rule (redaction), redact: **REJECT orch-check-plan — recall 0.20 → 0.30 (needs +0.80), precision 0.22 → 0.33 (must not drop)**

Verdicts, after vs before:

| Figure | Before | After | s | d | Verdict |
| --- | --- | --- | --- | --- | --- |
| recall | 0.20 | 0.20 | 0.40 | 0.80 | no real change |
| precision | 0.22 | 0.25 | 0.40 | 0.80 | no real change |
| noise | 0.60 | 0.40 | 0.20 | 0.40 | no real change |
| errors | 0.00 | 0.00 | 0.00 | 2.00 | no real change |
| cost | 0.07 | 0.12 | 0.00 | 0.00 | over +20 % |

### orch-check-rules

| Run | Recall | Precision | Noise | Errors | Spread (recall / precision / noise) | Cost (USD) |
| --- | --- | --- | --- | --- | --- | --- |
| before | 0.50 | 0.50 | 0.33 | 0 | 0.00 / 0.00 / 0.00 | 0.51 |
| redact | 0.25 | 0.25 | 0.67 | 0 | 0.50 / 0.50 / 0.00 | 0.52 |
| after | 0.50 | 0.50 | 0.33 | 0 | 0.00 / 0.00 / 0.00 | 0.54 |

Verdicts, redact vs before:

| Figure | Before | After | s | d | Verdict |
| --- | --- | --- | --- | --- | --- |
| recall | 0.50 | 0.25 | 0.50 | 1.00 | no real change |
| precision | 0.50 | 0.25 | 0.50 | 1.00 | regressed |
| noise | 0.33 | 0.67 | 0.00 | 0.05 | regressed |
| errors | 0.00 | 0.00 | 0.00 | 2.00 | no real change |
| cost | 0.17 | 0.17 | 0.00 | 0.00 | reported |

Adoption rule (redaction), redact: **REJECT orch-check-rules — recall 0.50 → 0.25 (needs +1.00), precision 0.50 → 0.25 (must not drop)**

Verdicts, after vs before:

| Figure | Before | After | s | d | Verdict |
| --- | --- | --- | --- | --- | --- |
| recall | 0.50 | 0.50 | 0.00 | 0.05 | no real change |
| precision | 0.50 | 0.50 | 0.00 | 0.05 | no real change |
| noise | 0.33 | 0.33 | 0.00 | 0.05 | no real change |
| errors | 0.00 | 0.00 | 0.00 | 2.00 | no real change |
| cost | 0.17 | 0.18 | 0.00 | 0.00 | reported |

### orch-verify

| Run | Recall | Precision | Noise | Errors | Spread (recall / precision / noise) | Cost (USD) |
| --- | --- | --- | --- | --- | --- | --- |
| before | 0.00 | 1.00 | 0.00 | 4 | 0.00 / 0.00 / 0.00 | 0.20 |
| gate | 0.17 | 1.00 | 0.33 | 2 | 0.33 / 0.00 / 0.33 | 0.23 |
| after | 0.33 | 1.00 | 0.00 | 0 | 0.00 / 0.00 / 0.00 | 0.61 |

Verdicts, gate vs before:

| Figure | Before | After | s | d | Verdict |
| --- | --- | --- | --- | --- | --- |
| recall | 0.00 | 0.17 | 0.33 | 0.67 | no real change |
| precision | 1.00 | 1.00 | 0.00 | 0.05 | no real change |
| noise | 0.00 | 0.33 | 0.33 | 0.67 | no real change |
| errors | 4.00 | 2.00 | 0.00 | 2.00 | no real change |
| cost | 0.07 | 0.08 | 0.00 | 0.00 | reported |

Verdicts, after vs before:

| Figure | Before | After | s | d | Verdict |
| --- | --- | --- | --- | --- | --- |
| recall | 0.00 | 0.33 | 0.00 | 0.05 | improved |
| precision | 1.00 | 1.00 | 0.00 | 0.05 | no real change |
| noise | 0.00 | 0.00 | 0.00 | 0.05 | no real change |
| errors | 4.00 | 0.00 | 0.00 | 2.00 | no real change |
| cost | 0.07 | 0.20 | 0.00 | 0.00 | over +20 % |

