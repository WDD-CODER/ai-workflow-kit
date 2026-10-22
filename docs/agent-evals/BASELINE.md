# Agent-eval baseline — the kit's checkers and verifier

Date: 2026-10-22 · Kit base: `9173793` (main) on branch `feat/021-kit-eval-baseline` · Agent prompts: the installed
`.claude/agents/orch-check-bugs.md`, `orch-check-plan.md`, `orch-check-rules.md`, `orch-verify.md` (bodies unchanged
since `9f99049`; only the `model:` source line moved to `models.review` in plan 021) · Claude Code 2.1.307 ·
Models: `--model opus` and `--model sonnet` (aliases, resolved by Claude Code). Haiku is never a validator (Human rule
2026-10-22), so it is not measured.

Cases: `docs/agent-evals/cases/` — 25 cases (bugs 14, plan 5, rules 3, verify 3), each labelled by a fix commit and
its test (`fixed by <sha>`), a plan that passed with no finding (`clean:`) or a planted bug (`planted:`). Every run:
`node tools/agent-eval.mjs --agent .claude/agents/<role>.md --cases docs/agent-evals/cases --runs 2 --model <m> --json`,
one at a time; the raw reports are in `docs/agent-evals/runs/<role>.<model>.json`.

## Results (2 runs per case)

Tokens include cache reads (Claude Code's `usage`), so they are far above the prompt size; cost is
`total_cost_usd`.

### orch-check-bugs

| Model | Recall | Precision | Noise | Tokens | Cost (USD) | Errors | Cases × runs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| opus | 0.13 | 0.06 | 0.88 | 7396231 | 8.05 | 0 | 14 × 2 |
| sonnet | 0.13 | 0.09 | 0.62 | 4384789 | 3.39 | 0 | 14 × 2 |

### orch-check-plan

| Model | Recall | Precision | Noise | Tokens | Cost (USD) | Errors | Cases × runs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| opus | 0.10 | 0.07 | 0.40 | 1720375 | 1.71 | 2 | 5 × 2 |
| sonnet | 0.30 | 0.38 | 0.20 | 1308679 | 0.73 | 0 | 5 × 2 |

### orch-check-rules

| Model | Recall | Precision | Noise | Tokens | Cost (USD) | Errors | Cases × runs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| opus | 0.00 | 0.00 | 0.33 | 1050525 | 1.22 | 0 | 3 × 2 |
| sonnet | 0.25 | 0.25 | 0.67 | 780467 | 0.57 | 0 | 3 × 2 |

### orch-verify

| Model | Recall | Precision | Noise | Tokens | Cost (USD) | Errors | Cases × runs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| opus | 0.33 | 1.00 | 0.00 | 2182052 | 2.25 | 0 | 3 × 2 |
| sonnet | 0.33 | 1.00 | 0.00 | 1193229 | 2.08 | 0 | 3 × 2 |

### Cheapest model within 0.05 of the best

| Role | Pick | Best recall / precision | Models within 0.05 (cost) |
| --- | --- | --- | --- |
| orch-check-bugs | sonnet | 0.13 / 0.09 | sonnet (3.39 USD), opus (8.05 USD) |
| orch-check-plan | sonnet | 0.30 / 0.38 | sonnet (0.73 USD) |
| orch-check-rules | sonnet | 0.25 / 0.25 | sonnet (0.57 USD) |
| orch-verify | sonnet | 0.33 / 1.00 | sonnet (2.08 USD), opus (2.25 USD) |

On these numbers Sonnet is the pick for every role: it is never worse than Opus by more than 0.05 and costs 7–58 %
less. Opus is not measurably better on any role.

## Read these numbers with care

- **The scorer is stricter than the agents' wording.** A finding matches only when `severity` is equal and the rule's
  category (the text before `:`) is in the label's list. A diagnostic rerun (Sonnet, one run, raw reply kept) of
  `planted-inverted-comparison` found the exact planted line — `core/scripts/orch-preflight.mjs:59`, rule
  `wrong result: inverted condition` — but rated it `blocker` where the label says `major`, and used the category
  `wrong result` (the agent prompt's own heading) where the label lists `logic`. It scored recall 0, precision 0.
  The same pattern (the runs report findings, none match) shows on most bug and rules cases, so recall and precision
  here measure "found it **and** worded severity and category like the label", not detection alone.
- **Real misses exist too.** On `fixed-010-empty-lockfile` the same diagnostic Sonnet run reported nothing; the
  verifier on both models did not keep the real finding (confidence ≥ 80) in `fixed-010-…` and `fixed-017-…`, while it
  refuted every false alarm (precision 1.00).
- **Errors:** `orch-check-plan` on Opus returned invalid JSON twice on `fixed-010-scope-and-done-when`
  ("Unterminated string in JSON"), which counts as finding nothing.
- **Small set:** 3–14 cases per role and 2 runs each; one case moves a role's recall by 0.07–0.33.
- **Real-code cases can hold unlabelled real problems** (later commits fixed more guard and orchestrator issues);
  those count as false alarms here.

## Per case (recall / precision)

orch-check-bugs on opus: clean-011-plan-graph 1.00/0.00 · clean-013-agent-result 1.00/0.00 · fixed-010-empty-lockfile 0.00/0.00 · fixed-014-status-race 0.00/0.00 · fixed-017-cd-unknown-folder 0.00/0.00 · fixed-017-stale-worktree-plan 0.00/0.00 · fixed-017-windows-short-path 0.00/0.00 · fixed-018-ui-items-capital-x 0.00/0.00 · fixed-sec-diff-unread-fails-open 0.00/0.00 · planted-allow-all-check 0.00/0.00 · planted-inverted-comparison 0.00/0.00 · planted-lost-escape 0.00/0.00 · planted-off-by-one 1.00/1.00 · planted-unchecked-error 0.50/0.25

orch-check-bugs on sonnet: clean-011-plan-graph 1.00/1.00 · clean-013-agent-result 1.00/1.00 · fixed-010-empty-lockfile 0.00/1.00 · fixed-014-status-race 0.00/1.00 · fixed-017-cd-unknown-folder 0.00/0.00 · fixed-017-stale-worktree-plan 0.00/0.00 · fixed-017-windows-short-path 0.00/0.00 · fixed-018-ui-items-capital-x 0.50/0.33 · fixed-sec-diff-unread-fails-open 0.00/0.00 · planted-allow-all-check 0.00/0.00 · planted-inverted-comparison 0.00/0.00 · planted-lost-escape 0.00/0.00 · planted-off-by-one 1.00/1.00 · planted-unchecked-error 0.00/0.00

orch-check-plan on opus: clean-019-compare-and-score 1.00/1.00 · fixed-010-scope-and-done-when 0.00/1.00 (2 errors) · fixed-014-report-by-page 0.50/0.50 · fixed-018-ui-items-not-held 0.00/0.00 · planted-ticked-subtask-missing 0.00/0.00

orch-check-plan on sonnet: clean-019-compare-and-score 1.00/1.00 · fixed-010-scope-and-done-when 0.50/1.00 · fixed-014-report-by-page 0.50/0.25 · fixed-018-ui-items-not-held 0.00/1.00 · planted-ticked-subtask-missing 0.00/0.00

orch-check-rules on opus: clean-019-compare 1.00/1.00 · planted-hardcoded-port 0.00/0.00 · planted-installed-copy-edited 0.00/0.00

orch-check-rules on sonnet: clean-019-compare 1.00/1.00 · planted-hardcoded-port 0.00/0.00 · planted-installed-copy-edited 0.50/0.50

orch-verify on opus: fixed-010-lockfile-and-false-alarms 0.00/1.00 · fixed-017-short-path-and-home 0.00/1.00 · fixed-018-capital-x-and-crlf 1.00/1.00

orch-verify on sonnet: fixed-010-lockfile-and-false-alarms 0.00/1.00 · fixed-017-short-path-and-home 0.00/1.00 · fixed-018-capital-x-and-crlf 1.00/1.00

## Next

- The Human picks the default model per role (plan 021's `[human]` item); `models.review` stays `sonnet` until then.
- Before the numbers gate prompt changes (`--min-recall` / `--min-precision`), the scorer or the labels need a
  severity tolerance (`blocker` ≈ `major`) and the agent prompts' own categories (`wrong result`, `crash`,
  `broken contract`, `error handling`) in the bug labels; then rerun this set. That is a harness change outside
  plan 021's scope.
