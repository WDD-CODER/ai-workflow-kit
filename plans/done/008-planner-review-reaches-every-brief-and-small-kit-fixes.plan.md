# Plan 008 — Planner Review Reaches Every Brief, and Small Kit Fixes

Status: done
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
# approved: layers/cursor/.cursor/rules/brief-detection-must-use-skill.mdc — Planner, under Dandan's "merge it", 2026-10-19
layers/cursor/.cursor/rules/brief-detection-must-use-skill.mdc
# approved: core/docs/agent/workflow-map.md — Planner, under Dandan's "merge it", 2026-10-19
core/docs/agent/workflow-map.md
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
- [x] P0: Check the prerequisites, find why plan-name-similarity missed the existing plans, and confirm each gap — Step 0 — this plan file
- [x] P1: Let a prose feature request reach the review — prose rule, gate text, option a runs the review, option b hands to /plan and a slot; fixture check — `core/.claude/skills/brief-detection/SKILL.md`, `core/.claude/commands/plan.md`, `.cursor` copies in `layers/cursor/**` if they exist, `tools/**`
- [x] P2: Make /plan, the PRD template and save-plan describe one plan shape — milestones vs sub-tasks, Verify, Execution Notes section, the Q&A reference — `core/.claude/commands/plan.md`, `core/.claude/references/prd-template.md`, `core/.claude/skills/save-plan/SKILL.md`
- [x] P3: Show what the review fixed, and check overlap with other plans every time — output block, overlap step, plan-name-similarity fix — `core/.claude/commands/plan.md`, `core/scripts/plan-name-similarity.mjs`, `tools/**`
- [x] P4: Accept an absolute folder in the PowerShell wrappers — three .ps1 files, install-check case — `kit-sync.ps1`, `kit-install.ps1`, `kit-drift.ps1`, `tools/install-check.mjs`
- [x] P5: Make the project end-to-end check explain missing dependencies and env files — pre-flight, env-file handling, messages — `tools/e2e-check.mjs`
- [x] P6: Stop the link check failing on gitignored runtime files — runtime state, fixture — `tools/workflow-link-check.mjs`, `tools/lib/**`
- [ ] P7: Document and release v1.3.1 — CHANGELOG, README, checks, kit PR, independent review, merge after Dandan's review, tag after his go — kit repo
- [ ] S1: Sync FoodVibe to v1.3.1 — dry-run, Apply, checks, /ship — `../foodVibe1.0` slot
- [ ] S2: Sync agentdesk to v1.3.1 — dry-run, Apply, checks, /ship — `../agentdesk` slot

## Out of Scope
- FoodVibe's `paths.hotspots` missing `dictionary.json` (FoodVibe's own `kit.config.json`; its `plan-checks.md` already names it). Fix in FoodVibe when next touched.
- FoodVibe invariant INV-1 naming `server/utils/can-write.js`, which does not exist (FoodVibe doc).
- The last two FoodVibe angular overrides (translation line): waiting on Dandan's choice.

## Execution Notes

Run by a Worker in the kit slot `ai-workflow-kit-wt-1`, branch `feat/008-planner-review-entry` from `origin/main`
`543e56e`. P0–P6 done; P7's kit part done (CHANGELOG `[1.3.1]` dated 2026-10-19, `kit.json` 1.3.1, README, checks,
PR). P7's merge/tag and S1/S2 wait for Dandan.

### P0 — Reality check
- Kit `main` = `543e56e` (after Snapshot `76a46e5`). FoodVibe `a426f19a` and agentdesk `8efb192de` record
  `github:WDD-CODER/ai-workflow-kit@v1.3.0`. Every instruction gap in the Problem Statement was still in `core/`
  (brief-detection §2/§3, plan.md lines 27–36 and 67–83, prd-template.md line 97, no `## Execution Notes`).
- **Why plan-name-similarity missed the A9 cases** (FoodVibe copy: `plans/` 422 plan files + `.claude/todo-archive`,
  FoodVibe's own script, identical to the kit's): the scan scope was fine (it recurses into the range folders). It
  compares **titles only, word for word, at score ≥ 0.8 with ≥ 2 shared words**:
  - "favourite recipes filter" → `PLAN_SIMILARITY: no similar plans`. Plan 263 is titled "Favorites Button on
    Recipe-Book List": `favourite`≠`favorites`, `recipes`≠`recipe`, `filter` only in its body → 0 shared words.
  - "export ingredient list as shopping list" → `no similar plans`. The export plans (077 "Excel Export Feature",
    093, 099, 100) share at most 2 of 5 title words (`list`, `shopping`: score 0.4 < 0.8; `as` was not a stop word);
    "shopping list export" is in their bodies.
- Slot setup (`worktree-setup` §2.4): the only gitignored file copied into a slot is `<paths.serverRoot>.env`
  (FoodVibe `server/.env`, ignored by `.gitignore:81`). `environment.local.ts` is tracked in FoodVibe.
- Baseline `e2e-check --project ../foodVibe1.0` (v1.3.0 tools): `E2E_CHECK: FAIL — 2 of 40 cases failed`, both
  slot-serve (`"msg":"no db connection"`: no `server/.env` in the scratch slot). The A9 link-check fail is gone since
  FoodVibe PR #426.

### Decisions
- **brief-detection (P1):** the prose rule applies in the main folder only (a Worker's messages are about its plan;
  gating them would fire on most Worker messages). Three tests: asks to build/add/change/fix/remove something; longer
  than one sentence; no closing `?`. An explicit never-list (question, slash command, `execute plan NNN`,
  run/check/explain/review request, an answer, any message in a slot) and "when unsure, do not gate". Five example rows
  (2 feature, 3 none), generic wording. Gate text, as designed:
  `Looks like a feature request: {one-line goal}.` / `a. refine it with a review (default) · b. /plan it · c. just discuss`.
  The structured-brief gate keeps its header with the same three choices. Option a = `/plan`'s review on the brief,
  block printed, `open:` questions asked, nothing saved, then offer b. Option b = `/plan` → save-plan → a Worker claims
  it with `take-plan`; in a slot it adds tasks to the slot's own plan (mid-flight sync) or says it needs a plan.
- **One plan shape (P2):** dropped "numbered milestones and a Verify command per milestone" from `/plan`; the PRD
  template's Atomic Sub-tasks are the milestones and each `[auto]` criterion names its check. Why: FoodVibe's 13
  plans numbered 4xx all use `## Atomic Sub-tasks`, none has a `Verify:` line, and save-plan / take-plan / the ledger
  parse sub-tasks; a new field would leave every existing plan non-conforming. Template: `## Execution Notes` added;
  `## Critical Questions` now states its own `- Q: … A: …` format (the form FoodVibe plans 403/405/406 already use).
- **Review output (P3):** `fixed: <gap> → <what you changed>` / `open: <gap> — <question for the Human>`;
  `no gaps` only when both are empty. A received plan gets only mechanical `fixed:` lines.
- **Overlap (P3):** one command, `plan-name-similarity --name=… --related --scope=…`. Stems (`-our`→`-or`, plurals,
  `-ing`/`-ed`, doubled consonant, final `e`) on both sides; `--related` scores plan text by inverse document frequency
  (rare words decide; coverage ≥ 0.75, ≥ 2 shared words) and prints the 5 closest; `--scope` (or `--file`'s scope
  block) matches open plans' scope globs (dependency-free glob compare). Without the new flags the output lines are
  unchanged, so `plan-write-guard.sh` (greps `no similar plans`) and save-plan behave as before, except that titles
  now match by stem. The scope search covers draft and active open plans (`scope-check --overlap` stays active-only).
- **Wrappers (P4):** `Resolve-KitPath` in all three (`IsPathRooted` → `GetFullPath`, else `Join-Path`); files stay ASCII.
- **e2e (P5):** copy `<paths.serverRoot>.env` into the scratch slots (what a real slot gets); `SKIP` the slot-serve
  cases only when that file is absent in the source. Pre-flight stops when `node_modules` is missing or lacks more than
  half of the declared packages; fewer missing is a NOTE (FoodVibe's main folder lacks `html2canvas`,
  `html2canvas-pro` and still passes 40/40). The agentdesk main folder has a broken `node_modules` (26 entries; 102 of
  104 declared packages missing): that is why the first A9 run there failed on `vite`. Acceptance fixtures (no network
  installs) get a stub folder per declared package before their e2e run.
- **Link check (P6):** `git check-ignore` via the existing `ignoredPaths` helper; `runtime` lines on `--target`;
  `linkProblems()` unchanged for its callers (install-check, acceptance-check, adoption-report). The fixture uses
  `.claude/tunnel-state.json` (the kit's `.gitignore` skeleton already ignores `*.log`).
- **Not changed (a render change outside the allowed Planner files — STOP, for Dandan):**
  `layers/cursor/.cursor/rules/brief-detection-must-use-skill.mdc` (description and body still say "3+ H2 markers", so
  Cursor would not load the skill for a prose request) and `core/docs/agent/workflow-map.md` lines 87 and 311 (trigger
  "3+ structured H2 markers", "routes to `/feat` (option b) or discussion"). Wording-only fixes, proposed in the PR.
  → Approved by the Planner under Dandan's "merge it" (paths appended to the scope block): both now name the prose rule
  and the a/b/c routes (b = `/plan` → save-plan → `take-plan`); install-check fails on the old "3+ H2" / "option b →
  /feat" wording (it matched both old files). FoodVibe overrides `docs/agent/workflow-map.md` ("FoodVibe map with its
  own plan history"), so its lines 103 and 324 keep the old wording: fix them by hand in S1. agentdesk has no Cursor
  layer, so the `.mdc` does not reach it.
  Dry-runs after: FoodVibe `KIT_SYNC: dry-run — 0 new, 6 kit-update, 0 conflicts, 26 local-only, 0 deleted-locally, 0
  removed-from-kit, 17 overrides` (+ `.cursor/rules/brief-detection-must-use-skill.mdc`); agentdesk `KIT_SYNC: dry-run
  — 0 new, 6 kit-update, 0 conflicts, 9 local-only, 0 deleted-locally, 0 removed-from-kit, 8 overrides`
  (+ `docs/agent/workflow-map.md`).

### Evidence
- FoodVibe copy, new script: `--name="favourite recipes filter" --related` → `PLAN_RELATED: 12 plan(s) … (the 5
  closest below)`, first `plans/200-300/263-favorites-recipe-book.plan.md (closed)` (`text has favorit, recip,
  filter (coverage 1)`); `--name="export ingredient list as shopping list" --related` → `PLAN_RELATED: 13 plan(s)`,
  top 5 = 102, 120, 108, 077, 100 (077 "Excel Export Feature" overview: "… shopping list by category …").
  `--scope="…,server/**,…"` lists open plans 407, 412 and design 372/373 (`server/** ~ server/routes/generic.js`, …).
- install-check against the pre-fix Planner files, similarity script and wrappers (scratch clone, new tools) →
  `INSTALL_CHECK: FAIL — 92 problems` (every new Planner-doc check, the four similarity cases, the three wrappers with
  `NotSupportedException`).
- Link check on FoodVibe at `77550e79` (before PR #426): v1.3.0 tool `docs/agent/remote-port.md:21: path
  .claude/remote.log does not exist` / `WORKFLOW_LINK_CHECK: FAIL — 1 missing`; this branch `runtime
  docs/agent/remote-port.md:21: .claude/remote.log is gitignored (written at run time)` / `WORKFLOW_LINK_CHECK: ok —
  0 missing, 1 runtime (gitignored)`.
- `e2e-check --project ../foodVibe1.0`: `E2E: copying server/.env … into the scratch slots` → `E2E_CHECK: ok — 40
  cases passed` (was 38/40). `--project ../agentdesk-wt-1`: `E2E_CHECK: ok — 44 cases passed`. `--project ../agentdesk`
  (main folder): `FAIL dependencies installed in …\agentdesk — install dependencies in …\agentdesk first (npm ci): …
  102 of 104 declared packages missing` (stops before cloning). A clone without `node_modules`: `.` and `scripts`
  both named, `E2E_CHECK: FAIL — 2 of 2 cases failed`, nothing cloned.
- Sync dry-runs, this branch as source (nothing written): FoodVibe `KIT_SYNC: dry-run — 0 new, 5 kit-update, 0
  conflicts, 26 local-only, 0 deleted-locally, 0 removed-from-kit, 17 overrides`; agentdesk `KIT_SYNC: dry-run — 0 new,
  5 kit-update, 0 conflicts, 9 local-only, 0 deleted-locally, 0 removed-from-kit, 8 overrides`. The 5 rows in both:
  `.claude/commands/plan.md`, `.claude/references/prd-template.md`, `.claude/skills/brief-detection/SKILL.md`,
  `.claude/skills/save-plan/SKILL.md`, `scripts/plan-name-similarity.mjs`.
- Final checks (local, Windows): `LEAK_CHECK: ok — 161 files, 0 leaks` / `47 files, 0 leaks` / `3 files, 0 leaks`;
  `PACK_CHECK: ok — 3 packs, 2 layers, 8 contract keys used by core (each provided), 0 problems`;
  `INSTALL_CHECK: ok — 5 fixtures, actionlint not installed (skipped), …, Planner docs, plan-name-similarity (stems,
  --related, --scope), PowerShell wrappers (relative + absolute paths), …, 0 problems`; `E2E_CHECK: ok — 42 cases
  passed`; `WORKFLOW_LINK_CHECK: ok — 8 fixtures (…, a gitignored runtime path), 0 missing`;
  `ACCEPTANCE_CHECK: ok — 122 checks passed (angular, react-vite, upstream-owned, e2e --project)`.

### PR #29 review fixes
Independent review at `0fe761f`: no high findings. Fixed on the same branch:
1. (medium) **Wrappers, trailing slash:** `-Target 'foodVibe1.0\'` made the quoted argument end in `\"`, so the
   arguments after it were swallowed. Old wrapper (`cc53018`), dry-run: `kit-sync target: C:\coding
   projects\Cursor\foodVibe1.0\` / `KIT_SYNC: FAIL — unexpected argument: projects\Cursor\ai-workflow-kit-wt-1`. New
   `Resolve-KitPath`: `GetUnresolvedProviderPathFromPSPath` (PowerShell's own resolution: relative, absolute,
   drive-relative `C:name`, root-relative `\name`, low 8), then `GetFullPath`, then `TrimEnd('\','/')` unless it is a
   drive root. Same command now: `kit-sync target: C:\coding projects\Cursor\foodVibe1.0` / `KIT_SYNC: dry-run — 0 new,
   6 kit-update, …`. install-check (Windows): install with an absolute target + trailing slash in a folder with a space,
   drift with relative / relative + trailing slash / absolute / drive-relative / root-relative targets (each must print
   the resolved folder), sync dry-run, and `-Target <folder>\ -Apply` must reach `KIT_SYNC: applied`.
2. (medium) **`--scope` with a bare folder** gave `none`. A path without a glob now counts as `x` and `x/**`; glob pairs
   meet only when a sample path built from either side's literal folder and file pattern matches both (low 11):
   `*.md` meets only top-level Markdown files, `src/app/*.ts` does not meet `src/app/items/**`. install-check cases vs
   `src/app/items/**`: overlap for `src/app/items/badge.ts`, `src/app/items`, `src/app/items/`, `src/**`; none for
   `src/app/*.ts`, `*.md`, `server/routes/x.js`, `src/app/items-old/**`.
3. (medium) **Option a on a brief:** `/plan` gains "On a brief": check codebase facts, Human decisions, testability and
   overlap only; plan sections are not gaps until `/plan`; no `fixed:` lines. brief-detection's option a row points at it.
4. (medium) **Overlap noise:** a listed plan stays an `open:` line only when it may be the same work or shares a file;
   the rest go on one `checked: <plan numbers>` line (added to the output block; `no gaps` may keep a `checked:` line).
5. (medium) **Default output restored:** rebuilt from the v1.3.0 file; stemming only with `--stem` or `--related`; the
   scope search only with `--scope` (a bare `--scope` with `--file` reads that plan's block). FoodVibe copy, old vs new,
   no flags, text and `--json`: identical for "Recipes list", "favourite recipes filter", "export ingredient list as
   shopping list", "Favorites button", "one soft delete model", "dropdown add option", and `--file=plans/407-…`.
   install-check compares the default output on a fixture with the text v1.3.0 prints there (3 queries) and checks
   `--file` alone prints no `PLAN_SCOPE_OVERLAP` / `PLAN_RELATED`. `/plan`'s command (`--related --scope=…`) is
   unchanged; `--related` implies `--stem`.
6. (low) **Prose gate exceptions:** a request phrased as a question ("Can you add …? …") is a question: answer it and
   offer the gate in one line if it is a change request. A small change (one file, a typo, a one-line fix) gets no
   gate; in the main folder say in one line that code changes are made in a slot (`/feat` or a plan). Two example rows
   added; install-check accepts `none (…)` rows and checks both rules.
7. (low) **"Before any tool call" vs `git branch`:** the gate now runs "before any other tool call"; the main-folder test
   reads the SessionStart line (`IDLE SLOT` / `WORKER` = a slot) or runs `git branch --show-current`, the one read-only
   call allowed before the gate.
9. (low) **e2e env copies:** copied only when `git check-ignore` reports the file ignored; every copy is deleted when the
   run ends (exit handler), on SIGINT/SIGTERM/SIGHUP/SIGBREAK (the message says the secrets were deleted), and before a
   scratch folder is kept (`--keep`, or a junction that could not be removed), with a line saying it held them.
13. (low) `\u2014\u2013` and `\u0590-\u05ff` escapes are back (the file is rebuilt from v1.3.0); README
   `--target ..my-app` → `--target ..\my-app`.
- Skipped: 10 (workspace false positive), as agreed — not changed.

Evidence after the fixes (local, Windows): `LEAK_CHECK: ok — 161 files, 0 leaks` / `47 files, 0 leaks` / `3 files, 0
leaks`; `PACK_CHECK: ok — 3 packs, 2 layers, 8 contract keys used by core (each provided), 0 problems`;
`INSTALL_CHECK: ok — 5 fixtures, …, Planner docs, plan-name-similarity (default = v1.3.0, --stem, --related, --scope),
PowerShell wrappers (relative, absolute, trailing slash, drive- and root-relative), …, 0 problems`;
`WORKFLOW_LINK_CHECK: ok — 8 fixtures (…), 0 missing`; `E2E_CHECK: ok — 42 cases passed`; `ACCEPTANCE_CHECK: ok — 122
checks passed (angular, react-vite, upstream-owned, e2e --project)`; `e2e-check --project ../foodVibe1.0` → `E2E:
copying server/.env … ; the copies are deleted when the run ends.` / `E2E_CHECK: ok — 40 cases passed`;
`--project ../agentdesk-wt-1` → `E2E_CHECK: ok — 44 cases passed`. Sync dry-runs unchanged: FoodVibe `KIT_SYNC: dry-run —
0 new, 6 kit-update, 0 conflicts, 26 local-only, 0 deleted-locally, 0 removed-from-kit, 17 overrides`; agentdesk
`KIT_SYNC: dry-run — 0 new, 6 kit-update, 0 conflicts, 9 local-only, 0 deleted-locally, 0 removed-from-kit, 8 overrides`.
