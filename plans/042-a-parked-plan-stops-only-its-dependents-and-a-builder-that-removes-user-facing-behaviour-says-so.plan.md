# Plan 042 — A parked plan stops only the plans that depend on it or share its files, and a builder that removes something users already have says so

Status: draft
Depends-on: 041
Snapshot: a363b42

## Problem Statement

FoodVibe's run-499-502 (kit v1.12.0) showed two gaps that plan 041's decision triage does not close:

1. **One parked plan stopped every later plan (≈1 h of overnight time).** Plan 500 parked at 22:55 on a slot-only
   check (fixed by plan 040). Pass 1 then ended with 501 and 502 `skipped: not started: wave N parked 500 — later
   waves not started`. Neither needed anything from 500: in pass 2 (23:04–23:54) both built and merged with no change
   from the 500 fix. The cause is the wave loop in `orchestrate.js` (`if (stop || parked.length)`, ~l.798): any park
   skips every later wave and every pilot-waiting plan and stops the run. It never asks whether a later plan depends on
   the parked one or writes the same files.
2. **Builders removed behaviour users already had, and logged it like any other choice.** D33: plan 502's
   consistency sweep replaced the menu page's date chip with the plain date field; the chip's type-the-digits entry and
   its Enter/Tab/arrow keys are gone (D38: the keyboard doc still describes them). It was a `behaviour:` line among 38,
   seen only after the merge. D34 (text boxes grow except on screens that do not load the feature) is the same
   pattern. Only `behaviour:` and `seen:` exist (`DECISION_RE`); `orch-check-plan` ignores deleted handlers and inputs.

## Goals & Success Criteria
**Primary:** a park skips only the plans that depend on the parked plan or share its files, with the reason; every
other plan still runs. A removal of user-facing behaviour the plan did not name is always a `removes:` decision,
listed first, with a validation card — and an unlogged one is a checker finding.

- [auto] `node --test tools/test/orchestrator.test.mjs` passes, with new tests: two plans in two waves with no edge →
  the second is built and merged after the first parks, the run is not stopped; the second `Depends-on:` the first →
  skipped with reason `depends on parked 101` and no builder call; a third depending on the second → skipped
  `depends on parked 101`; a lock edge (`scope overlap`) → skipped `shares files with parked 101`; `onPark: "all"`
  (source hook) → today's `wave 1 parked 101 — later waves not started`; a `stopRun` and a final-gate failure still stop
  the run; an order result without `edges` stops as `all` with a run note; pilot still stops after `pilotSize`;
  `removes:` lines are kept (any case), numbered before every `behaviour:` and `seen:` line of the run, recorded with
  `set --removal`, and passed to `orch-check-plan` as `REMOVES`; `formatReport` prints one card per removal at the top
  of "What only the Human can do".
- [auto] `node --test tools/test/orchestrator-folders.test.mjs` passes, with: `orchestrator.onPark` accepts
  `dependents` and `all`, refuses anything else; installed `orch-state.mjs set --removal` appends to the plan's
  `removals` once (a repeat is not added twice).
- [auto] `node --test tools/test/eval-cases.test.mjs` passes with the two new `orch-check-plan` cases.
- [auto] `node tools/orchestrator-e2e.mjs` prints `ORCHESTRATOR_E2E: ok`, with run beta's 203 skipped as
  `depends on parked 202` (real `orch-state.mjs order` edges).
- [auto] `npm run build` and `npm test` pass (install-check: `ON_PARK` rendered, the settings row, the angular pack's
  removal signals in the installed `orch-check-plan.md`, no `PACK:` marker left in a core-only install).
- [auto] `node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .` reports no drift.
- [human] The next FoodVibe run in which a plan parks: later plans that neither depend on it nor share its files are
  merged in the same run, and the report lists each skipped plan with one of the two reasons.
- [human] The first run in which a builder removes a key, input, field, screen or shortcut: the report shows the
  `removes:` line first and a card for it under "What only the Human can do".

## Execution Mode
- Parallel: no
- Concurrent plans: none (041 must be merged first: both edit `numberedDecisions` and `formatReport`)
- Isolated DB: no

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/.claude/workflows/orchestrate.js
core/scripts/orch-state.mjs
core/scripts/lib/orch-run.mjs
core/.claude/agents/orch-builder.md
core/.claude/agents/orch-check-plan.md
core/.claude/agents/orch-report.md
core/.claude/agents/orch-ui.md
core/.claude/commands/orchestrate.md
core/.claude/commands/take-plan.md
core/.claude/commands/ship.md
core/docs/agent/decision-review.md
core/docs/agent/agent-roles.md
core/docs/agent/job-validation.md
core/docs/agent/orchestrator.md
core/docs/brain/gotchas/agent-workflow.md
packs/angular/FRAGMENTS.md
packs/react-vite/FRAGMENTS.md
kit.config.json
tools/lib/kit.mjs
tools/install-check.mjs
tools/orchestrator-e2e.mjs
tools/fixtures/orchestrator/plans.mjs
tools/test/orchestrator.test.mjs
tools/test/orchestrator-folders.test.mjs
tools/test/eval-cases.test.mjs
docs/agent-evals/cases/orch-check-plan/**
.claude/**
scripts/**
docs/agent/**
docs/brain/**
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

- INV-none: preserves — `docs/brain/invariants.md` holds only the template entry; no invariant is touched.

## Step 0 — Reality Check

Runs only when `scope-check.mjs --drift` reports `REALITY: drift` (it will: 040 and 041 land first). Check by symbol:
the wave loop's `if (stop || parked.length)` block, `DECISION_RE`, `take()`, `numberedDecisions`, `checkers()` in
`orchestrate.js`; `order()` and `set()` in `orch-state.mjs`; `formatReport` / `validationList` in `lib/orch-run.mjs`;
041's ask-list ordering. Print one line per commit: `ok` or `conflict: <what>`. STOP for a go only on a `conflict`.

## User Stories
- As the Human, I want a parked plan to stop only the plans that need it, so one bad plan does not cost me the night.
- As the Human, I want to see first, and check on the page, anything a builder took away from users.

## Functional Requirements

### Must Have (P0)
- [ ] With `orchestrator.onPark: "dependents"` (default), a park skips only later plans that depend on it (directly or
  through a chain) or share files with it; the rest run. Reasons, exactly: `depends on parked <NNN>`,
  `shares files with parked <NNN>` (printed as `skipped: <reason>`).
- [ ] A `stopRun` (environment broken: merge folder not clean) and a final-gate failure still stop everything. Pilot
  still stops after `pilotSize` plans. `onPark: "all"` keeps today's behaviour exactly.
- [ ] `removes: <what users lose> — reverse: <how>` is a third decision type, kept by `DECISION_RE`, numbered first.

### Should Have (P1)
- [ ] Builders log `removes:` for any removal or narrowing of existing user-facing behaviour the plan does not name, or
  `ESCALATE` when it is the plan's core. Each `removes:` gets a validation card at the top of the report.
- [ ] `orch-check-plan` turns a removed handler or input in the diff that is neither named in the plan nor logged into
  a `major` finding.

### Nice to Have (P2)
- [ ] Inside one wave, a lock-group member after a parked member is skipped with `shares files with parked <NNN>`.

## UI/UX Notes
- Report and CLI text only. Plans table: `| 502 … | skipped | 0 | | | depends on parked 500 |`. A run note per park:
  `wave N parked 500 — skipped 502 (depends on parked 500); 1 later plan(s) go on`.
- Card, first under "What only the Human can do": `### Removed behaviour — check before merging the PR`, then
  `<n>. 502: D1 removes: <what users lose> — reverse: <how> — open the screen; accept: decisions: ok · keep it: D1 ✗ restore`.

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [ ] A1: Hand the workflow the dependency and shared-file edges it needs — `order()` emits `edges: (j.edges ?? []).filter((e) => !e.met)` next to `waves` and `waveLocks` (`waveLocks` is per-wave only; cross-wave overlaps exist only as `lock: true` edges) — core/scripts/orch-state.mjs
- [ ] A2: Add the switch — `const ON_PARK = {{orchestrator.onPark|json}}`; scaffold `"onPark": "dependents"` plus one `$comment` sentence (`dependents` = a park skips only the plans that depend on it or share its files; `all` = a park stops every later plan, the behaviour before this plan); `orchestratorProblems` refuses any value but `dependents`/`all` with `orchestrator.onPark is <v> — it must be "dependents" (a park skips only its dependents and the plans that share its files) or "all" (a park stops every later plan)` — core/.claude/workflows/orchestrate.js, kit.config.json, tools/lib/kit.mjs
- [ ] A3: Skip only what a park blocks — pure `blockedBy(parkedNnns, laterNnns, edges)` in `orchestrate.js` returns `Map<nnn, reason>`: first every later plan reachable over non-lock edges from a parked plan → `depends on parked <root>`; then every later plan with a `lock` edge to a parked plan → `shares files with parked <NNN>`; then plans reachable over non-lock edges from those → `depends on parked <root>` (root = the parked plan the chain starts from). In the wave loop: `stop`, `ON_PARK !== 'dependents'`, or `!Array.isArray(order.edges)` → today's block unchanged (the last case adds the note `onPark dependents: the plan order has no edges — later waves not started, as onPark "all"`); otherwise `setPlan(nnn, { state: 'skipped', reason })` per blocked plan, drop them from later waves (an emptied wave is skipped), one run note per park, no `state stop`, the loop goes on; pilot `waiting` keeps its pilot reason — core/.claude/workflows/orchestrate.js
- [ ] A4: Keep one lock group's later member from building on a parked member's files — in the unit loop, with `ON_PARK === 'dependents'`, a member after a parked one gets `setPlan skipped` `shares files with parked <NNN>` and no `runPlan` — core/.claude/workflows/orchestrate.js
- [ ] B1: Make `removes:` a decision type listed first — `DECISION_RE = /^(behaviour|seen|removes):/i`; `numberedDecisions`: every `removes:` line of the run first (plan order), then the per-plan groups as today (`behaviour:` then `seen:`); the `COMMON.decisions` schema description and the comment above `DECISIONS` name all three — core/.claude/workflows/orchestrate.js
- [ ] B2: Record each removal where the report can read it (run notes are capped per plan) — `orch-state.mjs set --removal "<D-id> <text>"` (`removal` added to `FLAGS`) appends to `status.plans[nnn].removals` unless present; after numbering, the workflow calls `setPlan(d.plan, { removal: \`${d.id} ${d.text}\` })` per `removes:` decision — core/scripts/orch-state.mjs, core/.claude/workflows/orchestrate.js
- [ ] B3: Put a card per removal at the top of the Human's list — `validationList` (or `formatReport` just before it) prints `### Removed behaviour — check before merging the PR` and one numbered card per entry in `plans[].removals`, numbers running on into the existing cards; no removals → no section — core/scripts/lib/orch-run.mjs
- [ ] B4: Tell builders and Workers that removing is a decision — orch-builder.md step 3 and take-plan.md: removing or narrowing an existing user-facing behaviour (a key handler, an input mode, a field, a screen, a shortcut) the plan does not name → a `decisions` entry `removes: <what users lose> — reverse: <how>` (Worker: `- decision: removes: …`); when the plan cannot be done without that removal → `ESCALATE` — core/.claude/agents/orch-builder.md, core/.claude/commands/take-plan.md
- [ ] B5: Make the checker look for removals nobody logged — orch-check-plan.md "Look for": in `git diff BASE...BRANCH`, a deleted key/pointer handler, input, form control, screen or shortcut whose behaviour is not re-added elsewhere in the diff, not named by the plan, and not in `REMOVES` → problem `rule: "unlogged removal: <what users lose>"`, severity `major`, file and line in BASE; generic signals (`addEventListener('key`, `<input`, `<select`, `<textarea`, a deleted route or menu entry) plus a `<!-- PACK:removal-signals -->` line; `checkers()` adds `REMOVES` (that plan's `removes:` texts) to the orch-check-plan task only — core/.claude/agents/orch-check-plan.md, core/.claude/workflows/orchestrate.js
- [ ] B6: Give each UI stack its own removal signals — `## removal-signals` sections: angular (`@HostListener('keydown…` / `document:keydown`, `(keydown`, `(keyup`, `formControlName=`, `[formControl]`), react-vite (`onKeyDown=`, `onKeyUp=`, `onChange=` on a removed input); node-express gets none (the marker line is dropped) — packs/angular/FRAGMENTS.md, packs/react-vite/FRAGMENTS.md
- [ ] B7: Say "three kinds, `removes:` first" everywhere decisions are described — decision-review.md §1 (the rule) and §2 (`removes:` first); agent-roles.md rule 9 ("those three kinds"); orch-ui.md, orch-report.md, ship.md and orchestrate.md step 4 ordering; job-validation.md "Decisions the Human grades" — the listed files
- [ ] C1: Document both changes — orchestrator.md: settings row `onPark`, "Wave gate" rewritten (dependents / shares files / `all`; `stopRun` and final gate still stop), l.219 "the wave gate stops the run" fixed, report section names `removes:`; orchestrate.md step 4: skipped plans with their reason and the removal cards; gotcha "one parked plan stopped the whole run" (what hurt: run-499-502, ≈1 h); Unreleased entry — core/docs/agent/orchestrator.md, core/.claude/commands/orchestrate.md, core/docs/brain/gotchas/agent-workflow.md, CHANGELOG.md
- [ ] T1: Prove the park rules with tests that fail on today's code — the cases in the first Done-when item; `runFlow`'s `order` stub takes `hooks.edges`; `onPark: "all"` via `hooks.source` replacing `const ON_PARK = "dependents"` — tools/test/orchestrator.test.mjs
- [ ] T2: Prove `removes:` end to end in unit tests — kept and ranked first, `set --removal` command sent, `REMOVES` in the check-plan task only, the report card; config validation; installed `set --removal` dedupe — tools/test/orchestrator.test.mjs, tools/test/orchestrator-folders.test.mjs
- [ ] T3: Prove it with real plan order — fixture 203 `deps: ['201', '202']`; beta 1 check becomes `s1.plans['203'].state === 'skipped' && s1.plans['203'].reason === 'depends on parked 202'`; beta 2 still merges 202 then 203 — tools/fixtures/orchestrator/plans.mjs, tools/orchestrator-e2e.mjs
- [ ] T4: Add the checker eval cases — `planted-unlogged-removal` (toy plan "use the shared date field on the menu page", diff deleting a `keydown` handler and an `<input>` in `src/menu/date-field.ts`, no REMOVES; expected `{ file, rule: ["unlogged removal", "removes:", "removed behaviour"], severity: "major" }`, note `planted: …`) and `clean-removal-named-in-plan` (same diff, the plan names the removal; `findings: []`); eval-cases test asserts both exist with those labels; install-check asserts the rendered signals — docs/agent-evals/cases/orch-check-plan/**, tools/test/eval-cases.test.mjs, tools/install-check.mjs
- [ ] R1: Render the kit's own installed copies and check drift — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .` — scripts/, .claude/, docs/agent/, docs/brain/, .kit/install.json

## Technical Considerations
- Dependencies: `orchestrate.js` (wave loop ~l.767–809, `take()` ~l.281, `numberedDecisions` ~l.294, `checkers()`
  ~l.421, final gate ~l.818), `orch-state.mjs` (`order()` ~l.368, `set()` ~l.531, `FLAGS` l.72), `lib/orch-run.mjs`
  (`validationList` ~l.196, `formatReport` ~l.243), `lib/plan-graph.mjs` `computeOrder` (edges with `reason` and `lock`;
  read only, unchanged). The workflow has no file or git access, so `blockedBy` is a pure function over the edges.
- New files needed: the two eval case folders only (kit-repo files, not installed; no manifest change).
- Model changes: `order` emits `edges`; `status.plans[n].removals` (string list, optional); `formatReport` without
  removals prints today's output.
- Cost (estimate): `onPark` adds no agent call; a skipped plan costs one runner call as today, plus one run note per
  park. Plans that now run cost their normal build — in run-499-502, about what pass 2 spent on 501/502, minus a
  relaunch. `removes:`: one runner call per `removes:` decision (usually 0–2 per run); ≈150 prompt tokens more per
  `orch-check-plan` call; an unlogged removal costs one fix round (builder + gate + checkers, ≈5–10 min) — rare.
- Security surface: none new. `--removal` text goes through the runner's existing quoting (`q()`), like `--reason`.
- Judging roles: `orch-check-plan` stays on `models.review` (never Haiku).

## Out of Scope
- The triage agent, the `ask` section and its hard rule `removes:` → `ask` — plan 041 (this plan only ranks and
  carries the cards).
- Readiness questions about removals a plan may cause, and readiness verifying plan claims — plan 043.
- Run close-out, CI parity — plan 044. Scoring fairness and growing the case set — plan 048.
- FoodVibe's grading of D33/D34 and the stale keyboard doc (D38) — FoodVibe Planner.

## Critical Questions
- Q: `orchestrator.onPark` default? A: `dependents` — it would have saved ≈1 h in run-499-502; `all` stays one
  setting away. (Human, 2026-10-30)
- Q: A plan that `removes:` something — merge it into the run branch or hold it before the merge? A: merge into
  the RUN branch (never main), list it first as an `ask` item and add a card — the Human reviews the PR before main
  anyway; holding would park the plan and now also skip its dependents. (Human, 2026-10-30)
- Q: An unlogged removal found by `orch-check-plan` — `major` (one fix round: log it or restore it) or `minor` (a note
  only)? A: `major` — an unlogged removal is exactly what reached the Human silently in D33. (Human, 2026-10-30)
- Q: Removal signals per stack — pack fragments or a config list? Default: pack fragments (`PACK:removal-signals`) —
  the kit's existing home for stack text; a project still adds its own through `docs/brain/agent-rules.md`.
- Q: Inside one wave, skip a lock-group member after a parked member (A4)? Default: yes — same risk as a later wave.
- Q: A plan two steps from the parked one — which number does the reason name? Default: the parked plan the chain
  starts from (`depends on parked 500`), so every skipped line points at the plan the Human must fix.

## Execution Notes
- Source: run-499-502 handoff §3 P3 and P6, §6.1 and §6.2, §8 Q3 and Q4 (both still open → Critical Questions).
- Handoff claims that did not match the code (designed against the code):
  - `scripts/lib/plan-deps.mjs` has no dependents or transitive helper; it parses one plan's own dependencies
    (`planDependencies`). Dependents come from `lib/plan-graph.mjs` `computeOrder` `edges`.
  - `order.waveLocks` holds lock groups inside one wave only (`lockGroupsWithin`); overlaps across waves are only in
    `edges` (`lock: true`) and `conflicts`, and `orch-state.mjs order()` passes neither to the workflow today (A1).
  - `scope-check --overlap` compares only `Status: active` plans and exact glob equality — unusable here;
    `globsOverlap` (already behind the lock edges) is the right test.
  - Inside a wave, a lock group runs its plans one after another and a park does not stop the next member today (A4).
  - Line numbers: wave stop ~l.794–808 (`if` at l.798), final gate ~l.818–833.
  - D34 is a partial rollout, not strictly a removal; B4's "narrowing" covers it only where users lose what they had.
- Overlap: 041 (same functions `numberedDecisions`, `formatReport`, `orchestrate.md` step 4 — build after it);
  048 (grows `orch-check-plan` cases; T4's two cases are its seed for D33); 043 (readiness, no shared code);
  039 (dock progress may show `skipped` reasons; no change needed here).
- Built after 041 (written in parallel with it): 041 stores every decision in `status.json` through `orch-state.mjs
  decision`. Step 0 checks whether B-items' `set --removal` can reuse that record (a `removes:` decision) instead of a
  second store; prefer one store, and write the finding here.

## Finish — review hand-off (replaces /ship)

Build order: wave 3 — after 041; parallel with 045.

When the plan is fully implemented, finish with a review hand-off instead of shipping. Do NOT merge, do NOT run /ship,
do NOT open a PR. This replaces every merge, `/ship`, PR, release or tag step written elsewhere in this plan. `[human]`
items and Human steps stay open and are listed under "Open risks".

While implementing: whenever the plan leaves something open and you choose, note it right away so it appears under
"Decisions you made on your own".

Finishing steps:
1. Fetch origin and rebase this branch on the latest origin/main. If there are conflicts, stop and tell me which files
   conflict.
2. From the kit root run: npm run build, npm run lint, npm test. Fix failures that belong to this plan, then rerun.
   Also run this plan's own `[auto]` Done-when commands (they include `node --test tools/test/`, which `npm test` does
   not run); any that still fail go under "Open risks".
3. Commit everything and push the branch to origin.
4. Your final message must be exactly this block, plain text, nothing before or after it:

```text
=== REVIEW HAND-OFF ===
Plan: <number and title>
Branch: <branch name>
Head commit: <short hash>
Based on origin/main at: <short hash>

Steps (one line per plan step):
<step id> | done / partial / skipped | <file(s) changed> | <one-line note>

Not in the plan (changes you made that the plan did not ask for, and why):
<list, or "none">

Decisions you made on your own (anything the plan left open):
<list, or "none">

Checks:
build: pass/fail
lint: pass/fail
test: pass/fail
<if any failed: the failing lines only>

Files changed (git diff --stat origin/main...HEAD):
<paste>

Open risks / things you could not verify:
<list, or "none">
=== END ===
```
