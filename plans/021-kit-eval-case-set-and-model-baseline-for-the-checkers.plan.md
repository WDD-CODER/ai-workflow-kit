# Plan 021 — Kit Eval Case Set and Model Baseline for the Checkers

Status: active
Snapshot: 305fce2
Depends-on: 019, 020

## Problem Statement
Plan 019 built the eval harness (`tools/agent-eval.mjs`), but no real case set exists, so the checker and verifier
agents run on the default model (Sonnet) with no measured recall or precision. Plan 019's `[human]` item waits on
labels Dandan has not produced yet (MVP run outcome, QA findings).

The kit's own orchestrator run (PR #37) produced labelled data whose truth is proved by code, not by a model's opinion:
problems an independent checker found that a later commit fixed and a test now covers, plans that passed with no
problem, and the security review findings that were fixed with tests. Dandan asked that the cases not be graded by the
same agent that wrote them ("make sure you're not on the same page"), so a label is accepted only when a fix commit and
a passing test back it, or when the bug is planted on purpose.

## Prerequisites
- 019 merged (harness) and 020 merged (its fixes touch the agents measured here).

## Goals & Success Criteria
**Primary:** a baseline table — recall, precision, noise, tokens and cost per model (Opus, Sonnet; Haiku is never a validator — Human rule 2026-10-22) — for
`orch-check-bugs`, `orch-check-plan`, `orch-check-rules` and `orch-verify` on 20–25 real or planted cases, recorded in
`docs/agent-evals/BASELINE.md`.

- [auto] `docs/agent-evals/cases/` holds at least 20 cases in the harness shape (`input/` + `expected.json`), each with
  a `note` naming its source: the fix commit and the test that proves the label, `clean: plan NNN passed with no
  finding`, or `planted: <what was changed>`. Checked by `node tools/agent-eval.mjs --agent .claude/agents/orch-check-bugs.md --cases docs/agent-evals/cases --runner tools/fixtures/agent-evals/stub-perfect.mjs`
  (stub runner, no model call) exiting 0 — every case parses.
- [auto] No case label comes from a model's opinion alone: `node --test tools/test/eval-cases.test.mjs` checks every
  `expected.json` `note` starts with `fixed by <sha>`, `clean:` or `planted:`, and that each `fixed by <sha>` commit
  exists in `git log`.
- [auto] `docs/agent-evals/BASELINE.md` has one table per agent with one row per model and the columns recall,
  precision, noise, tokens, cost, from runs with `--runs 2`.
- [auto] `node tools/install-check.mjs` passes with a fixture where `models.review: "haiku"` (and
  `"claude-haiku-4-5"`) makes install refuse with a message naming `models.review`; every rendered validating agent
  (`orch-check-*`, `orch-verify`, `orch-security`, `orch-ui`) carries `model: sonnet` by default.
- [auto] `npm run build`, `npm run lint`, `npm run test`, `node tools/drift-check.mjs --target .` exit 0.
- [human] Dandan reads `BASELINE.md` and picks the default model per checker role (or keeps Sonnet); the choice goes
  into `.kit/config.json` / `kit.config.json` defaults in a later change.

## Execution Mode
- Parallel: no — runs after 020; model runs are token- and memory-heavy, one at a time.
- Concurrent plans: none.
- Isolated DB: no.
- Kit edits: kit branch `feat/021-kit-eval-baseline` + kit PR; Dandan merges. Release: minor, with 020's fixes if not yet
  released (new config key `models.review`; nothing a project must do).

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`.

```scope
docs/agent-evals/**
tools/test/eval-cases.test.mjs
tools/fixtures/agent-evals/stub-perfect.mjs
core/.claude/agents/**
core/.claude/commands/review-it.md
core/docs/agent/model-routing.md
kit.config.json
.kit/config.json
.kit/install.json
tools/lib/kit.mjs
tools/install-check.mjs
.claude/agents/**
.claude/commands/**
docs/agent/**
CHANGELOG.md
core/docs/agent/agent-roles.md
core/docs/agent/agent-evals.md
```

## Read Scope

Entire repo. Analysis and architectural suggestions are expected.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside the
`## Read-Write Scope` above: STOP, tell the Human the file, the exact change, and why it can't be done in-scope; offer
`approved: <path>`; then append the path to the scope block above and retry.

## Architecture Impact
- INV-none: preserves — data and a report in the kit's own docs; no workflow rule or installed file changes.

## Step 0 — Reality Check

Runs only when `scope-check.mjs --drift` reports `REALITY: drift`. Check the listed commits by symbol and print one line
per commit: `ok` or `conflict: <what>`. STOP for a go only on a `conflict`.

## User Stories
- As Dandan, I want to pick each checker's model from measured numbers, not a guess.
- As the Planner, I want a gate that shows when a prompt change makes a checker worse.

## Functional Requirements

### Must Have (P0)
- [ ] Fixed-problem cases from the run (input = the plan + the diff before the fix commit; label = the problem the fix
  commit closed): plan 010 (`9d26599` → `daf4f2c`), 017 (`25a9a4b` → `c8342ea`), 014 (`aff848a` → `7e2bca1`),
  018 (`387d666` → `dbc4ce4`); the security follow-up (`383a7cc` → `35140fb`, one case per finding where the diff
  allows); the Windows short-path bug (`387b1ee` → `ea53cd2`).
- [ ] Clean cases (label = no finding): plans 011 (`7845500`), 013 (`9f99049`), 019 (`7dad8a7`), split into
  reviewable diffs.
- [ ] Planted cases: small diffs with one known bug each (off by one, a check that allows everything, an inverted
  comparison, a lost escape, an unchecked error path).
- [ ] Verifier cases: candidate lists mixing confirmed findings (from the fixed cases) and refutable false alarms.
- [ ] Runs: each finder and the verifier on Opus and Sonnet, `--runs 2`, one run at a time.
- [ ] Validators never run below Sonnet: a new tier `models.review` (default `sonnet`) for `orch-check-bugs`,
  `orch-check-plan`, `orch-check-rules`, `orch-verify`, `orch-security`, `orch-ui` and `/review-it`'s checkers; install
  and sync refuse `haiku` or a `claude-haiku-*` id for it, naming the key. `models.analysis` keeps its other users.

### Should Have (P1)
- [ ] `BASELINE.md` names, per role, the cheapest model whose recall and precision are within 0.05 of the best.

### Nice to Have (P2)
- none

## UI/UX Notes
- None (report file only).

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [x] A1: Build cases from problems the run's checkers found and a later commit fixed, so each label is proved by code — plan + pre-fix diff + changed files as input, the fixed problem as the label, note "fixed by <sha>" — docs/agent-evals/cases/
- [x] A2: Build clean cases from plans that passed with no finding, to measure false alarms — docs/agent-evals/cases/
- [x] A3: Add planted-bug cases with one exact known answer each — docs/agent-evals/cases/
- [x] A4: Add verifier cases that mix real findings with refutable false alarms — docs/agent-evals/cases/orch-verify/
- [x] A5: Prove every case parses and every label has a code-backed source, before spending tokens — stub runner and a case test — tools/fixtures/agent-evals/stub-perfect.mjs, tools/test/eval-cases.test.mjs
- [x] A0: Give validating agents their own model tier that can never be Haiku, so a review is never done by the weakest model — models.review default sonnet, refused when haiku; checker, verifier, security, UI agents and the review command use it; routing doc and install check updated — kit.config.json, .kit/config.json, tools/lib/kit.mjs, tools/install-check.mjs, core/.claude/agents/orch-check-*.md, orch-verify.md, orch-security.md, orch-ui.md, core/.claude/commands/review-it.md, core/docs/agent/model-routing.md
- [x] A0b: Start the commit-message agent without the project instructions, since it gets everything from its prompt — omitClaudeMd true, like kit-runner; note in the routing doc that the field needs Claude Code v2.1.271 or later and is ignored before that — core/.claude/agents/git-agent.md, core/docs/agent/model-routing.md
- [x] A6: Run each checker and the verifier on Opus and Sonnet and write the baseline report — two runs per case, one run at a time — docs/agent-evals/BASELINE.md
- [x] A7: Record the outcome in the changelog and the plan's notes — CHANGELOG.md

## Technical Considerations
- Dependencies: `tools/agent-eval.mjs`, `tools/lib/agent-result.mjs`, the `.claude/agents/orch-*.md` files after 020.
- New files needed: the case folders, `BASELINE.md`, the stub runner, the case test.
- Model changes: new tier `models.review` (default `sonnet`, never Haiku) for every validating agent (A0).
- Backend / API: none.
- Auth and validation: none.
- Security surface: none — cases hold kit code only; no secrets.
- Data / migration: none.
- Project checks: none.
- Cost: about 18 agent runs per case (4 agents × 2 models × 2 runs, less for role-specific cases) → roughly 1.5–3M
  tokens. Runs one at a time because the machine is low on memory.

## Out of Scope
- FoodVibe cases (MVP cards, QA findings) — they need Dandan's labels; plan 019's `[human]` item stays open for them.
- The UI validator's evals.
- Changing default models.

## Critical Questions
- none

## Execution Notes
Asked for by Dandan on 2026-10-22 ("plan and run 021 when done"), after plan 020.

Build (builder, 2026-10-22, branch `feat/021-kit-eval-baseline` off `origin/main` 9173793, worktree
`ai-workflow-kit-021`; no Human available — conservative choices logged here):
- Step 0 not run: the plan's snapshot 305fce2 is an ancestor of main; nothing in scope moved under it.
- A0: `models.review` (default `sonnet`) in `kit.config.json`; `tools/lib/kit.mjs` validates it with the other tiers
  and refuses `haiku` / `claude-haiku-*` ("models.review is "haiku" — validating agents never run on Haiku …").
  `orch-check-plan/bugs/rules`, `orch-verify`, `orch-security`, `orch-ui` render `model: {{models.review}}`;
  `orch-merge` stays on `analysis`. `review-it.md` says the finders and verifier run on the review tier.
  `.kit/config.json` not edited: it takes the scaffold default. install-check: new fixtures `models.review` haiku and
  claude-haiku-4-5 refused (exit 2, nothing written); `models.analysis: haiku` keeps all six validators on `sonnet`;
  the all-inherit fixture now sets `review` too.
- A0b: `git-agent.md` `omitClaudeMd: true`; model-routing rule 2 names the v2.1.271 requirement.
- Decision (scope): `core/docs/agent/agent-roles.md` line 68 still says the finders run "on the `analysis` tier" and
  `core/docs/agent/agent-evals.md` shows `--model haiku` as an example; both files are outside this plan's scope and
  were left as they are — a follow-up should say `review` there.
- A1–A4: 25 cases in `docs/agent-evals/cases/` — orch-check-bugs 14 (7 fixed: daf4f2c, c8342ea ×2, ea53cd2, 7e2bca1,
  35140fb, dbc4ce4; 5 planted: off-by-one, allow-all check, inverted comparison, lost escape, unchecked error; 2 clean:
  011 plan-graph, 013 agent-result), orch-check-plan 5 (3 fixed: daf4f2c, 7e2bca1, dbc4ce4; 1 planted; 1 clean 019),
  orch-check-rules 3 (2 planted; 1 clean 019), orch-verify 3 (fixed findings + refutable false alarms).
  Inputs are the plan (or a marked excerpt when the full diff was > 60 KB), the pre-fix diff of the touched file and
  the file at the pre-fix commit, extracted with `git show` / `git diff`. Decision: the plan's clean list named
  plan 011's diff, but `plan-deps.mjs` was fixed later (a129759, "Depends-on stops at a dash"), so the clean cases use
  files that never changed after their plan (`plan-graph.mjs`, `agent-result.mjs`, `compare.mjs`, `score.mjs`).
- A5: `node tools/agent-eval.mjs --agent .claude/agents/orch-check-bugs.md --cases docs/agent-evals/cases --runner
  tools/fixtures/agent-evals/stub-perfect.mjs` → exit 0, TOTAL 1.00 / 1.00, 0 errors (14 cases).
  `node --test tools/test/eval-cases.test.mjs` → pass 4, fail 0 (≥ 20 cases, shapes, note sources and shas, stub
  scores 1/1 on all four roles).
- A6: eight runs, one at a time, `--runs 2`, all exit 0 (17:41–18:49); reports in `docs/agent-evals/runs/`.
  `docs/agent-evals/BASELINE.md`: Sonnet is the cheapest within 0.05 on every role; recall is low on both models.
  A diagnostic one-run Sonnet replay (raw reply kept in the scratchpad) shows why much of it is the scorer: on
  planted-inverted-comparison the agent found the exact line but said `blocker` / `wrong result` where the label says
  `major` / `logic`. Decision: the measured numbers are reported as they are, not re-run after relabelling (that
  would tune labels to the results); BASELINE.md "Next" proposes a severity tolerance and the prompt's categories as a
  harness change outside this scope. Opus `orch-check-plan` returned invalid JSON twice (counted as errors).
- A7: CHANGELOG `[Unreleased]` — Added (`models.review`, case set, BASELINE.md), Changed (`git-agent`), and the
  rendered files a project gets. First lint run failed on "plan 021" in CHANGELOG (leak-check history rule); reworded.
- Checks, one at a time, each exit 0: `node tools/sync.mjs --target . --apply` (0 kit-update after the last source
  change); `npm run build` (PACK_CHECK: ok); `npm run lint` (LEAK_CHECK: ok ×3); `npm run test` (INSTALL_CHECK: ok,
  WORKFLOW_LINK_CHECK: ok — 0 missing); `node tools/e2e-check.mjs` (E2E_CHECK: ok — 53 cases passed);
  `node tools/drift-check.mjs --target .` (KIT_DRIFT: ok — 0 undeclared differences); `node --test
  tools/test/*.test.mjs` (tests 120, pass 120, fail 0); `node tools/orchestrator-e2e.mjs` (ORCHESTRATOR_E2E: ok — 64
  cases passed). `npm run e2e` is left to CI.
- Open ([human]): Dandan reads BASELINE.md and picks the default model per checker role.

Checker round 1 (builder, 2026-10-22):
- Major (bug labels miss the prompt's own categories) — fixed. The 12 orch-check-bugs labels with findings now also
  accept the "Look for" headings of `core/.claude/agents/orch-check-bugs.md:18-22`, only those that fit each bug
  (`wrong result(s)` on all 12; `crash(es)` on status-race and lost-escape; `broken contract(s)` on stale-worktree,
  capital-x and off-by-one; `error handling` was already on the two error-handling cases). Severity is still exact
  (not changed: that is the scorer's contract, logged in BASELINE "Next"). Reran the two orch-check-bugs runs, one at
  a time, `--runs 2` (Sonnet 19:08–19:38, Opus 19:39–20:08, both exit 0). Conservative choice: only those two of the
  eight runs were redone — the other three roles' labels did not change, so their scores cannot move from the relabel.
  Result: Sonnet recall 0.27 / precision 0.22 / 3.03 USD / 1 error; Opus 0.19 / 0.12 / 9.86 USD / 3 errors (before:
  both 0.13). BASELINE.md tables, pick row, per-case lines, "Read with care" and "Next" updated; Sonnet stays the pick.
  Stub check: `node tools/agent-eval.mjs ... --runner tools/fixtures/agent-evals/stub-perfect.mjs` → TOTAL 1.00 / 1.00,
  exit 0; `node --test tools/test/eval-cases.test.mjs` → pass 4, fail 0.
- Minor (old Haiku ids pass `models.review`) — fixed. `tools/lib/kit.mjs` refuses any value matching `/haiku/i`;
  install-check fixtures add `claude-3-5-haiku-20241022` and `claude-3-haiku-20240307`. Probe: `commandProblems` on
  both returns the "validating agents never run on Haiku" problem; `sonnet`, `claude-sonnet-4-5`, `opus` return none.
- Minor (one case from 35140fb) — partly fixed. `fixed-sec-diff-unread-fails-open` gained a second expected finding
  from the same input file: pre-fix `orch-state.mjs:71` honours `--root <dir>` and parseArgs takes unknown flags as
  `true` (35140fb test 'orch-state.mjs: unknown flags (--root among them) …'). Left out, with reasons: the plan-branch
  slug check did not exist before 35140fb (no pre-fix line to point at; the function is already the planted
  allow-all case); the branch / scope / sibling-worktree guard fail-closed fixes are in `guard.mjs`, whose pre-fix
  code spans c8342ea/ea53cd2 and each would need its own input bundle (the guard family already has 3 fixed cases);
  the `[ui]` card values arrive through the same parseArgs fix and would duplicate the new finding.
- Minor (agent-roles.md / agent-evals.md still say `analysis` / `--model haiku`) — not fixed: both files are outside
  this plan's Read-Write Scope and no Human can answer an `approved:` now. Conservative choice: left as they are.
  Open for the Human: `approved: core/docs/agent/agent-roles.md` and `approved: core/docs/agent/agent-evals.md`
  (reword to the `review` tier), before release.
- Checks after round 1, one at a time: `node tools/sync.mjs --target . --apply` (exit 0, 0 kit-update);
  `npm run build` (exit 0, PACK_CHECK: ok); `npm run lint` (exit 0, LEAK_CHECK: ok ×3); `npm run test` (exit 0,
  INSTALL_CHECK: ok, WORKFLOW_LINK_CHECK: ok); `node tools/e2e-check.mjs` (exit 0, 53 cases); `node
  tools/drift-check.mjs --target .` (exit 0, 0 undeclared differences); `node --test tools/test/*.test.mjs` — first
  run tests 120 / pass 119 / fail 1 (output not kept, failing test not named), the next two runs exit 0, pass 120 /
  fail 0: logged as a one-off flake, not traced; `node tools/orchestrator-e2e.mjs` (exit 0, 64 cases).

### Checker round 2

- Major (`models.review` default silently moved validators off a project's own `models.analysis`) — fixed with the
  checker's option 1, the conservative one (no project has to act): `tools/lib/kit.mjs` `resolveConfig` — when the
  project config sets `models.analysis` and not `models.review`, `models.review` takes that value; a Haiku value
  (`/haiku/i`, the same test the refusal uses) gives `sonnet`. An explicit `models.review` always wins.
  `tools/install-check.mjs`: the all-inherit fixture is back to the four pre-021 keys (no `review`) and still renders
  only `model: inherit`; new fixtures: `analysis: opus` → all six validators `opus`; `analysis: opus` + `review:
  sonnet` → `orch-verify` `sonnet`, `kit-prevalidate` `opus`. CHANGELOG upgrade note + Added entry, the
  `kit.config.json` `$comment` and `core/docs/agent/model-routing.md` ("all five inherit" line) now say this.
- Fresh run (scratch installs, `--packs` from `stack.packs: []`): `{"models":{"analysis":"opus"}}` → install exit 0,
  `orch-verify.md`, `orch-check-bugs.md`, `orch-ui.md` all `model: opus`; the four old keys at `inherit` and no
  `review` → install exit 0, every agent file `model: inherit` (14 of 14).
- Checks after round 2, one at a time: sync `--apply` (exit 0, 1 kit-update: docs/agent/model-routing.md); `npm run
  build` (exit 0, PACK_CHECK: ok); `npm run lint` (exit 0, LEAK_CHECK: ok ×3); `npm run test` (exit 0,
  WORKFLOW_LINK_CHECK: ok, install-check passed); `node tools/e2e-check.mjs` (exit 0, 53 cases); `node
  tools/drift-check.mjs --target .` (exit 0, 0 undeclared differences); `node --test tools/test/*.test.mjs` (exit 0,
  tests 120 / pass 120 / fail 0); `node tools/orchestrator-e2e.mjs` (exit 0, 64 cases).

- scope extended: core/docs/agent/agent-roles.md, core/docs/agent/agent-evals.md — approved by the Human in chat
  2026-10-22; both now name the `review` tier and show no Haiku example.
- [human] Default model per checker role: Human decision 2026-10-22 "keep sonnet" — `models.review` stays `sonnet`
  for every validating role (BASELINE.md: Opus no better on any role, about 2x the cost).
