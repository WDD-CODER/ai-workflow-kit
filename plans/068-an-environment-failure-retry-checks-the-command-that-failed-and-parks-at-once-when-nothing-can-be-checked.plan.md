# Plan 068 — An environment failure retry checks the command that failed, and parks at once when nothing can be checked

Status: draft
Depends-on: none
Snapshot: fef8cff11a11cf5bfb7635be56bd7595bba68dbb
Source: brain issue I1

## Problem Statement

A FoodVibe run (2026-10-27, kit v1.13.0) lost about 102 minutes: a gate command ended `env-fail`, the orchestrator ran its
environment check, the check passed, the plan was retried, the same command failed again, and the plan parked with
`environment, again after one retry: gate env-fail: <command>`.

Cause, read on `main` at the Snapshot (line numbers refreshed 2026-11-05) (plan 058 is merged, PR #86): `envCheck()` in `core/.claude/workflows/orchestrate.js`
(l.914) runs `orch-preflight.mjs --env-only --run <run>`, which checks only disk, database and packages
(`core/scripts/orch-preflight.mjs` `packages()` l.111-125). It never looks at the command that failed, so it passes whenever
disk, database and packages are fine, and the retry (l.1101-1109, one `envRetried` flag per plan) repeats the same failure.

## Goals & Success Criteria

**Primary:** after a gate `env-fail`, the environment check tests the failed command's own precondition. When none can be
derived the plan parks at once and names the command; an unchanged second failure names the command too.

- [auto] A1 reproduces the failure on `main` as it is now: a stub run whose gate reports `env-fail` for `node scripts/x.mjs`
  (file missing) is retried once and parks with `environment, again after one retry`. The test is named `reproduction`; `node --test tools/test/orchestrator-env-retry.test.mjs` passes it on the A1 commit alone (it asserts today's behaviour), and A4 rewrites it into the park-at-once expectation.
- [auto] `node scripts/orch-preflight.mjs --env-only --probe "node scripts/missing.mjs"` prints `FAIL probe` with the missing
  path; `--probe "node scripts/<existing file>"` prints `OK probe`; `--probe "npm run <script in package.json>"` is `OK`
  with `node_modules` present and `FAIL` when the script or `node_modules` is missing; `--probe "git status"` prints
  `SKIP probe: no precondition`.
- [auto] A gate `env-fail` whose commands all have no derivable precondition parks at once with
  `environment: no precondition can be checked for <command>[, <command>]` and runs no retry.
- [auto] A gate `env-fail` whose probe fails parks with the probe's message and no retry.
- [auto] A gate `env-fail` whose probe passes is retried once as today; the second park reads
  `environment, again after one retry: <why>` and names the command (`<why>` already carries it).
- [auto] Failures that name no real gate status keep today's path: `gate returned no result, twice, for: …`, a builder
  `envFailure` and a merge `envFailure` still retry once with the generic check. The assertions at
  `tools/test/orchestrator.test.mjs` l.579 and l.686 stay unchanged and pass: `node --test tools/test/orchestrator.test.mjs`.
- [auto] `node tools/drift-check.mjs --target .` prints no drift after `node tools/sync.mjs --target . --apply`.
- [auto] `node tools/kit-learn.mjs plan-check plans/068-an-environment-failure-retry-checks-the-command-that-failed-and-parks-at-once-when-nothing-can-be-checked.plan.md` exits 0.

## Execution Mode
- Parallel: no
- Concurrent plans: none
- Isolated DB: no

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/.claude/workflows/orchestrate.js
core/scripts/orch-preflight.mjs
core/docs/agent/orchestrator.md
.claude/workflows/orchestrate.js
scripts/orch-preflight.mjs
docs/agent/orchestrator.md
tools/test/orchestrator-env-retry.test.mjs
docs/brain/scorecard.md
```

## Read Scope

Entire repo. Analysis and architectural suggestions are expected.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry.

`tools/test/orchestrator.test.mjs` is not in scope. If an assertion in it must change, STOP and ask for
`approved: tools/test/orchestrator.test.mjs`; never edit it unprompted.

## Architecture Impact

- INV-none: preserves — the scope touches no invariant's `Touches` glob (INV-1 covers only `core/docs/agent/model-routing.md` and `core/.claude/agents/orch-readiness.md`).

## Step 0 — Reality Check

Runs only when `scope-check.mjs --drift` reports `REALITY: drift`. Check the listed commits
by symbol (do not re-run the whole reality check from scratch) and print one line per commit:
`ok` or `conflict: <what>`. All `ok` → continue. STOP for a go only on a `conflict` (a symbol,
line or file this plan names was removed, renamed or rewritten).

## Functional Requirements

### Must Have (P0)
- [ ] Gate `env-fail` results carry the failed commands for probing; other env failures do not (so their path is unchanged).
- [ ] A command's precondition is derived by `orch-preflight.mjs --probe`, and a command with none is reported, never guessed.

## Atomic Sub-tasks

- [ ] A1: Reproduce the failure on `main` as it is now (058 included) — new test `reproduction` in a NEW file driving the stub orchestrator the way `tools/test/orchestrator.test.mjs` l.567-590 does (read that file for the stub setup; copy the harness code, do not edit that file): gate returns `env-fail` for `node scripts/x.mjs`, the environment check passes, the same command fails again → park `environment, again after one retry`. Commit it before A2 — `tools/test/orchestrator-env-retry.test.mjs`
- [ ] A2: Add `--probe "<command>"` (repeatable) to the env-only preflight — `node <file>` → file exists in the root folder; `npm|pnpm run <name>` → `<name>` is in `package.json` `scripts` and `node_modules` exists; any other command → `SKIP probe: no precondition`; print `OK probe`/`FAIL probe <why>`/`SKIP probe` lines and keep the JSON line's `envFailure: true` on a FAIL — `core/scripts/orch-preflight.mjs`
- [ ] A3: Set `probeCmds` on the gate result only where a command has the real status `env-fail` (the `env.length` return, l.715), not on the "returned no result, twice" return (l.702) — `core/.claude/workflows/orchestrate.js`
- [ ] A4: In the env branch (l.1101): when the failure has `probeCmds`, call `envCheck` with them (`--probe` per command); every command `SKIP` → `park('environment: no precondition can be checked for <commands>')` with no retry; any `FAIL` → park with the probe message; otherwise retry once as today. A failure without `probeCmds` takes today's path unchanged — `core/.claude/workflows/orchestrate.js`
- [ ] A5: Add the cases of the Done-when list to the new file (probe forms, park at once, probe fail, probe pass then second failure, unchanged paths) — `tools/test/orchestrator-env-retry.test.mjs`
- [ ] A6: Document the probe and the park-at-once rule where the environment retry is described — `core/docs/agent/orchestrator.md`
- [ ] A7: `node tools/sync.mjs --target . --apply`, then `node tools/drift-check.mjs --target .` — the three installed copies listed in scope

## Technical Considerations
- Dependencies: `envCheck`/`runner` in `orchestrate.js`; `orch-preflight.mjs --env-only`; plan 058 (merged) changed the same two files in other functions (`devServer`, `backend`).
- New files needed: `tools/test/orchestrator-env-retry.test.mjs`
- Model changes: none
- Backend / API: none
- Auth and validation: the probe never runs the failed command and reads only `package.json` and file existence in the project root; the command string is parsed, never executed.
- Security surface: a command string reaches `orch-preflight.mjs` as an argument; it is matched against a fixed pattern, never passed to a shell.
- Data / migration: none

## Out of Scope
- Changing the gate's own single rerun of an `env-fail` (`core/.claude/agents/orch-gate.md`).
- Probing builder or merge environment failures (they name no command).
- I2 and I3 (dismissed as the same incident).
- Editing `tools/test/orchestrator.test.mjs`.

## Critical Questions
- Q: A gate env-fail with commands but no derivable precondition (for example "temp folder in use") parks at once with no retry — keep? A: yes (Human, 2026-11-03)
- Q: Sequence against plan 058? A: Depends-on none, Parallel no; 058 is merged (PR #86, aac496e) (Human, 2026-11-03)

## Execution Notes
[Written while the plan runs.]
