# Plan 018 — UI Validation Tier: Done-When Items Checked by a Script First, a Browser Only for Failures

Status: active
Snapshot: 3511799
Depends-on: 014

## Problem Statement
Done-when items are `[auto]` (an agent proves it with an exact command) or `[human]` (Dandan clicks). No agent ever drove
the real UI in the MVP run, so the Human got 127 validation cards. Most of them are scriptable: open a page, do one
thing, assert what is on screen, keep a screenshot. The project's own QA system shows the pattern: cheapest layer first,
tell the browser agent what a script already checked ("PRE-CHECKED — skip"), and keep plan drift (the plan says X, the
app has Y) apart from bugs. It also shows browser runs are fragile: 2 of 4 stopped at step 0 for environment reasons.

This plan adds a `[ui]` tier between `[auto]` and `[human]`.

## Prerequisites
- Plan 014 merged (the pipeline with a UI step to fill, `orch-ui` agent from 013, `orch-preflight.mjs`).

## Goals & Success Criteria
**Primary:** a plan can tag a Done-when item `[ui]`; a builder writes a short end-to-end test per such item that saves a
screenshot; a browser agent looks only at failures and at items no script can check; the report shows one screenshot
grid grouped by page.

- [auto] `grep -l "\[ui\]" core/docs/agent/job-validation.md core/.claude/skills/save-plan/SKILL.md
  core/.claude/references/prd-template.md core/.claude/commands/ship.md` lists all four files.
- [auto] The save-plan shape lint (tested in `tools/test/ui-tier.test.mjs`) accepts a Done-when item starting with
  `[ui]`, rejects one whose tag is `[ui` or `[UI]`, and still rejects an untagged one.
- [auto] The orchestrator fixture (`tools/fixtures/orchestrator/`) with one passing and one failing scripted `[ui]` card:
  the passing card produces a screenshot path in `status.json` and the report grid and never reaches the browser agent;
  the failing card is passed to the browser agent with the "pre-checked, skip" list of the passing card; a PLAN-DRIFT
  verdict is reported in its own section, with no severity, separate from bugs.
- [auto] A blocked environment (dev server not answering, login failing, backend cross-origin unreachable — each
  simulated) stops before the browser agent with the reason in `status.json`, and does not consume a fix round.
- [auto] `node tools/install-check.mjs`, `leak-check`, `pack-check`, `e2e-check`, `workflow-link-check`,
  `acceptance-check --e2e` pass; `node tools/drift-check.mjs --target .` reports no drift.
- [human] On one real plan with 3 UI cards, in the project Dandan chooses: the scripted cards pass with screenshots, and
  Dandan checks that the grid shows what the cards ask. Cards that stay `[human]` are still shown to him as cards.

## Execution Mode
- Parallel: no — after 014 (shares the orchestrator fixture and `orch-preflight.mjs`).
- Concurrent plans: none.
- Isolated DB: no.
- Kit edits: kit branch `feat/018-ui-validation-tier` + kit PR; Dandan merges. Release: with 013 and 014 (minor: a new
  tag; existing `[auto]`/`[human]` plans keep working).

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`.

```scope
core/docs/agent/job-validation.md
core/docs/agent/orchestrator.md
core/.claude/skills/save-plan/**
core/.claude/references/prd-template.md
core/.claude/commands/ship.md
core/.claude/commands/done.md
core/.claude/agents/orch-ui.md
core/.claude/agents/orch-builder.md
core/.claude/workflows/orchestrate.js
core/scripts/orch-preflight.mjs
core/scripts/lib/**
tools/fixtures/orchestrator/**
tools/orchestrator-e2e.mjs
tools/test/**
tools/e2e-check.mjs
docs/agent/**
.claude/skills/**
.claude/references/**
.claude/commands/**
.claude/agents/**
.claude/workflows/**
scripts/**
CHANGELOG.md
core/scripts/orch-state.mjs
core/scripts/scope-check.mjs
.kit/install.json
```

## Read Scope

Entire repo. Analysis and architectural suggestions are expected.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside the
`## Read-Write Scope` above: STOP, tell the Human the file, the exact change, and why it can't be done in-scope; offer
`approved: <path>`; then append the path to the scope block above and retry.

## Architecture Impact
- INV-none: preserves — a new optional tag; `[human]` items still need the Human, and no agent promotes an item to
  `[auto]` (only the plan author tags). Plan 009's hand-off rules (servers first, cards by page) are unchanged.

## Step 0 — Reality Check

Runs only when `scope-check.mjs --drift` reports `REALITY: drift`. Check the listed commits by symbol and print one line
per commit: `ok` or `conflict: <what>`. STOP for a go only on a `conflict`.

## User Stories
- As Dandan, I want most UI cards checked by a script with a screenshot so that I only see the ones that need me.
- As Dandan, I want "the plan says X, the app has Y" kept apart from bugs.
- As the orchestrator, I want a broken environment to stop the browser step early, with the reason.

## Functional Requirements

### Must Have (P0)
- [ ] `[ui]` tag defined: an item a script can check by navigating, acting, asserting and saving a screenshot, using the
  project's e2e command (`commands.e2e`).
- [ ] The builder writes one short e2e test per `[ui]` item; the gate runs them.
- [ ] The browser agent is used only for a failed scripted item or an item that cannot be scripted; it gets a "pre-checked,
  skip" list and the known-findings list.
- [ ] Environment preflight before any browser step: servers answer, login works, cross-origin reachability.
- [ ] Verdicts per item: pass / fail / plan-drift (no severity).
- [ ] The report shows a screenshot grid grouped by page (extends plan 009's cards-by-page).

### Should Have (P1)
- [ ] Playwright for scripted cards; the built-in browser only for the agent's look at failures (Q2).

### Nice to Have (P2)
- none

## UI/UX Notes
- Report grid: one section per page, each card with title, verdict and thumbnail link; PLAN-DRIFT in its own section.

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [x] A1: Define the UI tag so a plan can say which Done-when items a script can check — meaning, how it differs from auto and human, who may tag it — core/docs/agent/job-validation.md, core/.claude/references/prd-template.md
- [x] A2: Teach the plan saving lint and the ship command about the UI tag, so such plans are accepted and handled — tag accepted, bad spellings rejected, ship treats UI items as agent-checked with evidence — core/.claude/skills/save-plan/SKILL.md, core/.claude/commands/ship.md, core/.claude/commands/done.md
- [x] A3: Make the builder write one end-to-end test per UI item that saves a screenshot — uses the project's e2e command, short test per card, screenshot path recorded in the result — core/.claude/agents/orch-builder.md
- [x] A4: Check the environment before any browser step and stop with the reason when it is blocked — servers, login, cross-origin reachability; does not consume a fix round — core/scripts/orch-preflight.mjs, core/.claude/workflows/orchestrate.js
- [x] A5: Let the browser validator look only at failures and unscriptable cards, and keep plan drift apart from bugs — pre-checked skip list, known-findings list, pass/fail/plan-drift verdicts — core/.claude/agents/orch-ui.md
- [x] A6: Show the screenshot grid grouped by page in the run report — drift section separate — core/.claude/workflows/orchestrate.js, core/docs/agent/orchestrator.md
- [x] A7: Prove it on the orchestrator fixture and sync the installed copies — one passing and one failing scripted card, three blocked-environment cases, tag lint tests; sync --apply; CHANGELOG entry — tools/fixtures/orchestrator/, tools/orchestrator-e2e.mjs, tools/test/ui-tier.test.mjs, CHANGELOG.md

## Technical Considerations
- Dependencies: plans 013 (`orch-ui`, `orch-builder`), 014 (workflow, preflight, fixture), 009 (cards by page); the
  project's `commands.e2e`.
- New files needed: `tools/test/ui-tier.test.mjs`.
- Model changes: none.
- Backend / API: none.
- Auth and validation: the QA login used by scripted cards is a project secret kept in `.env`; the kit never reads or
  prints it.
- Security surface: browser steps visit only the project's own dev server URLs from the plan; no third-party URLs.
- Data / migration: none.
- Project checks: none.

## Out of Scope
- Visual regression or pixel diffing.
- Replacing `[human]` items that need a person's judgement.
- Choosing a browser tool for projects (they keep `tools.browser`).

## Critical Questions
- none

## Execution Notes
Review (Planner, 2026-10-21): fixed — brief's "plan 015" renumbered 018; Q2 (Playwright for scripted cards, built-in
browser for the failure look) accepted. Checked: 009, 013, 014, 016.

- scope extended: core/scripts/orch-state.mjs — `set --card` must store who checked a card (`--via script|browser`)
  and accept `unchecked`, and status.json is written only by this script (orchestrator, no Human available)
- scope extended: core/scripts/scope-check.mjs — the save-plan shape lint needs a command (`--tags --plan=<p>`); the
  lint rule itself lives in the new scripts/lib/done-when.mjs (orchestrator, no Human available)
- scope extended: .kit/install.json — rewritten by `node tools/sync.mjs --target . --apply` (file hashes), committed as other plan branches do (orchestrator, no Human available)
- Decision (most conservative): a blocked UI environment parks the plan (no fix round, no retry); the Human fixes the environment and relaunches. Plan drift does not fail the plan and sends nothing back to the builder; it is a run note and its own report section.
- Decision: the gate runs each card's own test command (one per `[ui]` card, from the builder's `uiCards`), not the whole `commands.e2e` suite, so one failed card goes to the browser agent instead of failing the gate. With the UI step off (`args.ui` not set) a failed card script is a `major` finding for the builder and an unscriptable card is recorded `unchecked` for the Human.
- Decision: the UI login/backend URLs come from `args.uiLogin` / `args.uiApi` or `ORCH_UI_LOGIN_URL` / `ORCH_UI_API_URL`; the QA user from `ORCH_QA_USER` / `ORCH_QA_PASSWORD` (sent, never printed). `/orchestrate` was not changed (out of scope): a project sets the env vars.
- Evidence (worktree C:/coding projects/Cursor/ai-workflow-kit-orch-018, 2026-10-21):
  - `node scripts/scope-check.mjs --drift --plan=<this plan>` → REALITY: clean (Step 0 skipped)
  - `node tools/sync.mjs --target . --apply` → exit 0, KIT_SYNC: applied
  - `npm run build` → exit 0, PACK_CHECK: ok · `npm run lint` → exit 0, LEAK_CHECK: ok — 27 files, 0 leaks · `npm run test` → exit 0, WORKFLOW_LINK_CHECK: ok · `npm run e2e` → exit 0, ACCEPTANCE_CHECK: ok — 122 checks passed
  - `node tools/e2e-check.mjs` → exit 0, E2E_CHECK: ok — 53 cases passed (incl. "[ui] tier tests pass against the installed scripts" and the orchestrator e2e)
  - `node tools/orchestrator-e2e.mjs` → exit 0, ORCHESTRATOR_E2E: ok — 51 cases passed (delta: passing script card in status.json + grid, never reaches orch-ui; failing card to orch-ui with PRE_CHECKED + KNOWN_FINDINGS, plan drift in its own section; ui-down / ui-login / ui-cors parked round 0 with the reason, orch-ui not called)
  - `node --test tools/test/ui-tier.test.mjs` → # pass 7, # fail 0 (accepts `[ui]`, rejects `[ui` / `[UI]` / untagged; `scope-check --tags` exit 0 / 1)
  - `grep -l "[ui]" core/docs/agent/job-validation.md core/.claude/skills/save-plan/SKILL.md core/.claude/references/prd-template.md core/.claude/commands/ship.md` → lists all four, exit 0
  - `node tools/install-check.mjs`, `leak-check`, `pack-check`, `workflow-link-check`, `acceptance-check --e2e` → each exit 0 · `node tools/drift-check.mjs --target .` → KIT_DRIFT: ok — 0 undeclared differences
  - `node scripts/scope-check.mjs --tags --plan=<this plan>` → DONE_WHEN_TAGS: ok
- Left for the Human: the [human] item (a real project with 3 UI cards) and the kit PR / release with 013 and 014.
