# Plan 090 — Subtraction: delete what the runner replaced, and a size budget the tests enforce

Status: draft
Depends-on: 088, 089
Snapshot: fd212e119ef16c0b26ebfaf6b44f450fee26d8f5
Revised: Human decision 5, 2026-11-07 — the five checker agents (`orch-check-plan`, `orch-check-bugs`, `orch-check-rules`, `orch-verify`, `orch-security`) and `/review-it` stay until `review.ship` switches to `reviewer` (plan 091); everything else on the list is deleted.
Source: kit audit 2026-11-06, plan S; goal decision 5 (delete, not freeze).

## Problem Statement
After plans 088 and 089 the workflow runtime, five role agents, the runner agent and the legacy `/auto-solve` command do nothing — but they still get loaded, listed and referenced (`AGENTS.md`, `commands.md`, `workflow-map.md`, `model-routing.md`, `agent-roles.md`, the drift and install manifests), and every session pays for them in context. The kit grew to 25 commands, 16 agents and 45 scripts in five weeks with no limit; the notebook's sources measure instruction adherence falling to ~68 % at 500 instructions. A freeze keeps the weight; only a deletion removes it, and only a test keeps it from coming back.

## Goals & Success Criteria
**Primary:** the files the runner replaced are gone from `core/`, every reference to them is gone, and a test fails when the kit grows past its budget.

- [auto] These files no longer exist under `core/` and under the installed copies (`.claude/`, `scripts/`): `.claude/workflows/orchestrate.js`, `.claude/commands/auto-solve.md`, `.claude/agents/orch-gate.md`, `orch-merge.md`, `orch-report.md`, `orch-triage.md`, `orch-readiness.md`, `kit-runner.md`, `kit-prevalidate.md`; `git grep -n` for each name returns nothing outside `CHANGELOG.md`, `plans/**` and `docs/brain/decisions/**` (also exempt, Human 2026-11-07: `docs/agent-evals/cases/**`, `docs/orchestrator/runs/**`, the `<repo>-orch-merge-<run>` folder name). The five checker agents and `/review-it` still exist and `/ship`'s `review.ship = checkers` path still runs them.
- [auto] `orch-state.mjs` no longer has `trend`, `main-try`, `main-tries` nor the `--notes-b64` / `--flakes-b64` / `--causes-b64` queues (`note`, `flake`, `decisions`, `prepare` stay: `run-plans.mjs` and `lib/plan-gate.mjs` call them — Human 2026-11-07); `node --test tools/test/orchestrator*.test.mjs` passes on the smaller file.
- [auto] `decision-log.mjs` keeps `pending`, `grade`, `learn`, `case`, `follow-ups`, `rules` behind `review.learn = on` (plan 089's key); its `triage` support and the calibration file are removed; `tools/test/decision-log.test.mjs` updated.
- [auto] `docs/agent/orchestrator.md` ≤ 150 lines, `agent-roles.md` ≤ 100 lines (the shared contract for the builder, the reviewer, the five checkers while they stay, `orch-ui` and `git-agent` while it stays), `model-routing.md` ≤ 60 lines, `workflow-map.md` sections 3–5 list only what exists.
- [auto] `node --test tools/test/size-budget.test.mjs` passes and enforces: `core/.claude/commands/*.md` ≤ 24 files (target 10, Human 2026-11-07), each ≤ 120 lines (`ship.md` ≤ 80, `take-plan.md` ≤ 100, `plan.md` ≤ 180); `core/.claude/agents/*.md` ≤ 10 files while the five checkers stay (reason line: back to 5 when `review.ship` switches to `reviewer`), each ≤ 120 lines; `AGENTS.md` ≤ 70 lines; `node tools/instruction-load.mjs` ≤ 800 (Human 2026-11-07; back to 600 when `job-validation.md` is shortened); `kit.config.json` `orchestrator` ≤ 15 keys (target 12, Human 2026-11-07). The limits live in `tools/size-budget.json` with a one-line reason each; raising one needs a plan that names it.
- [auto] `tools/install-check.mjs`, `tools/drift-check.mjs --target .`, `tools/workflow-link-check.mjs`, `tools/acceptance-check.mjs --e2e` and `.kit/install.json` know nothing of the deleted files (no dangling manifest rows, no dead links).
- [auto] `npm run build`, `npm run lint`, `npm test`, `node tools/orchestrator-e2e.mjs`, `node --test "tools/test/*.test.mjs"` pass; sync then drift-check report no drift.
- [auto] `CHANGELOG.md` has one entry listing every deleted file and the ADR path.
- [human] Open one Claude Code session in the kit and one in FoodVibe after `kit-sync.ps1`: `/commands` lists ten commands or fewer, nothing in the list is dead, and `/orchestrate --dry-run` of one plan prints its waves.

## Execution Mode
- Parallel: no.
- Concurrent plans: none; last of the goal run (084 already merged in da4e764).
- Isolated DB: no.

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspot `CHANGELOG.md`.

```scope
core/.claude/workflows/**
.claude/workflows/**
core/.claude/commands/**
.claude/commands/**
core/.claude/agents/**
.claude/agents/**
core/scripts/orch-state.mjs
scripts/orch-state.mjs
core/scripts/decision-log.mjs
scripts/decision-log.mjs
core/scripts/lib/orch-run.mjs
scripts/lib/orch-run.mjs
core/docs/agent/**
docs/agent/**
AGENTS.md
CLAUDE.md
README_WORKFLOW.md
templates/**
kit.config.json
.kit/config.json
kit.json
tools/size-budget.json
tools/instruction-load.mjs
tools/install.mjs
tools/install-check.mjs
tools/sync.mjs
tools/drift-check.mjs
tools/workflow-link-check.mjs
tools/acceptance-check.mjs
tools/lib/kit.mjs
tools/lib/source.mjs
tools/test/**
docs/brain/decisions/**
package.json
.github/workflows/**
CHANGELOG.md
core/scripts/orch-preflight.mjs
scripts/orch-preflight.mjs
tools/lib/agent-result.mjs
core/scripts/lib/brain-doc.mjs
scripts/lib/brain-doc.mjs
core/scripts/lib/run-order.mjs
scripts/lib/run-order.mjs
tools/fixtures/orchestrator/**
docs/brain/invariants.md
docs/brain/agent-lessons/planner.md
docs/brain/run-log.md
core/docs/brain/gotchas/agent-workflow.md
docs/brain/gotchas/agent-workflow.md
```

Approved 2026-11-07 (Human, `090: all recommended`): the paths from `core/scripts/orch-preflight.mjs` down.

## Read Scope

Entire repo.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry. A deletion not in the list above stops the run and is asked, never done.

## Architecture Impact
- INV-1: preserves — the remaining agents keep their tier keys; install and sync keep their refusals.
- Changes: the workflow runtime and its role agents are deleted now that `run-plans.mjs` runs the loop; the checker pipeline (finders + verifier + security) stays as `/ship`'s default review until the single reviewer measures precision ≥ 0.28 (plan 091); ADR `docs/brain/decisions/NNNN-workflow-runtime-deleted-checkers-kept.md` — Arch-approved: Human 2026-11-06 (this goal), revised 2026-11-07.

## Step 0 — Reality Check
1. `git grep -ln` for each file in the deletion list; the hits are the reference list to clean (expect: `AGENTS.md`, `CLAUDE.md`, `commands.md`, `skills.md`, `workflow-map.md`, `model-routing.md`, `agent-roles.md`, `orchestrator.md`, `agent-evals.md`, `README_WORKFLOW.md`, templates, `tools/lib/source.mjs`, the manifests, `tools/test/agent-contracts.test.mjs`, `tools/test/agent-rules-sections.test.mjs`).
2. `orch-security.md` and `orch-ui.md`: 088 still calls `orch-ui` for `[ui]` cards and `plan-review.mjs` may call `orch-security` on sensitive paths — confirm from 088's code and keep both (they count toward the 5-agent budget with `orch-builder`, `plan-reviewer`, `git-agent`). `git-agent.md`: grep its users after 089; none → delete it too and note it.
3. `docs/agent-evals/`: the cases label checker roles; the eval tool runs any agent against every case since 087 — the case files stay; `agent-evals.md` text that explains the four roles becomes two lines.

## Atomic Sub-tasks

- [x] X1: Delete the workflow, `/auto-solve` (the five checkers and `/review-it` stay), `orch-gate`, `orch-merge`, `orch-report`, `orch-triage`, `orch-readiness`, `kit-runner`, `kit-prevalidate` from `core/`; remove their rows from `tools/lib/source.mjs`, the install manifest and the sync inventory; resync so the installed copies vanish — core/.claude/**, tools/lib/source.mjs, tools/install.mjs, tools/sync.mjs, .kit/install.json
- [ ] X2: Clean every reference (Step 0 list): `AGENTS.md`, `CLAUDE.md`, `commands.md`, `skills.md`, `README_WORKFLOW.md`, templates, `workflow-link-check` targets — AGENTS.md, CLAUDE.md, README_WORKFLOW.md, core/.claude/commands/commands.md, core/.claude/commands/skills.md, templates/**, tools/workflow-link-check.mjs
- [ ] X3: Shrink `orch-state.mjs` (dead commands and the base64 queues), `decision-log.mjs` (triage, calibration), `orch-run.mjs` (watch-only helpers stay); update their tests — core/scripts/orch-state.mjs, core/scripts/decision-log.mjs, core/scripts/lib/orch-run.mjs, tools/test/**
- [ ] X4: Rewrite the four docs to their limits: `orchestrator.md` (pieces, the run, settings, state rules, model calls), `agent-roles.md` (shared rules for the agents that remain, the result schema; line ~104 no longer says `kit-runner` in `/review-it` — Human 2026-11-07), `model-routing.md` (tiers, the remaining agent table, rules 1–4 and 6), `workflow-map.md` (sections 3–5, flows F2/F3) — core/docs/agent/orchestrator.md, core/docs/agent/agent-roles.md, core/docs/agent/model-routing.md, core/docs/agent/workflow-map.md
- [ ] X5: `tools/size-budget.json` + `tools/test/size-budget.test.mjs` with the limits above and one reason per line; wire it into `npm test` and the CI `kit-tests` job — tools/size-budget.json, tools/test/size-budget.test.mjs, package.json, .github/workflows/**
- [ ] X6: Drop the dead `orchestrator` keys from `kit.config.json` and `.kit/config.json` and from `tools/lib/kit.mjs`; `kit.json` version 2.1.0; ADR file — kit.config.json, .kit/config.json, tools/lib/kit.mjs, kit.json, docs/brain/decisions/**
- [ ] T1: Resync, every check, changelog with the deletion list, the `[human]` session check — CHANGELOG.md

## Technical Considerations
- Dependencies: 088 (runner, `plan-review.mjs`), 089 (`/ship` no longer names the deleted agents).
- `git` keeps every deleted file at `fd212e1` and earlier; the CHANGELOG entry names that sha so anything is recoverable.
- Frozen plans that name deleted files (057, 066, 067, 069–073, 076–079, 081, 082): untouched here; when one is reopened its Step 0 reality check will find the drift and the Planner rewrites it.
- Backend / API: none. Auth and validation: none. Security surface: smaller. Data / migration: config keys removed on sync with a NOTE line.

## Out of Scope
- Deleting the frozen plans' files or the brain scripts (`brain.mjs`, `kit-learn.mjs`, `kit-lessons.mjs`): they are idle behind `review.ship = off`, not loaded by sessions, and come back when the bar below is met.
- The bar for unfreezing the learning loop (written here so it is in one place): 10 consecutive kit or FoodVibe plans through `run-plans.mjs` with merged / attempted ≥ 0.9 and zero technical stops, and ≥ 50 labelled reviewer cases. Until then: a weekly 30-minute manual error review written to `docs/brain/error-review.md` (date, run, what failed, why, what changed), the Hamel Husain way.

## Critical Questions
- Q: delete `git-agent.md` with the rest? A: yes if Step 0 item 2 finds no user after 089; otherwise keep it (within the 5-agent budget).

## Execution Notes
- Step 0 (2026-11-07, builder): item 1 conflict — `core/scripts/orch-preflight.mjs` `settings()` (lines 299–302, outside the scope) requires `.claude/workflows/orchestrate.js`, `orch-readiness.md`, `orch-gate.md`, `orch-merge.md` and `kit-runner.md`; `run-plans.mjs` calls it, so X1 would make every run refuse ("settings: not installed"). Stopped before X1; asked `approved: core/scripts/orch-preflight.mjs`. Further out-of-scope live references: `tools/lib/agent-result.mjs` (ROLES + validators), `core/scripts/lib/brain-doc.mjs:307-321` (role phases), `core/scripts/lib/run-order.mjs:10`, `tools/fixtures/orchestrator/{readiness.mjs,brain/status.json}`, `docs/brain/{invariants.md,agent-lessons/planner.md,run-log.md}`, `core/docs/brain/gotchas/agent-workflow.md`.
- Step 0 item 2: ok — `orch-security`/`orch-ui` stay; `git-agent` has users (`fix.md`, `refactor.md`, `security.md`, `ship.md`, `standards-git.md`, `layers/cursor/**`) → kept. Agents after X1: 10.
- Step 0 item 3: ok — case files stay.
- Step 0 extra conflicts: X3 — no `plan-gate.mjs` took `note`/`flake`/`decisions`/`prepare`: `run-plans.mjs` calls `note` (354), `flake` (452), `decisions` (619) and `lib/plan-gate.mjs:80` emits `orch-state.mjs prepare`; only `trend`, `main-try`, `main-tries` and the `--notes-b64`/`--flakes-b64`/`--causes-b64` queues are dead. X5 — 24 command files remain after `/auto-solve` (limit 10 needs 14 more deletions not in the list). X6 — all 15 `orchestrator` keys are read by `run-plans.mjs`/`orch-state.mjs`/`orch-preflight.mjs`/libs (limit 12).
- decision: Human 2026-11-07 (`090: all recommended`): (1) `approved: core/scripts/orch-preflight.mjs` — `settings()` checks the kept files; full X1. (2) the out-of-scope reference files are approved (added to the scope block); history entries are marked "(deleted in plan 090)", not erased. (3) the grep item exempts `docs/agent-evals/cases/**`, `docs/orchestrator/runs/**` and the `-orch-merge-` folder name. (4) X3 removes only `trend`, `main-try`, `main-tries` and the three `-b64` queues. (5) budget at the real counts (24 commands, 15 keys), targets 10 / 12 recorded. (6) the tests that drive `orchestrate.js` through the fake-agent harness are deleted; orch-state / preflight / merge-verify tests are kept.
- X1 (2026-11-07): deleted the 9 sources; `sync --apply --prune` removed the installed copies and their `.kit/install.json` rows (`tools/lib/source.mjs` has no per-file rows). `orch-preflight.mjs settings()` now checks `orchestrate.md`, `run-plans.mjs`, `orch-state.mjs`, `plan-order.mjs`, `orch-builder.md`, `plan-reviewer.md`. The STALE_RENDER check (sync, drift-check) moved to `scripts/run-plans.mjs`, which bakes the same `PREPARE`/`CI_MIRROR`. Harness tests deleted: 75 of `orchestrator.test.mjs`, 7 of `orchestrator-env-retry`, 3 of `orchestrator-merge-only` (merge-verify / merge-ready kept), 2 of `orchestrator-preflight-plan`, 1 of `db-write-ask`, 3 of `agent-contracts`; fixtures `readiness.mjs` and `decisions-499-502.mjs` deleted (their only users were those tests). `agent-result.mjs` ROLES lost the five deleted roles; `brain-doc.mjs` PHASE_ROLES → PHASE_ROLE_COUNT (same behaviour on old transcripts).
