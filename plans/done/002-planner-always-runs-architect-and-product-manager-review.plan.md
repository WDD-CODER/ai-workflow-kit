# Plan 002 — Planner Always Runs the Architect and Product Manager Review

Status: done
Snapshot: b0ba42501af952fc23566a1885fab53af57e6686

## Problem Statement
The Software Architect and Product Manager agent personas were retired in July 2026; the role "moved to Claude.ai". In practice the Planner session (Claude Code on `main`) plans most of the time, and Claude.ai can't see the current code anyway. Today `/plan` still says planning is "Claude.ai by default", so when the Planner writes or receives a plan nothing makes it check the architecture and the product side.

Decisions (Dandan, 2026-10-18):
- **No agent personas.** Architect/PM work is a conversation with the Human; a subagent can't ask questions mid-task. The role lives in `/plan`, run inline by the Planner.
- **Always.** Every plan gets an Architect + PM review before it is saved: plans the Planner writes, and briefs/Plan Contracts it receives (Claude.ai, Cursor, another agent). On a received plan it is a **review**: check against the real codebase, report gaps, the Human decides. Not a rewrite.
- **No forced alternatives.** The plan is the best design, not "minimal + ideal". The HLD's "Alternatives Considered" section goes.
- **Concreteness line** goes into the PM checklist: every step names its files and is concrete enough for a Worker to run without asking (no "TBD", "handle errors appropriately", "same as the other screen").
- Kit-wide: the kit's `/plan` loads `.claude/references/prd-template.md` and `hld-template.md` but the kit ships neither, so any other project points at nothing. Ship both.

## Prerequisites
- Plan 001 merged and `v1.0.5` released (same kit files: `workflow-map.md`, `save-plan`).

## Goals & Success Criteria
- [auto] Kit `core/.claude/commands/plan.md` has a `## Architect + PM review (always)` section and no `three-agent` / `Claude.ai by default` text; `git grep -n -i "three-agent\|Claude.ai by default" -- core layers templates` finds nothing.
- [auto] Kit ships `core/.claude/references/prd-template.md` and `hld-template.md` with no FoodVibe names (`leak-check` passes); `hld-template.md` has no "Alternatives Considered".
- [auto] `install-check` render for packs `[]` and `[angular, node-express]`: every path `/plan` and `workflow-map.md` load exists.
- [auto] Tag + release `v1.1.0`; FoodVibe `kit-sync -Ref v1.1.0 -Apply`: 0 unresolved `conflict`, `npx ng build` and `node scripts/kit-owned.mjs --check` pass, `.claude/references/prd-template.md` and `hld-template.md` now kit-owned, FoodVibe-only checks in the project plan-checks file.
- [human] Dandan pastes a short Claude.ai-style brief into the Planner: the Planner prints the Architect + PM review (gaps found or "no gaps") **before** saving, and asks only where a decision is his.
- [human] Dandan runs `/plan` on a small new idea in the Planner: it scopes, asks, fills Architecture Impact and the PM checklist without being told to.

## Execution Mode
- **Parallel:** no. Session opened in the kit folder; FoodVibe sync PR from a `wt-N` slot.
- **Concurrent plans:** no other kit plan (003–005 run after this one).
- **Isolated DB:** no.
- **Kit edits:** kit branch `feat/002-planner-review` + kit PR; Dandan merges; tag after Dandan's go.

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`.

```scope
core/**
layers/cursor/**
templates/**
kit.config.json
docs/**
CHANGELOG.md
kit.json
README.md
tools/**
```

**Outside this repo:** FoodVibe (R6, R7): `../foodVibe1.0/docs/agent/plan-checks.md` (new) plus `../foodVibe1.0/` on a branch from a FoodVibe `wt-N` slot: `.kit/**`, `kit.config.json`, `docs/workflow-kit/**` and the kit-owned files `kit-sync -Apply` writes (`.claude/**`, `.cursor/**`, `.github/workflows/**`, `.husky/**`, `docs/agent/**`, `scripts/**`, `README_WORKFLOW.md`); kit GitHub repo (PR, tag, release).

## Read Scope
Kit repo; FoodVibe `.claude/commands/plan.md`, `.claude/references/*`, `.claude/skills/{brief-detection,save-plan}/**`, `docs/brain/invariants.md`, the retired personas (`git show 1206ea28^:.claude/agents/software-architect.md` and `product-manager.md`) for wording worth keeping.

## Escalation Protocol
Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append the path to the scope block and retry. `conflict` rows in the FoodVibe sync: STOP and show them; the two reference templates are expected conflicts and are resolved by taking the kit version **after** their FoodVibe-only lines moved to `docs/agent/plan-checks.md`. Tags and releases: wait for Dandan's go.

## Architecture Impact
- INV-none: preserves — planning docs and commands only; the review step reads `docs/brain/invariants.md`, it does not change any invariant.

## Step 0 — Reality Check
- 001 merged, `v1.0.5` tagged, kit `main` clean.
- `git grep` the kit for every place that describes who plans (`plan.md`, `workflow-map.md` §1 Roles, `README_WORKFLOW.md` title "Three-Agent Manual Bridge", `skills.md`, `brief-detection`); list them in this plan before editing.

## Design
**`/plan` (kit core + Cursor layer mirror):**
- Role line: "The Planner (Claude Code in the main folder) is the Architect and the Product Manager. Claude.ai or another tool may draft a plan; the Planner still runs the review below before saving."
- New section `## Architect + PM review (always)` that runs on every plan, before the Planner protocol saves it:
  - **Architect:** fill `## Architecture Impact` from `docs/brain/invariants.md` (existing rule); every file, symbol and service the plan names exists on `origin/main` (or is marked new); the design follows the project's standards doc (`{{stack.standardsDoc}}`) and existing patterns; read-write scope covers every target file and nothing more.
  - **PM:** problem and success criteria are testable, every Done-when tagged; Out of Scope written; backend/API impact, auth and validation needs, security surface, data/migration impact named; smallest version that delivers the full value; **every step names its files and is concrete enough to run without asking**; project-specific checks from `{{paths.planChecks}}` when that file exists.
  - **Output:** one block `ARCHITECT + PM REVIEW` — `no gaps`, or one line per gap with a proposed fix. A received plan is not rewritten silently: the Planner shows the gaps and applies only what Dandan accepts (or the obvious mechanical fixes: paths, titles, tags).
- The existing "Typical flow" step 2 points at this section; brief-detection's Plan Contract route already lands in the Planner protocol, which gets "run the review" as its first step.

**Templates (new in kit core):** `prd-template.md` from FoodVibe's, generalised (hotspots and i18n via placeholders; Hebrew-specific lines move out). `hld-template.md`: "Alternatives Considered" replaced by `### Why this design` (one short paragraph); translation keys line generic.

**Project checks:** new config key `paths.planChecks` (default `docs/project/plan-checks.md`), documented in the scaffold and `parameters` doc. FoodVibe sets `docs/agent/plan-checks.md` and writes it with: Hebrew canonical values + dictionary keys, generic `Entity` schema / `/api/v1/data/:type` contract, Lucide icons, RTL layout, Zod schema in `shared/schemas`.

**Roles wording:** `workflow-map.md` §1 and `README_WORKFLOW.md` describe the current roles (Planner = Architect + PM; Workers in slots; Claude.ai optional drafting), not "three-agent".

CHANGELOG `[1.1.0]` Added: templates, `paths.planChecks`, review section. "What a project must do: nothing; optional plan-checks file."

## Atomic Sub-tasks
- [x] R0: Check the plan still matches the kit and list every place that says who plans — Step 0 reality check + grep list — `plans/002-planner-always-runs-architect-and-product-manager-review.plan.md`
- [x] R1: Make the Planner run an architect and product review on every plan before saving — new review section, role line, Planner protocol first step, Cursor mirror — `core/.claude/commands/plan.md`, `layers/cursor/.cursor/commands/plan.md`
- [x] R2: Ship the plan and design templates in the kit so every project has them — generic prd and hld templates, HLD alternatives replaced by why-this-design — `core/.claude/references/{prd,hld}-template.md`
- [x] R3: Let each project add its own planning checks without forking the command — paths.planChecks config key, scaffold, parameters doc — `kit.config.json`, `templates/**`, `docs/**`
- [x] R4: Describe the current roles instead of the old three-agent setup — workflow-map roles, README_WORKFLOW title and intro, skills.md note — `core/docs/agent/workflow-map.md`, `core/README_WORKFLOW.md`, `core/.claude/commands/skills.md`
- [x] R5: Run the kit checks, open the kit PR and release v1.1.0 — leak-check, pack-check, install-check; CHANGELOG; tag after Dandan's go — kit repo — done: checks, CHANGELOG, PR #24; release moved to v1.2.0 (plan 006), not done here
- [x] R6: Move FoodVibe's own planning checks into a project file before syncing — Hebrew values, Entity contract, icons, RTL, Zod; kit.config paths.planChecks — `../foodVibe1.0/docs/agent/plan-checks.md`, `../foodVibe1.0/kit.config.json`
- [x] R7: Sync FoodVibe to v1.1.0 and ship it — dry-run, take kit templates, Apply, ng build, kit-owned check, /ship — `../foodVibe1.0/.kit/install.json` + files kit-sync writes
- [x] R8: Try the review on a pasted brief and on a new idea in the Planner — Dandan's two checks from Goals — Planner session

## Out of Scope
Restoring agent persona files; forced alternative designs; the React-Vite hand-off work (001, 003–005).

## Execution Notes

Run under plan 006 (autonomous run): branch `feat/002-planner-review` from `main` `14756d0` (after `bf4e45d`,
v1.0.5). Plan 006 replaces this plan's "Dandan merges / tag after go / release v1.1.0": no tag, no release, no
`kit.json` bump here; the run releases once as `v1.2.0` after merge point 1. R6–R8 run after that merge
(plan 006 A7 / A9).

### R0 — Reality check
- Kit `main` clean at `14756d0`; `v1.0.5` released. Plan still matches the kit, with these differences:
  - **Overlap with 001:** 001 already removed the `three-agent` heading in `core/docs/agent/workflow-map.md`,
    "In the three-agent workflow," in `core/.claude/commands/plan.md`, the note in `skills.md` and step 4 of
    `security.md`. `skills.md` has no who-plans text left, so R4 has nothing to do there.
  - **The kit already shipped both templates**, as *seeds* in `templates/.claude/references/` (written once,
    never synced). So "the kit ships neither" was not true; the real gap was that sync never updates them.
    R2 moved them to `core/.claude/references/` (managed).
  - `/plan` and `workflow-map.md` loaded `/_shared/tech-stack.md` + `current-state.md`, a folder install never
    writes (install-check even asserts `_shared/` is not installed). Fixed to `{{paths.sharedDocs}}/…`.
- Every place that said who plans (before editing):
  - `core/.claude/commands/plan.md:4` "Architect role (Claude.ai by default; …)", `:16` Invokes "Architect",
    `:23` flow step 2, `:62` "A Claude.ai Architect only drafts …", Notes "Use Cursor (Contractor)".
  - `layers/cursor/.cursor/commands/plan.md` (pointer only).
  - `core/docs/agent/workflow-map.md:16` §1 row "Architect | Claude.ai (default …)", `:46` `/plan` row
    (`_shared/*`), `:201` flow F1 "Architect (claude.ai) drafts Plan Contract".
  - `core/README_WORKFLOW.md:1` title "Three-Agent Manual Bridge", `:20` "Architect on Claude.ai (A)",
    cost-routing pools A/B/C, `/_shared/`, `.claude/rules/`, stale "Old vs new plans" naming.
  - `core/.claude/skills/brief-detection/SKILL.md:22` Planner route "steps 1–6" (no review).
  - `core/.claude/commands/feat.md:13` "Architect authors"; `core/.claude/skills/save-plan/SKILL.md:65,77`
    "an Architect drafting in chat", "SHA the Architect filled in"; `core/.claude/commands/review-it.md:20`
    "ESCALATE TO ARCHITECT".
  - `templates/.claude/references/prd-template.md:4` "if the Architect already set it".

### Decisions
- **Templates are managed core files, not seeds** (Design says "new in kit core"). The first dry-run showed
  the catch: a seed's recorded hash is the project's own copy (`--adopt` records whatever is there), so sync
  saw "unchanged since install" and reported `kit-update` — it would have overwritten customised copies.
  Review finding #1 → fixed in `tools/sync.mjs`: a file recorded as `seed` that the kit now ships as
  `managed` is `conflict` unless it already equals the kit (`same`, recorded as managed). `tools/**` added to
  the scope for this (approved by the Planner under plan 006). FoodVibe now shows the two expected conflicts.
- **PRD generalisation:** kept hotspots / i18n / UI locale placeholders; dropped nothing project-specific
  because the kit copy was already generic. Added Technical Considerations lines for backend/API, auth and
  validation, security surface, data/migration and `{{paths.planChecks}}`, plus the concreteness line, so the
  template asks for what the PM checklist checks.
- **HLD:** "Alternatives Considered" table → `### Why this design` (one paragraph; another option only when the
  Human must choose). Translation line was already generic.
- **`paths.planChecks` default** `docs/project/plan-checks.md` set in `kit.config.json` (plain default; no
  computed default in `tools/lib/kit.mjs` is needed). The kit never writes the file (no
  seed): a seed would land at `{{paths.sharedDocs}}/plan-checks.md` and could disagree with a project's
  configured path.
- **"Parameters doc"** = the `kit.config.json` `$comment` scaffold plus the README Layout row for
  `kit.config.json` (there is no separate parameters doc in `docs/`); the `AGENTS.md` skeleton gets one
  bullet so new projects see the rule.
- **Review placement:** Planner protocol **step 0** (before pull/save), so `brief-detection` → Planner protocol
  runs it first; a plan the Planner wrote and already reviewed in the session just reprints its block.
- **Extra wording fixes inside scope** (same who-plans theme): `/feat`, `save-plan`, `/review-it` ("ESCALATE TO
  ARCHITECT (the Planner …)", verdict token unchanged). `/review-it` is a FoodVibe override, so it does not
  reach FoodVibe.
- **CHANGELOG heading:** `### 002 — <title>` under `## [Unreleased]`, not `### Plan 002 — …`: leak-check's
  history rule (`\bplans? \d{3}\b`) fails on "Plan 002" in `CHANGELOG.md`.
- **Scope added: `tools/**`** (review finding #1: `sync.mjs` promoted-seed rule, `drift-check.mjs` header
  comment, `install-check.mjs` cases). Everything else is under `core/**`, `layers/cursor/**`, `templates/**`,
  `kit.config.json`, `README.md`, `CHANGELOG.md` or this plan.
- **Review fixes (PR review pass):** step 0 fetches before checking `origin/{{git.mainBranch}}`; a gap the Human
  rejects is noted in the plan's Execution Notes, then the Planner continues; "every plan" narrowed to "every
  plan the Planner saves" (a Plan Contract saved inside a Worker slot goes through save-plan only); `/feat`
  `/_shared/` path fixed; CHANGELOG gives the exact `AGENTS.md` line for existing projects (seed) and documents
  the conflict resolution and the drift-check / `overrides` escape hatch.

### Evidence (`[auto]` Done-when)
- `/plan` review section: `grep -n "## Architect + PM review (always)" core/.claude/commands/plan.md` →
  `41:## Architect + PM review (always)`.
- `git grep -n -i "three-agent\|Claude.ai by default" -- core layers templates` → no output, exit 1.
- Templates: `git ls-files core/.claude/references` → `hld-template.md`, `prd-template.md`;
  `grep -c "Alternatives Considered" core/.claude/references/hld-template.md` → `0`; `node tools/leak-check.mjs`
  → `LEAK_CHECK: ok — 151 files, 0 leaks`.
- Load paths: `tools/install-check.mjs` now asserts, in every fixture (packs `[]`, `angular`, `node-express`
  and a new `angular + node-express + Cursor` fixture), that every path in the rendered `/plan` `## Loads` and
  in the `workflow-map.md` `/plan` row exists; entries marked optional (`{{paths.planChecks}}`, "when the file
  exists") are skipped. `node tools/install-check.mjs` → `INSTALL_CHECK: ok — 4 fixtures, …, 0 problems`.
  Mutation check: pointing `/plan` at a missing `docs/brain/nope.md` fails all four fixtures. Before the change
  `_shared/` was missing in both manual installs.
- Promoted seed: install-check case (seed-recorded customised `prd-template.md` → dry-run `conflict`, `--apply`
  leaves it; unchanged `hld-template.md` → recorded `managed`). Mutation check: disabling the sync rule makes
  the case fail with 4 problems.
- Checks: `leak-check` (3 runs), `pack-check`, `install-check`, `e2e-check` all ok (final lines in the PR body).
- Tag + release `v1.1.0`, FoodVibe sync, `ng build`, kit-owned check: replaced by `v1.2.0` — after merge
  point 1 (plan 006 A6 / A7).
- `[human]` R8 checks: after merge point 2 (plan 006 A9).

### FoodVibe dry-run (read-only, local source = the slot)
`node tools/sync.mjs --target ../foodVibe1.0 --source .` →
`KIT_SYNC: dry-run — 1 new, 15 kit-update, 2 conflicts, 26 local-only, 0 deleted-locally, 0 removed-from-kit, 20 overrides`.
- **2 conflicts, exactly the expected ones:** `.claude/references/hld-template.md`, `.claude/references/prd-template.md`.
  (Before the sync fix they showed as `kit-update` and Apply would have overwritten them.) For A7, as R6/R7 say:
  move FoodVibe's own template lines (the `log-query` `[auto]` line, "Hebrew canonical values" Technical
  Considerations line, Hebrew / dictionary UI notes, "As a chef" story, Signal data-flow and dictionary
  translation-keys HLD lines) into `docs/agent/plan-checks.md`, set `paths.planChecks`, then take the kit
  version of both templates and re-run sync (`same`).
- Plan 002's own kit-updates in FoodVibe: `.claude/commands/plan.md`, `feat.md`, `brief-detection`, `save-plan`, `.cursor/commands/plan.md`, `README_WORKFLOW.md`. No CI, hook or dev-server
  file changes from this plan (the other kit-updates are 1.0.2 → 1.0.5 changes already released).
