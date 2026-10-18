# Plan 002 — Planner Always Runs the Architect and Product Manager Review

Status: draft
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
- [ ] R0: Check the plan still matches the kit and list every place that says who plans — Step 0 reality check + grep list — `plans/002-planner-always-runs-architect-and-product-manager-review.plan.md`
- [ ] R1: Make the Planner run an architect and product review on every plan before saving — new review section, role line, Planner protocol first step, Cursor mirror — `core/.claude/commands/plan.md`, `layers/cursor/.cursor/commands/plan.md`
- [ ] R2: Ship the plan and design templates in the kit so every project has them — generic prd and hld templates, HLD alternatives replaced by why-this-design — `core/.claude/references/{prd,hld}-template.md`
- [ ] R3: Let each project add its own planning checks without forking the command — paths.planChecks config key, scaffold, parameters doc — `kit.config.json`, `templates/**`, `docs/**`
- [ ] R4: Describe the current roles instead of the old three-agent setup — workflow-map roles, README_WORKFLOW title and intro, skills.md note — `core/docs/agent/workflow-map.md`, `core/README_WORKFLOW.md`, `core/.claude/commands/skills.md`
- [ ] R5: Run the kit checks, open the kit PR and release v1.1.0 — leak-check, pack-check, install-check; CHANGELOG; tag after Dandan's go — kit repo
- [ ] R6: Move FoodVibe's own planning checks into a project file before syncing — Hebrew values, Entity contract, icons, RTL, Zod; kit.config paths.planChecks — `../foodVibe1.0/docs/agent/plan-checks.md`, `../foodVibe1.0/kit.config.json`
- [ ] R7: Sync FoodVibe to v1.1.0 and ship it — dry-run, take kit templates, Apply, ng build, kit-owned check, /ship — `../foodVibe1.0/.kit/install.json` + files kit-sync writes
- [ ] R8: Try the review on a pasted brief and on a new idea in the Planner — Dandan's two checks from Goals — Planner session

## Out of Scope
Restoring agent persona files; forced alternative designs; the React-Vite hand-off work (001, 003–005).
