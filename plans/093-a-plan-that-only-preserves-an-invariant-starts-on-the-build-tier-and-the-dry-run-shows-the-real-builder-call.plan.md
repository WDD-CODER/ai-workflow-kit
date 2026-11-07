# Plan 093 — A plan that only preserves an invariant starts on the build tier, and the dry run shows the real builder call

Status: draft
Depends-on: none
Snapshot: 129c54cfc992f2abb150bd4ffccde22a7560e306
Source: first real run of `scripts/run-plans.mjs` (run `first`, plan 092, 2026-11-07): the dry run printed `--model sonnet`, the real builder call used `--model opus`. Human 2026-11-07: `approve arch change INV-1`, form: only "changes" or "deviation" start on the judgment tier.

## Problem Statement
1. `run-plans.mjs --dry-run` prints the builder call with `MODELS.build` (`core/scripts/run-plans.mjs:302`), but the real call picks the plan's start tier (`:390`, `:416`): `startTier()` (`core/scripts/lib/orch-run.mjs:69`) returns `judgment` for any named invariant other than `INV-none`. The dry run therefore misreports the model, and a reader cannot trust it.
2. Almost every kit plan writes `INV-1: preserves`, so almost every plan's first builder runs on the judgment tier (Opus) though it leaves the invariant as it is.
3. `calls.csv` records the model from the call result (`r.model`), which may differ from the model actually passed on the command line.

## Goals & Success Criteria
**Primary:** the dry run and the real call build the same builder argv from one code path; a plan starts on the judgment tier only when its Architecture Impact says `changes` or `deviation`.

- [auto] `node --test tools/test/run-plans.test.mjs` passes with a new test: for one plan, the builder argv the dry run prints and the argv the fake runner receives on the real call are identical except the prompt/system-prompt file path — for a plan with `INV-1: preserves` (both `--model <models.build>`) and for one with `INV-1: changes` (both `--model <models.judgment>`); the dry run prints `tier: build (INV-1 preserves)` / `tier: judgment (INV-1 changes)`.
- [auto] `node --test tools/test/orchestrator.test.mjs` passes with `startTier()` cases: `preserves` → build, `INV-none` → build, no Architecture Impact → build, `changes` → judgment, `deviation` → judgment, unreadable entry → judgment (fail safe), invariants listed only for judgment.
- [auto] `calls.csv`'s `model` column holds the value passed after `--model` on that call (test: the fake runner returns a different `model` in its result; the csv keeps the passed one).
- [auto] `docs/brain/invariants.md` INV-1 Rule reads: the first builder of a plan whose Architecture Impact `changes` or `deviation`s an invariant runs on the judgment tier; `preserves` and `INV-none` start on `models.build`; Source names the new ADR. `docs/brain/decisions/0020-only-a-changed-invariant-starts-on-the-judgment-tier.md` exists with `Supersedes: 0016 (the start-tier rule only)` and `Arch-approved: Human 2026-11-07`.
- [auto] `npm run build`, `npm run lint`, `npm test`, `node --test "tools/test/*.test.mjs"`, `node tools/orchestrator-e2e.mjs` pass; sync then `node tools/drift-check.mjs --target .` report no drift.
- [human] Shipped with `/ship fast merge` (plan 089's check ①): the tree shows one `Review:` line and VERIFIED BY AGENT, then the PR opens and merges without a second question.

## Execution Mode
- Parallel: no. Built in the main folder on `feat/093-…` (solo flow), shipped with `/ship fast merge`.
- Isolated DB: no.

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspot `CHANGELOG.md`.

```scope
core/scripts/run-plans.mjs
scripts/run-plans.mjs
core/scripts/lib/orch-run.mjs
scripts/lib/orch-run.mjs
core/scripts/lib/claude-run.mjs
scripts/lib/claude-run.mjs
core/docs/agent/model-routing.md
docs/agent/model-routing.md
core/docs/agent/orchestrator.md
docs/agent/orchestrator.md
docs/brain/invariants.md
docs/brain/decisions/0020-only-a-changed-invariant-starts-on-the-judgment-tier.md
tools/test/run-plans.test.mjs
tools/test/orchestrator.test.mjs
tools/test/lib/**
tools/test/fixtures/fake-claude.mjs
tools/test/fixtures/**
CHANGELOG.md
```

## Read Scope

Entire repo.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a file outside the
`## Read-Write Scope` is needed: STOP, name the file, the change and why; offer `approved: <path>`.

## Architecture Impact
- INV-1: changes — the start-tier part of the rule: only an invariant the plan `changes` or `deviation`s starts the first builder on the judgment tier; `preserves` and `INV-none` start on `models.build`. The rest of INV-1 (judgment tier is a pinned strong model, never inherit; a failed plan's fresh builder runs on it) is unchanged. ADR: `docs/brain/decisions/0020-only-a-changed-invariant-starts-on-the-judgment-tier.md` (supersedes 0016's start-tier rule). Arch-approved: Human 2026-11-07 (`approve arch change INV-1` in chat).

## Step 0 — Reality Check
1. Read `startTier()` and `parseArchImpact()` in `core/scripts/lib/orch-run.mjs`: how `preserves` / `changes` / `deviation` are parsed, and what an unreadable entry returns.
2. Read `run-plans.mjs` around 300 (dry run), 390–420 (real builder call) and the `calls.csv` writer (~341–372); find where `r.model` comes from in `claude-run.mjs`.
3. Read ADR 0016 and the INV-1 tests in `tools/test/orchestrator.test.mjs` that assert the old rule.

## Atomic Sub-tasks

- [x] T1: Start a plan on the judgment tier only when it changes or deviates from an invariant — startTier() reads the entry's verb; unreadable stays judgment — core/scripts/lib/orch-run.mjs, tools/test/orchestrator.test.mjs
- [x] T2: Make the dry run print the builder call the real run makes — one shared function picks tier and model for both; the dry run prints the tier and why — core/scripts/run-plans.mjs, tools/test/run-plans.test.mjs
- [x] T3: Record in calls.csv the model that was actually passed to the call — core/scripts/run-plans.mjs, core/scripts/lib/claude-run.mjs, tools/test/run-plans.test.mjs
- [x] T4: Record the rule change — new ADR superseding 0016's start-tier rule; INV-1 text; model-routing and orchestrator docs — docs/brain/decisions/0020-only-a-changed-invariant-starts-on-the-judgment-tier.md, docs/brain/invariants.md, core/docs/agent/model-routing.md, core/docs/agent/orchestrator.md
- [x] T5: Resync, run every check, changelog — CHANGELOG.md

## Technical Considerations
- Backend / API: none. Auth and validation: none. Security surface: none (the reviewer and guard settings are unchanged). Data / migration: none.

## Out of Scope
- The escalation path (a failed plan's fresh builder on the judgment tier) — unchanged.
- The reviewer's model.

## Critical Questions
- none (Human 2026-11-07).

## Execution Notes
- T1: startTier() now returns judgment only for changes / deviation / an unreadable kind, lists only those invariants, and gives a reason ("INV-1 preserves", "INV-none", "no Architecture Impact"); orchestrator.test.mjs INV-1 case rewritten (73 pass).
- T2: builderCall() in run-plans.mjs resolves tier, model and reason plus the claudeArgs/runAgent options for both the dry run and the real call; both take the start tier from startTier(plan text) in lintPlan (no longer plan-info's startTier), the dry run prints `tier: <tier> (<reason>)` and the real settings path, and its JSON carries plans[n].builder.argv; the new run-plans test compares that argv with the fake runner's for INV-1 preserves (sonnet) and changes (opus) — 22 pass.
- T3: passedModel(argv) in claude-run.mjs; run-plans' modelCall writes the value after `--model` to calls.csv and status.json calls (fallback r.model when none, e.g. inherit); the test's fake answers with another model (`reportModel`) and the csv keeps `sonnet`/`opus` — 22 pass.
- T4: ADR 0020 (Supersedes: 0016 (the start-tier rule only), Arch-approved: Human 2026-11-07); INV-1 Rule and Source updated; model-routing.md and orchestrator.md say changes/deviation start on judgment, the dry run's tier line, and calls.csv's model; ADR 0016 left as it is (supersede, never edit). Synced; drift-check ok; brain.test 20 pass.
- T5: CHANGELOG entry; checks all exit 0 — npm run build, npm run lint, npm test, node --test "tools/test/*.test.mjs" (490/490), orchestrator-e2e (23 cases), e2e-check (55, 1 skipped), acceptance-check --e2e (122), leak-check (0 leaks), drift-check (0 undeclared). `node scripts/run-plans.mjs --dry-run --run smoke --plans 093` prints `tier: judgment (INV-1 changes)` and the builder with `--model opus` (WOULD START: no — this folder is on the feat branch, as expected).
- decision: behaviour: tools/test/fixtures/fake-claude.mjs appended to the scope (tools/test/** pre-approved) for a `reportModel` step field.
