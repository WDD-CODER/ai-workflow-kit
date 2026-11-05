# Plan 065 — Lesson lines carry the run's code-made fact or nothing

Status: draft
Depends-on: none
Snapshot: b075db1e9c4876d4f210c95612df2e2a406a160a
Source: first orchestrator test run (test-512-422) — lesson files held category-only lines; Human decision "approve: code facts only" (2026-11-02)

## Problem Statement

`lessonFacts` (`core/scripts/lib/orch-run.mjs:534-567`) turns `status.json` into the lines the next run's agents read, but most
lines say only a category and name nothing the reader could act on:

1. **Category-only lines.** `parked: <reasonKind>` (:541, kinds at :456-466, the fallback is `parked: other`), `fix round caused by:
   other rule (test file)` (`causeLessons`, :501, `ruleTag` falls back to `other rule` at :484, `fileKind` at :468 keeps only
   "test file"), `fix round caused by: another failure` (:508), `plan N had to be asked about: an open question` (`askedKind`,
   :517-523, :563) and `missed: a later check failed after the checkers passed` (`missTag`, :511). A builder that reads them learns
   nothing it can look at.
2. **The facts the code has are dropped.** The code-written prefix of a park reason (the literals at `orchestrate.js:976-1133`:
   `same reason twice`, `environment`, `agent-call limit`, `no progress`, `replan needed`, `hand-off file`, `worktree`, `— needs the
   Human`), the failing command kind (`commandTag` :487, `finalGateKind` :440), the files the branch changed, and the checker finding
   id are all available to a script, but `lessonFacts` is a pure function of `status.json` and `status.json` stores only the joined
   `round-cause` string (`orchestrate.js:1118`, sliced to 280 chars; `orch-state.mjs:1029`), the park `reason` and `misses`.
3. **The rule stays.** The comment at `orch-run.mjs:477-479` ("free text from a model or the repo is never copied into a line the
   next run's agents read") is not touched. This plan only makes the lines specific using facts the code itself produces.

## Goals & Success Criteria
**Primary:** every lesson line names one fact the code produced (park-reason prefix, failing command kind, a path from the branch
diff, a checker finding id, a registered rule name); when the code has no such fact, no line is written. No agent writes lesson text.

- [auto] Fix-round cause lines carry the fact: a gate cause gives `<command kind> failed at <first failing file in the branch diff>`
  (file omitted, kind kept, when no failing file is in the diff); a checker cause gives `finding <id>` plus the registered rule name
  and the diff file when each exists. Test in `tools/test/orchestrator.test.mjs` with a `status.json` shaped like test-512-422's
  findings: the exact lines are asserted.
- [auto] A parked plan's line carries only the code-written prefix (from a fixed list of the `park()` literals, matched at the start
  of the reason, never the model text after it), e.g. `parked: same reason twice`, `parked: needs the Human`. A reason that matches
  no listed prefix gives no line. Test: one case per prefix, plus a reason with only model text gives zero lines.
- [auto] The final-gate line (064's routing unchanged) carries `finalGateKind` and the first failing diff file or registered rule id
  when status has it: `missed: the final gate failed (test: <file>)`; nothing extra when it does not.
- [auto] Silence rule: the category-only templates are gone. A test over the whole output of `lessonFacts` for the fixture asserts that
  no line equals or matches `parked: other`, `other rule`, `another failure`, `an open question`, `a later check failed after the
  checkers passed`, `a checker finding`, `a step`, `a check command`.
- [auto] A `status.json` that holds only category-level data (a park reason with model text only, a question with no code-made kind,
  a cause without a finding id or diff file) yields zero lines. Test asserts `lessonFacts(...)` is `[]`.
- [auto] The facts are stored by the script: `plans[N].diffFiles` (the branch's changed paths, capped), each finding's `id` in
  `roundCauses` entries, and the first failing file of a gate failure, written by `orch-state.mjs` inside the existing `set`, `stop`
  and `finish` calls (062's batched paths) — no new runner call per item. Test: a flow's runner-call count does not grow.
- [auto] `asked-about` lines are written only from a code-made fact; today the code has none (the question is the readiness agent's
  text), so no `asked` line is written. Test: a status with `asked` entries gives no `planner` or `readiness` line.
- [auto] `npm run build`, `npm run lint`, `npm test`, `node --test "tools/test/*.test.mjs"`, `node tools/orchestrator-e2e.mjs` and
  `node tools/drift-check.mjs --target .` all exit 0.
- [auto] `node scripts/scope-check.mjs --tests --plan=plans/065-lesson-lines-carry-the-runs-code-made-fact-or-nothing.plan.md`
  prints `SCOPE_TESTS: ok`, and `node scripts/scope-check.mjs --diff=origin/main` on the finished branch prints `SCOPE: ok`.
- [human] After the next real run with a fix round, open `docs/brain/agent-lessons/builder.md` on the run branch: each new line names
  a command kind, a file of that run's diff or a finding id, and no line is a bare category.

## Execution Mode
- Parallel: no
- Concurrent plans: shares `orch-run.mjs`, `orch-state.mjs`, `orchestrate.js` and `tools/test/orchestrator.test.mjs` with 059-064
  (all merged at v2.0.0); built before 066 and 067.
- Isolated DB: no

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/scripts/lib/orch-run.mjs
core/scripts/orch-state.mjs
core/scripts/decision-log.mjs
core/.claude/workflows/orchestrate.js
core/docs/agent/orchestrator.md
tools/test/orchestrator.test.mjs
tools/orchestrator-e2e.mjs
tools/fixtures/orchestrator/**
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
- INV-none: preserves — only the text and the existence of lesson lines change, and the facts `status.json` stores for them; lesson
  files are still written only by script, only on the run branch. No registered invariant in `docs/brain/invariants.md` is touched
  (INV-1 is the only one). This plan does not touch judgment-model routing (`FINAL_GATE_ROLES`, tiers, escalation).

## Step 0 — Reality Check

1. Runs only when `scripts/scope-check.mjs --drift` reports `REALITY: drift`: check the listed commits by symbol, print `ok` or
   `conflict: <what>` per commit; stop for a go only on a conflict.
2. Re-read `lessonFacts` (`orch-run.mjs:534-567`), `causeLessons` (:495-509), `askedKind` (:517), the `round-cause` write
   (`orchestrate.js:1118`) and the `roundCauses`/`asked` handling (`orch-state.mjs:1029-1032`) as they are on `origin/main`.
3. List every `park(` call site (`orchestrate.js:976, 979, 1001, 1018, 1028, 1036, 1060, 1068, 1077, 1082, 1098, 1101, 1111, 1116,
   1133`) and write the code-written prefix of each into Execution Notes; `u.why` (:1077) and `failure.why` (:1116) carry model or
   check text after a fixed part, so only their fixed part counts.
4. Find where a finding's `id` and `file` live in the checker result (`failure.findings`, :1119) and whether `failure.why` ever
   contains the id; decide where the script reads it from without a new runner call.
5. Find what "registered rule" can mean in the code (see Critical Questions) and print what exists.
6. `node tools/install-check.mjs` and `node --test "tools/test/*.test.mjs"` pass before any edit.

## User Stories
- As a builder agent, I want a lesson to name the check, the file or the finding, so I can look at it.
- As the Human, I want no lesson line that only says "other", so the lesson files stay short and true.

## Functional Requirements

### Must Have (P0)
- [ ] New `lessonFacts` templates for fix-round causes, parks and the final gate; the category-only templates removed.
- [ ] Silence rule: no code-made fact, no line.
- [ ] Script-side storage of the facts (diff files, finding ids, first failing file) inside the existing batched calls.
- [ ] `orchestrator.md` (lesson section) and a CHANGELOG entry.

### Should Have (P1)
- [ ] A `plans[N].diffFiles` cap (for example 40 paths) so `status.json` stays small.

### Nice to Have (P2)
- None.

## UI/UX Notes
None (scripts and docs only).

## Atomic Sub-tasks

Every step names its own test location.

- [x] A1: Failing tests first — a fixture shaped like test-512-422 gives category-only lines today — Step 0 findings to Execution Notes — `tools/test/orchestrator.test.mjs`
- [x] B1: Store the code-made facts in the run state without new runner calls — diff files, finding ids, first failing file, in the existing set, stop and finish paths — `core/scripts/orch-state.mjs`, `core/.claude/workflows/orchestrate.js`, `tools/test/orchestrator.test.mjs`
- [x] B2: Rewrite the fix-round and final-gate lesson lines to carry their fact — command kind, diff file, finding id, registered rule — `core/scripts/lib/orch-run.mjs`, `tools/test/orchestrator.test.mjs`
- [x] B3: Write a parked line only for a code-written reason prefix, and no line for model text alone — `core/scripts/lib/orch-run.mjs`, `tools/test/orchestrator.test.mjs`
- [x] B4: Remove every category-only line and the asked-about line, and prove silence on a bare status — `core/scripts/lib/orch-run.mjs`, `tools/test/orchestrator.test.mjs`
- [x] D1: Describe the new lines and the silence rule in the orchestrator doc — `core/docs/agent/orchestrator.md`
- [x] R1: Render the installed copies, run every check, add the changelog entry — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .`, build, lint, `npm test`, `node --test "tools/test/*.test.mjs"`, `node tools/orchestrator-e2e.mjs`
  - Scope: `scripts/**`, `.claude/**`, `docs/agent/**`, `docs/brain/**`, `.kit/install.json`, `CHANGELOG.md`

## Technical Considerations
- **What the code has, today:** the park-reason literals (`orchestrate.js:976-1133`); `commandTag` (`orch-run.mjs:487`) and
  `finalGateKind` (:440); `FINDER_ROLES`/`INJECTED_ROLES` (:437-438); the finding objects (`id`, `file`) in `failure.findings`
  (`orchestrate.js:1119`). **What it does not have in `status.json`:** the finding id, the diff file list, the first failing file.
- **Diff files are checked by git, not by text:** the script runs `git diff --name-only origin/<run-branch>...<branch>` itself (it
  already spawns git, e.g. `brain-commit`, `orch-state.mjs:1147-1160`); a path a model wrote is kept only if it is in that list.
- **`lessonFacts` stays pure** over `status.json`; the storing happens at `set`/`stop`/`finish`, which 062 already batches.
- **Dedupe keys:** `addLesson` (`decision-log.mjs:207-218`) dedupes by exact text or a `has` RegExp; new texts carry the file or id
  so two different files are two lines; the 40-line / 3000-char cap (`decision-log.mjs:58-59`) is unchanged here (066 changes it).
- **Legacy lines** already in lesson files stay; only new lines change.
- **Sanitising:** a path, id or command is checked against a strict character class (`ruleTag`-style) before it enters a line, so the
  comment at :477-479 still holds: nothing free-form is copied.

## Out of Scope
- A filtered copy of agent text (park reason, readiness question title) is a possible later plan, not part of this one.
- Counting repeats of a lesson and routing lessons to other roles (plan 066); sending lessons to the kit brain (plan 067).
- Changing the rule at `orch-run.mjs:477-479`.
- New model calls of any kind.

## Critical Questions
- "Registered rule" has no registry in code: `agent-rules.md` holds free-text sentences with no ids (`docs/brain/agent-rules.md`, one
  builder rule), and checker findings cite AGENTS.md hard rules in prose. The only registered ids found are the `INV-n` ids in
  `docs/brain/invariants.md`. Assumed (change on a no): a rule name counts as registered only when it is an `INV-n` id of that file;
  every other rule name is dropped from the line, and the finding id stands in. Step 0 re-checks for another registry.
- The readiness question has no code-made kind field (`orchestrate.js:166` schema: `questions` is a string list), so no `asked` line
  survives the silence rule. Assumed: the planner and readiness get no asked-about line from this plan.

## Execution Notes
- Source: orchestrator test run test-512-422 and the Human decision of 2026-11-02 ("approve: code facts only"). Facts from the kit at
  `origin/main` `9909c12` (v2.0.0).
- decision (Human, 2026-11-02): lesson lines carry only code-made facts; silence over noise; the rule at `orch-run.mjs:477-479` stays.
- A filtered copy of agent text (park reason, readiness question title) is a possible later plan, not part of this one.
- Architect + PM review (Planner, 2026-11-02): no duplicate of 030/046/047/048 (030 built the pipeline this plan re-templates; 046's
  kit-learn is untouched). Consequence accepted under "code facts only": the asked-about line disappears, so `/plan` (planner.md)
  and readiness get no asked-about lesson until a code-made question kind exists. Scope adds `tools/fixtures/orchestrator/**` for
  the test-512-422-shaped fixture.
- Orchestrator readiness (2026-11-03): the parked-line goal says the code-written prefix is matched at the start of the reason, but `— needs the Human` is a suffix (`orchestrate.js:1116`) and the prefix `UI environment blocked before the browser step` (`:859`, parked at `:1077`) is missing from the literal list → match `— needs the Human` as the fixed ending of the `:1116` reason only, add `UI environment blocked` to the prefix list, leave `reasonKind()` (`orch-run.mjs:456`) unchanged (delegated).
- Orchestrator readiness (2026-11-03): `lessonFacts` also writes lines the B tasks do not name (escalations, verify refuted/lateLow/reappeared, gate events, a [ui] regression, the readiness line "parked on environment after ready", the [ui] miss, plan-drift); the silence test forbids `other rule`, `a step` and `a check command` → keep these lines and drop one only when its tag falls back to a category (delegated).
- Orchestrator readiness (2026-11-03): "registered rule" has no registry in the code; the only registered id is INV-1 → a rule name counts only when it is an INV-n id, otherwise the finding id stands in (delegated).
- Orchestrator readiness (2026-11-03): the readiness `questions` field is a plain string list (`orchestrate.js:166`), so no code-made kind exists → no asked-about line is written for planner or readiness; the stored `asked` facts stay (delegated).
- Orchestrator readiness (2026-11-03): claim — 15 `park(` call sites at the lines the plan names; the literal list leaves out `UI environment blocked before the browser step` → build for what the code has; the builder logs the difference as seen: (delegated).
- Orchestrator readiness (2026-11-03): claim — 059-064 all merged; 061 is still `Status: draft` and not merged, 065 has no dependency on it → build for what the code has; the builder logs the difference as seen: (delegated).
- Builder (round 0): Step 0 ran (drift listed three config-only chore commits; no conflict). The `park(` literals found: `environment:`, `worktree:`, `agent-call limit:`, `replan needed:`, `no progress:`, `UI environment blocked…`, `environment, again after one retry:`, `same reason twice:`, `hand-off file:` as prefixes and `(fix rounds used: N of M) — needs the Human` as the fixed ending. Finding `id` and `file` live in `failure.findings` (ids like `check-bugs-1`); `failure.why` holds no id, so the facts ride as `--causes-b64` on the plan's next `set`, and orch-state keeps a path only when `git diff --name-only origin/<run>...origin/<branch>` lists it.
- Evidence: `npm run build`, `npm run lint`, `npm run test`, `node tools/install-check.mjs`, `node tools/drift-check.mjs --target .`, `node tools/orchestrator-e2e.mjs` (90 cases), both scope checks -> exit 0. `node --test tools/test/orchestrator.test.mjs` -> 140 pass, 1 fail.
- seen: `tools/test/orchestrator.test.mjs` test "final gate: PROJECT_CHECKS, then the manifest check, then orchestrator.ciMirror" already fails on `main` (the kit's own ciMirror list from commit 332c5e9); not touched here.
- Note: 061 is still draft (the plan states 065 does not depend on it); nothing built for it.
- Builder (round 1): Step 0 drift check. 0bcad4b `GATE_TIMEOUT_MIN` 15 to 20 (orchestrate.js, orch-state.mjs): ok. 332c5e9 `CI_MIRROR` list and its doc rows: ok. de1bac1 `USE_SLOTS` false: ok. All three are config-rendered constants and touch none of `lessonFacts`, `causeLessons` or the park/round-cause code; no conflict. Snapshot moved to `b075db1` (origin/main) so the drift check reads clean.
