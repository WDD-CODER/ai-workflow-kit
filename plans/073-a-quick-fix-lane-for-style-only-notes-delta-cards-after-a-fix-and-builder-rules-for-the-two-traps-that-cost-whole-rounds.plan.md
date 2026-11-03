# Plan 073 — A quick-fix lane for style-only notes, delta cards after a fix, and builder rules for the two traps that cost whole rounds

Status: draft
Depends-on: 069, 070, 071, 072
Snapshot: 5784d6d3de92d41b9b08de0161cf3c31a430a8b2
Source: FoodVibe run test-514-515 (PR #499) hand-off section 8, options a, c and d (Human, 2026-11-03); part 4 of 4 (070 records, 071 sorter, 072 design rules)

## Problem Statement
The last request of the run was one CSS rule. It went through the full gate (build 52 s, lint 26 s, test:ci 94 s, plus six fast checks), a commit, a push and a server check; the full gate ran five times across the notes rounds, about 14-15 minutes of machine time that found nothing. After each fix every card was printed again, even unchanged ones. Two avoidable failures each cost a whole round: a layered component rule loses to an unlayered global reset (`src/styles.scss:413-422` beat a rule inside `@layer components.*`), and writing source through a shell heredoc or `node -e` dropped the backslashes of a regex (`/^[0-9+\-\s()]+$/` became `/^[0-9+-s()]+$/`, which sent Latin letters to the phone field).

## Goals & Success Criteria
**Primary:** a style-only note is fixed and pushed after a short check, the full gate runs once at "done" or before the pull request, only the cards a fix touched are shown again, and the two traps are rules the agents read.

- [auto] `node --test tools/test/quick-fix.test.mjs` passes, with tests that fail on today's code: `scripts/quick-fix-check.mjs --diff <ref>` prints `QUICK_FIX: ok` for a change of at most 30 lines (configurable, `quickFix.maxLines`) in `.scss` and `.html` files of one component folder; `QUICK_FIX: no` with the reason for a change that touches a `.ts` file, a second component folder, a file outside the component folder, or a file matching `**/styles.*`, `**/*.config.*`, `**/shared/**` (also configurable, `quickFix.neverPaths`), however small.
- [auto] `node --test tools/test/quick-fix.test.mjs` passes with a test that the lane's command list is: lint of the changed files, the component's own spec, `scope-check --diff`, and the project's `build` command when `quickFix.keepBuild` is true (the default, because the hard rule says the build passes before any commit); the full gate is not in the lane, and a test shows the procedure runs the full gate once at "done".
- [auto] `node --test tools/test/ui-tier.test.mjs` passes with tests that fail on today's code: after a fix, the card list shows only the cards whose page maps to a changed file plus one line `Unchanged, not shown: <n> — <numbers>`; a reply `show all` brings the rest back; when the mapping is unknown the card is kept.
- [auto] The rendered instructions carry the change (a test reads them): `## builder` rules say "write source with Edit or Write, never a shell heredoc or `node -e`, and read any regex back"; the standards `orch-check-rules` reads state that a rule inside a CSS layer loses to an unlayered global rule and say where the project's reset lives; `notes-review.md` describes the lane and its exclusions.
- [auto] `npm run build`, `node --test "tools/test/*.test.mjs"` pass.
- [auto] `node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .` reports no drift.
- [human] On the next notes round with a style-only note, the fix is on the branch after the short check, the cards that come back are only the changed ones, and the full gate ran once at "done".

## Execution Mode
- Parallel: no.
- Concurrent plans: none; plans 069, 070, 071 and 072 first (shared files: `job-validation.md`, `notes-review.md`, `done-when.mjs`, `orch-check-rules.md`, `agent-rules.md`).
- Isolated DB: no.
- Kit edits: one kit branch and one kit PR; commit per group.

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`, plus the append-only hotspot `CHANGELOG.md` (add an entry, never rewrite one).

```scope
core/scripts/quick-fix-check.mjs
scripts/quick-fix-check.mjs
core/scripts/lib/done-when.mjs
scripts/lib/done-when.mjs
core/docs/agent/notes-review.md
docs/agent/notes-review.md
core/docs/agent/job-validation.md
docs/agent/job-validation.md
core/docs/agent/orchestrator.md
docs/agent/orchestrator.md
core/docs/brain/agent-rules.md
docs/brain/agent-rules.md
core/docs/agent/standards-styles.md
docs/agent/standards-styles.md
core/.claude/agents/orch-check-rules.md
.claude/agents/orch-check-rules.md
kit.config.json
.kit/config.json
tools/lib/kit.mjs
tools/test/quick-fix.test.mjs
tools/test/ui-tier.test.mjs
CHANGELOG.md
```

## Read Scope

Entire repo, including `docs/agent-evals/`.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry. Tags and releases: wait for the Human's go.

## Architecture Impact
- INV-none: preserves — a new check script, a card-list rule and rule text; no invariant in `docs/brain/invariants.md` is touched. The lane keeps `build` before every commit where the project's hard rule requires it.

## Step 0 — Reality Check
Plan 069 is merged (its changed-page helper in `done-when.mjs` maps a card's page to the changed files) and plans 070-072 are merged. Confirm the helper's name and what it does when the mapping is unknown (069 keeps the card). Decide whether `core/docs/agent/standards-styles.md` is a new stack-neutral standards file or an entry in an existing pack's CSS standards (`packs/`); write the choice in Execution Notes before changing the scope.

## Atomic Sub-tasks

- [ ] Q1: Decide in code which notes are quick fixes and which are not — style files of one component, a line limit, never a global stylesheet, a config file or a shared file, however small — core/scripts/quick-fix-check.mjs, kit.config.json, tools/lib/kit.mjs
- [ ] Q2: Describe the lane in the notes procedure and run the full gate once at done — the short command list, the exclusions, the full gate before the pull request — core/docs/agent/notes-review.md, core/docs/agent/orchestrator.md
- [ ] Q3: Show only the cards a fix touched after a fix and keep a way to see the rest — reuse the changed-page helper, one line for the unchanged cards, a reply that brings them back — core/scripts/lib/done-when.mjs, core/docs/agent/job-validation.md
- [ ] Q4: Give the builder and the rules checker the two trap rules so each saves a whole round — no shell heredoc or inline script for source, read any regex back; a layered rule loses to an unlayered reset — core/docs/brain/agent-rules.md, core/docs/agent/standards-styles.md, core/.claude/agents/orch-check-rules.md
- [ ] T1: Add tests that fail on today's code for each group, resync installed copies and add a changelog entry — tools/test/quick-fix.test.mjs, tools/test/ui-tier.test.mjs, CHANGELOG.md

## Technical Considerations
- "Shared" means: outside the one component folder, or matching `**/styles.*`, `**/*.config.*`, `**/shared/**` (Human, 2026-11-03). Defaults: 30 changed lines, no `.ts` change; both configurable.
- The lane runs after an approved notes table (071); it does not replace the full gate, it defers it to "done" or the pull request.
- Option b (batch window), e (computed-style test helper), f (eval file once per session) and g (skip checks that cannot change) are not in this plan.
- Backend / API: none. Auth and validation: none. Security surface: none. Data / migration: none. Model changes: none. Project checks: none.

## Out of Scope
- Changing the card layout, the gate itself or which checks the full gate runs.
- Options b, e, f, g of the hand-off. FoodVibe's stylesheets and its own CSS skill.
- Merging a run branch.

## Critical Questions
- Q: Does a small change to a global stylesheet qualify? A: never (Human, 2026-11-03).
- Q: Does the lane skip the build? A: no, by default it keeps `build`; a project whose hard rule does not require it can set `quickFix.keepBuild` to false.

## Execution Notes
