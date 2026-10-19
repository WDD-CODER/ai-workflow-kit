# Plan 008 — Planner Review Reaches Every Brief, and Small Kit Fixes

Status: draft
Snapshot: 76a46e5

## Problem Statement
Plan 006 A9 checked plan 002's Planner review by having an agent follow FoodVibe's rendered instructions (notes in `plans/done/006-*`, A9). The review works on `/plan`, but the path into it and the files around it have gaps:
1. **A prose brief never reaches the review.** `core/.claude/skills/brief-detection/SKILL.md` §2 counts H2 markers only; a pasted feature request with no headers scores 0 → "not a brief" → no gate, no `/plan`, no review, and nothing says what to do instead.
2. **The default gate choice skips the review.** Option **a** ("Refine first", the default) means "do not trigger `/plan`", so the review never runs while the brief is being refined, which is when its gaps matter most.
3. **Option b contradicts the Planner role.** It says "execute **one milestone**", but the Planner on `main` never executes (`core/.claude/commands/plan.md` §Protocol, `save-plan` SKILL, `AGENTS.md`); execution is a Worker in a slot.
4. **`/plan` and the PRD template disagree.** `plan.md:35-36` asks for "numbered milestones and a Verify command per milestone"; `core/.claude/references/prd-template.md` has Atomic Sub-tasks and no Verify field.
5. **Dead reference and missing section in the PRD template.** `prd-template.md:97` points at a "Q&A format per the `brief-detection` skill" that the skill does not define; `plan.md:83` writes rejected gaps under `## Execution Notes`, which the template does not have.
6. **Self-review output is unclear.** `plan.md:28` says fix every gap before showing the plan; the output block (`plan.md:67-79`) then prints `no gaps`, hiding what the review changed.
7. **Overlap with open plans is not part of the review.** It is checked only at protocol step 3 for parallel plans. In the A9 check, both test ideas already existed in closed plans and `plan-name-similarity` reported "no similar plans" (cause not yet known: the script does recurse into `plans/`).

Plus three small kit fixes found during plans 007 and 006 A9:
8. **`kit-sync.ps1`, `kit-install.ps1`, `kit-drift.ps1` fail on an absolute `-Target`** (`Join-Path (Get-Location) $Target` makes `C:\x\C:\y`).
9. **`e2e-check --project` fails for environment reasons and reads like a kit bug.** A source folder with no `node_modules` gives "'vite' is not recognized"; a project whose backend needs a gitignored `server/.env` gives "no db connection" in the scratch clone.
10. **`workflow-link-check` fails on a gitignored runtime path** named in a doc (FoodVibe's `.claude/remote.log`; fixed in FoodVibe PR #426, but any project can hit it).

## Prerequisites
- None. FoodVibe PR #426 (the doc-side fix for 10) can merge independently.

## Goals & Success Criteria
- [auto] brief-detection: a prose feature request (no H2 headers, asks for a change) gets a short gate offering `/plan` with the review; a question or chat gets no gate. Fixture messages for both in a check.
- [auto] Option **a** runs the Architect + PM review on the brief as part of refining (review block printed, no plan saved); option **b** hands to `/plan` → save-plan → "claim it in a slot with `take-plan`"; no Planner wording says "execute".
- [auto] `/plan` output, the PRD template and save-plan agree on one shape (Atomic Sub-tasks + Done-when tags; a Verify line only if the template has a field for it). The template has `## Execution Notes`; the dead Q&A reference points at a real section or is removed.
- [auto] The review output lists each gap it found and what it changed ("fixed: …"), even on a self-written draft; `no gaps` only when there were none.
- [auto] The review always runs the overlap check: `plan-name-similarity` over open and closed plans plus a search of open plans' scope blocks for the same files. The A9 cases (a favourites filter; a shopping-list export) report the existing plans when run against a FoodVibe copy.
- [auto] The three `.ps1` wrappers accept relative and absolute `-Target`/`-Config` under PowerShell 5 (install-check case).
- [auto] `e2e-check --project`: a source without `node_modules` stops before the scratch clone with "install dependencies in <path> first"; gitignored env files the slot setup copies into real slots are handled the same way in the scratch clone (or the backend start is reported `SKIP` with the reason). FoodVibe main folder → 40/40 or only `SKIP`s; agentdesk main folder after `npm ci` → 44/44.
- [auto] `workflow-link-check` reports a path matched by the project's `.gitignore` as `runtime` (not missing); a fixture covers it.
- [auto] All kit checks pass; CHANGELOG `[1.3.1]` (patch: wording, checks, wrappers; nothing a project must do), tag + release after Dandan's go; FoodVibe and agentdesk synced to it (0 conflicts expected).
- [human] Dandan pastes one prose brief into the FoodVibe Planner after the sync and sees the gate, then the review.

## Execution Mode
- **Parallel:** no. One kit branch `feat/008-planner-review-entry` from a kit `wt-N` slot; project syncs from each project's slot.
- **Concurrent plans:** none.
- **Isolated DB:** no.
- **Kit edits:** kit PR, independent review, Dandan merges; tag after Dandan's go.

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`.

```scope
core/**
packs/**
layers/**
templates/**
tools/**
kit-sync.ps1
kit-install.ps1
kit-drift.ps1
docs/**
CHANGELOG.md
kit.json
README.md
.github/workflows/**
```

**Outside this repo:** the two project syncs (S1, S2), each on a branch in that project's `wt-N` slot: `.kit/**`, `kit.config.json`, the kit-managed files `kit-sync -Apply` writes, and (FoodVibe) `docs/workflow-kit/**` if the manifest needs a new entry. Kit GitHub repo: PR, tag, release.

## Read Scope
Kit repo; FoodVibe and agentdesk repos (rendered Planner files, plans folders for the overlap fixtures, slot setup scripts).

## Escalation Protocol
Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append the path to the scope block and retry. A change that alters a project's rendered file beyond the Planner files and the three tools: STOP and ask. Project sync `conflict` rows: STOP, never `--force`. Tags and releases: wait for Dandan's go.

## Architecture Impact
- INV-none: preserves — kit instruction files, templates and tools; projects get them through `kit-sync`. No app, server or schema file.

## Step 0 — Reality Check
- Kit `main` at or after the Snapshot; FoodVibe and agentdesk on v1.3.0.
- Reproduce item 7: run `plan-name-similarity` in a FoodVibe copy with "favourite recipes filter" and "export ingredient list as shopping list"; record why the existing plans (FoodVibe plan 263 and the export work) were missed (title wording, score threshold, or scan scope) before changing it.
- Read the slot setup (`take-plan` / `worktree-setup`) for which gitignored files it copies into a slot, so e2e can reuse that list.
- Re-read the A9 notes; confirm each instruction gap still exists in `core/` (line numbers above are from the FoodVibe render).

## Design
- **brief-detection:** keep the H2 count for structured briefs; add a "change request in prose" rule (imperative ask for a feature/fix, more than one sentence, no question mark at the end) → one-line gate: `Looks like a feature request. a. refine it with a review (default) · b. /plan it · c. just discuss`. Option a = run the review on the brief, show gaps, ask; nothing saved. Option b = `/plan` (which reviews) → save-plan → hand-off to a slot.
- **One plan shape:** the PRD template's Atomic Sub-tasks are the milestones; drop "Verify command per milestone" from `/plan` or add a `Verify:` field to each sub-task in the template (Step 0 picks the one that fits existing plans; record why).
- **Review output:** `ARCHITECT + PM REVIEW` lists `fixed: <gap> → <change>` lines and `open: <gap> — <question>` lines; `no gaps` only when both lists are empty.
- **Overlap check in the review:** run `plan-name-similarity` (fixed per Step 0) and grep open plans' `scope` blocks for the files the draft names; any hit is an `open:` line.
- **Wrappers:** `if ([System.IO.Path]::IsPathRooted($Target)) { $Target } else { Join-Path … }` in all three.
- **e2e `--project`:** pre-flight checks before cloning; env files per Step 0.
- **link check:** load the target's `.gitignore` (the kit's own glob subset, or `git check-ignore` when the target is a repo); matched paths are `runtime`, counted but not failing.

## Atomic Sub-tasks
- [ ] P0: Check the prerequisites, find why plan-name-similarity missed the existing plans, and confirm each gap — Step 0 — this plan file
- [ ] P1: Let a prose feature request reach the review — prose rule, gate text, option a runs the review, option b hands to /plan and a slot; fixture check — `core/.claude/skills/brief-detection/SKILL.md`, `core/.claude/commands/plan.md`, `.cursor` copies in `layers/cursor/**` if they exist, `tools/**`
- [ ] P2: Make /plan, the PRD template and save-plan describe one plan shape — milestones vs sub-tasks, Verify, Execution Notes section, the Q&A reference — `core/.claude/commands/plan.md`, `core/.claude/references/prd-template.md`, `core/.claude/skills/save-plan/SKILL.md`
- [ ] P3: Show what the review fixed, and check overlap with other plans every time — output block, overlap step, plan-name-similarity fix — `core/.claude/commands/plan.md`, `core/scripts/plan-name-similarity.mjs`, `tools/**`
- [ ] P4: Accept an absolute folder in the PowerShell wrappers — three .ps1 files, install-check case — `kit-sync.ps1`, `kit-install.ps1`, `kit-drift.ps1`, `tools/install-check.mjs`
- [ ] P5: Make the project end-to-end check explain missing dependencies and env files — pre-flight, env-file handling, messages — `tools/e2e-check.mjs`
- [ ] P6: Stop the link check failing on gitignored runtime files — runtime state, fixture — `tools/workflow-link-check.mjs`, `tools/lib/**`
- [ ] P7: Document and release v1.3.1 — CHANGELOG, README, checks, kit PR, independent review, merge after Dandan's review, tag after his go — kit repo
- [ ] S1: Sync FoodVibe to v1.3.1 — dry-run, Apply, checks, /ship — `../foodVibe1.0` slot
- [ ] S2: Sync agentdesk to v1.3.1 — dry-run, Apply, checks, /ship — `../agentdesk` slot

## Out of Scope
- FoodVibe's `paths.hotspots` missing `dictionary.json` (FoodVibe's own `kit.config.json`; its `plan-checks.md` already names it). Fix in FoodVibe when next touched.
- FoodVibe invariant INV-1 naming `server/utils/can-write.js`, which does not exist (FoodVibe doc).
- The last two FoodVibe angular overrides (translation line): waiting on Dandan's choice.

## Execution Notes
