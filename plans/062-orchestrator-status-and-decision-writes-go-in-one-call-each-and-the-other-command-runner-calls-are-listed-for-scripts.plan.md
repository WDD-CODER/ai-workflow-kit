# Plan 062 — Orchestrator status and decision writes go in one call each; the other command-runner calls are listed for scripts

Status: draft
Depends-on: 063
Snapshot: aac496e051072bad36314d3b24767d2f7fa37469
Source: first orchestrator test run (test-512-422), finding F8 (87 Haiku command-runner calls)

## Problem Statement

Every shell command of an orchestrator run goes through a Haiku `kit-runner` agent: `runner()` (`core/.claude/workflows/orchestrate.js:257`)
calls `ask(…, {agentType: 'kit-runner'})` (:264) and `state()` (:280-284) wraps it. The test run made 87 such calls. Most are
deterministic `node scripts/orch-state.mjs <subcommand>` calls whose output the script only parses, or whose output it ignores
(write-only), so each costs a model call for no judgment.

## Feasibility answer (Planner, from the code, 2026-11-02)

**Can the workflow runtime run `orch-state.mjs` directly, without a model? No.**
- The script receives only `agent, parallel, pipeline, phase, log, args, budget, workflow` (the test harnesses build it with exactly
  these: `tools/orchestrator-e2e.mjs:303`, `tools/test/orchestrator.test.mjs:234`); `require` and `process` are passed as
  `undefined` (`tools/orchestrator-e2e.mjs:305`), `Date`/`Math` throw (:288, :297).
- The script says so itself: `orchestrate.js:13` ("This script has no file, git or clock access: every file, git and time step is a
  kit script … run by the mechanical runner agent"), `orchestrate.js:40` ("no clock"), `core/scripts/orch-state.mjs:3`,
  `core/docs/agent/orchestrator.md:210`.
- No agent file has a no-model or script mode (all 16 under `core/.claude/agents/`); `kit-runner.md` is `tools: Bash, Read`,
  `model: {{models.mechanical}}`.
- Limit of this evidence: the Workflow tool's own runtime is not in this repository; the answer rests on the kit's code, comments and
  harness. Step 0 re-confirms it against the installed runtime and stops for the Human only if a direct-exec global exists
  (then this plan is replaced by "call the script directly").

So the plan is **batching first**, then a list of what else can become a script.

## Goals & Success Criteria
**Primary:** the notes and the decisions of a run cost one runner call each per flush, not one per item; the remaining runner-call
groups are listed with a recommendation for the Human.

- [auto] `note(text, nnn)` no longer calls the runner: it queues the text; the queued notes of a plan ride on that plan's next
  `set` call (`--note "a || b"`, like the facts, `orchestrate.js:313-338`) and are flushed at `stop` and `finish`; the per-plan
  cap `MAX_NOTES` still counts queued notes. Test in `tools/test/orchestrator.test.mjs`: a flow with 10 notes makes no runner call
  whose argv starts with `note`, and `status.json` holds all 10, in order, after the run.
- [auto] `orch-state.mjs decisions --run <name> --b64 <base64 of a JSON list>` records every decision (and its repeat marker) in one
  call; the loop at `orchestrate.js:1271-1278` makes one runner call for N decisions. Test: N decisions → one runner call; the same
  rows in `status.json` as N single `decision` calls; a malformed payload exits 1 and writes nothing.
- [auto] Notes are not lost when the run dies between flushes beyond the documented window: `orch-state.mjs watch` still prints
  `STUCK` from `status.json` updates (flush happens at every `set`), and a test shows a stopped run keeps its queued notes.
- [auto] The runner-call inventory (static, from the code) is written to `core/docs/agent/orchestrator.md` as a table: group,
  call sites, parsed or write-only, and a recommendation (`merge into call X`, `script-only`, `keep`); the table has a row for every
  `state(` and `runner(` site of `orchestrate.js` (a test counts the sites in the file and the rows in the table).
- [auto] `npm run build`, `npm run lint`, `npm test`, `node --test "tools/test/*.test.mjs"`, `node tools/orchestrator-e2e.mjs` and
  `node tools/drift-check.mjs --target .` all exit 0.
- [auto] `node scripts/scope-check.mjs --tests --plan=plans/062-orchestrator-status-and-decision-writes-go-in-one-call-each-and-the-other-command-runner-calls-are-listed-for-scripts.plan.md`
  prints `SCOPE_TESTS: ok`, and `node scripts/scope-check.mjs --diff=origin/main` on the finished branch prints `SCOPE: ok`.
- [human] The Human reads the inventory table and says which rows become a follow-up plan (merge calls / script-only).

## Execution Mode
- Parallel: no
- Concurrent plans: shares `orchestrate.js`, `orch-state.mjs` and `tools/test/orchestrator.test.mjs` with 059, 063 and 064; built
  after 063 and before 064 (Human, 2026-11-02).
- Isolated DB: no

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/.claude/workflows/orchestrate.js
core/scripts/orch-state.mjs
core/scripts/lib/orch-run.mjs
core/docs/agent/orchestrator.md
tools/test/orchestrator.test.mjs
tools/orchestrator-e2e.mjs
scripts/**
.claude/**
docs/agent/**
docs/brain/**
.kit/install.json
CHANGELOG.md
```

`scripts/**`, `.claude/**`, `docs/agent/**`, `docs/brain/**` and `.kit/install.json` are rendered copies, written only by
`node tools/sync.mjs --target . --apply`.

## Read Scope

Entire repo and its git history.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry.

## Architecture Impact
- INV-none: preserves — only the number of runner calls changes; the same kit scripts write the same status.json fields. The
  model tier of the runner (`models.mechanical`) is unchanged.

## Step 0 — Reality Check

1. Runs only when `scope-check.mjs --drift` reports `REALITY: drift`: check the listed commits by symbol, print `ok` or
   `conflict: <what>` per commit; stop for a go only on a conflict.
2. Re-confirm the feasibility answer: list the globals the installed Workflow runtime gives a script (the harness list at
   `tools/orchestrator-e2e.mjs:303`); report in Execution Notes with file and line. Stop for the Human only if a direct-exec
   global exists.
3. Count the runner sites in `orchestrate.js` (`runner(` 5, `state(` 26 when counted, before plan 058 merged; recount on `aac496e`) and read `note()` (:344-351), `setPlan`
   (:324-338) and the decision loop (:1271-1278) before editing.
4. `node tools/install-check.mjs` and `node --test "tools/test/*.test.mjs"` pass before any edit.

## User Stories
- As the Human, I want a run to make far fewer model calls for plain bookkeeping, so it costs less and stalls less.

## Functional Requirements

### Must Have (P0)
- [ ] Note queue + `--note` flag on `set`, flush at `stop`/`finish`; `MAX_NOTES` unchanged in meaning.
- [ ] `orch-state.mjs decisions --b64` (one write, validates every item with the existing `decision` rules, all-or-nothing).
- [ ] The decision loop in `orchestrate.js` uses it; the per-repeat `fileDup` marker goes in the same payload.
- [ ] Inventory table in `orchestrator.md` with one row per call site and a recommendation; a count test.
- [ ] CHANGELOG entry.

### Should Have (P1)
- [ ] Merge the two adjacent parse-only calls the inventory marks safest (Planner suggestion, to be confirmed by the table:
      `plan-info` + `worktree` of one plan, `flake` into `set`), only if the table says `merge` and the test stays green.

### Nice to Have (P2)
- None.

## UI/UX Notes
None (workflow script and scripts only).

## Atomic Sub-tasks

Every step names its own test location.

- [ ] A1: Failing tests first — a 10-note flow makes 10 runner `note` calls today; N decisions make N calls; Step 0 findings (feasibility re-check, site counts) to Execution Notes
  - Scope: `tools/test/orchestrator.test.mjs`, `tools/orchestrator-e2e.mjs`
- [ ] B1: Note queue riding on `set`, flushed at `stop`/`finish`; tests
  - Scope: `core/.claude/workflows/orchestrate.js`, `core/scripts/orch-state.mjs`, `tools/test/orchestrator.test.mjs`
- [ ] B2: `decisions --b64` and the single-call loop; tests including the malformed payload
  - Scope: `core/scripts/orch-state.mjs`, `core/scripts/lib/orch-run.mjs`, `core/.claude/workflows/orchestrate.js`, `tools/test/orchestrator.test.mjs`
- [ ] D1: Inventory table (every `state(`/`runner(` site: group, parsed or write-only, recommendation) and the count test; update the note/decision text in `orchestrator.md`
  - Scope: `core/docs/agent/orchestrator.md`, `tools/test/orchestrator.test.mjs`
- [ ] B3 (P1): the safest merges the table names
  - Scope: `core/.claude/workflows/orchestrate.js`, `core/scripts/orch-state.mjs`, `tools/test/orchestrator.test.mjs`
- [ ] R1: Render the installed copies, run every check, add the changelog entry — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .`, build, lint, `npm test`, `node --test "tools/test/*.test.mjs"`, `node tools/orchestrator-e2e.mjs`
  - Scope: `scripts/**`, `.claude/**`, `docs/agent/**`, `docs/brain/**`, `.kit/install.json`, `CHANGELOG.md`

## Technical Considerations
- **Why base64:** the runner is a model that re-types the command; a JSON payload with quotes and newlines in one argument
  risks quoting errors. Base64 has none. The same applies to `--note` (text joined with ` || `, as the facts are).
- **Why notes ride on `set`:** `set` is already called at every plan state change (`setPlan`), so the maximum delay is one state
  change; `watch`'s `STUCK` check reads the `status.json` update time, which `set` refreshes anyway.
- **Parsed calls stay calls:** `context`, `order`, `check-files`, `scripts`, `diff`, `clean`, `plan-info`, `worktree`, `init`,
  `main-tries`, `finish`, `set`, `handoff` and the preflight calls are read by the script to branch; without a runtime exec they
  need the runner. Only merging them (P1) or moving them behind one call reduces the count.
- **The 87-call figure:** the Human's test run; the static inventory gives sites, not counts per run. If the run's per-call log is
  available (`status.json` agent calls), D1 adds the run's counts per group to the table.

## Out of Scope
- Running scripts without the runner (not possible in this runtime; see the feasibility answer).
- Changing `models.mechanical` or the runner agent.
- Rewriting the preflight calls (plan 058 area).

## Critical Questions
- None open.

## Execution Notes
- Source: orchestrator test run test-512-422, finding F8. Facts from the kit at `origin/main` `aac496e`. Build order (Human,
  2026-11-02): 063, then 062, then 064.
