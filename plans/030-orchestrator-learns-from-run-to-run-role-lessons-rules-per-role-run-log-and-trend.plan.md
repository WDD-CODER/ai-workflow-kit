# Plan 030 — The Orchestrator Learns From Run to Run: Role Lessons Written by Scripts, Rules for Every Role, a Run Log the Next Run Reads, and Trend Numbers

Status: draft
Depends-on: 029
Snapshot: 7109f6143c2566b502f1fe8994b16b60f1a6b911

## Problem Statement
Plan 025 (kit v1.7.0) built half of a learning loop: a builder logs unasked choices, the Human grades them once
(`D<n> ✗ …`), a graded mistake is logged to `docs/brain/decision-log.md`, a mistake that repeats becomes a rule in
`docs/brain/agent-rules.md`, and a generic lesson goes to the kit as a pull request. It costs no model call when
nothing was graded wrong. That half works, but on its own the orchestrator does not get better from one run to the
next:

1. **Only the builder reads what was learned.** `orch-readiness`, the three finders (`orch-check-plan`,
   `orch-check-bugs`, `orch-check-rules`), `orch-security`, `orch-verify` and `orch-ui` read no rule and no lesson. A
   checker that missed something once misses it again.
2. **Only product mistakes are learned.** Everything the run itself knows — plans parked and why, fix rounds and what
   caused them, builders escalated to the judgment tier, gate timeouts, candidates the verifier refuted, defects the
   final gate or the browser found after the checkers passed — is written to `docs/orchestrator/runs/<run>/report.md`
   and read by nobody in the next run.
3. **A rule is written only on the second mistake of a kind.** The first one is logged and forgotten by the agents.
4. **`checker-miss: yes` does nothing.** It is a column in the log; it becomes neither a checker rule nor an eval case
   (step 5 of `decision-review.md` is optional and manual).
5. **The kit side is manual.** A lesson lands in `feedback/inbox/` and waits for someone to turn it into a plan; a
   lesson that arrives from two projects looks like two unrelated files.
6. **Nothing is measured.** There is no number that says whether `✗` per plan, parked plans per run or fix rounds per
   plan go down from run to run — so nobody can tell whether the loop helps.
7. **The Planner never hears back.** A question `orch-readiness` had to ask, or a UI card marked `plan-drift`, is a gap
   in the plan as written; today it reaches the run report and no plan review.

The community pattern this follows (a version-controlled rules file every session reads, written from accepted review
comments and run facts, with a hard size cap) reported zero recurrences across 9 tracked error classes after four
weeks in one deployment. Two of its findings shape this plan: an **enforced** check beats a written rule (an agent can
skip an instruction, not a failing check), and every line loaded into every session is paid for in every session, so
each role reads only its own short file.

**Design rule of this plan:** everything a script can know from `status.json` and the Human's reply, a script
writes — no model call. The model is used only to word a new rule, and only when the Human graded something `✗`.
That keeps the v1.7.0 guarantee: no `✗` → `LEARNING: nothing to record` → zero model calls.

## Prerequisites
- Kit v1.9.0 released (done: `7109f61`).
- Plan 029 merged (`Depends-on: 029`): this plan builds on its `ask()` wrapper around every `agent()` call, its
  `orch-run.mjs` helpers, its agent-call and note caps, and its "always `finish`" path.

## Goals & Success Criteria
**Primary:** every role agent of the orchestrator starts with the short lessons of its own role from earlier runs in
this project, the next run's readiness check knows what parked plans in the last runs, a graded checker miss becomes a
checker rule and an eval case without a command from the Human, the Planner's plan review reads the gaps earlier
plans had, and the run report ends with one trend line that shows whether `✗` per plan and fix rounds per plan are
going down.

- [auto] **Role lessons files.** Seeds (written once) `docs/brain/agent-lessons/<role>.md` for the roles `readiness`,
  `builder`, `check-plan`, `check-bugs`, `check-rules`, `security`, `verify`, `ui`, `gate`, `planner`. Each file: a
  two-line header, then at most **40 lines / 3,000 characters** of `- <YYYY-MM-DD> <run>: <lesson>` lines, newest
  last. `node scripts/decision-log.mjs lessons --check` fails when any file exceeds the cap; `lessons --add --role <r>
  --text "<line>"` appends and, when the cap would be exceeded, drops the oldest lines first and prints which ones.
  `docs/brain/index.md` names the folder.
- [auto] **Scripts write the facts.** `node scripts/orch-state.mjs lessons --run <name>` runs inside `finish` (and
  on its own) and derives lesson lines from `status.json` with **no model call**, one line per fact, deduplicated
  against lines already in the file (same fact kind + same subject = no new line):
  - `builder`: every fix round's cause (`round 2: checker: major src/x.ts:12 <rule>` → `fix round caused by: <rule>
    (<file kind>)`), every escalation to the judgment tier with the hand-off `step` and `check`, every parked plan
    with its reason;
  - `check-plan` / `check-bugs` / `check-rules` / `security`: candidates the verifier **refuted** (`<n> of <m>
    candidates refuted: <rule names>`) — a precision signal; and `missed: <what>` when the final gate or a UI card
    failed on a plan whose finders had all passed (the miss goes to every finder that ran on that plan);
  - `verify`: candidates kept with confidence below the keep threshold that later caused a fix round, and refuted
    candidates whose problem reappeared in a later round;
  - `readiness`: every plan parked for an `environment:` or `questions` reason the readiness result had marked ready
    (`parked on <reason kind> after ready`);
  - `gate`: every timeout and every `env-fail` that was rerun, with the command;
  - `ui`: every card that failed in the browser after its script had passed, with the card title;
  - `planner`: every question `orch-readiness` asked (`plan <NNN> had to be asked: <question>`) and every UI card
    with verdict `plan-drift` (`plan <NNN> drifted from its card: <card title>`) — the plan author's own gaps.
  A fixture `status.json` in `tools/fixtures/orchestrator/` covers each fact kind; `tools/test/orchestrator.test.mjs`
  shows the expected lines and the dedupe.
- [auto] **Every role reads its lessons.** `orchestrate.js` passes the role's lessons as `LESSONS` in the task of
  every role agent (readiness, builder, gate, the finders, security, verify, ui) — a **JSON array of lines** (`task()`
  JSON-encodes a non-string value on one line; a raw multi-line body would break the one-`KEY: value`-per-line task
  block); an empty or missing file passes `LESSONS: []`. Every one of the nine `orch-*.md` role files says, in its
  first numbered step: "Read `LESSONS` first: facts from earlier runs of your role in this project. They do not
  replace the plan or the rules; they tell you where this role was wrong before." `grep -n "LESSONS"
  core/.claude/agents/orch-*.md` finds it in those nine files (not `orch-merge.md`, not `orch-report.md`); the
  orchestrator test asserts the block is present in each launched task.
- [auto] **The Planner reads its lessons.** `core/.claude/commands/plan.md` Architect + PM review gains a first check:
  read `docs/brain/agent-lessons/planner.md` (when it exists) and, for each lesson whose question or drift the draft
  would repeat, add an `open:` line. `brief-detection`'s option **a** inherits it through the same review. No new
  script: the file is read as text.
- [auto] **Rules for every role.** `docs/brain/agent-rules.md` (seed and the `rules` commands) is split into sections
  `## builder`, `## checkers`, `## readiness`, `## ui`; the **30 lines / 2,400 characters cap applies per section**
  (`rules --check` reports the section that is over). `rules --add --section <s> "<rule>"` (default `builder`, so the
  v1.7.0 call keeps working). `orchestrate.js` passes the matching section as `RULES` (JSON array of lines) to the
  finders and the verifier (`checkers`), to `orch-readiness` (`readiness`) and to `orch-ui` (`ui`); the builder keeps
  reading the file itself (its section). The Worker's `take-plan` reads `## builder` only.
- [auto] **Readiness reads the run log.** New seed `docs/brain/run-log.md`: a table with one row per run — date,
  run, plans, merged, parked, parked reason kinds, fix rounds total, escalations, gate fails, final gate, `✗` count,
  checker-miss count, `✗` per plan. `orch-state.mjs finish` appends the row (counts from `status.json`) **and fills the
  `✗` columns of every earlier row from `docs/brain/decision-log.md`** (a log row belongs to a run when its plan number
  is in that run-log row's plan list; the newest run's own `✗` columns stay `-` until the next `finish`). One writer per
  file: `decision-log.mjs add` gains no `--run` flag and never touches `run-log.md`. The table keeps the **20 newest
  rows**; `finish` rolls older rows into one `Earlier (N runs): …` summary line above the table with the same columns
  averaged. `orchestrate.js` passes the last 3 rows and their parked reasons to `orch-readiness` as `RECENT_RUNS`;
  `orch-readiness.md` says: a reason kind that parked a plan in two of the last three runs is asked about **before**
  the run starts, as one question for the whole run, not per plan.
- [auto] **A checker miss becomes a rule and an eval case by itself.** In the learning step
  (`decision-review.md` §3), a `✗` graded `checker-miss: yes`:
  1. gets a rule proposal for `## checkers` (same model step that words the builder rule; `no rule` skips it);
  2. gets an eval case scaffold with **no model call**: `node scripts/decision-log.mjs case --from D<n> --run <name>`
     writes `docs/agent-evals/cases/<checker>/<date>-<kind slug>/` in the harness shape (`docs/agent/agent-evals.md`
     "Case layout", `tools/test/eval-cases.test.mjs`): `input/plan.md`, `input/diff.patch` (the hunk around the
     decision's `file:line` from `git show` on the plan branch), the touched file(s) under `input/`, and
     `expected.json` with one finding at that `file:line` and a `note` that starts `human-verdict <date>: <the Human's
     line>`; a short `README.md` names the finder that ran. `tools/test/eval-cases.test.mjs` accepts the scaffold
     (`findCases` lists it, `caseKind` says `findings`). Project code stays in the project (unchanged rule from plan
     025). The wrap-up prints the case path.
- [auto] **Enforce before instructing.** The learning step's rule proposal first asks (in the same model step) whether
  the mistake can be caught by a check, a hook or a test instead of a rule; the answer is either `rule: <text>` or
  `enforce: <what would catch it, one line>`. `rules --add` accepts a line starting with `enforce:` and files it under
  a `## enforce candidates` section (cap 10 lines) that **no agent reads**; the wrap-up lists the section's lines
  under "Enforce candidates (a plan each, when you want them)". The Human's `plan it: <n>` is not handled by this plan
  (it is a normal `/plan`).
- [auto] **A rule starts at the first `✗`.** `decision-log.mjs add` with a `✗` whose kind has no earlier log row
  proposes the rule at once with the suffix ` (pending — seen once)`; `repeats` promotes it (drops the suffix) on the
  second row of that kind. Pending lines count toward the cap and are read by the agents like any other line. The test
  covers first `✗` → pending, second → promoted, and `rules --check` counting both.
- [auto] **Trend line.** `node scripts/orch-state.mjs trend` prints, from `run-log.md`, the last 10 runs' `✗` per plan,
  fix rounds per plan and parked per run; `orch-report` ends the report with one line, e.g.
  `Trend (last 3 runs): ✗ per plan 0.6 → 0.3 → 0.2 · fix rounds per plan 0.8 → 0.5 → 0.4 · parked 2 → 1 → 0`. With
  fewer than 2 rows: `Trend: first logged run`.
- [auto] **Kit side.** `tools/kit-inbox.mjs` (kit-only: `tools/` is never installed) lists `feedback/inbox/` grouped
  by slug similarity (`plan-name-similarity.mjs` logic) and prints one draft plan block per group that the kit's
  Planner can paste into `/plan`; a kit command `/kit-inbox` lives only in the kit's own `.claude/commands/kit-inbox.md`
  (not under `core/`, so it is never rendered into a project; `install-check` asserts a fresh install has no
  `kit-inbox.md`). `scripts/kit-feedback.mjs` checks, before opening a pull request, whether an open inbox file with
  the same slug exists on the kit (`gh api` on `feedback/inbox/`); if so it adds a `seen-in: N` line to that file in a
  pull request instead of a new file, and the inbox README says an entry with `seen-in: 2` or more is a priority.
  `tools/test/kit-feedback.test.mjs` covers the `seen-in` path with a stubbed `gh`; `--dry-run` prints which path was
  chosen.
- [auto] **Budget printed, not guessed.** `orch-state.mjs lessons` and `finish` print the size in characters of every
  `LESSONS`, `RULES` and `RECENT_RUNS` block the next run will inject, and the report carries the total ("Context
  added by learning: 3.1k chars across 10 roles"). The orchestrator test asserts the line.
- [auto] `node tools/install-check.mjs`, `node tools/e2e-check.mjs`, `node --test tools/test/` pass; the kit's own
  installed copies are in step (`node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .`:
  0 undeclared differences); a `kit-sync` dry run into FoodVibe from the branch has 0 `conflict` rows.
- [human] On the next FoodVibe run: after the run report, the Human opens `docs/brain/agent-lessons/check-bugs.md`,
  `docs/brain/agent-lessons/planner.md` and `docs/brain/run-log.md` on the run branch and sees lines they did not
  write; after replying `D<n> ✗ …` once on a checker miss, they see a `## checkers` rule marked pending and a new
  folder under `docs/agent-evals/cases/`, with no command run; the report's last line is a trend line.

## Execution Mode
- Parallel: no.
- Concurrent plans: none.
- Isolated DB: no.
- Kit edits: kit branch `feat/030-orchestrator-learns-from-run-to-run` + kit PR; the Human merges. Release: minor
  (new seeds `docs/brain/agent-lessons/*`, `docs/brain/run-log.md`; new script commands; nothing a project must do — a
  project without the seeds gets `LESSONS: []` until its first run writes them). Tag on the Human's go, then
  `kit-sync` into FoodVibe.

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`.

```scope
core/.claude/agents/orch-builder.md
core/.claude/agents/orch-readiness.md
core/.claude/agents/orch-gate.md
core/.claude/agents/orch-check-plan.md
core/.claude/agents/orch-check-bugs.md
core/.claude/agents/orch-check-rules.md
core/.claude/agents/orch-security.md
core/.claude/agents/orch-verify.md
core/.claude/agents/orch-ui.md
core/.claude/agents/orch-report.md
core/.claude/workflows/orchestrate.js
core/.claude/commands/orchestrate.md
core/.claude/commands/plan.md
core/.claude/commands/ship.md
core/.claude/commands/take-plan.md
core/scripts/orch-state.mjs
core/scripts/lib/orch-run.mjs
core/scripts/decision-log.mjs
core/scripts/kit-feedback.mjs
core/docs/agent/agent-roles.md
core/docs/agent/agent-evals.md
core/docs/agent/decision-review.md
core/docs/agent/orchestrator.md
core/docs/agent/workflow-map.md
templates/docs/brain/agent-rules.md
templates/docs/brain/agent-lessons/**
templates/docs/brain/run-log.md
templates/docs/brain/index.md
templates/AGENTS.md
tools/kit-inbox.mjs
tools/lib/kit.mjs
tools/install-check.mjs
tools/e2e-check.mjs
tools/orchestrator-e2e.mjs
tools/test/orchestrator.test.mjs
tools/test/decision-log.test.mjs
tools/test/kit-feedback.test.mjs
tools/test/eval-cases.test.mjs
tools/test/kit-inbox.test.mjs
tools/fixtures/orchestrator/**
feedback/README.md
.claude/commands/kit-inbox.md
.claude/agents/**
.claude/commands/**
.claude/workflows/**
scripts/**
docs/agent/**
docs/brain/agent-rules.md
docs/brain/agent-lessons/**
docs/brain/run-log.md
docs/brain/index.md
.kit/install.json
CHANGELOG.md
```

## Read Scope

Entire kit repo. FoodVibe's rendered copies of the files above and its `.claude/orchestrator-runs/*/status.json`
files (read only: real `status.json` shapes for the fixture, and sync-conflict checks).

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry. Project sync `conflict` rows: STOP, never `--force`. Tags and releases: wait
for the Human's go.

## Architecture Impact
- INV-none: preserves — workflow instruction files, script commands, seeds under `docs/brain/`, one kit-only tool.
  No app, server or schema file. The orchestrator gains no new agent and no new model call on a run; the only model
  work added is inside the existing learning step and only on a `✗`.

## Step 0 — Reality Check
- `main` holds plan 029 merged (`Depends-on: 029`); re-read every scoped file as it is on `origin/main` and apply the
  changes below to that text. Plans 026–029 changed `orchestrate.js`, `orch-state.mjs`, `orch-run.mjs`, `orch-gate.md`,
  `orchestrate.md` and `orchestrator.md` after plan 025 — read them before editing. In particular: every `agent()` call
  goes through 029's `ask()` — `LESSONS` and `RULES` are added to the task text before `ask()`, never by a second
  call path; `set --candidates …` and `lessons` are agent calls that count toward 029's `maxAgentCallsPerPlan`, so L2
  adds at most one `set` per plan after verify and one after a final-gate or UI miss; `lessons` runs inside `finish`
  (one call per run, not per plan).
- Read `status.json` as `orch-state.mjs` writes it today (`plans[nnn]`: `state`, `round`, `tier`, `reason`, `models`,
  `history`, `humanItems`, cards; `notes[]`; `stopReason`) and list in Execution Notes which of the lesson facts above
  are derivable from it **as is** and which need one more field written by the workflow (likely: the verifier's
  per-candidate verdicts and the finders' candidate counts are only in the workflow's memory today — add a
  `orch-state.mjs set --plan <NNN> --candidates <m> --refuted <n> --refuted-rules <a,b>` call after the verify step,
  a `--miss <what>` call when the final gate or a UI card fails after a clean checker pass, and the readiness
  questions per plan, which `readiness()` already returns). Do not derive a fact by re-reading agent transcripts.
- `task()` (`orchestrate.js`) emits one `KEY: value` line per field and JSON-encodes a non-string value: pass
  `LESSONS`, `RULES` and `RECENT_RUNS` as arrays of lines. Confirm `omitClaudeMd: true` agents still receive the task
  text (they do today).
- Check whether the workflow runtime exposes token usage per agent result. If it does, add `tokens` per role to the
  run-log row; if it does not, leave it out and say so in Execution Notes (the "budget printed" item then counts
  characters only, as written).
- Confirm `tools/orchestrator-e2e.mjs` runs with the new `LESSONS: []` path (no seeds in its generated project) and
  that `pilotSize: 0` there still holds.
- Print the Step 0 sync command (`node tools/sync.mjs --target . --apply`) in Execution Notes.

## Atomic Sub-tasks
- [ ] L1: Give every orchestrator role, and the Planner, a short lessons file with a hard cap — seeds `docs/brain/agent-lessons/<role>.md` (10 roles, header + ≤40 lines / 3,000 chars), `decision-log.mjs lessons --check | --add --role <r> --text "<line>"` (oldest lines dropped first, printed), `docs/brain/index.md` names the folder — templates/docs/brain/agent-lessons/**, templates/docs/brain/index.md, core/scripts/decision-log.mjs, tools/test/decision-log.test.mjs
- [ ] L2: Make the workflow record the facts the lessons need — after verify: `orch-state.mjs set --candidates --refuted --refuted-rules`; after a final-gate or UI failure on a plan with a clean checker pass: `set --miss "<what>"`; readiness questions and `plan-drift` cards already in `status.json` are confirmed or added; field names documented in `orchestrator.md` §status.json — core/.claude/workflows/orchestrate.js, core/scripts/orch-state.mjs, core/docs/agent/orchestrator.md, tools/test/orchestrator.test.mjs
- [ ] L3: Write the lessons from the run's state file with no model call — `orch-state.mjs lessons --run <name>` (also inside `finish`): the per-role facts listed in Goals, including the `planner` lines, deduplicated, written through `decision-log.mjs lessons --add`; fixture `status.json` with every fact kind; expected lines in the test — core/scripts/orch-state.mjs, core/scripts/lib/orch-run.mjs, tools/fixtures/orchestrator/**, tools/test/orchestrator.test.mjs
- [ ] L4: Hand every role its lessons at launch — `LESSONS` as a JSON array of lines (`[]` when none) in every role task, added before 029's `ask()`; first numbered step of all nine role `orch-*.md` files; orchestrator test asserts the block per launched role — core/.claude/workflows/orchestrate.js, core/.claude/agents/orch-*.md, core/docs/agent/agent-roles.md
- [ ] L5: Split the rules file into one section per role and hand each role its section — `## builder`, `## checkers`, `## readiness`, `## ui` (+ `## enforce candidates`, never read); cap per section; `rules --add --section`; `RULES` passed to finders, verifier, readiness and ui; builder and take-plan read `## builder` — templates/docs/brain/agent-rules.md, core/scripts/decision-log.mjs, core/.claude/workflows/orchestrate.js, core/.claude/agents/orch-builder.md, core/.claude/commands/take-plan.md, tools/test/decision-log.test.mjs
- [ ] L6: Keep a run log and let readiness read it — seed `docs/brain/run-log.md` (20 rows + rolled summary); `finish` appends the row and fills earlier rows' `✗` columns from `decision-log.md` (one writer); `RECENT_RUNS` (last 3 rows + parked reasons) to `orch-readiness`, which asks once per run about a reason kind that parked a plan in two of the last three runs — templates/docs/brain/run-log.md, core/scripts/orch-state.mjs, core/.claude/workflows/orchestrate.js, core/.claude/agents/orch-readiness.md, tools/test/orchestrator.test.mjs
- [ ] L7: Turn a graded checker miss into a checker rule and an eval case without a command — `decision-review.md` §3: rule proposal for `## checkers` on `checker-miss: yes`; `decision-log.mjs case --from D<n> --run <name>` writes the harness-shaped scaffold (`input/plan.md`, `input/diff.patch`, touched files, `expected.json` with a `human-verdict <date>:` note, `README.md`); `eval-cases.test.mjs` accepts it; `/ship` and `/orchestrate` call it inside the existing learning step — core/scripts/decision-log.mjs, core/docs/agent/decision-review.md, core/docs/agent/agent-evals.md, core/.claude/commands/ship.md, core/.claude/commands/orchestrate.md, tools/test/eval-cases.test.mjs, tools/test/decision-log.test.mjs
- [ ] L8: Prefer an enforced check over a written rule, and start a rule at the first graded mistake — the rule step answers `rule:` or `enforce:`; `enforce:` lines go to `## enforce candidates` and are listed in the wrap-up; first `✗` of a kind → rule with ` (pending — seen once)`, `repeats` promotes it; tests for pending → promoted and for the enforce section — core/scripts/decision-log.mjs, core/docs/agent/decision-review.md, core/.claude/commands/ship.md, core/.claude/commands/orchestrate.md, tools/test/decision-log.test.mjs
- [ ] L9: Show whether it works — `orch-state.mjs trend` from the run log; `orch-report` ends with the trend line (or `Trend: first logged run`); `finish` prints the character budget of every injected block and the report carries the total — core/scripts/orch-state.mjs, core/scripts/lib/orch-run.mjs, core/.claude/agents/orch-report.md, core/docs/agent/orchestrator.md, tools/test/orchestrator.test.mjs
- [ ] L10: Close the kit side — `tools/kit-inbox.mjs` + `/kit-inbox` (kit-only: the command file lives outside `core/` and is never rendered; `install-check` asserts a fresh install has none); `kit-feedback.mjs` `seen-in: N` on a matching open inbox file (stubbed `gh` in the test; `--dry-run` names the path); `feedback/README.md` says `seen-in: 2` or more is a priority — tools/kit-inbox.mjs, .claude/commands/kit-inbox.md, core/scripts/kit-feedback.mjs, tools/install-check.mjs, feedback/README.md, tools/test/kit-inbox.test.mjs, tools/test/kit-feedback.test.mjs
- [ ] L11: Let the Planner learn from the gaps its earlier plans had — `/plan`'s Architect + PM review reads `docs/brain/agent-lessons/planner.md` first and adds an `open:` line for a question or drift the draft would repeat; `agent-roles.md` lists the planner role's lessons — core/.claude/commands/plan.md, core/docs/agent/agent-roles.md, core/docs/agent/decision-review.md
- [ ] L12: Document and bring the kit's own copies in step — `workflow-map.md` names the new seeds, commands and steps; `decision-review.md` has a §0 "What learns what" table (fact → who writes it → who reads it → cap); one `AGENTS.md` line ("every orchestrator role and the Planner read their own lessons and rules section; see `docs/agent/decision-review.md`"); CHANGELOG `[Unreleased]`; run the Step 0 sync command — core/docs/agent/workflow-map.md, core/docs/agent/decision-review.md, templates/AGENTS.md, CHANGELOG.md
- [ ] L13: Prove it all works — install-check, e2e-check, `node --test tools/test/`, `tools/orchestrator-e2e.mjs`, drift-check on the kit, and a `kit-sync` dry run into FoodVibe from the branch with 0 `conflict` rows

## Out of Scope
- Claude Code's subagent `memory:` frontmatter field (`.claude/agent-memory/<name>/`): not used. It depends on auto
  memory being enabled in the session, its behaviour across worktrees is undocumented, and the agent would write its
  own memory (1–3 extra steps per launch, before it knows whether its findings were right). The lessons files do the
  same job, written by scripts from verified facts, synced by the kit, capped by `lessons --check`.
- Per-role token cost in the run log — only if Step 0 finds the runtime exposes it; otherwise stays out.
- Rules or lessons for the Worker (`/take-plan`) beyond reading `## builder` — the Worker's own learning is `/ship`'s
  brain capture and the decision review, unchanged.
- A `lessons` writer for `/ship` or `/plan` sessions (facts outside an orchestrator run): the planner file is written
  from `status.json` only in this plan.
- Automatic creation of a plan from an `enforce:` candidate or from `/kit-inbox` output — both print a draft; the
  Human runs `/plan`.
- Evaluating a new checker rule against the eval set before it is written (an EvoSkill-style gate) — revisit once
  FoodVibe's case set is large enough to gate on (`docs/agent-evals/BASELINE.md`).
- Vector search over lessons — the files are capped so they fit in the prompt whole.

## Critical Questions
- Lessons by prompt injection from a kit-managed file (default, as written) — or Claude Code's `memory: project`
  field on each agent? The default works whatever the session's auto-memory setting is, keeps the write deterministic
  and keeps the cap in the kit's hands. Default stands unless the Human says otherwise.
- First `✗` → pending rule written by the learning step (default, as written) — or only when the Human adds a
  `rule:` token to the `✗`? Default stands: the pending suffix tells agents how much to trust the line.
- A lesson line whose fact repeats across runs (the same refuted rule name three runs in a row): stay a lesson, or be
  promoted to a `## checkers` rule by the script with no model call? Default: stays a lesson; the Human sees the
  repetition in the file and in the trend line.
- Q: Where do the run-log `✗` columns get filled, given `finish` writes on the run branch and the learning step runs
  later in the main folder? A: the next `finish` fills earlier rows from `decision-log.md`; `add` never writes
  `run-log.md` (Human, 2026-10-28, `runlog: next-finish`).
- Q: A `planner` role too? A: yes — readiness questions and `plan-drift` cards become planner lessons that `/plan`'s
  review reads (Human, 2026-10-28, `planner: yes`).

## Execution Notes
- Asked for by the Human on 2026-10-28 after reviewing what plan 025 left open. Budget (estimate, not measured — L9
  measures it): a lessons file kept near its cap is ~1–1.5k tokens per launch, the same prefix for every launch of one
  role in a run, so mostly cache reads; ~6 roles × a 28-plan run ≈ 250k input tokens, under 1% of such a run at list
  prices. `RECENT_RUNS` ≈ 0.5k per readiness agent. `lessons`, `finish`, `trend`, `case` and `kit-inbox` are scripts:
  no model call, under a second each. The learning step's model work grows only by the `rule:`/`enforce:` question and
  the first-`✗` proposal, both inside the one step that already exists, and only on a `✗`. One fix round avoided
  (builder + gate + 3–4 finders + verify ≈ 6–8 launches, 50–150k tokens, 10–20 minutes) pays for a whole run's lessons.
- Planner review (2026-10-28, against `origin/main` `5f490a6`): saved as 030 (029 was taken); `Depends-on: 029`
  because both plans rewrite `orchestrate.js` `finish`/notes, `orch-state.mjs`, `orch-run.mjs`, `orchestrator.md` and
  `orchestrate.md`; the eval scaffold follows the harness shape (`input/` + `expected.json`), not a `label.md`;
  `LESSONS`/`RULES`/`RECENT_RUNS` travel as JSON arrays because of how `task()` renders values; `/kit-inbox` needs no
  exclusion list — a file outside `core/` is never rendered. Overlap search: no similar title; scope overlap only with
  merged plans 022–028 and with 029 (now a dependency).
