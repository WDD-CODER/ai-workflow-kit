# Model routing — which model runs which step

The main session plans, writes code, reviews and decides, on the model the Human picked. Steps that only run
commands or gather evidence go to a sub-agent on a cheaper model; a step whose outcome decides code quality never
moves to a cheaper model.

## Tiers (`kit.config.json` → `models`)

| Tier | This project | Does | Never does |
| --- | --- | --- | --- |
| `mechanical` | `haiku` | Runs the commands it is given and reports in a fixed format | Interpret, fix, retry, judge |
| `analysis` | `sonnet` | Gathers evidence with `file:line` for a question the main session asked | Decide pass/fail of a review, code quality, an architecture question |
| `judgment` | `opus` | The builder that takes over a failed plan, and the first builder of a plan that changes or deviates from an invariant (`preserves` starts on `build`) | — |
| `build` | `sonnet` | Writes the code of one plan on its own branch (`orch-builder`) | Review its own work, merge, message the coordinator |
| `review` | `sonnet` | Validates: the checkers, the verifier, the security and UI validators, the reviewer | Run on Haiku — install and sync refuse it |

`inherit` means the main session's model. `models.judgment` may not inherit (INV-1, `docs/brain/invariants.md`): it
names a model (default `opus`), and install and sync refuse `inherit` and any Haiku value for it. An unset `review`
takes the project's `analysis` value (a Haiku `analysis` gives `sonnet`), so lowering `models.analysis` or
`models.mechanical` never moves a checker. A builder never switches model inside its session: escalation is a fresh
builder on `judgment` (`docs/agent/orchestrator.md`, "The run"); its failure parks the plan for the Human.

| Agent / skill | Tier | Used by |
| --- | --- | --- |
| `.claude/agents/git-agent.md` | mechanical (`omitClaudeMd`) | commit message prep |
| `.claude/skills/github-sync/SKILL.md` (forked) | mechanical | session start |
| `.claude/skills/techdebt/SKILL.md` (forked) | analysis | `/techdebt`, before a PR |
| `/docs-refresh` agent call | analysis | `/docs-refresh` |
| `.claude/agents/orch-builder.md` | build (escalation: judgment) | `scripts/run-plans.mjs` (one headless `claude -p` call per build) |
| `.claude/agents/plan-reviewer.md` | `orchestrator.reviewerModel` (never Haiku) | `scripts/run-plans.mjs`, `/ship` Phase 2 with `review.ship` = `reviewer`, the kit's agent eval |
| `.claude/agents/orch-check-plan.md`, `orch-check-bugs.md`, `orch-check-rules.md`, `orch-verify.md` | review | `/review-it`, `/ship` Phase 2 (checker review on a plan branch; the re-check is `orch-verify` only) |
| `.claude/agents/orch-security.md` | review | `/review-it` and `/ship` Phase 2 (sensitive paths only) |
| `.claude/agents/orch-ui.md` | review | `[ui]` cards no script can check |
| `.claude/agents/skill-judge.md` | review | the nightly skill improver |
| `.claude/agents/styleqa-reviewer.md` | review | `/styleqa` (`.claude/skills/styleqa/SKILL.md`): reads one page's screenshots, at most 3 at once |

Shared contract of the role agents: `docs/agent/agent-roles.md`. Stays on the main model: `/plan` and its Architect +
PM review, `/review`, `/fix`, `/security`, all code writing outside a run (`take-plan`), and every verdict.

## Rules

1. **Never put `model:` on a command or skill that runs inline.** That is a model switch: the turn and the turn after
   it get no cache hits. Route only through a sub-agent (agent file `model:`) or a skill with `context: fork` + `model:`.
2. **Delegate only when the step reads a lot and returns little** (a build log, a sync, a scan). A sub-agent loads
   its own prompt, `CLAUDE.md` (unless the agent sets `omitClaudeMd: true`, Claude Code v2.1.271 or later) and a git
   status; for a step that reads one short file, inline is cheaper.
3. **Escalate, don't guess.** A cheap agent that is unsure puts `ESCALATE: <reason>` on the first line of its reply and
   does not guess the rest; the main session does the escalated part itself.
4. **Re-check what changes the outcome.** An agent result that would skip work or block a merge is re-checked by the
   main session at the cited `file:line` before acting on it.
5. **Hand-off file.** A failed step handed to a fresh agent goes with `.claude/sessions/<session-id>/handoff-<step>.md`:
   `Step`, `Files changed`, `Done` (ticked sub-tasks and changed files, read by the script), `Failed` (failing checks
   with their tail, open findings as `id file:line rule`), `Tried`, `Failing check`, `Output tail`, `Suspected cause`
   (a guess). In a run `orch-state.mjs handoff` writes it. The next agent reads it, the plan and `git diff` — never the
   failed agent's transcript.
6. **Environment overrides.** `CLAUDE_CODE_SUBAGENT_MODEL` (before Claude Code v2.1.251) or
   `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` overrides every agent file's `model:`; SessionStart prints a `MODEL_ROUTING:`
   line when either is set.
