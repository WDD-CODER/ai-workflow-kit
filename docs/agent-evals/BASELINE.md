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

Relabel (checker round 1, 19:08–20:08): the orch-check-bugs labels now also accept the agent prompt's own categories
(`wrong result(s)`, `crash(es)`, `broken contract(s)`, `error handling` — the headings of
`core/.claude/agents/orch-check-bugs.md` "Look for"), each label only the ones that fit its bug, and
`fixed-sec-diff-unread-fails-open` gained its second 35140fb finding (`--root` / unknown flags, line 71). The two
orch-check-bugs runs were redone on that label set; the other six roles' labels did not change, so their runs stand.

## Results (2 runs per case)

Tokens include cache reads (Claude Code's `usage`), so they are far above the prompt size; cost is
`total_cost_usd`.

### orch-check-bugs

| Model | Recall | Precision | Noise | Tokens | Cost (USD) | Errors | Cases × runs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| opus | 0.19 | 0.12 | 0.77 | 8116146 | 9.86 | 3 | 14 × 2 |
| sonnet | 0.27 | 0.22 | 0.57 | 4372426 | 3.03 | 1 | 14 × 2 |

Before the relabel both models scored recall 0.13 (precision opus 0.06, sonnet 0.09).

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
| orch-check-bugs | sonnet | 0.27 / 0.22 | sonnet (3.03 USD) |
| orch-check-plan | sonnet | 0.30 / 0.38 | sonnet (0.73 USD) |
| orch-check-rules | sonnet | 0.25 / 0.25 | sonnet (0.57 USD) |
| orch-verify | sonnet | 0.33 / 1.00 | sonnet (2.08 USD), opus (2.25 USD) |

On these numbers Sonnet is the pick for every role. On orch-check-bugs it is now ahead of Opus (recall 0.27 vs 0.19,
precision 0.22 vs 0.12) at 31 % of the cost; on the other roles it is never worse than Opus by more than 0.05 and costs
7–58 % less. Opus is not measurably better on any role.

## Read these numbers with care

- **The scorer is stricter than the agents' wording.** A finding matches only when `severity` is equal and the rule's
  category (the text before `:`) is in the label's list. Before the relabel, a diagnostic rerun (Sonnet, one run, raw
  reply kept) of `planted-inverted-comparison` found the exact planted line — `core/scripts/orch-preflight.mjs:59`,
  rule `wrong result: inverted condition` — and scored 0 on the category; the bug labels now accept the prompt's
  categories, so that mismatch is gone. Severity is still compared exactly: the same run rated it `blocker` where the
  label says `major`, so `planted-inverted-comparison` still scores 0 on both models. Recall and precision here
  still mean "found it **and** rated its severity like the label".
- **Real misses exist too.** On `fixed-010-empty-lockfile` the same diagnostic Sonnet run reported nothing; the
  verifier on both models did not keep the real finding (confidence ≥ 80) in `fixed-010-…` and `fixed-017-…`, while it
  refuted every false alarm (precision 1.00).
- **Errors:** `orch-check-plan` on Opus returned invalid JSON twice on `fixed-010-scope-and-done-when`
  ("Unterminated string in JSON"), which counts as finding nothing. The relabelled orch-check-bugs runs had 3 errors on
  Opus (`clean-013-agent-result` ×2, `fixed-018-ui-items-capital-x` ×1) and 1 on Sonnet (`clean-013-agent-result`,
  "Unterminated string in JSON"), counted the same way.
- **Small set:** 3–14 cases per role and 2 runs each; one case moves a role's recall by 0.07–0.33.
- **Real-code cases can hold unlabelled real problems** (later commits fixed more guard and orchestrator issues);
  those count as false alarms here.

## Per case (recall / precision)

orch-check-bugs on opus: clean-011-plan-graph 1.00/0.00 · clean-013-agent-result 1.00/1.00 (2 errors) · fixed-010-empty-lockfile 0.00/1.00 · fixed-014-status-race 0.00/0.00 · fixed-017-cd-unknown-folder 0.50/0.25 · fixed-017-stale-worktree-plan 0.00/0.00 · fixed-017-windows-short-path 0.00/0.00 · fixed-018-ui-items-capital-x 0.50/0.50 (1 error) · fixed-sec-diff-unread-fails-open 0.00/0.00 · planted-allow-all-check 0.00/0.00 · planted-inverted-comparison 0.00/0.00 · planted-lost-escape 0.50/0.33 · planted-off-by-one 1.00/1.00 · planted-unchecked-error 0.00/0.00

orch-check-bugs on sonnet: clean-011-plan-graph 1.00/1.00 · clean-013-agent-result 1.00/1.00 (1 error) · fixed-010-empty-lockfile 0.00/1.00 · fixed-014-status-race 0.00/0.00 · fixed-017-cd-unknown-folder 0.00/0.00 · fixed-017-stale-worktree-plan 0.50/1.00 · fixed-017-windows-short-path 0.00/0.00 · fixed-018-ui-items-capital-x 1.00/1.00 · fixed-sec-diff-unread-fails-open 0.00/0.00 · planted-allow-all-check 0.00/0.00 · planted-inverted-comparison 0.00/0.00 · planted-lost-escape 1.00/1.00 · planted-off-by-one 1.00/1.00 · planted-unchecked-error 0.00/0.00

orch-check-plan on opus: clean-019-compare-and-score 1.00/1.00 · fixed-010-scope-and-done-when 0.00/1.00 (2 errors) · fixed-014-report-by-page 0.50/0.50 · fixed-018-ui-items-not-held 0.00/0.00 · planted-ticked-subtask-missing 0.00/0.00

orch-check-plan on sonnet: clean-019-compare-and-score 1.00/1.00 · fixed-010-scope-and-done-when 0.50/1.00 · fixed-014-report-by-page 0.50/0.25 · fixed-018-ui-items-not-held 0.00/1.00 · planted-ticked-subtask-missing 0.00/0.00

orch-check-rules on opus: clean-019-compare 1.00/1.00 · planted-hardcoded-port 0.00/0.00 · planted-installed-copy-edited 0.00/0.00

orch-check-rules on sonnet: clean-019-compare 1.00/1.00 · planted-hardcoded-port 0.00/0.00 · planted-installed-copy-edited 0.50/0.50

orch-verify on opus: fixed-010-lockfile-and-false-alarms 0.00/1.00 · fixed-017-short-path-and-home 0.00/1.00 · fixed-018-capital-x-and-crlf 1.00/1.00

orch-verify on sonnet: fixed-010-lockfile-and-false-alarms 0.00/1.00 · fixed-017-short-path-and-home 0.00/1.00 · fixed-018-capital-x-and-crlf 1.00/1.00

## Next

- The Human picks the default model per role (plan 021's `[human]` item); `models.review` stays `sonnet` until then.
- Before the numbers gate prompt changes (`--min-recall` / `--min-precision`), the scorer or the labels need a
  severity tolerance (`blocker` ≈ `major`); then rerun this set. That is a harness change outside plan 021's scope
  (the prompt's categories are already in the bug labels).
