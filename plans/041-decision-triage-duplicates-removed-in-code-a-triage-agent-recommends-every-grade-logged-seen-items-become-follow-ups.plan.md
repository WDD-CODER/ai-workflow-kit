# Plan 041 — Decision triage: the run removes duplicate decisions in code, a triage agent recommends a verdict for each, every grade is logged, and `seen:` items become follow-ups

Status: draft
Depends-on: 030, 040
Snapshot: a363b42

## Problem Statement

FoodVibe's run-499-502 (kit v1.12.0) ended with 38 numbered decisions, read one by one by hand; about 30 were
distinct and about 7 needed the Human. Three gaps:

1. **Duplicates.** `take()` in `orchestrate.js` (~l.281) drops a line only when the plan and the text are identical.
   The builder, its fix rounds, the checkers and a relaunch each word the same thing differently, so it gets a new
   number each time: D11 = D21 (shared hold-to-repeat), D17 = D22 (form test fix), D18 = D31 (CORS errors on the main
   server), D19 = D20 = D23 (`--since=plan-start` works only in a slot). A relaunch numbers on with `firstDecision`
   (`numberedDecisions(first)`, ~l.843) but keeps no list of what pass 1 logged, so pass 2 logs pass-1 items again.
2. **No record of agreement.** `decision-log.mjs add` writes only `✗` rows, and only after `learn` saw a `✗`; an
   `ok` leaves nothing, so no agent can measure how often a recommendation matched the Human.
3. **`seen:` items vanish.** D7–D10, D16, D29, D30, D37, D38 are real follow-up work; after `ok` nothing keeps them.

The Human proposed a triage agent (2026-10-30): one call per run recommends a verdict per item; every grade is stored
next to it; a kind collapses only after measured agreement (shadow mode until then).

## Goals & Success Criteria
**Primary:** each decision listed once with a triage verdict and recommendation; every graded item one JSON line in
`docs/brain/decision-grades.jsonl`; graded `seen:` items in `docs/brain/follow-ups.md`. A collapsed item stays gradeable.

- [auto] `node --test tools/test/orchestrator.test.mjs` passes, with new tests: the run-499-502 fixture (pass 1, then a
  relaunch) collapses exactly D20 into D19, D21 into D11, D22 into D17, D23 into D19 and D31 into D18, keeps D7–D10
  as four items, and lists 33 decisions; a relaunch numbers on from the highest earlier id without `firstDecision`; one
  `orch-triage` call per run, none when `orchestrator.triage` is `off` or nothing new was decided; a null or invalid
  triage result gives today's full list with `triage: no usable result — full list` and the report is still written;
  the code rules turn an agent `accept` into `ask` for a non-behaviour/seen type, for an auth/security/data/money word,
  and for confidence below 70, and into `follow-up` for a `seen:` item; `formatReport` in shadow mode lists every
  decision in full, and in filter mode collapses only items of a kind with at least `triageMinGraded` grades and
  at least `triageMinAgreement` agreement.
- [auto] `node --test tools/test/decision-log.test.mjs` passes, with new tests: `grade` writes one JSON line per item
  (also on `decisions: ok`) with the 13 fields in Technical Considerations, never twice for the same run and id;
  `grade` writes the follow-up rows by the rule in A8; `stats` computes agreement per kind; `stats --write` keeps
  `triage-calibration.md` within 40 lines and 3,000 characters.
- [auto] `node --test tools/test/` and `node tools/install-check.mjs` pass (new config keys rendered and refused when
  wrong; `orch-triage.md` renders `model: sonnet` by default).
- [auto] `node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .` reports no drift.
- [human] The next FoodVibe run (after a kit sync) prints `triage: shadow · …`, an `ask` block with recommendations
  and every other decision on one line, and after the reply `docs/brain/decision-grades.jsonl` and
  `docs/brain/follow-ups.md` on the run branch hold the run's rows.

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
core/.claude/agents/orch-triage.md
core/.claude/commands/orchestrate.md
core/.claude/commands/plan.md
core/scripts/orch-state.mjs
core/scripts/lib/orch-run.mjs
core/scripts/decision-log.mjs
core/docs/agent/decision-review.md
core/docs/agent/orchestrator.md
core/docs/agent/model-routing.md
core/docs/agent/agent-roles.md
core/docs/agent/workflow-map.md
templates/docs/brain/follow-ups.md
templates/docs/brain/index.md
kit.config.json
tools/lib/kit.mjs
tools/lib/agent-result.mjs
tools/install-check.mjs
tools/orchestrator-e2e.mjs
tools/test/orchestrator.test.mjs
tools/test/orchestrator-folders.test.mjs
tools/test/decision-log.test.mjs
tools/fixtures/orchestrator/decisions-499-502.mjs
.claude/**
scripts/**
docs/agent/**
docs/brain/**
.kit/install.json
CHANGELOG.md
```

## Read Scope

Entire kit repo; FoodVibe's `docs/orchestrator/runs/run-499-502/status.json` (the real D1–D38 wording, read only).

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry.

## Architecture Impact

- INV-none: preserves — `docs/brain/invariants.md` holds only the template entry; no invariant is touched.

## Step 0 — Reality Check

Plans 030 and 040 change `finish()`, `formatReport`, `decision-log.mjs` and `orchestrate.md` step 5 first. Re-read
them by symbol (`take`, `numberedDecisions`, `formatReport`, `finish`, `init`, `add`, `learn`, the step 5 text) and
apply this plan to that text. Print one line per symbol: `ok` or `conflict: <what>`; STOP for a go only on a
`conflict`. Then take D1–D38 from FoodVibe's run-499-502 `status.json` notes (`D<n> …`) and write them to the fixture
with product names and paths replaced by neutral words; keep every other word. Compute the Jaccard score of each
§4 pair and print it. If a pair scores below 0.6 or a distinct pair scores 0.6 or more, STOP and show the scores
(never reword the fixture to make a test pass).

## User Stories
- As the Human, I want each decision listed once with a recommendation, and nothing collapsed until a kind earns it.
- As the Planner, I want `seen:` defects kept as follow-ups that `/plan` shows when a new plan touches the same files.

## Functional Requirements

### Must Have (P0)
- [ ] Duplicates are merged in code, within and across launches of one run; the merged lines stay in the record.
- [ ] Every graded item is one JSON line in `docs/brain/decision-grades.jsonl`, `ok` items included.
- [ ] Shadow mode: one `orch-triage` call per run; the Human still sees every decision.

### Should Have (P1)
- [ ] Graded `seen:` items become `docs/brain/follow-ups.md` rows that `/plan`'s review lists for its files;
  `stats` shows agreement per kind and filter mode uses it.

### Nice to Have (P2)
- [ ] The line `triage: <mode> · agreement (last 50): <n>% · collapsed: <n> · ask: <n> · follow-ups: <n>`.

## UI/UX Notes
- Chat summary (`/orchestrate` step 4), from handoff §5.9 (the full text is in A12):
  `Run run-499-502 — 4 merged. Decisions: 6 to grade, 18 accepted by triage, 9 follow-ups (saved on your reply).`
  then the triage line, then at most 10 `ask` items in full (`D33 · 502 · ask · <decision line>` and an indented
  `recommend: … — why: …`), `N more to grade: D… (in the report)` past 10, then `accepted: D1 D2 … (reply D<n> ✗ to
  override)`, `follow-ups: D7 D8 …`, `noise: D15 …`, and the reply line `reply: decisions: ok | D<n> ✗ <what I'd choose>`.
- Shadow prints accepted, follow-up and noise items one line each; filter prints an id only for a calibrated kind;
  `off` or a failed triage prints today's list. The report file lists every decision in full under `### To grade`,
  `### Accepted by triage`, `### Follow-ups`, `### Noise`, `### Not triaged`, duplicates as `also: <text> (<role>, round <n>)`.

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [ ] A1: List each decision once — `take(nnn, round, ...results)` (all 7 call sites pass `ctx.round`): words = lower-case, the type prefix and the ` — reverse: …` tail removed, punctuation stripped, stop words (`a an the and or of to in on for is it its with as at by be so that this not no`) dropped; a new line is a duplicate of a kept one with the same type when (same plan, or both `seen:`) and (both name the same `file:line` (`/[\w./-]+\.\w{1,5}:\d+/`), or word-set Jaccard ≥ 0.6 and they do not name different `file:line`s); the first is kept and gets `alsoFrom.push({ text, role: r.role, round })` — core/.claude/workflows/orchestrate.js
- [ ] A2: Keep the run's decisions in `status.json` so a relaunch dedupes against them — new `orch-state.mjs decision --run <r> --plan <NNN> --id D<n> --text "<line>" [--verdict v --kind k --confidence n --rec "<text>" --why "<text>"]` or `--dup-of D<n> --role r --round n`; it upserts into `status.decisions[]` by id (a duplicate by `dupOf` + text), so a runner retry is safe; new flags in `FLAGS`; `init` adds `priorDecisions` (`status.decisions` with their `alsoFrom`) to its emit on a relaunch — core/scripts/orch-state.mjs
- [ ] A3: Number on and record without the notes cap — the workflow seeds `DECISIONS` with `init.priorDecisions` (`prior: true`; a new duplicate of one is recorded with `--dup-of`, never numbered); first number = max(`args.firstDecision`, highest prior + 1); one `state(['decision', …])` per item and per duplicate replaces the per-decision `note()` (counted under `run`, never cut by `maxNotesPerPlan`); the result adds `mergeFolder` and `triage` (from `fin.triage`) — core/.claude/workflows/orchestrate.js
- [ ] A4: Write the triage role — `orch-triage.md`: `tools: Read, Grep, Glob`, `model: {{models.review}}`, `effort: medium`, `omitClaudeMd: true`; reads `DECISIONS`, each plan's Goals, Done-when and Out of Scope, the cited `file:line` in `FOLDER` (the merge folder), `docs/brain/triage-calibration.md` and `docs/brain/agent-rules.md`; verdicts `accept` (a simple reversible default the plan left open), `ask` (changes what users can do or lose, data, authorship, money, auth, security, product feel, or unsure), `follow-up` (real work outside the plan), `noise` (not a decision, or `duplicateOf` a listed id); a `kind` slug reused from the calibration file when one fits; `recommendation` ≤160 and `why` ≤120 characters; `confidence` 0–100; says the code re-applies the hard rules; `## Output` example — core/.claude/agents/orch-triage.md
- [ ] A5: Ask the triage once per run and never let it block the report — after the final gate, when `TRIAGE !== 'off'` and new decisions exist: one `ask()` with `agentType: 'orch-triage'`, `schema: SCHEMA.triage`, `label: 'triage'`, `phase: 'Report'`, task `RUN`, `FOLDER: mergeFolder`, `PLANS` (paths from `order.plans`), `FILES` (per plan, the last `diff.files` from `checkers()`, kept in a map — no extra call), `DECISIONS` (id, plan, type, text, alsoFrom count); a null result, a non-object, or no `items` array → every item `verdict: 'none'` and the note `triage: no usable result — full list`; an item with an unknown id is ignored, a listed id with no valid item gets `none`; a `duplicateOf` naming another listed id → `noise` with `why: duplicate of D<n>`; `orch-triage` joins `ROLES` and the validator — core/.claude/workflows/orchestrate.js, tools/lib/agent-result.mjs
- [ ] A6: Enforce the hard rules in code, never trusting the model — `triageForce({ type, text, verdict, confidence })` in `lib/orch-run.mjs` returns `{ verdict, forced }`: `seen` + `accept` → `follow-up` (`forced: 'seen'`); a type other than `behaviour`/`seen` (plan 042's `removes`) → `ask` (`'type'`); `TRIAGE_SENSITIVE_RE` = `/\b(auth|authn|authz|authentication|authori[sz]\w*|login|password\w*|permission\w*|roles?|tokens?|sessions?|secur\w*|secrets?|encrypt\w*|schema\w*|migrat\w*|columns?|data shape|payments?|pay|prices?|pricing|money|billing|invoices?|currenc\w*|refunds?)\b/i` → `ask` (`'keyword'`); confidence missing or < 70 → `ask` (`'confidence'`); `none` stays `none`; the workflow applies a mirror copy (commented like `cardProblem`) before recording, and `decision` applies the lib one again — core/scripts/lib/orch-run.mjs, core/.claude/workflows/orchestrate.js, core/scripts/orch-state.mjs
- [ ] A7: Show the verdicts in the report and in the result — `triageView({ decisions, mode, stats, minAgreement, minGraded, maxAsk: 10 })` in `lib/orch-run.mjs` returns `{ ask, askMore, accepted, followUps, noise, none, collapsed, line }`; asks ordered forced `type`, forced `keyword`, agent asks by confidence (high first), forced `confidence`, then id; filter collapses a non-ask item only when its kind's stats meet both thresholds; `finish()` reads `docs/brain/decision-grades.jsonl` from the merge folder (fallback: the main folder), passes `stats` and the mode to `formatReport` and emits `triage`; `formatReport` replaces `## Decisions taken` with `## Decisions` (the sections in UI/UX Notes) and renames the notes list `## Run notes`; agreement `n/a (first run)` with no graded rows — core/scripts/lib/orch-run.mjs, core/scripts/orch-state.mjs
- [ ] A8: Store every grade and keep the `seen:` items — `decision-log.mjs grade --run <r> --reply "<reply>" --decisions <file> [--date] [--dir]`: parses the reply with `parseReply` (malformed → exit 2, nothing written); appends one JSON line per listed item to `docs/brain/decision-grades.jsonl` (skips a run + id already there); `kitVersion` from `<dir>/.kit/install.json` `kit.version`, else `unknown`; follow-up rows appended to `docs/brain/follow-ups.md` (`| Date | Run | Plan | Id | File:line | Decision | Human |`): every `seen:` item except one triage called `noise` that the Human left ok, plus a `behaviour:` item triage called `follow-up` that the Human left ok; prints `DECISION_LOG: graded <n> item(s) (<x> ✗) → docs/brain/decision-grades.jsonl; <m> follow-up(s) → docs/brain/follow-ups.md`; `add` is unchanged — core/scripts/decision-log.mjs
- [ ] A9: Measure agreement per kind — `decision-log.mjs stats [--kind K] [--last N] [--write] [--dir]`: rows with `triageVerdict` `none` are left out; an `ask` agrees with `✗`, every other verdict agrees with `ok`; prints `STATS <kind> graded=<n> agreement=<pct>` and `STATS all last=<N> agreement=<pct>`; `--write` writes `docs/brain/triage-calibration.md` (header, kind table, the last ≤20 disagreements one line each, text cut to 100 characters), refusing past 40 lines / 3,000 characters by dropping the oldest examples first; the agreement logic is one exported function that `finish()` reuses — core/scripts/decision-log.mjs, core/scripts/lib/orch-run.mjs
- [ ] A10: Show open follow-ups when a new plan touches their files — `decision-log.mjs follow-ups --open [--files a,b]` prints `FOLLOW_UP <run> <id> <file:line> — <text>` for rows whose path is in the list and that no file under `plans/` names as `follow-up: <run> <id>`; `/plan`'s Architect + PM review runs it with the draft's scope files and adds `open: <run> <id> seen in <file> — include?`; an included one goes in the plan's Execution Notes as `- follow-up: <run> <id>` — core/scripts/decision-log.mjs, core/.claude/commands/plan.md
- [ ] A11: Commit the brain files with the run, not on main — `orch-state.mjs brain-commit --run <r>`: in the merge folder, `git add docs/brain`, commit `orch(<run>): decision grades`, push the run branch; prints `BRAIN: committed <n> file(s) on <branch>` or `BRAIN: nothing to commit` — core/scripts/orch-state.mjs
- [ ] A12: Print and grade it the new way — step 3: a relaunch no longer needs `firstDecision`; step 4: the §5.9 layout in UI/UX Notes from the result's `decisions` and `triage`, `off` or `none` → today's list; step 5: write the result's `decisions` to `.claude/sessions/decisions-<run>.json`, then with `--dir <mergeFolder>`: `grade`, `stats --write`, `learn` (and on a `✗` the existing `add` / `repeats` / `rules`), then `orch-state.mjs brain-commit --run <run>` — core/.claude/commands/orchestrate.md
- [ ] A13: Add the three config keys — `orchestrator.triage` (`"shadow"`; `off|shadow|filter`), `orchestrator.triageMinAgreement` (`0.9`; a number 0.5–1), `orchestrator.triageMinGraded` (`20`; an integer 5–500) in the scaffold and its `$comment`; `orchestratorProblems` refuses others with `orchestrator.triage is "x" — it must be "off", "shadow" or "filter"`, `… — it must be a number from 0.5 to 1`, `… — it must be a whole number from 5 to 500`; rendered as `const TRIAGE = {{orchestrator.triage|json}}` in the workflow and as constants in `orch-state.mjs` — kit.config.json, tools/lib/kit.mjs, core/.claude/workflows/orchestrate.js, core/scripts/orch-state.mjs
- [ ] C1: Document it — `decision-review.md` new §5 (dedupe, triage, shadow/filter, grades file, calibration, follow-ups, the agreement rule); `orchestrator.md` settings rows and report section; `model-routing.md` and `workflow-map.md` rows for `orch-triage` (review); `agent-roles.md` schema row and a rule 10 line: `orch-triage` sorts the whole list in one call, it does not prove each item; seed `follow-ups.md` (header + empty table) and one `index.md` line naming it and the grades file; Unreleased entry naming the manifest step for projects with one — core/docs/agent/*.md (scope), templates/docs/brain/follow-ups.md, templates/docs/brain/index.md, CHANGELOG.md
- [ ] T1: Prove dedupe and the relaunch with the real duplicates — fixture `decisions-499-502.mjs` (Step 0 wording; pass 1 plans 499/500, pass 2 plans 500/501/502); the counts in the first Done-when item; update the two existing tests that count decision notes (decisions are now `decision` records) — tools/fixtures/orchestrator/decisions-499-502.mjs, tools/test/orchestrator.test.mjs
- [ ] T2: Prove the triage call, its fallback and the hard rules — `runFlow` gets an `orch-triage` stub hook and an `init` hook; cases from the first Done-when item; `triageForce` table test incl. `removes`, `author` (no match) and `price` (match); `triageView` and `formatReport` shadow/filter cases — tools/test/orchestrator.test.mjs, tools/orchestrator-e2e.mjs
- [ ] T3: Prove grades, stats and follow-ups — the Done-when cases for `grade`, `stats`, `follow-ups --open`; `brain-commit` on a temp repo (commit present, second call `nothing to commit`) — tools/test/decision-log.test.mjs, tools/test/orchestrator-folders.test.mjs
- [ ] T4: Prove the config keys — rendered defaults and the three refusal messages in install and sync; `orch-triage.md` in `ORCH_DEFAULTS` as `sonnet` — tools/install-check.mjs
- [ ] R1: Render the kit's own installed copies and check drift — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .` — scripts/, .claude/, docs/agent/, docs/brain/, .kit/install.json

## Technical Considerations
- Dependencies: `take`, `numberedDecisions`, `ask`, `state`, `runner` in `orchestrate.js` (`q()` cuts a value at 400
  characters, so the list cannot go in one CLI value: one `decision` call per item, as notes are today); `init`,
  `finish` (`orch-state.mjs`); `formatReport`; `parseReply` (`decision-log.mjs`); `orchestratorProblems`.
- New files: `orch-triage.md`, the `follow-ups.md` seed, the T1 fixture. `grade` and `stats --write` create
  `decision-grades.jsonl` and `triage-calibration.md`; no seed.
- Grade row (one JSON object per line, project-owned; plan 045 will also send rows as they are — no project code,
  `text` is the decision line cut to 400 characters): `date` (YYYY-MM-DD), `run`, `plan`, `id`, `type`
  (`behaviour|seen|removes`), `kind` (slug or `-`), `text`, `triageVerdict` (`accept|ask|follow-up|noise|none`),
  `triageRecommendation` (string or `""`), `confidence` (0–100 or `null`), `humanVerdict` (`ok|✗`), `humanChoice`
  (the `✗` note or `""`), `kitVersion`.
- Cost (estimate): one `orch-triage` call per run on the `review` tier (sonnet by default): ~30–60k tokens (≈2k agent
  file, ≈60 tokens per decision, 1–2k per plan's sections, ≤1k calibration, 10–20 file reads), 2–5 minutes; about one
  builder launch. Decision records cost what today's notes cost; step 5 adds three scripts and no model call.
- Security: the triage is read-only (no Bash); its verdict only orders and labels lines, and every item stays
  gradeable. Data: new `status.json` field `decisions[]`; a status without it reads as empty. Backend / API: none.

## Out of Scope
- The `removes:` type and its policy (042; A6 is ready for it); sending grade rows (045); rules or prompts learned
  from grades (046, 048); filter by schedule (047); a model-written calibration rule; closing follow-ups by script.
- `orch-report.md` (the workflow does not call it); FoodVibe's manifest entries for the new `docs/brain` files.

## Critical Questions
- Q: Build the triage agent? A: yes — the Human proposed it (Human, 2026-10-30).
- `orchestrator.triage` — A: `"shadow"` first, filtering per kind at `minAgreement` 0.9 over `minGraded` 20
  (Human, 2026-10-30).
- Follow-ups home — A: `docs/brain/follow-ups.md`, read by `/plan`'s review for files in the new plan's scope
  (Human, 2026-10-30).
- `ask` items in full — A: at most 10, the rest by id, all in the report (Human, 2026-10-30).
- Duplicates across plans — A: `seen:` lines dedupe run-wide, `behaviour:` lines only within one plan
  (Human, 2026-10-30).
- What counts as agreement — Default: `ask` agrees with `✗`, every other verdict with `ok`. A cautious kind then stays
  shown, never collapsed.
- Where step 5 writes the brain files — Default: in the merge folder, committed on the run branch (A11), so the PR
  carries them. Main accepts only plan and todo pushes, and a changed tracked seed in the main folder fails the next
  preflight.

## Execution Notes
- Source: run-499-502 handoff §3 P4, P5, §4 (the 38 decisions), §5.1–5.10, §8 Q1, Q2, Q5; the Human's choice on
  2026-10-30.
- Handoff vs code: (1) D18/D31 are in different plans (500, 501), so the "same plan" rule cannot merge them — see the
  Critical Question. (2) §5.9 is labelled shadow but collapses accepted items; §5.7 says shadow shows all — this plan
  follows §5.7 and uses the §5.9 layout for filter mode. (3) "`add` writes every item": `add` runs only after `learn`
  saw a `✗` and needs model-chosen kinds, so a new `grade` command does it with no model call. (4) "kit manifest (new
  agent file)": the kit has no `docs/workflow-kit/manifest.json`; projects that have one must classify the new
  `docs/brain` files (CHANGELOG). (5) "diff stat per plan": the triage has no Bash; the workflow passes the files from
  the last checker diff. (6) Today a decision past `maxNotesPerPlan` is missing from the report; A3 fixes it. (7) The
  learning step today writes `agent-rules.md` in the main folder, which builders of a pilot `continue` (cut from the
  run branch) never see; A11/A12 fix it. (8) `agent-roles.md` rule 10 (≤5 items per checking agent) vs one triage
  call over ~33 items: documented exception in C1. Line refs checked: `DECISION_RE` l.280, `take` l.281–292,
  `numberedDecisions` l.294, decisions noted ~l.843, `formatReport` l.243.
- Overlap: 030 (decision-log commands, rules sections, run-log in `finish`, step 5), 040 (`formatReport`, `finish`),
  042 (`DECISION_RE`, ranking), 045 (sends grade rows), 046–048 (read grades).

## Finish — review hand-off (replaces /ship)

Build order: wave 2 — after 030 (and 040); next: 042 and 045 (parallel).

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
