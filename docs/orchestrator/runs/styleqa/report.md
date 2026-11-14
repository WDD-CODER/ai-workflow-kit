# Orchestrator run styleqa

Run branch: `orch/styleqa` (from `origin/main` at a407ef0) · started 2026-11-13T19:36:15.417Z · finished 2026-11-13T22:56:38.568Z
Result: 3 merged, 0 parked, skipped or left out, 3 in the run (counted from git and status.json).
`main` untouched: NO — origin/main is da32c25.

Final gate: ok (attempt 1)

## Plans

| Plan | State | Rounds | Builder tier | Merge | Why |
| --- | --- | --- | --- | --- | --- |
| 117 Style QA engine: page map, stylesheet checks and one stable report of what to fix | merged | 2 | build → judgment | d142cdd |  |
| 118 Style QA browser sweep: measure layout, theme and touch defects on every page, state and width | merged | 0 | build | 458e7ff |  |
| 119 /styleqa: one command that runs the measured audit and a bounded visual review into one report | merged | 0 | build | bc8bbf6 |  |

## Decisions

triage: shadow · agreement (last 50): 89% · collapsed: 0 · ask: 0 · follow-ups: 0

### Not triaged

- D1 · 117 · none · behaviour: run.mjs also takes --root=<folder> and --settings=<json file>. The tests use them to point the engine at the fixture. The plan lists neither flag. The simplest option was to add them and nothing else — reverse: remove the two flags and the fixture-based CLI tests.
- D2 · 117 · none · behaviour: a missing docs/qa/styleqa-pages.json counts as an empty page map, so the engine prints 'no pages in docs/qa/styleqa-pages.json' and exits 0 — reverse: make loadPageMap throw when the file is absent.
- D3 · 117 · none · behaviour: an alias that repeats a slug or another alias is refused, including when both are on the same page, and a slug that equals an earlier alias is refused too — reverse: relax the duplicate check in validatePageMap.
- D4 · 117 · none · behaviour: a finding that was gone and is seen again is reported as new, not known — reverse: keep the old status in mergeRun.
- D5 · 117 · none · behaviour: S2 and S3 turn off one by one when only one of the colour or font-size prefixes is set. The note says which, e.g. 'S3 off: no font-size token prefix configured'. The plan names only the no-tokens case — reverse: drop the per-check notes.
- D6 · 117 · none · behaviour: with empty styleqa.stylesheets, every file with the stack's stylesheet extension is scanned, skipping node_modules, .git, dist, build, coverage and .claude — reverse: require the stylesheets setting.
- D7 · 117 · none · behaviour: the report is written as <outDir>/report.md and the store as <outDir>/known.json — reverse: rename the files in run.mjs.
- D8 · 117 · none · behaviour: styleqa.widths entries are { width, height } objects, validated at 200–4000 whole pixels — reverse: change the shape in kit.config.json and styleqaProblems.
- D9 · 117 · none · behaviour: .gitignore is an override in this repo, so sync does not write it. I added '.claude/styleqa/' by hand. A project that moves styleqa.outDir must ignore its own folder — reverse: remove the line.
- D10 · 117 · none · behaviour: the report redacts with an engine-local module (core/scripts/styleqa/redact.mjs) because core/scripts/lib/redact.mjs only strips Execution Notes from plans — reverse: delete it and the plan's alternative would need a new shared redactor.
- D11 · 117 · none · behaviour: run.mjs also takes --root=<dir> (default: the folder above scripts/) and --settings=<json file> (styleqa keys laid over the rendered ones, nothing written), so the tests and trial runs can point at the fixture; these flags are not in the plan's list — reverse: drop both flags in core/scripts/styleqa/run.mjs and run the tests against a rendered install
- D12 · 117 · none · behaviour: a page-map state step is { action, target, value? } (value required for fill and press), every page has the implicit state 'default', and auth is true, false or a ui.logins role word; the plan named the actions but not the step shape — reverse: change STEP_KEYS and the checks in core/scripts/styleqa/pages.mjs and the seed's $comment
- D13 · 117 · none · behaviour: with styleqa.stylesheets empty, the static checks read every *.<stack.stylesheetExt> file outside node_modules, dist, build, coverage, any dot folder and the output folder — reverse: edit SKIP_DIRS and the dot-folder test in core/scripts/styleqa/static-checks.mjs
- D14 · 117 · none · behaviour: the report lists every open finding in the store (other pages' too, as the last run left them) plus the findings this run saw go; older gone findings stay only in known.json, and a gone finding that comes back is 'new' again — reverse: change the filter for current in updateStore in core/scripts/styleqa/findings.mjs
- D15 · 117 · none · behaviour: an empty page map stops the run with 'no pages in docs/qa/styleqa-pages.json' and exit 0 before the static layer runs, as the plan's Technical Considerations say — reverse: move the pages.length check below the static layer in core/scripts/styleqa/run.mjs
- D16 · 117 · none · seen: tools/test/orchestrator-env-retry.test.mjs:278 '103 (h) git longpaths' fails on base e55bfbc too (expects 'OK git longpaths (set to true)', gets 'OK   git longpaths')
- D17 · 117 · none · seen: tools/test/run-plans.test.mjs:569 '099 (a) a run writes its own console log' fails on base e55bfbc too (assertion actual false, expected true)
- D18 · 118 · none · behaviour: idType is read as the list request path (/api/x or a full URL); a bare word such as 'number' gives 'skipped: no record' in coverage — reverse: change recordId() in core/scripts/styleqa/sweep.mjs to build the URL from the word
- D19 · 118 · none · behaviour: a page with idType also runs the 'empty' state, and a route with a ?query is a tab state named tab-<value> — reverse: edit sweepStatesOf/tabStates in core/scripts/styleqa/pages.mjs
- D20 · 118 · none · behaviour: the map check runs on every run (static or sweep) and prints 'SKIP map check: no route reader for this stack' when no pack reader is configured — reverse: move the check under sweepOn in core/scripts/styleqa/run.mjs
- D21 · 118 · none · behaviour: a failed sweep writes report.md with 'Status: failed — <reason>', exits 1 and leaves known.json untouched, so a failure does not mark every finding gone — reverse: update the store before returning in run.mjs
- D22 · 118 · none · behaviour: the missing-dependency message starts 'sweep layer not installed' so the existing styleqa-pages test still matches — reverse: reword it and update tools/test/styleqa-pages.test.mjs
- D23 · 118 · none · behaviour: the request guard also aborts HEAD and OPTIONS (every non-GET) — reverse: allow them in guardDecision()
- D24 · 118 · none · seen: tools/test/styleqa-pages.test.mjs:39 — it asserts the sweep exits 2 with a 'not installed' message, which only holds while Playwright is absent from the kit; it will fail on a machine with Playwright installed
- D25 · 119 · none · behaviour: measured findings carry no severity, so the summary counts them by number and visual ones by high/medium/low — reverse: add a severity to the measured checks and change summaryLines in merge.mjs
- D26 · 119 · none · behaviour: run.mjs now also writes <out>/run.json (date, coverage, notes, rails) so merge can redraw the same report with visual findings — reverse: drop that write and have merge append a visual section instead
- D27 · 119 · none · behaviour: the plan's 'S2/S3 measured finding' is read as a finding of check S2 or S3 for that state and width in the store — reverse: change MIDDLE_CHECKS in queue.mjs
- D28 · 119 · none · behaviour: the visual confidence threshold is 70 (overridable with --min-confidence) and a page whose review file is malformed keeps its earlier visual findings — reverse: change MIN_CONFIDENCE in merge.mjs

## Run notes

- 117: the folder ai-workflow-kit-orch-styleqa-117 was installed (scripts)
- 117: escalated to a fresh judgment-tier builder (round 2): gate: node tools/acceptance-check.mjs --e2e
- 117: the folder ai-workflow-kit-orch-merge-styleqa was installed (scripts)
- 118: the folder ai-workflow-kit-orch-styleqa-118 was installed (scripts)
- 118: builder left undone (round 0): The [human] item (browser test prints pass, not SKIP, with Playwright installed) is open. Playwright is not installed here, so sweep.mjs and probe.mjs collectPage have never run in a real browser.
- 119: the folder ai-workflow-kit-orch-styleqa-119 was installed (scripts)

## Models per agent

- 117 builder: sonnet
- 117 builder fix: sonnet
- 117 judgment builder: opus
- 117 reviewer: sonnet
- 118 builder: sonnet
- 118 reviewer: sonnet
- 119 builder: sonnet
- 119 reviewer: sonnet

## What only the Human can do

### The plans' [human] items (no UI check ran)

1. 118 Style QA browser sweep: measure layout, theme and touch defects on every page, state and width: Before the release, on a machine with Playwright installed (`npm i --no-save @playwright/test @axe-core/playwright`
2. 119 /styleqa: one command that runs the measured audit and a bounded visual review into one report: Read `docs/agent/styleqa.md`: it tells a project how to adopt Style QA, add a page or a state, read the report,

- Review and merge the run branch (PowerShell, one line each):

```powershell
git fetch origin
gh pr create --base main --head orch/styleqa --title "Orchestrator run styleqa" --body-file .claude\orchestrator-runs\styleqa.md
```

Context added by learning: 866 chars across 2 roles

Trend (last 3 runs): ✗ per plan 0 → 0 → - · fix rounds per plan 0.33 → 0.2 → 0.67 · parked 1 → 1 → 0
