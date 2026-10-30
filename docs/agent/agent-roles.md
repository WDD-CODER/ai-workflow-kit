# Agent roles — the contract every role agent follows

The orchestrator runs each plan through separate role agents (`.claude/agents/orch-*.md`): a builder writes, a gate
runs the checks, finders look for problems, a verifier confirms them, a merger merges, a reporter writes the report.
They are separate so that no agent grades its own work, and pinned so that a run always uses the model its config
names. `/review-it` uses the same finders and verifier. Model tiers and escalation: `docs/agent/model-routing.md`.

## Shared rules (every role agent)

1. **One job.** Do only the job your agent file names. Never start another agent, never take over another role.
2. **Non-interactive.** You cannot ask anyone and you never message the coordinator. When a choice is open, take the
   recommended or most conservative option, do it, and log it in the result's `decisions` list (and, for a builder,
   in the plan's `## Execution Notes`).
3. **Output only through the schema.** Your last message is one fenced `json` block that matches your agent file's
   `## Output` example — nothing after it. Prose before it is ignored by the orchestrator.
4. **Evidence for every claim.** Each problem, each pass and each "done" carries `file:line` or a command with its
   exit code and the output lines that show it. A claim without evidence is dropped.
5. **Echo your model and effort.** Every result carries `model` (the model id you actually run on, from your system
   prompt — not the tier name) and `effort`. A result without them is rejected.
6. **Never trust your own pass flag.** Where a result has `pass`, it must equal what the problem list says: `false`
   when any kept problem is `blocker` or `major`. The validator computes it and rejects a result that disagrees.
7. **Only commands off the deny list** (below). Delete a scratch file with
   `node -e "require('fs').rmSync('<file>')"` inside your own worktree or the OS temp folder only.
8. **Long output goes to a file.** Redirect it and read the tail; never start a process that keeps running after
   your step.
9. **Seen but not fixed.** A defect you notice outside your job is never free text: add a `decisions` entry that starts
   with `seen:` and names `file:line` (or the page and the steps to see it). The run report lists it with the other
   decisions, so the Human grades it in the same reply (`docs/agent/decision-review.md`). A choice the plan did not
   settle (behaviour, wording, a new dialog) is logged the same way, starting with `behaviour:`. Those two kinds are
   the whole of `decisions`: anything else you want to say (evidence, a rerun, "checked X, fine") goes in your
   result's own fields, never in `decisions` — the orchestrator drops it there and only counts it.
10. **At most 5 items per agent.** An agent that checks a list of items (the UI validator's cards, the verifier's
    candidates) gets at most 5 of them; a longer list goes to further fresh agents, one batch each. Accuracy drops on a
    long list — the orchestrator splits the UI cards into batches of 5. One exception: `orch-triage` sorts a run's whole
    decision list in one call. It does not prove each item, only orders and labels them; the code re-applies the hard
    rules to every verdict.

### Deny list

Never run: recursive or forced file deletion from the shell, `git reset` with the hard flag, any forced push
(`--force`, `--force-with-lease` or the short flag), `git clean`, `git branch -D`, `git stash clear`,
`git filter-branch`. Use `git worktree remove`, `git restore`, `git revert` or a new commit instead. A step that
needs one of them returns `blocked` (builder) or `ESCALATE` with the reason.

## Result schema

Common fields: `role` (the agent name), `model`, `effort`, optional `decisions` (strings) and `escalate` (string).

| Role | Required fields | `pass` computed from |
| --- | --- | --- |
| `orch-readiness` | `plans[]`: `{plan, state: ready\|questions\|blocked, questions[], envNeeds[], commands[]}` | — |
| `orch-builder` | `status: built\|blocked\|ESCALATE`, `branch`, `summary`, `evidence[]` (non-empty when built), `blocker` (when not built) | — |
| `orch-gate` | `results[]`: `{command, status: pass\|fail\|env-fail, tail?}` (`tail` on fail) | every result `pass` |
| `orch-check-plan`, `-bugs`, `-rules`, `orch-security` | `problems[]`: `{id, file, line, rule, reasoning, severity}` | no `blocker` / `major` problem |
| `orch-verify` | `verdicts[]`: `{id, verdict: keep\|refuted, confidence: 0–100, refutation?, severity}` (`refutation` when refuted) | no kept `blocker` / `major` with confidence ≥ 80 |
| `orch-ui` | `cards[]`: `{card, status: pass\|fail\|plan-drift, screenshots[]}` | every card `pass` |
| `orch-merge` | `merged` (boolean), `sha` when merged, `reason` when not, optional `envFailure` | — |
| `orch-report` | `report` (the final report text) | — |
| `orch-triage` | `items[]`: `{id, verdict: accept\|ask\|follow-up\|noise, kind, recommendation ≤160, why ≤120, confidence: 0–100, duplicateOf?}` | — (the code re-applies the hard rules) |

Severity: `blocker` (wrong result, data loss, a security hole, a broken build), `major` (a requirement of the plan not
met, a real bug on a likely path), `minor` (a real but unlikely or cosmetic defect), `nit` (style). Only `blocker` and
`major` fail a result.

## Checker pipeline

Used by the orchestrator after the gate passes, and by `/review-it`.

1. **Three narrow finders in parallel**, each on the diff against the base branch only:
   `orch-check-plan` (does the diff do what the plan says, and only that), `orch-check-bugs` (logic and runtime bugs
   in changed lines), `orch-check-rules` (the hard rules in `AGENTS.md` and the project standards).
   `orch-security` runs too when the diff touches a sensitive path (the project's `security.sensitivePaths`, auth,
   guards, secrets handling); otherwise it is skipped.
2. **Verifier** (`orch-verify`) gets every candidate and tries to refute it against the code. It drops a candidate
   only with a concrete refutation (`file:line` or a command result that shows the claim is wrong). A candidate it
   cannot refute is kept, with a confidence 0–100.
3. **Threshold:** only kept candidates with confidence ≥ 80 are reported.
4. **Do not report:** issues that existed before the diff; lines the diff did not change; anything lint, typecheck or
   the build already catch; pedantic nits; changes that look intentional (named in the plan or a commit message).
5. **Models:** the finders, `orch-security`, the verifier and the UI validator run on the `review` tier
   (`models.review`, default `sonnet`; never Haiku — install and sync refuse it). The kit's measured
   baseline (its own eval cases) found Opus no better than Sonnet on these roles. The security reviewer
   runs only on sensitive paths.
6. **Mechanical checks stay with the gate.** Finders do not run the build, lint or the test suite to find problems;
   the gate (`orch-gate`, or `kit-runner` in `/review-it`) does, and its failures are reported as they are.

## Hand-off between builders

A builder that stops (`blocked` or `ESCALATE`) writes the hand-off file from `docs/agent/model-routing.md` rule 5
before it returns. The next builder reads that file, the plan and `git diff` — never the first builder's transcript.
