# Plan 119 — /styleqa: one command that runs the measured audit and a bounded visual review into one report

Status: draft
Depends-on: 118
Snapshot: f5a37c3
Source: brief `style-qa-kit-brief.md` (FoodVibe Planner, 2026-11-13), reviewed against the kit. Last of plans 117 → 118 → 119.
Approved: the Human, 2026-11-13 — "save it as plans for an orchestrator run" (an explicit yes under the freeze in `AGENTS.md`).

## Problem Statement

Plans 117 and 118 give every project a free, repeatable measured audit. What a script cannot judge — a control that looks
unstyled, an off-theme surface, misalignment, a page that does not match its family — needs a model to look at the
screenshots. This plan adds `/styleqa`: it resolves pages, makes sure the servers answer, runs the measured layer, builds a
bounded review queue, runs up to 3 review-tier reviewers that read image files only, merges their findings into the same
report with stable IDs, and prints a short summary. It reports only; it never fixes.

Kit decisions (the Human, 2026-11-13): `/styleqa` ships as a **skill** (`.claude/skills/styleqa/SKILL.md`, typed as
`/styleqa`), because the command budget is full (24/24 in `tools/size-budget.json`); the reviewer is an agent file, and
this plan raises `agentFiles.max` from 10 to 11 for it.

## Goals & Success Criteria

**Primary:** `/styleqa <page>` in a project prints status, coverage, counts by severity (measured / visual), the top 5
components with their pages, new / known / gone and the report path — with model reading bounded to the review queue.

- [auto] `node --test tools/test/styleqa-queue.test.mjs` passes: per page every segment at the smallest and largest width
  for every state is queued; a middle width is queued only for a state × width with an S2/S3 measured finding; a page over
  24 images lists the rest as `skipped` and the summary line says how many; each entry carries the measured findings
  already recorded for its shot.
- [auto] `node --test tools/test/styleqa-merge.test.mjs` passes: a valid review file's findings get stable IDs and appear in
  the report beside the measured ones; merging the same files twice changes nothing; a malformed file is skipped with one
  `skipped <file>: <reason>` line and the merge still exits 0; a finding with `confidence` below the threshold or a check
  outside V1–V8 is dropped; more than 6 findings for one state keeps the 6 highest severities.
- [auto] `node --test tools/test/agent-contracts.test.mjs tools/test/size-budget.test.mjs` passes with
  `.claude/agents/styleqa-reviewer.md` (model `{{models.review}}`, tools Read, Glob, Write only) and `agentFiles.max` 11.
- [auto] `node tools/install-check.mjs` passes and an installed project has `.claude/skills/styleqa/SKILL.md`,
  `.claude/agents/styleqa-reviewer.md`, `docs/agent/styleqa.md`, `scripts/styleqa/queue.mjs` and `scripts/styleqa/merge.mjs`.
- [auto] `npm run build`, `npm run lint` and `npm test` pass, and `node tools/drift-check.mjs --target .` passes after
  `node tools/sync.mjs --target . --apply`.
- [human] Read `docs/agent/styleqa.md`: it tells a project how to adopt Style QA, add a page or a state, read the report,
  and what a run costs — clear enough to adopt it in FoodVibe without asking.

## Execution Mode
- Parallel: no.
- Concurrent plans: none.
- Isolated DB: no.
- Run: `/orchestrate 117,118,119 styleqa` — after 118.

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspots
`CHANGELOG.md` and `README.md`.

```scope
core/scripts/styleqa/**
core/.claude/skills/styleqa/**
core/.claude/agents/styleqa-reviewer.md
core/docs/agent/styleqa.md
core/docs/agent/styleqa-rubric.md
core/docs/agent/model-routing.md
core/docs/agent/workflow-map.md
core/.claude/commands/skills.md
tools/size-budget.json
tools/install-check.mjs
tools/fixtures/styleqa/**
tools/test/styleqa-queue.test.mjs
tools/test/styleqa-merge.test.mjs
tools/test/agent-contracts.test.mjs
tools/test/size-budget.test.mjs
scripts/**
.claude/skills/styleqa/**
.claude/agents/styleqa-reviewer.md
.claude/commands/skills.md
docs/agent/**
```

## Read Scope

Entire repo. FoodVibe's `.claude/agents/orch-ui.md` (shape of a review-tier agent) and `docs/qa/code-qa.md` in
`../foodVibe1.0` at `dfe7571d` are a precedent only.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a step needs a file outside the
`## Read-Write Scope`: STOP, tell the Human the file, the exact change and why; offer `approved: <path>`; then append the
path to the scope block and retry.

## Architecture Impact

- INV-1: preserves — `core/docs/agent/model-routing.md` gains one `review`-tier row for `styleqa-reviewer`; the judgment
  tier, its pinning and `run-plans.mjs` are unchanged; the reviewer never runs on Haiku (the `review` tier refuses it).

## Step 0 — Reality Check

Runs only when `scope-check.mjs --drift` reports `REALITY: drift`. Check the listed commits by symbol and print one line
per commit: `ok` or `conflict: <what>`. STOP for a go only on a `conflict`.

## User Stories
- As the Human, I want `/styleqa dashboard` after a fix to re-check that one page cheaply.
- As the Human, I want visual defects a script cannot see, without paying for a model to drive a browser.

## Functional Requirements

### Must Have (P0)
- [ ] Skill `/styleqa [page …] [--no-review] [--widths=] [--states=] [--changed]`, inline on the main model (no `model:`
  line — `docs/agent/model-routing.md` rule 1). Flow: (1) resolve pages via the engine (`--list` / unknown → stop with the
  list); (2) servers: main folder `node scripts/slot-serve.mjs --main`, in a slot `node scripts/slot-serve.mjs`, the
  preflight skill when they do not answer; (3) `node scripts/styleqa/run.mjs --layers=static,sweep …`, a failed status
  stops; (4) unless `--no-review`: `node scripts/styleqa/queue.mjs`, then the reviewers, then `node scripts/styleqa/merge.mjs`;
  (5) summary in the Human's language: status, pages covered, counts by severity (measured / visual), top 5 components with
  their pages, new / known / gone, report path; then one line offering fix plans for the top components — and stop.
- [ ] Review queue (`queue.mjs`): the bound above, cap 24 images per page, `skipped` list, one queue file per page carrying
  the measured findings per shot.
- [ ] Reviewer agent `styleqa-reviewer.md`: `model: {{models.review}}`, tools Read, Glob, Write; reads its page's queue file,
  the shared rubric and the project's theme facts (`docs/qa/styleqa-theme.md`); writes exactly one JSON file per page
  (`check, severity, confidence, state, width, shot, region, anchorText, title, expected, actual`); returns one line. No
  browser, no source code. The skill starts at most 3 at once.
- [ ] Shared rubric `docs/agent/styleqa-rubric.md` (kit-owned): V1 looks unstyled · V2 off-theme surface · V3 alignment and
  spacing · V4 text direction · V5 hierarchy · V6 small-width fit where the measured checks found nothing · V7 family
  mismatch · V8 dead space. Rules: report only what is visible; never guess a cause in code; skip what is already known; at
  most 6 findings per state; "no findings" is valid; never report low confidence.
- [ ] Merge (`merge.mjs`): validates each review file, assigns IDs through plan 117's finding store, folds visual findings into
  the report, idempotent, a malformed file skipped with one line.
- [ ] Docs `docs/agent/styleqa.md`: adoption contract (page map, sign-in module, config values, theme facts, the two dev
  dependencies and their install line), how to add a page or a state, how to read the report, cost (measured: no tokens;
  visual: at most 24 images per page on the review tier, 3 reviewers at once).
- [ ] Registration: model-routing table row, workflow-map entry, skills listing, `agentFiles.max` 11 with its reason,
  install-check expectations.

## Atomic Sub-tasks

- [ ] V1: Write failing tests for the review queue bound and the idempotent merge first — queue and review-file fixtures — tools/test/styleqa-queue.test.mjs, tools/test/styleqa-merge.test.mjs, tools/fixtures/styleqa/**
- [ ] V2: Bound what the model reads by building a per-page queue of the screenshots worth a look — smallest and largest width always, middle widths only with an S2/S3 finding, cap 24, skipped list — core/scripts/styleqa/queue.mjs
- [ ] V3: Add the review-tier reviewer that judges screenshots against a shared rubric and the project's theme — agent file, rubric V1–V8 with its rules — core/.claude/agents/styleqa-reviewer.md, core/docs/agent/styleqa-rubric.md
- [ ] V4: Fold the reviewers' findings into the same report with stable IDs, safely re-runnable — validation, IDs, one-line skip of a malformed file — core/scripts/styleqa/merge.mjs, core/scripts/styleqa/report.mjs
- [ ] V5: Add the /styleqa skill that runs the whole flow and stops at a short summary — page resolution, servers, measured run, queue, at most 3 reviewers, merge, summary, fix-plan offer — core/.claude/skills/styleqa/SKILL.md
- [ ] V6: Document adoption, adding pages and states, reading the report and the cost — core/docs/agent/styleqa.md
- [ ] V7: Register the skill and the agent and raise the agent budget to 11 for it — model-routing row, workflow map, skills listing, size budget, install-check, agent-contract test — core/docs/agent/model-routing.md, core/docs/agent/workflow-map.md, core/.claude/commands/skills.md, tools/size-budget.json, tools/install-check.mjs, tools/test/agent-contracts.test.mjs, tools/test/size-budget.test.mjs
- [ ] V8: Resync the kit's own copy and pass every check — node tools/sync.mjs --target . --apply — scripts/**, .claude/**, docs/agent/**, CHANGELOG.md

## Technical Considerations
- Dependencies: plans 117 (finding store, report) and 118 (sweep, screenshots).
- New files needed: the skill, the agent, two docs, `queue.mjs`, `merge.mjs`, two tests.
- Model changes: one new agent on the `review` tier; no tier or default changes.
- Backend / API: none.
- Auth and validation: review files are untrusted model output — validated field by field, unknown fields dropped, paths
  confined to the output folder.
- Security surface: the reviewer may Write; its prompt confines writes to its one review file under the output folder, and
  merge ignores anything else there.
- Data / migration: none.
- Size budget: agent file ≤ 120 lines, skill within the kit's instruction-load budget (`node tools/instruction-load.mjs`).

## Out of Scope
- Fixing findings or writing the fix plans (the skill only offers them).
- Pixel-diff baselines, a nightly or scheduled run, changing FoodVibe's existing Code QA.
- The kit release (the Human releases after merging the run branch) and FoodVibe adoption: after the release, a FoodVibe
  plan syncs the kit, writes the page map for every route, wires `loginQa` as the sign-in module, writes the theme facts,
  and runs the brief's acceptance (the header break at 375 and 620 with a screenshot; the public copy-link control as U1 or
  V1; at least 4 of 5 Human-picked visual findings real, else the rubric is tightened).

## Critical Questions
- Q1: The command and agent budgets are full — how does /styleqa ship? A: (Human, 2026-11-13) as a skill, plus agentFiles.max raised from 10 to 11 for the reviewer.

## Execution Notes
- 2026-11-13 Planner: saved with plans 117 and 118 from the brief.
