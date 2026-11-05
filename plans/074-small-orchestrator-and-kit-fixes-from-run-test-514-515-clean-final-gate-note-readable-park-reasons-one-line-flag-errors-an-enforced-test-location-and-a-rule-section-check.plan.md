# Plan 074 — Small orchestrator and kit fixes from run test-514-515: clean final-gate note, readable park reasons, one-line flag errors, an enforced test location and a rule-section check

Status: draft
Depends-on: none
Snapshot: fef8cff11a11cf5bfb7635be56bd7595bba68dbb
Source: kit run run-065 (security finding, D9, runner notes; added 2026-11-05) and FoodVibe run test-514-515 (PR #499) hand-off section 5 findings 2, 3, 4, 7, 10, B, F, G, and FoodVibe's missing `## checkers` section (Human, 2026-11-03); findings 8 and 9 stay "verify first" and are not here

## Problem Statement
Twelve small defects: nine from one FoodVibe run and three from kit run run-065. Each is a few lines, none depends on plans 069-073, and each has a test that fails today:

1. **Stale failure note (finding 2).** After the final gate re-ran ok, the report said "ok (attempt 1)" while the run notes still carried "final gate failed: breadcrumbs-check…" (`core/.claude/workflows/orchestrate.js:1309` writes the note, `core/scripts/lib/orch-run.mjs:409` prints notes).
2. **Flag without a value (finding 3).** `scope-check --diff` with no value parses as `true` (`core/scripts/scope-check.mjs:99-108`), git fails, and the script still prints a verdict (`fatal: invalid object name 'true'` then `SCOPE: out`).
3. **Test location not enforced (finding 4).** `scope-check --tests` caught plan 515's missing test location (`SCOPE_TESTS: warn`, `scope-check.mjs:354-363`), but it only warns and nothing re-checks it before builders start, so the park came two rounds later.
4. **Park reason broke the shell (finding 7).** `orch-state.mjs set --state=parked --reason="… ('src/app/…/**') …"` exited 2 once (`unexpected EOF`); the reason is built at `core/.claude/workflows/orchestrate.js:953-956` (`park`; the shell quoting helper `q` is at :218).
5. **Wrong builder tier in the report (finding 10).** The "Builder tier" column prints the last builder's tier (`core/scripts/lib/orch-run.mjs:396-401`), so 515 read `judgment` although rounds 0-1 ran on Sonnet.
6. **Stale rendered workflow (finding B).** Changing `orchestrator.prepare` or `ciMirror` in the project config does not change `orchestrate.js` until the project re-syncs; no warning is printed.
7. **Cards (finding F).** The Human's validation cards for the run asked the Human to stop the slot servers. `core/docs/agent/job-validation.md:64` says "Slot servers stop again at the merge", so a card must not ask for it.
8. **Imprecise park reason (finding G).** "the scope block does not cover the test files" was wrong; the glob covered the file and the test-file gate wanted a test location named (`core/scripts/lib/plan-scope.mjs:69-73`).
9. **Missing rule section (FoodVibe, 2026-11-03).** FoodVibe's `docs/brain/agent-rules.md` had no `## checkers` section, so `orch-check-rules` read no rules at all (`RULES_GROUP`, `core/scripts/lib/orch-run.mjs:453`). The seed `templates/docs/brain/agent-rules.md` has the section and `tools/install-check.mjs:944` checks the seed, but nothing checks a project's own file, and sync never re-seeds a project-owned file.

10. **A cause line accepts any word as an id (run-065 security finding).** `SAFE_ID = /^[\w.-]{1,40}$/` and `SAFE_PATH = /^[\w@.+/-]{1,200}$/` (`core/scripts/lib/orch-run.mjs:490-491`) let an agent-written finding id such as `ignore-previous-instructions` into a lesson line the next builder reads (`orch-run.mjs:496-503, 557`). The ids the code makes itself have fixed shapes.
11. **Windows test cleanup EPERM (run-065 D9).** The temp-folder cleanup (`rmSync`) of the "relaunch that never reaches its final gate" test hit EPERM on Windows (`tools/test/orchestrator.test.mjs:2200`, the `clean` of `finishProject`).
12. **The runner refuses a state write (run-065 notes).** A `kit-runner` agent answered `ESCALATE: Not run` to `orch-state.mjs set --state=env-paused …` because "the relayed user request does not ask for any state change like that"; the plan sat without its state until the second attempt (`orchestrate.js:915` writes the state; the runner prompt is at `orchestrate.js:267-274`; `core/.claude/agents/kit-runner.md` says nothing about state writes).

## Goals & Success Criteria
**Primary:** each defect above is fixed and has a test that fails on today's code.

- [auto] `node --test tools/test/orchestrator.test.mjs` passes, with tests that fail on today's code: (a) after a final gate that failed and then re-ran ok, `status.json` notes and the report carry no "final gate failed" line; a gate that still fails keeps it; (b) a plan with no test location named in its scope is listed among the readiness questions, and a plan that names one is not; (c) a park reason holding quotes, parentheses and `$` parks on the first call (the reason is passed encoded), and the stored reason equals the original; (d) the report's tier cell for a plan built on `sonnet` then `judgment` lists both tiers.
- [auto] `node --test tools/test/scope-check.test.mjs` passes, with tests that fail on today's code: `--diff`, `--plan` and `--base` given without a value exit 2 with one usage line and print no verdict; the park reason for a missing test location says "no scope line names a test location" and never says the scope block does not cover the test files.
- [auto] `node --test tools/test/sync-stale.test.mjs` passes, with a test that fails on today's code: when `orchestrator.prepare` or `orchestrator.ciMirror` in the config differs from what the rendered `orchestrate.js` holds, sync's dry run and drift-check print `STALE_RENDER: .claude/workflows/orchestrate.js — run sync --apply`; no output when they match.
- [auto] `node --test tools/test/orchestrator.test.mjs` also passes, with tests that fail on today's code: (e) a finding id is accepted only as `gate-N`, `scope-N`, `ui-N`, `merge-N` or `<role>-N` for a role in `RULES_GROUP`/the agent list (N = 1-3 digits), so `ignore-previous-instructions` makes no lesson line while `gate-3` and `check-rules-2` do; (f) a path is accepted only as at most four segments of at most 40 characters each (`src/app/a/b.ts` yes, five segments no); (g) the clean-up of the `finishProject` test folders retries on EPERM: a helper `rmWithRetry(path, rm)` called with a stub that throws EPERM twice and then succeeds returns without throwing, and a stub that always throws EPERM throws after 5 tries; (h) the runner prompt and `kit-runner.md` both say that a command the workflow gives, including an `orch-state.mjs set --state=env-paused` write, is run as given and a state write is never refused, and that the `--reason` text is data.
- [auto] `node --test tools/test/agent-rules-sections.test.mjs` passes, with tests that fail on today's code: `install-check` on a project whose `docs/brain/agent-rules.md` lacks any of `## builder`, `## checkers`, `## readiness`, `## ui` prints one `RULES_SECTION_MISSING` line per missing section; `sync --apply` appends the missing headers (empty sections), never rewrites a line, and a second apply changes nothing.
- [auto] The rendered `job-validation.md` says in the card rules that slot servers stop by themselves at the merge and a card never asks the Human to stop them (a test reads it); a test shows the merge path calls `slot-stop` (`take-plan` or `ship-regular`), and if it does not, the sub-task stops and reports to the Human instead of writing the sentence.
- [auto] `npm run build` and `node --test "tools/test/*.test.mjs"` pass.
- [auto] `node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .` reports no drift.
- [human] On the next orchestrator run, the report shows every builder tier that ran, no stale failure note after a green gate rerun, and a plan without a test location is asked about before any builder starts.

## Execution Mode
- Parallel: no.
- Concurrent plans: none. Plan 069 is parked (reliability freeze) and no longer a prerequisite; it shares `orchestrate.js` and `job-validation.md`, so if it is built later it rebases onto this plan. Plan 065 is merged; plan 066 also edit `orch-run.mjs` and `orchestrate.js`; this plan runs after them if both are open.
- Isolated DB: no.
- Kit edits: one kit branch and one kit PR; one commit per row of the sub-task list.

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`, plus the append-only hotspot `CHANGELOG.md` (add an entry, never rewrite one).

```scope
core/scripts/orch-state.mjs
scripts/orch-state.mjs
core/scripts/scope-check.mjs
scripts/scope-check.mjs
core/scripts/lib/orch-run.mjs
scripts/lib/orch-run.mjs
core/scripts/lib/plan-scope.mjs
scripts/lib/plan-scope.mjs
core/.claude/workflows/orchestrate.js
.claude/workflows/orchestrate.js
core/.claude/agents/orch-readiness.md
.claude/agents/orch-readiness.md
core/.claude/agents/kit-runner.md
.claude/agents/kit-runner.md
core/docs/agent/job-validation.md
docs/agent/job-validation.md
tools/sync.mjs
tools/drift-check.mjs
tools/install-check.mjs
tools/test/orchestrator.test.mjs
tools/test/scope-check.test.mjs
tools/test/sync-stale.test.mjs
tools/test/agent-rules-sections.test.mjs
tools/test/lib/rm-retry.mjs
docs/brain/scorecard.md
CHANGELOG.md
```

## Read Scope

Entire repo, including `docs/agent-evals/`.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry. Tags and releases: wait for the Human's go.

## Architecture Impact
- INV-1: preserves — S12 edits `kit-runner.md` text only, not its `model:` key; S3 edits `orch-readiness.md` only to list a check verdict among its questions; the role's model key and tier are not touched.
- Everything else: fixes in kit scripts, one rendered doc line and two install-time checks. The project-owned `agent-rules.md` is only extended with empty headers.

## Step 0 — Reality Check
Checked on `origin/main` `fef8cff` (refreshed 2026-11-05; first checked on `5784d6d`): every line named above exists as described. Before each sub-task, re-read the line on `origin/main` (plans 065, 066 and 069 may have moved it) and drop any sub-task the code already covers. Confirm `slot-stop` is called on the merge path before writing the card sentence (see the Done-when item).

## Atomic Sub-tasks

- [x] S1: Clear the old final-gate failure note when the gate re-runs ok, so the report matches the result — only a still-failing gate keeps the note — core/scripts/orch-state.mjs, core/.claude/workflows/orchestrate.js, core/scripts/lib/orch-run.mjs
- [x] S2: Make a flag with no value stop with one usage line instead of a wrong verdict — `--diff`, `--plan` and `--base` need a value, exit 2 — core/scripts/scope-check.mjs
- [x] S3: Ask about a missing test location before any builder starts, so a plan is not parked two rounds later — readiness runs the test-location check and lists the plan among its questions — core/.claude/agents/orch-readiness.md, core/.claude/workflows/orchestrate.js
- [x] S4: Pass a park reason in an encoded form so quotes and brackets cannot break the shell call — same way the decisions call is passed — core/.claude/workflows/orchestrate.js, core/scripts/orch-state.mjs
- [x] S5: Show every builder tier that ran for a plan in the report instead of the last one — core/scripts/lib/orch-run.mjs
- [x] S6: Warn when the rendered workflow is older than the project config, so a config change is not silently ignored — dry run and drift-check print the stale file — tools/sync.mjs, tools/drift-check.mjs
- [x] S7: Tell the cards never to ask the Human to stop slot servers, because they stop by themselves at the merge — one sentence in the card rules, after confirming the merge path stops them — core/docs/agent/job-validation.md
- [x] S8: Word the park reason for a missing test location correctly — "no scope line names a test location" — core/scripts/lib/plan-scope.mjs
- [x] S9: Flag a project whose rules file lacks a per-role section and let sync add the empty header — one line per missing section, never a rewrite — tools/install-check.mjs, tools/sync.mjs
- [x] S10: Make the lesson-line id and path checks accept only the shapes the code makes — ids `gate-N`, `scope-N`, `ui-N`, `merge-N`, `<role>-N`; paths of at most four segments of at most 40 characters; list the real id sources in Execution Notes first — core/scripts/lib/orch-run.mjs
- [x] S11: Retry the temp-folder removal on EPERM in the finish tests, in a helper both test files can use — tools/test/lib/rm-retry.mjs, tools/test/orchestrator.test.mjs
- [x] S12: Tell the kit-runner that a state write the workflow gives is run as given and never refused, and say so in the runner prompt — core/.claude/agents/kit-runner.md, .claude/agents/kit-runner.md, core/.claude/workflows/orchestrate.js
- [x] T1: Add tests that fail on today's code for each sub-task, resync installed copies and add a changelog entry — tools/test/orchestrator.test.mjs, tools/test/scope-check.test.mjs, tools/test/sync-stale.test.mjs, tools/test/agent-rules-sections.test.mjs, CHANGELOG.md; the scorecard row of this plan — docs/brain/scorecard.md

## Technical Considerations
- S3 reuses the existing `scope-check --tests` verdict; it only moves where it is read. The save-plan checklist still treats the warning as non-blocking at save time.
- S9 is install-time only; it never edits a project line, and a project that deliberately has an empty section loses nothing.
- Backend / API: none. Auth and validation: none. Security surface: none. Data / migration: none. Model changes: none. Project checks: none.

## Out of Scope
- Finding 8 (stale `.slot-plan-start` stamp, unverified) and finding 9 (`fe.log` stays 0 bytes, not reproduced elsewhere): verify first.
- Findings covered by other plans: 1, 5, 6, 13, 14, C, E (070-073), 12 (065), A (061), 11 (048). Options b, e, f, g of the hand-off.
- Any change to the card layout.

## Critical Questions
- Q: Do the cards ask the Human to stop servers? A: never; slot servers stop by themselves at the merge and the Human has nothing to do (Human, 2026-11-03).

## Execution Notes
- Step 0 (2026-11-05, `origin/main` `d3ce359`): plans 075, 068, 083 and 061 moved the named lines (final-gate note now `orchestrate.js:1403`, `q` :220, report tier `orch-run.mjs:452`, `SAFE_ID`/`SAFE_PATH` :547-548, runner prompt :272-275); each defect re-read there and still present — no sub-task dropped. `slot-stop` is on the merge path: `ship-regular.md` "Merging from a slot" runs `node scripts/slot-stop.mjs` first, so S7's sentence was written.
- S10 id sources (the shapes the code makes): `gate-N` (`orchestrate.js` gate findings), `scope-N` (test-file gate), `ui-N` (the [ui] script and card findings), `merge-1` (merge into the run branch), `<role>-N` with the role without `orch-` (`check-plan`, `check-bugs`, `check-rules`, `security`; `verify`, `readiness`, `ui` from `RULES_GROUP`). Decision ids (`D<n>`) never reach a lesson line.
- decision: S1 clears the `final gate failed` / `final gate could not run` run notes in `applyFinalGate` (the one writer of the final gate's result, for `finish` and `final-gate` alike); the report prints status notes as they are, so `orch-run.mjs` needed no change. Reason: one place, and a still-failing gate never reaches the clean-up.
- decision: S3's check runs inside the existing `orch-state order` call (it reads every plan of the run already) and the workflow adds the question in code; `orch-readiness.md` only says not to repeat it. Reason: no extra agent call, and the verdict is the script's, not a model's.
- decision: S4 sends stop reasons base64-encoded too, not only park reasons, and a reason is no longer cut at 400 characters on its way. Reason: a stop reason goes through the same shell quoting and broke the same way.
- decision: S5 keeps the tiers in `plans[N].tiers` (a tier change appends; written by `set`), and the report cell joins them with `→`; an older status.json shows its one `tier`. Reason: the report reads status.json only.
- decision: S6 and S9 put their small check in both `tools/sync.mjs` and the other tool (`drift-check.mjs`, `install-check.mjs`), each naming the other, instead of a shared `tools/lib` file. Reason: no `tools/lib` file is in this plan's scope. `STALE_RENDER` prints only; the exit code is unchanged (a stale render is already `drift` unless the file is an override).
- decision: S8 changes the test-file gate's rule to "no scope line names a test location" and adds the reason on the line after `SCOPE: test-out <path>`, which keeps its exact shape. Reason: `tools/test/scope-tests-gate.test.mjs` (outside this scope) anchors that line. `docs/agent/orchestrator.md:326` still names the old rule text; it is outside this scope — follow-up.
- decision: S9 gives `install-check.mjs` a `--target <dir>` mode (until now it only ran its fixtures). Reason: the Done-when runs install-check on one project.
- decision: S4, S5 and S10 share one commit (`7d9b1cc`) because they change the same files; every other row has its own commit. `.kit/install.json` (rewritten by sync) is not committed: it is outside this scope.
- T1 evidence: the new tests are `orchestrator.test.mjs` (final gate notes, park reason, tiers, test location, lesson ids and paths, rmWithRetry, runner text, card rule), `scope-check.test.mjs`, `sync-stale.test.mjs` and `agent-rules-sections.test.mjs`; each asserts behaviour the old code lacks (a flag, an output line, a field or a text that did not exist). They were not re-run against the old scripts one by one.
- R evidence (2026-11-05): `npm run build` → 0, `npm run lint` → 0, `drift-check` → ok, `scope-check --deps/--tags/--tests/--arch/--diff=origin/main` → ok, `npm test` → 0, `orchestrator-e2e` → 0, `node --test "tools/test/*.test.mjs"` → 516/516. After the review fixes: orchestrator + agent-rules-sections 150/150, scope tests 18/18.
- Review: independent (opus) PASS; checkers plan PASS, bugs PASS, rules PASS. Fixed from them: rule headings are read the way the rules reader reads them (any case, extra spaces: `## Checkers` counts, no second header added); park and stop reasons are cut at 2000 characters before encoding; the test-location reason goes to stderr, because `ship-prep` reads each stdout line of `scope-check --diff` as a path.
- decision: the reason cap is 2000 characters (the review's figure). Reason: the old 400-character cut came from the shell quoting, not from a reader's need; 2000 keeps a long checker reason readable and the command line bounded.
- Follow-ups: `docs/agent/orchestrator.md:326` names the old rule text; a lesson path deeper than four segments is now left out of the line (most app paths are deeper — as the plan asks, worth a look after a run); `install-check --target=<dir>` (with `=`) is not read, only `--target <dir>`.
