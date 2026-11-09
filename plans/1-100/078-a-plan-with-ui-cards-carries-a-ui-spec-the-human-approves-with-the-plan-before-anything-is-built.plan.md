# Plan 078 — A plan with UI cards carries a UI Spec the Human approves with the plan, before anything is built

Status: abandoned — parked under the freeze: new work with no failure shown today; re-plan after the freeze if still wanted; closed 2026-11-09
Parked: 2026-11-05 — reliability freeze, revisit 2026-11-15
Depends-on: 075
Snapshot: b075db1e9c4876d4f210c95612df2e2a406a160a

## Problem Statement

UI work in the kit is decided after it is built. A plan describes a screen in free prose under `## UI/UX Notes`
(`core/.claude/references/prd-template.md:80-82`), the builder fills every gap itself, and the Human first sees the
result in the validation cards. In run test-514-515 that cost four rounds of notes: a search field built as a box
inside the client box instead of turning the client box into the search field, a native `details` element, wording,
field order (hand-off of 2026-11-03, rules R1-R8). Plan 072 makes written design rules enforced after the fact; nothing
asks for the screen to be described before the build.

The design-workflow research of 2026-10-28 ("תכנון ווקפלו לעיצוב UI/UX") found one pattern behind fewer redesign rounds
in every framework it looked at (BMAD, Spec-Kit, Kiro, shinpr): a short screen spec before code and one human approval
of it, because a spec is cheap to fix in text and a built screen is not. The kit's own gap table there said:
"spec before code — missing; add a `## UI Spec` section to UI plans". It was never planned.

This plan adds the section and a save-time check. Making readiness ask for a missing spec and making the builder log
every visual choice the spec leaves open is plan 079.

## Goals & Success Criteria

**Primary:** the plan template has a `## UI Spec` section with five labelled lines, `/plan`'s review and `save-plan`
check it for every plan that has a `[ui]` item or a design track, and the Human approves it together with the plan.

- [auto] `node --test tools/test/ui-spec.test.mjs` passes, with tests that fail on today's code:
  (a) `node scripts/scope-check.mjs --ui-spec --plan=<p>` prints `UI_SPEC: ok` for a plan whose `## UI Spec` has the
  lines `Page:`, `Placement:`, `Elements:`, `States:` and `Texts:`, each with text after the colon;
  (b) it prints `UI_SPEC: warn` and one line naming the missing labels for a plan with a `[ui]` Done-when item, or with
  `Track: design` or `Track: split`, whose section is missing or incomplete;
  (c) it prints `UI_SPEC: skipped (no UI)` for a plan with neither, and exits 0 in every case (it never blocks a save);
  (d) a `States:` line must name `loading`, `empty` and `error` (each with what shows, or `n/a`), otherwise it is
  incomplete.
- [auto] The rendered `prd-template.md` has the `## UI Spec` section after `## UI/UX Notes`, with the five labels and
  one line each on what goes there (`Elements:` names, per element, the existing component it reuses or `new: <why>`);
  the rendered `save-plan` checklist has the `--ui-spec` line next to `--tests`; the rendered `plan.md` Product Manager
  list says a UI plan's spec is complete or an `open:` line asks for it (a test reads the three files).
- [auto] `npm run build`, `npm run lint` and `node --test "tools/test/*.test.mjs"` pass.
- [auto] `node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .` reports no drift.
- [human] The next UI plan the Planner writes for FoodVibe shows a `## UI Spec` the Human can approve in under a minute,
  and it would have caught the box-in-a-box choice of plan 515 before the build.

## Execution Mode
- Parallel: no.
- Concurrent plans: plans 072 and 074 also change `core/scripts/scope-check.mjs` (new `--ui-elements`, flag-value
  checks), and plan 060 also edits `prd-template.md` and `plan.md`; each adds its own part, so the merge is additive.
  Merge `origin/main` before the PR.
- Isolated DB: no.

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/scripts/scope-check.mjs
scripts/scope-check.mjs
core/scripts/lib/ui-spec.mjs
scripts/lib/ui-spec.mjs
core/.claude/references/prd-template.md
.claude/references/prd-template.md
core/.claude/skills/save-plan/SKILL.md
.claude/skills/save-plan/SKILL.md
core/.claude/commands/plan.md
.claude/commands/plan.md
.kit/install.json
tools/test/ui-spec.test.mjs
tools/test/fixtures/ui-spec/**
CHANGELOG.md
```

`scripts/**`, `.claude/**` and `.kit/install.json` are the rendered copies, written only by
`node tools/sync.mjs --target . --apply` (R1).

## Read Scope

Entire repo and its git history.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry.

## Architecture Impact
- INV-none: preserves — a template section, a warn-only lint and two instruction lines; no invariant's `Touches` glob
  is in scope.

## Step 0 — Reality Check

1. Runs only when `scope-check.mjs --drift` reports `REALITY: drift`: check the listed commits by symbol and print `ok`
   or `conflict: <what>` per commit; stop for a go only on a conflict.
2. Always: `grep -n "Done-when\|doneWhen" core/scripts/lib/done-when.mjs | head` — reuse its parser to find `[ui]`
  items; never a second regex for tags.

## User Stories
- As the Human, I want to approve what a screen will look like, in five lines, before a builder builds it, so that I fix
  a wrong idea in text and not in four rounds of notes.

## Functional Requirements

### Must Have (P0)
- [ ] The template section with five labels.
- [ ] `scope-check --ui-spec`, warn-only, using the existing Done-when parser.
- [ ] The save-plan checklist line and the Product Manager review line.

### Should Have (P1)
- [ ] One fixture plan with a complete spec, used by the test and as an example in the template.

### Nice to Have (P2)
- none

## UI/UX Notes
- Terminal text only: `UI_SPEC: ok | warn | skipped (no UI)`.

## UI Spec
- Page: none (no app screen; terminal output only).
- Placement: n/a.
- Elements: n/a.
- States: loading n/a, empty n/a, error n/a.
- Texts: `UI_SPEC: ok`, `UI_SPEC: warn`, `UI_SPEC: skipped (no UI)`.

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [ ] S1: Add a five-line UI Spec section to the plan template so every UI plan says what the screen will be — Page, Placement, Elements (existing component reused or new with a reason), States (loading, empty, error), Texts (exact strings in the app's language) — core/.claude/references/prd-template.md
- [ ] S2: Warn at save time when a UI plan has no complete UI Spec — `ui-spec.mjs` (section and label parser, reuses the Done-when parser for `[ui]` items and reads `Track:`), `scope-check --ui-spec`, added to the dispatch and to the usage string (`scope-check.mjs:368-378`) — core/scripts/lib/ui-spec.mjs, core/scripts/scope-check.mjs, tools/test/ui-spec.test.mjs, tools/test/fixtures/ui-spec/**
- [ ] S3: Make the save checklist and the Planner's review ask for the spec — one checklist line in save-plan, one Product Manager bullet in plan — core/.claude/skills/save-plan/SKILL.md, core/.claude/commands/plan.md
- [ ] R1: Render the kit's own installed copies, check drift and add a changelog line — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .` — scripts/**, .claude/**, .kit/install.json, CHANGELOG.md

## Technical Considerations
- Dependencies: `core/scripts/lib/done-when.mjs` (tag parser), `scope-check.mjs` command dispatch (`scope-check.mjs:368-378`).
- New files: `core/scripts/lib/ui-spec.mjs`, `tools/test/ui-spec.test.mjs`, `tools/test/fixtures/ui-spec/**`.
- Model changes: none. Backend / API: none. Auth and validation: none. Security surface: none.
- Data / migration: none. Existing plans are not rewritten; the lint only warns.
- Stack-neutral: the labels name no framework; "existing component" means whatever the project's families file
  (plan 072) or code already has.

## Out of Scope
- Readiness asking for a missing spec, and the builder logging visual choices the spec leaves open (plan 079).
- A separate design reviewer agent (decided by plan 072's measurement).
- Stylelint or token files for a project (project work, not kit work).

## Critical Questions
- Q: Block the save when the spec is missing? A: no; warn like `--tests`, and plan 079 makes readiness ask before the
  build (recommended: a warning never blocks a quick plan).
- Q: Which plans need a spec? A: a plan with any `[ui]` Done-when item, or `Track: design` / `Track: split`.

## Execution Notes
- Source: chat "תכנון ווקפלו לעיצוב UI/UX" (2026-10-28/29): spec before code with one human checkpoint; the kit gap
  "`orch-readiness` skips plans that change only styling; look and feel stays `[human]`".
- Review (Architect + PM, a separate agent against b075db1, 2026-11-03): mechanical gaps fixed in the draft (line references, scope and Depends-on, test names); open points answered with the recommended default in Critical Questions. The Planner's own review is still to run.
