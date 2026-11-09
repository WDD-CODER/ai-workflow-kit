# Plan 106 — A validation run proves each new orchestrator behaviour in a sandbox, and the Human only reads the report

Status: done
Depends-on: none
Snapshot: 933f618
Source: the Human, 2026-11-09, after release v3.0.0 (plans 100–104): "create dummy tests, dummy plans and dummy actions … run it through a prompt that will give it a goal to execute each and every one by itself and report exactly what happened … the Human only reads the results." Today the five `[human]` items of plans 100–104 can only be checked by hand on an installed project after a release.

## Problem Statement
1. **Five behaviours shipped in v3.0.0 have no proof outside unit tests.** Plans 100–104 each end with a `[human]` item that needs an installed project, a real run and a person watching: a run that survives its session (100), a sibling test that no longer parks (101), a plan file edited mid-run (102), missing packages in the merge folder (103), a question that stops only its own plan (104).
2. **A person checking them is slow and not repeatable.** Each check needs a staged situation (a killed session, an edit at the right moment, a deleted folder, an answer typed at the right time) and a judgment of what happened.
3. **The kit has the parts but not the cases.** `tools/test/lib/run-plans-fixture.mjs` makes a throwaway project with the kit installed and a local origin; `tools/test/fixtures/fake-claude.mjs` plays the builder and reviewer; `tools/orchestrator-e2e.mjs` runs a fixed diamond of plans. Nothing stages these five situations, and nothing runs them with real models.

## Goals & Success Criteria
**Primary:** one command runs every case in a throwaway sandbox, stages each situation itself, decides PASS or FAIL from the run's own files (never from an agent's opinion), and writes one report the Human reads. Nothing in it needs the Human, FoodVibe or GitHub.

- [auto] `node tools/validate-orchestrator.mjs --mode fake` exits 0 and its report lists V1–V5 as PASS. Each case's evidence lines are quoted from the sandbox: `status.json`, the run notes, `calls.csv` and `git log` of the sandbox's run branch.
- [auto] Negative control: `node tools/validate-orchestrator.mjs --mode fake --kit-ref v2.1.0` installs the kit from tag v2.1.0 (before plans 100–104) into the sandbox. It exits 1, and its report lists V1–V5 as FAIL, each with the evidence that shows why. A case that passes on v2.1.0 does not test its behaviour and must be rewritten.
- [auto] `node --test tools/test/validate-orchestrator.test.mjs` passes. It covers the case runner itself: a case that times out is FAIL with `timed out after <n> s` (never PASS), a sandbox is removed after the run unless `--keep`, the report always has one row per case, and `--cases V2,V4` runs only those.
- [auto] The CI job `kit-tests` (`.github/workflows/leak-check.yml`) runs `node tools/validate-orchestrator.mjs --mode fake` after the tool tests, and the job fails when a case fails.
- [auto] `node tools/validate-orchestrator.mjs --mode real --dry-run` prints each case's builder calls (`claude -p … --model sonnet`), the token cap (default 3,000,000 input tokens for the whole run, `--max-input-tokens <n>`) and the sandbox folder, and calls no model.
- [auto] The executing agent runs `--mode real` once, after every check above passes. It commits the report as `docs/validation/<YYYY-MM-DD>-real.md` and, for every case that is not PASS, adds one line to `docs/brain/error-review.md`. A real-mode FAIL does not block this plan: the report is the result.
- [auto] `.claude/commands/validate-run.md` exists (kit repository only, like `/kit-learn`; never rendered into a project). It runs the tool in the mode it is given (default `fake`), waits, and prints the report as it is, with a one-line verdict first. On a FAIL it attaches that case's run log path and does not fix anything.
- [auto] `npm run build`, `npm run lint`, `npm test`, `node --test "tools/test/*.test.mjs"`, `node --test tools/test/size-budget.test.mjs` and `node tools/drift-check.mjs --target .` pass.
- [human] The Human reads `docs/validation/<date>-real.md` and the fake-mode report printed by `/validate-run`. Nothing else is asked of the Human (reply `ok`, or name a case that looks wrong).

## The cases (the tool's data — one module per case)

Every case gets a fresh sandbox from `makeProject` (kit installed from the working tree, or from `--kit-ref <tag>` via `git worktree add` of that tag into a temp folder), its own dummy plans committed on the sandbox's `main`, and its own run name. Each case returns `{ id, verdict: 'PASS'|'FAIL', why, evidence: [lines], seconds }`. A case has a time limit (fake 300 s, real 1800 s); past it, the case is FAIL with `timed out`.

| Case | Behaviour (plan) | Dummy plans | What the case does | PASS only when |
| --- | --- | --- | --- | --- |
| V1 | a run survives its session (100) | one toy plan whose builder takes ~20 s (`sleepMs` in fake mode; a small real task in real mode) | starts the run with `scripts/run-supervisor.mjs`, waits for `SUPERVISOR_STARTED <pid>`, then kills the launching process tree (Windows `taskkill /T /F /PID <launcher>`; elsewhere a kill of its process group) | the supervisor and run go on: `status.json` reaches `finished`, the plan is merged, the report exists, and `stops[]` holds no `process died` entry |
| V2 | a sibling test needs no scope line (101) | scope lists only `src/price.mjs`; the task changes the price rule, so `src/price.test.mjs` (beside it, not in scope) must change too | runs the plan | merged; no note or park reason holds `test-out` or `replan needed`; the run branch's diff for the plan touches `src/price.test.mjs` |
| V3 | a plan file edited mid-run (102) | one toy plan whose builder takes ~20 s | when `status.json` says the plan is `building`, commits a one-line edit to that plan's file on the run branch and pushes it | merged; a run note or the report's `## Plans changed during the run` names the plan file; no park |
| V4 | missing packages repaired (103) | the sandbox app has a real `package-lock.json` whose only dependency is a local folder (`"toy-dep": "file:./vendor/toy-dep"`), so `npm ci` needs no network; the gate's test imports it | after the plan's gate passes and before its merge checks (watch `status.json` for the merge step, or the fake reviewer's step), deletes `node_modules` in the run's merge folder | merged; a run note says the merge folder was installed (`ensure-env: installed`) |
| V5 | a question stops only its plan (104) | two independent plans: P1 needs a file outside its scope (fake: an `escalate` step with `ask.kind: scope`; real: the task names the extra file), P2 is a plain toy | when `watch` prints `ASK <id>`, answers with the card's own command (`--choice` of the `approved:` option) | P2 merged before P1's answer; P1 resumed in the same run (a note `resumed from park/…`), its scope on the run branch holds the extra file, and P1 merged |

Real mode uses the same five cases. Each dummy plan's task is written so that only one change passes its gate (the test checks the exact new value), so a real builder cannot pass a case by doing something else.

## Execution Mode
- Parallel: no.
- Concurrent plans: none.
- Isolated DB: no.
- Run: **solo flow** (`git switch -c feat/106-<slug>` from `origin/main`, build here, then `/ship`). Not `/orchestrate`: S7 writes `.claude/commands/validate-run.md`, and an unattended builder is refused every edit under `.claude/` (plan 105).
- The real-mode run (S9) uses real `claude` calls on Sonnet in a sandbox under the system temp folder; it never touches this repository's branches, GitHub or any other project.

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspots `CHANGELOG.md` and `docs/brain/error-review.md`.

```scope
tools/validate-orchestrator.mjs
tools/lib/validate/**
tools/test/validate-orchestrator.test.mjs
tools/test/fixtures/fake-claude.mjs
tools/test/lib/run-plans-fixture.mjs
.claude/commands/validate-run.md
docs/validation/**
docs/agent/kit-validation.md
.github/workflows/leak-check.yml
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
- INV-none: preserves — a kit-repository tool and test fixture; no installed script, setting, agent or model tier changes. The fake builder gains step kinds only tests use.

## Prerequisites
- Release v3.0.0 merged into `main` and tagged (the cases test that code), and tag `v2.1.0` exists (the negative control). Both are true on 2026-11-09.

## Step 0 — Reality Check
1. `tools/test/lib/run-plans-fixture.mjs`: `makeProject({ kit, config })`, `addPlans`, `runPlans`, `startPlans`, `status`, `state`, `git`, `cleanup`. A case needs: a kit folder to install from (for `--kit-ref`, a `git worktree add --detach <temp> <tag>` of this repository), extra committed files (the price app, the local dependency, a lockfile), and the real `claude` (no `RUN_PLANS_CLAUDE`) in real mode.
2. `tools/test/fixtures/fake-claude.mjs` step kinds: `gate`, `text`, `sleepMs`, `extraFile`, `tamper`, `rateLimit`. V2 needs a step that edits a named file (`editFiles: { "src/price.test.mjs": "…" }`), and V5 needs one that returns `status: ESCALATE` with an `ask` object (the format in `docs/agent/agent-roles.md` "The builder's question").
3. `scripts/run-supervisor.mjs`: how it prints `SUPERVISOR_STARTED <pid>`, and which process V1 kills (the launcher, not the supervisor).
4. The merge step in `scripts/run-plans.mjs` and `lib/plan-merge.mjs` (`ensure(false)` before the merge checks): the moment V4 deletes `node_modules` must be after the merge folder exists and before that call. Find a state or note the case can wait on. If there is none, use the fake reviewer's step with `sleepMs` as the window and record this in Execution Notes.
5. `orch-state.mjs watch` and `answer`: the card's answer line V5 copies.
6. The CI job `kit-tests` in `.github/workflows/leak-check.yml`: where the new step goes, and its time limit (fake mode must stay under 10 minutes).
7. A sandbox kit from `--kit-ref v2.1.0` has no `run-supervisor.mjs`. V1 then reports FAIL with `no scripts/run-supervisor.mjs in the installed kit`, which is the expected negative result, not a tool error.

## Atomic Sub-tasks
- [x] S1: Write the failing tests first for the case runner: timeout is FAIL, cleanup, one row per case, case filter — tools/test/validate-orchestrator.test.mjs
- [x] S2: Teach the fake builder to edit a named file and to ask a question — editFiles and escalate steps — tools/test/fixtures/fake-claude.mjs
- [x] S3: Let a sandbox install the kit from a tag and carry extra files and a lockfile — kitRef, files options — tools/test/lib/run-plans-fixture.mjs
- [x] S4: Add the case runner and the report writer, PASS or FAIL decided only from the sandbox's files — tools/validate-orchestrator.mjs, tools/lib/validate/run.mjs, tools/lib/validate/report.mjs
- [x] S5: Add the five cases, each staging its situation itself and quoting its evidence — tools/lib/validate/cases/v1-session.mjs … v5-ask.mjs
- [x] S6: Add real mode with a token cap and a dry run that calls no model — tools/validate-orchestrator.mjs
- [x] S7: Add the kit-only command that runs the tool and prints the report as it is — .claude/commands/validate-run.md
- [x] S8: Run fake mode in CI and describe the tool and its cases — .github/workflows/leak-check.yml, docs/agent/kit-validation.md, CHANGELOG.md
- [x] S9: Prove it: fake mode PASS, the v2.1.0 control FAIL, then one real-mode run with its report committed — docs/validation/<date>-fake.md, docs/validation/<date>-v2.1.0-control.md, docs/validation/<date>-real.md

## Technical Considerations
- **Honesty is built in.** A verdict comes only from files: `status.json`, the run notes, `calls.csv`, `git log`/`git show` of the sandbox's run branch, and the console log. The report quotes them. No model reads them or writes a verdict. The negative control (v2.1.0) shows that each case can fail.
- **Real mode can be flaky.** A real builder may take a different route. Each real dummy task has exactly one passing change. A real-mode FAIL is a finding, recorded in the error review, not a reason to soften the case.
- **Cost.** Real mode is at most about 10 Sonnet builder calls and 10 reviewer calls on tiny plans, and the token cap stops it before the cap. The report prints the tokens from each sandbox's `calls.csv`.
- **Windows first.** The Human runs on Windows 11. V1's kill uses `taskkill /T /F`, and all paths go through `path.join`. CI (ubuntu) runs fake mode with the process-group kill.
- **Size budget.** No `core/.claude/commands` file is added (the cap is 24 of 24): `validate-run.md` is kit-only under `.claude/commands/`, like `kit-learn.md`. No orchestrator key is added.

## Out of Scope
FoodVibe or any installed project; GitHub (the sandbox origin is a local bare repository); plan 105's `.claude/` refusal (V-cases for it come with plan 105); changing any shipped script to make a case pass. If a case finds a bug, it is reported, and its fix is a new plan.

## Critical Questions
None open. (The Human, 2026-11-09: the Human only reads the results; validation runs without the Human.)

## Execution Notes
- 2026-11-09 Builder: the first fake run found a shipped bug — V1 FAIL, every supervised run crashed at start (run-plans.mjs l.703, `dirname(null)`). Per Out of Scope it was not fixed here: plan 110 fixed it (v3.0.1, merge c6a627d); this branch was then rebased on it and V1 passes.
- Step 0 item 4: no state marks the moment between the merge folder's creation and `ensure(false)`. V4 uses two plans instead (B depends on A): A's merge installs the merge folder, and `node_modules` is deleted while B builds, so B's merge must install it again.
- Each dummy plan's [auto] check is `node scripts/check-<NNN>.mjs` (the dry run allows only npm scripts, `node tools/…`, `node scripts/…` and `node --test`), comparing exact file contents.
- V5 sets `RUN_PLANS_ASK_WAIT_MS` to 10 min in its sandbox (the fixture's default is 1 ms, which parks an ask at once).
- Evidence: validate-orchestrator.test.mjs → pass 6; fake mode → VALIDATION: PASS 5 of 5 (docs/validation/2026-11-09-fake.md); `--kit-ref v2.1.0` → VALIDATION: FAIL 5 of 5, each for its own reason (docs/validation/2026-11-09-v2.1.0-control.md); npm run build/lint/test → exit 0; size-budget test → pass 6; drift-check → KIT_DRIFT ok; leak-check → ok.
- Real mode (once, Sonnet, 576,861 of 3,000,000 input tokens): VALIDATION: FAIL 1 of 5 — V1, V3, V4, V5 PASS; V2 FAIL: the real builder asked (ESCALATE scope) instead of writing the sibling test, because `orch-builder.md` does not state the sibling-test rule the gate allows. A finding, recorded in docs/brain/error-review.md; its fix is a new plan (docs/validation/2026-11-09-real.md).
