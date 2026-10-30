# Plan 044 — A run ends clean: the final gate runs what CI runs, a test that passed only on rerun is recorded as a flake, plans close without a todo section, merge folders are removed, and a slot can serve the run branch for validation

Status: draft
Depends-on: 040
Snapshot: a363b42

## Problem Statement

FoodVibe's run-499-502 (kit v1.12.0) merged four plans; its close-out cost about 30 minutes of hand work and left
four leftovers. Plan 040 fixes the run itself; this plan fixes the end of it.

1. **A green run is not a green PR.** PR #487's `rules` job failed on `KIT_MANIFEST: FAIL — 3 unclassified`; FoodVibe
   plan 509 hit the same failure the day before (≈10 min each). Plan 040 A4 adds that one check to the final gate.
   The next CI-only job will repeat this: the final gate runs `PROJECT_CHECKS` (`orchestrate.js` ~l.39) plus 040's
   manifest check, and nothing says which other CI commands the run skips.
2. **Flakes leave no record.** PR #485's `test` job failed on two `ProductFormComponent` timeouts and passed on a rerun;
   PR #487's `server-tests` failed on a `mongodb-memory-server` lock race. Inside a run, a check that fails and then
   passes with no code change looks like a normal fix round: `orch-gate` reruns an `env-fail` once and reports only
   the second result (`orch-gate.md` l.21–22), and a `fail` passed by a builder who committed nothing is not marked.
   Nobody can count flakes, so nobody fixes them.
3. **Plan close-out by hand collided with the bot.** `plan-close.mjs --dry-run` said `PLAN_CLOSE: nothing to close`
   for 506 (`findClosable` ~l.76–82 skips a plan with no archived todo section). The Planner closed it by hand; the
   todo-sync bot had already closed it (`a389c2dc`), so the push was rejected (`fetch first`) and needed a rebase.
4. **Leftovers.** `orch-merge-run-499-502`, `orch-merge-run-506-506` and `orch-merge-run-506-508` stayed after their
   runs merged: `free-merged-slots.mjs` only sees `-wt-N` slots (`listSlots`). wt-1 served the run branch for the
   Human's 15 validation cards after a hand checkout (`b661108b`), and every status view called it `detached idle`.

## Goals & Success Criteria
**Primary:** the final gate runs the CI commands the project lists; a flake is a recorded fact; a finished plan closes
once, by script; a merged run leaves no merge folder; a slot serving a branch for validation says so.

- [auto] `node --test tools/test/orchestrator.test.mjs` passes, with new tests: the final gate's checks are
  `PROJECT_CHECKS`, then 040's manifest check, then `orchestrator.ciMirror` (deduplicated, bad shapes dropped with a
  note); a gate result `pass` whose tail starts `rerun after env-fail:` records a flake; a gate `fail` followed by a
  passing gate on the same `headSha` records a flake, a new `headSha` does not; `formatReport` prints
  `## Flaky checks` only when `status.json` has flakes; `orchestratorProblems` refuses a bad `orchestrator.ciMirror`.
- [auto] `node --test tools/test/orchestrator-folders.test.mjs` passes, with new tests: `findClosable` closes a plan
  with no todo section when every sub-task is ticked and no `- [ ] [auto…]` Done-when item is open; `closePlans`
  skips a plan already gone from `origin/<main>` with `already closed on origin/<main> by <sha>`;
  `free-merged-slots.mjs` removes a clean merge folder of a merged run and leaves a live, dirty or unmerged one;
  `slot-serve --ref` checks out and writes `.worktree-validating`, `slot.mjs --list` prints `validating <branch>`,
  `slot-stop` clears it, and `idleSlot` never returns a validating slot.
- [auto] `node --test tools/test/guards.test.mjs` passes, and its timing asserts use the fastest of 3 runs per guard.
- [auto] `npm run build` and `npm test` pass (install-check renders `const CI_MIRROR = []` and refuses a bad value).
- [auto] `node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .` reports no drift.
- [human] After a kit sync, FoodVibe's `kit sync` prints a `NOTE ci-mirror:` line for each uncovered CI command, and
  the next run's report shows the final gate running the commands the Human put in `orchestrator.ciMirror`.

## Execution Mode
- Parallel: no
- Concurrent plans: none
- Isolated DB: no

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/.claude/workflows/orchestrate.js
core/.claude/agents/orch-gate.md
core/.claude/commands/orchestrate.md
core/.claude/commands/plan.md
core/scripts/orch-state.mjs
core/scripts/lib/orch-run.mjs
core/scripts/lib/orch-folders.mjs
core/scripts/lib/done-when.mjs
core/scripts/lib/slot.mjs
core/scripts/plan-close.mjs
core/scripts/free-merged-slots.mjs
core/scripts/slot-serve.mjs
core/scripts/slot-stop.mjs
core/scripts/take-plan.mjs
core/scripts/local-excludes.mjs
core/docs/agent/orchestrator.md
core/docs/brain/gotchas/agent-workflow.md
kit.config.json
tools/lib/kit.mjs
tools/install.mjs
tools/sync.mjs
tools/install-check.mjs
tools/e2e-check.mjs
tools/test/guards.test.mjs
tools/test/orchestrator.test.mjs
tools/test/orchestrator-folders.test.mjs
tools/test/agent-contracts.test.mjs
.claude/**
scripts/**
docs/agent/**
docs/brain/**
.kit/install.json
CHANGELOG.md
```

## Read Scope

Entire repo. Analysis and architectural suggestions are expected.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry.

## Architecture Impact

- INV-none: preserves — `docs/brain/invariants.md` holds only the template entry; no invariant is touched.

## Step 0 — Reality Check

Runs only when `scope-check.mjs --drift` reports `REALITY: drift`. Check by symbol: the final-gate block in `run()`
(as plan 040 A4 left it: `init.kitManifest`), `gate()`, the fix loop in `runPlan` (`lastWhy`), `init()` and the `set`
command in `orch-state.mjs`, `formatReport`, `findClosable`, `free-merged-slots.mjs` `main()`, `idleSlot`,
`listSlots`, `slot-serve.mjs`. Print one line per commit: `ok` or `conflict: <what>`. STOP for a go only on a `conflict`.
Plan 040 must be merged first; if its A4 differs from its plan text, build on the code, not the plan.

## User Stories
- As the Human, I want the run to run the CI jobs I name, so a green run means a green PR.
- As the Human, I want every check that passed only on a second try listed in the report, so I can fix flaky tests
  instead of paying fix rounds for them.
- As the Planner, I want a finished plan closed by the script once, so I never race the todo-sync bot.
- As the Human, I want merged runs to leave no folders, and a slot serving a run branch to say "validating".

## Functional Requirements

### Must Have (P0)
- [ ] `orchestrator.ciMirror` (list, default `[]`) runs in the final gate after `PROJECT_CHECKS` and 040's manifest
  check; install and sync validate it and print a hint for uncovered CI commands.
- [ ] A flake is recorded in `status.json` (`plans[NNN].flakes[]`, the final gate's in `flakes[]`) and the report.

### Should Have (P1)
- [ ] `plan-close.mjs` closes a fully ticked plan with no todo section, and by hand skips one closed on origin.
- [ ] `free-merged-slots.mjs` removes clean merge folders of merged runs.

### Nice to Have (P2)
- [ ] `slot-serve --ref <branch>` and a `validating` slot state that the run, take-plan and status views respect.

## UI/UX Notes
- New output strings: `NOTE ci-mirror: <workflow file> runs "<cmd>" — the run's final gate does not; add it to
  orchestrator.ciMirror in kit.config.json to run it there`; `ci-mirror check dropped, not run: <why>`;
  `flake: <command> (plan <NNN>, round <n>)` / `flake: <command> (final gate)`; report `## Flaky checks`;
  `PLAN_CLOSE: skipped <file> — already closed on origin/<main> by <sha>`; `merge folder <path>: removed (run branch
  <branch> merged; local branch kept)` / `merge folder <path>: left alone — <why>`; `wt-<n>: detached validating
  <branch> since <time>`; `SLOT_SERVE: wt-<n> validating <branch> @ <sha7>`; `SLOT_STOP: validating <branch> ended`.

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [ ] A1: Add the CI mirror setting with validation, so a bad value stops install and sync before it reaches a run — `kit.config.json` `orchestrator.ciMirror: []` plus a `$comment` sentence (allowed shapes, run after the manifest check, suggestion-only hint); `orchestratorProblems` refuses a non-list (`orchestrator.ciMirror is <v> — it must be a list of check commands (npm run <script>, pnpm run <script>, node scripts/… or node tools/…)`) and each bad item (`orchestrator.ciMirror item "<cmd>" — <why>`) with the same rules as `checkProblem`: shape `^(npm|pnpm) run [A-Za-z0-9:_-]+$` or `node (scripts|tools)/<file>.m?js` with `SAFE_ARG` words, no `..`, not a `NOT_A_CHECK` kit script, no `--write|--apply|--fix|--update`; one shared `ciCommandProblem(cmd)` in `tools/lib/kit.mjs` — kit.config.json, tools/lib/kit.mjs, tools/install-check.mjs
- [ ] A2: Run the mirrored CI commands in the final gate — `const CI_MIRROR = {{orchestrator.ciMirror|json}}`; `init()` also emits `npmScripts: npmScripts()`; the final gate's list is `[...new Set([...PROJECT_CHECKS, ...(init.kitManifest ? [manifest] : []), ...CI_MIRROR.filter(ok)])]` where `ok` = `!checkProblem(c, init.npmScripts)`; each dropped one is a run note `ci-mirror check dropped, not run: <why>`; the gate runs when that list is non-empty (today: `PROJECT_CHECKS.length`) — core/.claude/workflows/orchestrate.js, core/scripts/orch-state.mjs
- [ ] A3: Tell the Human which CI commands the run skips, at install and sync — `ciMirrorHints({ workflows: [{ file, text }], covered })` in `tools/lib/kit.mjs` reads each `.github/workflows/*.yml|yaml` of the target: single-line `run: <cmd>` and every line of a `run: |` block, trimmed; a line that is exactly an allowed shape (A1) and not in `covered` (the rendered `PROJECT_CHECKS`, `node scripts/kit-manifest-check.mjs` when `docs/workflow-kit/manifest.json` exists, `orchestrator.ciMirror`) gives one `NOTE ci-mirror:` line; never written to config; install and sync print them after `backendNote` — tools/lib/kit.mjs, tools/install.mjs, tools/sync.mjs
- [ ] B1: Make the gate keep the trace of a rerun that passed — orch-gate rule: an `env-fail` rerun that passes is reported `pass` with `tail` `rerun after env-fail: <first run's last line>`; a `fail` is still never rerun — core/.claude/agents/orch-gate.md, tools/test/agent-contracts.test.mjs
- [ ] B2: Detect flakes in the workflow, in code — `gate()` returns `flaky: [commands]` (results `pass` whose tail starts `rerun after env-fail:`) on every return and `failedCmds` on a fail or env return; `runPlan` keeps `ctx.lastGateFail = { sha: b.headSha, cmds, round, kind }` after a gate fail or env-fail and clears it after any other failure; when the next gate passes and `b.headSha === ctx.lastGateFail.sha`, each of its `cmds` that passed now is a flake with `via: same-commit`; gate flakes are `via: rerun`; the final gate records its `flaky` with no plan — core/.claude/workflows/orchestrate.js
- [ ] B3: Write flakes to status.json from a script — new `orch-state.mjs flake --run <r> [--plan <NNN>] --command "<cmd>" --round <n> --via rerun|same-commit --where gate|main|final`; adds `{ command, round, via, where, sha?, at, text }` to `plans[NNN].flakes[]` (no `--plan`: run-level `flakes[]`), `text` = `flake: <command> (plan <NNN>, round <n>)` or `flake: <command> (final gate)`; same command and round twice is one entry; `FLAGS` gains `command`, `where` — core/scripts/orch-state.mjs
- [ ] B4: Show flakes in the report and the summary — `formatReport` prints `## Flaky checks` (after Plans) only when any plan or the run has flakes: `- <NNN>: \`<command>\` — round <n>, passed on the gate's rerun after env-fail` or `— passed on the next gate with no new commit (<sha7>)`; orchestrate.md step 4 prints `flaky checks: <n> (see the report)` read from status.json, never from memory — core/scripts/lib/orch-run.mjs, core/.claude/commands/orchestrate.md
- [ ] P1: Close a finished plan that never had a todo section — `findClosable`: a plan with no open and no archived section is closable when `atomicAllClosed` and `openAutoItems(text)` is empty; new `openAutoItems` in `lib/done-when.mjs` = Done-when items `- [ ] [auto]` / `- [ ] [auto:main]` (an item with no box has no state and does not block); an open todo section still blocks as today — core/scripts/plan-close.mjs, core/scripts/lib/done-when.mjs
- [ ] P2: Never close by hand what the bot already closed — `closePlans(root, { dryRun, closedOnOrigin })`; the CLI, unless `GITHUB_ACTIONS=true` or `--no-fetch`, runs `git fetch --quiet origin {{git.mainBranch}}` (failure → `PLAN_CLOSE: could not fetch origin/<main> (<err>) — nothing closed`, exit 0) and skips a closable plan whose open path is gone from `origin/<main>` (`git cat-file -e`), printing `PLAN_CLOSE: skipped <file> — already closed on origin/<main> by <sha7>` (`git log -1 --format=%h origin/<main> -- <file>`); /plan step 2 runs `node scripts/plan-close.mjs` after `todo-archive.mjs` and says never to close a plan by hand — core/scripts/plan-close.mjs, core/.claude/commands/plan.md
- [ ] M1: Remove merge folders of merged runs — `free-merged-slots.mjs` also reads `git worktree list --porcelain` for `<repo>-orch-merge-<run>` (repo = `{{project.repoName}}` or the folder name, as `orch-state.mjs`); left alone with the reason when the run is live (`liveRunHolds` by run name), it has an uncommitted file (`isClean`), or its branch is neither merged nor `[gone]` (`isMergedIntoOriginMain`); else `git worktree remove <path>` (never `--force`), local branch kept; one line per folder — core/scripts/free-merged-slots.mjs
- [ ] V1: Serve a branch in an idle slot for validation — `slot-serve.mjs --ref <branch>` (branch `^[A-Za-z0-9._/-]+$`, no `..`, not starting `-`): refuses a busy slot (`.worktree-plan`) or a dirty one; `git fetch origin <branch>`, `git checkout --detach origin/<branch>`, writes `.worktree-validating` (`branch`, ISO time, sha, one per line) through `startValidating({ path, branch, now })` in `lib/slot.mjs`, prints `SLOT_SERVE: wt-<n> validating <branch> @ <sha7>`, then serves as today — core/scripts/slot-serve.mjs, core/scripts/lib/slot.mjs, core/scripts/local-excludes.mjs
- [ ] V2: Make every view and claimer respect "validating" — `listSlots` adds `validating: { branch, at } | null`; `slot.mjs --list` prints `wt-<n>: detached validating <branch> since <at>`; `free-merged-slots` prints `wt-<n>: validating <branch> — left alone`; `idleSlot` skips it; `take-plan` refuses `slot wt-<n> is validating <branch> — run node scripts/slot-stop.mjs first`; `slot-stop` removes the marker and prints `SLOT_STOP: validating <branch> ended` (the SessionEnd hook runs it too); `.worktree-validating` joins `RUNTIME_IGNORES` — core/scripts/lib/slot.mjs, core/scripts/free-merged-slots.mjs, core/scripts/lib/orch-folders.mjs, core/scripts/take-plan.mjs, core/scripts/slot-stop.mjs, core/scripts/local-excludes.mjs
- [ ] C1: Document it — orchestrator doc: `ciMirror` row in Settings (`{{orchestrator.ciMirror|json}}`), final gate paragraph, flakes in "The report", merge folders in "Running beside a Planner session"; gotcha "a green run, a red PR" (what hurt: PR #487 and plan 509; do: list cheap CI jobs in `orchestrator.ciMirror`); Unreleased entries — core/docs/agent/orchestrator.md, core/docs/brain/gotchas/agent-workflow.md, CHANGELOG.md
- [ ] T1: Prove the run changes with tests that fail on today's code — the cases in the first Done-when item, with the `runFlow` stub (`gateTail` returning `rerun after env-fail: …` on a pass; a builder hook returning the same `headSha`) — tools/test/orchestrator.test.mjs, tools/test/agent-contracts.test.mjs
- [ ] T2: Prove the script changes in scratch repositories — the cases in the second Done-when item (bare origin like the existing `free-merged-slots` test) — tools/test/orchestrator-folders.test.mjs
- [ ] T3: Run the folder tests in CI — `tools/e2e-check.mjs` runs `tools/test/orchestrator-folders.test.mjs` with `ORCH_ROOT` = the project, like `orchestrator.test.mjs` — tools/e2e-check.mjs
- [ ] T4: Make the guard timing test steady on a loaded machine — in `tools/test/guards.test.mjs`, time each guard 3 times and assert `LIMIT_MS` on the fastest run, not on one run: a small helper (`fastest(n, run)` returning the run with the lowest `ms`) used by the three `r.ms`/`p.ms`/`f.ms` asserts in the no-op test (branch-guard, scope-guard, plan-write-guard; the branch-guard-on-a-plan and scope-guard-in-a-no-plan-folder cases too); the decision and `GUARD_GIT_CALLS` asserts stay on the traced run. Why: Git Bash start-up alone pushed `plan-write-guard.sh` to 2048 ms on a loaded Windows machine (2026-10-30, plan 036 build; passed on rerun) — tools/test/guards.test.mjs
- [ ] R1: Render the kit's own installed copies and check drift — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .` — scripts/, .claude/, docs/agent/, docs/brain/, .kit/install.json

## Technical Considerations
- Dependencies: plan 040 A4 (`init.kitManifest`, the final-gate list) — A2 extends that list, no second manifest check. `orchestrate.js` (`checkProblem` ~l.63, `gate()` ~l.384, `runPlan` ~l.570, final gate
  ~l.818–831), `orch-state.mjs` (`init()` ~l.302, `set` ~l.531, `FLAGS` ~l.72), `lib/orch-run.mjs` `formatReport`
  ~l.243, `plan-close.mjs` `findClosable` ~l.76, `free-merged-slots.mjs` `main()` ~l.72, `lib/slot.mjs` `listSlots`
  ~l.87, `lib/orch-folders.mjs` `idleSlot` ~l.73.
- `checkProblem` lives in the workflow script (placeholders, not importable), so A1 repeats its shape rules in
  `tools/lib/kit.mjs`; a test asserts both refuse the same samples.
- Cost (estimate): `ciMirror` adds no agent call — the same final `orch-gate` runs more commands (about 1–3k tokens
  per command on the mechanical tier, plus their wall time). Flake detection is code; each flake costs one runner call
  (`flake`), none on a run without flakes. P1, P2, M1, V1, V2 are scripts: no agent calls.
- Data: `plans[NNN].flakes[]` and `flakes[]` are new optional `status.json` fields; plan 045 reads them later.
  `.worktree-validating` is a new runtime file (gitignored through `RUNTIME_IGNORES`).
- Migration: P1 makes the next todo-sync close every open plan with all sub-tasks `[x]` and no todo section, in one
  PR (each listed as `PLAN_CLOSE: closed …`).
- Security: `ciMirror` is Human-set and passes the plan-check allowlist; `--ref` is validated before git (no shell);
  M1 never forces a removal and never deletes a branch.
- Windows: `git worktree remove` can fail on a locked file (a server still running): the line says so, the folder stays.

## Out of Scope
- The run preparing validation cards with real DB ids (the Planner did it with a scratch script in run-499-502) — a
  later idea; it touches the validation plans 022–024.
- Sending flakes to the kit's brain — plan 045. Fleet's dock showing "validating" — fleet reads `.worktree-plan` only
  (`mods/fleet/hooks/register.tsx`); plan 039 owns that file now.
- Fixing FoodVibe's flaky tests (handoff §7.4); rerunning a final-gate `fail` — it stops the run as today.
- `npx` → `pnpm run` in plan checks (P10) and the delegated-readiness rule (P13) — other plans.

## Critical Questions
- Q: Final gate mirrors CI — a generic config list, or just 040's manifest check? A: a generic list,
  `orchestrator.ciMirror`, run after `PROJECT_CHECKS` and the manifest check; the hint only suggests (Human, 2026-10-30).
- Q: Where does a flake go? A: record and report only — `status.json` and a report section; no quarantine; plan 045 sends it to the kit's brain (Human, 2026-10-30).
- Q: Print the CI-mirror hint in the run preflight too? Default: no — install and sync only; a run never waits on a suggestion.
- Q: Does a flake still cost the fix round it used? Default: yes — the run cannot know before the rerun; the record
  is what lets the Human fix the test.
- Q: Delete the merged run branch locally when M1 removes its folder? Default: no — a squash-merged branch needs
  `branch -D`, which is on the deny list; a kept branch costs nothing.
- Q: P1 closes old fully ticked plans in one todo-sync PR — ok? A: yes, one PR that lists each (Human, 2026-10-30).
- Q: Run `orchestrator-folders.test.mjs` in CI (T3)? Default: yes — no CI step runs it today.

## Execution Notes
- Source: run-499-502 handoff §3 P2 (follow-up beyond 040), P11, P12, §6.4; the Human's decisions on 2026-10-30.
- Handoff vs code: (1) §6.4 names the key `ci.mirrorInRun`; this plan uses `orchestrator.ciMirror` as decided.
  (2) The gate's `env-fail` rerun happens inside the `orch-gate` agent (`orch-gate.md` l.21–22), not in
  `orchestrate.js`; `gate()` ignores a passing result's tail, so a pass on rerun leaves no record today. A `fail` is
  never rerun by the gate — its second chance is the next round, hence the same-commit rule (B2). (3) The two FoodVibe
  flakes happened in CI, not in a run gate; this plan records flakes inside runs only. (4) P11 says plan-close needs
  the archived todo section — true for `plan-close.mjs` alone; but the bot's `todo-query.mjs sync --merged` creates a
  section for a plan whose `feat/NNN-*` branch is an ancestor of `origin/main`, then archives it, which is how the bot
  closed 506 while the Planner's lone `--dry-run` found nothing. P1 covers squash merges and deleted branches; P2
  covers the race. (5) Not in the handoff: `idleSlot` treats a detached slot with no `.worktree-plan` as free (its
  `dirty()` ignores `.worktree-*`), so a run could claim the slot the Human is validating in — V2 closes that.
  (6) `tools/test/orchestrator-folders.test.mjs` is not run by any CI step (e2e-check runs `orchestrator.test.mjs`).
- Overlap: 040 (final gate list, `init()` emit, `formatReport` — build on it); 039 (fleet — left out); 045 (reads
  `flakes[]`); 041 and 042 also edit `orchestrate.js` and `formatReport` — run after them or merge carefully.

## Finish — review hand-off (replaces /ship)

Build order: wave 1 — after 040; parallel with 030 and 043.

When the plan is fully implemented, finish with a review hand-off instead of shipping. Do NOT merge, do NOT run /ship,
do NOT open a PR. This replaces every merge, `/ship`, PR, release or tag step written elsewhere in this plan. `[human]`
items and Human steps stay open and are listed under "Open risks".

While implementing: whenever the plan leaves something open and you choose, note it right away so it appears under
"Decisions you made on your own".

Finishing steps:
1. Fetch origin and rebase this branch on the latest origin/main. If there are conflicts, stop and tell me which files
   conflict.
2. From the kit root run: npm run build, npm run lint, npm test. Fix failures that belong to this plan, then rerun.
   Also run this plan's own `[auto]` Done-when commands (they include `node --test tools/test/`, which `npm test` does
   not run); any that still fail go under "Open risks".
3. Commit everything and push the branch to origin.
4. Your final message must be exactly this block, plain text, nothing before or after it:

```text
=== REVIEW HAND-OFF ===
Plan: <number and title>
Branch: <branch name>
Head commit: <short hash>
Based on origin/main at: <short hash>

Steps (one line per plan step):
<step id> | done / partial / skipped | <file(s) changed> | <one-line note>

Not in the plan (changes you made that the plan did not ask for, and why):
<list, or "none">

Decisions you made on your own (anything the plan left open):
<list, or "none">

Checks:
build: pass/fail
lint: pass/fail
test: pass/fail
<if any failed: the failing lines only>

Files changed (git diff --stat origin/main...HEAD):
<paste>

Open risks / things you could not verify:
<list, or "none">
=== END ===
```
