# Plan 031 — An Override Cannot Drop a Step the Kit Requires: Required-Step Markers, an Override Check in CI, /ship and drift-check

Status: draft
Depends-on: none
Snapshot: 76097c3

## Problem Statement

A project may keep its own copy of a kit file for good (`kit.config.json` `overrides`, with a reason). From then on
install never writes it, sync and `drift-check` report it `override` and look no further. FoodVibe overrides
`.github/workflows/ci.yml` (pnpm installs, an Angular build cache) and, since plan 505, `security.yml`.

On 2026-10-28 FoodVibe's overridden `ci.yml` lacked the kit's step **Install workflow script dependencies**
(`npm install` inside `scripts/`). Nothing noticed until the project moved to pnpm: npm hoisting had hidden the gap,
pnpm did not, and CI's `lint` job failed with `Cannot find package 'picomatch' imported from scripts/lib/invariants.mjs`
— one full CI round, found by reading the log. The same can happen to any step the kit relies on and a project does not
know it relies on: the workflow-script tests, the secret scan, the final quality gate, the kit-managed `scripts/` audit.

Today nothing in the kit says which steps of a rendered workflow are load-bearing, and nothing compares an override
with the template it replaced. The gap is structural, not FoodVibe's: every project that overrides `ci.yml` is one
refactor away from the same silent loss.

## Goals & Success Criteria

**Primary:** the kit marks the steps of its workflow templates that every copy must keep; the project's `.kit/install.json`
records them; a project-side script, CI, `/ship`'s build gate and the kit's `drift-check` each fail by name when an
overridden workflow lacks one. The kit's own checkout (which overrides `ci.yml` to test the kit) is skipped on purpose.

- [auto] `node tools/install-check.mjs` passes with new cases: after an install, `.kit/install.json` has
  `required[".github/workflows/ci.yml"]` = `["Install workflow script dependencies", "Workflow script tests", "Kit override check", "Secret scan (gitleaks)", "Require quality gates"]`
  and `required[".github/workflows/security.yml"]` = `["npm audit (workflow scripts, report only)", "Semgrep OWASP Top Ten"]`;
  a `kit-sync --apply` on an older install adds the key; the rendered `ci.yml` and `security.yml` carry each marker as the
  comment line `# KIT:required — a project override must keep this step` directly above the step.
- [auto] `node --test tools/test/override-check.test.mjs` passes: in a scratch project installed from the kit, declaring
  `.github/workflows/ci.yml` as an override and deleting the **Install workflow script dependencies** step prints
  `OVERRIDE_CHECK: FAIL — .github/workflows/ci.yml lacks required step "Install workflow script dependencies" (declared override; add the step back, or ask the kit to drop the requirement)`
  and exits 1; with every step present prints `OVERRIDE_CHECK: ok — 1 override(s) checked, 5 required step(s) found`
  and exits 0; with no override of a workflow file prints `OVERRIDE_CHECK: ok — 0 override(s) checked`; without
  `.kit/install.json` prints `OVERRIDE_CHECK: skipped — no .kit/install.json` and exits 0; a step whose name is
  present only inside a comment or a different key (`# - name: X`, `run: echo "name: X"`) still counts as missing.
- [auto] `node tools/drift-check.mjs --target <scratch>` on that stripped override prints the row
  `override-missing-step .github/workflows/ci.yml: "Install workflow script dependencies"` and
  `KIT_DRIFT: FAIL — 1 undeclared differences (0 drift, 0 missing, 1 override-missing-step), 1 overrides; …`; the same
  project with the step present prints `KIT_DRIFT: ok`. On the kit's own checkout (`source=local:.` self-install) the
  override rows are not step-checked and `node tools/drift-check.mjs --target .` stays `KIT_DRIFT: ok`.
- [auto] `node scripts/override-check.mjs` run in the kit repository prints `OVERRIDE_CHECK: skipped — the kit's own checkout`
  and exits 0 (`kit.json` next to `.kit/config.json`).
- [auto] The rendered `ci.yml` `lint` job has the step `Kit override check` running `node scripts/override-check.mjs`
  right after **Install workflow script dependencies**, itself marked required; `core/.claude/commands/ship.md` Phase 1
  lists `node scripts/override-check.mjs` among the kit-runner's build-gate commands; `install-check` asserts both.
- [auto] `node tools/install-check.mjs`, `node tools/e2e-check.mjs`, `node tools/workflow-link-check.mjs`,
  `node tools/drift-check.mjs --target .`, `npm run build`, `npm run lint` and `node --test tools/test/` pass.
- [human] In FoodVibe after the sync: `node scripts/override-check.mjs` prints `OVERRIDE_CHECK: ok — 2 override(s) checked, 7 required step(s) found`;
  comment out the `Install workflow script dependencies` step in its `ci.yml`, run it again and see the `FAIL` line
  naming that step; restore the step.

## Execution Mode
- Parallel: no
- Concurrent plans: none
- Isolated DB: no

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/.github/workflows/ci.yml
core/.github/workflows/security.yml
core/scripts/override-check.mjs
core/scripts/lib/override-steps.mjs
core/.claude/commands/ship.md
core/docs/agent/pr-check-fix-loop.md
core/docs/agent/workflow-map.md
core/docs/brain/gotchas/ci.md
tools/lib/kit.mjs
tools/install.mjs
tools/sync.mjs
tools/drift-check.mjs
tools/install-check.mjs
tools/test/override-check.test.mjs
docs/CHANGE-LOOP.md
scripts/**
.claude/commands/ship.md
docs/agent/**
docs/brain/gotchas/ci.md
.kit/install.json
CHANGELOG.md
```

## Read Scope

Entire repo. FoodVibe's `kit.config.json`, `.github/workflows/ci.yml` and `security.yml` (read only, as the real
override shapes). Analysis and architectural suggestions are expected.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry.

## Architecture Impact

`docs/brain/invariants.md` holds the template only (no `INV-n` entries), so no invariant is reachable. A Worker runs
`node scripts/scope-check.mjs --arch --plan=<this file>` and keeps this line if it reports `ARCH: ok`.

- INV-none: preserves — a template marker, one record key in `.kit/install.json`, one read-only project script, one
  CI step and one drift-check row class. No app, server or schema file; no new agent.

## Step 0 — Reality Check

Runs only when `scope-check.mjs --drift` reports `REALITY: drift`. Check the listed commits
by symbol (do not re-run the whole reality check from scratch) and print one line per commit:
`ok` or `conflict: <what>`. All `ok` → continue. STOP for a go only on a `conflict` (a symbol,
line or file this plan names was removed, renamed or rewritten).

Also, before O1: confirm the renderer (`tools/lib/kit.mjs` `COND_LINE`, `applyConditionals`) passes a `# KIT:required …`
line through unchanged (only `KIT:if` / `KIT:else` / `KIT:end` are directives) and that `actionlint` accepts a YAML
comment between two list items — the markers in O1 are comments, never keys.

## User Stories
- As the Human, I want CI to tell me by name when my override of `ci.yml` lost a step the kit needs, so that a missing install never costs a CI round found by reading a log.
- As the Human, I want `kit-drift` to catch the same thing from the kit side, so that an override made before this release is checked at the next sync.
- As the kit's Planner, I want to mark in the template which steps are load-bearing, so that the rule lives next to the step it protects.

## Functional Requirements

### Must Have (P0)
- O1: markers — in `core/.github/workflows/ci.yml` the comment line `# KIT:required — a project override must keep this step`
  directly above `- name:` of **Install workflow script dependencies**, **Workflow script tests**, **Kit override check**
  (new, O4), **Secret scan (gitleaks)** and **Require quality gates**; in `security.yml` above **npm audit (workflow
  scripts, report only)** and **Semgrep OWASP Top Ten**. The line renders into the project's copy as is (a comment that
  says why the step matters). A marker above a line that is not `- name:` is a render error naming the file and line.
- O2: shared reader — `core/scripts/lib/override-steps.mjs` (Node built-ins, exported for the kit's tools and the project
  script): `requiredSteps(templateText)` → the step names in marker order; `stepNames(workflowText)` → every
  `- name: <x>` value of a real step (a YAML list item under `steps:`, not a comment, not a `run:` body);
  `missingSteps(workflowText, required)` → the required names `stepNames` does not contain.
- O3: record — `tools/install.mjs` and `tools/sync.mjs` write `.kit/install.json` `required: { "<dest>": [names] }`
  for every managed `.github/workflows/*.yml` whose rendered text has at least one marker (from `requiredSteps` on the
  **rendered** text, so a step dropped by a `KIT:if` is not required); a sync of an older install adds the key; the key
  is written even when the path is an override (the override is what it is for).
- O4: project script — `core/scripts/override-check.mjs [--root <dir>]`: reads `kit.config.json` `overrides` (the
  `readOverrides` shape: `{ path, reason }`) and `.kit/install.json` `required`; for each override whose path has a
  `required` entry, `missingSteps(<project file>, names)`; output and exit codes exactly as in the success criteria; a
  missing project file is `lacks required step` for every name; `kit.json` next to `.kit/config.json` → `skipped — the
  kit's own checkout`. Runs in CI as the `lint` job step **Kit override check** (`node scripts/override-check.mjs`)
  right after **Install workflow script dependencies**, and in `/ship` Phase 1 as one more kit-runner command.
- O5: kit side — `tools/drift-check.mjs`: for every row in state `override` whose dest has a `required` entry in the
  target's `.kit/install.json` (or, when that key is absent, in the plan's rendered text), `missingSteps` on the target's
  file; each missing name is a row `override-missing-step <dest>: "<name>"`, counted in `undeclared` and in the
  `KIT_DRIFT: FAIL` line as `(… , N override-missing-step)`; skipped when the target is the kit's own checkout
  (`source=local:.` self-install, as `install-check` already names it).

### Should Have (P1)
- B1: docs — `docs/CHANGE-LOOP.md` §3 (declaring an override: "then `node scripts/override-check.mjs`; `kit-drift`
  reports `override-missing-step` for a step the kit requires"), `core/docs/agent/pr-check-fix-loop.md` (a row for the
  **Kit override check** step: fix = add the named step back from the kit's template, never delete the marker),
  `core/docs/agent/workflow-map.md` (the script), `core/docs/brain/gotchas/ci.md` (the FoodVibe case: "an override of
  ci.yml lost the scripts/ install; npm hoisting hid it, pnpm did not"), `CHANGELOG.md` `[Unreleased]`.

### Nice to Have (P2)
- C1: `node scripts/override-check.mjs --list` prints every required step per workflow from `.kit/install.json`, so a
  project sees what its override must keep before editing.

## UI/UX Notes
- None.

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [ ] O1: Mark the load-bearing steps of the kit's workflow templates so every copy knows what it must keep — `# KIT:required …` comment above seven steps; a misplaced marker is a render error — core/.github/workflows/ci.yml, core/.github/workflows/security.yml, tools/lib/kit.mjs
- [ ] O2: Add one shared reader for required and present step names, used by the kit's tools and the project script — `requiredSteps`, `stepNames`, `missingSteps` — core/scripts/lib/override-steps.mjs
- [ ] O3: Record the required steps of each rendered workflow in the install record at install and at sync — `.kit/install.json` `required` key from the rendered text — tools/install.mjs, tools/sync.mjs, tools/lib/kit.mjs
- [ ] O4: Give projects a script that fails by name when an override lacks a required step, and run it in CI and in the ship build gate — `scripts/override-check.mjs`, the `Kit override check` lint step (itself required), one kit-runner command in /ship Phase 1 — core/scripts/override-check.mjs, core/.github/workflows/ci.yml, core/.claude/commands/ship.md
- [ ] O5: Make the kit's drift check report a missing required step as an undeclared difference, except on the kit's own checkout — `override-missing-step` rows counted in the FAIL line — tools/drift-check.mjs
- [ ] B1: Document the marker, the script and the CI step, and record the FoodVibe case as a gotcha — docs/CHANGE-LOOP.md, core/docs/agent/pr-check-fix-loop.md, core/docs/agent/workflow-map.md, core/docs/brain/gotchas/ci.md, CHANGELOG.md
- [ ] C1: Let a project list the steps its overrides must keep before it edits them — `--list` — core/scripts/override-check.mjs
- [ ] T1: Prove it with tests: the install record, the script's four outcomes, the drift row, the kit-checkout skip — tools/test/override-check.test.mjs, tools/install-check.mjs
- [ ] R1: Re-render the kit's own copies with sync, check drift, and run every kit check — scripts/, .claude/commands/ship.md, docs/agent/, .kit/install.json

## Technical Considerations
- Dependencies: none on open plans. Plan 029 (B2) also edits `tools/lib/kit.mjs` and `tools/install-check.mjs`; both
  changes are additive in different functions — whichever merges second rebases.
- New files needed: `core/scripts/override-check.mjs`, `core/scripts/lib/override-steps.mjs`,
  `tools/test/override-check.test.mjs`. `core/scripts/lib/*.mjs` is installed as `scripts/lib/*.mjs`, so the project
  script imports `./lib/override-steps.mjs`; the kit's tools import it from `core/scripts/lib/` (source).
- Model changes: `.kit/install.json` gains `required` (an object, absent on older installs; every reader treats absence
  as "no requirements").
- Backend / API: none. Auth and validation: none. Data / migration: none — sync adds the key on its next `--apply`.
- Security surface: the project script reads two project files and runs nothing. The CI step runs a kit-managed script
  that is already on the `rules` allowlist shape (`node scripts/<name>.mjs`, no arguments that write).
- Step names are matched exactly (the string after `- name:`, quotes stripped); renaming a required step in an override
  is a miss by design — the kit's step names are the contract `pr-check-fix-loop.md` already keys on.
- Windows: the script and the test use only `fs` and `path`; CI runs them on Ubuntu for PRs and on Windows for `main`.
- Project checks: `docs/project/plan-checks.md` does not exist in this repo.

## Out of Scope
- Required *content* of a step (its `run:` line) — only its presence by name; a project override may change how a
  step runs, not drop it.
- Overrides of non-workflow files (`.claude/commands/ship.md`, skills): a later plan if a project loses a load-bearing
  section the same way.
- Auto-repair (copying the step back into the override): the message names the step; the project edits its own file.
- FoodVibe's files: it gets this in a sync PR, then runs `node scripts/override-check.mjs` once ([human] item).

## Critical Questions
- Q: Should the check run in the project's CI at all, given that a project overriding `ci.yml` can also drop the check
  step? A: yes — the step is itself marked required, so dropping it is caught by `kit-drift` from the kit side; CI is the
  fast path, drift-check the backstop. (Planner, 2026-10-29.)
- Q: Why not record the required names in a kit-owned file instead of `.kit/install.json`? A: install.json is the
  record of what the kit shipped to this project, written only by install and sync, and already read by drift-check;
  a second record would drift from it. (Planner, 2026-10-29.)

## Execution Notes
- Origin: the FoodVibe plan-505 workflow report (2026-10-28), verdict row 3 — `ci.yml` override lacked the kit's
  `scripts/` install step; `Cannot find package 'picomatch'` in CI `lint`; one CI round lost. Rows 1, 2, 4–7 of that
  report were fixed by kit PRs #54 and #55; row 8 is plan 029 A9.
- Evidence in this repo (Planner, 2026-10-29): `tools/drift-check.mjs:87` sets `state = 'override'` and reads no further;
  `tools/lib/kit.mjs:254` `COND_LINE` recognises only `KIT:if|else|end`; `.kit/install.json` is written at
  `tools/install.mjs:195` / `:260` and `tools/sync.mjs:120` (`record`); the kit's own checkout overrides
  `.github/workflows/ci.yml` (sync output `override .github/workflows/ci.yml`), hence the self-checkout skip.
- The kit's `ci.yml` has no `rules` job; FoodVibe's `rules` job is part of its override. The kit's check step goes in the
  `lint` job, which already installs the `scripts/` dependencies.
