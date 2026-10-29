# Plan 034 — A run with a main-folder check always waits for go

Status: draft
Track: code — here (kit)
Snapshot: e782cd08a7350220b727a9a7ea91624c65192c76
Depends-on: none

## Problem Statement

Plan 032 added two things that are right on their own and wrong together. `[auto:main]` checks run a plan's
command from the Human's **main folder** — the only place in a run with the real `.env`, the live database and the
running server. And `askHuman` lets `/orchestrate` start the run without `go` when readiness has nothing to ask. A
plan with an `[auto:main]` item and no question therefore runs a plan-supplied command against the live environment
with nobody having typed anything after the request. An automated security review raised this twice (medium), in the
kit and in a project's synced copy; the findings were acknowledged and left open.

The pause is the fix, and it costs one `go` only for a run that has such a plan — a run without one still starts on
its own. Two gaps close it:

1. **Readiness does not count a main command as something to ask.** `readiness()` in
   `core/.claude/workflows/orchestrate.js` (the `askHuman` line) looks at state, questions, environment needs,
   missing files and the preflight; `mainCommands` is not in the list, and `orchestrate.md` step 2 lists only
   questions and environment needs.
2. **Nothing checks that `go` happened.** Step 3 passes `mainChecks` to the run; the workflow runs them whether or
   not the Human saw them. The wait is a sentence in the command file, not a condition the run enforces or a test
   can prove.

## Goals & Success Criteria

**Primary:** a run whose plans include an `[auto:main]` command always shows those commands to the Human and waits
for `go`; the workflow refuses to start a run with `mainChecks` that was not approved; a run without main commands
still starts without a pause.

- [auto] `node --test tools/test/*.test.mjs` passes with new and changed cases in `tools/test/orchestrator.test.mjs`: readiness with one plan returning `mainCommands: ['node scripts/log-query.mjs --since=15m']` and nothing else open returns `askHuman: true` and `mainApproval: ['101: node scripts/log-query.mjs --since=15m']`; readiness with no main command still returns `askHuman: false` and `mainApproval: []`; `mode: 'run'` with `mainChecks: { 101: [cmd] }` and no `mainApproved` returns `{ ok: false, stopped: 'main-approval', problems: [/^plan 101 runs node scripts\/log-query\.mjs --since=15m from the main folder/] }` and made no runner call (no `init`); the same run with `mainApproved: true` runs the main-folder gate as today (the two existing `mainChecks` tests pass `mainApproved: true`); a run with no `mainChecks` and no `mainApproved` starts as today.
- [auto] `node tools/orchestrator-e2e.mjs` passes: the readiness stub returns `mainCommands` only for plan 206; run `alpha`'s readiness keeps `askHuman: false`; a readiness call for run `iota` (plan 206) returns `askHuman: true` and `mainApproval` naming `206: node scripts/log-ok.mjs --since=15m`, with `npm run build` denied as today; run `iota` without `mainApproved` returns `stopped: 'main-approval'` and no `status.json` is created for it; run `iota` with `mainApproved: true` behaves exactly as the existing `iota` checks require.
- [auto] `node tools/install-check.mjs` passes: `orchestrate.md` contains `"mainApproved": true`, the phrase `from the main folder` in step 2's list and the condition `no main-folder command` next to `askHuman` false; `orchestrator.md` contains `stopped: main-approval`.
- [auto] `node tools/e2e-check.mjs`, `node tools/workflow-link-check.mjs`, `node tools/drift-check.mjs --target .`, `node tools/leak-check.mjs` and `npm run build` pass.

## Execution Mode

- Parallel: no (kit repo, solo flow)
- Concurrent plans: 030 and 033 also edit `orchestrate.js`, `orchestrate.md` / `orchestrator.md` and the two orchestrator test files; 031 edits `CHANGELOG.md`; whichever merges second rebases.
- Isolated DB: no

## Read-Write Scope

```scope
core/.claude/workflows/orchestrate.js
core/.claude/commands/orchestrate.md
core/docs/agent/orchestrator.md
tools/install-check.mjs
tools/test/orchestrator.test.mjs
tools/orchestrator-e2e.mjs
CHANGELOG.md
scripts/**
.claude/**
docs/agent/**
docs/brain/**
.kit/install.json
plans/034-*.plan.md
```

## Read Scope

Entire repo.

## Escalation Protocol

A file outside the scope is needed → STOP, name the file, the change and why; offer `approved: <path>`; append it to
the scope block; retry.

## Architecture Impact

- INV-none: preserves — kit orchestrator tooling only; no project app file. The change adds a consent condition
  before a main-folder command runs and removes nothing: a run without `[auto:main]` items behaves as on v1.11.0.

## Reuse Check

- Pause condition — family: `readiness()`'s `askHuman` expression — rung: 2 — why: one more term in the same `some()`; the list the Human sees is one more array in the same result.
- Hard gate — family: the run's preflight stop (`stopped: 'preflight'`, before `init`) — rung: 2 — why: the same early-return shape with a new `stopped` value; no new state.
- Command flag — family: `args.pilot`, `args.ui` — rung: 2 — why: one more boolean the command passes, read as `A.mainApproved`.

## Step 0 — Reality Check

`node scripts/scope-check.mjs --drift --plan=<this plan>`. On `REALITY: drift`, re-read `orchestrate.js`
`readiness()` and the top of `run()` (the preflight stop), `orchestrate.md` steps 2–3 and the e2e readiness stub;
plans 030 or 033 may have merged first.

## User Stories

- As the Human, no plan-supplied command runs in my main folder, against my live `.env` and database, before I have
  seen it listed and said `go`.
- As the Human, a run of plans without a main-folder check still starts on its own.
- As a reviewer, the wait is a condition the workflow enforces and a test proves, not a sentence in a command file.

## Functional Requirements

1. **Readiness counts main commands (A1).** `readiness()`: `askHuman` is also true when any plan's filtered
   `mainCommands` is non-empty. The result gains `mainApproval: string[]` — one `"<NNN>: <command>"` per kept main
   command, in plan order (empty when none). The comment above `askHuman` names the reason: a main command runs in
   the live environment and is always shown before it runs.
2. **The run refuses unapproved main checks (A2).** At the top of the run mode, after the preflight stop and before
   `init`: when `A.mainChecks` has at least one non-empty list and `A.mainApproved !== true`, return `{ mode: 'run',
   run: RUN, ok: false, stopped: 'main-approval', problems: [ 'plan <NNN> runs <command> from the main folder —
   readiness lists it and the Human says go; the command then passes "mainApproved": true' per command ] }`. No
   runner call is made (no `init`, no state file). `A.mainApproved` is read nowhere else.
3. **The command shows the list and waits (A3).** `orchestrate.md` step 2: the `askHuman` false bullet adds "no
   main-folder command" to its condition; the "Otherwise ask" bullet says the numbered list ends with a block
   headed `Runs from the main folder (your live .env, database, server) — go allows it:` with one line per
   `mainApproval` entry, and that this block alone (no question, no environment need) still waits for `go`. Step 3's
   `args` gain `"mainApproved": true` with the sentence: only after the Human's `go` in step 2; a run with no
   `mainChecks` leaves it out. `tools/install-check.mjs` asserts the three strings from Success.
4. **Docs and changelog (C1).** `orchestrator.md`: "The run" step 1 — the `askHuman` false condition gains "no
   main-folder command"; "Checks that run from the main folder" gains a closing paragraph: a main check is always
   shown at readiness and waits for `go`, the command passes `mainApproved`, and the workflow refuses to start
   without it (`stopped: main-approval`), so a run without one still starts on its own. `CHANGELOG.md` Unreleased:
   Security — the paragraph above in two sentences, naming that this answers the review finding on `[auto:main]`
   checks running without `go`. No project names.
5. **Tests (T1).** As in Success. The e2e readiness stub (`orch-readiness` branch of the agent stub) returns
   `mainCommands` only when `t.PLAN` names plan 206; the `alpha` check that asserted main commands on every plan
   moves to a readiness call for run `iota`; both `iota` runs are asserted (refused without the flag, unchanged with
   it).
6. **Render (R1).** `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .`.

## UI/UX Notes

- None (kit tooling).

## Atomic Sub-tasks

- [x] A1: Make readiness treat a main-folder command as something the Human must see, so the run pauses for it — askHuman true when any plan has mainCommands; mainApproval list of NNN: command in the result — core/.claude/workflows/orchestrate.js
- [x] A2: Refuse to start a run whose main-folder checks were not approved, so the wait is enforced and not just written — early return stopped: main-approval before init when mainChecks is non-empty and mainApproved is not true — core/.claude/workflows/orchestrate.js
- [x] A3: Show the main-folder commands in the readiness list, wait for go, and pass the approval flag to the run — step 2 block and condition, step 3 mainApproved: true after go; install-check asserts — core/.claude/commands/orchestrate.md, tools/install-check.mjs
- [x] C1: Explain the pause in the orchestrator doc and the changelog as the answer to the security finding — askHuman condition, main-folder section paragraph, Unreleased Security entry — core/docs/agent/orchestrator.md, CHANGELOG.md
- [x] T1: Prove the pause and the refusal with tests that would fail today — readiness askHuman and mainApproval, run refused without the flag and unchanged with it, e2e stub narrowed to plan 206, iota both ways — tools/test/orchestrator.test.mjs, tools/orchestrator-e2e.mjs
- [x] R1: Render the kit's own copies and check drift — scripts/, .claude/, docs/agent/, docs/brain/, .kit/install.json

## Technical Considerations

- Security surface: this plan narrows it — a main-folder command (live `.env`, database, server) now runs only after
  the Human saw it listed and said `go`, and the workflow enforces that with `mainApproved`. Backend / API, auth,
  data: none (kit tooling).
- `mainApproved` is a statement by the orchestrating session that step 2 waited; the workflow cannot see the chat.
  The flag makes the wait a tested condition and a visible run argument, which is what the review asked for; it is
  not a cryptographic proof.
- A run without `[auto:main]` items is unchanged: `askHuman` false still starts it, and `mainApproved` is not needed.
- Plan 033 (retry of an unreadable state call) touches `runner()` and `q()` in the same file; this plan touches
  `readiness()` and the top of the run mode. A rebase is mechanical.

## Out of Scope

- Changing what qualifies as a main command (`node scripts/…`, `node tools/…`, no write flag) or where it runs.
- A per-command approval (`go 1,3`): the whole run's main list is approved by one `go`, as the readiness answers are.
- Re-asking at `continue` after the pilot — the list was shown and approved at readiness; the pilot's `continue` is
  the Human's as well.
- Plan 033's retry; plan 030's lessons; plan 031's required steps.

## Critical Questions

- Q: Why a flag in the run args instead of only the command-file sentence? A: the finding was that a command runs without consent; a sentence cannot be tested and the orchestrating session can skip it. The flag makes the refusal a unit test and an e2e case.
- Q: Does this undo plan 032's auto-start? A: no — only a run with an `[auto:main]` item pauses; the common run still starts at once.
- Q: Why list the commands and not just "this run has main checks"? A: the Human approves what will run against their live environment; the command text is the thing to read.

## Execution Notes

- Origin (2026-10-29): an automated security review flagged, twice (kit and a project's synced copy), that
  `[auto:main]` commands can run from the main folder with no `go` after plan 032's auto-start. The Human chose
  "always pause" over "keep as is" in the Planner session.
- Built 2026-10-29 on top of plan 033 (same files; the branch was cut from 033's commit and rebased after PR #60
  merged). Evidence: unit tests 177/177 (38 orchestrator), orchestrator e2e 86 cases (iota refused without
  `mainApproved`, unchanged with it; alpha still `askHuman: false`), e2e-check 53, install-check, workflow-link-check,
  drift-check (0 undeclared), leak-check (0 leaks) and `npm run build` pass.
