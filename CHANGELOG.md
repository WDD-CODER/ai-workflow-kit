# Changelog

All notable changes to the kit. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [semver](https://semver.org/): a major release says what a project must do; minor and patch
releases never need action. (Before 1.0.0, a minor bump could change how projects install or sync.)

Releases are git tags `vX.Y.Z` with a GitHub release. Install or upgrade to one with
`--source github:WDD-CODER/ai-workflow-kit --ref vX.Y.Z` (see the README).

## [Unreleased]

The kit uses its own workflow: it is installed into the kit repo and works solo (plan on `main`, build on a
`feat/NNN-<slug>` branch in the same folder, `/ship`).

### What a project must do

Nothing. Two optional changes reach projects with the next sync: `.kit/config.json`, when present, is read before
`kit.config.json` by install, sync and drift-check; and `/ship` checks the plan scope of a `feat/NNN-<slug>` branch
outside a slot too. Rendered files that change (`kit-update`): `scripts/scope-check.mjs`, `scripts/ship-prep.mjs`,
`.claude/commands/review-it.md`, `.claude/agents/kit-runner.md`, `docs/agent/model-routing.md`,
`docs/agent/workflow-map.md`; new: eleven `.claude/agents/orch-*.md` and `docs/agent/agent-roles.md`. A new config
key `models.build` (default `sonnet`) is optional; a project that turned the routing off (every tier `inherit`) sets `models.build: "inherit"` too.

### Added
- Role agents for the orchestrator, each with a pinned model and effort from `models.*`: `orch-readiness`
  (judgment), `orch-builder` (new `models.build` tier, escalation to judgment; no Agent or SendMessage tool),
  `orch-gate` and `orch-report` (mechanical), the finders `orch-check-plan`, `orch-check-bugs`, `orch-check-rules`,
  the verifier `orch-verify`, `orch-security` (sensitive paths only, read-only), `orch-ui` and `orch-merge`
  (analysis). `docs/agent/agent-roles.md` holds their shared contract: one job, non-interactive, evidence for every
  claim, a JSON result naming its own model and effort, no deny-listed command.
- `models.build`: the tier for agents that write code, validated like the other tiers (install and sync refuse
  `models.build: gpt-4` naming the key).
- A shared result validator for the kit's checks (`tools/lib/agent-result.mjs`): requires `model` and `effort`,
  computes `pass` from the verified problems and rejects a result whose own `pass` disagrees;
  `tools/test/agent-contracts.test.mjs` runs every agent's documented example through it (in `e2e-check`).
- Agent eval harness (kit-side tool): `node tools/agent-eval.mjs --agent <agent.md> --cases <dir> --runs 2` runs one
  agent file against labelled cases and prints recall, precision, run-to-run noise, tokens and cost per case with a
  total line; `--model <id>` compares one agent file across models; `--min-recall` / `--min-precision` exit 1 below
  the threshold. Findings match by `file`, `rule` and `severity` (line ±3, text ignored). The default runner calls
  Claude Code non-interactively and refuses a write-capable agent unless `--allow-write`. Generic checker and
  verifier cases ship in `tools/fixtures/agent-evals/`; real cases live in each project. New rendered file:
  `docs/agent/agent-evals.md` (the case shape). `tools/test/agent-eval.test.mjs` runs in `e2e-check`.
- Plans declare what they need first: a `Depends-on: NNN, MMM` (or `none`) header line, in the plan template and
- Plans declare what they need first: a `Depends-on: NNN, MMM` (or `none`) header line, in the plan template and
  the save-plan lint. One parser (`scripts/lib/plan-deps.mjs`) reads it — plus legacy prose such as
  `Prerequisite: plan NNN merged`, so old plans need no edit — for every tool.
- `scripts/plan-order.mjs`: the run order of any set of plans — waves (what can run in parallel), lanes, lock groups
  derived from Read-Write Scope overlap (config hotspots and the i18n file left out) and the reason of every edge;
  text or `--json`. A cycle or a missing dependency exits 1 and names the plans. With `--branch <b> --merged-from
  git`, a plan counts as merged only on the exact subject `Merge <src> into <b> (plan NNN)`.
- `scope-check.mjs --deps --plan=<path>`: `DEPENDS_ON: ok` or `DEPENDS_ON: missing` (exit 1).
- `take-plan.mjs` refuses a plan whose dependency is not merged with `NOT_READY: plan NNN (<title>) is not merged`
  (the same check as before, now on the shared parser and the `Depends-on:` line).
- `.kit/config.json` project config, read before `kit.config.json` (for a project whose `kit.config.json` is
  something else; messages name the file used). A kit installed into itself records its source as `local:.`.
- The kit repo carries the installed workflow (`.kit/config.json`, a root `package.json` that runs the checks), and
  CI runs `drift-check --target .` so the installed copy always equals the sources.

### Changed
- `/review-it` reviews a Worker branch with the checker pipeline: three finders in parallel (plan, bugs, rules; plus
  security on sensitive paths), a verifier that drops a finding only on a concrete refutation, a confidence ≥ 80
  threshold and a do-not-report list; it keeps its `kit-runner` call for the commands and no longer reads a session
  handoff file.
- `scope-check.mjs`: with no `--plan` and no slot plan, a `<type>/NNN-<slug>` branch's plan is the plan.
  `ship-prep.mjs` runs the scope gate in a slot **or** on such a branch (a branch that names no plan: no gate, as
  before).
- Write guards judge the file being written, whoever launched the agent. Tests first
  (`tools/test/guards.test.mjs`, also run by `tools/e2e-check.mjs`): a main-folder session writing into a slot was
  already judged by the slot's guard; what failed, and is fixed:
  - **Bash writes are guarded.** `.claude/settings.json` runs `branch-guard.sh` and `scope-guard.sh` on `Bash` too;
    redirects, heredocs, `tee`, `sed -i` / `perl -i`, `cp` / `mv` / `install` targets and `touch` get the same path
    rules, read-only commands pass, and a target the guard cannot resolve (`$VAR`, `$(...)`) is refused where a write
    needs a check.
  - **Merge folders are held to their plan.** Outside a slot, a branch other than `main` that names a plan —
    `.worktree-plan` (e.g. an `orch/<run>` merge folder) or `<type>/NNN-<slug>` — is scope-guarded; `ship-prep.mjs`
    uses the same rule (`scopedPlanPath` in `scripts/lib/slot.mjs`, `--scoped-plan` prints it).
  - **Runtime files on `main`.** `.claude/sessions/**`, `.claude/.session-state-path` and `.claude/.plan-write-ack`
    are no longer refused by the branch guard.
  - **Speed.** Both guards are one node process (`scripts/lib/guard.mjs`): the branch and git dirs are read from files,
    no git call on the allow path (`KIT_GUARD_TRACE=1` prints `GUARD_GIT_CALLS: <n>`), no python. Rendered files that
    change: `scripts/scope-guard.sh`, `scripts/branch-guard.sh`, `scripts/lib/slot.mjs`, `scripts/ship-prep.mjs`,
    `.claude/settings.json` (`kit-update`); `scripts/lib/guard.mjs` (`new`).

### Fixed
- `slot-serve.mjs` and `take-plan.mjs` install a folder's packages when they are missing (no
  `node_modules/.package-lock.json`), not only when its lockfile changed: a stale `.last-npm-install-hash-*` no
  longer hides a missing `server/node_modules`. They print `npm install ran in <label> (packages missing|lockfile
  changed)`, and a failed install names the exact command to run by hand. New pure check `installNeed(dir,
  hashPath)` in `scripts/lib/slot-procs.mjs`. Rendered files that change (`kit-update`): `scripts/lib/slot-procs.mjs`,
  `scripts/slot-serve.mjs`, `scripts/take-plan.mjs`.

The validation hand-off moves to the end of the work: a finished plan with `[human]` items now ends with the
servers running and HOW TO VALIDATE cards grouped by page, before any `/ship`, PR or merge.

Model routing per task. Steps that only run commands or gather evidence now go to sub-agents on a cheaper
model; planning, review, fixes and code writing stay on the main session's model. New `docs/agent/model-routing.md`
holds the rules: no `model:` on an inline command (a model switch re-reads the whole conversation uncached, twice),
delegate only when a step reads a lot and returns little, `ESCALATE: <reason>` instead of a guess, the main session
re-checks any agent result that skips work or blocks a merge, and one hand-off file format for passing a failed step
to a stronger agent.

- New config key `models` (`mechanical` = `haiku`, `analysis` = `sonnet`, `judgment` = `inherit`). A value must be
  `haiku`, `sonnet`, `opus`, `fable`, `inherit` or a full model id starting `claude-`; install and sync refuse anything
  else. All three `inherit` turns the routing off.
- New agents `.claude/agents/kit-runner.md` (mechanical: runs commands, returns exit codes and verbatim error lines)
  and `.claude/agents/kit-prevalidate.md` (analysis: auto-solve's DONE / TODO / BLOCKED table). `git-agent` gets the
  mechanical tier.
- `/ship` Phase 1, `auto-solve` Phase 4 and `/review-it` step 3 hand their commands to `kit-runner`; `auto-solve`
  Phase 2 uses `kit-prevalidate` and re-checks every DONE row; `auto-solve` Phase 3's parallel agents name
  `model: "inherit"`; `/docs-refresh`'s agent call passes the analysis tier.
- `github-sync` (mechanical) and `techdebt` (analysis) run as forked skills. A question the fork cannot ask comes
  back as an `ASK:` line, and the main session asks it. On a rebase conflict github-sync now runs `git rebase --abort`
  before stopping (it used to leave the conflict in place), so the checkout is never left mid-rebase.
- In Cursor (no sub-agents) `/ship` and `/review-it` run those commands inline, as before.
- SessionStart prints a `MODEL_ROUTING:` line when `CLAUDE_CODE_SUBAGENT_MODEL` or
  `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` would override the agent files' models.

Mods from the kit's own marketplace. The three Claude Code mods (fleet, guards, ship-pilot) now live in this
repository under `mods/`, served by `.claude-plugin/marketplace.json` (`ai-workflow-kit-mods`), so a project gets them
on every machine and a mod change reaches those machines with a kit release.

- New config key `mods`: `enabled` (default `[]`; `fleet`, `guards`, `ship-pilot` — others are refused) and
  `marketplaceRepo` (default this repository). With a mod enabled, install and sync write the marketplace
  (`autoUpdate: true`) and one `enabledPlugins` entry per mod into `.claude/settings.json`.
- fleet 0.4.0: the status line shows when the 5-hour window resets (`5h 62% ↻14:30 (2h10m)`), `/health` and the
  limit notices name both reset times, and every session shows a notice when the 5-hour window refreshes (the 95%
  notice is re-armed for the new window). Port bases come from the kit-rendered `scripts/lib/slot.mjs` when fleet's own
  options are empty. The 95% notice fires once per window.
- guards 0.2.0: its append-only hotspots come from the kit-rendered `scripts/scope-check.mjs` (the same list `/ship`'s
  scope check uses) when its option is empty.
- ship-pilot 0.4.0: no behaviour change (one shared copy from the marketplace).
- CI runs `leak-check` on the mods (their tests are fixtures and are not scanned). Cloud sessions do not get the mods.

### What a project must do

Nothing. Sync and commit. Rendered files that change (`kit-update`): `docs/agent/job-validation.md`,
`.claude/commands/take-plan.md`, `.claude/commands/ship.md`, `.claude/commands/done.md`, `AGENTS.md` and, with the
Cursor layer, `.cursor/commands/done.md` and `.cursor/commands/ship.md`. A project that
overrides one of these files can copy the new "Servers first", Format and Close-out text by hand.

Model routing: nothing either; the new config key `models` has defaults. To change a tier, set `models.<tier>` in `kit.config.json`; to keep
every step on the main model, set all three to `inherit`. `templates/CLAUDE.md` is a seed, so an existing project's
`CLAUDE.md` does not get the new pointer to `docs/agent/model-routing.md` (optional to add by hand).

Mods: nothing unless you want them. To turn them on, set `mods.enabled` in `kit.config.json`, sync, commit, and accept
the folder's trust dialog once. Replacing a local directory marketplace: see the README's **Mods**.

### Changed
- `job-validation.md`: a Core rule for the hand-off (cards only when a human is needed, only once the work is
  finished, before `/ship`, a PR or a merge; after the merge only when merges are pre-approved). "Servers first" is a
  hard step: every page URL in the cards answers before they are shown. Cards are grouped by page in click order
  (`▸ page — full URL` lines, numbers running on, a last group for checks outside the app); the header's `app:` field
  is gone. New reply word `failed: <numbers>`.
- `/take-plan`: a final step "Close-out" — `[auto]` evidence, then servers, cards and the wait before `/ship`; also
  for several plans run in one session.
- `/ship` Phase 4 and `/done`: with `[human]` items and no answered cards, the gate starts the servers and shows the
  cards first. **Y** alone is commit/push consent and no longer validates `[human]` items (`done Y` answers both).
- Cursor layer `/done` and `/ship`: the same rules spelled out, since Cursor has no hook that checks them.
- `AGENTS.md`: the Job validation rule names the hand-off; `/ship` **Y** alone no longer counts as validation.

## [1.3.1] - 2026-10-19

The Planner's Architect + PM review now reaches every brief, including a feature request written in plain prose, and
shows what it changed. `/plan`, the PRD template and save-plan describe one plan shape. Plus three tool fixes: the
PowerShell wrappers take an absolute folder, `e2e-check --project` explains missing dependencies and env files, and
`workflow-link-check` no longer fails on a gitignored runtime file.

### What a project must do

Nothing. Sync (`kit-sync -Ref v1.3.1`, then `-Apply`) and commit. Rendered files that change (`kit-update`):
`.claude/skills/brief-detection/SKILL.md`, `.claude/commands/plan.md`, `.claude/references/prd-template.md`,
`.claude/skills/save-plan/SKILL.md`, `scripts/plan-name-similarity.mjs`, `docs/agent/workflow-map.md` (the
`brief-detection` row and diagram line) and, with the Cursor layer, `.cursor/rules/brief-detection-must-use-skill.mdc`.
No config key is new. A project that overrides `docs/agent/workflow-map.md` can update its `brief-detection` row and
diagram line by hand to the new trigger and routes.

### Changed
- `brief-detection`: in the main folder, a feature request in prose (asks to build, add, change, fix or remove
  something; longer than one sentence; not a question) gets a short gate:
  `a. refine it with a review (default) · b. /plan it · c. just discuss`. A question, a slash command, a request to
  run or explain something, an answer, a request phrased as a question ("Can you add …?"), a small change (one file,
  a typo, a one-line fix), or any message in a slot gets no gate. The structured-brief gate has the same choices. The
  main-folder test is the one tool call allowed before the gate (or the SessionStart slot line). The workflow map's `brief-detection` row and the Cursor rule say the same.
- Option **a** (the default) runs `/plan`'s Architect + PM review on the brief and saves nothing (it used to skip the
  review). On a brief the review checks codebase facts, Human decisions, testability and overlap only; missing plan
  sections are not gaps until `/plan`, and there are no `fixed:` lines. Option **b** hands to `/plan` → save-plan → a Worker claims the plan in a slot with `take-plan`; it no
  longer says to run a milestone, which the Planner never does.
- `/plan`'s review block lists `fixed: <gap> → <change>` and `open: <gap> — <question>` lines, also on a plan the
  Planner wrote itself; `no gaps` only when both lists are empty. It always runs the overlap search (below); a plan it
  finds is an `open:` line only when it may be the same work or shares a file, the rest go on one `checked:` line.
- One plan shape: `/plan` no longer asks for "numbered milestones and a Verify command per milestone". The PRD
  template's Atomic Sub-tasks are the milestones, and each `[auto]` success criterion names its exact check. The
  template gains `## Execution Notes` (where `/plan` writes gaps the Human kept), and `## Critical Questions` says its
  own `Q: … A: …` format instead of pointing at a format `brief-detection` never defined. save-plan says the same.
- `plan-name-similarity`, new flags for the review: `--stem` matches words by stem (`favourite` = `favorites`,
  `recipes` = `recipe`); `--related` (implies `--stem`) searches the text of every plan, open and closed (rare words
  weigh most) and prints `PLAN_RELATED`; `--scope="glob,…"` (a bare `--scope` with `--file`: that plan's scope block)
  prints `PLAN_SCOPE_OVERLAP` for open plans whose Read-Write Scope shares a file (a path without a glob counts as the
  file and as the folder). Without these flags the output is v1.3.0's, line for line, so save-plan's gate and
  `plan-write-guard.sh` behave as before.
- `e2e-check --project`: stops before cloning with `install dependencies in <path> first` when the project or its
  `scripts/` has no `node_modules`, or one that lacks most declared packages (a broken install; a few missing are a
  NOTE); copies `<paths.serverRoot>.env` (when git ignores it) into the scratch slots, as the slot setup does for a real
  slot, and deletes the copies when the run ends, also on Ctrl+C or a kill; without that file the slot dev server
  cases are `SKIP` with the reason (the summary line adds `, N skipped`).
- `workflow-link-check`: a path a doc names that does not exist but the project's git ignores is counted as `runtime`
  (`N runtime (gitignored)`), not missing.

### Fixed
- `kit-sync.ps1`, `kit-install.ps1`, `kit-drift.ps1`: an absolute `-Target` (or `-Config`) failed under Windows
  PowerShell 5 (`Join-Path` glued it onto the current folder). Paths now resolve as PowerShell does: relative,
  absolute, drive-relative (`C:name`), root-relative (`\name`). A trailing slash (`.\my-app\`, tab completion) is
  dropped; it used to end the argument in `\"` and swallow the arguments after it, such as `-Apply`.
- `plan-name-similarity` missed existing plans worded differently from the request: titles only, exact words, and a
  0.8 score. See `--stem` / `--related` above (the review uses them; the default gate is unchanged).

### Checks
- `install-check`: the rendered Planner instructions agree (the prose rule, the gate text, examples that obey the
  rule, option a reviews and saves nothing, option b hands to `/plan`, save-plan and `take-plan`, the `fixed:` /
  `open:` / `checked:` block, the brief-only review, the small-change and question-form exceptions, the overlap search,
  one plan shape); `plan-name-similarity` default output equal to v1.3.0's on a fixture, `--stem`, `--related`, and
  `--scope` overlap cases (bare folder, trailing slash, `src/**`; not `*.md`, `src/app/*.ts`, a sibling folder); the
  three PowerShell wrappers with relative, absolute, trailing-slash, spaced, drive-relative and root-relative paths,
  and `-Apply` after a trailing slash (Windows).
- `workflow-link-check`: a fixture with a gitignored runtime path (runtime when ignored, missing when not).
- `acceptance-check --e2e`: `e2e-check --project` on a clone without `node_modules` stops before cloning.

## [1.3.0] - 2026-10-19

Follow-ups from the first v1.2.0 syncs: the CI unit-test job can be softened or turned off, sync cleans up the files a
release stopped shipping, the adoption report prints the real slot frontend command, and four optional config keys let a
project keep its own wording in the angular pack and `/review-it` without an override.

### What a project must do

Nothing. Every new key is optional, and with none set every rendered file is the same as in v1.2.0 except
`scripts/lib/slot-procs.mjs` (`kit-update`, same behaviour) and the new `scripts/lib/fe-command.mjs` (`new`). Sync
(`kit-sync -Ref v1.3.0`, then `-Apply`) and commit both.

A project that keeps its own classification of the kit's `scripts/` files (a manifest or an ownership list its own
check reads) must register `scripts/lib/fe-command.mjs` there (a core, copied file), or that check reports it as
unclassified.

### Overrides you can drop

Set the key, drop the `overrides` entry, run sync, and check the rendered file (a file that differs from your copy is a
`conflict`: take the kit's version, or keep the override).

- `.github/workflows/ci.yml`, kept only because the test job could not pass (no test script, or the test command fails
  on code you do not own): set `ci.testMode` to `skip` (no test job) or `if-present` (passes when there is no such
  script).
- `.claude/skills/cssLayer/SKILL.md` (angular pack), kept for a "the UI is right-to-left" line: `project.uiDirection:
  "rtl"` (the line names `project.uiLocale` when it is set: a display phrase such as `Arabic RTL`, not a locale code).
- `docs/agent/standards-angular.md`, kept for a project-specific **Logic** line: `docs.domainSummary` (the line becomes
  `* **Logic**: <summary>.`).
- `.claude/commands/review-it.md`, kept for a log-query step: `commands.logQuery` (the full command that prints the
  errors logged since the plan started) adds a **Logs** check and its table row.
- `.claude/skills/angularComponentStructure/SKILL.md`, kept for the icon library: `project.icons.library`,
  `project.icons.component`, `project.icons.registry` (the same keys fill the icon line of `docs/agent/conventions.md`).
  A copy that also words the translation line differently keeps its override, or takes the kit's line.
- A `removed-from-kit` row for a file you already deleted disappears on the next `-Apply` (the record is dropped).

### Added
- `ci.testMode` (`run` default | `if-present` | `skip`): `run` renders the test job as before (byte-identical),
  `if-present` runs `npm run --if-present <commands.test>`, `skip` renders no `test` job and nothing needs it. Install and
  sync refuse any other value (exit 2), like the other `ci.*` modes. The adoption report's CI row names the mode and fails
  when the job and the mode disagree.
- `kit-sync --prune` (`kit-sync.ps1 -Prune`): with `--apply`, a managed file the kit no longer ships that is unchanged
  since install (its hash equals the record) is deleted and its record dropped; an edited one or a seed stays on disk and
  only its record is dropped (`released`). A CRLF checkout of an unchanged file counts as unchanged. Never touched:
  overrides, upstream-owned paths, a record outside the project, and a record that differs from a shipped path only in
  letter case (a case-only rename: its record is dropped, the file stays). Without `--prune` nothing is deleted, and a
  dry-run prints what `--prune` would do. The summary line gains `N pruned` and `N released`.
- Optional wording keys, unset = the v1.2.0 lines: `commands.logQuery` (`/review-it` Logs check), `project.uiDirection`
  (`rtl` | `ltr`; refused otherwise), `project.icons.library` / `component` / `registry`, `docs.domainSummary`.
  Install and sync refuse a `commands.logQuery` with `|` or a backtick (it is shown in a Markdown table and code span).
- `scripts/lib/fe-command.mjs`: the pure builder of the slot frontend command (`frontendCommand`), used by
  `slot-procs.mjs` (`frontendArgs`) and by `tools/adoption-report.mjs`.
- Checks: `install-check` renders `ci.testMode` run / if-present / skip (actionlint in kit CI), refuses bad `ci.testMode`
  and `project.uiDirection` values, runs `sync --prune` on unchanged / edited / seed / override / missing records, imports
  each fixture's rendered `slot-procs.mjs` to check `frontendArgs`, and checks each wording key set and unset;
  `acceptance-check` checks the adoption report's frontend row on the Angular and React-Vite fixtures.

### Changed
- `kit-sync --apply` drops the record of a `removed-from-kit` file that is already gone (it showed as
  `removed-from-kit` on every run).

### Fixed
- `adoption-report`: the `frontend dev server` row printed `npm run <commands.dev> -- <slots.fePortArgs>` and ignored
  `slots.feExec`; it now prints the command a slot runs (angular pack: `npm exec -- ng serve -c slot --port {port}`).

## [1.2.0] - 2026-10-19

The core no longer assumes a stack: "core + stack pack + layers". The frontend dev server, CI jobs, style rules,
tech-debt rules and the references core commands make come from the packs and from config, a project without a
backend gets no backend job, and a new **React + Vite** pack, a **Supabase** layer and an **upstream-owned** layer (for
a repo that is a copy of someone else's) join the Angular and Node/Express packs. The installer detects the stack when
none is named. The Planner always runs an Architect + Product Manager review before it saves a plan. New checks
prove an install on fixture projects end to end. Released as a minor version by choice, although several changes need a
step in existing projects (below): read that list before you sync.

### What a project must do

Run `kit-sync -Ref v1.2.0` (dry-run) first; it lists every change. Then:

1. **`commands.*` are npm script names.** Every `commands.*` value in `kit.config.json` must be a script name
   (`"build"`, `"dev"`), not a command (`"npm run build"`, which rendered as `npm run npm run build`). Install and sync
   stop with exit 2 and name the value to use. `commands.lintStaged` stays a full command.
2. **Name the stack for a core-only install.** With no `--packs` and no `stack.packs`, install now detects the packs and
   layers, prints them with the reason for each and installs them only after `--yes`; when nothing matches it stops
   (exit 2) instead of installing the core alone. For the stack-neutral core only, pass `--packs ""` (PowerShell
   `-Packs ''`) or set `"stack": { "packs": [] }`. This applies to `--config <file>` too: a config file without a `stack`
   now exits 2 the same way. Detection never includes the `upstream-owned` layer by itself (every fork clone has an
   `upstream` remote): it prints it as a suggestion, and you add it with `--layers`. Installed projects are not affected:
   sync uses the recorded packs. Install stops (exit 2) when `kit.config.json` `stack.packs` / `stack.layers` and
   `.kit/install.json` disagree — make them match.
3. **PRD and HLD templates.** `kit-sync` shows `.claude/references/prd-template.md` and `hld-template.md` as `conflict`
   whenever the project's copy differs from the kit's (they were seeds and are now kit-managed; sync never overwrites
   them). For each: move the project-only lines into the file named by `paths.planChecks` (default
   `docs/project/plan-checks.md`), then take the kit version (copy the rendered kit file over yours) and re-run sync —
   it reports `same` and records the file as managed. To keep your own copy, add an `overrides` entry instead; drift-check
   now compares both templates byte for byte, so a kept copy needs it.
4. **Workflow script dependencies.** After the sync, run `npm install` inside `scripts/` once in the main folder and
   commit `scripts/package-lock.json` (not `npm install --prefix scripts`: npm 10 then runs the root package's
   lifecycle scripts). The dependency (`picomatch`) lives in the kit-managed `scripts/package.json`; until the lockfile
   exists the scripts still find it in the root `node_modules` when it is there. Slots reinstall it when the lockfile
   changes; CI installs it inside `scripts/` and audits it report-only once the lockfile is committed; a later
   `kit-sync --apply` that changes `scripts/package.json` refreshes the lockfile (commit it with the sync, or run the
   command sync prints when that install fails).
5. **A project that keeps its own `AGENTS.md`** (an `overrides` entry, or `ownership.upstreamPaths`) gets
   `AGENTS.workflow.md` as a `new` file: add the line `@AGENTS.workflow.md` under `@AGENTS.md` in `CLAUDE.md` (a seed,
   so sync does not change it).
6. **Slot frontend dev server.** It comes from `commands.dev` + `slots.fe*`. With the angular pack nothing changes (the
   pack supplies `npm exec -- ng serve -c slot --port <port>` and the env file); the react-vite pack supplies
   `npm run dev -- --port <port> --strictPort`. Any other project whose slot frontend started only because
   `src/environments/environment.local.ts` existed: set `commands.dev` (and, as needed, `slots.feExec`,
   `slots.fePortArgs`, `slots.feMatcher`, `slots.feEnvFile`). A backend-only project whose `kit.config.json` still says
   `commands.dev: "dev"` (older node-express installs copied it): set it to `""`. Install and sync print a `NOTE` while
   `commands.dev` is set and every `slots.fe*` value is the default; the default `--port {port}` is right only for a
   server that fails on a busy port.
7. **Backend.** A project that has a backend must set `paths.serverRoot` (e.g. `"server/"`, which the node-express pack
   sets): with it empty, `ci.yml` and `security.yml` render no server job or step. Install and sync print a `NOTE` when
   `server/package.json` exists and the key is empty.
8. **CI for code the project does not own** (an upstream copy, a stale lockfile, a legacy codebase): set `ci.install`,
   `ci.lintScope: "changed"` (ESLint on the project's own changed files; needs ESLint in the root `node_modules`) and/or
   `ci.appAuditMode: "report"` — or use the `upstream-owned` layer, which sets all three. Install and sync refuse (exit 2)
   any other value of the two modes. An `overrides` entry for `ci.yml` or `security.yml` kept only for this, or only to
   drop the backend job, can go.
9. **React + Vite projects that forked kit files.** Add the stack with `kit-sync --packs react-vite --layers
   supabase[,upstream-owned]` (dry-run, then `--apply` records it in `.kit/install.json` **and** in `kit.config.json`
   `stack.packs` / `stack.layers` — a hand-edited config that still says `packs: []` makes a later install stop; a
   project-owned `AGENTS.md` is a seed, so copy the pack's hard rules and skill triggers in from a scratch install). On
   the `upstream-owned` layer a plan cannot add a dependency: `package.json` is upstream's (the scope guard denies it,
   `ship-prep` flags a shell change to it). Move `.gitignore`, `AGENTS.md`, `package.json` (and
   any other upstream-owned file) from `overrides` to `ownership.upstreamPaths` — the `upstream-owned` layer's default
   already lists `.gitignore`, `AGENTS.md`, `package.json` and `package-lock.json`. Then these overrides can be dropped,
   because the kit now covers what they were forked for (drop the entry, sync, check the rendered file; keep an
   override only for a real project difference): `scripts/slot-serve.mjs`, `scripts/take-plan.mjs`,
   `scripts/lib/slot-procs.mjs`, `.claude/skills/worktree-setup/SKILL.md` (Vite slot server, `scripts/package.json`,
   local excludes); `.husky/pre-commit`, `.husky/pre-push` (shebang, optional lint-staged, closed plans in range
   folders); `.github/workflows/ci.yml`, `security.yml` (no backend job, `ci.*` keys), `brain-capture-reminder.yml`
   (title injection), `todo-sync.yml` (the repo-setting error); `.claude/settings.json`, `scripts/ship-prep.mjs`,
   `scripts/session-startup.sh` (Python fallback, SessionStart JSON); `scripts/techdebt-report.mjs`,
   `.claude/skills/techdebt/SKILL.md` (`scan`, `.tsx`, pack rules); `.claude/commands/feat.md`, `fix.md`, `refactor.md`,
   `security.md`, `docs-refresh.md`, `commands.md` (Angular style rules, breadcrumbs); `.claude/skills/save-plan/SKILL.md`,
   `docs/agent/workflow-map.md` (stale paths, pack skill rows). An override for `.vscode/settings.json` that upstream's
   `.gitignore` ignores is not needed either (`ignored`). A tech-debt baseline written with other rule names: re-run
   `node scripts/techdebt-report.mjs scan --write-baseline`.
10. Optional: record a tech-debt baseline once (`node scripts/techdebt-report.mjs scan --write-baseline`, commit
    `<paths.sharedDocs>/techdebt-baseline.json`) so the `techdebt` skill reports `NEW_DEBT: yes|no` against it.
11. Optional: `AGENTS.md` is a seed, so existing projects do not get the Planner review rule. Paste this bullet under
    `## Hard rules`, after the "Architecture invariants" bullet, with your `paths.planChecks` path:
    ```
    - **Architect + PM review (Planner):** the Planner is the Architect and the Product Manager. Every plan the Planner saves — written here or received from Claude.ai, Cursor or another agent — gets `/plan`'s `## Architect + PM review (always)` before it is saved, plus this project's own checks in `{{paths.planChecks}}` when that file exists. A received plan is reviewed, not silently rewritten.
    ```
12. Optional: a project without the angular pack keeps the `.prettierrc.json` it got as a seed (sync never deletes
    seeds); delete it if its code style differs. The `.gitignore` skeleton (a seed) lists three more runtime paths
    (`.claude/*.log`, `.claude/.last-npm-install-hash-scripts`, `scripts/node_modules/`); `take-plan` already adds the
    whole list to `.git/info/exclude`.

### 002 — Planner always runs the Architect and Product Manager review

#### Added
- `/plan` has a `## Architect + PM review (always)` section. It runs on every plan the Planner saves — plans
  it writes and briefs or Plan Contracts it receives — and checks it against the fetched main branch:
  Architecture Impact filled, every named file and symbol exists or is marked new, the standards doc and
  existing patterns followed, scope exact; testable success criteria with tagged Done-when items, Out of Scope,
  backend / auth / security / data impact named, smallest full-value version, every step concrete enough to run
  without asking. It prints one `ARCHITECT + PM REVIEW` block (`no gaps` or one line per gap with a fix); a
  received plan is reviewed, not rewritten, and a gap the Human rejects is noted in the plan's Execution Notes.
  The Planner protocol runs it as step 0 (after `git fetch`), and `brief-detection` routes a Plan Contract
  pasted on main through it.
- `kit-sync`: a file recorded as a seed that the kit now ships as managed is a `conflict` unless it already
  matches the kit (then `same`, recorded as managed). Its recorded hash is the project's own copy (`--adopt`
  records whatever is there), so "unchanged since install" no longer lets sync overwrite it.
- `install-check`: a promoted-seed case (customised copy → `conflict`, `--apply` leaves it), a fourth fixture
  (angular + node-express + Cursor), and an assertion in every fixture that each path `/plan` and the
  `workflow-map.md` `/plan` row load exists.
- `.claude/references/prd-template.md` and `hld-template.md` are kit-managed core files (they were seeds), so
  every project gets the files `/plan` loads, sync keeps them current and `kit-drift` compares them. The PRD template names backend,
  auth, security, data and project-check lines; the HLD template's "Alternatives Considered" table is replaced
  by `### Why this design`.
- Config key `paths.planChecks` (default `docs/project/plan-checks.md`): the project's own planning checklist,
  which the review adds when the file exists. Documented in `kit.config.json`, the README and the `AGENTS.md`
  skeleton.

#### Changed
- Roles: the Planner (Claude Code in the main folder) is the Architect and the Product Manager; Claude.ai or
  another tool may draft. `/plan` no longer says "Claude.ai by default"; `workflow-map.md` §1 and flow F1,
  `README_WORKFLOW.md` (title, roles, cost routing, authoritative files), `/feat`, `save-plan` and `/review-it`
  wording follow.
- `/plan`, `/feat`, `workflow-map.md` and `README_WORKFLOW.md` point at `{{paths.sharedDocs}}/tech-stack.md` and
  `current-state.md` instead of a `/_shared/` folder that is not installed, and `README_WORKFLOW.md` names
  `docs/agent/` instead of a `.claude/rules/` folder that does not exist.

### 003 — Stack-neutral core, part 1: install, slots and runtime files

#### Added
- `scripts/local-excludes.mjs`: the single list of runtime files (slot markers, logs, install hashes, session
  state). It appends the list idempotently to `$(git rev-parse --git-common-dir)/info/exclude` (`--check` exits 1
  when an entry is missing). The `.gitignore` skeleton is rendered from it; install, `take-plan` (before its
  dirty check) and the worktree-setup skill run it, so a fresh clone whose `.gitignore` the project owns is no
  longer refused with "uncommitted or untracked changes".
- `scripts/package.json` (kit-managed, `picomatch` ^4.0.7; its `type` mirrors the root `package.json`, so the
  project's own `scripts/*.js` keep their module type). `install --install-deps` runs
  `npm install` inside `scripts/`; `take-plan` and `slot-serve` install it when `scripts/package-lock.json`
  changes (hash in `.claude/.last-npm-install-hash-scripts`); the root devDependency note no longer lists it.
- `AGENTS.workflow.md`: when the project owns `AGENTS.md` (in `overrides`, or present and not installed by the
  kit), the kit's `AGENTS.md` skeleton is rendered there as a managed file with a header saying who owns what,
  and the `CLAUDE.md` skeleton imports both.
- Config keys `slots.feExec`, `slots.fePortArgs` (default `["--port", "{port}"]`), `slots.feMatcher`,
  `slots.feEnvFile`; the angular pack fills them with its current values. Placeholder filter `|json`.
- `kit-sync`, `kit-drift` and install skip a missing kit file the project's git ignores: state `ignored`
  (sync, drift-check) and `SKIP-IGNORED` (install), instead of `new` / `missing`.
- e2e: a refused claim commit, a fresh clone with its own `.gitignore`, the config-driven frontend dev server
  (started, kept, stopped), the scripts' own install, and `.kit/install.json` in scope. install-check: full
  commands refused, `AGENTS.workflow.md` (pre-existing and overridden `AGENTS.md`), ignored paths, sensitive
  paths and frontend values from config, an i18n folder hotspot, the browser line, the `.gitignore` runtime list.

#### Changed
- The slot frontend dev server comes from config: `commands.dev` names the npm script (no such script in
  `package.json` = no frontend) and `slot-serve` runs `npm run <dev> -- <fePortArgs>`, or
  `npm exec -- <feExec> <fePortArgs>`; `slots.feMatcher` recognises its processes (default `run <dev>`) and
  `slots.feEnvFile` is the optional env file whose `.slot` copy gets the slot's backend port. The port
  arguments must make the server fail on a taken port, never move to another one. It was Angular-only
  (`environment.local.ts` + `ng serve`).
- The node-express pack no longer sets `commands.dev` (`"dev"`): core now reads it as the frontend script, and
  nothing read it before.
- `ship-prep` reads `security.sensitivePaths`: a regex string replaces the built-in sensitive-path regex (the
  default when unset), a list of globs adds to it.
- `project.i18nFile` may be a glob or a folder (`src/locales/` → `src/locales/**`) as well as a file or a
  comma-separated list; every entry is an append-only hotspot.
- `tools.browser` left at its default no longer renders "Browser tool: browser tool." in the `AGENTS.md`
  skeleton; the line keeps only the browser-check guidance.
- Dropped the unused config key `commands.npm`.

#### Fixed
- `take-plan` no longer half-claims a slot when the claim commit fails (e.g. a pre-commit hook): it restores
  the plan file, returns the slot to its detached commit, deletes the new branch and prints
  `TAKE_PLAN: claim commit failed: …`. It checks the result and names any step that did not undo, and a merged
  PR's old remote branch is deleted only after the claim commit succeeded.
- `scope-check` always allows `.kit/install.json` (kit-sync re-records it), so it is never `scope: out`.

### 004 — Stack-neutral core, part 2: CI, commands, tech debt and rules by pack

A project on the angular (and node-express) pack keeps its CI (`server-tests`, the full `npm run <commands.lint>`, the
enforced critical audit) and the same Angular rules, now from the pack; sync shows the changed files as `kit-update`.

#### Added
- Config keys `ci.install` (default `npm ci`), `ci.lintScope` (`all` default | `changed`) and `ci.appAuditMode`
  (`enforce` default | `report`). `changed` lints the changed `*.ts *.tsx *.js *.jsx *.mjs *.cjs` files minus the
  kit-managed ones (`.kit/install.json`): a PR's merge commit against its base side (`HEAD^1`), a push against
  `github.event.before` (a new branch: `HEAD~1`; nothing to compare = pass); a failing `git diff` fails the step.
  `report` runs the app audit with `set +e` and writes the result to `$GITHUB_STEP_SUMMARY` plus a `::warning`.
- `kit-sync --apply` refreshes `scripts/package-lock.json` (`npm install` inside `scripts/`) when it writes
  `scripts/package.json` and the project has that lockfile.
- Conditional blocks in kit files: `KIT:if <key>` / `KIT:else` / `KIT:end` (as `# …` or `<!-- … -->` lines; `key`,
  `!key`, `key=value`, `key!=value`). The backend job and steps in `ci.yml` and `security.yml` render only with
  `paths.serverRoot`.
- Pack fragments: a pack's `fragments` file (`FRAGMENTS.md`, not installed) fills `PACK:<name>` marker lines in core
  files. The angular pack supplies the style rules of `/feat`, `/fix`, `/refactor`, `/security`, their styling and
  auth skill lines, its pre-commit hooks (`pre-commit-no-semi` before the secret scan, `pre-commit-security-grep`
  after it, as before) and its tech-debt greps.
- The pack contract: `pack.json` `provides` names what a pack supplies for core references — `conventionsDoc`,
  `backendDoc`, `styleSkill`, `authSkill`, `docsMapSkill`, `docsMapCheck`, `cssSection`, `componentsSection` — as the
  config keys `stack.<key>` (a project may set its own). Core uses each only inside `KIT:if stack.<key>` with a
  fallback, so a project with no pack gets no dangling path. `pack-check` fails on an unguarded contract key, a key
  no pack provides, a provided file, skill or section that does not exist, a fragment that fills no marker, and a
  core file that names a file or skill only a pack ships.
- `tools/workflow-link-check.mjs`: every backticked path, `node scripts/…` and `npm run <script>` in the installed
  commands, skills, agents, `docs/agent`, Cursor rules and `AGENTS.md`/`CLAUDE.md` must exist (runtime files and
  examples skipped). Without arguments it checks installs with packs `[]`, angular, node-express and both;
  `--target <dir>` checks a project. install-check runs it on each of its fixtures; kit CI runs both.
- `techdebt-report.mjs scan`: counts `any`, `@ts-ignore`, `eslint-disable`, `console.log`, TODO/FIXME and files over
  300 lines in the project's own `.ts .tsx .js .jsx .mjs .cjs .html .css .scss` files (tracked files under
  `paths.srcRoot`, kit-managed files left out, tests left out for `any` and `console.log`), plus the pack's
  `techdebtRules` (angular: legacy `@Input`/`@Output`, `BehaviorSubject`, trailing semicolons), and compares with
  `<paths.sharedDocs>/techdebt-baseline.json`: `NEW_DEBT: yes|no` (`unknown` without a baseline). `--write-baseline`,
  `--strict` (exit 1 on new debt), `--list`. The `techdebt` skill runs it; its `PACK:techdebt` marker is filled by
  the pack.
- Pack seeds: `pack.json` `seeds` marks pack files that are written once, optionally with `skipWhenPresent` (install
  `SKIP-PRESENT`, a sync `NOTE`).
- install-check: CI renders with and without `paths.serverRoot` and with every `ci.*` mode (actionlint on every
  rendered workflow when it is installed; kit CI installs a pinned, checksum-verified actionlint and requires it),
  the link check per fixture, no `KIT:`/`PACK:` directive left in a render, style rules and the prettier seed only
  with the angular pack, the pre-commit hook order, a prettier seed skipped next to `prettier.config.js`, and the
  tech-debt scan (core and angular rules, baseline, `--strict`).
- `standards-git.md` and `/ship`: pass `-R <owner>/<repo>` (from `git remote get-url origin`) on every `gh` call —
  in a fork `gh` targets the parent repo — and edit a PR with `gh api -X PATCH repos/<owner>/<repo>/pulls/<n>
  -F body=@<file>` when `gh pr edit` fails on the Projects (classic) deprecation.

#### Changed
- Core commands carry no stack style rules: `/feat`, `/fix`, `/refactor` and `/security` say "Match the file's
  existing style; never reformat untouched lines" and take the rest from the pack. `/review`, `/fix`,
  `/docs-refresh`, `/security`, the techdebt skill and `pr-check-fix-loop.md` reach the conventions doc, backend
  standards, styling, auth and docs-map skills through the pack contract; `/fix` "Loads by area" names the pack's
  real standards-doc sections.
- `.prettierrc.json` moved from `templates/` to the angular pack (a seed).
- `ci.yml`: `server-tests` runs inside `paths.serverRoot` (`working-directory`) instead of `npm --prefix`; the gate's
  `needs` is a block list; the docs-only path filter drops three patterns `*.md` already covered (shellcheck SC2221).

### 005 — React-Vite pack, upstream-owned layer and adoption checks

#### Added
- `packs/react-vite/`: React + Vite + TypeScript standards (`standards-react.md`: server state in the query library,
  caller-scoped query keys, one session source, typed data access, realtime cleanup, lazy routes that reload once on a
  missing chunk, Tailwind tokens, right-to-left-safe utilities) and conventions; the `react-component-structure`,
  `cssLayer` and `auth-and-logging` skills; Vite gotchas; the pack contract (`conventionsDoc`, `styleSkill`, `authSkill`,
  `cssSection`, `componentsSection`; no docs-map skill, so `/docs-refresh` takes its fallback); fragments for
  `/refactor`, `/security`, the `techdebt` skill and the `workflow-map.md` skill rows; tech-debt rules `inner-html`,
  `banned-state`, `raw-fetch`; config defaults: `commands.dev: "dev"`, `slots.fePortArgs` with `--strictPort`, the Vite
  process matcher, base port 5173, `paths.routesFile` and the `src/App.tsx` hotspot, no backend.
- Layers beyond Cursor: `layers/<name>/layer.json` takes the optional fields of `pack.json` and applies after the packs;
  `--layers` on install, sync and drift-check, `stack.layers` in the config, `layers` in `.kit/install.json`.
  `layers/supabase/`: Supabase backend standards (`standards-supabase.md`, the `backendDoc` contract key), gotchas,
  sensitive paths, the `ui-table-call` tech-debt rule. `layers/upstream-owned/`: `ownership.upstreamPaths`, CI defaults
  (`ci.install: npm install --no-audit --no-fund`, `ci.lintScope: changed`, `ci.appAuditMode: report`), the `/pull-copy`
  command (rebase on `upstream/main`, never resolve a conflict, the force-push left to the Human), gotchas and a hard
  rule.
- Config key `ownership.upstreamPaths` (globs): matching kit files are never written by install and count as
  `override` in sync and drift-check; a matching `AGENTS.md` sends the rules to `AGENTS.workflow.md`; a matching
  `package.json` gets no devDependencies; in a slot `scope-check` prints `SCOPE: upstream <path>` and the scope guard
  denies it ("upstream-owned, not an `approved:`"), even when the plan lists it; `ship-prep`'s scope check names it.
- Stack detection: `pack.json` / `layer.json` `detect` rules (`deps` in the root or backend `package.json`, a `path`, a
  `gitRemote`). With no `--packs` and no `stack.packs`, install prints `KIT_INSTALL: detected packs=[…] layers=[…]` with a
  reason per entry, writes nothing until `--yes`, then records the stack in `kit.config.json`. node-express is detected
  from the backend folder only (an SSR frontend lists `express` in the root); a `suggestOnly` rule (the `upstream`
  remote → `upstream-owned`) is printed as a suggestion and never installed by `--yes`. Install stops when
  `kit.config.json` `stack.*` and `.kit/install.json` disagree; `adoption-report` flags it.
- `ownership.upstreamPaths` takes `**`, `*`, `?` and a trailing `/` only (the syntax the kit's matcher and the scope
  guard's read alike): install and sync refuse braces, character classes and `!`; `pack-check` checks pack and layer
  defaults.
- `kit-sync --packs / --layers` add a pack or layer to an installed project (`--apply` records them in
  `.kit/install.json` and `kit.config.json`); `kit-install.ps1
  -Layers -Yes`, `kit-sync.ps1 -Packs -Layers`. Every tool flag also takes `--flag=value` (PowerShell 5 drops an empty
  argument, so the wrappers pass `--packs=`).
- `tools/e2e-check.mjs --project <path>`: the e2e cycle on a scratch copy of a real installed project — slots borrow its
  `node_modules` through junctions (removed with `rmdir`, also from exit and signal handlers when the run is
  interrupted; the source checked intact afterwards; never delete its temp folder recursively while a link is there);
  `/pull-copy` and the e2e use the upstream's own default branch (`refs/remotes/upstream/HEAD`); the plan commit runs the
  hooks; claim, guards (hotspot, upstream-owned path), the slot dev server, ship, merge, close-out, a Planner close-out
  push into a range folder, `/pull-copy` (replay, refused force-push, conflict abort) with an upstream, drift-check, the
  maintenance scripts and SessionStart JSON.
- `tools/adoption-report.mjs --target <dir> [--markdown <file>]`: one row per workflow part (install record, managed
  files, stack vs detection, each Claude Code hook and git hook, hooks enabled, scripts dependencies, runtime ignores,
  kit rules loaded, npm scripts, frontend dev server, doc links, CI) with `ok` / `warn` / `fail`.
- `tools/acceptance-check.mjs [--e2e]` and `tools/fixtures/make-fixture.mjs`: Angular + Express, React-Vite + Supabase and
  an upstream-owned React-Vite copy (double quotes and semicolons, no husky, an `upstream` remote). Each: detection, install,
  link check, drift-check with no hand-written override, rendered CI, adoption report, the first commit through the hooks;
  `--e2e` then runs `e2e-check --project` on the two React-Vite fixtures. Kit CI runs it on Linux and Windows.
- install-check: a React-Vite + Supabase fixture, the React tech-debt rules, stack detection (proposal, `--yes`, nothing
  matching, explicit packs win) and the upstream-owned layer; workflow-link-check covers react-vite and both layers.
- `pack-check` checks layers too, plus `detect` rules and `techdebtRules` patterns.

#### Changed
- `install` with no `--packs`, no `stack.packs` and no recorded packs detects the stack and stops until `--yes` (exit 2),
  instead of installing the core alone (what-to-do item 2).
- `workflow-map.md` §4 has a `PACK:workflow-map:skills` marker for the pack's skill rows (no pack section = no line).
- `workflow-map.md` and `README_WORKFLOW.md` name `.cursor/commands/` and `contractor-role.mdc` only with the Cursor
  layer (new builtin `kit.cursor` for `KIT:if`): an install without `--cursor` (e.g. the angular pack alone) had two
  dangling references. Renders with `--cursor` are unchanged.

## [1.0.5] - 2026-10-18

Fixes found installing the kit into a React + Vite project. Sync to pick them up (`kit-sync -Ref v1.0.5 -Apply`);
nothing else to do.

### Fixed
- Git hooks: `.husky/pre-commit` had no shebang, so git without the husky wrapper (`core.hooksPath=.husky`)
  could not run it on Windows and every commit failed. Both hooks now start with `#!/usr/bin/env sh` and
  `set -e`, lint-staged runs only when it is installed, and install and sync write the hooks as executable
  (chmod 755 and `git add --chmod=+x`). The install note names both ways to enable the hooks.
- SessionStart: the context sat under `decision`, where Claude Code ignores it, so the slot role and the
  resumed session state never reached the session; and quotes or newlines in the session-state file broke
  the JSON. The output is now built in node, with `additionalContext` directly under `hookSpecificOutput`.
- CI: the `gitleaks` job asks for `contents: read` and `pull-requests: read` and posts no comments
  (`GITLEAKS_ENABLE_COMMENTS: false`), so it runs with a read-only default token.
- Python: the session-manifest hook runs through `scripts/run-python.sh` (first of `python3`, `python`, `py`
  that works, else a quiet no-op), and `ship-prep` tries the same three and prints a warning instead of
  silently falling back to the full dirty-file list.
- pre-push: a push to main that only moves closed plans into a range folder (`plans/300-400/…`) is allowed.
- todo-sync: when GitHub refuses to let Actions open the PR, the run deletes its `chore/todo-sync-*` branch
  and prints an error naming the repo setting. Install output and the README's first-time setup list it.
- Stale references: `save-plan` named a pre-commit script that only one pack ships, `workflow-map.md` named
  `.claude/todo-archive.md` (it is the folder `.claude/todo-archive/`, written by todo-sync), example plan
  names came from a real project, `/docs-refresh` used Cursor's subagent type (`general-purpose` in Claude
  Code), and `/security` had a garbled step and leftover "three-agent" wording.

### Added
- `tools/e2e-check.mjs` cases: a project without husky runs the hooks (first commit passes, a staged fake key
  is refused); SessionStart prints valid JSON on each branch; pre-push accepts a range-folder plan and still
  refuses code.

## [1.0.4] - 2026-10-18

Security fixes from an automated review. Sync to pick them up (`kit-sync -Ref v1.0.4 -Apply`); nothing else to do.

### Security
- `brain-capture-reminder.yml`: the PR title was pasted into the job's shell script and written to
  `$GITHUB_ENV` under a fixed `EOF` delimiter, so a crafted title could run commands or set variables. PR fields
  now reach the script only through `env:`, the PR number is checked to be numeric, and every multi-line value
  uses a random delimiter.
- `.claude/settings.json`: `Bash(*)` stays allowed, but `permissions.deny` now refuses git-hook bypasses
  (`--no-verify`, `commit -n`, `core.hooksPath`) and force pushes, and `permissions.ask` asks before
  `git reset --hard`, `git clean` and `rm -rf` on absolute, home or `.git` paths. These were human-only by rule;
  now Claude Code enforces it.

## [1.0.3] - 2026-10-18

Kit tooling only; no installed file changes, nothing for a project to do.

### Added
- `tools/e2e-check.mjs`: installs the kit into a fresh project and runs one plan through the whole cycle
  (Planner save, branch and push guards, slot claim, scope guard, ship-prep, push, merge, ledger close-out,
  slot release, drift and sync). A local bare repository stands in for GitHub. CI runs it on Linux and
  Windows for every push and PR, so a release cannot ship a broken cycle.

## [1.0.2] - 2026-10-18

Fixes found by running a fresh project (installed from GitHub) through plan, take-plan and ship. Nothing for a project to do.

### Fixed
- Scope guard: in a project with no i18n file or hotspots, the hotspot list rendered `''`, picomatch threw, and
  the guard failed open (every write allowed, `/ship` reported `scope: out`). Empty entries are dropped.
- `todo-query append` starts `.claude/todo.md` when it does not exist yet, so the first save-plan works.
- `pre-push`: the first push to an empty remote no longer prints a git error.
- Slot `npm install` no longer triggers the DEP0190 warning on Windows.
- `/plan` command text no longer shows `(retired)` placeholders.

## [1.0.1] - 2026-10-18

Installer fix; no managed file changes, nothing for a project to do.

### Fixed
- `kit-install` listed the Node built-in `net` as a devDependency (and `--install-deps` installed the
  unrelated npm package `net`). Built-ins now come from `module.builtinModules`.
- `--install-deps` no longer triggers Node's DEP0190 warning on Windows.

## [1.0.0] - 2026-10-18

First stable release: the source project runs on kit-sync.

### Added
- `kit-install --adopt` (`-Adopt`): brings a project that already carries the workflow under kit-sync. It
  writes only `.kit/install.json` and refuses while the drift check finds an undeclared difference.
  `--no-cursor` (`-NoCursor`) on install.
- `docs/CHANGE-LOOP.md`: how a kit change reaches projects (kit PR → release → `kit-sync -Ref`), semver
  rules for releases, and what to do with a fix found inside a project.

### Changed
- The scope guard's note for a kit-owned file in a plan's scope now says to make the same change in the kit
  and release it, so the next kit-sync sees a matching file.
- Versioning: from `1.0.0`, minor and patch releases never ask a project to act.

### Fixed
- `drift-check` no longer reports an overridden seed as "not a managed kit file".

## [0.5.0] - 2026-10-18

First tagged release.

### Added
- Install, sync and drift-check from a tagged GitHub release: `--source github:<owner>/<repo> --ref <tag>`
  (`-Source` / `-Ref` on the `.ps1` wrappers). The tag is fetched shallow into a per-user cache
  (`~/.cache/ai-workflow-kit/<owner>/<repo>/<tag>/`, or `$AI_WORKFLOW_KIT_CACHE`) and reused while the tag
  still points to the same commit. A tag that moved after it was cached is refused.
- `.kit/install.json` records `source`, `ref` and `commit`. Sync and drift-check use them when no
  `--source` is given; `sync --ref <tag> --apply` upgrades and records the new release. A ref that does not
  exist fails with `ref <tag> not found` before anything is written.
- `--source <kit folder>` for kit development; a plain run records `local:<path>`.
- `leak-check` accepts files as `--root`, and `KIT_LEAK_TERMS` adds private terms from the caller's
  environment. CI also checks `README.md` and `CHANGELOG.md`.
- This changelog, a rewritten README and the release steps.

### Changed
- Workflow files name "the Human" instead of a person.

### Fixed
- `take-plan.mjs` imports `mkdirSync`; a resumed claim no longer crashes.
- `/take-plan` prints only the plan brief at claim time; validation cards stay at close-out (`/done`, `/ship`).

## [0.4.0] - 2026-10-17

Phases 4 to 6A, never tagged. Projects installed from a local kit folder.

### Added
- Installer (`tools/install.mjs`), sync (`tools/sync.mjs`) and the 17 template skeletons; `.ps1` wrappers.
- Drift check (`tools/drift-check.mjs`, `kit-drift.ps1`): byte-for-byte comparison of every managed file.
- Project overrides in `kit.config.json`: install skips them, sync reports `override`, never `conflict`.
- Brain lessons install as seeds (written once, never updated).
- Ownership guard, architecture-invariants gate, plain-language validation cards, open plan folders
  (`plans.openDirs`), automatic plan close-out on merge, skills v2 (14 → 10 skills with scripts and evals).
- Slot dev servers on demand, orphan sweep, per-run slot server logs, plain explanatory titles on Atomic Sub-tasks.

### Fixed
- Squash-merge detection, stale session pointers, todo-sync counting, LF line endings for byte-exact
  comparisons on Windows, and placeholders that rendered wrong in a real project.

## [0.3.0] - 2026-10-02

### Added
- Stack packs (`packs/angular`, `packs/node-express`) with the `pack.json` contract, the optional Cursor
  layer, and the generalized brain lessons.

## [0.2.0] - 2026-10-01

Phases 1 and 2, before this repository existed: the workflow was extracted from its source project into a
stack-neutral `core/` with `{{placeholder}}` config keys and a leak check.

[Unreleased]: https://github.com/WDD-CODER/ai-workflow-kit/compare/v1.3.1...HEAD
[1.3.1]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.3.1
[1.3.0]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.3.0
[1.2.0]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.2.0
[1.0.5]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.0.5
[1.0.4]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.0.4
[1.0.3]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.0.3
[1.0.2]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.0.2
[1.0.1]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.0.1
[1.0.0]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v1.0.0
[0.5.0]: https://github.com/WDD-CODER/ai-workflow-kit/releases/tag/v0.5.0
