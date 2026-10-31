# Agent evals — measure an agent before trusting it

Which model should a checker or the verifier run on? Did a prompt edit make an agent better or worse? An agent eval
answers with numbers: run one agent file against a folder of labelled cases and read its recall, precision, cost and
run-to-run noise. The harness lives in the kit (`tools/agent-eval.mjs`); the real cases live in each project, built from
its own labelled findings. The kit ships only small generic cases (`tools/fixtures/agent-evals/`) that prove the
harness works.

## Run it

From the kit checkout (the harness is a kit-side tool; it is not installed into projects):

```bash
node tools/agent-eval.mjs --agent <project>/.claude/agents/orch-check-bugs.md --cases <project>/docs/agent-evals/cases --runs 2
node tools/agent-eval.mjs --agent <agent.md> --cases <dir> --model opus --min-recall 0.9 --min-precision 0.8
```

Validating roles are compared on Sonnet and Opus only; Haiku is never a validator (`models.review` refuses it).

| Flag | Meaning |
| --- | --- |
| `--agent <file>` | The agent definition to measure. Its `name:` picks the case folder, its `model:` is the default model. |
| `--cases <dir>` | The case root. `<dir>/<agent name>/<case>/` is used when it exists, else `<dir>/<case>/`. |
| `--runs N` | Runs per case (default 2). Two or more show the noise. |
| `--model <id>` | Run the same agent file on another model, to compare models on one prompt. |
| `--min-recall x` / `--min-precision y` | Exit 1 when the total is below the threshold (a gate for prompt changes). |
| `--allow-write` | Run an agent that can edit files. Refused by default: an agent without a `tools:` line, or with `Edit`/`Write` in it. |
| `--runner <module.mjs>` | Replace the model call (tests use a stub). Default: Claude Code, `claude -p --output-format json`. |
| `--json` | Print the report as JSON. |

The default runner spends tokens: one non-interactive Claude Code call per case and run, with the agent body (plus
`docs/agent/agent-roles.md` when it sits next to it) as the system prompt and the case input inline as the prompt.
The working directory is the case `input/` folder; there is no git repository there.

## Output

```text
AGENT_EVAL: orch-check-bugs on sonnet, 2 run(s) per case
case             recall  precision  noise  tokens   cost$  errors
off-by-one         1.00       1.00   0.00   18200  0.0710       0
regex-backslash    0.50       1.00   1.00   17950  0.0690       0
-----------------------------------------------------------------
TOTAL              0.75       1.00   0.50   36150  0.1400       0
AGENT_EVAL: ok
```

- **Recall** = found expected items / all expected items, summed over runs and cases. Nothing to find counts as 1.
- **Precision** = found expected items / all reported items. Nothing reported counts as 1.
- **Noise** = how much the runs of one case disagree: 1 − (items every run reported) / (items any run reported).
  0 means every run said the same thing. The total is the mean over cases.
- **Tokens / cost** come from the run result (`usage`, `total_cost_usd`).
- **Errors** are runs whose reply had no valid JSON result (the shared validator, `tools/lib/agent-result.mjs`,
  rejects it). An error run finds nothing, so it lowers recall.

Exit codes: 0 = thresholds met, 1 = below a threshold, 2 = usage error or a refused agent.

## Case shape

```text
<cases>/<agent name>/<case name>/
  input/          what the agent reads: plan.md + diff.patch + the changed files (checker and verifier),
                  candidates.json (verifier), or a page + a card (UI validator)
  expected.json   the label
```

`expected.json` takes one of three forms.

**Findings** (finders such as `orch-check-bugs`, `orch-check-plan`, `orch-check-rules`, `orch-security`):

```json
{
  "note": "Why this is the right answer, for the next person who reads the case.",
  "findings": [
    { "file": "src/paginate.mjs", "line": 4, "rule": "logic", "severity": "major" }
  ]
}
```

A finding matches an expected one when `file`, `rule` and `severity` match and the line is within ±3; the reasoning
text is never compared, so a reworded finding still matches. `rule` matches when it is equal (case and spacing
ignored), or when the expected rule is a bare category without `:` that equals the part before the agent's `:`
(`"logic"` matches `"logic: loop bound is inclusive"`). A list of accepted rules is allowed. Leave `line` out when
any line in the file is right. `"findings": []` marks a correct change: every reported finding is a false alarm.

**Verdicts** (the verifier, `orch-verify`): the candidates are in `input/candidates.json`; the label says which to keep.

```json
{ "verdicts": [ { "id": "bugs-1", "verdict": "keep" }, { "id": "bugs-2", "verdict": "refuted" } ] }
```

A candidate counts as reported when the verifier keeps it with confidence ≥ 80, the same threshold the checker
pipeline uses.

**Pass/fail** (whole-result roles such as the UI validator or the gate): `{ "pass": false }`. The computed `pass` of the
agent's result is compared; an expected failure is one item to find.

## Building a project's case set

1. Take real labelled data: QA findings marked true or false, and a validation run's outcome. About 20 cases is enough
   for a first baseline.
2. One folder per case: the smallest `input/` that still shows the problem (the plan, the diff, the touched files) and
   an `expected.json` with a `note`.
3. Keep correct changes (`"findings": []`) and false alarms (`"refuted"`) in the set, or precision is never tested.
   Every `note` starts with where the label comes from: `fixed by <sha>`, `clean:`, `planted:` or, for a decision the
   Human graded wrong, `human-verdict <YYYY-MM-DD>:` (`docs/agent/decision-review.md`). A `human-verdict` case holds
   project code, so it stays in the project's own case set (beside its baseline); only a generic case goes to the kit.
   A checker miss graded `checker-miss: yes` gets its case scaffolded by `node scripts/decision-log.mjs case --from
   D<n> --run <name>` in the learning step (no model call): `<date>-<kind>/` under the finder's folder, with
   `input/plan.md`, `input/diff.patch`, the touched file, `expected.json` and a `README.md`.
4. Run every candidate model with `--runs 2` or more and record the table in a baseline file next to
   the project's cases (for example a BASELINE.md in its agent-evals docs folder) with the date, the agent file's commit and the model ids.
5. After that, a prompt edit or a model change reruns the set with `--min-recall` / `--min-precision` set from the
   baseline; a drop fails the run.
