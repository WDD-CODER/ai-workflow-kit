# Plan 117 — Style QA engine: page map, stylesheet checks and one stable report of what to fix

Status: draft
Depends-on: none
Snapshot: f5a37c3
Source: brief `style-qa-kit-brief.md` (FoodVibe Planner, 2026-11-13), reviewed against the kit. Plans 117 → 118 → 119 are one feature, built in one orchestrator run.
Approved: the Human, 2026-11-13 — "save it as plans for an orchestrator run" (an explicit yes under the freeze in `AGENTS.md`).

## Problem Statement

Style defects in a project's web UI are found one at a time by eye. There is no repeatable check that lists them and no cheap
re-check after a fix. The brief asks for `/styleqa`: a measured layer (a script, no model) plus a bounded visual layer, both
writing findings with stable IDs into one report, grouped by the component to change.

This plan builds the part that needs no browser and no model: the project's Style QA config and page map, page resolution,
the static stylesheet checks (S1–S3), the finding store (stable IDs, `known`, `gone`, width collapse, subset runs) and the
report renderer. Plan 118 adds the browser sweep on top; plan 119 adds `/styleqa` and the visual layer.

Where the brief and the kit disagree, the kit wins:
- The brief's package script (`pnpm run qa:style`) — the kit never writes a project's `package.json`. The engine is
  `node scripts/styleqa/run.mjs …`, the way every kit script runs; a project may add its own alias.
- Settings are `kit.config.json` keys under `styleqa.*`, like every other kit setting (the Human, 2026-11-13): install and
  sync validate them and render them into the engine (`{{styleqa.<key>|json}}`, as `run-plans.mjs` renders
  `orchestrator.ciMirror`). Only the **page map** is its own project-owned file, `docs/qa/styleqa-pages.json`: it is a long
  list the project edits every time it adds a page or a state, and a kit-sync per new page would be wrong. Existing keys
  are reused: `{{project.uiDirection}}`, `{{stack.stylesheetExt}}`, the slot ports.

## Goals & Success Criteria

**Primary:** `node scripts/styleqa/run.mjs --layers=static` on the kit's Style QA fixture writes one report whose static
findings keep the same IDs across runs, and an unknown page name stops the run with the list of valid names.

- [auto] `node --test tools/test/styleqa-static.test.mjs` passes: S1 (a literal px width in a media query), S2 (a colour
  literal outside the token definitions) and S3 (a font-size literal) each found on the fixture stylesheet with file and
  line; a token definition line and a breakpoint-variable media query are not reported; no tokens configured → S2/S3
  off and the result says `S2/S3 off: no token prefixes configured`.
- [auto] `node --test tools/test/styleqa-findings.test.mjs` passes: the same finding at 375 and 620 is one finding with
  `widths: [375, 620]`; two runs give the same IDs; a finding not seen again on a covered page becomes `gone`; a run on
  one page leaves the other pages' findings untouched; a shared component seen on 2 pages lands in "Shared components —
  fix once" with both pages; the report sections come in the brief's order; a token-like string in a finding is redacted.
- [auto] `node --test tools/test/styleqa-pages.test.mjs` passes: `--pages=dashboard` and an alias resolve to the slug;
  `--pages=nope` exits 1 and prints every valid slug and alias; `--list` prints the pages with their states; a page map
  with a duplicate slug or alias, or a state step outside `click | hover | fill | press | waitFor | scrollTo`, is refused
  with the field named.
- [auto] `npm run build`, `npm run lint` and `npm test` pass, and `node tools/drift-check.mjs --target .` passes after
  `node tools/sync.mjs --target . --apply`.

## Execution Mode
- Parallel: no.
- Concurrent plans: none.
- Isolated DB: no.
- Run: `/orchestrate 117,118,119 styleqa` — plans 118 and 119 depend on this one.

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspots
`CHANGELOG.md` and `README.md`.

```scope
core/scripts/styleqa/**
core/scripts/local-excludes.mjs
templates/docs/qa/**
tools/fixtures/styleqa/**
tools/test/styleqa-static.test.mjs
tools/test/styleqa-findings.test.mjs
tools/test/styleqa-pages.test.mjs
tools/install-check.mjs
kit.config.json
.kit/config.json
tools/lib/kit.mjs
scripts/**
docs/qa/**
.gitignore
```

## Read Scope

Entire repo. FoodVibe's `scripts/qa/code-qa/findings.mjs` (fingerprint, `known.json`, `redact`, report) and
`docs/qa/code-qa-pages.json` (`../foodVibe1.0`, origin/main `dfe7571d`) are a worked precedent only — the kit version
stands alone and copies no project path or string.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a step needs a file outside the
`## Read-Write Scope`: STOP, tell the Human the file, the exact change and why; offer `approved: <path>`; then append the
path to the scope block and retry.

## Architecture Impact

- INV-none: preserves — new scripts, seeds and tests only; no model tier, agent or `run-plans.mjs` change.

## Step 0 — Reality Check

Runs only when `scope-check.mjs --drift` reports `REALITY: drift`. Check the listed commits by symbol and print one line
per commit: `ok` or `conflict: <what>`. STOP for a go only on a `conflict`.

## User Stories
- As the Human, I want one command that lists every style defect of my pages, grouped by the component to fix, so I fix
  each shared component once instead of chasing defects page by page.
- As the Human, I want a finding to keep its ID after unrelated edits, so I can tell new from known from gone.

## Functional Requirements

### Must Have (P0)
- [ ] `kit.config.json` keys `styleqa.*`, each with a default, documented in its `$comment` and validated by install and sync
  (a bad value is refused naming the key, as for `orchestrator.*`): `appOrigin`, `apiOrigin` (empty = this checkout's
  frontend/backend port from `scripts/lib/slot.mjs`); `signIn` (repo-relative path of the project's sign-in module, or
  empty); `uiFontToken`; `tokenPrefixes` `{ color, fontSize, radius }`; `tokenFiles`; `breakpointPattern`; `stylesheets`
  (globs); `loaderText`; `blockedSteps` `{ words, selectors }`; `outDir` (default `.claude/styleqa`); `widths` (default
  375×812, 620×900, 768×1024, 1024×768, 1366×768). The engine gets them rendered at install/sync.
- [ ] The page-map seed `docs/qa/styleqa-pages.json` (from `templates/docs/qa/styleqa-pages.json`):
  `pages: [{ slug, aliases, title, routes, idType?, auth, oneRow?, states }]`, `excluded: [{ route, why }]`. Ships with
  empty `pages` and a line naming the docs (plan 119).
- [ ] Theme-facts seed `docs/qa/styleqa-theme.md` (surfaces, primary colour, font, type and spacing scales, component
  families) — read by plan 119's reviewer; this plan only ships the template.
- [ ] Page resolution by slug or alias (aliases may be in any language; matching is exact after trimming); unknown → exit 1
  with every valid name, before anything runs.
- [ ] Static checks S1–S3 over the configured stylesheet globs, with file and line.
- [ ] Finding store: fingerprint = layer + check + page + state + locator (never a line number or timestamp; a static
  finding's locator is file + selector + property); `known.json` in the output folder; statuses `new | known | gone`;
  a subset run updates only its pages; one finding per (fingerprint) with its list of widths.
- [ ] Report renderer (Markdown): status and coverage lines · summary table · **Shared components — fix once** · per page ·
  `Rails` table (filled by plan 118) · static findings by file. Every value passes the kit's redaction
  (`core/scripts/lib/redact.mjs` or an engine-local equivalent) so no token or credential reaches the report.
- [ ] The output folder is git-ignored by the kit's runtime ignores (`core/scripts/local-excludes.mjs` block).
- [ ] CLI `node scripts/styleqa/run.mjs` with `--pages=`, `--list`, `--layers=static[,sweep]` (sweep arrives in 118 — until
  then `sweep` exits 2 `sweep layer not installed`), `--widths=`, `--states=`, `--date=`, `--out=`.

### Should Have (P1)
- [ ] Direction-aware wording (`inline-start` / `inline-end`) from `{{project.uiDirection}}` in report text.

## Atomic Sub-tasks

- [x] E1: Write failing tests for page resolution, the static checks and the finding store first — fixture under tools/fixtures/styleqa/ (a page map, styleqa settings, two stylesheets with planted S1–S3 literals and token definitions) — tools/test/styleqa-pages.test.mjs, tools/test/styleqa-static.test.mjs, tools/test/styleqa-findings.test.mjs, tools/fixtures/styleqa/**
- [x] E2: Add the Style QA settings to the kit config and ship the page map as a file the project owns — styleqa.* keys with defaults, install/sync validation naming the key, page-map schema validation naming the field — kit.config.json, tools/lib/kit.mjs, templates/docs/qa/styleqa-pages.json, templates/docs/qa/styleqa-theme.md, core/scripts/styleqa/config.mjs
- [x] E3: Resolve page words to pages and stop on an unknown one with the list of valid names — slugs and aliases, --list — core/scripts/styleqa/pages.mjs
- [x] E4: Find literal breakpoints, colours and font sizes in the stylesheets that bypass the design tokens — S1–S3, off with a reason line when no tokens are configured — core/scripts/styleqa/static-checks.mjs
- [x] E5: Give every finding an ID that survives unrelated edits and track new, known and gone — fingerprint, known.json, width collapse, subset update — core/scripts/styleqa/findings.mjs
- [x] E6: Render one report ordered for fixing, with shared components first — the section order above, redaction — core/scripts/styleqa/report.mjs
- [x] E7: Add the command-line entry point and keep the output folder out of git — run.mjs flags above; runtime-ignores entry — core/scripts/styleqa/run.mjs, core/scripts/local-excludes.mjs
- [x] E8: Make install copy the engine and seeds, resync the kit's own copy and pass every check — install-check expects scripts/styleqa/run.mjs and docs/qa/styleqa-pages.json and refuses a bad styleqa.* value; node tools/sync.mjs --target . --apply — tools/install-check.mjs, scripts/**, docs/qa/**, .gitignore, CHANGELOG.md

## Technical Considerations
- Dependencies: Node built-ins only in this plan (the kit's scripts may also use `picomatch` from `scripts/package.json`
  for the stylesheet globs).
- New files needed: `core/scripts/styleqa/{config,pages,static-checks,findings,report,run}.mjs`, the two seeds, the fixture
  and three tests.
- Model changes: none.
- Backend / API: none.
- Auth and validation: the page map is validated on load; nothing is called.
- Security surface: report redaction; the output folder is git-ignored.
- Data / migration: none. Templates are seeds: install writes them once, the project owns them after.
- The kit repository itself gets the seed too (empty `pages`): the engine then prints `no pages in docs/qa/styleqa-pages.json`
  and exits 0.
- Leak check: no project name, port, language name or token name in `core/` or `templates/` (`npm run lint`).

## Out of Scope
- The browser sweep, screenshots, measured checks L/U/T/A/G and the route map check (plan 118).
- `/styleqa`, the review queue, the reviewer agent and the merge (plan 119).
- Fixing findings, writing fix plans, pixel-diff baselines, a scheduled run, unifying a project's breakpoints.
- The kit release (the Human releases after merging the run branch) and FoodVibe adoption (planned in FoodVibe after it).

## Critical Questions
- Q1: Where do the project's Style QA settings live? A: (Human, 2026-11-13) settings in `kit.config.json` under `styleqa.*`; only the page map is its own file, `docs/qa/styleqa-pages.json`.
- Q2: How does a project run the engine without the command? A: (Human, 2026-11-13) `node scripts/styleqa/run.mjs …`; the kit never edits the project's package.json.

## Execution Notes
- 2026-11-13 Planner: saved from the brief with plans 118 and 119; the Human chose: save from a temporary main worktree,
  `/styleqa` as a skill plus agentFiles budget 11, an opt-in local browser test, dev dependencies checked only.
- 2026-11-13 Builder (run styleqa, round 2, fresh builder from base e55bfbc): the round-1 gate failure
  (`node tools/acceptance-check.mjs --e2e`, 1 of 38 checks) did not reproduce: on the base → exit 0, 122 passed; on the
  discarded attempt 02dd0d8 → exit 0, 122 passed; on this build → exit 0, 122 passed. Re-implemented from the base.
- Engine: `core/scripts/styleqa/{config,pages,static-checks,findings,report,run,redact}.mjs`. Only `config.mjs` carries
  placeholders (`{{styleqa.*|json}}`, `{{stack.stylesheetExt|json}}`, `{{project.uiDirection|json}}`, slot base ports);
  the rest import nothing rendered. Redaction is engine-local (`redact.mjs`) on the pre-commit scan's PATTERNS plus JWT,
  bearer, secret query values and URL credentials (`core/scripts/lib/redact.mjs` is the plan-notes redactor, not secrets).
- Page-map step shape: `{ "action": click|hover|fill|press|waitFor|scrollTo, "target": "<selector>", "value"? }`; every
  page has the implicit state `default`; `auth` is true, false or a ui.logins role word.
- Settings: `styleqaProblems` in `tools/lib/kit.mjs` (unknown `styleqa.*` keys refused too), wired into the config
  problems install and sync already run; install-check covers 5 install refusals, 1 sync refusal, the copied engine and
  seeds, the rendered defaults, the installed engine on the empty page map and the `.claude/styleqa/` ignore.
- Evidence: `node --test tools/test/styleqa-static.test.mjs tools/test/styleqa-findings.test.mjs tools/test/styleqa-pages.test.mjs`
  → exit 0, pass 16, fail 0 · `node tools/sync.mjs --target . --apply` → exit 0 · `npm run build` → exit 0 ·
  `npm run lint` → exit 0 (first run flagged a framework folder name in the skip list; removed) · `npm run test` → exit 0
  (INSTALL_CHECK ok, 0 problems) · `node tools/drift-check.mjs --target .` → exit 0 · `node tools/pack-check.mjs` → exit 0 ·
  `node tools/workflow-link-check.mjs` → exit 0 · `node tools/e2e-check.mjs` → exit 0 (55 passed, 1 skipped) ·
  `node tools/acceptance-check.mjs --e2e` → exit 0 (122 passed) · `node scripts/scope-check.mjs --diff=origin/orch/styleqa` → SCOPE: ok.
