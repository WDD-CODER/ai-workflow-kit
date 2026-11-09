# Plan 108 — the plan gate runs each check once, `ciMirror` marks final-only commands, and the builder runs only its own tests

Status: draft
Parked: 2026-11-09 — the Human froze new work until the workflow runs clean on FoodVibe; reopen only when a validation case, a CI check or a real run fails on what this plan fixes.
Depends-on: none
Snapshot: bf79f22
Source: Human, 2026-11-09 — "how many checks do we run per plan, how long, which are redundant". Measured on the kit's
own runs (`.claude/orchestrator-runs/run-095/calls.csv`, `run-100/calls.csv`): a plan's gate takes 17–29 minutes, of
which ~13 minutes are `ciMirror` commands that only need to run once per run (`e2e-check` 463–522 s, `acceptance-check
--e2e` 119–166 s) or already ran inside `npm test` (`install-check` 155–222 s, `workflow-link-check` 9–13 s); the builder
runs the whole check list itself before `built` (~10 min of model time per round) and the gate repeats it; the final
gate runs `install-check` twice. Reliability and cost fix, allowed in the freeze (Human, 2026-11-09); no new agent,
no model call added, no `kit.config.json` key added.

## Problem Statement
1. **`ciMirror` runs in every plan gate since plan 103 (e).** The kit's `.kit/config.json` lists six commands; two of
   them install the kit into a scratch project (`e2e-check`, `acceptance-check --e2e`) and prove the whole run branch,
   not one plan. Per plan they cost ~11 minutes and find nothing the final gate would not. The final gate has its own
   fix round since 103 (f), so a late failure is no longer unrecoverable.
2. **The gate runs the same check twice.** `gateCommands` (`core/scripts/lib/plan-gate.mjs`) deduplicates by exact
   string only. `npm run test` on the kit is `node tools/install-check.mjs && node tools/workflow-link-check.mjs && node
   --test …`, and `ciMirror` names `node tools/install-check.mjs` and `node tools/workflow-link-check.mjs` again: both
   run twice in every plan gate and twice in the final gate (`finalChecks`, `run-plans.mjs` l.1329 region). A plan whose
   Done-when names `node --test tools/test/run-plans.test.mjs` and `node --test "tools/test/*.test.mjs"` runs the first
   (371–687 s) twice.
3. **The builder repeats the gate.** `core/.claude/agents/orch-builder.md` step 4: "Run the project checks and every
   `[auto]` command; all must pass before you return `built`." On the kit that is 8–11 minutes in which the builder
   writes no file — against `BUILDER_IDLE_MIN` 15 — and the gate then runs the identical list.

## Goals & Success Criteria
**Primary:** every command of a plan's gate runs once; a `ciMirror` command the project marks `final:` runs only in
the final gate; the builder runs lint, the build and the test files it changed, and the gate is the proof.

- [auto] `node --test tools/test/lean-gate.test.mjs` passes, with cases that fail on today's code (pure-function
  tests of `gateCommands`, `ciMirrorChecks` and the new builder prompt text; no fake run):
  (a) a `ciMirror` entry `final: node tools/e2e-check.mjs` is not in `gateCommands(...)` for a plan gate and is in the
  final gate's list as `node tools/e2e-check.mjs` (prefix stripped); an entry without the prefix is in both, as today;
  (b) a command that is a `&&`-segment of a script the gate already runs (`npm run <build|lint|test>` bodies from
  `package.json`) is dropped from the gate and from the final gate: with `test` = `node tools/install-check.mjs && node
  tools/workflow-link-check.mjs`, neither `node tools/install-check.mjs` nor `node tools/workflow-link-check.mjs` appears
  again, whether it came from `ciMirror` or from a plan's `[auto]` list; a segment with different flags is kept;
  (c) `node --test <file>` is dropped when another gate command is `node --test "<glob>"` whose glob matches the file
  (`picomatch`, already a `scripts/` dependency); the glob command stays; a file the glob does not match is kept;
  (d) the dry run prints one `gate: <n> command(s), <m> not repeated: <command> (in npm run test) · <command> (in
  "<glob>")` line per plan, so the author sees what was dropped and why; with nothing dropped the line ends `0 not
  repeated`;
  (e) `.claude/agents/orch-builder.md` (installed copy) step 4 says the builder runs the lint script, the build script
  and `node --test <file>` for each test file it added or changed, and says the gate runs the project's whole check
  list; the words "every `[auto]` command" are gone from that step; the file stays ≤ 120 lines (size budget
  `agentLines`).
- [auto] `node --test tools/test/size-budget.test.mjs` passes (no new `orchestrator` key: the `final:` prefix lives in
  the existing `ciMirror` list).
- [auto] `node tools/install-check.mjs` passes with a fixture `kit.config.json` whose `ciMirror` holds `final: node
  tools/e2e-check.mjs`: install and sync accept the prefix, and the `NOTE ci-mirror:` comparison against the CI workflow
  strips it before matching (a CI command covered only by a `final:` entry is covered).
- [auto] `.kit/config.json` of this repository marks `node tools/e2e-check.mjs` and `node tools/acceptance-check.mjs
  --e2e` as `final:`; after `node tools/sync.mjs --target . --apply`, `node scripts/run-plans.mjs --dry-run --run lean
  --plans 108` prints a plan gate with neither command and the final gate with both, and
  `node tools/drift-check.mjs --target .` reports no drift.
- [auto] `docs/agent/orchestrator.md`: the `ciMirror` row describes the `final:` prefix; the gate paragraph in **The
  run** step 3 says a command is never run twice in one gate and names the two rules (script segment, test glob); the
  **Model calls** section says the builder runs only lint, build and its own test files.
- [auto] The gate's own checks pass: `npm run build`, `npm run lint`, `npm test`, `node tools/drift-check.mjs --target .`
  (the builder runs the kit sync with apply first; it is a step, not a check).
- [human] On the next kit orchestrator run, `calls.csv` shows no `gate: node tools/e2e-check.mjs` and no `gate: node
  tools/install-check.mjs` row for any plan, one `final gate: node tools/e2e-check.mjs` row per final gate, and the plan
  gate's rows sum to under 10 minutes for a plan that lists `run-plans.test.mjs` (reply `ok` with the run name).

## Execution Mode
- Parallel: no. Concurrent plans: none.
- Solo kit flow: `feat/108-<slug>` in this folder, then `/ship` (this plan edits `core/.claude/**`, which an unattended
  builder cannot). Run before 109 (both change `core/scripts/run-plans.mjs`).

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspot
`CHANGELOG.md`.

```scope
core/scripts/run-plans.mjs
core/scripts/lib/plan-gate.mjs
core/.claude/agents/orch-builder.md
core/docs/agent/orchestrator.md
tools/install.mjs
tools/sync.mjs
tools/lib/**
tools/test/lean-gate.test.mjs
tools/test/fixtures/**
.kit/config.json
scripts/run-plans.mjs
scripts/lib/plan-gate.mjs
.claude/agents/orch-builder.md
docs/agent/orchestrator.md
```

(The installed copies — `scripts/**`, `.claude/**`, `docs/agent/**` — are rewritten by `node tools/sync.mjs --target .
--apply`.)

## Read Scope

Entire repo. `.claude/orchestrator-runs/run-095/calls.csv` and `run-100/calls.csv` hold the measurements this plan
rests on.

## Escalation Protocol

If a step needs a file outside the `## Read-Write Scope` (the `ciMirror` validator lives somewhere else, a test needs
the shared fixture `tools/test/lib/run-plans-fixture.mjs`): STOP, tell the Human the file, the change, and why; offer
`approved: <path>`; then append the path to the scope block and retry.

## Architecture Impact
- INV-1: preserves — no model call is added or moved between tiers; the dry run and the real run share `gateCommands`
  and `ciMirrorChecks`, so what the dry run prints is what the gate runs.

## Step 0 — Reality Check
1. Read `gateCommands` and `ciMirrorChecks` (`plan-gate.mjs`, `run-plans.mjs`), the `lintPlan` call at `checks =
   gateCommands(...)` and `finalChecks` near `runFinal`: confirm both lists are built from the same two functions, so
   the prefix and the dedupe land in one place.
2. Find where install and sync validate `orchestrator.ciMirror` values (the "no write flag" rule) and where the `NOTE
   ci-mirror:` lines compare the list with the CI workflow; both must learn the `final:` prefix.
3. Read `npmScripts()` in `run-plans.mjs`: confirm it returns script bodies, so rule (b) can split a body on `&&`.
4. Count `core/.claude/agents/orch-builder.md` (115 lines today, cap 120): the step 4 rewrite must not grow the file.

## Atomic Sub-tasks
- [ ] T1: Write the failing tests (a)–(e) first — tools/test/lean-gate.test.mjs
- [ ] T2: `ciMirrorChecks` understands `final:`: dropped from a plan gate, stripped for the final gate — core/scripts/run-plans.mjs
- [ ] T3: `gateCommands` never runs a command twice: a `&&`-segment of a script it runs, and a `node --test` file a listed glob covers — core/scripts/lib/plan-gate.mjs
- [ ] T4: The dry run prints the `not repeated` line per plan — core/scripts/run-plans.mjs
- [ ] T5: Install and sync accept the `final:` prefix and strip it in the CI comparison — tools/install.mjs, tools/sync.mjs, tools/lib/**
- [ ] T6: Builder step 4: lint, build and its own test files; the gate is the proof — core/.claude/agents/orch-builder.md
- [ ] T7: Mark the kit's two scratch-project commands `final:`; orchestrator.md; sync; every check; changelog — .kit/config.json, core/docs/agent/orchestrator.md, CHANGELOG.md

## Technical Considerations
- The two heavy commands are kit tools, so the mark is a value in the project's own list, not a name in core: core
  stays stack-neutral and a project marks its own `npm run e2e` the same way.
- Rule (b) compares collapsed whitespace, exact text otherwise: `node tools/install-check.mjs --target x` is not the
  segment `node tools/install-check.mjs`.
- The dropped commands are not "dropped notes" in the sense of plan 098 (c): they still run, once, under the command
  that contains them. The dry run says so.

## Out of Scope
Choosing the gate's tests by the plan's scope (a scope → test-file map; mostly a memory saving — a later plan); making
`run-plans.test.mjs` faster; the solo `/ship` review rounds; any change to what the final gate or CI runs.

## Critical Questions
- Q1: Does removing `e2e-check` and `acceptance-check` from the plan gate reverse plan 103 item (e) ("every command the
  final gate runs is in each plan's gate")?
  A: (Human, 2026-11-09 — given as "create the needed plan" after cut A was put to him; the Planner confirms it at
  save time) Yes, for commands the project marks `final:` only. 103 (f) gives the final gate a fix round, so
  the reason for (e) — a late failure with no recovery — no longer holds for them. Unmarked commands keep running in
  both gates.

## Execution Notes
