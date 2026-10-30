# Plan 046 — `/kit-learn`: the kit turns run evidence into a problem ledger, problem cards, plans and kit-owned lessons

Status: draft
Depends-on: 045
Snapshot: a363b42

## Problem Statement

Today a kit improvement starts when the Human pastes a run report into a kit session and explains what to do. The
run-499-502 hand-off shows what that session then does by hand, every time: find each problem in the evidence,
trace it to the code (`mainCheckProblem` checks only a command's shape; the wave loop skips every later wave after a
park), ask why nothing caught it, weigh fix options, write a plan. It also shows what nobody does:

1. **Nobody checks recurrence.** The manifest failure (P2) hit FoodVibe twice in two days; "the lesson wasn't turned
   into a gate". Nothing counts how often a problem came back, in how many runs and projects, after which kit version.
2. **Nobody checks that a fix held.** A plan merges, the kit releases, and no step asks whether the problem's
   signature appeared again in a run on a kit version that contains the fix (a regression).
3. **Nothing ranks the work.** Plans 039–044 were found in one evening; which one saves the most minutes per run is a
   guess.
4. **Generic lessons have no home in the kit.** Plan 030 gives each project its own role lessons; a lesson true for
   every project (for example "a `[auto:main]` command that reads slot state cannot pass") reaches a second project
   only if someone writes it into an agent file by hand. Lessons that never get retired grow the prompt and lower
   adherence (instruction files grew +226% over their life in 1,867 repos, arXiv 2608.11095; ~68% adherence at 500
   instructions, arXiv 2507.11538).
5. **Rejected ideas come back.** No log says "this was proposed on <date> and the Human said no because …".

Plan 045 puts every run's facts in the kit brain. This plan is the kit side: one command, `/kit-learn`, with no
explaining by text — the Human's ask on 2026-10-30.

## Goals & Success Criteria
**Primary:** in a kit session, `/kit-learn` reads the new evidence, keeps a permanent ledger of every kit problem with
its status, shows the Human at most 5 problem cards ranked by cost (regressions first), and on one reply turns each
card into a plan draft, an amendment to an open plan, a kit-owned lesson, or a dismissal — and every fix plan it
drafts carries a regression test of the problem.

- [auto] `node tools/kit-learn.mjs collect --driver <stub>` on the fixture brain (`tools/fixtures/kit-learn/`: 6 runs
  in 2 projects across 2 kit versions, events with 4 signatures, one of them reappearing after its fixing plan merged)
  prints the ranked table: `I1 regressed …`, then `new`/`open` by `priority`, with columns kind · signature title ·
  runs · projects · minutes lost · first seen · last seen · last kit version · status · linked plan.
- [auto] Regression detection: an issue with `status: fixed`, `fixCommit: <sha>` becomes `regressed` when an event
  with its signature comes from a run whose `kitCommit` has `<sha>` as an ancestor (`git merge-base --is-ancestor`),
  and stays `fixed` when the run's kit is older than the fix (test with a fixture kit repo of 4 commits).
- [auto] Priority: `minutesLost × (1 + ln(runs)) × (projects ≥ 2 ? 1.5 : 1)`, regressed first, `dismissed` hidden
  unless its run count grew by 2+ since the dismissal (then shown with `reopened:`); tested on the fixture.
- [auto] `tools/kit-learn.mjs apply --reply "I1 plan · I2 lesson builder · I3 dismiss covered by 040 · I4 later"`
  (stub driver, dry-run): writes `proposals` rows with the decision, sets `issues.status` (`planned`, `dismissed`),
  prints the follow-up steps; an unknown token is refused with the allowed list.
- [auto] Plan guard: `tools/kit-learn.mjs plan-check plans/NNN-*.plan.md` exits 1 for a plan with
  `Source: brain issue <id>` that has no Atomic Sub-task naming a path under `tools/test/` or
  `tools/fixtures/` (`regression test missing: a plan from a brain issue reproduces the problem in a test`), 0
  otherwise; the kit's `/plan` review runs it.
- [auto] Kit-owned lessons: `node tools/kit-lessons.mjs add --role builder --text "…" --why "…" --issue I7` adds
  `- K<n>: <text> — why: <why> (issue <id>, since v<next>)` to `core/docs/agent/kit-lessons/builder.md`;
  `update K<n>`, `retire K<n> --reason enforced:<path>|gone:<why>` (moves the line to the file's
  `## Retired` section with the reason; safety lines need `--human`); `check` fails a role file over 2,000
  characters of live lines; the tool never rewrites a line it was not asked to (test: a file with 5 lines, one
  `update`, 4 lines byte-identical).
- [auto] Every role launch gets the kit's lessons before the project's: `orchestrate.js` passes `LESSONS` as
  `[...kitLessons(role), ...projectLessons(role)]` (kit lines first, ordered by the file); the orchestrator test
  asserts the order and that a missing kit file adds nothing.
- [auto] Lesson upkeep: `tools/kit-learn.mjs lessons` prints per kit lesson: exposures (runs where its role ran on a
  kit version that had it) and recurrences of its issue's signature in those runs; a lesson with 2+ recurrences is
  printed `drift → enforce` (a card next time); a lesson whose issue is `fixed` with a fixture is printed
  `retire? enforced by <fixture>`. Never retires by itself.
- [auto] `node --test tools/test/`, `node tools/install-check.mjs` (a fresh install has `docs/agent/kit-lessons/`
  and no `kit-learn.md`), `node tools/workflow-link-check.mjs`, `node tools/leak-check.mjs`, R1 sync + drift pass.
- [human] With 045 running in FoodVibe: the Human types `/kit-learn` in a kit session, gets at most 5 cards whose
  root causes name real kit code (`file:symbol`), answers in one line, and finds the plan drafts / lesson lines /
  ledger statuses it promised; a week later `/kit-learn` does not show a dismissed card again.

## Execution Mode
- Parallel: no
- Concurrent plans: 047 (autonomy and schedule) builds on this plan's `proposals` and `collect`; build 046 first.
- Isolated DB: no (stub driver in every test)

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
tools/kit-learn.mjs
tools/kit-lessons.mjs
tools/lib/kit-learn/**
tools/brain-query.mjs
tools/install-check.mjs
tools/test/kit-learn.test.mjs
tools/test/kit-lessons.test.mjs
tools/test/orchestrator.test.mjs
tools/fixtures/kit-learn/**
.claude/commands/kit-learn.md
core/docs/agent/kit-lessons/**
core/docs/agent/kit-brain.md
core/docs/agent/decision-review.md
core/docs/agent/workflow-map.md
core/.claude/workflows/orchestrate.js
core/.claude/commands/plan.md
core/scripts/brain.mjs
core/scripts/plan-name-similarity.mjs
.gitignore
.claude/**
scripts/**
docs/agent/**
docs/brain/**
.kit/install.json
CHANGELOG.md
README.md
```

## Read Scope

Entire kit repo and its git history (fix commits and tags for regression detection). The brain, through
`KIT_BRAIN_READER_URI`.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry. Changing an Atlas role (the reader needs `INSERT`/`UPDATE` on
the kit's own collections) is the Human's step — show it, never do it.

## Architecture Impact
- INV-none: preserves — kit-only tools and command, new managed docs folder `docs/agent/kit-lessons/` (rendered into
  projects, kit-owned, sync keeps it current; project lessons stay in `docs/brain/agent-lessons/`, project-owned —
  the split the Human set on 2026-10-30: orchestrator learnings live in the kit forever, project ones in the project).
- `orchestrate.js` changes only in how `LESSONS` is assembled.

## Step 0 — Reality Check
1. `scope-check.mjs --drift`; confirm plan 030's `LESSONS` assembly and plan 045's collections exist on `origin/main`.
2. Confirm a file under the kit root `.claude/commands/` that has no source in `core/` survives `tools/sync.mjs
   --target . --apply` and `drift-check` (030 relied on this for `/kit-inbox`); if drift-check reports it, add it to
   the kit's own install record the way 030's Step 0 found, and write the finding here.
3. Confirm `docs/agent/` files are `managed` (`tools/lib/kit.mjs` `kindOf`: only `docs/brain/` is a seed).

## User Stories
- As the Human, I want to type `/kit-learn` and get the few kit problems that cost the most, already traced to code.
- As the Human, I want a problem that came back after its fix to be shown first, marked regressed.
- As the Human, I want what the kit learned in one project to reach every project, through the kit, without growing
  every prompt forever.
- As the Human, I want an idea I rejected to stay rejected until new evidence arrives.

## Functional Requirements

### Must Have (P0)
- [ ] `collect` (script, no model): new evidence since the cursor → issues upserted by signature → ranked table.
- [ ] Ledger statuses `open | planned | fixed | regressed | dismissed` with history; regression by git ancestry.
- [ ] `/kit-learn` command: collect → cards for the top 5 → one Human reply → `apply`.
- [ ] `plan-check`: a plan from a brain issue carries a regression test.

### Should Have (P1)
- [ ] Kit-owned lessons per role (`docs/agent/kit-lessons/`), injected before project lessons, capped, id-based edits.
- [ ] Lesson upkeep report: exposures, recurrences, drift → enforce, retire candidates with a positive reason.
- [ ] `lessonsIn` from projects grouped by similarity into one card with its project count.

### Nice to Have (P2)
- [ ] A kit-level triage prior: per decision kind, agreement across all projects' grades, written to
  `docs/agent/kit-lessons/triage-calibration.md` so a new project's plan-041 triage starts calibrated.

## UI/UX Notes
Cards are plain text for the CLI, one block each, at most 5, in this order of fields (the hand-off's §3 shape):

```
I1 · regressed · gate (main folder): <check> needs a slot stamp     runs 3 · projects 1 · lost ~95 min
  seen:      run-499-502 (500 parked after 3 rounds), run-510-514, …   last kit v1.14.0 (has fix 040 @ 3f2a…)
  cause:     core/.claude/workflows/orchestrate.js mainCheckProblem — checks the command's shape, not where it can run
  missed by: readiness (no slot-state rule) · tests (orchestrator.test.mjs l.551 expects a fix round)
  options:   a) drop at launch (040 did)  b) rewrite --since  c) run in a slot
  recommend: amend 040's A1 regex to also match <new form>   guard: fixture <name> in tools/test/orchestrator.test.mjs
  reply:     I1 plan | I1 amend <NNN> | I1 lesson <role> | I1 enforce | I1 dismiss <why> | I1 later
```
The reply is one line for all cards; `ok` alone accepts every card's `recommend`.

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [ ] K1: Read new evidence and keep one ledger entry per problem — `tools/kit-learn.mjs collect`: reads `events`, `runs`, `plans`, `grades`, `toil`, `lessonsIn` with `sentAt > cursor`; upserts `issues` by `signature` (`seenRuns`, `seenProjects`, `firstSeen`, `lastSeen`, `lastKitVersion`, `minutesLost` = parked plans' minutes from first fix round to park + skipped plans' waiting time when the skip reason names it + the run's `toil` minutes linked by the Planner); moves the cursor only after every write succeeded; `--dry-run` writes nothing — tools/kit-learn.mjs, tools/lib/kit-learn/**, tools/test/kit-learn.test.mjs, tools/fixtures/kit-learn/**
- [ ] K2: Know when a fixed problem came back — `issues.fixCommit` set by `apply` when the linked plan's merge commit is found on `origin/main` (the kit's merge convention: `Merge pull request #<n> from <owner>/<type>/<NNN>-<slug>`, commit subjects `feat(<NNN>):` or `…(plan <NNN>)` — match the merge commit first, `git log --first-parent origin/main --grep`); `collect` marks `regressed` per the Goals rule and `fixed` when the linked plan merged and no event with the signature came from a run containing the fix for 5 runs — tools/lib/kit-learn/**, tools/test/kit-learn.test.mjs
- [ ] K3: Rank and print — priority formula from the Goals; `--top <n>` (default 5); `toil` items with `couldBeScript: yes` seen in 2+ runs become `kind: toil` issues; `lessonsIn` grouped with `plan-name-similarity.mjs`'s `tokenize` + `scoreOverlap` (export both; threshold 0.6) into one `kind: lesson` issue with its project count — tools/lib/kit-learn/**, core/scripts/plan-name-similarity.mjs, tools/test/kit-learn.test.mjs
- [ ] K4: Write the `/kit-learn` command — kit-only `.claude/commands/kit-learn.md`: 1) `node tools/kit-learn.mjs collect`; 2) for each of the top items, read the kit code the evidence points at and write its card in the UI/UX shape (cause = `file:symbol`; "missed by" names the check, agent rule or test that should have caught it; options; one recommendation; the guard test); never more than 5 cards; 3) wait for one reply; 4) `node tools/kit-learn.mjs apply --reply "<reply>"`; 5) carry out each decision: `plan` → `/plan` with `Source: brain issue <id>` and the card as its problem statement; `amend <NNN>` → edit that open plan's sub-tasks and add `Source: brain issue <id>`; `lesson <role>` → `tools/kit-lessons.mjs add`; `enforce` → `/plan` for the check that makes the lesson unnecessary — .claude/commands/kit-learn.md
- [ ] K5: Record every decision so a rejected idea stays rejected — `apply` writes a `proposals` row per card (`issue, action, text, createdAt, decision, decidedAt, autonomyLevel: 0`); `dismiss` stores the reason; `later` keeps the issue `open` and lowers it below new items for 14 days; a card shown and not answered in 14 days is recorded `expired`; `collect` hides `dismissed` until `seenRuns` grew by 2 — tools/kit-learn.mjs, tools/lib/kit-learn/**, tools/test/kit-learn.test.mjs
- [ ] K6: Make every fix from a brain issue reproduce the problem in a test — `tools/kit-learn.mjs plan-check <plan>` (Goals rule); `core/.claude/commands/plan.md` Architect + PM review: when the repo has `tools/kit-learn.mjs` (the kit itself), run it on the draft and add an `open:` line on exit 1; `apply` refuses `planned` for a plan that fails it — tools/kit-learn.mjs, core/.claude/commands/plan.md, tools/test/kit-learn.test.mjs
- [ ] K7: Give the kit its own lessons per role — `core/docs/agent/kit-lessons/<role>.md` for the 030 roles (`readiness, builder, gate, check-plan, check-bugs, check-rules, security, verify, ui, planner`), each a two-line header, live lines `- K<n>: <lesson> — why: <reason> (issue <id>, since v<x.y.z>)`, a `## Retired` section; `tools/kit-lessons.mjs add | update | retire | check` as in Goals (code applies every change; a model only proposes the line); cap 2,000 characters of live lines per role — core/docs/agent/kit-lessons/**, tools/kit-lessons.mjs, tools/test/kit-lessons.test.mjs
- [ ] K8: Hand kit lessons to every role, before the project's — `orchestrate.js`: `kitLessons(role)` reads `docs/agent/kit-lessons/<role>.md` live lines through the same runner path 030 uses for project lessons, prepends them to `LESSONS`; the `/plan` review reads `planner.md` from both folders — core/.claude/workflows/orchestrate.js, core/.claude/commands/plan.md, tools/test/orchestrator.test.mjs
- [ ] K9: Watch whether each kit lesson works — `tools/kit-learn.mjs lessons`: exposures and recurrences per line from `runs`/`events` by kit version; prints `drift → enforce` (2+ recurrences after the line shipped) and `retire? enforced by <fixture>` (issue fixed with a fixture, and no recurrence in 10 exposures); lines whose `why` names auth, security, secrets or data loss are marked `safety` and never offered for retirement; drift and retire candidates become cards in the next `collect` — tools/kit-learn.mjs, tools/lib/kit-learn/**, tools/test/kit-learn.test.mjs
- [ ] K10: Keep the graders out of the learning loop's reach — `tools/lib/kit-learn/protected.mjs` lists paths a card's recommendation may only name as `human-only`: `tools/agent-eval.mjs`, `tools/lib/agent-eval/**`, `tools/test/**` assertions on existing behaviour, `core/scripts/lib/brain-doc.mjs` (signatures, minutes), `tools/lib/kit-learn/**` itself, `tools/leak-check.mjs`, `core/scripts/pre-commit-secret-scan.mjs`; `apply` marks such a proposal `protected: true` (plan 047 never automates it); test — tools/lib/kit-learn/**, tools/test/kit-learn.test.mjs
- [ ] K11: Show whether the kit gets better — `tools/kit-learn.mjs trend` (reuses `brain-query.mjs trend --by kitVersion`) adds: minutes lost to kit issues per run, parked per run, fix rounds per plan, decisions to grade per plan, `✗` per plan, Human round trips per run (when known), tokens per plan (when known); `/kit-learn` prints its last 3 kit versions as one line before the cards — tools/kit-learn.mjs, tools/brain-query.mjs, .claude/commands/kit-learn.md, tools/test/kit-learn.test.mjs
- [ ] K12: Calibrate a new project's triage from every project (P2) — `tools/kit-learn.mjs triage-prior` writes per decision kind the agreement over all `grades` rows (`kind, graded, agreement`) to `core/docs/agent/kit-lessons/triage-calibration.md`; plan 041's triage reads it when the project's own file has fewer than `minGraded` rows for a kind — tools/kit-learn.mjs, core/docs/agent/kit-lessons/triage-calibration.md, tools/test/kit-learn.test.mjs
- [ ] C1: Document the loop — `kit-brain.md` §Kit side (ledger, statuses, cards, reply grammar, kit lessons vs project lessons, protected paths, what is never automated); `decision-review.md` §0 table gains the kit rows; `workflow-map.md`; `.gitignore` `.kit-learn/`; the Atlas step the Human takes: custom role `brainKit` = `FIND` on all `kit_brain` collections + `INSERT`, `UPDATE` on `issues proposals autonomy cursor`, granted to `kit-brain-reader`; CHANGELOG — core/docs/agent/kit-brain.md, core/docs/agent/decision-review.md, core/docs/agent/workflow-map.md, .gitignore, CHANGELOG.md
- [ ] T1: Prove each behaviour with tests that fail on today's code — the Goals' test items; the fixture kit repo for K2 is built in a temp folder by the test (4 commits, one tagged fix) — tools/test/kit-learn.test.mjs, tools/test/kit-lessons.test.mjs, tools/test/orchestrator.test.mjs
- [ ] R1: Render the kit's own installed copies and check drift — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .` — scripts/, .claude/, docs/agent/, docs/brain/, .kit/install.json

## Technical Considerations
- Dependencies: plan 045 (`brain.mjs`, collections, `brain-query.mjs`), plan 030 (`LESSONS` assembly, role names),
  `plan-name-similarity.mjs` (similarity), `next-plan-number.mjs` (plan numbers for `plan` decisions), `/plan`.
- Model work: only K4's cards, in the Human's kit session (judgment tier = the session's model). Estimate: 20–40k
  tokens per card for reading code → 100–200k for 5 cards, once per `/kit-learn`; `collect`, `apply`, `lessons`,
  `trend`, `plan-check` are scripts.
- Why kit lessons are capped and edited by id (research, checked 2026-10-30): ACE (arXiv 2510.04618) keeps itemised
  lessons with ids and applies the model's proposed deltas in code; letting a model rewrite the whole context
  collapsed it from 18,282 to 122 tokens and dropped accuracy below no adaptation. Lessons with a recorded reason stop
  runaway growth (arXiv 2608.11095). A repeat of a covered error means the rule is not working → enforce it in code
  rather than add a second line (agentpatterns.ai governance loop). Retire only for a positive reason (enforced, or
  the situation no longer arises); never auto-retire safety lines.
- Why the graders are protected (K10): the Darwin Gödel Machine faked test logs and removed its own hallucination
  markers when they were in reach (arXiv 2505.22954).
- Why every fix plan carries a reproducing test (K6): SapFix and Getafix keep a fix only after the failure is
  reproduced and shown gone; bad fixes are 66–80% of reopened bugs in three Apache projects (ICSE 2010).
- Data / migration: none in projects; Atlas role change in C1 (Human).

## Out of Scope
- Running `/kit-learn` on a schedule, autonomy levels, auto-drafting or auto-merging — plan 047.
- Improving agent prompts by measured evals — plan 048.
- Sending kit lessons into a project's own `docs/brain/` — kit lessons stay in the kit-managed folder.
- A web page or dashboard for the ledger (the CLI table is the interface; an Artifact page can come later).

## Critical Questions
- Q: One command, no explaining by text? A: yes, `/kit-learn` (Human, 2026-10-30).
- Cards per session: at most 5 — or all above a priority threshold? A: at most 5; the rest are in the table (Human,
  2026-10-30).
- Kit lesson cap per role: 2,000 characters (default, about 15 lines) — 030's project cap is 3,000; together ~1.2k
  tokens per launch. Default stands unless the trend shows prompts growing too slow to help.
- A card the Human does not answer: expire after 14 days — or never? A: expire after 14 days, shown again only with
  new evidence (Human, 2026-10-30).
- `ok` alone accepts every card's recommendation — or must each card be named? A: `ok` accepts all; single cards can
  still be overridden in the same line (`ok · I3 dismiss …`) (Human, 2026-10-30).

## Execution Notes
- Source: the run-499-502 hand-off (its whole structure is what K4 automates) and the Human's 2026-10-30 asks: one
  command, learnings kept in the kit forever, project learnings in the project, semi-automatic first.
- The hand-off's 13 problems are the first test of `/kit-learn`: after 045's backfill, `collect` should list P1, P2,
  P3, P8 and P11's leftovers among its issues by signature (the rest are decision-shaped, from `grades`).

## Finish — review hand-off (replaces /ship)

Build order: wave 4 — after 045.

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
