# Plan 080 — A UI card is checked against the plan's own code, never against a server that runs main

Status: abandoned — obsolete: it changes the orchestrator workflow and agents that kit 2.1.0 / plan 090 deleted (scripts/run-plans.mjs replaced them); re-plan against run-plans.mjs if still wanted; closed 2026-11-09
Parked: 2026-11-05 — reliability freeze, revisit 2026-11-15
Depends-on: 075
Snapshot: b075db1e9c4876d4f210c95612df2e2a406a160a

## Problem Statement

A `[ui]` card is proved by a screenshot of a page URL. Nothing checks which code answers on that URL:

- The builder reports each card's `page` as a full URL it chooses (`core/.claude/agents/orch-builder.md:41-47`, example
  `http://localhost:5173/settings`).
- The orchestrator preflight starts the **main folder's** frontend on the base port (`slots.fePorts`) when it does not
  answer (`core/scripts/orch-preflight.mjs:141-160`, `slot-serve.mjs --main`), and the main folder runs
  `origin/main`, not the plan branch (`core/docs/agent/orchestrator.md:173-175` says so for main-folder checks).
- `orch-preflight.mjs --ui` checks only that each page's origin answers below 500 (`orch-preflight.mjs:330-341`);
  `orch-ui` then opens the page and judges it (`orch-ui.md`).

So when a builder points a card at the base port, the screenshot shows `main` and the card can pass for code that is
not in it, or fail for a reason the plan already fixed. The Human asked this on 2026-11-02 ("which code does the app
serve? if it is main's, what does that mean for trusting the result?") and the question was never answered. A builder
in a slot has its own servers on `slots.fePorts + N` (`core/scripts/lib/slot.mjs:41-46`); a builder in its own folder
(`orchestrator.useSlots: false`, as the kit itself now runs) has none.

## Goals & Success Criteria

**Primary:** before any card is judged by a screenshot, the run knows which folder serves its page and at which commit;
a page served by a folder that is not at the plan's head commit is never a pass.

- [auto] `node --test tools/test/ui-tier.test.mjs` passes, with tests that fail on today's code:
  (a) `node scripts/orch-preflight.mjs --ui --pages <url> --plan-sha <sha>` maps the page's port to its folder (the base
  port → the main folder; `base + N` → slot `wt-N`) and prints `OK ui code <port> <folder> <short sha>` when that
  folder's `HEAD` equals `--plan-sha`;
  (b) it prints `FAIL ui code: <page> is served by <folder> at <short sha>, the plan is at <short sha>` when they differ,
  and `FAIL ui code: <page> — no known folder serves port <port>` for a port outside the slot range;
  (c) without `--plan-sha` nothing changes (the line is not printed).
- [auto] `node --test tools/test/orchestrator.test.mjs` passes, with tests that fail on today's code: the workflow
  passes the plan branch's head sha to the UI preflight; a `ui code` failure keeps every affected card out of the
  browser step and records it as `unchecked` with the reason, never `pass`; a script pass counts only when the card's e2e
  test started its own server in the plan's folder (a Playwright `webServer` or the project's e2e command, as Step 0 (c)
  finds), otherwise a script pass against a page with a `ui code` failure is recorded `unchecked` with the reason.
- [auto] The rendered `orch-builder.md` says the page URL of a card uses the builder's own server: inside a slot the
  port from `node scripts/slot-serve.mjs` for that slot; outside a slot only a test that starts its own server in the
  builder's folder, and otherwise no page (the browser step goes to the Human); the
  rendered `orchestrator.md` `## The [ui] cards` section says which code a card is checked against (a test reads both).
- [auto] `npm run build`, `npm run lint` and `node --test "tools/test/*.test.mjs"` pass, and `node tools/e2e-check.mjs`
  passes (it runs `ui-tier.test.mjs` against an installed project, `e2e-check.mjs:194`).
- [auto] `node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .` reports no drift.
- [human] On the next FoodVibe run with `ui: true`, the report shows for each `[ui]` card the folder and commit its page
  came from, and none came from the main folder for an unmerged plan.

## Execution Mode
- Parallel: no.
- Concurrent plans: plans 068 (`orch-preflight.mjs` probe) and 069/073 (`ui-tier` cards) touch nearby code; merge
  `origin/main` before the PR.
- Isolated DB: no.

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/scripts/orch-preflight.mjs
scripts/orch-preflight.mjs
core/scripts/lib/slot.mjs
scripts/lib/slot.mjs
core/.claude/workflows/orchestrate.js
.claude/workflows/orchestrate.js
core/.claude/agents/orch-builder.md
.claude/agents/orch-builder.md
core/docs/agent/orchestrator.md
docs/agent/orchestrator.md
tools/test/ui-tier.test.mjs
tools/test/orchestrator.test.mjs
CHANGELOG.md
```

`scripts/**`, `.claude/**` and `docs/agent/**` are the rendered copies, written only by
`node tools/sync.mjs --target . --apply` (R1).

## Read Scope

Entire repo and its git history.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry.

## Architecture Impact
- INV-none: preserves — a preflight check and a stricter card verdict; no invariant's `Touches` glob is in scope.

## Step 0 — Reality Check

1. Runs only when `scope-check.mjs --drift` reports `REALITY: drift`: check the listed commits by symbol and print `ok`
   or `conflict: <what>` per commit; stop for a go only on a conflict.
2. Always — answer from the code, with `file:line`, and write the answers into Execution Notes before any edit:
   (a) where a builder in a slot gets its servers today (does anything run `slot-serve.mjs` for it?);
   (b) which URL a builder outside a slot would use, and whether anything serves its folder;
   (c) whether the card's own e2e test starts its own server (a `webServer` entry or the project's e2e command) — if it
   does, the script verdict already ran on the plan's code and only the browser step needs the check.
   The answer to (c) decides, per pack, which script passes count (Done-when, the orchestrator item); write it per pack.

## User Stories
- As the Human, I want a green UI card to mean the plan's code works, not that `main` looks fine.

## Functional Requirements

### Must Have (P0)
- [ ] Port-to-folder mapping and the `ui code` preflight line.
- [ ] The workflow passes the plan's head sha and never lets a `ui code` failure become a pass.
- [ ] The builder rule for the page URL and the doc sentence.

### Should Have (P1)
- [ ] The report names the folder and commit per card.

### Nice to Have (P2)
- none

## UI/UX Notes
- Terminal and report text only.

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [ ] U1: Find which folder serves a page and at which commit, before any card is judged — port to folder from the slot range, the folder's head compared with the plan's — core/scripts/lib/slot.mjs, core/scripts/orch-preflight.mjs, tools/test/ui-tier.test.mjs
- [ ] U2: Keep a card that was checked on other code out of the pass column — the workflow passes the plan's head sha, a ui code failure makes the cards unchecked with the reason, the report names folder and commit — core/.claude/workflows/orchestrate.js, tools/test/orchestrator.test.mjs
- [ ] U3: Tell the builder which page URL to report and write down which code a card is checked against — builder rule (own slot port; outside a slot only a test that starts its own server, else no page), one paragraph in the orchestrator doc — core/.claude/agents/orch-builder.md, core/docs/agent/orchestrator.md
- [ ] R1: Render the kit's own installed copies, check drift and add a changelog line — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .` — scripts/**, .claude/**, docs/agent/**, CHANGELOG.md

## Technical Considerations
- Dependencies: `slot.mjs` (`ports()`, slot list), `orch-preflight.mjs` (`uiChecks()`), `orchestrate.js` (the UI step
  around `:857`, `record()` at `:817`).
- New files: none.
- Model changes: a card record may carry `servedBy` and `servedSha`.
- Backend / API: none. Auth and validation: none.
- Security surface: none new; the check runs `git rev-parse` in known folders only.
- Data / migration: none.
- The backend still runs from the main folder when a plan needs secrets (`[auto:main]`); a plan that changes backend
  code and has `[ui]` cards gets the report note `backend served from the main folder (origin/main)` beside its cards.

## Out of Scope
- Starting servers for a builder outside a slot (a later plan if Step 0 shows it is needed).
- Changing how secrets reach a slot's backend.

## Critical Questions
- Q: Is a script pass valid when the e2e test started its own server in the plan's folder? A: yes; only the browser
  step needs a known folder and commit (recommended: otherwise every card of a `useSlots: false` project, the kit
  included, goes to the Human).
- Q: A page served by the main folder for an unmerged plan — fail the card or mark it unchecked? A: unchecked, so it goes
  to the Human with the reason and never costs a builder fix round (recommended).

## Execution Notes
- Source: chat "בדיקת אורקסטרטור ראשונה" (2026-11-02): the open question "a server started from the main folder serves
  main's code, not the plan's — which code does orch-ui see?", sent to the FoodVibe agent and never answered.
- Review (Architect + PM, a separate agent against b075db1, 2026-11-03): mechanical gaps fixed in the draft (line references, scope and Depends-on, test names); open points answered with the recommended default in Critical Questions. The Planner's own review is still to run.
