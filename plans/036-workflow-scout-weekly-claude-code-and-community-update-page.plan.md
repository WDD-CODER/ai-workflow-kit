# Plan 036 — Workflow Scout: Weekly Claude Code and Community Update Page

Status: draft
Track: code — here (kit)
Snapshot: 8bb9b671a6391c43ac3f584064c8974544566135
Depends-on: none

Moved from FoodVibe plan 411 (2026-10-29): kit work lives in the kit repo.

## Problem Statement

New Claude Code features and strong community skills and plugins show up constantly and the Human only finds them by
chance, so the workflow system drifts and sometimes duplicates what Claude Code now does natively. This plan adds a
weekly cloud job that collects what is new, judges it against the **project's** files, and publishes it as a short,
engaging HTML page ("advertiser brain": punchy headline, one-line hook, what it does for you, the file it touches)
that pulls the reader in to learn. Proposals only — nothing is applied.

Decisions (the Human, 2026-10-17):

- **Weekly**, cloud scheduled routine (`/schedule`) — runs with the PC off.
- **Page lives in the project repo:** `docs/scout/YYYY-MM-DD.html`, linked from a weekly PR on a `chore/scout-<date>` branch.
- **Kit-first:** the scout command and the page template are kit-owned (any kit project gets them); a project receives
  them through `kit-sync`. Reports land in the project the routine runs against, so they can map to both kit-owned and
  project-only files.
- Skill improvement is a separate plan: 035.

**The kit and the first project are public repos.** The page and the PR never include secrets, `.env` content or
transcript text.

Checked on origin/main `8bb9b671` (2026-10-29): the kit has no `tools/scout/`, no `scout.md` command and no
`templates/scout-page.html`. `kit-sync` is in use (kit v1.11.0), so the old prerequisite is met.

## Goals & Success Criteria

**Primary:** once a week the Human opens one page and learns, in under 3 minutes, the 5 changes most worth adopting in
their setup.

- [auto] Manual run produces `docs/scout/<date>.html` and `docs/scout/state.json` on branch `chore/scout-<date>` and a PR whose body lists the top 5 as text (one line + file each) and links the page.
- [auto] The page is one self-contained HTML file (no external scripts), renders light and dark, and has: top-5 hero cards, "native feature now replaces your custom X" callouts, community picks with license + stars + last commit, a compact "also new" list, a source + version-range footer.
- [auto] `state.json` records the last Claude Code version and a cursor per source; a second run with no upstream changes produces "nothing new since <version>" and no PR.
- [auto] At least one recommendation in the first report comes from a non-Anthropic source and names a file in the project.
- [auto] Budget: the run stops at its cap (fixed max sources/items; a token cap if the routine supports one — see Step 0) and says `SCOUT: budget reached` on the page.
- [auto] `node --test tools/test/*.test.mjs`, `node tools/install-check.mjs`, `node tools/workflow-link-check.mjs`, `node tools/drift-check.mjs --target .`, `node tools/leak-check.mjs` and `npm run build` pass.
- [human] The Human receives one scheduled weekly PR and finds the page easy and engaging to read.
- [human] The Human marks on one report which recommendations were useful (a checkbox list in the PR body) — feeds tuning.

## Execution Mode

- Parallel: can run alongside plan 035 only if they touch different kit folders (035: `tools/skill-improver/**`; 036: `tools/scout/**`). Both add a CHANGELOG and README section — whichever merges second rebases.
- Concurrent plans: 035; other open kit plans that edit `tools/install-check.mjs` rebase the same way.
- Isolated DB: no

## Read-Write Scope

```scope
tools/scout/**
core/.claude/commands/scout.md
templates/scout-page.html
tools/install-check.mjs
tools/test/**
README.md
CHANGELOG.md
scripts/**
.claude/**
docs/agent/**
docs/brain/**
.kit/install.json
plans/036-*.plan.md
core/scripts/scout/**
templates/docs/scout/**
core/docs/agent/workflow-map.md
docs/scout/**
```

The cloud routine itself is created through `/schedule`, not by a file in this repo.

## Read Scope

Entire repo. In the project the routine runs against: `CLAUDE.md`, `AGENTS.md`, `.claude/**` (not `settings.local.json`), `docs/agent/**`, `docs/workflow-kit/kit-owned.json`, `docs/brain/decisions/**`. Never `.env*`.

## Escalation Protocol

A file outside the scope is needed → STOP, name the file, the change and why; offer `approved: <path>`; append it to
the scope block; retry. Creating the cloud routine is outward-facing and billed: show its prompt, schedule and repo,
and wait for the Human's go.

## Architecture Impact

- INV-none: preserves — kit tooling, a report folder in a project and a cloud routine; no app code, hook or settings change.

## Reuse Check

- Page rendering — family: `templates/` rendered by a Node script — rung: 2 — why: the model fills a JSON and a script renders the fixed template; the model never writes HTML.
- Leak guard — family: `tools/leak-check.mjs` — rung: 1 — why: run on the page and the PR body as is.

## Step 0 — Reality Check

`node scripts/scope-check.mjs --drift --plan=<this plan>`. Then:

0. Kit `main` clean and equal to `origin/main`.
1. Spike (≤30 min, findings written into this plan): (a) can a cloud routine read the repo, fetch public GitHub/web pages and push a branch + open a PR? (b) does it support a model choice per step or a token/turn cap? (c) can it run `/doctor prompt-audit` / `/skill-doctor` non-interactively? If not, drop them from the scout (plan 035 covers skill cost locally).
2. Re-check the sources still exist and their licenses: anthropics/claude-code CHANGELOG, Claude Code docs "what's new", the Anthropic engineering blog, anthropics/claude-plugins-official, marckrenn/claude-code-changelog (no license — read only, never copy text), hesreallyhim/awesome-claude-code, superpowers and gstack releases, sam-illingworth/audit-setup (MIT, used as the Adopt/Improve/Remove/Security/Parked template only).
3. The spike shows a cloud routine cannot push a branch or open a PR → STOP at C0, record it, escalate.

## Design

- **Sources** in one config file `tools/scout/sources.json` (url, type, cursor key). The Human edits it to add or remove.
- **Cheap collect, strong rank:** the model fills a JSON (`items[]`: category Adopt/Improve/Remove/Security/Parked, headline ≤8 words, hook line, why-for-you, file touched, effort S/M/L, source link, license/stars/last-commit for community items). A script renders it into the fixed template `templates/scout-page.html` — the model never writes HTML, which keeps the run cheap and the page consistent.
- **Slices:** one run reads only what is new since each cursor; capped at N items per source.
- **Fit against the project's files:** read `kit-owned.json` and the setup files to name the exact file; flag "native feature replaces custom X" and "community skill beats our skill Y".
- **Expected cost:** ~100–200k tokens per weekly run (~0.4–0.8M/month). Change cadence in the routine schedule; change caps in `sources.json`.

## Functional Requirements

### Must Have (P0)

- [ ] `scout.md` command (kit), `sources.json`, JSON→HTML renderer, page template, `state.json` cursors, PR with top-5 text and a useful-checkbox list.
- [ ] Cloud weekly routine running the command against the first project's repo.

### Won't Have (this plan)

- Applying any recommendation; a second "apply" PR (only when the Human asks); skill editing (plan 035).

## Atomic Sub-tasks

- [x] C0: Check the plan is still right and test a cloud routine before building — Step 0 reality check + routine spike, findings written in this plan — plans/036-workflow-scout-weekly-claude-code-and-community-update-page.plan.md
- [x] C1: List which news sources to scan and remember what was already seen — Sources config + cursor state format — tools/scout/sources.json
- [x] C2: Collect updates and judge which fit the project's workflow, within a budget — Scout command (collect, judge fit, emit JSON, budget caps) — core/.claude/commands/scout.md
- [x] C3: Turn the findings into an easy-to-read web page — Advertiser-style page template + JSON→HTML renderer + tests — templates/scout-page.html, tools/scout/render.mjs, tools/test/scout-render.test.mjs
- [x] C4: Open a weekly PR with the top 5 findings and the page link — Branch + PR step (top-5 text, page link, useful checkboxes) — tools/scout/pr.mjs
- [ ] C5: Document the scout, render the kit's own copies and release — README/CHANGELOG section, install-check strings, `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .`, kit PR merged + release — README.md, CHANGELOG.md, tools/install-check.mjs, .claude/**, docs/agent/**, .kit/install.json
- [ ] C6: Bring the scout into the first project and run it once by hand to get the first page and PR — `kit-sync` in the project, then a manual run there (runs in that project, shipped with its own workflow) — docs/scout/** in the project
- [ ] C7: Schedule it weekly after the Human's go and receive one automatic PR — Create the weekly cloud routine (the Human's go); receive one scheduled PR — cloud routine
- [ ] C8: The Human marks which tips were useful; record that and tune — useful-checkbox results written in Execution Notes; adjust `sources.json` caps if needed — tools/scout/sources.json

## Technical Considerations

- Dependencies: `tools/leak-check.mjs`, `tools/sync.mjs`, `tools/drift-check.mjs`.
- New files needed: `tools/scout/*`, `core/.claude/commands/scout.md`, `templates/scout-page.html`.
- Backend / API: none.
- Auth and validation: the cloud routine acts as the Human with the repo permissions it is granted; show them at C7.
- Security surface: fetches public web pages; the page and PR carry no secrets or transcript text and pass `leak-check`; the routine is created only after a go.
- Data / migration: none.

## Out of Scope

Nightly skill improvement (plan 035); applying any recommendation.

## Execution Notes

- Moved from FoodVibe plan 411 with no work done: the kit has no scout files yet.
- 2026-10-30 C0 — Step 0: `scope-check --drift` reported drift (plans 034, 037, 038, 040 merged since the snapshot;
  none adds scout files). Built on origin/main `938aaca`. Sources re-checked with `gh api`: all exist and are active;
  anthropics/claude-code no license file, claude-plugins-official Apache-2.0, marckrenn/claude-code-changelog none
  (read only), awesome-claude-code NOASSERTION, superpowers MIT, gstack MIT, audit-setup MIT.
- 2026-10-30 C0 — routine spike (from the Claude Code docs, routines.md / cloud-environments.md; not yet tried live):
  (a) a cloud scheduled run clones the repo and can push a branch; a PR must go through `gh api` REST —
  `gh pr` / `gh issue` (GraphQL) are rejected. Default network reaches GitHub hosts only; the `web` sources need
  custom network access. WebFetch/WebSearch in a cloud run: not documented. (b) One model per routine, none per step;
  no token or turn cap → the budget is the fixed caps in `sources.json` (the plan's fallback). (c) `/doctor` and
  project `.claude/commands` in a cloud run: not documented → `/doctor` dropped from the scout; the routine prompt
  names the command file and its steps. (d) Weekly preset exists; cron in UTC; runs draw subscription usage.
  Not a STOP: the run can push and open a PR.
- 2026-10-30 path change (Escalation Protocol): the plan's `tools/scout/**` and `templates/scout-page.html` never reach
  a project (`tools/` is kit-only; a root `templates/` file installs once at the project root). Built as
  `core/scripts/scout/{render,pr}.mjs` + `core/scripts/scout/page-template.html` (managed → `scripts/scout/`) and
  the seed `templates/docs/scout/sources.json` (→ `docs/scout/sources.json`, the project's own after install).
  Scope block extended with those paths, `core/docs/agent/workflow-map.md` and `docs/scout/**`.
  Human, 2026-10-30: `approved: core/scripts/scout/**, templates/docs/scout/**, core/docs/agent/workflow-map.md,
  docs/scout/**` ("your relocation is right: tools/ never reaches a project").
- 2026-10-30 review fixes (Human): render.mjs refuses any absolute drive path outside a URL; pr.mjs refuses unless on
  the default branch with only the page and state.json changed (also in a dry run; `--base` overrides the lookup).
- 2026-10-30 C1–C4 built; C5 docs, install-check strings, sync and drift-check done — kit PR, merge and release wait
  for the Human's review. C6–C8 not started: they need the first project, the Human's go for the billed routine, and
  the Human's ticks.
