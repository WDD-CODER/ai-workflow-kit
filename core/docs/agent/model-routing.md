# Model routing — which model runs which step

The main session plans, writes code, reviews and decides, on the model the Human picked. Steps that only run
commands or gather evidence go to a sub-agent on a cheaper model. The goal is fewer tokens with the same result:
a step whose outcome decides code quality never moves to a cheaper model.

## Tiers (`kit.config.json` → `models`)

| Tier | This project | Does | Never does |
| --- | --- | --- | --- |
| `mechanical` | `{{models.mechanical}}` | Runs the commands it is given and reports exit codes and error lines in a fixed format | Interpret, fix, retry, judge |
| `analysis` | `{{models.analysis}}` | Gathers evidence with `file:line` for a question the main session asked | Decide pass/fail of a review, code quality, an architecture question |
| `judgment` | `{{models.judgment}}` | Roles that decide (orchestrator reviewer and implementer roles) | — |

`inherit` means the main session's model. All three set to `inherit` turns the routing off.

| Agent / skill | Tier | Used by |
| --- | --- | --- |
| `.claude/agents/kit-runner.md` | mechanical | `/ship` Phase 1, `auto-solve` Phase 4, `/review-it` step 3 |
| `.claude/agents/kit-prevalidate.md` | analysis | `auto-solve` Phase 2 |
| `.claude/agents/git-agent.md` | mechanical | commit message prep |
| `.claude/skills/github-sync/SKILL.md` (forked) | mechanical | session start |
| `.claude/skills/techdebt/SKILL.md` (forked) | analysis | `/techdebt`, before a PR |
| `/docs-refresh` agent call | analysis | `/docs-refresh` |

Stays on the main model: `/plan` and its Architect + PM review, `/review`, `/fix`, `/security`, all code writing
(`take-plan`, `auto-solve` Phase 3), and every verdict.

## Rules

1. **Never put `model:` on a command or skill that runs inline.** That is a model switch: the turn and the turn
   after it get no cache hits, so the whole conversation is re-read at full price twice. Route only through a
   sub-agent (agent file `model:`) or a skill with `context: fork` + `model:`.
2. **Delegate only when the step reads a lot and returns little** (a build log, a sync, a scan). A sub-agent starts
   empty and loads its own prompt, `CLAUDE.md` (unless the agent sets `omitClaudeMd: true`) and a git status; for a
   step that reads one short file, doing it inline is cheaper.
3. **Escalate, don't guess.** A cheap agent that is unsure puts `ESCALATE: <reason>` on the first line of its reply
   (with whatever partial result its format allows) and does not guess the rest. The main session then does the
   escalated part itself.
4. **Re-check what changes the outcome.** An agent result that would skip work (a `DONE` row) or block a merge is
   re-checked by the main session at the cited `file:line` before acting on it.
5. **Hand-off file.** When an agent hands a failed step to the next agent (a cheap one to a stronger one), it writes
   `.claude/sessions/<session-id>/handoff-<step>.md` with exactly these fields:

   ```text
   Step:            <plan step or task>
   Files changed:   <paths>
   Tried:           <what was attempted, in order>
   Failing check:   <command> → exit <n>
   Output tail:     <last lines of that command's output, verbatim>
   Suspected cause: <the agent's guess — marked as a guess>
   ```

   The next agent reads this file, the plan and `git diff` — never the failed agent's transcript. The diff and a
   fresh run of the failing check are the truth; the suspected cause is only a hint.
6. **Environment overrides.** `CLAUDE_CODE_SUBAGENT_MODEL` (on Claude Code before v2.1.251) or
   `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` overrides every agent file's `model:`. SessionStart prints a
   `MODEL_ROUTING:` line when either is set.
7. **Commands whose output is the result.** A check that prints warnings and exits 0 (`scope-check --arch`, a log
   query, `plan-ledger-check`) is handed to `kit-runner` marked `[capture]`, so its output comes back even on exit 0.
