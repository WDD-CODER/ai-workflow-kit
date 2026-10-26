# Plan 026 — Orchestrator check commands cannot run scripts with side effects, and kit-feedback reads only scratch files

Status: draft
Depends-on: none
Snapshot: 6e3f56e1f71af251cb4860fb9bbdce540b42d538

## Problem Statement

An automated security review of the plan 025 commit flagged (medium) the allowlist that vets a plan's extra check
commands (`checkProblem` in `core/.claude/workflows/orchestrate.js`): any `node tools/<x>.mjs` or
`node scripts/<x>.mjs` passes. A plan's readiness `commands` / `args.checks` are text from a plan file, so a bad or
prompt-injected plan could name a script that is not a check at all — `kit-feedback.mjs` (opens a pull request on the
kit repository), `orch-state.mjs`, `decision-log.mjs`, `take-plan.mjs`, `slot-serve.mjs` — and the orchestrator
would run it unattended. Separately, `kit-feedback.mjs --text-file <path>` reads any readable file (a dotfile, an
`.env`) and would put its text in a pull request body if the privacy check does not trip.

A strict allowlist of check scripts is not possible: a project's own `scripts/` and `tools/` hold project checks the
kit cannot list. So the fix is to deny the kit's own scripts that write, push or change state, and to confine what
`kit-feedback` may read.

## Goals & Success Criteria

**Primary:** an unattended run can execute only read-only checks from a plan's command list, and `kit-feedback` can
read only a scratch file the agent wrote for it.

- [auto] `node --test tools/test/orchestrator.test.mjs` passes with new cases: `node scripts/kit-feedback.mjs --title x`, `node scripts/orch-state.mjs set`, `node scripts/decision-log.mjs add`, `node scripts/take-plan.mjs 1`, `node scripts/slot-serve.mjs` and `node tools/sync.mjs --apply` are each refused with a reason naming the script, while `node scripts/scope-check.mjs --arch`, `node tools/leak-check.mjs` and `node scripts/my-project-check.mjs` are still accepted.
- [auto] `node --test tools/test/kit-feedback.test.mjs` passes with new cases: `--text-file` pointing at a dotfile, at a file outside the OS temp folder and `.claude/sessions/`, and at a path with `..` is refused with exit 2 and nothing pushed; a file under the OS temp folder is read as before.
- [auto] `node tools/install-check.mjs`, `node tools/e2e-check.mjs` and `node tools/drift-check.mjs --target .` pass.
- [auto] `node tools/leak-check.mjs` passes (no project names or plan numbers in `core/`).

## Execution Mode
- Parallel: yes
- Concurrent plans: none
- Isolated DB: no

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`docs/session-state-<branch>.md`, `.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/.claude/workflows/orchestrate.js
core/scripts/kit-feedback.mjs
core/docs/agent/orchestrator.md
core/docs/agent/decision-review.md
tools/test/orchestrator.test.mjs
tools/test/kit-feedback.test.mjs
.claude/workflows/orchestrate.js
scripts/kit-feedback.mjs
docs/agent/orchestrator.md
docs/agent/decision-review.md
.kit/install.json
CHANGELOG.md
```

## Read Scope

Entire repo. Analysis and architectural suggestions are expected.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry.

## Architecture Impact

- INV-none: preserves — the change only narrows which commands the orchestrator runs and which files `kit-feedback` reads; no invariant's rule changes (checked with `scope-check --arch`).

## Step 0 — Reality Check

Runs only when `scope-check.mjs --drift` reports `REALITY: drift`. Check the listed commits
by symbol (do not re-run the whole reality check from scratch) and print one line per commit:
`ok` or `conflict: <what>`. All `ok` → continue. STOP for a go only on a `conflict`.

## User Stories
- As the Human running `/orchestrate` unattended, I want a plan's command list unable to start a script that pushes, opens a pull request or changes run state, so that a wrong or injected plan cannot act outside its checks.
- As the Human, I want `kit-feedback` to read only a file the agent wrote for it, so that no secret file can end up in a pull request body.

## Functional Requirements

### Must Have (P0)
- [x] A1: Refuse plan check commands that run one of the kit's own scripts with side effects — one `NOT_A_CHECK` set of script names (kit-feedback, orch-state, orch-preflight, decision-log, take-plan, slot-serve, slot-stop, write-session-state, todo-query, todo-archive, plan-close, free-merged-slots, orphan-sweep, prune scripts, local-excludes, sync, install, kit-sync) matched on the file name wherever it sits — reason names the script — core/.claude/workflows/orchestrate.js
- [x] A2: Make `kit-feedback` read a `--text-file` only from the OS temp folder or `.claude/sessions/`, never a dotfile and never through `..` — refuse with exit 2 and a one-line reason before anything is read — core/scripts/kit-feedback.mjs
- [x] A3: Prove both guards with tests that fail without the change — accepted and refused cases for the allowlist and the file path — tools/test/orchestrator.test.mjs, tools/test/kit-feedback.test.mjs

### Should Have (P1)
- [x] B1: Tell the Worker and the Human in the docs what a check command may and may not be, and where `kit-feedback` reads from — one short paragraph each — core/docs/agent/orchestrator.md, core/docs/agent/decision-review.md
- [x] B2: Re-render the installed copies and add the changelog line — `node tools/sync.mjs --target . --apply`, CHANGELOG.md `[Unreleased]` — .claude/workflows/orchestrate.js, scripts/kit-feedback.mjs, docs/agent/, CHANGELOG.md

### Nice to Have (P2)
- [x] C1: Look for any second place that vets plan commands with the same pattern and reuse the one set there — grep `checkProblem` and `SAFE_ARG` in `core/` — core/.claude/workflows/orchestrate.js, core/.claude/agents/orch-readiness.md

## UI/UX Notes
- None. Refusal reasons are one plain line each, in the form the orchestrator already uses (`<command>: …`).

## Security surface
- A command a plan names is run by an unattended orchestrator (`checkProblem`). The deny set narrows it; the existing deny list, argument character set and `..` rule stay. `kit-feedback` keeps its project-name, path and code-fence refusals and adds the read-location refusal. `kit-feedback.mjs` still never runs on its own from a check; it is run by the main agent after a graded reply.

## Atomic Sub-tasks

- [x] A1: Refuse plan check commands that run one of the kit's own scripts with side effects — one set of script names matched on the file name — core/.claude/workflows/orchestrate.js
- [x] A2: Make kit-feedback read a text file only from the OS temp folder or the sessions folder, never a dotfile or a path through two dots — core/scripts/kit-feedback.mjs
- [x] A3: Prove both guards with tests that fail without the change — accepted and refused cases — tools/test/orchestrator.test.mjs, tools/test/kit-feedback.test.mjs
- [x] B1: Tell the Worker and the Human what a check command may be and where kit-feedback reads from — core/docs/agent/orchestrator.md, core/docs/agent/decision-review.md
- [x] B2: Re-render the installed copies and add the changelog line so drift-check stays green — CHANGELOG.md and the synced copies
- [x] C1: Check for a second place that vets plan commands and reuse the one set there — core/

## Execution Notes

- Origin: automated security review of plan 025's commit (`orchestrate.js`, `node scripts/*` wildcard), reported 2026-10-26.
- Why a deny set and not an allowlist: a project's own `scripts/`/`tools/` hold its checks; only the kit's own script names are known to the kit.
- Release: a patch (v1.7.1) after merge; the Human decides tag and sync.
