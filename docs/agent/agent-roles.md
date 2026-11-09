# Agent roles — the contract every role agent follows

Each role agent (`.claude/agents/orch-*.md`, `.claude/agents/plan-reviewer.md`) has one job: the builder writes, the
reviewer or the finders look for problems, the verifier confirms them, the UI validator checks `[ui]` cards. They are
separate so that no agent grades its own work, and pinned so that a run always uses the model its config names.
`scripts/run-plans.mjs` runs the builder and the reviewer; `/review-it` (the default `/ship` review) runs the finders
and the verifier. Model tiers and escalation: `docs/agent/model-routing.md`.

## Shared rules (every role agent)

1. **One job.** Do only the job your agent file names. Never start another agent, never take over another role.
2. **Non-interactive.** You cannot ask anyone and you never message the coordinator. When a choice is open, take the
   recommended or most conservative option, do it, and log it in the result's `decisions` list (and, for a builder,
   in the plan's `## Execution Notes`).
3. **Output only through the schema.** Your last message is one fenced `json` block that matches your agent file's
   `## Output` example — nothing after it. Prose before it is ignored.
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
   with `seen:` and names `file:line` (or the page and the steps to see it). A choice the plan did not settle
   (behaviour, wording, a new dialog) starts with `behaviour:`; user-facing behaviour the job takes away is
   `removes: <what users lose> — reverse: <how>`. Those three kinds are the whole of `decisions`: anything else
   (evidence, a rerun, "checked X, fine") goes in your result's own fields — it is dropped from `decisions` and
   only counted. The Human grades them in one reply (`docs/agent/decision-review.md`).
10. **At most 5 items per agent.** An agent that checks a list of items (the UI validator's cards, the verifier's
    candidates) gets at most 5 of them; a longer list goes to further fresh agents, one batch each.
11. **Lessons from earlier runs.** A role's task may carry `LESSONS` (the role's own file under
    `docs/brain/agent-lessons/` — facts a script wrote from earlier runs) and `RULES` (the matching section of
    `docs/brain/agent-rules.md`: `checkers` for the finders and the verifier, `ui`; the builder reads its `builder`
    section itself), each a JSON array of lines (`[]` when there is none). Read `LESSONS` first, as the first numbered
    step of your agent file says. They never replace the plan or the rules. The Planner's own file,
    `agent-lessons/planner.md`, is read by `/plan`'s Architect + PM review. A role never writes a lesson file.

### Deny list

Never run: recursive or forced file deletion from the shell, `git reset` with the hard flag, any forced push
(`--force`, `--force-with-lease` or the short flag), `git clean`, `git branch -D`, `git stash clear`,
`git filter-branch`. Use `git worktree remove`, `git restore`, `git revert` or a new commit instead. A step that
needs one of them returns `blocked` (builder) or `ESCALATE` with the reason.

## Result schema

Common fields: `role` (the agent name), `model`, `effort`, optional `decisions` (strings) and `escalate` (string).

| Role | Required fields | `pass` computed from |
| --- | --- | --- |
| `orch-builder` | `status: built\|blocked\|ESCALATE`, `branch`, `summary`, `evidence[]` (non-empty when built), `blocker` (when not built), optional `ask` (below) | — |
| `orch-check-plan`, `-bugs`, `-rules`, `orch-security` | `problems[]`: `{id, file, line, rule, reasoning, severity}` | no `blocker` / `major` problem |
| `plan-reviewer` | the finder fields above plus `verdict: PASS\|STOP` | `verdict` and `pass`: STOP when any problem is `blocker` / `major` |
| `orch-verify` | `verdicts[]`: `{id, verdict: keep\|refuted, confidence: 0–100, refutation?, severity}` (`refutation` when refuted) | no kept `blocker` / `major` with confidence ≥ 80 |
| `orch-ui` | `cards[]`: `{card, status: pass\|fail\|plan-drift, screenshots[]}` | every card `pass` |

### The builder's question (`ask`)

A builder result that is `ESCALATE` or `blocked` may carry the question the run asks for it:
`"ask": { "kind": "<kind>", "question": "<one sentence>", "options": ["<option>", …], "recommendation": <1-based n> }`.
A `blocker` that starts `ESCALATE: <kind> …` names the kind too (`ESCALATE: db-write <command>`). Kinds only the Human
answers: `data`, `privacy`, `product`, `design`, `production`, `spend`, `decision-stale`, `db-write`. Kinds the Human or
the advisor answers: `scope`, `technical`, `environment`, `review`. A question with no kind (or another word) is
Human-only. For `scope`, an option `approved: <path>, <path>` adds those paths to the plan's scope when chosen; an option
that starts `park:` leaves the plan parked. The run writes the ask file and, once answered, resumes the plan with the
answer as `ANSWER` in the task (`docs/agent/orchestrator.md` "Asks").

`plan-reviewer` is the single reviewer of `run-plans.mjs`: one agent reads the plan's criteria, the diff and the gate
receipt, and returns the finder schema with a `verdict`. It replaces the checker pipeline in `/ship` only when
`review.ship` is set to `reviewer`.

Severity: `blocker` (wrong result, data loss, a security hole, a broken build), `major` (a requirement of the plan not
met, a real bug on a likely path), `minor` (a real but unlikely or cosmetic defect), `nit` (style). Only `blocker` and
`major` fail a result.

## Checker pipeline

Used by `/review-it`, which `/ship` runs while `review.ship` is `checkers`.

1. **Three narrow finders in parallel**, each on the diff against the base branch only:
   `orch-check-plan` (does the diff do what the plan says, and only that), `orch-check-bugs` (logic and runtime bugs
   in changed lines), `orch-check-rules` (the hard rules in `AGENTS.md` and the project standards).
   `orch-security` runs too when the diff touches a sensitive path (the project's `security.sensitivePaths`, auth,
   guards, secrets handling); otherwise it is skipped.
2. **Verifier** (`orch-verify`) gets every candidate and tries to refute it against the code. It drops a candidate
   only with a concrete refutation (`file:line` or a command result that shows the claim is wrong). A candidate it
   cannot refute is kept, with a confidence 0–100. It also gets `GATE` (the gate results with a 20-line tail):
   evidence for keeping or refuting, never a verdict on pass.
3. **Threshold:** only kept candidates with confidence ≥ 80 are reported.
4. **Do not report:** issues that existed before the diff; lines the diff did not change; anything lint, typecheck or
   the build already catch; pedantic nits; changes that look intentional (named in the plan or a commit message).
5. **Models:** the finders, `orch-security`, the verifier and the UI validator run on the `review` tier
   (`models.review`, default `sonnet`; never Haiku — install and sync refuse it).
6. **Mechanical checks stay with the gate.** Finders do not run the build, lint or the test suite to find problems;
   the gate (`node scripts/ship-prep.mjs --gate` in `/review-it`, `plan-gate.mjs` in a run) does, and its failures
   are reported as they are.

## Hand-off between builders

A builder that stops (`blocked` or `ESCALATE`) writes the hand-off file from `docs/agent/model-routing.md` rule 5
before it returns. The next builder reads that file, the plan and `git diff` — never the first builder's transcript.
