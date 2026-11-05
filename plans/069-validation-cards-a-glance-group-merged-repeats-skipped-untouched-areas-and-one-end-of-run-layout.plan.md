# Plan 069 — Validation cards: a glance group, merged repeats, skipped untouched areas and one end-of-run layout

Status: draft
Parked: 2026-11-05 — reliability freeze, revisit 2026-11-15
Depends-on: 049
Snapshot: 2e00691cad9f286567c7ea8243c8c94675752161
Source: merges plans 050, 051, 052 and 053 (Human decision, 2026-11-03); each came from the backlog of plan 024

## Problem Statement
The Human spends too much time on validation cards. Four changes to the same files, from plan 024's backlog, cut that cost.
They were four plans that could only run in order, so they are one plan with one branch and one pull request:

1. **A. Glance group (was 050).** A `[ui]` card whose script passed is already evidence (Tier 1b in `docs/agent/job-validation.md`),
   but a card a script covers in part still reaches the Human as a full card. The Human should scan those cards, not work through them.
2. **B. Merged repeats (was 051).** The last FoodVibe run left 127 cards, many of them the same check on different pages
   (same action, same expected result, only the URL differs). Each costs a read and an answer.
3. **C. Skipped untouched areas (was 052).** Many cards check pages whose code the plan never changed and that an automatic test
   already covers. They almost always pass and still cost the Human a check.
4. **D. One end-of-run layout (was 053).** Plan 022 made the HOW TO VALIDATE cards plain terminal text with copy-ready values,
   but the orchestrator's end-of-run list (screenshot grid per page, then cards) still has its own layout.

## Goals & Success Criteria
**Primary:** the cards reach the Human as one glance group (script-passed cards with screenshots), one card per distinct behaviour,
no card for an untouched page a test covers (listed on one line), all in the plan-022 layout.

Group A (was 050):
- [auto] `node --test tools/test/ui-tier.test.mjs` has a test that fails on today's code: an item whose script passed and left a screenshot goes to the glance group; an item whose test failed or left no screenshot stays a full card.
- [auto] `node --test tools/test/orchestrator.test.mjs` has a test that fails on today's code: the end-of-run list prints the glance group before the full cards, with one screenshot link per row.

Group B (was 051):
- [auto] `node --test tools/test/ui-tier.test.mjs` has a test that fails on today's code: two cards with the same Do and Expect and different URLs become one card listing both URLs; two cards that differ in Do or Expect stay separate.
- [auto] `node --test tools/test/orchestrator.test.mjs` has a test that fails on today's code: the merged card keeps the numbers of the cards it replaced, so a `failed: <number>` reply still maps to one of them.

Group C (was 052):
- [auto] `node --test tools/test/ui-tier.test.mjs` has a test that fails on today's code: a card whose page maps to no changed file and has a passing test is skipped; a card on a changed page, or with no test, is kept.
- [auto] `node --test tools/test/orchestrator.test.mjs` has a test that fails on today's code: the hand-off prints one line `Skipped (untouched, test passed): <n> — <numbers>` and a reply `show skipped` brings the cards back.

Group D (was 053):
- [auto] `node --test tools/test/orchestrator.test.mjs` has a test that fails on today's code: a `[human]` item in the end-of-run list is printed in the plan-022 card layout, grouped by page, and the screenshot grid per page is unchanged.
- [auto] `node --test tools/test/ui-tier.test.mjs` passes with a test that the layout text in `docs/agent/orchestrator.md` and `docs/agent/job-validation.md` do not disagree.

All groups (the same two lines closed each original plan; kept once):
- [human] The next real orchestrator run's validation list shows all four changes (the four original `[human]` items, one per group, folded into this one; the Human checks each sub-bullet on that list):
  - Glance group (A): it shows the passed cards with thumbnails and the Human can scan it in under a minute.
  - Merged repeats (B): on a run with repeated checks the Human sees one card with a list of pages instead of several near-identical cards.
  - Skipped untouched areas (C): the Human sees the skipped line and, when asked (`show skipped`), gets the skipped cards.
  - One layout (D): the end-of-run list reads like a normal hand-off, with values to copy on their own lines.
- [auto] `node --test tools/test/ui-tier.test.mjs tools/test/orchestrator.test.mjs` and `npm run build` pass.
- [auto] `node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .` reports no drift.

## Execution Mode
- Parallel: no.
- Concurrent plans: none; plan 054 depends on this plan.
- Isolated DB: no.
- Kit edits: one kit branch and one kit PR for this plan; commit per group (A, B, C, D, in that order) so each can be reviewed alone.

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`, plus the append-only hotspot `CHANGELOG.md` (add an entry, never rewrite one).

```scope
core/docs/agent/job-validation.md
docs/agent/job-validation.md
core/docs/agent/orchestrator.md
docs/agent/orchestrator.md
core/scripts/lib/done-when.mjs
scripts/lib/done-when.mjs
core/.claude/workflows/orchestrate.js
.claude/workflows/orchestrate.js
core/.claude/agents/orch-report.md
.claude/agents/orch-report.md
tools/test/ui-tier.test.mjs
tools/test/orchestrator.test.mjs
CHANGELOG.md
```

## Read Scope

Entire repo, including `docs/agent-evals/`.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry. Tags and releases: wait for the Human's go.

## Architecture Impact
- INV-none: preserves — kit instruction and workflow files only; `docs/brain/invariants.md` lists no invariant these files touch.

## Step 0 — Reality Check
Plan 049 is merged. Before each group, re-read the files it names as on `origin/main` and drop or reword any sub-task the code
already covers (group A: Tier 1b in `docs/agent/job-validation.md`, "The [ui] cards" in `docs/agent/orchestrator.md`; B: the
card layout rules and how `orchestrate.js` builds the card list; C: how a card names its page and how the changed files are known
at hand-off; D: the layout in `docs/agent/job-validation.md` against the end-of-run list in `docs/agent/orchestrator.md`).

## Atomic Sub-tasks

Do the groups in order; a group's tests pass before the next group starts.

- [ ] A1: Check whether the card code already supports a glance group before changing anything — read done-when.mjs, the job-validation Tier 1b text and the orchestrator end-of-run list, and write the finding in Execution Notes — core/scripts/lib/done-when.mjs, core/docs/agent/job-validation.md, core/docs/agent/orchestrator.md
- [ ] A2: Define when a card moves to the glance group: its test passed and left a screenshot, nothing else — rule text and a helper that sorts cards — core/docs/agent/job-validation.md, core/scripts/lib/done-when.mjs
- [ ] A3: Print the glance group in the hand-off and in the end-of-run list, before the full cards, one row per card with title and screenshot link — core/docs/agent/job-validation.md, core/docs/agent/orchestrator.md
- [ ] A4: Add tests that fail on today's code for the sort rule and the printed group, then resync installed copies and add a changelog entry — tools/test/ui-tier.test.mjs, tools/test/orchestrator.test.mjs, CHANGELOG.md
- [ ] B1: Say in the card rules when two cards are the same check: same Do and same Expect, different URL — and that anything else stays separate — core/docs/agent/job-validation.md
- [ ] B2: Merge such cards when the hand-off list is built, keeping one card with the list of pages and the numbers of the merged cards — core/.claude/workflows/orchestrate.js
- [ ] B3: Make a failed reply on a merged card name the page, so the agent knows which page broke — core/docs/agent/job-validation.md, core/.claude/workflows/orchestrate.js
- [ ] B4: Add tests that fail on today's code for the merge and the number mapping, then resync installed copies and add a changelog entry — tools/test/ui-tier.test.mjs, tools/test/orchestrator.test.mjs, CHANGELOG.md
- [ ] C1: Decide how a card's page maps to the changed files (page route to source file) and write the rule, including what happens when the mapping is unknown — keep the card — core/docs/agent/job-validation.md
- [ ] C2: Skip a card when its page is untouched and a passing test covers it, in the helper that builds the list — core/scripts/lib/done-when.mjs
- [ ] C3: Print the skipped cards on one line and let the Human bring them back with one reply — core/docs/agent/job-validation.md
- [ ] C4: Add tests that fail on today's code for the skip rule and the printed line, then resync installed copies and add a changelog entry — tools/test/ui-tier.test.mjs, tools/test/orchestrator.test.mjs, CHANGELOG.md
- [ ] D1: Make the orchestrator doc point to the one card layout in the job-validation doc instead of describing its own — core/docs/agent/orchestrator.md
- [ ] D2: Make the report agent print each remaining card in that layout, grouped by page, with the screenshot grid kept — core/.claude/agents/orch-report.md
- [ ] D3: Add tests that fail on today's code for the layout and the unchanged grid, then resync installed copies and add a changelog entry — tools/test/orchestrator.test.mjs, tools/test/ui-tier.test.mjs, CHANGELOG.md

## Technical Considerations
- Dependencies: plan 049 (merged). If A1 finds the glance group already built, the Worker stops and reports, and the Planner reduces this plan.
- When the page-to-file mapping cannot be decided (group C), the card is kept: skipping is never the default.
- Group D touches the format the orchestrator test relies on; keep the screenshot grid byte-for-byte the same.
- Card format: a change here must not alter the format other plans rely on without a test in `tools/test/ui-tier.test.mjs` or `tools/test/orchestrator.test.mjs`.
- Backend / API: none. Auth and validation: none. Security surface: none. Data / migration: none. Model changes: none. Project checks: none.

## Out of Scope
- Cards that differ in the action or the expected result.
- Cards on touched pages.
- Changing which Done-when items get which tag, and changing the card layout itself.
- Reproducing a reported card failure with a short test (plan 054, which depends on this plan).

## Critical Questions
- Q: Does a `[human]` item ever move to the glance group? A: only a card whose script passed and saved a screenshot; the item stays `[human]` in the plan.
- Q: What if the same check fails on only one of the merged pages? A: the reply names the page (`failed: 4 /orders`); the other pages stay passed.
- Q: Silent or listed? A: listed on one line (decided by the Human, 2026-11-01).

## Execution Notes
