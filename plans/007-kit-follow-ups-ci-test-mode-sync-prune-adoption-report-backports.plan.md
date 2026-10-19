# Plan 007 — Kit Follow-ups: CI Test Mode, Sync Prune, Adoption-Report Fix, FoodVibe Backports

Status: draft
Snapshot: d83bae1

## Problem Statement
The v1.2.0 syncs into FoodVibe (PR #424) and agentdesk (PR #11) left four gaps:
1. **CI test job can't be turned off.** `core/.github/workflows/ci.yml` always runs `npm run {{commands.test}}`. A project with no unit tests (agentdesk: `package.json` is upstream's, no `test` script, full-repo lint has ~6,000 upstream errors) can't pass that job, so agentdesk keeps `ci.yml` as an override and drifts from every later CI fix.
2. **Sync never removes stale records.** `tools/sync.mjs` reports `removed-from-kit` ("kept, delete by hand") but keeps the record in `.kit/install.json` forever. agentdesk deleted `.prettierrc.json` by hand and still shows `1 removed-from-kit` on every dry-run.
3. **adoption-report prints the wrong frontend command.** The `frontend dev server` row builds `npm run <commands.dev> -- <fePortArgs>` and ignores `slots.feExec`. For the angular pack the real command (`frontendArgs()` in `core/scripts/lib/slot-procs.mjs`) is `npm exec -- ng serve -c slot --port <port>`. Display only.
4. **FoodVibe overrides that a kit parameter could retire.** PR #424 lists 5 overrides that differ from the v1.2.0 render by only 1–3 lines of project wording:
   - `.claude/skills/cssLayer/SKILL.md` (1 line: "The UI is Hebrew RTL")
   - `docs/agent/standards-angular.md` (1 line: the domain-logic line)
   - `.claude/skills/angularComponentStructure/evals/evals.json` (2 lines)
   - `.claude/commands/review-it.md` (the log-query step and its table row)
   - `.claude/skills/angularComponentStructure/SKILL.md` (3 lines: Lucide, `app.config.ts`, Hebrew)

Release the fixes as **v1.3.0** (minor: new optional config keys, nothing a project must do), then sync both projects and drop the overrides the release covers.

## Prerequisites
- agentdesk PR #11 merged (agentdesk on v1.2.0 with its 8 overrides).
- FoodVibe on v1.2.0 (PR #424, merged `ccf06865`).

## Goals & Success Criteria
- [auto] `ci.testMode` (`run` default | `if-present` | `skip`): `run` renders today's job byte-identical; `if-present` renders `npm run --if-present {{commands.test}}`; `skip` renders no `test` job and nothing `needs: test`. actionlint passes on all three renders.
- [auto] `kit-sync --apply`: a `removed-from-kit` record whose file is already gone is dropped from `.kit/install.json` with no flag. With `--prune`: a managed file unchanged since install (hash equals the record) is deleted and its record dropped; an edited managed file or any seed is kept on disk and only its record is dropped (it then shows as `local-only`). Without `--prune` nothing on disk is deleted. Dry-run prints what `--prune` would do.
- [auto] adoption-report's frontend row prints the same command `frontendArgs()` builds: on the Angular fixture `npm exec -- ng serve -c slot --port {port}`, on the React-Vite fixture `npm run dev -- <fePortArgs>`. The row reuses one shared function, not a second copy of the logic.
- [auto] Each FoodVibe backport candidate is either parameterised (FoodVibe's render with its config becomes byte-identical to its override, so the override can be dropped) or recorded in Execution Notes as "stays an override" with the reason. Other projects' renders are unchanged unless the new key is set.
- [auto] `install-check`, `pack-check`, `e2e-check`, `workflow-link-check`, `acceptance-check --e2e`, `leak-check` all pass; CHANGELOG `[1.3.0]` lists the new keys and which overrides they let a project drop.
- [auto] Tag + GitHub release `v1.3.0` after Dandan's go.
- [auto] FoodVibe `kit-sync -Ref v1.3.0 -Apply`: 0 unresolved `conflict`; `npx ng build`, `node scripts/kit-owned.mjs --check`, `node scripts/kit-manifest-check.mjs`, drift-check pass; `overrides` shorter by every candidate the release covers.
- [auto] agentdesk `kit-sync -Ref v1.3.0 -Apply --prune` with `ci.testMode` set: `ci.yml` override dropped, `0 removed-from-kit`, CI green on the sync PR.
- [human] Dandan merges the kit PR, gives the tag go, and merges both project sync PRs.

## Execution Mode
- **Parallel:** no. One kit branch `feat/007-kit-follow-ups` from a kit `wt-N` slot; project syncs from each project's `wt-N` slot.
- **Concurrent plans:** none.
- **Isolated DB:** no.
- **Kit edits:** kit PR; Dandan merges; tag after Dandan's go.

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`.

```scope
core/**
packs/**
layers/**
tools/**
kit.config.json
kit.json
kit-sync.ps1
docs/**
CHANGELOG.md
README.md
.github/workflows/**
```

**Outside this repo:** the two project syncs (C7, C8), each on a branch in that project's `wt-N` slot: `.kit/**`, `kit.config.json`, and the kit-managed files `kit-sync -Apply` writes or `--prune` deletes. FoodVibe also: `docs/workflow-kit/**` (manifest + `kit-owned.json` regeneration). Kit GitHub repo: PR, tag, release.

## Read Scope
Kit repo; FoodVibe and agentdesk repos (their overrides, `kit.config.json`, `.kit/install.json`, CI runs).

## Escalation Protocol
Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append the path to the scope block and retry. Project sync `conflict` rows: STOP and show them, never `--force`. A backport that would change the render for a project that doesn't set the new key: STOP and ask. Tags and releases: wait for Dandan's go.

## Architecture Impact
- INV-none: preserves — kit templates, tools and config keys; projects get them only through `kit-sync`. No app, server or schema file.

## Step 0 — Reality Check
- Kit `main` clean at or after the Snapshot; agentdesk PR #11 merged; both projects' `.kit/install.json` on `v1.2.0`.
- Render each FoodVibe backport candidate with FoodVibe's config and diff it against FoodVibe's override; write the exact differing lines into Execution Notes before choosing keys.
- Check how `KIT:if key=value` handles a key with a default (`tools/lib/kit.mjs`), so `ci.testMode` can default to `run` in `kit.config.json`.

## Design
- **`ci.testMode`** in kit defaults (`"run"`). `ci.yml`: `# KIT:if ci.testMode=skip` drops the job; the run line is `npm run {{commands.test}}` or `npm run --if-present {{commands.test}}`. install/sync refuse any other value (exit 2, `commandProblems`), same as other enums. The `upstream-owned` layer does **not** change the default: a project chooses it.
- **Sync prune** in `tools/sync.mjs`: auto-drop records of `removed-from-kit` files that are missing; `--prune` (`kit-sync.ps1 -Prune`) deletes unchanged managed files and drops records of edited files and seeds. Overrides are never touched. The summary line gains `N pruned`.
- **adoption-report:** move the command-building part of `frontendArgs()` into a pure function that takes the config values (no module-level config read), used by both `slot-procs.mjs` and `tools/adoption-report.mjs`. Rendered `slot-procs.mjs` output for FoodVibe stays byte-identical in behaviour.
- **Backports:** prefer existing keys and `PACK:` fragments; add a new key only when no existing one fits. Likely shapes (Step 0 confirms): a UI-language/direction key for the "Hebrew RTL" lines; an icon-library key for Lucide; an optional `commands.logQuery` for the `/review-it` step (no key = step not rendered); the domain-logic line through an existing `paths.*` doc key. A candidate whose wording is truly FoodVibe-only stays an override.

## Atomic Sub-tasks
- [x] C0: Check the prerequisites and record the exact override diffs — Step 0 — this plan file
- [x] C1: Let a project skip or soften the CI unit-test job — `ci.testMode` key, ci.yml conditionals, validation, install-check renders for run / if-present / skip — `core/.github/workflows/ci.yml`, `kit.config.json`, `tools/lib/**`, `tools/install-check.mjs`
- [x] C2: Let sync clean up files the kit stopped shipping — auto-drop missing records, `--prune` flag, dry-run preview, install-check cases (unchanged / edited / seed / override / missing) — `tools/sync.mjs`, `kit-sync.ps1`, `tools/install-check.mjs`
- [x] C3: Show the real frontend command in the adoption report — shared pure command builder, Angular and React-Vite fixture assertions — `core/scripts/lib/slot-procs.mjs`, `tools/adoption-report.mjs`, `tools/acceptance-check.mjs`
- [x] C4: Turn FoodVibe's small wording overrides into kit settings — one key or fragment per candidate per C0, or a recorded "stays an override" — `packs/angular/**`, `core/**`, `kit.config.json`
- [x] C5: Document the new keys and release notes — README config section, CHANGE-LOOP prune note, CHANGELOG `[1.3.0]` with "overrides you can drop" — `README.md`, `docs/**`, `CHANGELOG.md`, `kit.json`
- [ ] C6: Release v1.3.0 — all checks, kit PR, merge after Dandan's review, tag + GitHub release after Dandan's go — kit repo
- [ ] C7: Sync FoodVibe to v1.3.0 and drop the covered overrides — dry-run, set the new keys, Apply, delete the covered `overrides` entries, add `scripts/lib/fe-command.mjs` to `docs/workflow-kit/manifest.json` (tier `core`, action `copy`) then `node scripts/kit-owned.mjs --write` (else `KIT_MANIFEST: FAIL … 1 unclassified`), ng build, kit-owned + manifest checks, /ship — `../foodVibe1.0` slot
- [ ] C8: Sync agentdesk to v1.3.0 and drop its CI override — set `ci.testMode`, Apply with `--prune`, delete the `ci.yml` override, CI green, /ship — `../agentdesk` slot

## Out of Scope
- agentdesk's other 7 overrides (pack skills/docs it keeps for project-specific symbols, `docs-refresh.md`, `standards-supabase.md`).
- A docs-map skill for the React-Vite pack (`/docs-refresh` fallback).
- Extra CI steps a project wants in place of the test job (agentdesk's scripts install + link check): a later plan if more than one project needs it.

## Execution Notes

Run by a Worker in the kit slot `ai-workflow-kit-wt-1`, branch `feat/007-kit-follow-ups` from `origin/main` `2efae81`.
C0–C5 done here; C6–C8 wait for Dandan (merge, tag, project syncs). Version **1.3.0** (minor: optional keys only), dated
2026-10-19, `kit.json` bumped in the same PR (README Releasing step 3).

### C0 — Reality check
- Kit `main` = `2efae81` (after Snapshot `d83bae1`). agentdesk at `e32c37304` (PR #11 merged), FoodVibe at `ccf06865`
  (PR #424 merged); both `.kit/install.json` record `github:WDD-CODER/ai-workflow-kit@v1.2.0`, commit `85294d6`. Both
  working trees clean; nothing was written to either (render helpers + `sync.mjs` dry-runs only).
- `KIT:if key=value` compares `String(vals[key])`; the key must exist in `kit.config.json` or the render throws, and an
  empty project value falls back to the kit default (`resolveConfig`). So `ci.testMode` defaults to `"run"` there.
- FoodVibe candidates rendered with its own config by the kit (`planFiles`); `kit:` render vs `FV:` override:
  - `.claude/skills/cssLayer/SKILL.md` line 18 — kit: "… Physical `left`/`right` break mirroring when the UI runs
    right-to-left." FV: "… The UI is Hebrew RTL; physical `left`/`right` breaks mirroring."
  - `docs/agent/standards-angular.md` line 19 — kit: "* **Logic**: project-specific domain rules live in
    `docs/agent/standards-domain.md`, not here." FV: "* **Logic**: Ingredient Ledger, Triple-Unit conversion, Recursive
    Compounding, Waste Factor." (FoodVibe's `standards-domain.md` names the ledger only.)
  - `.claude/skills/angularComponentStructure/evals/evals.json` line 7 — kit: "… no any, UI text via the translate pipe."
    FV: "… no any, Hebrew text via translatePipe."; line 17 — kit: "… not a hardcoded string in any language" FV: "… not a
    hardcoded Hebrew/English string".
  - `.claude/commands/review-it.md` line 20 — kit: "Any warn → ESCALATE TO ARCHITECT (the Planner, in the main folder)."
    FV: "Any warn → ESCALATE TO ARCHITECT." (FoodVibe's copy predates plan 002). FV adds line 21 "- **Logs**: Run
    `node scripts/log-query.mjs --since=plan-start --level=error`. Any entry not explained by the milestone fails the
    review." and the table row "| Logs | PASS/FAIL | log-query --since=plan-start --level=error |".
  - `.claude/skills/angularComponentStructure/SKILL.md` line 19 — kit `imports: [TranslatePipe, IconComponent],` FV
    `imports: [TranslatePipe, LucideAngularComponent],`; line 58 — kit "Register every icon the template uses with the
    project icon registry before using it …" FV "Register every Lucide icon the template uses in `app.config.ts` before
    using it …"; line 60 — kit "User-facing strings go through the project translation pipe +
    `public/assets/data/dictionary.json`; that file is append-only." FV "Hebrew strings go through `translatePipe` +
    `dictionary.json`; `dictionary.json` is append-only."
  - Checked too (not candidates): `fix.md` / `auto-solve.md` differ in 5–6 more lines (log-query with other arguments,
    older wording) and stay overrides; `conventions.md` differs in 8+ translation lines and stays an override.
- agentdesk `ci.yml` override vs the v1.2.0 render: only the test job — `npm run lint` (its `commands.test` is `"lint"`)
  replaced by `npm test --if-present`, a scripts install and `node scripts/dev/workflow-link-check.mjs`.

### Decisions
- **`ci.testMode`** as designed: `# KIT:if ci.testMode!=skip` around the test job, its `needs` entry and its gate check;
  `if-present` / else around the run line. No comment inside the job (it would render and break `run`'s byte-identity).
  Validation: `CI_MODES` became `ENUMS` in `tools/lib/kit.mjs` (adds `ci.testMode`, `project.uiDirection`).
  For agentdesk (C8) use **`skip`**: its `commands.test` is `"lint"`, so `if-present` would still run the failing full
  lint. Dropping the override also drops its extra workflow-link-check step (Out of Scope); its `ci.yml` has no install
  record, so sync shows it as `conflict` until it is replaced by the kit render.
- **Sync prune:** a missing `removed-from-kit` file → row `pruned … already deleted: record dropped`, record dropped on
  every `--apply`. `--prune`: unchanged managed → `pruned … deleted (unchanged since install)`; edited managed or seed →
  row `local-only … kept, record dropped` (local-only in that run; once the record is gone later syncs no longer list the
  file — it is the project's). Without `--prune` the present ones stay `removed-from-kit` and one
  `NOTE --prune would delete|keep <path>: …` line each previews it. Overrides and upstream-owned paths are skipped before
  any of this. The summary gains `, N pruned` only when N > 0, so existing summary lines do not change.
  `kit-sync.ps1 -Prune` passes `--prune` (a switch, never an empty value: the PowerShell 5 empty-arg issue does not apply).
- **adoption-report:** new core file `scripts/lib/fe-command.mjs` with the pure `frontendCommand({ script, exec, portArgs,
  port })`; `slot-procs.mjs` `frontendArgs(port)` calls it, `tools/adoption-report.mjs` imports the kit's copy
  (`../core/scripts/lib/fe-command.mjs`) with `port: '{port}'`. For every project: `scripts/lib/fe-command.mjs` `new` +
  `scripts/lib/slot-procs.mjs` `kit-update` (same behaviour; install-check imports each fixture's rendered `slot-procs.mjs`
  and checks `frontendArgs(4321)`). No `workflow-map.md` row added, so nothing else changes. The report's `npm scripts`
  row needs `commands.test` only with `ci.testMode: run`; its CI row names the mode and fails when the test job and the
  mode disagree (not for an overridden `ci.yml`).
- **C4 per candidate** (other projects' renders unchanged unless they set the key — Evidence):
  - `cssLayer/SKILL.md` → **parameterised**, new key `project.uiDirection` (`rtl` | `ltr`, validated). `rtl` renders
    "The UI is {{project.uiLocale}}; physical …" ("The UI is right-to-left; …" when `uiLocale` is unset). Not `uiLocale`
    alone: an angular project that already sets it (e.g. `"he"`) would change without opting in. FoodVibe with
    `uiDirection: "rtl"`: **byte-identical**.
  - `standards-angular.md` → **parameterised**, new key `docs.domainSummary` ("* **Logic**: {{docs.domainSummary}}.").
    The existing `docs.domainStandards` line cannot carry the four rule names (the domain doc lacks three). FoodVibe with
    the summary: **byte-identical**.
  - `review-it.md` → **parameterised**, new key `commands.logQuery` (a full command, like `commands.lintStaged`): the Logs
    step plus `| Logs | PASS/FAIL | {{commands.logQuery}} |`. FoodVibe with
    `"node scripts/log-query.mjs --since=plan-start --level=error"` still differs in **2 lines**: the Architecture line
    (the kit's plan-002 " (the Planner, in the main folder)") and the table cell (full command vs "log-query --since=…").
    Both are kit wording to take, not project facts: C7 drops the override and takes the kit render (`conflict` until then).
  - `angularComponentStructure/SKILL.md` → **parameterised in part**, new keys `project.icons.library` / `component` /
    `registry` (they also fill the icon line of `conventions.md`). FoodVibe with `Lucide` / `LucideAngularComponent` /
    `app.config.ts` differs in **1 line**, line 60 (Hebrew/`translatePipe` wording vs the kit's translation line), which
    states the same rule. No key for it (three FoodVibe-only values: language, pipe name, short file name). Droppable if
    Dandan accepts the kit's line 60; otherwise **stays an override**.
  - `angularComponentStructure/evals/evals.json` → **stays an override** (or take the kit text): 2 lines of
    Hebrew/`translatePipe` wording of the same rule, no project fact a key could carry, and a `KIT:if` line would make the
    pack's JSON source invalid JSON.
- FoodVibe `kit.config.json` values for C7: `project.uiDirection: "rtl"`, `project.icons: { "library": "Lucide",
  "component": "LucideAngularComponent", "registry": "app.config.ts" }`, `commands.logQuery: "node scripts/log-query.mjs
  --since=plan-start --level=error"`, `docs.domainSummary: "Ingredient Ledger, Triple-Unit conversion, Recursive
  Compounding, Waste Factor"`. Then droppable: `cssLayer/SKILL.md`, `standards-angular.md` (byte-identical);
  `review-it.md` (take the 2 kit lines); `angularComponentStructure/SKILL.md` (only if the kit's line 60 is accepted).
  `evals.json` stays unless its kit wording is accepted.

### Evidence
- Render comparison (scratch script: every planned file rendered with the project's config + install record by the
  v1.2.0 kit `2efae81` and by this branch, no new key set): FoodVibe `RENDER_COMPARE: 2 files differ (182 -> 183 files)`,
  agentdesk `RENDER_COMPARE: 2 files differ (133 -> 134 files)` — both only `+ new file scripts/lib/fe-command.mjs` and
  `~ scripts/lib/slot-procs.mjs` (import + `frontendArgs` body). With only C1 applied: `0 files differ` for both (ci.yml
  `run` byte-identical). agentdesk with `ci.testMode: skip`: only `ci.yml` (test job, its `needs` entry, its gate check
  removed); `if-present`: only `run: npm run lint` → `run: npm run --if-present lint`.
- FoodVibe with the four wording keys (render vs override): `cssLayer/SKILL.md: IDENTICAL`, `standards-angular.md:
  IDENTICAL`, `review-it.md` 2 lines, `angularComponentStructure/SKILL.md` 1 line (60), `evals.json` 2 lines;
  `conventions.md`: the icon line now matches, the translation and breakpoint lines still differ.
- Sync dry-runs with this branch as source (`node tools/sync.mjs --target ../<project> --source .`, nothing written):
  FoodVibe `KIT_SYNC: dry-run — 1 new, 1 kit-update, 0 conflicts, 26 local-only, 0 deleted-locally, 0 removed-from-kit, 20 overrides`;
  agentdesk `KIT_SYNC: dry-run — 1 new, 1 kit-update, 0 conflicts, 9 local-only, 0 deleted-locally, 0 removed-from-kit, 9 overrides, 1 pruned`
  (`pruned .prettierrc.json — already deleted: record dropped (on --apply)`). The `new` / `kit-update` rows are
  `scripts/lib/fe-command.mjs` / `scripts/lib/slot-procs.mjs` in both.
- adoption-report: FoodVibe `frontend dev server  ok  npm exec -- ng serve -c slot --port {port}` (the v1.2.0 kit printed
  `npm run start -- -c slot --port {port}`); agentdesk `npm run dev -- --port {port} --strictPort`. FoodVibe's one `fail`
  row (`docs/agent/remote-port.md:21 path .claude/remote.log`) is the same with the v1.2.0 kit.
- `kit-sync.ps1` in Windows PowerShell 5 on a scratch install with one stale unchanged record: dry-run
  `NOTE --prune would delete old/a.md: deleted (unchanged since install)`; `-Apply -Prune` →
  `KIT_SYNC: applied — 0 new, 0 kit-update, 0 conflicts, 0 local-only, 0 deleted-locally, 0 removed-from-kit, 0 overrides, 1 pruned`,
  file deleted. (The wrapper needs a relative `-Target`; an absolute one fails in `GetFullPath` — pre-existing, unchanged.)
- install-check mutation run (scratch copy: prune delete removed, `if-present` branch disabled, `fe-command` exec branch
  broken) → `INSTALL_CHECK: FAIL — 3 problems`, one per mutation.
- Final checks (local, Windows): `LEAK_CHECK: ok — 161 files, 0 leaks` / `47 files, 0 leaks` / `3 files, 0 leaks`;
  `PACK_CHECK: ok — 3 packs, 2 layers, 8 contract keys used by core (each provided), 0 problems`;
  `INSTALL_CHECK: ok — 5 fixtures, actionlint not installed (skipped), CI renders (ci.testMode run / if-present / skip), …, 0 problems`
  (actionlint is not installed locally; kit CI installs it and requires it);
  `E2E_CHECK: ok — 42 cases passed`; `WORKFLOW_LINK_CHECK: ok — 7 fixtures (…), 0 missing`;
  `ACCEPTANCE_CHECK: ok — 121 checks passed (angular, react-vite, upstream-owned, e2e --project)` (incl.
  `PASS angular: adoption-report frontend row: npm exec -- ng serve -c slot --port {port}` and
  `PASS react-vite: adoption-report frontend row: npm run dev -- --port {port} --strictPort`). Linux + Windows: kit CI on the PR.

### PR #28 review fixes
1. (medium) FoodVibe's own `scripts/kit-manifest-check.mjs` fails on an unclassified `scripts/` file, so the new
   `scripts/lib/fe-command.mjs` would fail it after C7. C7 now says: add it to `docs/workflow-kit/manifest.json` (tier
   `core`, action `copy`), then `node scripts/kit-owned.mjs --write`. CHANGELOG `[1.3.0]` "What a project must do" gained
   a line: a project that classifies the kit's `scripts/` files must register the new file.
2. (low) Sync: `withUpstream` now also gets the recorded paths, so a `removed-from-kit` record under
   `ownership.upstreamPaths` is never pruned. The "not a file this kit ships" NOTE lists explicit overrides only (an
   upstream-owned recorded path is not an `overrides` entry).
3. (low) A record that matches a shipped path only in letter case (a case-only rename) is never treated as a stale
   file: row `pruned … case-only rename of <shipped>: record dropped, file left alone`, nothing on disk touched. The
   pre-fix code deleted the shipped `scripts/todo-query.mjs` on Windows in this case (install-check against the pre-fix
   `sync.mjs`: `1 deleted-locally` after `--prune --apply`).
4. (low) A record whose path resolves outside the target (absolute, or `..`) is skipped with
   `NOTE <path> is recorded in .kit/install.json but lies outside the project: left alone (remove the record by hand)`;
   the record stays. The pre-fix code deleted the outside file.
5. (low) "Unchanged" compares the file's hash as is or with CRLF → LF, so a CRLF checkout of an unchanged file is
   pruned; anything else stays (fail-safe).
6. (low) `project.uiLocale` is documented as a display phrase (`$comment`, README, CHANGELOG: e.g. `Arabic RTL`, not a
   locale code) instead of changing the cssLayer line: the key is already used that way (`conventions.md` heading
   `## Translation ({{project.uiLocale}})`, the PRD template), and FoodVibe's render stays byte-identical
   (`cssLayer/SKILL.md: IDENTICAL` re-checked). A code like `he` would render "The UI is he;" — the docs now say not to.
7. (low) `commandProblems` refuses a `commands.logQuery` with `|` or a backtick (exit 2, install and sync).
8. (low) Records released by `--prune` (edited managed file or seed, kept on disk) are a separate state and count,
   `released` (`, N released` in the summary), instead of being folded into `local-only`. This replaces the Goal's
   "(it then shows as `local-only`)" wording; README, CHANGE-LOOP, CHANGELOG and `kit-sync.ps1` say so, and that
   overrides and upstream-owned paths are never touched.
- install-check cases added to the prune fixture: an upstream-owned record (kept, record kept), a case-only rename of
  `scripts/todo-query.mjs` (file kept, record dropped — on Windows' case-insensitive FS this is the real collision; on
  Linux the same row and outcome), a `../<name>-outside.md` record with an unchanged file next to the target (file and
  record kept, NOTE), a CRLF copy of an LF-recorded file (pruned); and `commands.logQuery` with `|` and with a backtick
  (sync exit 2). The same install-check run against the pre-fix `sync.mjs` + `kit.mjs` (scratch copy) →
  `INSTALL_CHECK: FAIL — 7 problems` (all new cases fail).
- Projects (no keys, dry-runs with this branch as source): unchanged — FoodVibe `RENDER_COMPARE: 2 files differ (182 -> 183 files)`,
  `KIT_SYNC: dry-run — 1 new, 1 kit-update, 0 conflicts, 26 local-only, 0 deleted-locally, 0 removed-from-kit, 20 overrides`;
  agentdesk `RENDER_COMPARE: 2 files differ (133 -> 134 files)`,
  `KIT_SYNC: dry-run — 1 new, 1 kit-update, 0 conflicts, 9 local-only, 0 deleted-locally, 0 removed-from-kit, 9 overrides, 1 pruned`.
- Checks after the fixes (local, Windows): `LEAK_CHECK: ok — 161 files, 0 leaks` / `47 files, 0 leaks` / `3 files, 0 leaks`;
  `PACK_CHECK: ok — 3 packs, 2 layers, 8 contract keys used by core (each provided), 0 problems`;
  `INSTALL_CHECK: ok — 5 fixtures, actionlint not installed (skipped), …, 0 problems`; `WORKFLOW_LINK_CHECK: ok — 7 fixtures (…), 0 missing`;
  `E2E_CHECK: ok — 42 cases passed`; `ACCEPTANCE_CHECK: ok — 121 checks passed (angular, react-vite, upstream-owned, e2e --project)`.
