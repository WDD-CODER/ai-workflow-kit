# Plan 063 — The judgment tier is pinned to Opus; builders start on Sonnet and one failed fix round hands over to a fresh Opus builder from a written summary

Status: draft
Depends-on: none
Snapshot: aac496e051072bad36314d3b24767d2f7fa37469
Source: first orchestrator test run (test-512-422), finding F9 (Human wording, 2026-11-02)

## Problem Statement

The tier that decides (`models.judgment`: orchestrator readiness, and the builder that takes over after a failure) defaults to
`inherit` (`kit.config.json:98-106`), i.e. whatever model the session happens to use. A session on a weak model therefore
judges readiness and escalates a failed plan to the same weak model. The escalation path itself exists and is mostly right:

- `core/.claude/workflows/orchestrate.js:1038` escalates when `ctx.round >= 2` (the first fix round on the build tier failed),
  on `ESCALATE`/blocked (:953) or on a null builder (:951); the judgment-tier builder failing parks the plan (:1033).
- The script writes the hand-off file (`orch-state.mjs handoff()` :871-900: Step, Files changed, Tried, Failing check, Output tail,
  Replan, Not done) and the fresh builder gets `HANDOFF:` (`orchestrate.js:572,575`), not a transcript.
- `startTier()` (`core/scripts/lib/orch-run.mjs:70-74`) starts a plan on judgment only when Architecture Impact names an invariant
  that is not `preserves`; a plan that merely `preserves` one starts on build (comment :65-69 says why: judgment meant "the main
  session's model").
- With `MODELS.judgment === 'inherit'` the judgment builder gets no `agentType` and no model (`orchestrate.js:581-584`).

What is missing: the pin, the start-tier rule the Human asked for, and a hand-off that says what was **done** and what **failed**
(today it holds the tried step, the failing check, an output tail and the file list — not what the builder finished or the
findings of the round).

## Decision (Human, 2026-11-02)

- Judgment tier is pinned to a named strong model (`opus`), never `inherit`.
- Builders start on Sonnet. After **one** failed fix round a fresh Opus builder takes over from a **written summary** of what was
  done and what failed — not the Sonnet transcript. If Opus fails too, stop and come to the Human.
- A plan whose Architecture Impact names invariants starts on the strong tier.
- New invariant **INV-1** (approved by the Human in chat, 2026-11-02: `approve arch change INV-1`), below.

## Goals & Success Criteria
**Primary:** the strong tier is always a named model; a plan that names an invariant starts on it; a failed fix round hands over
to a fresh strong builder through a written summary; a second failure stops for the Human.

- [auto] `models.judgment` defaults to `opus` (kit scaffold `kit.config.json` and the install default in `tools/lib/kit.mjs`);
  install and sync refuse `inherit` and any value containing `haiku` for it, with a message naming INV-1; `build` and `review`
  keep their rules. The old "all five `inherit` = routing off" sentence is removed from the config `$comment` and
  `model-routing.md`. Test in `tools/test/orchestrator.test.mjs` named `INV-1 models.judgment never inherits`.
- [auto] `orchestrate.js` has no `inherit` branch for the judgment builder: it always calls `ask(…, {agentType: 'orch-builder',
  model: MODELS.judgment})` (the `orch-builder` file pins the build model by default; the explicit `model` overrides it), and
  `orch-readiness.md` renders `model: opus`. Test: the harness sees `model: 'opus'` on the readiness call and on an escalated builder.
- [auto] `startTier()` returns `judgment` for any named invariant other than `INV-none` — `preserves`, `changes`, `deviation` or
  unreadable — and `build` for `INV-none` or no Architecture Impact. Test named `INV-1 start tier` in `orchestrator.test.mjs`
  (replaces the cases at :29-37 that expect `preserves` → build).
- [auto] After exactly one failed fix round (round 1 fix on the build tier, the same check still failing), the next builder is a
  fresh judgment-tier builder; the build-tier builder is not called a third time. This also holds when `orchestrator.maxFixRounds`
  is 1 (the park at `orchestrate.js:1033` must not fire before the escalation). Flow test in `orchestrator.test.mjs`.
- [auto] The hand-off file gains `Done:` (what the builder's receipt says it finished: sub-task ids ticked and files changed) and
  `Failed:` (the failing check(s) with their tail and the round's open findings as `id file:line rule`), written by
  `orch-state.mjs handoff` from `--done` and `--failed` flags the workflow fills from the builder receipt and the round's findings;
  the escalated builder's prompt names the hand-off file, the plan and the branch diff as its only inputs. Test: the file has both
  lines; the prompt contains no builder output text (the previous builder's `summary` string never appears in it).
- [auto] A judgment-tier builder that returns anything but `built`, or whose checks still fail, parks the plan with a stop line the
  report shows as `needs the Human`; no third builder is started. Flow test (extends the case at `orchestrator.test.mjs:1864-1879`).
- [auto] `docs/brain/invariants.md` holds INV-1 (text below) instead of the template; ADR `docs/brain/decisions/0016-…md` exists with
  `status: accepted`; `node scripts/scope-check.mjs --arch --plan=plans/063-the-judgment-tier-is-pinned-to-opus-builders-start-on-sonnet-and-one-failed-fix-round-hands-over-to-a-fresh-opus-builder.plan.md`
  reports nothing missing; the "INV-1" test file name in INV-1's `Test:` line exists.
- [auto] `npm run build`, `npm run lint`, `npm test`, `node --test "tools/test/*.test.mjs"`, `node tools/orchestrator-e2e.mjs` and
  `node tools/drift-check.mjs --target .` all exit 0.
- [auto] `node scripts/scope-check.mjs --tests --plan=plans/063-the-judgment-tier-is-pinned-to-opus-builders-start-on-sonnet-and-one-failed-fix-round-hands-over-to-a-fresh-opus-builder.plan.md`
  prints `SCOPE_TESTS: ok`, and `node scripts/scope-check.mjs --diff=origin/main` on the finished branch prints `SCOPE: ok`.
- [human] On the Human's PC, a run with one plan that the Sonnet builder cannot fix in one round: the run log shows an Opus
  builder taking over once, and if it also fails the plan is parked with the Human named as next step.

## INV-1 (the text this plan writes into `docs/brain/invariants.md`)

```text
## INV-1 — Judgment roles run on a pinned strong model
- Rule: models.judgment names a model (default opus), never inherit; readiness, a failed plan's fresh builder and the first builder of a plan that names an invariant run on it; if that builder fails, the plan stops for the Human
- Source: docs/brain/decisions/0016-judgment-roles-run-on-a-pinned-strong-model.md
- Touches: `core/docs/agent/model-routing.md`, `core/.claude/agents/orch-readiness.md`
- Users lose if broken: a hard plan is judged or rebuilt by whatever model the session uses, so a weak model can approve or merge wrong work unnoticed
- Test: tools/test/orchestrator.test.mjs "INV-1 …"
```

Who loses what (asked and approved in the INV-n format): projects that set `models.judgment` to `inherit` (or all five tiers to
`inherit` to turn routing off) are refused at install and sync until they name a model; their readiness and escalation calls run
at Opus cost. Gain: a hard plan is never judged by a weak session model.

## Execution Mode
- Parallel: no
- Concurrent plans: shares `orchestrate.js`, `orch-state.mjs`, `orch-run.mjs` and `tools/test/orchestrator.test.mjs` with 059, 062
  and 064; built first of 063 → 062 → 064 (Human, 2026-11-02).
- Isolated DB: no

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/.claude/workflows/orchestrate.js
core/scripts/lib/orch-run.mjs
core/scripts/orch-state.mjs
core/.claude/agents/orch-builder.md
core/.claude/agents/orch-readiness.md
core/docs/agent/model-routing.md
core/docs/agent/orchestrator.md
kit.config.json
tools/lib/kit.mjs
tools/install-check.mjs
docs/brain/invariants.md
docs/brain/decisions/0016-judgment-roles-run-on-a-pinned-strong-model.md
tools/test/orchestrator.test.mjs
tools/fixtures/orchestrator/plans.mjs
scripts/**
.claude/**
docs/agent/**
.kit/install.json
CHANGELOG.md
```

`scripts/**`, `.claude/**`, `docs/agent/**` and `.kit/install.json` are rendered copies, written only by
`node tools/sync.mjs --target . --apply`. `docs/brain/invariants.md` and the ADR are this repository's own files, written by hand.

## Read Scope

Entire repo and its git history.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry.

## Architecture Impact
- INV-1: changes — ADR docs/brain/decisions/0016-judgment-roles-run-on-a-pinned-strong-model.md — Arch-approved: Human 2026-11-02

## Step 0 — Reality Check

1. Runs only when `scope-check.mjs --drift` reports `REALITY: drift`: check the listed commits by symbol, print `ok` or
   `conflict: <what>` per commit; stop for a go only on a conflict.
2. Read `orchestrate.js` `builder()` (:565-585), the fix loop (:1031-1050) and the park condition (:1033) with `maxFixRounds`
   = 1, 2 and 3; write in Execution Notes which round number is "one failed fix round" and that the park cannot pre-empt the
   escalation.
3. `git grep -n "models.judgment\|models.mechanical" -- tools templates core kit.config.json` — list every default and every
   mention of "routing off"/"all five inherit"; the change must reach them all (install-check, sync, docs, templates).
4. Where `orch-builder.md` tells the builder to write its own hand-off file (:57-59): the script writes the real one; report
   whether the builder's copy is read by anything, and keep or drop the sentence accordingly.
5. `node tools/install-check.mjs` and `node --test "tools/test/*.test.mjs"` pass before any edit.

## User Stories
- As the Human, I want hard work judged and rebuilt on a strong model whatever the session runs on.
- As the Human, I want a failed plan to stop with me after the strong builder fails, not loop.

## Functional Requirements

### Must Have (P0)
- [x] Config default `opus` and the `inherit`/Haiku refusal for `models.judgment`; `$comment`, `model-routing.md` tier table and
      rules updated (the "routing off" paragraph); the install-check default.
- [x] `orchestrate.js` judgment builder always carries `agentType` + `model`; `startTier` rule; stop line `needs the Human` after a
      failed judgment builder.
- [x] Hand-off `Done:` and `Failed:`; `Done:` is derived by the script (ticked sub-task ids in the plan file + files in the branch diff, not the builder receipt), the workflow fills `--failed` from the gate result and the round's findings.
- [x] INV-1 in `docs/brain/invariants.md`, ADR 0016, `Enforced from plan:` line kept.
- [x] `orchestrator.md` start-tier and fix-loop sections (:281-292) and CHANGELOG entry.

### Should Have (P1)
- [ ] The report names the builder tier each plan ran on and the escalation, so the Human sees Opus took over without reading logs.

### Nice to Have (P2)
- None.

## UI/UX Notes
None (config, scripts, agent text and docs only).

## Atomic Sub-tasks

Every step names its own test location.

- [x] A1: Failing tests first — `startTier` of a `preserves`-only plan is `build` today; `models.judgment: inherit` is accepted today; the hand-off file has no `Done:`/`Failed:`; Step 0 findings to Execution Notes
  - Scope: `tools/test/orchestrator.test.mjs`
- [x] B1: Config default `opus` and the refusal; install-check; `$comment`
  - Scope: `kit.config.json`, `tools/lib/kit.mjs`, `tools/install-check.mjs`, `tools/test/orchestrator.test.mjs`
- [x] B2: `startTier`, the judgment builder call, escalation after one failed round regardless of `maxFixRounds`, the `needs the Human` stop; flow tests
  - Scope: `core/scripts/lib/orch-run.mjs`, `core/.claude/workflows/orchestrate.js`, `tools/test/orchestrator.test.mjs`
- [x] B3: Hand-off `Done:`/`Failed:` and the builder instructions
  - Scope: `core/scripts/orch-state.mjs`, `core/.claude/workflows/orchestrate.js`, `core/.claude/agents/orch-builder.md`, `tools/test/orchestrator.test.mjs`
- [x] D1: INV-1, ADR 0016, `model-routing.md`, `orchestrator.md`
  - Scope: `docs/brain/invariants.md`, `docs/brain/decisions/0016-judgment-roles-run-on-a-pinned-strong-model.md`, `core/docs/agent/model-routing.md`, `core/docs/agent/orchestrator.md`, `core/.claude/agents/orch-readiness.md`
- [x] R1: Render the installed copies, run every check, add the changelog entry — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .`, build, lint, `npm test`, `node --test "tools/test/*.test.mjs"`, `node tools/orchestrator-e2e.mjs`
  - Scope: `scripts/**`, `.claude/**`, `docs/agent/**`, `.kit/install.json`, `CHANGELOG.md`

## Technical Considerations
- **Why `opus` as an alias:** the allowed values already include `opus`; Claude Code resolves the alias at run time, so the kit
  does not pin a dated id that goes stale. A project may set a full `claude-` id.
- **Why every named invariant starts on judgment now:** this reverses the reason in `orch-run.mjs:65-69` (judgment used to mean
  "the main session's model"); with a pinned tier it costs Opus on exactly the plans that touch a registered invariant, and INV-1's
  `Touches` is narrow on purpose so most plans stay `INV-none` or build-tier.
- **Why the summary is written by the script from facts:** the failing builder's transcript is not read; `Done:` is read by the
  script from the plan file's ticked sub-tasks and the branch diff (Human amendment 1) and `Failed:` from gate and checker results, so the Opus builder starts from evidence, not a story.
- **Fallback model:** `orchestrator.fallbackModel` (default `opus`) is unchanged; it retries a dead agent once.

## Out of Scope
- Changing the build or review tiers' defaults.
- A third builder, or retries after the judgment builder fails.
- Per-plan model choice by the Human.

## Critical Questions
- None open. Decided by the Human on 2026-11-02: pin to Opus, one failed round, written summary, stop after Opus fails, named
  invariants start on the strong tier, INV-1 approved. Assumed (Planner default, change on a no): an explicit `inherit` for
  `models.judgment` is refused rather than tolerated.

## Execution Notes
- Source: orchestrator test run test-512-422, finding F9. Facts from the kit at `origin/main` `aac496e`: escalation and park code
  (`orchestrate.js:1031-1050`), `startTier` (`orch-run.mjs:70`), `handoff()` (`orch-state.mjs:871`), tier defaults
  (`kit.config.json:98-106`, `tools/lib/kit.mjs:258-259`).
- Arch-approved: Human 2026-11-02 (`approve arch change INV-1`, in chat).
- decision: agent-chosen (coordinator, per Human amendment 1), UNGRADED: hand-off Done: is derived by the script from ticked sub-task ids in the plan file + files in the branch diff, not from the builder receipt — reverse: fill --done from the receipt again. [graded D1 ok 2026-11-02]
- Step 0: `scope-check --drift` printed `REALITY: clean` (no conflict). "One failed fix round" = round 1 (the first fix on the build tier) fails the same check; the failure is seen with `ctx.round` = 1, which now escalates (`ctx.round` 2, `mode` handoff). The old line `ctx.round >= MAX_FIX_ROUNDS` could fire first only for `maxFixRounds` 1 (round 1 fix failed, 1 >= 1 -> park, no escalation); with 2 or 3 the old `ctx.round >= 2` escalation already came first. That park line was removed: `maxFixRounds` >= 1, so round 0 never parked there, and the only remaining park is the judgment-tier builder that took over (`needs the Human`). Verified by the flow test with `maxFixRounds` 1, 2 and 3.
- Step 0 grep: every `models.judgment` mention reached: `kit.config.json` default and `$comment`, `tools/lib/kit.mjs` refusal, `tools/install-check.mjs` (readiness default `opus`, the old "all tiers inherit" case now keeps judgment on `opus`, three refusal cases), `core/docs/agent/model-routing.md` (the "routing off" sentence removed), `orchestrate.js` (no inherit branch; readiness call carries `model` too). `.kit/config.json` has no `models` and inherits the scaffold. Templates, packs and layers carry no judgment default.
- Step 0 item 4: the builder's own hand-off sentence in `orch-builder.md` was read by nothing (the script writes `handoff-<NNN>.md` at the same path and overwrites it): dropped, the builder now fills `notDone`/`planChange` and ticks sub-tasks in the plan (that is what `Done:` reads).
- Step 0 item 5: `node tools/install-check.mjs` passed before any edit (`INSTALL_CHECK: ok`); the unit tests were written after the code in this branch, so A1's "failing first" was not run as a separate red step.
- Not done: P1 (the report names the builder tier per plan) is unchanged: the report already lists escalations through the status `escalations[]` entry and the park reason now says `needs the Human`.
- Judgment-start plans (Architecture Impact names an invariant): after the first Opus builder fails, one fix round on Opus, then a fresh Opus builder takes over from the hand-off, as before (same escalation rule for both start tiers).
- decision: agent-chosen (coordinator), UNGRADED: `tools/fixtures/orchestrator/plans.mjs` added to the Read-Write Scope (`approved:` by the Human's coordinator) and the 202 fixture's Architecture Impact changed from `INV-1: preserves` to the default `INV-none` (plus its header comment) — under INV-1 any named invariant starts on judgment, so the old fixture could no longer be the build-start case of the e2e — reverse: restore the `inv:` argument on the 202 fixture and expect `judgment/first,judgment/fix,judgment/handoff` in `tools/orchestrator-e2e.mjs`. [graded D2 ok 2026-11-02]
