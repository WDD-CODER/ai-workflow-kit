# Plan 043 — Readiness checks what a plan claims against the code, a delegated answer never approves an unseen main-folder command, and `npx` checks are kept as project scripts

Status: draft
Depends-on: 040
Snapshot: a363b42

## Problem Statement

FoodVibe's run-499-502 (kit v1.12.0) showed three gaps in readiness, the one step that reads every plan before
anything is built:

1. **Readiness trusts what a plan says about the code (P7).** Plan 501 said the AI draft editor has 3 row-delete
   handlers; there is 1 (D30). Plan 499 aimed to make *every* number box tap-to-edit, but four number boxes lie outside
   its Read-Write Scope (D7–D10). The builders were right to stay in scope and log `seen:`, but both gaps were found
   after the merge, as decisions to grade, not before the run as questions. `orch-readiness.md` has no step that
   checks a count, a named symbol or an "every X" goal against the code.
2. **A delegated answer approved a main-folder command nobody had seen run (P13).** The Human answered readiness with
   "decide yourself". The Planner answered the product questions and also approved the `[auto:main]` command
   `node scripts/log-query.mjs --since=plan-start --level=error`. It could not pass from the main folder; plan 500
   spent three fix rounds and was parked (≈50 min, one rerun). Plan 040 drops that one command shape; the general
   rule — the Planner, as the only reviewer, never approves a live-environment command it has not seen pass — is
   written nowhere. Plan 034 makes such a command wait for `go`, but `go` inside "decide yourself" proves nothing.
3. **`npx` checks are lost (P10).** The plans list `npx ng build` and `npx ng test`. `checkProblem` accepts only
   `npm|pnpm run <script>`, `node scripts|tools/…` and `node --test`, so readiness put them in `denied` — and `denied`
   alone does not make `askHuman` true. In run 506, 8 checks were dropped this way. No harm this time (the gate runs
   the project's build and tests anyway), but a plan-specific `npx` check disappears where nobody sees it.

## Goals & Success Criteria
**Primary:** before a run starts, the Human sees every wrong count or uncovered "every X" in a plan as a question with
a default; a delegated answer keeps only the main-folder commands that passed once from the main folder; an `npx`
check runs as the project script that does the same thing, or becomes a question.

- [auto] `node --test tools/test/orchestrator.test.mjs` passes, with new tests that fail on today's code: a readiness
  claim with a question becomes a plan question and makes `askHuman` true; more than 8 claims keep 8 and report the
  rest as `claimsOver`; an "every X" claim with hits outside scope asks `widen scope … or leave them as follow-ups?`
  with `Default if unanswered: leave them as follow-ups`; `npx ng build` maps to `<pm> run build` when a script body is
  `ng build`; an unmapped `npx` check is in `denied` and shown, never asked; `mainDelegated` drops a main check that `main-tries`
  does not list, with the note `main-folder check dropped: not seen passing from the main folder — <command>`; the
  fixture plans give the expected claims through the rule mirror.
- [auto] `node --test tools/test/orchestrator-folders.test.mjs` passes, with `main-try` / `main-tries` tests on a real
  temp repo.
- [auto] `node --test tools/test/agent-contracts.test.mjs` passes: the validator accepts `claims`, rejects a claim
  without `found`.
- [auto] `npm run build` and `npm test` pass.
- [auto] `node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .` reports no drift.
- [auto] `node --test tools/test/orchestrator.test.mjs` has a test that fails on today's code: `mainChecks` holding only a
  `--since=plan-start` command and no `mainApproved` → the run does not stop on `main-approval`, and the plan gets the
  `main-folder check dropped, not run` note (A10).
- [human] The next FoodVibe `/orchestrate` (after a kit sync) on plans with a count or an "every X" goal lists the
  claims questions in the one batch, and a "decide yourself" reply shows `main-try` lines before the run starts.

## Execution Mode
- Parallel: no
- Concurrent plans: none
- Isolated DB: no

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/.claude/agents/orch-readiness.md
core/.claude/workflows/orchestrate.js
core/.claude/commands/orchestrate.md
core/.claude/commands/plan.md
core/scripts/orch-state.mjs
core/docs/agent/orchestrator.md
core/docs/agent/agent-roles.md
core/docs/brain/gotchas/agent-workflow.md
tools/lib/agent-result.mjs
tools/install-check.mjs
tools/test/orchestrator.test.mjs
tools/test/orchestrator-folders.test.mjs
tools/test/agent-contracts.test.mjs
tools/fixtures/orchestrator/readiness.mjs
tools/orchestrator-e2e.mjs
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

Runs only when `scope-check.mjs --drift` reports `REALITY: drift`. Check the listed commits by symbol
(`readiness()`, `SCHEMA.readiness`, `checkProblem`, `mainCheckProblem`, the `main-approval` check in `run()`, the
`mainDropped` notes in `runPlan`, `'check-files'` in `orch-state.mjs`, and plan 040's A1/A2 edits) and print one line
per commit: `ok` or `conflict: <what>`. STOP for a go only on a `conflict`.

## User Stories
- As the Human, I want readiness to tell me "the plan says 3 handlers, the code has 1" before the run, so I fix the
  plan or accept a default instead of grading it as a decision afterwards.
- As the Human, I want an "every X" goal checked against the plan's scope, so I choose between a wider scope and
  follow-ups before the builder starts.
- As the Human, I want "decide yourself" to never put an untested command into my live main folder.
- As the Human, I want an `npx` check in a plan to run, or to be shown to me as dropped, never dropped without a word.

## Functional Requirements

### Must Have (P0)
- [ ] Readiness checks at most 8 claims per plan in the same agent call and returns `claims`; every mismatch is a
  question with a default; the workflow validates `claims` like the other readiness fields.
- [ ] A delegated readiness answer keeps a main-folder command only when `main-try` recorded it passing (exit 0)
  from the main folder for this run in the last 2 hours; any other is dropped with the run note
  `main-folder check dropped: not seen passing from the main folder — <command>`. No second question.

### Should Have (P1)
- [ ] An `npx <tool> <args>` check maps to the package.json script whose body is exactly that command; else it is in
  `denied` with the reason, shown in the readiness summary and the run report; it never stops the run.
- [ ] `/plan`'s review writes checks as `{{project.packageManager}} run <script>`, never `npx`.

### Nice to Have (P2)
- [ ] The readiness table shows `claims: <n> checked, <m> wrong` per plan.

## UI/UX Notes
- CLI text only. Readiness table gets a `claims` column (`2 checked, 1 wrong`; `8 checked, 3 not checked` when capped).
- A claim question reads: `501 claim: the AI draft editor has 3 row-delete handlers — found: 1 (src/…/draft-editor.ts:88)
  — build for what the code has, or fix the plan? Default if unanswered: build for what the code has; the builder
  logs the difference as seen:`.
- A scope question reads: `499 claim: every number box is tap-to-edit — found: 4 outside scope (event-deposit.html:12, …)
  — widen scope to these files, or leave them as follow-ups? Default if unanswered: leave them as follow-ups`.
- A delegated reply prints one `MAIN_TRY: <command> exit <n>` line per main-folder command before the run starts.

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [x] A1: Give readiness a claims step in the same call — new step 4 **Claims** (product questions become step 5, state step 6): pick at most 8 claims, in plan order — a number next to a code noun (`3 handlers`, `two endpoints`), a named file or symbol said to have or do something (`X has Y`), and every `every|all|each <noun>` goal in Goals, Problem Statement or Atomic Sub-tasks; skip a file or symbol the plan marks new; a count/name → Grep it and put the real count with `file:line` in `found`; an "every X" → Grep X in the whole repo, run `node scripts/scope-check.mjs --file=<hit> --plan=<plan>` per hit (at most 10), list the `SCOPE: out` hits in `found` (`+<n> more` beyond 10); a held claim has `question: ""`, `default: ""`; a mismatch gets a question and a default (count: `build for what the code has; the builder logs the difference as seen:`; scope: `widen scope to these files, or leave them as follow-ups?` with default `leave them as follow-ups`); the Bash list gains the `--file` form; the output example gains `"claims": []` with one sample entry; "`claims` may be left out when the plan states no count and no every-X goal" — core/.claude/agents/orch-readiness.md
- [x] A2: Check the claims in the workflow like the other readiness fields — `SCHEMA.readiness` plan items gain `claims: { type: 'array', items: { type: 'object', properties: { plan, claim, found, question, default }, required: ['claim', 'found'] } }`; in `readiness()` `const MAX_CLAIMS = 8`; a claim is valid when `claim` and `found` are non-empty strings; keep the first 8 valid as `claims`, count the rest as `claimsOver`, invalid ones as `claimsBad`; each kept claim with a non-empty `question` adds `<NNN> claim: <claim> — found: <found> — <question> Default if unanswered: <default, or "none given — the Human answers">` to `questions` and turns `state: 'ready'` into `'questions'`; `claimsBad > 0` adds `<NNN>: readiness returned <n> unreadable claim(s) — check the plan's counts and every-X goals by hand`; the no-result fallback entry gets `claims: []` — core/.claude/workflows/orchestrate.js
- [x] A3: Accept `claims` in the shared result validator — orch-readiness branch: `claims`, when present, is a list; each entry needs non-empty `claim` and `found` strings; `question` and `default` are strings when present — tools/lib/agent-result.mjs
- [x] A4: Give readiness the package.json script bodies — new `orch-state.mjs scripts` command: emits `{ ok: true, scripts: { <name>: <body> } }` from the main folder's package.json (`{}` when unreadable), one line `package.json: <n> scripts`; usage line in the header comment — core/scripts/orch-state.mjs
- [x] A5: Map an `npx` check to the script that runs the same command — `readiness()` calls `state(['scripts'], 'package scripts')` once, only when a plan's `commands` has an entry matching `/^npx\s/`; pure `npxScript(cmd, bodies)`: collapse spaces, drop the leading `npx `, return the first script name whose collapsed body equals that rest or the whole `npx …` command; a match replaces the command with `${PM} run <name>` (then the usual `checkProblem`) and adds `npx ng build → npm run build` to the plan's `mapped`; no match → `denied` with `npx ng test: no package.json script runs "ng test" — add one and write the check as <pm> run <script>`, printed under `dropped npx checks:` in the readiness summary and the report, never a question (the gate still runs the project's build and tests); `mainCommands` unchanged (`mainCheckProblem` still refuses `npx`) — core/.claude/workflows/orchestrate.js
- [x] A6: Record a main-folder command the Planner ran once — `orch-state.mjs main-try --run <run> --plan <NNN> --cmd "<command>"`: refuses (exit 1, `main-try: <command>: <why>`, nothing run) what `mainCheckProblem` refuses — not `node scripts|tools/<file>.m?js`, an unsafe or `..` argument, a kit state script (the `NOT_A_CHECK` names, copied with a comment naming `orchestrate.js` as the source), a `--write|--apply|--fix|--update` flag; else `spawnSync(process.execPath, [file, ...args], { cwd: root, shell: false, timeout: gateTimeoutMin × 60000 })`, appends `{ plan, cmd, exit, at }` to `.claude/orchestrator-runs/<run>/main-tries.json`, prints `MAIN_TRY: <command> exit <n>` and the last 5 output lines; `main-tries --run <run>` emits `{ ok: true, passed: { <NNN>: [<command>] } }` for entries with exit 0 and `at` within the last 2 hours; `FLAGS` gains `cmd`; render `orchestrator.gateTimeoutMin` into the script — core/scripts/orch-state.mjs
- [x] A7: Drop a delegated main check nobody saw pass, without a second question — `run()`: the `main-approval` refusal stays as it is; when `A.mainDelegated === true` and `A.mainChecks` is non-empty, after `init` call `state(['main-tries', '--run', RUN], 'main tries')` once; `runPlan`: a `mainExtra` command not in `passed[nnn]` (or every one, when the call failed) is left out of `mainChecks` with the note `main-folder check dropped: not seen passing from the main folder — <command>`; without `mainDelegated` nothing changes and no `main-tries` call is made — core/.claude/workflows/orchestrate.js
- [x] A8: Tell the Planner how to answer a delegated readiness — step 2: print the `claims` column, `mapped` lines and `claimsOver`; new bullet "A delegated reply (`decide yourself`, `defaults`, `you choose`, or a bare `go` while a question is open): answer each question with its default and write `→ <default> (delegated)` in Execution Notes; a widen-scope claim answered `leave them as follow-ups` lists the files in that Execution Notes line (and in plan 041's follow-ups file once it exists); for each `mainApproval` line run `node scripts/orch-state.mjs main-try --run <run> --plan <NNN> --cmd "<command>"` once from the main folder and print its `MAIN_TRY` line — never ask again"; a bare `go` with only the main-folder block open is plan 034's approval, unchanged; step 3 args gain `"mainDelegated": true` after a delegated reply; Never: "approve a main-folder command on a delegated reply without a `main-try` exit 0" — core/.claude/commands/orchestrate.md
- [x] A9: Make `/plan` write checks the run can use — Product Manager bullet: "A check command is `{{project.packageManager}} run <package.json script>`, `node scripts/…`, `node tools/…` or `node --test <files>`; an `npx <tool> …` check is rewritten to the script that runs it (a `fixed:` line), or the script is added in scope" — core/.claude/commands/plan.md
- [x] A10: Never pause a run for go on a main-folder command the run will drop — the run-start main-approval list (`const mainList = Object.entries(A.mainChecks ?? {})…`, ~l.736 on 040's branch) is filtered through `mainCheckProblem` the same way the plan's own main-folder gate does (~l.586–587), so a slot-only (`--since=plan-start`) or otherwise refused command never reaches `stopped: 'main-approval'`; it still gets the existing `main-folder check dropped, not run` note when its plan reaches the gate; re-check the line numbers after 040 merges — core/.claude/workflows/orchestrate.js, tools/test/orchestrator.test.mjs
- [x] C1: Document claims, delegation and npx — orchestrator.md: new `## What a plan claims` (the step, the cap, the two defaults, the cost), a "delegated answer" paragraph in `## Checks that run from the main folder` (`main-try`, `mainDelegated`, the note), the `npx` mapping in the gate bullet; agent-roles.md readiness row gains `claims[]?: {plan, claim, found, question, default}`; gotcha "A plan's count or every-X goal was wrong and readiness did not look" (D30, D7–D10); Unreleased entry — core/docs/agent/orchestrator.md, core/docs/agent/agent-roles.md, core/docs/brain/gotchas/agent-workflow.md, CHANGELOG.md
- [x] T1: Prove the claims rule on fixture plans — `readiness.mjs` gains `FALSE_COUNT_PLAN` ("the editor has 3 row-delete handlers", source text with 1), `EVERY_PLAN` ("every number box", scope `src/app/a/**`, hits in `src/app/b/**`) and a mirror `claimGaps(planText, files)`; the test asserts the agent file states the rule (`/Claims/`, `/at most 8/`, `/leave them as follow-ups/`) and the mirror gives one count question and one widen-scope question — tools/fixtures/orchestrator/readiness.mjs, tools/test/orchestrator.test.mjs
- [x] T2: Prove the workflow side — `runFlow` stub answers `scripts` and `main-tries` from hooks; tests: claim question → `questions` + `askHuman`; 10 claims → 8 + `claimsOver: 2`; a claim without `found` → `claimsBad` question; `npx ng build` → `npm run build` in `commands` and `mapped`; `npx ng test` unmapped → `denied`, listed under `dropped npx checks:`, `askHuman` unchanged; no `npx` → no `scripts` call; `mainDelegated` with `passed: {101: [a]}` and mainChecks `[a, b]` → only `a` in `gate 101 main`, note for `b`; `mainDelegated` without `mainApproved` → still `stopped: main-approval` — tools/test/orchestrator.test.mjs
- [x] T3: Prove `main-try` on a real repo — a passing and a failing `scripts/*.mjs` recorded with their exits; `npm run build`, `node --test x`, `node scripts/orch-state.mjs stop` refused and not run; `main-tries` lists only the exit-0 one; an entry older than 2 hours is not listed — tools/test/orchestrator-folders.test.mjs
- [x] T4: Prove the validator and the installed text — agent-contracts: claims accepted, a claim without `found` rejected; install-check: `orch-readiness.md` names `claims`, `orchestrate.md` names `mainDelegated` and `main-try`; extend the e2e readiness stub only if it now fails — tools/test/agent-contracts.test.mjs, tools/install-check.mjs, tools/orchestrator-e2e.mjs
- [x] R1: Render the kit's own installed copies and check drift — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .` — scripts/, .claude/, docs/agent/, docs/brain/, .kit/install.json

## Technical Considerations
- Dependencies: `orchestrate.js` (`SCHEMA.readiness`, `readiness()`, `checkProblem`, `mainCheckProblem`, `run()`'s
  `main-approval` check ~l.731, `runPlan`'s `mainDropped` notes ~l.585), `orch-state.mjs` (`check-files` is the model
  for the new read commands; `FLAGS`), `orch-readiness.md`. No new agent, no new config key.
- Cost (estimate): the claims step adds no agent call; ≤8 claims × 1–3 Grep/`scope-check --file` calls ≈ 8–16k input
  tokens and ~0.1k output per claim, per plan, on the `judgment` tier — ≈ 30–65k tokens for a 4-plan run. `npx`
  mapping: +1 mechanical runner call per readiness, only when a plan has an `npx` check. Delegation: one Bash call per
  main command in the Planner session, +1 runner call per run when `mainDelegated`.
- Model: readiness stays on `judgment` (`model-routing.md`); a cheaper tier would decide which claims matter.
- Security surface: `main-try` runs a plan-supplied command in the live main folder, only after a delegated reply
  (which is the Human's go), only the shapes `mainCheckProblem` allows, with `shell: false` and the gate timeout.
  The run itself still refuses `mainChecks` without `mainApproved` (plan 034).
- Run facts by scripts: whether a main command passed is read from `main-tries.json` written by `orch-state.mjs`, never
  from the Planner's word.
- Backend / API, auth, data / migration: none. New files: none in the kit (`main-tries.json` is run state, gitignored
  under `.claude/orchestrator-runs/`).

## Out of Scope
- The follow-ups file, its format and `/plan` reading it — plan 041. This plan only names where a "leave them as
  follow-ups" answer goes.
- Slot-only checks (`--since=plan-start`) — plan 040 A1/A2.
- Fixing D30 and D7–D10 in FoodVibe — the FoodVibe Planner (handoff §7.3).
- Verifying claims again after the build (a checker step) — later, if readiness misses keep showing up as `seen:`.

## Critical Questions
- Q: Separate claims agent or the readiness call? Default: same agent, same call, no extra agent; cap 8 claims per plan (proposed 2026-10-30, not yet answered by the Human).
- Q: Readiness tier? Default: stays `judgment` (proposed 2026-10-30, not yet answered by the Human).
- Q: "Every X" outside scope? A: ask "widen scope to these files, or leave them as follow-ups?", default leave as follow-ups (Human, 2026-10-30).
- Q: Delegated readiness and main-folder commands? A: approved only when seen passing once from the main folder this session, else dropped with the note; no double ask with plan 034 (Human, 2026-10-30).
- Q: `npx` checks? A: map to a package.json script by exact body, else drop it with the reason and show it — no question, the run does not wait; `/plan` writes `<pm> run <script>` (Human, 2026-10-30).
- Q: Default for a wrong count? A: build for what the code has; the builder logs the difference as `seen:` (Human, 2026-10-30).
- Q: On a delegated reply, does the Planner try each main command once (`main-try`) or drop them all? A: try each once; one that passes is kept, one that fails is dropped with the note (Human, 2026-10-30).
- Q: What is "this session" for `main-try`? Default: an entry for this run name in the last 2 hours — the same window preflight uses for a live run.
- Q: Where does "leave them as follow-ups" go before plan 041 is built? Default: the plan's Execution Notes readiness line lists the files — no new file before 041 defines one.
- Q: Default answer for an unmapped `npx` check? A: drop it and show it to the Human; the gate still runs build and tests (Human, 2026-10-30).

## Execution Notes
- Source: run-499-502 handoff §3 P7, P10, P13, §4 (D7–D10, D30), §6.3, §6.4; the Human's decisions on 2026-10-30.
- Handoff vs code: (1) §3 P7 says the claims step "should use the analysis tier (Sonnet)"; `orch-readiness.md` runs on
  `{{models.judgment}}` and `model-routing.md` lists it as `judgment` — kept, per the Human. (2) §6.3's output has no
  `default`; added per the Human. (3) P10 says the `npx` checks were "dropped"; the code names them in `denied` with
  `not an allowed check`, but `askHuman` ignores `denied`, so with nothing else open they pass unseen — A5's question
  closes that. (4) `checkProblem` accepts `npm run` and `pnpm run` whatever `project.packageManager` is; A5 writes
  `${PM} run`. (5) Readiness checks commands shape-only (`checkProblem(c, null)`); script names are checked later
  against `plan-info`'s `npmScripts` — the mapped command passes that too. Handoff line numbers for `checkProblem`
  (l.63), `mainCheckProblem` (l.91) and the main-folder gate (l.649–655) match `a363b42`.
- Overlap: plan 040 edits `orch-readiness.md` step 3 and `mainCheckProblem` (build 040 first); 041 and 042 edit
  `orchestrate.js` and `orchestrate.md` (other functions: `take`, the wave loop, step 4) — rebase, no shared lines
  expected; 044 (close-out, CI parity) may touch the final gate, not readiness.
- Review finding, passed on by the Human on 2026-10-30 (not a Human decision): reviewing plan 040 on
  `feat/040-slot-only-checks-app-errors-manifest-check` (`cdb4382`) found that readiness already filters `mainCommands`
  through `mainCheckProblem` (~l.346–349), so `mainApproval` (~l.355) is clean, but the run-start main-approval list
  built from `args.mainChecks` (~l.736) is not filtered: a command `mainCheckProblem` rejects can stop the run on
  `main-approval` and then be dropped before it runs (~l.586–590) — a wasted pause, no harm. A10 closes it. 040 merges
  after 039; line numbers are from 040's branch.

## Finish — review hand-off (replaces /ship)

Build order: wave 1 — after 040; parallel with 030 and 044.

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
