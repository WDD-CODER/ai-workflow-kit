# Plan 048 — Orchestrator agents get better by measurement: a fair scorer, a growing case set, and an eval-gated prompt improver

Status: draft
Depends-on: 030, 035, 046
Snapshot: a363b42

## Problem Statement

The orchestrator's accuracy rests on its checkers, and the kit's own baseline (`docs/agent-evals/BASELINE.md`,
2026-10-22, 25 cases, 2 runs each) says they are weak:

| Role (sonnet) | Recall | Precision |
|---|---|---|
| orch-check-bugs | 0.27 | 0.22 |
| orch-check-plan | 0.30 | 0.38 |
| orch-check-rules | 0.25 | 0.25 |
| orch-verify | 0.33 | 1.00 |

Three things keep these numbers from going up:

1. **The scorer under-counts.** A finding matches only when `severity` equals the label's; a run that found the exact
   planted line and rated it `blocker` where the label says `major` scored 0 (`planted-inverted-comparison`).
   BASELINE "Next" asks for a severity tolerance before the numbers can gate anything.
2. **The case set is small and static.** 3–14 cases per role; one case moves recall by 0.07–0.33. Real misses happen
   in runs every week (run-499-502: the checkers passed plan 502's removal of the date chip's keys — D33 — and plan
   501's wrong handler count — D30), but only plan 030 L7 turns a graded miss into a case, and only inside a project.
3. **Agent prompts change by hand, unmeasured.** Nothing proposes an edit from the failing cases, and nothing keeps an
   edit only when the numbers go up. Plan 035 builds exactly this loop for skills; agents are left out.

The Human's standing rule: every orchestrator agent, the code reviewer first, must be made reliable before the run
leans on it (2026-10-27); judging roles never run on Haiku.

## Goals & Success Criteria
**Primary:** a checker's prompt changes only when a measured run on a fair scorer and a growing case set shows it
finds more real problems without more false alarms, and the Human merges the change.

- [auto] Scorer: `node tools/agent-eval.mjs … --severity-tolerance adjacent` counts a finding whose severity is one step
  from the label's (`blocker`↔`major`, `major`↔`minor`) as a match with weight 0.5 (new `partial` column); `exact`
  keeps today's scoring; the test reproduces `planted-inverted-comparison` (`blocker` vs `major`) scoring 0 today and
  0.5 with `adjacent`.
- [auto] Variance: `--runs 3` reports per role the spread between runs (`spread` column = max − min of the run totals);
  `compare.mjs` calls a difference "real" only when it exceeds `max(0.05, 2 × spread)`.
- [auto] Case growth from the kit's own history: `node tools/agent-eval-cases.mjs from-fix --commit <sha>` writes a
  case folder (`input/` from the parent commit's touched files + the diff, `expected.json` from the fix's test name
  and the changed lines, `README.md` `fixed by <sha>`), refusing a commit with no test change; `--dry-run` prints it.
  Test on a fixture repo.
- [auto] Local project cases are read in place, never copied: `<home>/.kit-learn/eval-sources.json` lists project
  case folders (plan 030 L7's `docs/agent-evals/cases/`); the improver evaluates on kit cases + those, and only the
  counts leave the machine (`leak-check` on the PR body).
- [auto] Improver for agents: `node tools/skill-improver/run.mjs --target agent --role check-bugs --once --driver
  <stub>` (plan 035's runner, a new target type): runs the role on the cases, collects the failed cases with their
  feedback (missed `file:line` + label note; false alarm + why), asks the editor model for ONE edit of at most 15
  changed lines in `core/.claude/agents/orch-<role>.md`, then the gate:
  1. minibatch: the 3 worst failed cases + 3 passed cases — the candidate must not lose a passed case and must fix ≥1;
  2. full set, 3 runs: the role's recall **or** precision improves by a real difference (above) and neither drops by
     more than 0.02; tokens per case up by ≤20%;
  3. accepted → branch `learn/agent-<role>-<date>`, PR with the before/after table, the cases fixed, the edit; the
     prompt version and its scores go to `docs/agent-evals/archive/<role>.jsonl` (kit repo; scores and the prompt's
     git sha only); rejected → one line in `<home>/.kit-learn/agent-rejected.jsonl` with the edit's summary, never
     proposed again unless the case set grew by 3+.
- [auto] The improver never edits a case, a label, the scorer or `tools/test/**` (path guard: `KIT_LEARN: protected
  <path>`), and the editor and judge are separate model calls; the scorer is code, not a model.
- [auto] Pick: the role to work on is the one with the most evidence of being wrong — from the brain (046): checker
  misses per role (`missed:` lessons, final-gate/UI failures after a clean pass), refuted rate, `✗` kinds tied to a
  role — weighted by its current recall gap; printed with its numbers before any token is spent.
- [auto] After an accepted change the runner re-checks the cheapest model within 0.05 of the best for that role
  (BASELINE's rule) and prints it; it never changes `models.*` by itself.
- [auto] Budget: shares plan 035's nightly cap; `--budget` stops cleanly; `node --test tools/test/`, `install-check`,
  `leak-check`, R1 pass.
- [human] The Human merges a first agent-improver PR after reading its table; the BASELINE re-run with
  `adjacent` tolerance is committed as the new baseline.

## Execution Mode
- Parallel: no
- Concurrent plans: 035 (shared runner — build first), 047 (`agent-prompt` category: this plan is its only path,
  ceiling L2).
- Isolated DB: no

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
tools/agent-eval.mjs
tools/lib/agent-eval/**
tools/agent-eval-cases.mjs
tools/skill-improver/**
tools/test/agent-eval*.test.mjs
tools/test/skill-improver*.test.mjs
tools/fixtures/agent-evals/**
docs/agent-evals/**
core/docs/agent/agent-evals.md
core/.claude/agents/skill-judge.md
.claude/**
scripts/**
docs/agent/**
docs/brain/**
.kit/install.json
CHANGELOG.md
README.md
```

## Read Scope

Entire kit repo and its git history; local project case folders listed in `eval-sources.json` (read in place); the
brain via `KIT_BRAIN_READER_URI`.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry. The scorer change (G1) is built by this plan under the Human's
review; after it merges, the scorer is a protected path for every automated loop (plan 046 K10).

## Architecture Impact
- INV-none: preserves — kit-only tooling; agent files change only through reviewed PRs.

## Step 0 — Reality Check
1. Plan 035 merged (runner, budget, judge, worktree isolation). Plan 046 merged (brain reader, protected paths).
2. Re-run today's baseline for `orch-check-bugs` (sonnet, 2 runs) and confirm the numbers are within 0.05 of
   BASELINE.md before changing the scorer; write the result here.

## User Stories
- As the Human, I want a checker's prompt to change only when it measurably finds more real problems.
- As the Human, I want every real miss from a run to become a case the checkers are measured on.
- As the Human, I want to see one table per change: before, after, cases fixed, cost per case.

## Functional Requirements

### Must Have (P0)
- [ ] Severity tolerance and run-to-run spread in the scorer; "real difference" rule in `compare.mjs`.
- [ ] Agent target in plan 035's runner with the two-stage gate, archive and rejected log.
- [ ] Path guard: cases, labels, scorer, tests are never edited by the improver.

### Should Have (P1)
- [ ] Cases from the kit's own fix commits; local project case folders read in place.
- [ ] Evidence-driven pick of the role.

### Nice to Have (P2)
- [ ] Cheapest-model re-check after an accepted change.

## UI/UX Notes
PR body table (plain text):
```
role check-bugs · cases 22 (kit 14 + local 8) · 3 runs · tolerance adjacent
          recall  precision  noise  tokens/case
before    0.27    0.22       0.57   156k
after     0.41    0.24       0.52   161k
fixed: fixed-010-empty-lockfile, fixed-017-cd-unknown-folder · lost: none
```

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [ ] G1: Score fairly — `--severity-tolerance exact|adjacent` (default `adjacent` once the new baseline is committed), `partial` column, `--runs` spread, `compare.mjs` real-difference rule; tests incl. `planted-inverted-comparison` — tools/agent-eval.mjs, tools/lib/agent-eval/score.mjs, tools/lib/agent-eval/compare.mjs, tools/test/agent-eval.test.mjs
- [ ] G2: Re-measure the baseline with the fair scorer — run the four roles × sonnet/opus × 3 runs, update `docs/agent-evals/BASELINE.md` (keep the old table under "Before the tolerance") — docs/agent-evals/BASELINE.md, docs/agent-evals/runs/**
- [ ] G3: Grow the kit's case set from its own fixes — `tools/agent-eval-cases.mjs from-fix --commit <sha>` and `list-candidates --since <tag>` (merge commits whose PR changed a test under `tools/test/`); add cases for the orchestrator fixes since the baseline (plans 029, 032, 033, 034, 037, 038, and 040 once merged) — tools/agent-eval-cases.mjs, docs/agent-evals/cases/**, tools/test/agent-eval-cases.test.mjs
- [ ] G4: Read project cases in place — `eval-sources.json` (`[{ "dir": "C:\\…\\docs\\agent-evals\\cases" }]`); the runner passes each dir to `agent-eval.mjs --cases`; reports name a source only as `local <n>`; nothing from a source is written to the kit repo — tools/skill-improver/**, tools/test/skill-improver-agent.test.mjs
- [ ] G5: Improve one agent per session by the two-stage gate — runner target `agent`: evaluate, collect failures with feedback, editor call (≤15 changed lines, one edit, the agent file only), minibatch gate, full gate, archive / rejected log, PR — tools/skill-improver/**, core/.claude/agents/skill-judge.md, tools/test/skill-improver-agent.test.mjs
- [ ] G6: Pick the agent with the most evidence of being wrong — brain query per role (046's reader): misses, refuted rate, `✗` kinds; weighted by recall gap; printed before spending — tools/skill-improver/**, tools/test/skill-improver-agent.test.mjs
- [ ] G7: Re-check the cheapest model after a change (P2) — run the changed role on the other review-tier model; print `cheapest within 0.05: <model>`; never write `models.*` — tools/skill-improver/**
- [ ] G8: Show and cap what the improver costs, whichever way Claude Code is billed — the runner reads how it is
  authenticated: signed in with the Claude plan (`claude -p` then draws from the plan's usage limits, no dollar bill —
  support.claude.com/en/articles/15036540, checked 2026-10-30) or an API key (`KIT_IMPROVER_API_KEY`, passed only to
  the child process as `ANTHROPIC_API_KEY`, billed to a Claude Console workspace); it prints the mode before spending
  (`IMPROVER: billing plan-limits` or `IMPROVER: billing api-key workspace <name>`); its own cap (`agentBudgetUsd`,
  from `total_cost_usd` of each `claude -p --output-format json` call) stops the session either way; every session
  appends `{date, role, mode, usd, tokens, result}` to `<home>/.kit-learn/spend.jsonl`, and `run.mjs --spend` prints
  this month's total per mode; `agent-evals.md` §Cost says how to put the API-key mode in its own Console workspace with
  a monthly spend limit and auto-reload off, so the API itself refuses past the limit — tools/skill-improver/**,
  core/docs/agent/agent-evals.md, tools/test/skill-improver-agent.test.mjs
- [ ] C1: Document — `agent-evals.md` (tolerance, spread, real difference, case sources, the improver and its gate, protected files); CHANGELOG — core/docs/agent/agent-evals.md, CHANGELOG.md, README.md
- [ ] T1: Tests that fail on today's code — every Goals test item, all with stub runners — tools/test/**
- [ ] R1: Render the kit's own installed copies and check drift — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .` — scripts/, .claude/, docs/agent/, docs/brain/, .kit/install.json

## Technical Considerations
- Method (checked 2026-10-30): GEPA (arXiv 2507.19457) reflects on failing traces with text feedback, accepts a
  mutation only if it first improves a small minibatch, then evaluates it on the full set, and keeps a Pareto pool;
  it beat RL by ~6% with 35–44× fewer rollouts and produced shorter prompts. EvoSkill (arXiv 2603.02766) keeps a new
  skill only if it beats the weakest of the top-k on a held-out set, and logs every proposal so none repeats. SICA
  (arXiv 2504.15228) scores agent versions on quality, cost and time together. The reward-hacking cases of the Darwin
  Gödel Machine (arXiv 2505.22954) are why the scorer, cases and tests are out of the improver's reach.
- Cost (estimate from BASELINE: check-bugs on sonnet used 4.37M tokens / 3.03 USD for 14 cases × 2 runs, ~156k
  tokens and ~0.11 USD per case-run): a full 3-run gate on ~22 cases ≈ 66 case-runs ≈ 10M tokens ≈ 7 USD; the
  minibatch (6 cases × 1 run) ≈ 0.7 USD. That is far above plan 035's 400k nightly token cap, so G5 has its own cap
  `agentBudgetUsd` (default 10 USD per session) and runs the full gate only on a candidate that passed the minibatch.
- Data: project case content never leaves the Human's machine; the kit gets scores and counts.

## Out of Scope
- Changing `models.*` automatically. New agent roles. Improving `orch-builder` (no case format for building yet).
- Running evals in the cloud.

## Critical Questions
- Spend: A: one session a week (Sunday night), cap 10 USD per session, until the first two PRs show real gains; the
  Human must be able to see and control what it costs (G8) (Human, 2026-10-30).
- Severity tolerance `adjacent` with weight 0.5 — or a full match? A: 0.5 (Human, 2026-10-30).
- Start with `orch-check-bugs` or let the evidence pick? A: `orch-check-bugs` first (Human, 2026-10-30).

## Execution Notes
- Source: `docs/agent-evals/BASELINE.md` (numbers and its "Next"), run-499-502 D30/D33 (misses the checkers did not
  flag), plan 035's design, and the Human's rule that weak agents create more work than they save.

## Finish — review hand-off (replaces /ship)

Build order: wave 6 — after 047 (needs 030, 035, 046).

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
