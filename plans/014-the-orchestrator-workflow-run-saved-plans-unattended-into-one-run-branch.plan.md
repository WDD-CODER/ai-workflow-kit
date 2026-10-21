# Plan 014 — The Orchestrator Workflow: Run Saved Plans Unattended Into One Run Branch

Status: active
Snapshot: 3511799
Depends-on: 010, 011, 013, 017

## Problem Statement
The kit has one way to build: the Planner writes a plan, a Worker builds it in a slot, the Human merges. For a batch of
plans (the improvised MVP run did 29) the Human is the bottleneck. An improvised orchestrator proved the pattern works —
29/29 merged, git as the ledger, an independent checker that caught 5 false "success" claims — and also showed what to
design against: the script trusted a checker's `pass: true` next to a `major`; environment failures (disk full, DB down)
consumed builders' fix rounds and parked 3 plans with nothing wrong in their code; prompts used commands the deny list
blocks; counts drifted from git five times; a chat message was relayed into 107 agents.

This plan adds a second, opt-in workflow. Nothing in the Planner/Worker flow changes unless the Human starts a run
(`/orchestrate 451-457`). A run checks everything first and asks every open question in one batch, then runs unattended:
builder → gate → independent checker → merge into one run branch `orch/<run>` — never into `main`. The Human gets one
report and merges the run branch himself.

Two limits shape the design (Workflow reference): a workflow script has no filesystem, git or clock access (`Date.now()`
and argless `new Date()` throw), and resume works only in the same session. So files, git and time are handled by a kit
script run through the mechanical runner agent, and git stays the ledger across sessions.

## Prerequisites
- Plan 010 merged (slot-serve installs missing packages — the environment failure that parked 3 MVP plans).
- Plan 011 merged (`plan-order --json`).
- Plan 013 merged (role agents, `models.build`, result validator).
- Plan 017 merged (guards cover agents started from the main folder, the merge folder and Bash writes).

## Goals & Success Criteria
**Primary:** `/orchestrate <plans>` runs saved plans through role agents and ends with the expected merges on
`orch/<run>`, a correct `status.json`, and `main` untouched.

- [auto] `node tools/orchestrator-e2e.mjs` (scratch project, stub role agents that return scripted JSON) runs 4 toy plans
  and ends with: (1) a diamond dependency merged in wave order; (2) a plan whose first check fails, is fixed by the same
  builder in round 1 and merges; (3) a plan with a simulated environment failure (disk below `minFreeDiskGb`) that does
  not consume a fix round, is retried once after the env check passes, and merges; (4) a checker result with
  `pass: true` and a `major` problem is treated as a fail. The test asserts: merge subjects equal
  `Merge <branch> into orch/<run> (plan NNN)` for each merged plan, in order; `orch/<run>/status.json` lists every plan
  with state, round, sha and model per agent; `git rev-parse origin/main` is unchanged; the merge folder has no
  uncommitted files.
- [auto] A plan whose fix round count reaches `orchestrator.maxFixRounds` (default 2) is parked with its reason; the wave
  stops after it (decision D6); a second run with the same name rebuilds the done set from the anchored merge subjects
  `^Merge \S+ into orch/<run> \(plan NNN\)$` and does not redo merged plans (tested).
- [auto] Escalation: a plan whose Architecture Impact names an invariant other than `INV-none` starts its builder on the
  `judgment` tier; a plan with only `INV-none` starts on `build`. The first checker finding returns to the same builder;
  a persisting failure, an `ESCALATE` return or a second finding starts a fresh builder on `judgment` that reads the
  hand-off file, the plan and `git diff`; a failure on that builder parks the plan. Tested with the stub agents.
- [auto] `node tools/orchestrator-e2e.mjs` asserts the workflow script never calls a filesystem, git or clock API (grep of
  `orchestrate.js` for `Date.now|new Date\(\)|require\(|import .*fs|child_process` exits 1 = none) and that every state
  write goes through `scripts/orch-state.mjs`.
- [auto] `node tools/install-check.mjs` shows the installer copies `.claude/workflows/orchestrate.js`, the `/orchestrate`
  command and `docs/agent/orchestrator.md`; new config keys `orchestrator.runBranchPrefix`, `orchestrator.maxFixRounds`,
  `orchestrator.minFreeDiskGb` render with defaults and refuse a bad value naming the key.
- [auto] `node tools/leak-check.mjs`, `pack-check`, `e2e-check`, `workflow-link-check`, `acceptance-check --e2e` pass;
  `node tools/drift-check.mjs --target .` reports no drift.
- [human] One real run on a project with 2–3 plans (Dandan chooses the project): the readiness step asks its questions
  once, the run ends with the plans merged into `orch/<run>`, the report opens from the main folder
  (`.claude/orchestrator-runs/<run>.md`), and `main` is untouched.

## Execution Mode
- Parallel: no — after 010, 011, 013, 017; 019 (eval baseline) should be recorded before the first real run.
- Concurrent plans: 019 (no shared files).
- Isolated DB: no.
- Kit edits: kit branch `feat/014-orchestrator-workflow` + kit PR; Dandan merges. Release: with 013 and 018 (minor: new
  files, command and config keys; nothing an existing project must do).

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`.

```scope
core/.claude/workflows/**
core/.claude/commands/orchestrate.md
core/.claude/commands/commands.md
core/docs/agent/orchestrator.md
core/docs/agent/workflow-map.md
core/scripts/orch-state.mjs
core/scripts/orch-preflight.mjs
core/scripts/lib/**
core/.claude/instructions/**
templates/gitignore/**
kit.config.json
.kit/config.json
tools/lib/kit.mjs
tools/install.mjs
tools/sync.mjs
tools/install-check.mjs
tools/e2e-check.mjs
tools/orchestrator-e2e.mjs
tools/fixtures/orchestrator/**
tools/test/**
docs/brain/decisions/**
.gitignore
.claude/workflows/**
.claude/commands/**
.claude/instructions/**
scripts/**
docs/agent/**
README_WORKFLOW.md
CHANGELOG.md
core/scripts/local-excludes.mjs
```

## Read Scope

Entire repo. Analysis and architectural suggestions are expected.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside the
`## Read-Write Scope` above: STOP, tell the Human the file, the exact change, and why it can't be done in-scope; offer
`approved: <path>`; then append the path to the scope block above and retry.

## Architecture Impact
- INV-none: preserves — a new opt-in mode beside the Planner/Worker flow; `main` is never written by a run, plans keep
  the same scope gates, and `models.*` stays the single place for models.

## Step 0 — Reality Check

Runs only when `scope-check.mjs --drift` reports `REALITY: drift`. Check the listed commits by symbol and print one line
per commit: `ok` or `conflict: <what>`. STOP for a go only on a `conflict`.

## User Stories
- As Dandan, I want to hand over a set of reviewed plans, answer one batch of questions, and come back to one report.
- As Dandan, I want nothing to reach `main` until I merge the run branch myself.
- As the Planner, I want a run to stop at the end of a wave when something parked.

## Functional Requirements

### Must Have (P0)
- [ ] Readiness (D9): `plan-order --json` → waves; one readiness agent per plan (Step 0, Done-when tiers present, scope
  sane, env needs); script preflight (free disk, DB reachable, dev servers start, git identity set, required settings);
  one batched question list; answers written into each plan's `## Execution Notes`; a plan with an unanswered question
  leaves the run; then `go`.
- [ ] Branch `orch/<run>` from `origin/<mainBranch>`; the merge folder is kept clean without destructive commands.
- [ ] Per plan: builder (in its slot, scope-guarded) → gate → finders in parallel → verifier → security (only when the
  diff touches `security.sensitivePaths` or names auth/permission code) → UI validator (when 018 is present) → merger
  (serialised; build + tests before push).
- [ ] Fix loop: problems go back to the builder per the escalation rule; max `orchestrator.maxFixRounds`; then park.
  `pass` is computed from the verified problem list (no blocker/major), never taken from a model.
- [ ] Environment failures do not consume a round: pause the plan, retry once after the env check, then stop the wave
  with the reason.
- [ ] Wave gate: stop at the end of a wave when anything parked.
- [ ] State: git is the ledger; `scripts/orch-state.mjs` writes `status.json` after every step (plan, state, round, sha,
  model per agent, free disk) and rebuilds the done set from anchored merge subjects; timestamps come in through the
  workflow's `args`; every count in a message comes from that file or an anchored git command run in the same turn.
- [ ] Never: merge to `main`; answer or resume a worker agent; relay chat into agents (start from a clean turn); use a
  command on the deny list; write the Human's uncommitted files; run unbounded background commands; state a count it
  did not compute.
- [ ] Report: merged / parked / why; decisions taken; one validation list grouped by page with evidence; what only the
  Human can do. Written to `docs/orchestrator/runs/<run>/report.md` on the run branch **and** copied to
  `.claude/orchestrator-runs/<run>.md` in the main folder (gitignored).

### Should Have (P1)
- [ ] `docs/agent/orchestrator.md` states the run-mode rules for the installed project in generic words.

### Nice to Have (P2)
- none

## UI/UX Notes
- `/orchestrate 451-457` (a range or a list); the end-of-run message prints the report path and the merge command for
  the Human as a PowerShell line.

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [x] A1: Let the installer ship the workflow folder and add the run settings, so the feature is opt-in and tunable — orchestrator.runBranchPrefix, maxFixRounds, minFreeDiskGb with defaults, validated; the workflows folder is copied like agents — kit.config.json, .kit/config.json, tools/lib/kit.mjs, tools/install.mjs, tools/sync.mjs, tools/install-check.mjs
- [x] A2: Add a state script the workflow calls for everything a workflow script cannot do itself — write status.json, rebuild merged plans from anchored merge subjects, report free disk, check the merge folder is clean — core/scripts/orch-state.mjs, core/scripts/lib/
- [x] A3: Add the readiness preflight so environment problems are found before the run, not by a builder — disk, database, dev servers, git identity, settings; prints one line per problem — core/scripts/orch-preflight.mjs
- [x] A4: Write the run rules for projects in plain words, replacing ad-hoc run notes — roles, never-do list, state rules, report location, escalation — core/docs/agent/orchestrator.md, core/docs/agent/workflow-map.md
- [x] A5: Write the workflow script: readiness, ordering, the per-plan pipeline, the fix loop and the wave gate — uses agentType role agents and schema results; pass computed in the script; environment failures do not count as rounds; no file, git or clock calls — core/.claude/workflows/orchestrate.js
- [x] A6: Add the command that starts a run from a clean turn and prints the final instructions — range or list of plans, refuses when main is dirty or a run of that name is live — core/.claude/commands/orchestrate.md, core/.claude/commands/commands.md
- [x] A7: Keep the local copy of the report openable from the main folder without a branch switch — gitignored run-report folder in the template ignore list and this repo — templates/gitignore, .gitignore
- [x] A8: Prove the run end to end on a scratch project with stub agents — diamond, fix-then-pass, environment failure that costs no round, major-with-pass-true treated as fail, parked plan stops the wave, relaunch rebuilds from git — tools/orchestrator-e2e.mjs, tools/fixtures/orchestrator/, tools/e2e-check.mjs
- [x] A9: Sync installed copies and record the release notes — node tools/sync.mjs --target . --apply; CHANGELOG lists each new key and file; an ADR if the run-mode rules supersede anything — CHANGELOG.md, docs/brain/decisions/

## Technical Considerations
- Dependencies: Workflow tool API (`agent()` with `agentType`, `schema`; no fs/git/clock); plan 011 `plan-order --json`;
  plan 013 agents and validator; plan 017 guards; plan 012 tiers.
- New files needed: `orchestrate.js`, `orchestrate.md`, `orchestrator.md`, `orch-state.mjs`, `orch-preflight.mjs`,
  `tools/orchestrator-e2e.mjs`, fixtures.
- Model changes: none (uses `models.build` and `judgment` from 012/013).
- Backend / API: none.
- Auth and validation: none.
- Security surface: runs agents that edit code unattended — bounded by the plan scope guards (017), no `main` writes, no
  deny-listed commands, no pushes except to `orch/<run>` and plan branches. The state script takes no shell strings from
  plan text.
- Data / migration: none.
- Project checks: none.

## Out of Scope
- The UI validation tier (018) — the pipeline leaves the UI step as a hook that 018 fills.
- Measuring agents (019).
- Merging the run branch into `main` (the Human).
- Resuming a run across sessions by `resumeFromRunId` (git is the ledger).
- Any model definition outside `models.*`.

## Critical Questions
- none

## Execution Notes
Review (Planner, 2026-10-21): fixed — workflow scripts cannot touch files/git/clock → `orch-state.mjs` through the
mechanical runner; "escalate when Architecture Impact exists" would always fire → only when it names an invariant other
than INV-none; builder escalation = Dandan's 2026-10-21 rule; `orchestrator.models.*` dropped; run report location
decided (G): run branch plus gitignored copy in the main folder; `Depends-on: 010` added (H). Checked: 006 (precedent for
an unattended run with one merge point), 008, 009, 012, 015, 016.

Orchestrator build (builder, 2026-10-21, branch feat/014-orchestrator-workflow from orch/orchestrator-v1):
- scope extended: core/scripts/local-excludes.mjs — the runtime ignore list (and the rendered templates/.gitignore
  skeleton, which is built from it) is where `.claude/orchestrator-runs/` must go so projects ignore the local run
  state; `templates/gitignore/**` named in the scope does not exist (orchestrator, no Human available).
- Step 0 skipped: `node scripts/scope-check.mjs --drift --plan=<this plan>` → `REALITY: clean`, exit 0.
- Decision: status.json lives in the main folder at `.claude/orchestrator-runs/<run>/status.json` (gitignored, written
  after every step by orch-state.mjs only); `finish` commits a copy beside the report at
  `docs/orchestrator/runs/<run>/` on the run branch — the "orch/<run>/status.json" of the Done-when. Writing it to the
  run branch after every step would add a commit per step and leave the merge folder dirty mid-run.
- Decision: the report is computed by `orch-state.mjs finish` from status.json and the anchored merge subjects (rule:
  every count from that file or git); the `orch-report` agent is not called by the run.
- Decision: the merger merges with `--no-ff --no-commit`, runs the checks, then commits and pushes; a conflict or a
  failing check is `git merge --abort` and goes back to the builder as a finding (a fix round) — this satisfies
  "build + tests before push" without a deny-listed reset. Given in the merge prompt; `orch-merge.md` (plan 013's
  file, outside this scope) is unchanged.
- Decision: models.judgment = inherit → the judgment-tier builder is a default agent told to follow
  `.claude/agents/orch-builder.md` (an agentType would pin the build model); any other value → agentType
  orch-builder with model = the judgment tier.
- Decision: the UI step (orch-ui) runs only with `args.ui: true`, the hook plan 018 fills; default off.
- Decision: readiness questions are asked by the /orchestrate command (main session), not the workflow: a workflow
  cannot ask the Human. The workflow's readiness mode returns the batch.
- Decision: minFreeDiskGb default 5 (most conservative of the plausible values); maxFixRounds 1–5.
- Decision: no ADR — the run mode is opt-in beside the Planner/Worker flow and supersedes no decision (INV-none).
- Evidence:
  - node tools/orchestrator-e2e.mjs → exit 0, `ORCHESTRATOR_E2E: ok — 35 cases passed` (diamond in wave order;
    102 fixed in round 1; 103 env failure retried after `orch-preflight.mjs --env-only`, round 0; 104 pass:true + major
    = fail; status.json on orch/<run> with state/round/sha/models; origin/main unchanged; merge folder clean; 202 parked
    at "fix rounds used: 2 of 2" and wave stopped (203 skipped); 201 INV-1 → judgment; 204 ESCALATE → fresh judgment
    with hand-off; relaunch redoes no merged plan; forbidden-pattern scan of orchestrate.js finds no line; every runner
    command is orch-state/orch-preflight).
  - node --test tools/test/orchestrator.test.mjs → exit 0, pass 7, fail 0.
  - npm run build → exit 0 (`PACK_CHECK: ok`); npm run lint → exit 0 (`LEAK_CHECK: ok`, after fixing two leaks: a
    "3000" literal and a "plans NNN" example in core).
  - npm run test → exit 0 (`INSTALL_CHECK: ok … 0 problems` with the new orchestrator block: files copied, defaults
    and project values render, five bad values refused by install naming the key, sync STOP on maxFixRounds 9;
    `WORKFLOW_LINK_CHECK: ok … 0 missing`).
  - npm run e2e → exit 0 (`ACCEPTANCE_CHECK: ok — 122 checks passed`).
  - node tools/e2e-check.mjs → exit 0 (`E2E_CHECK: ok — 52 cases passed`, incl. the orchestrator test and e2e).
  - node tools/drift-check.mjs --target . → exit 0 (`KIT_DRIFT: ok — 0 undeclared differences`).
- Open ([human]): one real run on a project with 2–3 plans — the Human chooses the project; not done here.
