# Plan 118 — Style QA browser sweep: measure layout, theme and touch defects on every page, state and width

Status: draft
Depends-on: 117
Snapshot: f5a37c3
Source: brief `style-qa-kit-brief.md` (FoodVibe Planner, 2026-11-13), reviewed against the kit. Second of plans 117 → 118 → 119.
Approved: the Human, 2026-11-13 — "save it as plans for an orchestrator run" (an explicit yes under the freeze in `AGENTS.md`).

## Problem Statement

Plan 117 gives the engine its page map, static checks and report. What a stylesheet scan cannot see — a header that breaks
at 375, a rail whose last card is cut, a button that still looks native, a tap target too small — needs the page rendered at
each width. This plan adds the measured layer: Playwright opens each page × state × width, an in-page probe measures, axe
checks contrast, screenshots are taken in segments, and every result goes into plan 117's finding store and report. No
model reads anything here; the layer is free to re-run after every fix.

Framework-specific pieces live in the stack pack, as the kit does for `docsMapCheck`: reading the router (for the "map
cannot go stale" check) and mapping a component tag to its source folder. The core works without them and says so.

## Goals & Success Criteria

**Primary:** `node scripts/styleqa/run.mjs --layers=sweep --pages=<slug>` on the fixture app finds the planted defects at
the right widths, with a component name and screenshot path for each, and never sends a write to the server.

- [auto] `node --test tools/test/styleqa-probe.test.mjs` passes, on recorded element boxes (no browser): L1 horizontal
  page scroll, L2 clipped element with no scrollable ancestor, L3 cut text without ellipsis, L4 overlap > 4px where
  neither box contains the other, L5 broken `oneRow`, L6 rail with a cut sliver and a rail with no scroll-snap at phone
  width, U1 native-looking control, T1–T3 off-token value, G5 tap target (24×24, 44px tall for primary actions) — each
  found once, and each mirrored correctly when `uiDirection` is `rtl`.
- [auto] `node --test tools/test/styleqa-states.test.mjs` passes: a `steps` state whose target matches a blocked word or
  selector is refused before the browser opens, naming the step; the request guard aborts every non-GET request and
  answers list requests empty for the `empty` state; screenshot segmentation gives at most 4 viewport-high segments and
  marks a longer page `truncated`.
- [auto] `node --test tools/test/styleqa-routes-angular.test.mjs` passes: the angular pack's route reader lists the
  routes of a fixture routes file (nested children, lazy routes, `:id` params); the map check fails naming a route that
  is in neither `pages` nor `excluded`, and prints `SKIP map check: no route reader for this stack` when no pack
  provides one.
- [auto] `node --test tools/test/styleqa-browser.test.mjs` passes: with `@playwright/test` and `@axe-core/playwright`
  resolvable it runs the sweep on the static fixture app (one page, then all pages) and asserts the planted L1, U1 and
  rail findings with screenshots; without them it prints `SKIP styleqa-browser: Playwright not installed` and passes.
- [auto] `node tools/pack-check.mjs` passes with the new `styleqaRoutes` contract key, and `npm run build`, `npm run lint`,
  `npm test` and `node tools/drift-check.mjs --target .` pass after `node tools/sync.mjs --target . --apply`.
- [human] Before the release, on a machine with Playwright installed (`npm i --no-save @playwright/test @axe-core/playwright`
  in the kit, then `npx playwright install chromium`), `node --test tools/test/styleqa-browser.test.mjs` prints `pass`,
  not `SKIP`.

## Execution Mode
- Parallel: no.
- Concurrent plans: none.
- Isolated DB: no.
- Run: `/orchestrate 117,118,119 styleqa` — after 117.

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspots
`CHANGELOG.md` and `README.md`.

```scope
core/scripts/styleqa/**
packs/angular/scripts/styleqa-routes.mjs
packs/angular/pack.json
tools/lib/kit.mjs
tools/pack-check.mjs
kit.config.json
tools/fixtures/styleqa/**
tools/test/styleqa-probe.test.mjs
tools/test/styleqa-states.test.mjs
tools/test/styleqa-routes-angular.test.mjs
tools/test/styleqa-browser.test.mjs
tools/install-check.mjs
scripts/**
```

## Read Scope

Entire repo. FoodVibe's `e2e-qa/sweep.spec.ts` (probe, selector builder, tap-target rule, axe), `scripts/qa/code-qa/run.mjs`
(`:id` routes from the first record, Playwright spawn) and `scripts/qa/code-qa/static-checks.mjs` (`parseRoutes`) in
`../foodVibe1.0` at `dfe7571d` are a precedent only — no path, port or string is copied.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a step needs a file outside the
`## Read-Write Scope`: STOP, tell the Human the file, the exact change and why; offer `approved: <path>`; then append the
path to the scope block and retry.

## Architecture Impact

- INV-none: preserves — engine, pack script and pack-contract key only; no model tier, agent or `run-plans.mjs` change.

## Step 0 — Reality Check

Runs only when `scope-check.mjs --drift` reports `REALITY: drift`. Check the listed commits by symbol and print one line
per commit: `ok` or `conflict: <what>`. STOP for a go only on a `conflict`.

## User Stories
- As the Human, I want every page measured at every width I care about, so a break at 375 is found before a user finds it.
- As the Human, I want the run to be safe on my real app: it never saves, submits or deletes anything.

## Functional Requirements

### Must Have (P0)
- [ ] Sweep driver: Playwright Chromium, one context per width from the page map (phone widths ≤ 620 with touch), signed in
  through the project's `styleqa.signIn` module when the page has `auth` (`export async function signIn(context, { appOrigin, apiOrigin })`);
  waits for load and for `styleqa.loaderText` to disappear.
- [ ] `:id` routes: `idType` names a list request; the first record's id fills the route; none → the page is reported
  `skipped: no record` in coverage.
- [ ] States: `default` always; `empty` for list pages (list requests answered `[]` inside the browser); one state per tab
  reachable by URL; `steps` states (`click | hover | fill | press | waitFor | scrollTo`). A step targeting a blocked word
  or selector is refused before the run. Every non-GET request is aborted by a request guard, so the server receives no write.
- [ ] Probe (injected; its geometry is pure functions exported for tests): L1–L6, U1, T1–T3 (computed value vs the
  resolved tokens of `styleqa.tokenPrefixes`; no tokens → off with a line), G5; all edges inline-start / inline-end from
  `{{project.uiDirection}}`. A1 = axe-core `color-contrast` only.
- [ ] `Rails` table rows for every horizontally scrollable container (selector, width, visible children, scroll-snap).
- [ ] Component: nearest element whose tag has a hyphen (custom element / component root); its source folder from the pack's
  component locator when one is provided, else `source: unknown`.
- [ ] Screenshots: viewport-height segments of the full page, at most 4; longer → `truncated` in coverage. Paths under the
  output folder, recorded on each finding.
- [ ] Map check: the pack's route reader (contract key `styleqaRoutes`, kind `script`, provided by the angular pack from
  `{{paths.routesFile}}`) lists the app routes; one in neither `pages` nor `excluded` fails the check. No reader → SKIP line.
- [ ] `--changed`: pages whose `routes` or component folders have files changed since `origin/<main branch>`.
- [ ] `--app=` / `--api=` override the origins; a missing `@playwright/test` or `@axe-core/playwright` stops the sweep with
  exit 2 and the exact install line (the kit never edits a project's package.json).
- [ ] A failed sweep (browser cannot start, origin does not answer) writes `status: failed — <reason>` and exits non-zero.

## Atomic Sub-tasks

- [x] B1: Write failing tests for the probe, the state safety rules and the angular route reader first — recorded-box fixtures, a fixture routes file and a static fixture app with planted defects — tools/test/styleqa-probe.test.mjs, tools/test/styleqa-states.test.mjs, tools/test/styleqa-routes-angular.test.mjs, tools/test/styleqa-browser.test.mjs, tools/fixtures/styleqa/**
- [x] B2: Measure layout, theme and touch defects inside the page, mirrored for right-to-left projects — L1–L6, U1, T1–T3, G5, Rails rows, component root — core/scripts/styleqa/probe.mjs
- [x] B3: Drive each page, state and width in a browser without ever sending a write to the server — widths, touch, sign-in module, :id records, states, blocked steps, request guard, axe A1 — core/scripts/styleqa/sweep.mjs
- [x] B4: Take bounded screenshots in viewport-high segments and attach them to findings — max 4, truncated marker — core/scripts/styleqa/sweep.mjs, core/scripts/styleqa/findings.mjs
- [x] B5: Let the stack pack read the app's routes so the page map cannot go stale silently — new contract key styleqaRoutes (script), angular reader with a component locator, SKIP without a reader — packs/angular/scripts/styleqa-routes.mjs, packs/angular/pack.json, tools/lib/kit.mjs, tools/pack-check.mjs, kit.config.json, core/scripts/styleqa/pages.mjs
- [x] B6: Wire the sweep into the entry point and the report, including the changed-pages filter — --layers=sweep, --changed, --app/--api, dependency check, failed status — core/scripts/styleqa/run.mjs, core/scripts/styleqa/report.mjs
- [x] B7: Resync the kit's own copy and pass every check — install-check expects scripts/styleqa/sweep.mjs; node tools/sync.mjs --target . --apply — tools/install-check.mjs, scripts/**, CHANGELOG.md

## Technical Considerations
- Dependencies: `@playwright/test`, `@axe-core/playwright` from the project's own `node_modules` (resolved from the project
  root), never from `scripts/package.json`. The kit stays dependency-free: its CI runs the recorded-box tests; the real
  browser test runs where Playwright is installed (the Human's choice, 2026-11-13).
- New files needed: `core/scripts/styleqa/{probe,sweep}.mjs`, `packs/angular/scripts/styleqa-routes.mjs`, four tests,
  fixture app pages.
- Model changes: none.
- Backend / API: none; the request guard makes every run read-only against the server.
- Auth and validation: the sign-in module is the project's; the engine passes it a browser context and never reads a
  credential. Reports and console output pass redaction.
- Security surface: a project module is imported (`styleqa.signIn`, a repo-relative path inside the project — refuse an
  absolute path or `..`).
- Data / migration: none.
- `kit.config.json` `$comment` lists the pack-contract keys; add `styleqaRoutes` there. A core placeholder no pack fills
  renders through the kit's `KIT:if` conditional (`tools/lib/kit.mjs` `applyConditionals`), as `core/.claude/commands/fix.md`
  does for `stack.styleSkill`.

## Out of Scope
- `/styleqa`, the review queue, the reviewer agent, the rubric and the merge (plan 119).
- Route readers for packs other than angular (react-vite gets the SKIP line until a later plan).
- Pixel-diff baselines, fixing findings, a scheduled run, the release, FoodVibe adoption.

## Critical Questions
- Q1: How is the real browser run tested, given the kit is dependency-free? A: (Human, 2026-11-13) opt-in local test — CI runs the recorded-box tests; the browser test runs when Playwright is installed and prints SKIP otherwise.
- Q2: Does install add Playwright to a project? A: (Human, 2026-11-13) no — check only; the engine stops with the exact install line.

## Execution Notes
- 2026-11-13 Planner: saved with plans 117 and 119 from the brief.
- 2026-11-13 Builder: Step 0 drift listed only unrelated fix commits (no styleqa symbol) — ok. Playwright is not installed here, so the real browser test printed `SKIP styleqa-browser: Playwright not installed` (the `[human]` item stays open); the sweep driver is unrun in a browser.
- Evidence: `npm run build` → 0; `npm run lint` → 0; `npm run test` → 0; `node tools/pack-check.mjs` → 0 (9 contract keys); `node tools/drift-check.mjs --target .` → 0 after sync; `node tools/install-check.mjs` → 0; `node tools/workflow-link-check.mjs` → 0; `node tools/e2e-check.mjs` → 0 (55 passed); `node tools/acceptance-check.mjs --e2e` → 0 (122); `node --test tools/test/styleqa-*.test.mjs` → pass 37, fail 0, skipped 2 (browser); `scope-check --diff=origin/orch/styleqa` → ok.
- Choices: `idType` is read as the list request path (`/api/x` or a full URL); a bare word gives `skipped: no record`. A page with `idType` also runs the `empty` state; a route with `?query` is a tab state `tab-<value>`. The map check runs on every run (static or sweep), prints `SKIP map check: …` without a reader.
