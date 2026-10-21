# Plan 013 — Role Agents, and /review-it Rewritten on the Checker Pipeline

Status: draft
Snapshot: 3511799
Depends-on: 011, 012

## Problem Statement
The orchestrator (plan 014) runs each plan through separate agents — builder, gate, checker, verifier, merger — and the
MVP run showed why they must be separate and pinned: the independent checker caught 5 false "success" claims and real
defects, but its model was not pinned (a run silently used Sonnet while the report said Opus), it returned `pass: true`
with a `major` in its own list, and the prompts used commands the user's deny list blocks (50 denied calls).

Plan 012 added the model tiers (`models.mechanical / analysis / judgment`) and the routing rules. A code-writing builder
fits none of those tiers, and the kit has no role agents beyond `kit-runner`, `kit-prevalidate` and `git-agent`.

The normal flow has the same gap: `/review-it` is a compliance checklist that still says "Cursor" and "milestone" (14
mentions), with no bug lens and no verification step. Rewriting it on the same checker pipeline gives the normal flow the
benefit now.

## Prerequisites
- Plan 011 merged (`plan-order`, `Depends-on:`).
- Plan 012 merged (model tiers, `docs/agent/model-routing.md`) — already on `main`.

## Goals & Success Criteria
**Primary:** every orchestrator role exists as an agent file with a pinned model and effort from one config place, and
`/review-it` reviews with the same finders → verifier pipeline.

- [auto] `node tools/install-check.mjs` passes with fixtures that: render all new agents from the defaults and from a
  project value; show every agent file has `model:` and `effort:` in its frontmatter and no agent file has an empty
  `tools:`; refuse `models.build: gpt-4` with a message naming the key.
- [auto] The builder agent's `tools:` list contains neither `Agent` nor `SendMessage`; no role agent file contains
  `reset --hard`, `push --force`, `push -f`, `rm -r` or `rm -rf` (grep on the rendered files exits 1 = none).
- [auto] With every model tier set to `inherit` the rendered agents carry `model: inherit` only.
- [auto] `grep -ci "cursor\|milestone" core/.claude/commands/review-it.md` prints `0`.
- [auto] `node tools/leak-check.mjs`, `pack-check`, `e2e-check`, `workflow-link-check`, `acceptance-check --e2e` pass;
  `node tools/drift-check.mjs --target .` reports no drift.
- [auto] A contract test (`tools/test/agent-contracts.test.mjs`) feeds each agent file's documented JSON schema example
  to the shared result validator and passes; a result missing `model`, or a `pass: true` carrying a `major` problem,
  is rejected by the validator.
- [human] `/review-it` on a real open diff in the kit repo produces findings with `file:line`, a keep/refuted verdict per
  finding, and no finding on a line the diff did not change. Dandan compares it with the old `/review-it` on the same diff.

## Execution Mode
- Parallel: no — shares agent files and `kit.config.json` with 014/019 (they wait for this plan).
- Concurrent plans: none.
- Isolated DB: no.
- Kit edits: kit branch `feat/013-role-agents` + kit PR; Dandan merges. Release: with 014 and 018 (minor: new agents,
  new `models.build` key).

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`.

```scope
core/.claude/agents/**
core/.claude/commands/review-it.md
core/docs/agent/model-routing.md
core/docs/agent/agent-roles.md
core/docs/agent/workflow-map.md
kit.config.json
.kit/config.json
tools/lib/kit.mjs
tools/lib/agent-result.mjs
tools/install-check.mjs
tools/test/**
tools/e2e-check.mjs
.claude/agents/**
.claude/commands/**
docs/agent/**
README_WORKFLOW.md
CHANGELOG.md
```

## Read Scope

Entire repo. Analysis and architectural suggestions are expected.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside the
`## Read-Write Scope` above: STOP, tell the Human the file, the exact change, and why it can't be done in-scope; offer
`approved: <path>`; then append the path to the scope block above and retry.

## Architecture Impact
- INV-none: preserves — new agent files and one new config key; the Planner/Worker flow and `models.*` as the single
  place for models are unchanged (this plan adds `models.build`, it does not add a second place).

## Step 0 — Reality Check

Runs only when `scope-check.mjs --drift` reports `REALITY: drift`. Check the listed commits by symbol and print one line
per commit: `ok` or `conflict: <what>`. STOP for a go only on a `conflict`.

## User Stories
- As Dandan, I want to change the builder's model in one config key.
- As the orchestrator, I want every role to return a validated JSON result that names its own model and effort.
- As a Planner reviewing a Worker's branch, I want `/review-it` to find real bugs and drop false alarms.

## Functional Requirements

### Must Have (P0)
- [ ] New tier `models.build` (default `sonnet`), validated like the other tiers; escalation uses `judgment`.
- [ ] Agents `orch-readiness`, `orch-builder`, `orch-gate`, `orch-check-plan`, `orch-check-bugs`, `orch-check-rules`,
  `orch-verify`, `orch-security`, `orch-ui`, `orch-merge`, `orch-report` with the tiers/tools/returns from the table
  below.
- [ ] Shared rules in every agent: one job; non-interactive (cannot ask anyone, never message the coordinator, take the
  recommended option and log it); output only through the schema; evidence (`file:line` or command + result) for every
  claim; echo model + effort in the result; only commands that are not on the deny list.
- [ ] Checker pipeline: three narrow finders in parallel → verifier that drops a finding only on a concrete refutation →
  score threshold (keep ≥ 80) → a "do not report" list (pre-existing issues, unchanged lines, what lint/typecheck/
  build catch, pedantic nits, likely-intentional changes); mechanical checks stay with the gate runner.
- [ ] `/review-it` rewritten on that pipeline; it keeps its `kit-runner` call.

| Agent | Tier (`models.*`) | Effort | Tools | Returns |
| --- | --- | --- | --- | --- |
| `orch-readiness` | judgment | high | Read, Grep, Glob, read-only Bash | per plan: ready / questions / env needs / commands needed |
| `orch-builder` | build (escalation: judgment) | medium | Read, Edit, Write, Bash — no Agent, no SendMessage | `{status: built\|blocked\|ESCALATE, branch, summary, blocker?, evidence[]}` |
| `orch-gate` | mechanical | low | Bash | one line per command: pass / fail / env-fail + 20-line tail on fail |
| `orch-check-plan`, `-bugs`, `-rules` | analysis | high | Read, Grep, Glob, Bash (git, tests) | candidate problems: file:line, rule, reasoning, severity |
| `orch-verify` | analysis | medium | Read, Grep, Glob, Bash | per candidate: keep / refuted (concrete refutation) / confidence 0–100 |
| `orch-security` | analysis | high | Read, Grep, Glob | problems on sensitive paths only |
| `orch-ui` | analysis | medium | browser tool, Read | per card: pass / fail / plan-drift, screenshot paths |
| `orch-merge` | analysis | low | Bash | `{merged, sha?, reason?, envFailure?}` |
| `orch-report` | mechanical | low | Read | final report text |

### Should Have (P1)
- [ ] A shared result validator (`tools/lib/agent-result.mjs`): requires `model`, `effort`; computes `pass` from the
  problem list (no blocker/major) and rejects a result whose own `pass` disagrees.

### Nice to Have (P2)
- none

## UI/UX Notes
- Terminal output only.

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [ ] A1: Add a model tier for code-writing builders, so one config key sets the builder's model — models.build, default sonnet, validated and refused when invalid; routing doc names it — kit.config.json, .kit/config.json, tools/lib/kit.mjs, tools/install-check.mjs, core/docs/agent/model-routing.md
- [ ] A2: Write the shared rules and result schema every role agent follows, so all roles behave alike — non-interactive rules, evidence rule, model and effort echoed, deny-list-safe commands — core/docs/agent/agent-roles.md
- [ ] A3: Add the builder agent with its hand-off file and escalation rule — first finding returns to the same builder; a fresh stronger builder continues from the hand-off file, the plan and git diff; no Agent or SendMessage tool — core/.claude/agents/orch-builder.md
- [ ] A4: Add the readiness, gate, merge and report agents — one job each, pinned model and effort, schema output — core/.claude/agents/orch-readiness.md, orch-gate.md, orch-merge.md, orch-report.md
- [ ] A5: Add the checker pipeline agents so an independent reviewer finds problems and a verifier confirms them — three finders, one verifier that refutes only with concrete evidence, a security reviewer and the UI validator — core/.claude/agents/orch-check-plan.md, orch-check-bugs.md, orch-check-rules.md, orch-verify.md, orch-security.md, orch-ui.md
- [ ] A6: Add the result validator so a model's own pass flag is never trusted — computes pass from the verified problems and rejects results missing model or effort — tools/lib/agent-result.mjs, tools/test/agent-contracts.test.mjs
- [ ] A7: Rewrite the review command on the checker pipeline so the normal flow finds real bugs — drop the Cursor and milestone wording, add the bug lens and verification step, keep the kit-runner call — core/.claude/commands/review-it.md
- [ ] A8: Check the install renders every agent correctly and sync the installed copies — fixtures for defaults, project value, invalid value, inherit-everywhere; sync --apply; CHANGELOG entry — tools/install-check.mjs, tools/e2e-check.mjs, .claude/agents/, docs/agent/, CHANGELOG.md

## Technical Considerations
- Dependencies: plan 012's tier mechanism (`models.*` rendered as `{{models.*}}`); `kit-runner` for mechanical steps;
  Claude Code agent frontmatter (`model`, `effort`, `tools`, `omitClaudeMd`).
- New files needed: the agent files above; `core/docs/agent/agent-roles.md`; `tools/lib/agent-result.mjs`;
  `tools/test/agent-contracts.test.mjs`.
- Model changes: `models.build` only.
- Backend / API: none.
- Auth and validation: none.
- Security surface: the security reviewer runs read-only. Role prompts must contain no deny-listed commands.
- Data / migration: none.
- Project checks: none.

## Out of Scope
- The workflow script that runs these agents (014) and the UI tier (018).
- Measuring agent quality (019 records the baseline; models may change after it).
- `orchestrator.models.*` keys — dropped on purpose; `models.*` is the one place.

## Critical Questions
- none

## Execution Notes
Review (Planner, 2026-10-21): fixed — brief's `orchestrator.models.*` dropped for `{{models.*}}`; builder tier added as
`models.build` (decision D accepted); builder escalation follows Dandan's 2026-10-21 rule from plan 012's notes (first
checker finding → same Sonnet builder; a fresh Opus builder continues from the hand-off file when checks still fail, the
builder returns ESCALATE, or a second finding comes; an Opus failure parks the plan; no model switch inside one session).
Q3 (security reviewer only on sensitive paths) and Q4 (Sonnet finders + verifier until plan 019 decides) are recorded in
the agent files. Checked: 012, 015, 016, 008, 009, 010.
