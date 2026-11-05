# Plan 048 — Orchestrator agents get better by measurement: a fair scorer, a growing case set, and an eval-gated prompt improver

Status: draft
Parked: 2026-11-05 — reliability freeze, revisit 2026-11-15
Depends-on: 030, 035, 046, 049
Snapshot: d2d9649a240864a8ff2e74f37a3efeed00701aea

## Problem Statement

The orchestrator's accuracy rests on its checkers, and the kit's own baseline (`docs/agent-evals/BASELINE.md`,
2026-10-22, 25 cases, 2 runs each, exact-severity scorer) says they are weak:

| Role (sonnet) | Recall | Precision |
|---|---|---|
| orch-check-bugs | 0.27 | 0.22 |
| orch-check-plan | 0.30 | 0.38 |
| orch-check-rules | 0.25 | 0.25 |
| orch-verify | 0.33 | 1.00 |

Plan 049 (merged, `3d52a68`) re-measured the same cases and built the comparison tool this plan reuses — see
"Already built by plan 049" below. Its main finding for this plan: **the scorer is far noisier than the numbers above
suggest.** The same unchanged prompt moved by up to 0.25 between runs (check-rules recall 0.25 on 2026-10-22, 0.50 in
both of 049's runs; check-bugs precision 0.20 → 0.10 between 049's `before` and `after` with the finder files
byte-for-byte equal), and with 2 runs the check-plan redaction experiment could not be decided because `d` was 0.80
(`docs/agent-evals/049-checkers-hardening.md`). A change that moves a figure by less than `d` is noise.

Three things keep these numbers from going up:

1. **The scorer under-counts.** A finding matches only when `severity` equals the label's
   (`tools/lib/agent-eval/compare.mjs` `findingMatches`); a run that found the exact
   planted line and rated it `blocker` where the label says `major` scored 0 (`planted-inverted-comparison`).
   BASELINE "Next" asks for a severity tolerance before the numbers can gate anything.
2. **The case set is small and static.** 3–14 cases per role; one case moves recall by 0.07–0.33. Real misses happen
   in runs every week (run-499-502: the checkers passed plan 502's removal of the date chip's keys — D33 — and plan
   501's wrong handler count — D30), but only plan 030 L7 turns a graded miss into a case, and only inside a project.
3. **Agent prompts change by hand, unmeasured.** Nothing proposes an edit from the failing cases, and nothing keeps an
   edit only when the numbers go up. Plan 035 builds exactly this loop for skills; agents are left out.

The Human's standing rule: every orchestrator agent, the code reviewer first, must be made reliable before the run
leans on it (2026-10-27); judging roles never run on Haiku.

### Already built by plan 049 — reused here, not rebuilt

- `tools/agent-eval.mjs --json` prints per-run totals (`runTotals`) and the run-to-run spread (`total.spread` = max − min
  of the per-run totals; `spreadOf` and `runTotals` in `tools/lib/agent-eval/run.mjs`). `--runs N` already works.
- `tools/agent-eval-ab.mjs` is the one comparison tool: `threshold()` gives `s` (the larger spread of the two arms) and
  `d = max(0.05, 2 × s)`; `judge()` prints a verdict per figure (`improved` / `regressed` / `no real change`) and an
  `over +20 %` cost row (USD per case). It exports `loadReports`, `threshold`, `judge`, `compare` and `adoptRedaction`.
  Test: `tools/test/agent-eval-ab.test.mjs`.
- Options `--case-list <file>`, `--redact`, `--with-gate` on `agent-eval.mjs`; `docs/agent-evals/baseline-2026-10-22.cases.txt`
  (the 25 BASELINE cases); `docs/agent-evals/049-checkers-hardening.md`; raw reports in
  `docs/agent-evals/runs/049-before|redact|gate|after/`.
- Known defect, fixed by G1: `judge()` calls a precision drop of more than 0.02 `regressed` whatever `d` is — 049's
  check-bugs drop 0.20 → 0.10 (d = 0.40) was flagged for an unchanged agent.

## Goals & Success Criteria
**Primary:** a checker's prompt changes only when a measured run on a fair scorer and a growing case set shows it
finds more real problems without more false alarms, and the Human merges the change.

- [auto] Scorer: `node tools/agent-eval.mjs … --severity-tolerance adjacent` counts a finding whose severity is one step
  from the label's (`blocker`↔`major`, `major`↔`minor`) as a match with weight 0.5 (new `partial` column); `exact`
  keeps today's scoring (and keeps 049's reports comparable); the test reproduces `planted-inverted-comparison`
  (`blocker` vs `major`) scoring 0 today and 0.5 with `adjacent`. A partial counts half a hit and half a miss for
  recall, half a hit and half a false alarm for precision: recall = (tp + 0.5·partial) / (tp + partial + fn),
  precision = (tp + 0.5·partial) / (tp + partial + fp).
- [auto] One real-difference rule, owned by `tools/agent-eval-ab.mjs` (plan 049): no second rule is written in
  `compare.mjs` (that file only matches findings). `--runs N` and the spread already exist; this plan adds no spread
  code. The one change to `judge()`: a precision drop is `regressed` only when `before − after ≥ d` (today it is
  `> 0.02`); `orch-verify` precision below 1.00 stays `regressed` (the one exact exception). The test replays
  `docs/agent-evals/runs/049-before` and `049-after` for orch-check-bugs: precision 0.20 → 0.10 with d = 0.40 prints
  `no real change` (it printed `regressed`), and a drop equal to d prints `regressed`.
- [auto] Case growth from the kit's own history: `node tools/agent-eval-cases.mjs from-fix --commit <sha>` writes a
  case folder (`input/` from the parent commit's touched files + the diff, `expected.json` from the fix's test name
  and the changed lines, `README.md` `fixed by <sha>`), refusing a commit with no test change; `--dry-run` prints it.
  Test on a fixture repo.
- [auto] Local project cases are read in place, never copied: `eval-sources.json` (state folder: Critical Questions) lists project
  case folders (plan 030 L7's `docs/agent-evals/cases/`); the improver evaluates on kit cases + those, and only the
  counts leave the machine (`leak-check` on the PR body).
- [auto] Improver for agents: `node tools/skill-improver/run.mjs --target agent --role check-bugs --once --driver
  <stub>` (plan 035's runner, a new target type): runs the role on the cases, collects the failed cases with their
  feedback (missed `file:line` + label note; false alarm + why), asks the editor model for ONE edit of at most 15
  changed lines in `core/.claude/agents/orch-<role>.md`, then the gate:
  1. minibatch: the 3 worst failed cases + 3 passed cases — the candidate must not lose a passed case and must fix ≥1;
  2. full set, `gateRuns` runs per case (3 until Step 0 stores a measured number per role in BASELINE.md): the gate
     calls `judge()` from `tools/agent-eval-ab.mjs` on the before and after reports. Adopt only when recall **or**
     precision is `improved` and neither is `regressed` (a drop counts only when it reaches `d`; no fixed 0.02), and
     the cost row is not `over +20 %` (USD per case — 049's figure; tokens are printed beside it). Verdict per
     outcome: `improved` → adopt; `regressed` → reject; **`no real change` on both → not adopted, and nothing is
     reverted** (the agent file on `main` is untouched; the line in the rejected log says `inconclusive, d = <x>` so
     it can be retried with more runs or 3+ new cases). A merged prompt is never auto-reverted: a later re-measure
     that shows `regressed` is printed for the Human to decide;
  3. accepted → branch `learn/agent-<role>-<date>` (see Critical Questions on the prefix), PR with the before/after
     table including `s` and `d`, the cases fixed, the edit; the
     prompt version and its scores go to `docs/agent-evals/archive/<role>.jsonl` (kit repo; scores and the prompt's
     git sha only); rejected → one line in the rejected log (location: Critical Questions) with the edit's summary,
     never proposed again unless the case set grew by 3+.
  A role whose `d` stays above 0.5 at its `gateRuns` is printed as `not measurable: d = <x>` and skipped — the gate
  never adopts on a difference smaller than the noise.
- [auto] The improver never edits a case, a label, the scorer or `tools/test/**` (path guard: `KIT_LEARN: protected
  <path>`), and the editor and judge are separate model calls; the scorer is code, not a model.
- [auto] Pick: the role to work on is the one with the most evidence of being wrong — from the brain (046): checker
  misses per role (`missed:` lessons, final-gate/UI failures after a clean pass), refuted rate, `✗` kinds tied to a
  role — weighted by its current recall gap; printed with its numbers before any token is spent.
- [auto] After an accepted change the runner re-checks the cheapest model within 0.05 of the best for that role
  (BASELINE's rule) and prints it; it never changes `models.*` by itself.
- [auto] Noise per role, measured after the scorer change (G2): each role's current, unchanged agent runs 6 times per
  case under `adjacent`; `docs/agent-evals/BASELINE.md` gets a "Noise per role" table — for each run count n from 2 to
  6, the spread `s` of the first n run totals, `d = max(0.05, 2 × s)` (`threshold()` of `agent-eval-ab.mjs`), and
  whether `d` is at most 0.25 (`reached` / `not reached`). The improver reads each role's `gateRuns` (smallest count that reaches it, else
  `not measurable`) from that table. Nothing in this plan states a run count that this table has not measured.
- [auto] Check-plan redaction re-run (049 follow-up): `node tools/agent-eval.mjs --agent .claude/agents/orch-check-plan.md
  --redact --runs <gateRuns of check-plan> --case-list …` against an unredacted arm of the same run count; the
  verdict is `agent-eval-ab.mjs … --adopt-rule redaction` output in `docs/agent-evals/048-redact-check-plan.md`.
  Whether redaction is adopted is the Human's call, and adopting it (the finders get a redacted plan copy in real
  runs) edits `core/.claude/workflows/orchestrate.js`, outside this plan's scope — a separate plan.
- [auto] BASELINE.md keeps its history: the 2026-10-22 tables ("## Results (2 runs per case)", the per-case lines)
  and the "## After plan 049" section stay as they are; the re-measured tables are added under a new heading.
  `git diff -U0 origin/main -- docs/agent-evals/BASELINE.md` shows no removed line that starts with `|`.
- [auto] Budget: shares plan 035's nightly cap; `--budget` stops cleanly; `node --test "tools/test/*.test.mjs"`, `install-check`,
  `leak-check`, R1 pass.
- [human] The Human merges a first agent-improver PR after reading its table; the BASELINE re-run with
  `adjacent` tolerance is committed as the new baseline (added next to the old tables, not over them).

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
tools/agent-eval-ab.mjs
tools/lib/agent-eval/**
tools/agent-eval-cases.mjs
tools/skill-improver/**
tools/test/agent-eval.test.mjs
tools/test/agent-eval-ab.test.mjs
tools/test/agent-eval-cases.test.mjs
tools/test/skill-improver.test.mjs
tools/test/skill-improver-agent.test.mjs
tools/test/fixtures/agent-eval-stub.mjs
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
1. Plan 035 merged (runner, budget, judge, worktree isolation — its S10 one-month review stays open until 2026-11-17
   and is not a blocker). Plan 046 merged (brain reader, protected paths, the state folder 046 names — see Critical
   Questions). Plan 049 merged (`3d52a68`): `tools/agent-eval-ab.mjs` exists and exports `threshold` and `judge`.
2. Re-run `orch-check-bugs` (sonnet, 3 runs, `--case-list docs/agent-evals/baseline-2026-10-22.cases.txt`, exact
   scorer, before any scorer change) and compare it with `docs/agent-evals/runs/049-before` using
   `node tools/agent-eval-ab.mjs --before docs/agent-evals/runs/049-before --after <new dir>`. Pass = no figure
   prints `improved` or `regressed` (every figure `no real change` at its own `d`). This replaces "within 0.05 of
   BASELINE.md": 049 showed that an unchanged prompt moves by more than 0.05 between runs. Write `s` and `d` here.
   Record the result: ______ (filled by the Worker).
3. The case set is now 27, not 25: plan 042 added `orch-check-plan/clean-removal-named-in-plan` and
   `orch-check-plan/planted-unlogged-removal` (74e2c6f). The 25-case list file stays the continuity set; G2 and the
   improver use the full folder.
4. Drift since the Snapshot (`node scripts/scope-check.mjs --drift --plan=<this plan>`, run 2026-11-01 against
   `d2d9649`; 67 commits). Each one checked against this plan's scope and claims:

   | Commits | What | Verdict |
   | --- | --- | --- |
   | a1e2502, 72647db, 3d52a68 | 049: `agent-eval-ab.mjs`, `--case-list/--redact/--with-gate`, spread, 049 doc and runs, BASELINE "After plan 049" | conflict, handled: G1, G2, G2b, C1 rewritten |
   | e31b74f, 03d6b3d, 05bdcc9, 4a60445, 12bcccb, 4afb23a, 0aea2b2, 47ed4cf, 9b842f1, 2063201 | 035: `tools/skill-improver/` (`run.mjs`, `pick.mjs`, `evidence.mjs`, `lib/*`), spend log, billing line, branch prefix `chore/skill-improve-`, test pins `--target agent` → exit 2 | conflict, handled: G5, G6, G8 and Critical Questions |
   | 39ea5bc, d2d9649, 9de9e45 | 055: plans name the test location in scope; `scope-check --tests` | ok — every step below names its test file |
   | 5b3c7e5, 8dd9dd9, fc71607, 8e98207, 3002bbb, f3ff6ad, 65f45bb, 4c99abd, 1bc1b08 | 030: lessons, eval-case scaffold in `decision-log.mjs` writes `docs/agent-evals/cases/<checker>/…` in the project, edits `core/docs/agent/agent-evals.md` | ok — matches G4's project case folders; C1 appends to the same doc |
   | 241b673, 74e2c6f, 0d720de, 6540c16, 81458a4, 5d34f89, 56e99df | 042: two new check-plan cases | ok — noted in item 3 |
   | 1164038, 25276e1, 0569a93, 8ee680c, edd6f8b, 17d9084, b58daf4 | 041: decision triage | ok — no file in scope; grades stay a source for G6 |
   | 26efb4e, 1918303, 924dd8c, 0cf30fa, 3d0c811, 0cbe6bd | 044: run end, CI mirror, plan-close | ok — no file in scope |
   | 33259af, feac372, 591b014, 2db2541 | 043: readiness claims | ok — no file in scope |
   | 078cb8e, 938aaca | 040: slot-only checks, app errors | ok — G3's case list now includes plan 040 (merged) |
   | 7cf80cb, 596e865, bfb41dd, ffceeb9, 9df2187, 95f7519 | 031 override markers, 036 scout | ok — no file in scope |
   | 38393c6, f93f775 | archive of merged plans, `plan-close` | ok — plan files moved under `plans/1-100/`; no reference here breaks |
   | 58be273, 3dd4a29, 8c0048d, dd1cb13, 7b50b94 | plan files only (049, 050–054, finishing steps) | ok |
   | 2bf1f8d, af46a34, c6560f0 | 039 fleet progress | ok — no file in scope |

## User Stories
- As the Human, I want a checker's prompt to change only when it measurably finds more real problems.
- As the Human, I want every real miss from a run to become a case the checkers are measured on.
- As the Human, I want to see one table per change: before, after, cases fixed, cost per case.

## Functional Requirements

### Must Have (P0)
- [ ] Severity tolerance in the scorer; the precision-regression rule in `agent-eval-ab.mjs` uses `d`.
- [ ] Noise per role measured (G2) and each role's `gateRuns` stored before the improver uses it.
- [ ] Agent target in plan 035's runner with the two-stage gate, archive and rejected log.
- [ ] Path guard: cases, labels, scorer, tests are never edited by the improver.

### Should Have (P1)
- [ ] Cases from the kit's own fix commits; local project case folders read in place.
- [ ] Evidence-driven pick of the role.

- [ ] Check-plan redaction re-run with enough runs (G2b).

### Nice to Have (P2)
- [ ] Cheapest-model re-check after an accepted change.

## UI/UX Notes
PR body table (plain text; the verdicts are `agent-eval-ab.mjs` output, never typed; numbers illustrative):
```
role check-bugs · cases 22 (kit 14 + local 8) · gateRuns 5 · tolerance adjacent
          recall  precision  noise  tokens/case
before    0.27    0.22       0.57   156k
after     0.41    0.24       0.52   161k
          s / d    verdict
recall    0.08 / 0.16   improved
precision 0.06 / 0.13   no real change
cost      +3 %          reported
fixed: fixed-010-empty-lockfile, fixed-017-cd-unknown-folder · lost: none
```
When both recall and precision print `no real change` the PR is not opened: the log says `inconclusive, d = <x>`.

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [ ] G1: Score fairly and fix the one rule that is tighter than the noise — `--severity-tolerance exact|adjacent` (default `adjacent` once the new baseline is committed) with a `partial` column; a precision drop is `regressed` only at `d`. Changes: `findingMatches`, `matchFindings`, `compareCase` in `tools/lib/agent-eval/compare.mjs` (severity is compared there, not in `score.mjs`); `scoreCase`, `scoreTotal` in `tools/lib/agent-eval/score.mjs` (partial weights); the option passed through `tools/lib/agent-eval/run.mjs` and parsed in `tools/agent-eval.mjs`; `judge()` precision branch only in `tools/agent-eval-ab.mjs` (`compare.mjs` gets no real-difference code, `agent-eval-ab.mjs` already has `threshold()`); tests incl. `planted-inverted-comparison` and the 049 check-bugs replay — tools/agent-eval.mjs, tools/lib/agent-eval/compare.mjs, tools/lib/agent-eval/score.mjs, tools/lib/agent-eval/run.mjs, tools/agent-eval-ab.mjs, tools/test/agent-eval.test.mjs, tools/test/agent-eval-ab.test.mjs
- [ ] G2: Re-measure the baseline with the fair scorer and measure the noise per role — sonnet, the full case folder (27 cases), 6 runs per case under `adjacent`, for the four roles; fill the "Noise per role" table and each role's `gateRuns`; add the new tables to `docs/agent-evals/BASELINE.md` under a new heading and keep the 2026-10-22 tables and "After plan 049" as they are (opus is re-measured only when G7 needs it; see Critical Questions) — docs/agent-evals/BASELINE.md, docs/agent-evals/runs/**
- [ ] G2b: Re-run the check-plan redaction experiment with enough runs to decide it (049 follow-up) — `--redact` against the unredacted arm at check-plan's `gateRuns`, verdict from `agent-eval-ab.mjs --adopt-rule redaction`, written up; adopting it in real runs is a separate plan — docs/agent-evals/048-redact-check-plan.md, docs/agent-evals/runs/048-redact/**, tools/test/agent-eval-ab.test.mjs
- [ ] G3: Grow the kit's case set from its own fixes — `tools/agent-eval-cases.mjs from-fix --commit <sha>` and `list-candidates --since <tag>` (merge commits whose PR changed a test under `tools/test/`); add cases for the orchestrator fixes since the baseline (plans 029, 032, 033, 034, 037, 038 and 040, now merged; `list-candidates` also lists 041, 043, 044 and 049 — each added only if its fix has a test); every written case must pass `tools/test/eval-cases.test.mjs` (run, not edited) — tools/agent-eval-cases.mjs, docs/agent-evals/cases/**, tools/test/agent-eval-cases.test.mjs
- [ ] G4: Read project cases in place — `eval-sources.json` (`[{ "dir": "C:\\…\\docs\\agent-evals\\cases" }]`); the runner passes each dir to `agent-eval.mjs --cases`; reports name a source only as `local <n>`; nothing from a source is written to the kit repo — tools/skill-improver/**, tools/test/skill-improver-agent.test.mjs
- [ ] G5: Improve one agent per session by the two-stage gate — runner target `agent` on plan 035's `tools/skill-improver/run.mjs` and `lib/*` (today `--target agent` exits 2 and `tools/test/skill-improver.test.mjs` line 248 pins it: change that test to another unknown target): evaluate, collect failures with feedback, editor call (≤15 changed lines, one edit, the agent file only), minibatch gate, full gate through `judge()` of `tools/agent-eval-ab.mjs` (imported, not copied), archive / rejected log, PR — tools/skill-improver/**, core/.claude/agents/skill-judge.md, tools/test/skill-improver.test.mjs, tools/test/skill-improver-agent.test.mjs
- [ ] G6: Pick the agent with the most evidence of being wrong — brain query per role (046's reader): misses, refuted rate, `✗` kinds; weighted by recall gap; roles whose `gateRuns` says `not measurable` are listed but not picked; printed before spending; a role pick sits next to 035's `pick.mjs` (skills) and does not change it — tools/skill-improver/**, tools/test/skill-improver-agent.test.mjs
- [ ] G7: Re-check the cheapest model after a change (P2) — run the changed role on the other review-tier model; print `cheapest within 0.05: <model>`; never write `models.*` — tools/skill-improver/**
- [ ] G8: Extend plan 035's cost meter to a dollar cap for the agent target, whichever way Claude Code is billed — 035 already has `Meter` (`tools/skill-improver/lib/budget.mjs`: tokens without cache reads, dollars from `total_cost_usd`), `billingMode()` (`api-key` when `ANTHROPIC_API_KEY` is set, else `plan-limits`), the `SKILL_IMPROVER: billing <mode>` line and `appendSpend` → `spend.jsonl` `{date, target, mode, usd, tokens, result}` in the state folder. This step adds only what is missing: a dollar cap `agentBudgetUsd` (the existing cap counts tokens, and BASELINE's tokens include cache reads, so the two are not comparable) that stops the session either way; `workspace <name>` in the printed mode for the API-key case (`KIT_IMPROVER_API_KEY`, passed only to the child process as `ANTHROPIC_API_KEY`); a `role` field in the spend line; `run.mjs --spend` printing this month's total per mode; an estimate printed before the full gate (`gateRuns` × cases × the role's USD per case-run from the last baseline) and a stop `IMPROVER: cap too small for <n> runs` when it exceeds the remaining cap; `agent-evals.md` §Cost says how to put the API-key mode in its own Console workspace with a monthly spend limit and auto-reload off (support.claude.com/en/articles/15036540, checked 2026-10-30) — tools/skill-improver/**, core/docs/agent/agent-evals.md, tools/test/skill-improver-agent.test.mjs
- [ ] C1: Document — `agent-evals.md` (tolerance, where the real-difference rule lives — `agent-eval-ab.mjs` — and what each verdict does, `gateRuns` and the noise table, case sources, the improver and its gate, protected files); CHANGELOG — core/docs/agent/agent-evals.md, CHANGELOG.md, README.md
- [ ] T1: Tests that fail on today's code — every Goals test item, all with stub runners (`tools/test/fixtures/agent-eval-stub.mjs` exists; extend it only if a stub needs a new reply) — tools/test/agent-eval.test.mjs, tools/test/agent-eval-ab.test.mjs, tools/test/agent-eval-cases.test.mjs, tools/test/skill-improver.test.mjs, tools/test/skill-improver-agent.test.mjs, tools/test/fixtures/agent-eval-stub.mjs
- [ ] R1: Render the kit's own installed copies and check drift — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .` — scripts/, .claude/, docs/agent/, docs/brain/, .kit/install.json

## Technical Considerations
- Method (checked 2026-10-30): GEPA (arXiv 2507.19457) reflects on failing traces with text feedback, accepts a
  mutation only if it first improves a small minibatch, then evaluates it on the full set, and keeps a Pareto pool;
  it beat RL by ~6% with 35–44× fewer rollouts and produced shorter prompts. EvoSkill (arXiv 2603.02766) keeps a new
  skill only if it beats the weakest of the top-k on a held-out set, and logs every proposal so none repeats. SICA
  (arXiv 2504.15228) scores agent versions on quality, cost and time together. The reward-hacking cases of the Darwin
  Gödel Machine (arXiv 2505.22954) are why the scorer, cases and tests are out of the improver's reach.
- Noise seen in plan 049 (Sonnet, 2 runs, `s` = max − min of the two per-run totals; the finder agents were identical
  in `before` and `after`, so these are pure run-to-run noise): check-bugs recall 0.08 and 0.23, precision 0.06 and
  0.20; check-plan recall 0.40 and 0.00, precision 0.40 and 0.13; check-rules 0.00 and 0.00 within a session — but its
  recall was 0.25 on 2026-10-22 and 0.50 in both 049 runs, so a session-to-session shift of 0.25 is not seen by the
  within-session spread. orch-verify: 0.00 (and 0.33 in the `gate` arm, with 1–4 invalid-JSON errors in the `before`
  and `gate` runs). Rough per-run standard deviation from those four pairs: ≈ 0.12 for check-bugs, ≈ 0.2 for
  check-plan (an estimate from two pairs, not a measurement).
- Run count and `d`: `d = max(0.05, 2 × s)` with `s` a range (max − min), and a range does not shrink when runs are
  added — it can only grow. So for check-plan (`s` 0.13–0.40, `d` 0.27–0.80) no run count makes `d` small under
  today's rule; the 049 report's own conclusion ("two runs cannot decide small effects") would hold at 5 runs too.
  Only the *mean* of n runs gets steadier (its standard deviation is σ/√n; for a 95 % difference of two means,
  ≈ 2.8·σ/√n: ≈ 0.39 at n = 2 and ≈ 0.25 at n = 5 for σ = 0.2; ≈ 0.15 at n = 14). Whether the improver should keep
  `d` as a range or compare means is open (Critical Questions, default: keep `d` as it is). G2 measures `d` per
  role and run count and stores `gateRuns`; where it is `not reached`, that role is `not measurable` until more
  cases or a better-behaved `d` exist, and the improver says so instead of guessing.
- Cost (USD per case-run, from 049's reports, Sonnet: check-bugs 0.09–0.11, check-plan 0.03–0.06, check-rules
  0.09, orch-verify 0.03–0.10 with the gate shown; BASELINE's 0.11 and 156k tokens for check-bugs include cache
  reads): a full gate for check-bugs on ~22 cases is 66 case-runs ≈ 6–7 USD at 3 runs and ≈ 11 USD at 5 runs
  (above the 10 USD session cap); check-plan on 7 cases at 6 runs ≈ 2 USD; check-rules on 3 cases at 6 runs ≈ 1.6
  USD. G2's re-measure (4 roles, 27 cases, 6 runs, Sonnet only) ≈ 14 USD; adding Opus would be ≈ 3× that. The minibatch
  (6 cases × 1 run) ≈ 0.7 USD. These are far above plan 035's 400k nightly token cap (which counts tokens without cache
  reads), so G5/G8 use the dollar cap `agentBudgetUsd` (default 10 USD per session), print the estimate first, and
  run the full gate only on a candidate that passed the minibatch.
- Data: project case content never leaves the Human's machine; the kit gets scores and counts.

## Out of Scope
- Changing `models.*` automatically. New agent roles. Improving `orch-builder` (no case format for building yet).
- Running evals in the cloud.
- Giving the finders a redacted plan copy in real runs (049's H2b; edits `core/.claude/workflows/orchestrate.js`):
  only the *decision* data comes from G2b; building it is a separate plan if the Human adopts it.
- Making `gate.json` captured instead of constructed (049: the three verify cases use a constructed "all checks
  passed" file) and measuring the test-file gate, replan verdict, receipt and no-progress stop with cases (049: not
  exercised by the 25 cases): no case format for them yet.
- Changing `agent-eval-ab.mjs` beyond the precision branch of `judge()`: no new verdicts, no change to the redaction
  rule or to how `s` is computed (see Critical Questions).

## Critical Questions
- **Open — default given.** `d` is a range, so more runs do not shrink it (Technical Considerations). Keep
  `threshold()` as it is, and mark roles whose `d` stays above 0.5 `not measurable`? Or change `s` to a standard-error
  form (e.g. `2 × s / √n`)? Default: keep it as it is — this plan reuses 049's rule and does not write a second one;
  a change is a separate Human-approved edit to `agent-eval-ab.mjs`, proposed with G2's table in hand.
- **Open — default given.** Where do the improver's files live? 035 keeps its state in `SKILL_IMPROVER_HOME` (default
  `~/.claude/skill-improver`, `spend.jsonl` there); this plan said `<home>/.kit-learn/` (`eval-sources.json`,
  `agent-rejected.jsonl`, `spend.jsonl`), a folder plan 046 names and has not built. Default: use 035's state folder
  for all three files; if 046's reader provides `.kit-learn`, move them in one step then (Step 0 item 1 checks it).
- **Open — default given.** Branch prefix: this plan said `learn/agent-<role>-<date>`; 035's open-PR cap and picker
  match only `chore/skill-improve-`. Default: `chore/skill-improve-agent-<role>-<date>` so the cap of 3 open improver
  PRs covers agent PRs too.
- **Open — default given.** G2 measures Sonnet only (BASELINE: Opus is not measurably better on any role and costs ≈ 3×);
  Opus runs only inside G7 for the changed role. Default: Sonnet only.
- **Open — default given.** G2 and the improver use the full case folder (27 cases, including 042's two check-plan
  cases); the 25-case list file is kept for comparisons with exact-scorer reports. Default: full folder.
- Spend: A: one session a week (Sunday night), cap 10 USD per session, until the first two PRs show real gains; the
  Human must be able to see and control what it costs (G8) (Human, 2026-10-30). Note: the 5-run full gate for
  check-bugs (≈ 11 USD) exceeds that cap, so G8 stops with `cap too small` unless the Human raises it.
- Severity tolerance `adjacent` with weight 0.5 — or a full match? A: 0.5 (Human, 2026-10-30).
- Start with `orch-check-bugs` or let the evidence pick? A: `orch-check-bugs` first (Human, 2026-10-30).

## Execution Notes
- Source: `docs/agent-evals/BASELINE.md` (numbers and its "Next"), run-499-502 D30/D33 (misses the checkers did not
  flag), plan 035's design, and the Human's rule that weak agents create more work than they save.
- Updated 2026-11-01 to match plan 049 (merged `3d52a68`): reuse of `agent-eval-ab.mjs` and its `d`; the two rules
  tighter than the noise replaced; run count made a measured item (G2); 049's follow-ups placed (G2b, G1) or listed in
  Out of Scope; BASELINE.md history kept; Snapshot refreshed to `d2d9649`; drift recorded in Step 0.
- Not verified when this update was written: plans 030/045/046 are `draft` files although 030's commits are merged
  (Step 0 item 1 checks 046's state folder and reader); the 25 → 27 case count was counted from `expected.json` files in
  git; the per-run σ values are estimates from two pairs.

## Finish — review hand-off (replaces /ship)

Build order: wave 6 — after 047 (needs 030, 035, 046).

When the plan is fully implemented, finish with a review hand-off instead of shipping. Do NOT merge, do NOT run /ship,
do NOT open a PR. This replaces every merge, `/ship`, PR, release or tag step written elsewhere in this plan. `[human]`
items and Human steps stay open and are listed under "Open risks".

While implementing: whenever the plan leaves something open and you choose, note it right away so it appears under
"Decisions you made on your own".

Finishing steps:
1. Fetch origin. If this branch was never pushed, rebase it on the latest origin/main. If it was already pushed, merge
   origin/main into it instead (no rebase, so no force push is needed). Known conflicts: CHANGELOG.md → keep both
   sides; .kit/install.json → take origin/main's copy, rerun `node tools/sync.mjs --target . --apply`, and confirm the
   `required` key still lists 5 steps for .github/workflows/ci.yml and 2 for security.yml. Any other conflict → stop
   and tell me which files conflict.
2. From the kit root run: npm run build, npm run lint, npm test, `node tools/drift-check.mjs --target .` and
   `node --test "tools/test/*.test.mjs"` (quoted glob: the bare folder form fails on Node 24). Also run this plan's own
   `[auto]` Done-when commands. Fix failures that belong to this plan, then rerun; any that still fail go under
   "Open risks". A timing failure in tools/test/guards.test.mjs that passes when that file is rerun alone is machine
   load, not this plan: note it under "Open risks" and move on.
3. Commit everything and push the branch to origin. If the push is refused, do not try another route: give me the
   exact command to run.
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
drift-check: pass/fail
tool tests: pass/fail
<if any failed: the failing lines only>

Files changed (git diff --stat origin/main...HEAD):
<paste>

Open risks / things you could not verify:
<list, or "none">
=== END ===
```

After the Human approves the hand-off: open the PR, wait for both CI checks (leak-check and e2e) to pass, then merge.
If a check fails, stop and show me the failing lines.
