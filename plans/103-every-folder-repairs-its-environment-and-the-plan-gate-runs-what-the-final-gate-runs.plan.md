# Plan 103 — Every folder repairs its environment, and the plan gate runs what the final gate runs

Status: draft
Depends-on: none
Snapshot: 99037d4
Source: the stops audit of 16 FoodVibe runs, mapped on 2026-11-08 (groups C, D, I: stops #1, 3, 4, 7, 8, 10–12, 15–17, 22, 24, 28, 32, 35). The Human took every recommendation on 2026-11-08. Reliability fix, allowed in the freeze; no new capability.

## Problem Statement
1. **Folders without their packages.**
   - The merge folder had no `node_modules` (`'ng' is not recognized`, #7: the Human installed and merged by hand).
   - The server tree had no `mongodb` (#8).
   - In both cases the gate's environment retry ran the same failing command again, then parked the plan.
2. **State and git calls that fail once.**
   - `orch-state` answered without a readable `ORCH_JSON`, which parked a plan before building (#10, 2 h lost). The same thing needed retries at #16 and #22.
   - `git fetch origin` failed with "incorrect old value provided" during a park, so the work had to be saved by hand (#32).
3. **The final gate catches what each plan's gate did not.**
   - The kit manifest check (#15, #28) and the breadcrumbs check (#17) failed only on the run branch. Each cost about 1.5 h and the Human's fixes.
   - The error review notes that the per-plan manifest check reads the main folder's tree, not the plan's.
4. **Long Windows paths break a run folder.** In run-095 a plan that passed its gate parked because its review folder hit the 260-character path limit; `git config core.longpaths true` fixed it by hand, and the kit neither sets nor checks it.
5. **Work left undone merges anyway.** A builder that reports an `[auto]` or `[ui]` Done-when item as not done (for example "no backend or database" for an e2e screenshot, #35) still reaches the merge.

## Goals & Success Criteria
**Primary:** a missing package, a one-off state or git failure, or a check that only the final gate runs never parks a plan or stops a run; an item the plan promised is never merged undone.

- [auto] `node --test tools/test/orchestrator-env-retry.test.mjs` passes, with tests that fail on today's code:
  (a) before the builder, the gate, the merge checks, the final gate and a park, the folder gets `ensure-env`: install with the lockfile in the root, in `server/` when `server/package.json` exists, and in `scripts/`. Each install is skipped when its lockfile hash is unchanged (the existing `.last-npm-install-hash*` markers);
  (b) a gate or merge check that fails with an environment failure runs `ensure-env` (with a clean reinstall of the failing tree) before its one retry, not the same command again;
  (c) an `orch-state` call whose output has no readable `ORCH_JSON` is retried up to 3 times, 2 s apart, for read commands and for commands that are safe to repeat (`set`, `note` with its id, `touch`, `diff`, `plan-info`). Any other command fails as today;
  (d) `git fetch` and `git push` in the run's helpers are retried up to 3 times, 5 s apart, on a transient error (`incorrect old value`, `cannot lock ref`, a network error). After a failed park the work is still saved to `park/<run>-<NNN>`;
  (h) `orch-preflight.mjs` has a `git longpaths` check (error-review run-095: a review folder failed with "Could not reset index file" at the 260-character path limit). On Windows, when `git config --get core.longpaths` in the main folder is not `true`, it repairs it with `git config core.longpaths true` (the repository config, which every run folder of that repository shares) and prints `OK git longpaths (set to true)`. When that command fails, it prints `FAIL git longpaths: run git config core.longpaths true in <main folder>`. Off Windows it prints `SKIP git longpaths: not Windows`. A test-only `ORCH_PLATFORM` replaces `process.platform`; the test covers repaired, already true, a failed set, and not Windows.
- [auto] `node --test tools/test/run-plans.test.mjs` passes, with tests that fail today:
  (e) every command the final gate runs (`gateCommands` plus `orchestrator.ciMirror`) is in each plan's gate, and the manifest check reads the plan's folder;
  (f) a final-gate failure whose failing command's output names a file that exactly one merged plan changed gives that plan one fix round in its folder (a new `finalGate.blamed` field records that plan; `finalGate` has no blame today), a re-merge and a second final gate. A second failure stops the run as today;
  (g) a builder result whose `notDone` names an open `[auto]` or `[ui]` Done-when item fails the gate with `Done-when item left undone: <item>`. When the reason names a backend, database or dev server, the main folder's servers are started the way plan 058 starts them, then the fix round runs.
- [auto] `docs/agent/orchestrator.md` describes `ensure-env`, the retries and the final-gate fix round.
- [auto] `npm run build`, `npm run lint`, `npm test` and `node tools/drift-check.mjs --target .` pass (the builder runs the kit sync with apply first; it is a step, not a check).
- [human] On the installed project, delete `node_modules` in the merge folder before a run's first merge. The plan still merges, and the run note says the folder was installed (reply `ok`).

## Execution Mode
- Parallel: no.
- Concurrent plans: none.
- Isolated DB: no.
- Run: in the same run as 100, 101, 102, 104. `orch/<run>` merges into `main` only by a PR the Human approves.
- Fallback: when the dry run says `WOULD START: no`, append one line with the date and the reason to `docs/brain/error-review.md` first, then build this plan by the solo flow (`feat/103-<slug>`, then `/ship`).

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspots `CHANGELOG.md` and `docs/brain/error-review.md`.

```scope
core/scripts/run-plans.mjs
scripts/run-plans.mjs
core/scripts/lib/plan-gate.mjs
scripts/lib/plan-gate.mjs
core/scripts/lib/plan-merge.mjs
scripts/lib/plan-merge.mjs
core/scripts/lib/orch-folders.mjs
scripts/lib/orch-folders.mjs
core/scripts/orch-state.mjs
scripts/orch-state.mjs
core/scripts/plan-park.mjs
scripts/plan-park.mjs
core/scripts/orch-preflight.mjs
scripts/orch-preflight.mjs
core/docs/agent/orchestrator.md
docs/agent/orchestrator.md
tools/test/orchestrator-env-retry.test.mjs
tools/test/run-plans.test.mjs
CHANGELOG.md
docs/brain/error-review.md
```

## Read Scope

Entire repo.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a step needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry.

## Architecture Impact
- INV-1: preserves — the final-gate fix round uses the blamed plan's own tier and counts against its `maxFixRounds`.

## Step 0 — Reality Check
1. `lib/orch-folders.mjs` `ensureDeps` (l.43; checked at bf8926e) and `preflight.mjs` / the `.last-npm-install-hash*` markers: reuse them for `ensure-env`; name the one function every step calls.
2. `lib/plan-gate.mjs` `runGate` (l.171): how `status: 'env'` is decided (l.201), and where the retry is: `run-plans.mjs` l.607 and l.655 run `orch-preflight.mjs --env-only` (with `--probe` at l.655) before the one retry; `ensure-env` goes between the failure and the retry.
3. `lib/plan-merge.mjs` `orchState` (l.26) and `run-plans.mjs` `state()` (l.284): one place for the `ORCH_JSON` retry, with the list of commands that are safe to repeat.
4. `run-plans.mjs` final gate (`let finalGate` l.756, `finalChecks` and the gate l.808–820; no `blamed` field exists) and `gateCommands` (`lib/plan-gate.mjs` l.76; the manifest command l.86 runs the main folder's script through `kitRoot`, the plan gate passes `kitRoot: ROOT` at `run-plans.mjs` l.393). Keep the script from the main folder (the comment at `plan-gate.mjs` l.84: a builder never supplies its own check) and make it read the plan folder's tree, for example by its working directory or a `--root` argument.
5. The builder result's `notDone` field (`run-plans.mjs` l.629, the note `builder left undone`), and how an item is matched to an open Done-when line.
6. `orch-preflight.mjs` header comment (its list of checks) and the checks themselves: the `git longpaths` check sits beside `git identity`, and runs in the full preflight and with `--env-only`.

## Atomic Sub-tasks
- [x] S1: Write the failing tests first for installs, the environment retry, state retries and git retries — cases (a)–(d) — tools/test/orchestrator-env-retry.test.mjs
- [x] S2: Write the failing tests for the plan gate, the final-gate fix round and undone items — cases (e)–(g) — tools/test/run-plans.test.mjs
- [x] S3: Install what a folder is missing before every step that runs code there — ensure-env — core/scripts/lib/orch-folders.mjs, core/scripts/run-plans.mjs, core/scripts/lib/plan-merge.mjs
- [x] S3b: Turn on long Windows paths for git before a run, or say the exact command when that fails — git longpaths check, case (h) — core/scripts/orch-preflight.mjs, tools/test/orchestrator-env-retry.test.mjs
- [x] S4: Retry a state call or a git call that fails once — core/scripts/lib/plan-merge.mjs, core/scripts/run-plans.mjs, core/scripts/orch-state.mjs, core/scripts/plan-park.mjs
- [x] S5: Run the final gate's commands in every plan's gate, on the plan's own tree — core/scripts/lib/plan-gate.mjs, core/scripts/run-plans.mjs
- [x] S6: Give the blamed plan one fix round when the final gate fails — core/scripts/run-plans.mjs
- [x] S7: Fail the gate on a promised item left undone, and start the servers it needed — core/scripts/run-plans.mjs
- [x] S8: Describe the rules, resync the installed copies, run every check, add the changelog entry — core/docs/agent/orchestrator.md, CHANGELOG.md

## Technical Considerations
- `ensure-env` never deletes a tree unless the failing command was an environment failure in that tree; a clean reinstall happens at most once per plan.
- Running the final gate's commands in every plan gate makes each gate slower. `orchestrator.mergeChecks` stays `build`, so the merge itself stays fast.

## Out of Scope
Questions to the Human or the advisor (plan 104); relaunching a dead run (plan 100); project-specific checks (for example FoodVibe's breadcrumbs) beyond running what the project's own gate and `ciMirror` list.

## Critical Questions
None open.

## Execution Notes
- 2026-11-08 Builder: npm run build -> exit 0; npm run lint -> exit 0; npm test -> exit 0; node --test tools/test/orchestrator-env-retry.test.mjs -> exit 0 (11 pass); node --test tools/test/run-plans.test.mjs -> exit 0 (47 pass); node tools/drift-check.mjs --target . -> ok; scope-check (kit copy) -> SCOPE: ok.
- 2026-11-08 Builder: the (f) final-gate fix round has unit tests (blameFinalGate) and source-shape tests only, no end-to-end test (the fake-builder fixture is outside this plan's scope). The [human] item stays open.
- 2026-11-08 Planner: Depends-on no longer names 098/099 — both are merged into main (4518804); their open [human] items do not gate this code, and the run would otherwise rebuild them.
