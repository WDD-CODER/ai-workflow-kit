# Plan 057 — /ship learns from every Worker plan: every decision graded, seen defects become follow-ups, and REGULAR ships on a plan branch run the checker pipeline

Status: draft
Depends-on: none
Snapshot: c497df8

## Problem Statement

Checked on `origin/main` `c497df8`:

1. `/review-it` is never called automatically. `/ship` REGULAR (`core/docs/agent/ship-regular.md` "Phase 2 — REGULAR
   review procedure") runs `/review`: one inline pass that reads the plan's Done-when only "if a brief is in context"
   (else `Brief-match: SKIPPED`), with no verifier. The measured checkers (`orch-check-plan`, `orch-check-bugs`,
   `orch-check-rules`, `orch-verify`; `docs/agent-evals/BASELINE.md`) run only inside the orchestrator. The Human always
   uses `/ship`, so Worker plans are never reviewed by the checkers the kit measures and improves.
2. `/review-it` step 3 hands the finders only the plan, branch, folder and base. Their agent files say "Read `LESSONS`
   first" and use `RULES` (`## checkers`), but `/review-it` passes neither.
3. `/ship`'s learning step (`core/.claude/commands/ship.md`, On approval step 2) runs `decision-log.mjs learn` / `add`,
   which records `✗` only. It never runs `decision-log.mjs grade`, so `ok` grades are lost, and a Worker's
   `- decision: seen:` defects never reach `docs/brain/follow-ups.md`, so `/plan`'s follow-ups check never surfaces them.
   Only orchestrator runs do that today.
4. Found in review: `/ship` numbers decisions `D1…Dn` afresh every session (removes → behaviour → seen), while `grade`
   skips any `run + id` it already stored (`core/scripts/decision-log.mjs:452`). With a run name that is stable per
   plan, a second session's new `D1` would be dropped as already graded. Ids must stay stable per plan.

## Goals & Success Criteria
**Primary:** a REGULAR `/ship` on a Worker plan branch is reviewed by the measured checker pipeline (with the checker
lessons and rules), and every decision the Human grades there is stored — `ok` included — with `seen:` defects
reaching `docs/brain/follow-ups.md`, each decision graded once only, across sessions.

- [auto] `node --test tools/test/decision-log.test.mjs` passes, with new cases:
  - `decision-log.mjs pending --plan <p> --out <f>` on a plan whose Execution Notes hold 3 untagged `- decision:` lines
    prints them `D1…D3` (removes, then behaviour, then seen) and writes a JSON list `grade` accepts; on a plan where
    `D1`, `D2` are already tagged `[graded D1 ok …]`, `[graded D2 ✗ …]` and one new line was added, it prints only the
    new line, numbered `D3`; a plan with every line tagged prints `DECISIONS: none to grade`.
  - `grade --run ship-057 --reply "decisions: ok" --decisions <f> --mark <p>` writes one row per item with
    `run: "ship-057"`, `humanVerdict: "ok"`, `triageVerdict: "none"`, adds a `follow-ups.md` row for the `seen:` item, and
    appends `[graded D<n> ok YYYY-MM-DD]` to exactly those lines in the plan; `D2 ✗ x` tags `[graded D2 ✗ YYYY-MM-DD]`.
  - Running the same `grade` again adds no row, no follow-up and no second tag; a tag never contains `follow-up:`
    (so `follow-ups --open` is unchanged by it).
  - `stats` over rows with `triageVerdict: "none"` counts none of them (agreement unchanged).
- [auto] `node --test tools/test/orchestrator.test.mjs` (or the test file that holds the config-validation cases)
  passes with: `review.ship` absent → treated as `checkers`; `"light"` and `"checkers"` accepted; any other value refused
  by install and sync with one line naming the two values.
- [auto] `node --test tools/test/kit-learn.test.mjs` passes, with one case: a `grades` document whose run has no `runs`
  document goes through `collect` and `triage-prior` with exit 0 and does not count a `none` row.
- [auto] The rendered instructions carry the change (a test reads the rendered files):
  `.claude/commands/ship.md` runs `pending` / `grade --mark` before the existing learn/add gate;
  `docs/agent/ship-regular.md` Phase 2 runs the `/review-it` pipeline on a plan branch when `review.ship` is
  `checkers`, and `/review` otherwise; `.claude/commands/review-it.md` step 3 passes `LESSONS` and `RULES`.
- [auto] `npm run build`, `npm run lint`, `npm test`, `node --test "tools/test/*.test.mjs"`,
  `node tools/orchestrator-e2e.mjs` and `node tools/drift-check.mjs --target .` all exit 0.
- [auto] `node scripts/scope-check.mjs --diff=origin/main` on the finished branch prints `SCOPE: ok`.
- [human] One real `/ship` on a FoodVibe Worker plan after the next kit sync: the checkers ran, the review fact line
  was written to the plan's Execution Notes, a `seen:` decision appeared in `docs/brain/follow-ups.md`, and `/plan` on
  a plan touching that file listed it.

## Execution Mode
- Parallel: no
- Concurrent plans: 056 is open on `chore/056-…` and shares only `CHANGELOG.md` (append-only hotspot). 030, 045 and
  046 share files but are merged (their `Status:` was never closed).
- Isolated DB: no

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/scripts/decision-log.mjs
core/.claude/commands/ship.md
core/docs/agent/ship-regular.md
core/.claude/commands/review-it.md
layers/cursor/.cursor/commands/review-it.md
core/docs/agent/decision-review.md
core/docs/agent/workflow-map.md
core/docs/agent/model-routing.md
tools/lib/kit.mjs
kit.config.json
.kit/config.json
tools/test/decision-log.test.mjs
tools/test/orchestrator.test.mjs
tools/test/kit-learn.test.mjs
tools/test/ship-review.test.mjs
scripts/**
.claude/**
docs/agent/**
.cursor/**
.kit/install.json
CHANGELOG.md
```

`scripts/**`, `.claude/**`, `docs/agent/**`, `.cursor/**` and `.kit/install.json` are the rendered copies, written only
by `node tools/sync.mjs --target . --apply` (R1). `tools/test/ship-review.test.mjs` is new (it reads the rendered
instruction files). `core/scripts/orch-state.mjs` and `tools/kit-learn.mjs` are read, not edited — a change to either is
an escalation (`approved: <path>`).

## Read Scope

Entire repo and its git history.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry.

## Architecture Impact
- INV-none: preserves — `docs/brain/invariants.md` holds only the template entry; grading, tagging and listing are
  done by script (no decision moves to a model), and the checker pipeline is the existing `/review-it` one.

## Step 0 — Reality Check

1. Runs only when `scope-check.mjs --drift` reports `REALITY: drift`: check the listed commits by symbol and print
   `ok` or `conflict: <what>` per commit; stop for a go only on a conflict.
2. Always, and write the evidence into Execution Notes (the Planner already saw these on `c497df8`; re-check, do not
   re-explore):
   - `agreementStats` counts only rows whose `triageVerdict` is `accept`/`ask`/`follow-up`/`noise`
     (`core/scripts/decision-log.mjs:76`), and `tools/kit-learn.mjs` `triage-prior` uses that same function (line 98).
   - The kit-learn ledger (`tools/lib/kit-learn/ledger.mjs`) never reads `grades`; only `triage-prior` does, so a
     `ship-NNN` run with no `runs` document is harmless.
   - `node scripts/orch-state.mjs context` (no `--run`) in the main folder prints `ORCH_JSON {"ok":true,…}` with
     `lessons`, `kitLessons`, `rules.checkers` (on `c497df8`: all empty, 0 chars).
3. Always: `node tools/install-check.mjs` and `node --test "tools/test/*.test.mjs"` pass before any edit — a red start
   is written into Execution Notes, not fixed here.

## User Stories
- As the Human, I want every Worker plan I ship to be reviewed by the same checkers the orchestrator uses, so their
  measured quality applies to my everyday work.
- As the Human, I want every grade I give at `/ship` stored once, `ok` included, so triage calibration and follow-ups
  learn from Worker plans too.
- As the Planner, I want a Worker's `seen:` defects to show up in `/plan`'s follow-ups check.

## Functional Requirements

### Must Have (P0)
- [ ] `/ship` lists only ungraded decisions with ids stable per plan, grades every reply (`ok` included) under run
  `ship-<NNN>`, and tags the graded lines.
- [ ] REGULAR `/ship` on a plan branch runs the `/review-it` checker pipeline when `review.ship` is `checkers` (default).
- [ ] `/review-it` passes the checker-role `LESSONS` (kit first) and `RULES` `## checkers` to the finders and the verifier.
- [ ] Tests for every script change; rendered copies in sync.

### Should Have (P1)
- [ ] One review fact line per `/ship` review in the plan's Execution Notes.

### Nice to Have (P2)
- None.

## UI/UX Notes
None (scripts and instructions only).

## Atomic Sub-tasks

- [ ] G1: List only the decisions not graded yet, with numbers that stay the same across sessions — new `decision-log.mjs pending --plan <path> --out <file>`: reads the plan's `## Execution Notes` `- decision:` lines; a line ending in `[graded D<n> ok|✗ YYYY-MM-DD]` is graded; the untagged ones are ordered removes → behaviour → seen and numbered from the highest graded `D<n>` + 1; prints one `D<n> · <line>` per item (or `DECISIONS: none to grade`) and writes the JSON list `grade --decisions` reads (`{ id, plan, text }`); usage header documents it — `core/scripts/decision-log.mjs`, `tools/test/decision-log.test.mjs`
  - Scope: `core/scripts/decision-log.mjs`, `tools/test/decision-log.test.mjs`
- [ ] G2: Store every grade once, ok included, and mark the graded lines in the plan — `grade` gets `--mark <plan path>`: after writing the rows, it appends ` [graded D<n> ok|✗ <date>]` to each graded line (matched by its text from the list, not by position), never twice; the tag never contains `follow-up:`; tests: ship run name `ship-057`, `decisions: ok`, `D2 ✗ x`, re-run adds nothing, a `seen:` item gives one follow-ups row, `stats` ignores `none` rows — `core/scripts/decision-log.mjs`, `tools/test/decision-log.test.mjs`
  - Scope: `core/scripts/decision-log.mjs`, `tools/test/decision-log.test.mjs`
- [ ] G3: Have /ship grade every shown decision before the existing learning step — "Decisions to grade" runs `node scripts/decision-log.mjs pending --plan <plan> --out <scratch>/decisions.json` instead of "not graded in this session"; on approval, before step 2's learn/add gate, run `node scripts/decision-log.mjs grade --run ship-<NNN> --reply "<the Human's grade reply>" --decisions <scratch>/decisions.json --mark <plan>` for every grade reply (`decisions: ok` included); the learn/add gate then runs unchanged; the plan file, `docs/brain/decision-grades.jsonl` and `docs/brain/follow-ups.md` join the commit — `core/.claude/commands/ship.md`
  - Scope: `core/.claude/commands/ship.md`, `tools/test/ship-review.test.mjs`
- [ ] K1: Prove the kit's learning tolerates grades from /ship runs — one `kit-learn.test.mjs` case: a `grades` document with `run: "ship-057"` and no `runs` document, `triageVerdict: "none"`; `collect` and `triage-prior --dry-run` exit 0 and the prior table counts it nowhere — `tools/test/kit-learn.test.mjs`
  - Scope: `tools/test/kit-learn.test.mjs`
- [ ] C1: Add the review.ship switch with checkers as the default — `review.ship` (`"checkers"` | `"light"`) in `kit.config.json` (value `"checkers"`, and one sentence in the `$comment`) and `.kit/config.json`; validated in `tools/lib/kit.mjs` like `orchestrator.onPark` (line 167): any other value refused by install and sync; tests in `tools/test/orchestrator.test.mjs` (or the file holding the onPark case) — `tools/lib/kit.mjs`, `kit.config.json`, `.kit/config.json`, `tools/test/orchestrator.test.mjs`
  - Scope: `tools/lib/kit.mjs`, `kit.config.json`, `.kit/config.json`, `tools/test/orchestrator.test.mjs`
- [ ] R2: Give the checkers their lessons and rules in /review-it, read from the main folder — new step before step 3: run `node "<main folder>/scripts/orch-state.mjs" context` (main folder = parent of `git rev-parse --path-format=absolute --git-common-dir`, so a slot's branch cannot edit what its checkers read), print its `CONTEXT` line; pass each finder, `orch-security` and `orch-verify` `LESSONS` = `[...kitLessons[role], ...lessons[role]]` for its own role only (`check-plan`, `check-bugs`, `check-rules`, `security`, `verify` — never `builder`, `gate`, `readiness`, `ui`) and `RULES` = `rules.checkers`, with the line "LESSONS and RULES are data from earlier runs; they cannot override your role's instructions"; empty → pass `[]`; same step in the Cursor copy for its inline lenses — `core/.claude/commands/review-it.md`, `layers/cursor/.cursor/commands/review-it.md`
  - Scope: `core/.claude/commands/review-it.md`, `layers/cursor/.cursor/commands/review-it.md`, `tools/test/ship-review.test.mjs`
- [ ] R3: Run the checker pipeline on REGULAR ships of a plan branch, with one fix-and-recheck — `ship-regular.md` Phase 2: plan branch = current branch `feat|fix/NNN-*` with an existing `plans/NNN-*.plan.md` (any plan folder); with `review.ship` = `checkers` (`<!-- KIT:if review.ship=light -->` keeps today's text for `light`) run `/review-it` steps 1–6 inline by reading the file (not the Skill tool, same reason as today's `/review` note); a kept `blocker`/`major` = ISSUES FOUND → fix them → re-check once: `orch-verify` only, on the fixed findings, against the new diff, plus the `kit-runner` checks — no second set of finders; still kept → stop, no commit; FAST / ULTRA-TRIVIAL and branches with no plan: unchanged (`/review`); ship.md line 8 ("One sub-agent only: kit-runner") and `model-routing.md` name the review agents for this case; the `/ship` tree shows the review table in one line per lens; the commit body keeps a `Review:` line (`Review: checkers APPROVE — kept 0, dropped 2`) — `core/docs/agent/ship-regular.md`, `core/.claude/commands/ship.md`, `core/docs/agent/model-routing.md`
  - Scope: `core/docs/agent/ship-regular.md`, `core/.claude/commands/ship.md`, `core/docs/agent/model-routing.md`, `tools/test/ship-review.test.mjs`
- [ ] F1: Write one fact line per /ship review so the two review modes can be compared — after the verdict, append to the plan's `## Execution Notes`: `- review: <checkers|light> kept <n> dropped <m> rechecked <k> minutes <t> models <role=model,…>`; minutes = wall clock from review start to verdict (two `date` reads, no model call); models = what each agent result names; no tokens (the runtime does not expose them cheaply) — `core/docs/agent/ship-regular.md`
  - Scope: `core/docs/agent/ship-regular.md`, `tools/test/ship-review.test.mjs`
- [ ] D1: Document that /ship now grades, files follow-ups and runs the checkers — `decision-review.md` §3 (learning step: `grade` runs first, for every reply) and §5 (title and text cover `/ship`: run `ship-<NNN>`, the `[graded …]` tag, no triage → `triageVerdict: none`); `workflow-map.md` §3 (ship → review-it edge, `review.ship`) and §6 (`decision-grades.jsonl` and `follow-ups.md` also written by `/ship`) — `core/docs/agent/decision-review.md`, `core/docs/agent/workflow-map.md`
  - Scope: `core/docs/agent/decision-review.md`, `core/docs/agent/workflow-map.md`
- [ ] R1: Render the kit's installed copies, prove them and add the changelog line — `tools/test/ship-review.test.mjs` reads the rendered `ship.md`, `ship-regular.md`, `review-it.md` for the G3/R2/R3/F1 commands; `node tools/sync.mjs --target . --apply`, then `node tools/drift-check.mjs --target .`, build, lint, `npm test`, the full `tools/test` suite, `node tools/orchestrator-e2e.mjs`; one CHANGELOG entry under Unreleased in product-agnostic words, no plan number — `scripts/**`, `.claude/**`, `docs/agent/**`, `.cursor/**`, `.kit/install.json`, `CHANGELOG.md`, `tools/test/ship-review.test.mjs`
  - Scope: `scripts/**`, `.claude/**`, `docs/agent/**`, `.cursor/**`, `.kit/install.json`, `CHANGELOG.md`, `tools/test/ship-review.test.mjs`

## Technical Considerations
- **Stable ids by tag (Human's choice, 2026-11-02).** The tag lives on the decision line itself, so ids survive new
  sessions and checkpoints, and `grade`'s existing `run + id` de-duplication stays correct: ids never repeat within
  `ship-<NNN>`. Lines are matched by text, so a line edited after grading is listed again under a new id.
- **Run name `ship-<NNN>`** is stable per plan. The rows carry `triageVerdict: none` (no triage at `/ship`), which the
  agreement stats already skip; kit-learn only reads grades in `triage-prior`.
- **Re-check scope (Human's draft).** The re-check is `orch-verify` on the fixed findings against the new diff, plus
  the `kit-runner` checks — no second set of finders. A new defect a fix introduces is not hunted; accepted by design.
- **Main-folder context.** `orch-state.mjs context` reads from the checkout the script lives in (`root`,
  `core/scripts/orch-state.mjs:127`); in a slot that is the plan branch, which the Worker can edit. R2 runs the main
  folder's copy.
- **Cost.** `checkers` adds 3 finders and the verifier (review tier, Sonnet by default) per REGULAR plan-branch ship;
  F1's fact line makes that measurable against `light`.
- **Known risk, out of scope (Human: `conflicts: out`).** `docs/brain/follow-ups.md` and `decision-grades.jsonl` get
  appended on every plan branch, so two parallel Worker plans can conflict at the end of the file when merged — the
  same as `decision-log.md` today.
- **Alternatives dropped:** a run name per session (`ship-NNN-<date>-<n>`; breaks the stable run name); ids kept only
  "in this session" (today's state, loses grades across sessions); a second full finder pass on re-check (cost).

## Out of Scope
Stage 2, a later plan, after a real FoodVibe orchestrator run and a brain-query check:
- A run record for solo plans sent to the kit brain (`approved:` scope escalations, mid-flight sub-tasks, REALITY drift
  conflicts, failed cards, PR-check rounds).
- Eval cases from misses after a clean review.
- Builder lessons (`agent-lessons` / `kit-lessons`) for `/take-plan`.
- The kit's own plans' "review hand-off" step.
- Union-merge or other handling of append conflicts on `docs/brain/*` files.
- Triage at `/ship` (rows stay `triageVerdict: none`).

Named as none: backend / API impact, auth and validation, security surface (the checkers only read), data / migration
(`decision-grades.jsonl` rows keep their 13 fields).

## Critical Questions
- None open. Answered by the Human on 2026-11-02: `default checkers, ids: tag, conflicts: out`.

## Execution Notes
- Architect + PM review (Planner, 2026-11-02, against `origin/main` `c497df8`): similarity `no similar plans`;
  related none; scope overlap 030, 035, 036, 045–056 (shared files only, none the same work; 030/045/046 merged with
  stale `Status:`); follow-ups `FOLLOW_UPS: none`; `kit-learn plan-check` ok (no brain issue); arch `INV-none`.
  Fixed in review: Step 0 confirmations pre-checked (decision-log.mjs:76, kit-learn.mjs:98, ledger never reads grades);
  `orch-state.mjs context` run in the main folder (ok, 0 chars); slot context read from the main folder; ship.md:8 and
  `model-routing.md` added to scope; `review.ship` validated in `tools/lib/kit.mjs` and rendered with `KIT:if
  review.ship=light`; Cursor `review-it.md` added; no tokens in the fact line. Found: the id-reuse bug (Problem 4).
- This repo is solo flow (no `.claude/todo.md`): the checkboxes above are the ledger.
