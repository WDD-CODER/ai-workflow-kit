# Plan 012 — Model Routing Per Task: Shared Model Tiers, Cheap Agents for Mechanical Work

Status: done
Snapshot: 53ca2c6

## Problem Statement
Every kit command runs inline in the main session, on whatever model the Human picked for it (usually the strongest).
Mechanical work — running the build, reading long command output, a once-a-day git sync, counting tech-debt markers,
drafting a commit message — is paid at the price of judgment work. Only `auto-solve.md` Phase 3 and `docs-refresh.md`
spawn agents, and both inherit the main model. `git-agent.md` names no model.

Two facts from the Claude Code docs shape the fix (sub-agents, skills, prompt-caching pages, read 2026-10-21):
- A `model:` on a command or skill that runs **inline** is a model switch: that turn and the turn after it get no
  cache hits, so the whole conversation is re-read at full price twice. Routing must therefore go through
  sub-agents (agent frontmatter `model:` / `effort:`, or a skill with `context: fork` + `model:`), never through
  `model:` on an inline command.
- A sub-agent starts with an empty context: its own prompt, the delegation prompt, `CLAUDE.md` (unless
  `omitClaudeMd: true`) and a git status snapshot. Only its final message returns. It pays off when the task reads a
  lot and returns little; for a small task the start-up load costs more than it saves.

The orchestrator plans (013, 014; parallel session) need the same per-role model choice. One shared mechanism is
needed so a project changes a model in one place, and so the two workflows never define models two ways.

## Prerequisites
- none. Independent of 011 (`plan-order`, different files). 013/014 build on this plan.

## Goals & Success Criteria
**Primary:** mechanical steps of the regular Planner/Worker workflow run on a cheaper model through sub-agents, with no
change to the model that plans, writes code, reviews or fixes, and with one config key that every kit agent uses.

- [auto] `node tools/install-check.mjs` passes, with fixtures that render `{{models.*}}` from the defaults and from a
  project value, and a fixture where an invalid value (`gpt-4`) makes install refuse with a message naming the key.
- [auto] `node tools/leak-check.mjs`, `pack-check`, `e2e-check`, `workflow-link-check`, `acceptance-check --e2e` pass.
- [auto] With every tier set to `inherit`, the rendered agent and skill files carry `model: inherit` only — the
  routing is off and behaviour equals today's.
- [auto] `grep -rn "^model:" core/.claude/commands/` finds nothing: no inline command switches models.
- [auto] SessionStart prints `MODEL_ROUTING: CLAUDE_CODE_SUBAGENT_MODEL=<v> overrides the kit's agent models` when
  that variable is set, and `... _FORCE=1 ...` when the force variable is set; prints nothing otherwise.
- [human] In FoodVibe after the sync, on the same work (one `github-sync`, one `/ship` REGULAR, one `/review-it`):
  the results match a run with all tiers `inherit` (same lane, same build/lint verdict, same review findings), and
  `/usage` shows less spend than that run. Dandan compares the two.

## Execution Mode
- Parallel: yes — 011 edits `plan-order` files only.
- Concurrent plans: 011.
- Isolated DB: no.
- Kit edits: kit branch `feat/012-model-routing-per-task` + kit PR; Dandan merges and gives the go for the release
  (minor: new config key and new agent files, existing projects keep working).

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`.

```scope
kit.config.json
tools/lib/kit.mjs
tools/install-check.mjs
core/.claude/agents/**
core/.claude/commands/auto-solve.md
core/.claude/commands/review-it.md
core/.claude/commands/ship.md
core/.claude/commands/docs-refresh.md
core/.claude/skills/github-sync/SKILL.md
core/.claude/skills/techdebt/SKILL.md
core/docs/agent/ship-regular.md
core/docs/agent/workflow-map.md
core/docs/agent/model-routing.md
core/scripts/session-startup.sh
templates/CLAUDE.md
CHANGELOG.md
```

## Read Scope
Kit repo; FoodVibe's rendered copies of the files above (read only, for the [human] comparison).

## Escalation Protocol
Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry. Project sync `conflict` rows: STOP, never `--force`. Tags and releases: wait
for Dandan's go.

## Architecture Impact
- INV-none: preserves — kit workflow files and install tooling; projects get them through `kit-sync`. No app, server
  or schema file. The Planner/Worker roles and their models are unchanged.

## Step 0 — Reality Check
Re-read `auto-solve.md` Phase 2–4, `ship.md` Phase 1, `review-it.md` step 3 and `ship-regular.md` Phase 2 on
`origin/main`; if 008, 009 or 010 merged changes there, apply the steps below to that text.

## Functional Requirements
1. **Config key `models`** in `kit.config.json`: `mechanical` (default `haiku`), `analysis` (default `sonnet`),
   `judgment` (default `inherit`). Documented in the `$comment`. Valid value: `haiku`, `sonnet`, `opus`, `fable`,
   `inherit`, or a full model id starting `claude-`. `tools/lib/kit.mjs` refuses anything else at install and sync,
   like the `ci.*` modes. `judgment` is used by no file in this plan; it exists for the orchestrator roles (013).
2. **Routing doc** `core/docs/agent/model-routing.md` (one screen), the single rule source both workflows cite:
   - the three tiers and what each may do: `mechanical` runs commands and reports facts in a fixed format;
     `analysis` gathers evidence with file:line; neither decides code quality, pass/fail of a review, or an
     architecture question — the main session does;
   - never `model:` on an inline command or skill (cache break both ways); route only through sub-agents;
   - delegate only when the task reads a lot and returns little;
   - **escalation:** a cheap agent that is unsure returns `ESCALATE: <reason>` as its first line and stops; the main
     session then does the task itself;
   - **re-check rule:** any agent result that would skip work (`DONE`) or block a merge is re-checked by the main
     session at the cited file:line before acting on it;
   - **escalation hand-off file** (also used by 013's implementer escalation): `.claude/sessions/<id>/handoff-<step>.md`
     with exactly: step, files changed, what was tried, the failing check's command + exit code + output tail, the
     agent's suspected cause (marked as a guess). The next agent reads this file, the plan and the `git diff`, never the
     failed agent's transcript; the diff and the re-run check are the truth, the guess is a hint.
3. **Agent `kit-runner`** (`core/.claude/agents/kit-runner.md`): `model: {{models.mechanical}}`, `effort: low`,
   `tools: Bash, Read`, `omitClaudeMd: true`. Runs the commands it is given, in order, and returns one block:
   `RUN: <cmd> → exit <n>` per command plus, on a failure, the error lines verbatim (at most 40 per command). Never
   edits, never retries, never interprets.
4. **Agent `kit-prevalidate`** (`core/.claude/agents/kit-prevalidate.md`): `model: {{models.analysis}}`,
   `effort: medium`, `tools: Read, Grep, Glob, Bash`. Given the plan's checkboxes, returns auto-solve's
   DONE/TODO/BLOCKED table with file:line evidence; `ESCALATE` when a row needs a judgment call.
5. **`git-agent.md`**: add `model: {{models.mechanical}}`, `effort: low`.
6. **Commands use the agents** (text changes only; logic and gates unchanged):
   - `ship.md` Phase 1: `kit-runner` runs the build and `plan-ledger-check`; the main session acts on its block.
     The header's "No subagent spawns" becomes "only `kit-runner` for the build gate; review and approvals inline".
   - `auto-solve.md` Phase 2 (code-inspection part; the UI-detection browser step stays inline) → `kit-prevalidate`,
     with the re-check rule on every `DONE` row; Phase 3's parallel Agent calls name `model: "inherit"` explicitly;
     Phase 4 build/lint → `kit-runner`.
   - `review-it.md` step 3: `kit-runner` runs the Verify command, `scope-check --arch` and the log query; plan-match,
     conventions, secrets and dead code stay inline. Verdict stays inline.
   - `docs-refresh.md`: the Agent call passes `model: "{{models.analysis}}"`; `subagent_type` stays.
7. **Skills run forked**: `github-sync` and `techdebt` get `context: fork` + `model:` (`mechanical` for github-sync,
   `analysis` for techdebt). github-sync's "offer branches for deletion" and "DIRTY → ask" become "return the list /
   the stop reason"; the main session asks the Human (a fork cannot ask).
8. **Startup warning** in `session-startup.sh`: one `MODEL_ROUTING:` line when `CLAUDE_CODE_SUBAGENT_MODEL` or
   `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is set (either one overrides the agent files' models).
9. **Map + addendum**: `workflow-map.md` lists the agents and their tiers; `templates/CLAUDE.md`'s Subagents line
   points to `docs/agent/model-routing.md`.
10. **Unchanged on purpose**: `/plan` (Architect + PM review), `/review`, `/fix`, `/security`, code writing in
    `take-plan` and `auto-solve` Phase 3 — all on the main model.

## Atomic Sub-tasks
- [x] R1: One place to choose models — `models` key with defaults and validation, install-check fixtures — kit.config.json, tools/lib/kit.mjs, tools/install-check.mjs
- [x] R2: Write down the routing rules once — tiers, no inline model switch, ESCALATE, re-check rule, hand-off file — core/docs/agent/model-routing.md
- [x] R3: Add the cheap agents — kit-runner, kit-prevalidate, git-agent model line — core/.claude/agents/**
- [x] R4: Send build runs and evidence gathering to the cheap agents — ship Phase 1, auto-solve Phase 2–4, review-it step 3, docs-refresh — core/.claude/commands/*.md, core/docs/agent/ship-regular.md
- [x] R5: Run github-sync and techdebt in a forked agent and hand questions back to the main session — core/.claude/skills/github-sync/SKILL.md, core/.claude/skills/techdebt/SKILL.md
- [x] R6: Warn at session start when an environment variable overrides the agent models — core/scripts/session-startup.sh
- [x] R7: Update the workflow map and the CLAUDE.md addendum — core/docs/agent/workflow-map.md, templates/CLAUDE.md
- [ ] R8: Release and compare in FoodVibe — CHANGELOG entry, kit PR, tag on Dandan's go, kit-sync -Ref <tag> -Apply, the same work once with tiers on and once all inherit, /usage both, /ship there — CHANGELOG.md

## Out of Scope
- Orchestrator roles, `/orchestrate`, implementer escalation Sonnet → Opus, reviewer/UI/integrator agents — plans
  013/014 (they use this plan's tiers and hand-off file).
- The Worker's own model in a slot: the Human picks it when opening the session.
- The agent eval set (parallel session).
- Cursor layer (`layers/cursor/`): Cursor picks models in its own UI.

## Execution Notes
- 2026-10-21: R1–R7 done on `feat/012-model-routing-per-task`. Checks: leak-check (3 runs), pack-check, install-check
  (new `models.*` block: defaults, project id, all-inherit, refused `gpt-4`, no `model:` on an inline command),
  workflow-link-check, acceptance-check --e2e pass. e2e-check fails 1 of 42 ("first push to an empty remote": a git
  `push negotiation failed` warning) on unmodified `main` too in this cloud session — environment, not this plan.
- Independent review (separate agent, opus): 1 blocking + 3 should-fix + 3 nits, all fixed — `[capture]` marker so
  `scope-check --arch`, the log query and the ledger check return their output on exit 0; Cursor runs those commands
  inline; real lint failure stops auto-solve Phase 4; install-check now tests the SessionStart `MODEL_ROUTING:` line and
  a skill with `model:` but no `context: fork`; ESCALATE wording aligned; github-sync's `rebase --abort` in CHANGELOG.
- `ship-regular.md` needed no change (its review stays inline); it stays in scope for Step 0 only.
- Open PR #32 (plan 009) also edits `ship.md` (Phase 4 cards) and `CHANGELOG.md` `[Unreleased]`: a test merge of #32 into
  this branch is clean for `ship.md`; the second PR to merge resolves `[Unreleased]` by keeping both entries.
- For plan 013 (orchestrator, parallel session) — decided by Dandan 2026-10-21:
  - Implementer escalation: Sonnet first; on failure it writes the hand-off file (`docs/agent/model-routing.md`
    rule 5) and a fresh Opus implementer continues from that file + plan + `git diff`, never the Sonnet transcript;
    an Opus failure stops the run and goes to the Human. No model switch inside one session.
  - What counts as a failure: a first reviewer finding goes back to the same Sonnet implementer (small fix, it holds
    the context); escalation to Opus when the checks still fail, when Sonnet returns `ESCALATE`, or on a second reviewer
    finding.
