# Style QA — adopt it, run it, read the report

`/styleqa <page>` lists a project's style defects in one report: a **measured** layer (scripts, no model, no tokens) and a
**visual** layer (a review-tier model looks at screenshots). It reports; it never fixes. Skill: `.claude/skills/styleqa/SKILL.md`.

## Adopt it in a project

1. **Page map** — `docs/qa/styleqa-pages.json` (project-owned): `pages` (each: `slug`, `aliases`, `title`, `routes`, `auth`,
   optional `idType`, `oneRow`, `states`) and `excluded` (routes left out, each with a `why`). `node scripts/styleqa/run.mjs --list`
   prints what it holds; an app route in neither list fails the map check.
2. **Sign-in module** — for pages with `auth`, `styleqa.signIn` names a module that exports
   `signIn(context, { appOrigin, apiOrigin })`. Without it, auth pages are measured signed out (the report says so).
3. **Settings** — the `styleqa.*` keys of `kit.config.json`: `appOrigin`, `apiOrigin`, `signIn`, `uiFontToken`, `tokenPrefixes`,
   `tokenFiles`, `breakpointPattern`, `stylesheets`, `loaderText`, `blockedSteps`, `outDir` (default: a `styleqa` folder under `.claude`), `widths`
   (default list such as `375x812`, `1366x768`). Run `node tools/sync.mjs --apply` after a change.
4. **Theme facts** — `docs/qa/styleqa-theme.md`: a few lines on the project's look (colours, radii, fonts, what a control should
   look like). The reviewer reads it with the kit's rubric (`docs/agent/styleqa-rubric.md`).
5. **Two dev dependencies** — `npm i --no-save @playwright/test @axe-core/playwright && npx playwright install chromium`.

## Add a page or a state

- A page: add an entry to `pages` with a unique `slug`, its `routes` and `auth`; run `/styleqa <slug>`.
- A state (a menu open, a dialog): add `states: [{ "name": "menu-open", "steps": [{ "action": "click", "target": "#menu" }] }]`
  to the page. Actions: `click`, `hover`, `fill`, `press`, `waitFor`, `scrollTo`. Steps that would write (a save, a delete)
  are refused by `blockedSteps` and by the read-only request guard.

## Run it

`/styleqa [page …] [--no-review] [--widths=375,1366] [--states=menu] [--changed]`: resolve pages → servers up → measured run
(`run.mjs --layers=static,sweep`) → review queue (`queue.mjs`) → at most 3 `styleqa-reviewer` agents → merge (`merge.mjs`) →
a short summary. `--no-review` stops after the measured run. Re-check one page after a fix: `/styleqa dashboard`.

## Read the report

`<outDir>/report.md`: status and coverage lines, Summary (counts per check), **Shared components — fix once** (a component on
two or more pages, fix it once), Per page (every finding with its stable ID, status and screenshots), Rails, Static findings by
file. Checks: S1–S3 stylesheet literals, L/U/T/G/A measured in the browser, V1–V8 visual (`docs/agent/styleqa-rubric.md`).
IDs are stable (`V3-1a2b3c4d`): the same defect keeps its ID across runs, and the status is `new`, `known` or `gone`.
Measured findings carry no severity; visual findings are `high`, `medium` or `low`. The finding store is `<outDir>/known.json`.

## What a run costs

- **Measured**: no model, no tokens — a browser and the scripts only.
- **Visual**: at most 24 images per page (the smallest and largest width of every state; a middle width only where S2/S3
  found something; the rest is listed as `skipped`), read by `styleqa-reviewer` on the `review` tier, **3 reviewers at once**.
  A review file is merged once: the same file merged again changes nothing. A page that failed to review is skipped with a
  `skipped <file>: <reason>` line and keeps its earlier visual findings.
- Review files are untrusted model output: validated field by field, findings below 70 confidence or outside V1–V8 dropped,
  at most 6 per state, paths confined to the output folder.
