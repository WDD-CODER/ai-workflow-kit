# Plan 025 — Decision Review and Learning Loop: Agents Log Unasked Choices, the Human Grades Them, Lessons Flow Back

Status: draft
Depends-on: none
Snapshot: a142a8337ab251a266845a3224190d91ee50ecb6

## Problem Statement
On 2026-10-23 a FoodVibe orchestrator run (13 plans, ~$141 at list prices, FoodVibe still on the kit before v1.5.0)
ended with design and behaviour choices Dandan would not have made. Example: on an editable metadata container, a
builder added a generic "save changes?" modal on leaving the screen — a UX decision no plan asked for, on a screen where
the user may have changed many fields. Every check passed, because the checkers judge code against the plan and the
rules, not unasked product choices.

The kit already has half of the loop:
- every role result carries a `decisions` list, and `orch-report` prints it, one line per decision;
- `/ship` writes brain entries automatically after **Y**;
- `docs/agent-evals/` measures the checkers on labelled cases.

What is missing:
1. Nothing tells a builder not to invent behaviour the plan does not describe.
2. Nobody grades the decisions, so a wrong one leaves no trace.
3. A wrong decision never becomes a rule the next builder reads, or an eval case for the checkers.
4. A lesson learned in one project never reaches the kit, so other projects repeat it.
5. A big first batch (28 plans in the first run) is corrected only after everything is built.

This plan closes that loop at near-zero token cost: the only new model work is one short step in `/ship` (or at the
end of a run), and only when the Human graded something.

## Prerequisites
- Kit v1.5.0 released (done: `a142a83`; the kit is now at v1.6.0, which includes it).

## Goals & Success Criteria
**Primary:** after a run or a shipped plan, the Human grades each unasked decision in one reply; every `✗` is logged,
repeated mistakes become short rules builders read, and generic lessons reach the kit as a pull request — with no
command the Human has to run.

- [auto] `core/.claude/agents/orch-builder.md` and `core/.claude/commands/take-plan.md` state the "no invented
  behaviour" rule: a behaviour the plan does not describe (on edit, on leave, on cancel, on error, a new dialog, a new
  confirmation) gets the simplest option and a `decisions` entry tagged `behaviour:` — `grep -n "behaviour:"` finds it
  in both files.
- [auto] `core/.claude/agents/orch-readiness.md` asks product questions for a plan that adds or changes interactive
  behaviour and does not say what happens on edit / leave / cancel / error; a fixture plan in
  `tools/fixtures/orchestrator/` without that section gets a `questions` entry in the readiness test.
- [auto] `orch-report` numbers decisions `D1…Dn` per run, grouped by plan, `behaviour:` ones first; the report ends
  with the reply format `decisions: ok` | `D<n> ✗ <what I'd choose>` (several on one line, comma-separated).
- [auto] `node scripts/decision-log.mjs add` appends graded decisions to `docs/brain/decision-log.md` (seed) — date,
  plan, decision text, verdict, the Human's line, `checker-miss: yes|no`; a test in `tools/test/decision-log.test.mjs`
  covers ok, one ✗, several ✗, and malformed replies (refused with a usage line, nothing written).
- [auto] `node scripts/decision-log.mjs rules --check` fails when `docs/brain/agent-rules.md` (seed) exceeds 30 lines
  or 2,400 characters; the builder reads `agent-rules.md`, never `decision-log.md` (`grep` on `orch-builder.md` and
  `take-plan.md`).
- [auto] `/ship` (after **Y**) and the end of `/orchestrate` (after the Human's decisions reply) run the learning step
  without a command from the Human, **only** when the session has a `✗` decision or a `failed:` card reply: log →
  propose a rule when the same kind of mistake appears twice in the log → kit feedback. No `✗` and no `failed:` → the
  step prints `LEARNING: nothing to record` and costs no model call.
- [auto] `node scripts/kit-feedback.mjs` writes one generalised entry to the kit repository named by
  `.kit/install.json` `source` on a new branch `feedback/<date>-<slug>` with file `feedback/inbox/<date>-<slug>.md`,
  and opens a pull request with `gh`. It refuses (exit 2, nothing pushed) when the text contains the project name,
  the repo name, a path under `paths.srcRoot` / `paths.serverRoot`, or a code fence; `tools/test/kit-feedback.test.mjs`
  covers each refusal and a dry run (`--dry-run` prints the entry and the `gh` call, pushes nothing).
- [auto] `tools/test/eval-cases.test.mjs` accepts a fourth label source `human-verdict <YYYY-MM-DD>:` next to
  `fixed by <sha>`, `clean:` and `planted:`; `docs/agent/agent-evals.md` says such cases stay in the project's own
  `docs/agent-evals/cases/` (they hold project code) and only generic ones go to the kit.
- [auto] `/orchestrate` with more plans than `orchestrator.pilotSize` (new key, integer 0–10, default 3; 0 = off)
  runs a pilot first: the first `pilotSize` plans in wave order, then stops with the report and the decisions list;
  the Human's `continue` starts the rest with the graded decisions and any new rules in place. Install and sync refuse
  another value naming the key.
- [auto] Shared rule in `core/docs/agent/agent-roles.md`: an agent that checks a list of items gets at most 5 items
  per agent; `orchestrate.js` splits `orch-ui` cards into batches of 5, each a fresh agent (orchestrator test covers
  12 cards → 3 agents).
- [auto] `node tools/install-check.mjs`, `node tools/e2e-check.mjs` and `node --test tools/test/` pass; the kit's own
  installed copies are in step (`drift-check` on the kit repo: no `drift`).
- [human] On the next FoodVibe run or shipped plan with a wrong decision: Dandan replies `D<n> ✗ …` once, and without
  running any command he sees the line in FoodVibe's `docs/brain/decision-log.md` and a kit pull request under
  `feedback/inbox/` that names neither FoodVibe nor its code.

## Execution Mode
- Parallel: no.
- Concurrent plans: none.
- Isolated DB: no.
- Kit edits: kit branch `feat/025-decision-review-learning-loop` + kit PR; Dandan merges. Release: minor (new keys
  `orchestrator.pilotSize`; new seeds; nothing a project must do). Tag on Dandan's go, then `kit-sync` into FoodVibe.

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`.

```scope
core/.claude/agents/orch-builder.md
core/.claude/agents/orch-readiness.md
core/.claude/agents/orch-report.md
core/.claude/workflows/orchestrate.js
core/.claude/commands/orchestrate.md
core/.claude/commands/ship.md
core/.claude/commands/take-plan.md
core/.claude/commands/kit-feedback.md
core/scripts/decision-log.mjs
core/scripts/kit-feedback.mjs
core/docs/agent/agent-roles.md
core/docs/agent/agent-evals.md
core/docs/agent/decision-review.md
core/docs/agent/orchestrator.md
core/docs/agent/job-validation.md
core/docs/agent/workflow-map.md
templates/docs/brain/decision-log.md
templates/docs/brain/agent-rules.md
templates/docs/brain/index.md
templates/AGENTS.md
kit.config.json
tools/lib/kit.mjs
tools/install-check.mjs
tools/e2e-check.mjs
tools/test/decision-log.test.mjs
tools/test/kit-feedback.test.mjs
tools/test/eval-cases.test.mjs
tools/test/orchestrator.test.mjs
tools/orchestrator-e2e.mjs
tools/fixtures/orchestrator/**
feedback/README.md
feedback/inbox/.gitkeep
.claude/agents/**
.claude/commands/**
.claude/workflows/**
scripts/**
docs/agent/**
docs/brain/decision-log.md
docs/brain/agent-rules.md
.kit/install.json
CHANGELOG.md
```

## Read Scope

Entire kit repo. FoodVibe's rendered copies of the files above (read only, to check sync conflicts).

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry. Project sync `conflict` rows: STOP, never `--force`. Tags and releases: wait
for Dandan's go.

## Architecture Impact
- INV-none: preserves — workflow instruction files, two new scripts, two new seeds and one config key. No app,
  server or schema file. The kit gains one inbound path (`feedback/inbox/`) that only receives pull requests.

## Step 0 — Reality Check
- `main` is at `a142a83` or later (now `6b456bd`, v1.6.0, with plans 022–024 merged or open); re-read the scoped files
  as they are on `origin/main` and apply the changes below to that text. Plans 022–024 changed `ship.md`,
  `job-validation.md` and the validation docs — read them before editing.
- Find how plan 016 keeps the kit's own installed copies (`.claude/`, `scripts/`, `docs/agent/`) in step with `core/`,
  and use the same command at the end (`node tools/sync.mjs --target . --apply`). Print it in Execution Notes.
- Check that `gh` can create a branch and a pull request on the kit repo from a project folder without a kit
  checkout (`gh api` contents + `gh pr create --repo`). If it cannot, STOP and report what is missing.

## Atomic Sub-tasks
- [x] L1: Stop builders from inventing behaviour nobody asked for — rule in the builder agent and take-plan: a behaviour the plan does not describe gets the simplest option (no new dialog, confirmation or auto-action) and a `behaviour:` decision with one line on how to reverse it — core/.claude/agents/orch-builder.md, core/.claude/commands/take-plan.md
- [x] L2: Make the readiness check ask product questions when a plan leaves out what happens on edit, leave, cancel or error — for a plan that adds or changes interactive behaviour with no "what happens when" lines, `orch-readiness` returns a question per gap; CSS-only and backend-only plans are skipped — core/.claude/agents/orch-readiness.md, tools/fixtures/orchestrator/**, tools/test/orchestrator.test.mjs
- [x] L3: Let the Human grade every decision in one reply by numbering them in the run report — `D1…Dn`, grouped by plan, `behaviour:` first, reply format at the end; same list in the `/ship` close-out for a Worker plan whose Execution Notes logged decisions — core/.claude/agents/orch-report.md, core/docs/agent/orchestrator.md, core/.claude/commands/ship.md, core/docs/agent/job-validation.md
- [x] L4: Record wrong decisions in a log and keep a short capped rules file the builder reads — `scripts/decision-log.mjs` (`add`, `repeats`, `rules --check`); seeds `docs/brain/decision-log.md` and `docs/brain/agent-rules.md` (30 lines / 2,400 characters); the builder and take-plan read `agent-rules.md` only; the brain index names both files — core/scripts/decision-log.mjs, templates/docs/brain/*, tools/test/decision-log.test.mjs
- [x] L5: Turn graded mistakes into logged lessons automatically after the Human replies — `/ship` after **Y** and `/orchestrate` step 4 after the decisions reply: when a `✗` or `failed:` exists, log it, propose a rule when `repeats` finds the same kind twice (shown in the gate, written on the same reply as the brain entry), then call kit feedback for entries marked generic; nothing to record → one line, no model call. Procedure in `docs/agent/decision-review.md` — core/.claude/commands/ship.md, core/.claude/commands/orchestrate.md, core/docs/agent/decision-review.md
- [x] L6: Send generic lessons to the kit as a privacy-checked pull request — `scripts/kit-feedback.mjs` (+ `--dry-run`) and `/kit-feedback` for a manual entry; the privacy refusals listed in Goals; kit side `feedback/README.md` says the Planner turns inbox entries into plans and deletes them when done — core/scripts/kit-feedback.mjs, core/.claude/commands/kit-feedback.md, feedback/**, tools/test/kit-feedback.test.mjs
- [x] L7: Let human verdicts become eval cases for the checkers while keeping project code out of the kit — label source `human-verdict <date>:` and the project-local rule — tools/test/eval-cases.test.mjs, core/docs/agent/agent-evals.md
- [x] L8: Correct a big batch early by running a small pilot of plans first — `orchestrator.pilotSize` (default 3, 0 = off) in `kit.config.json` and its `$comment`; validation in `tools/lib/kit.mjs` and `install-check.mjs`; `/orchestrate` runs the pilot, stops, and continues on `continue` — kit.config.json, tools/lib/kit.mjs, tools/install-check.mjs, core/.claude/commands/orchestrate.md, core/.claude/workflows/orchestrate.js
- [x] L9: Keep checking agents accurate by giving each at most 5 items — shared rule in the roles doc; UI-card agents are run in batches of 5 (12 cards → 3 agents) — core/docs/agent/agent-roles.md, core/.claude/workflows/orchestrate.js, tools/test/orchestrator.test.mjs
- [x] L9b: Catch breakage between plans by running the full build and test suite once after the last merge of a run — `orch-gate` (mechanical tier) runs it on the run branch; a failure is a report finding with the failing command and its output tail, and the run branch is not handed over as clean. (FoodVibe run 2026-10-23: `v2-types.spec.ts:25` broke after merge because plan 424 made two fields required; every checker ran plan-specific specs only, and CI caught it.) Orchestrator test covers a run whose last merge breaks a test outside every plan — core/.claude/workflows/orchestrate.js, core/docs/agent/orchestrator.md, tools/test/orchestrator.test.mjs
- [x] L9c: Make defects an agent noticed but did not fix visible and gradable — any agent that notices a defect outside its job reports it as a `decisions` entry tagged `seen:` with `file:line` or page + steps, never as free text; the report lists them with the decisions so the Human grades them in the same reply. (Same run: ₪NaN at a 100 % target, a blocked chip at 770 px and a doubled verdict were seen by agents and left only as prose.) — core/docs/agent/agent-roles.md, core/.claude/agents/orch-report.md
- [x] L10: Document the new loop and bring the kit's own installed copies in step — workflow map names the new scripts, seeds and steps; one AGENTS.md line ("unasked choices are logged as decisions; see `docs/agent/decision-review.md`"); CHANGELOG `[Unreleased]`; run the Step 0 sync command — core/docs/agent/workflow-map.md, templates/AGENTS.md, CHANGELOG.md
- [x] L11: Prove it all works — install-check, e2e-check, `node --test tools/test/`, drift-check on the kit, and a kit-sync dry run into FoodVibe from the branch with 0 conflict rows

## Out of Scope
- pnpm support (left for later by Dandan, 2026-10-25).
- A full "behaviour" section required in every plan (too many tokens; revisit if L1 + L2 still let surprises through).
- Builder context trimming (`omitClaudeMd` on the builder) — dropped: in the FoodVibe run the auto-loaded CLAUDE.md,
  AGENTS.md and MEMORY.md were ~16k characters (~4k tokens) of a ~42k-token first step; the rest is Claude Code's own
  prompt and tools. The cost driver is the number of steps (builder 487: 83 reads before its first edit), not the
  starting size.
- A planning stage that turns a QA report into plans, and a code map the planner hands to the builder (separate plan).
- Building eval cases automatically from verdicts; L4 only records `checker-miss`.
- Per-role token cost in the run report.

## Critical Questions
- Kit feedback lands as a pull request Dandan merges (default, as written above) — or straight on the kit's `main`
  without review? A wrong or leaking lesson would then reach every project on the next sync. Default stands: PR.

## Execution Notes
Asked for by Dandan on 2026-10-25 after reviewing the cost report of the FoodVibe orchestrator run of 2026-10-23
(FoodVibe on a kit before v1.5.0). Token estimate (not measured): L1–L3 under $0.01 per run; capped rules about
$0.10 per run (600 tokens read on ~500 builder steps); L5–L6 $0.05–0.30, only when something was graded `✗`.
Renumbered 022 → 025 on save: 022–024 were already taken by the validation plans.

Worker notes (2026-10-26):
- Step 0: the kit is installed into itself; the installed copies are brought in step with
  `node tools/sync.mjs --target . --apply` and checked with `node tools/drift-check.mjs --target .` (0 undeclared
  differences). `gh` is signed in; the live branch + pull request path of kit-feedback was not exercised (it would open
  a real pull request) — its refusals and dry run are tested.
- Built in a git worktree (`../ai-workflow-kit-025`): the Planner-folder write guard refuses code writes in the main
  folder even on a feat branch.
- Learning step timing: a proposed rule is written on the same reply as the log row and shown in the wrap-up (no second
  ask); `no rule` in the reply skips it. Mirrors the brain-entry auto-write.
- The run report is built by `orch-state finish` from run notes, so the workflow records each numbered decision as a
  run note (`D1 …`) rather than adding a report field (`orch-state.mjs` is outside the scope).
- Resolved after `approved: tools/orchestrator-e2e.mjs` (path added to the scope; `pilotSize: 0` added there). Was BLOCKED (L11): `orchestrator.pilotSize` defaults to 3, so `tools/orchestrator-e2e.mjs` (4-plan runs) now pilots and
  stops early: 5 of 64 e2e cases fail. The fix is one line there — `pilotSize: 0` in the `orchestrator:` object of its
  generated `kit.config.json` (line 78). That file is outside the Read-Write Scope; waiting for `approved:
  tools/orchestrator-e2e.mjs`.
