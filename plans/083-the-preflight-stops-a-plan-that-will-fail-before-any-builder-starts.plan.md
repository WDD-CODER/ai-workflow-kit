# Plan 083 — The preflight stops a plan that will fail, before any builder starts

Status: draft
Depends-on: 068
Snapshot: fef8cff11a11cf5bfb7635be56bd7595bba68dbb
Source: FoodVibe run run-513-516c (2026-11-04: 755k tokens, 1 of 2 plans merged, 16 decisions) and kit run run-065 (2026-11-04: 633k tokens, 74+ minutes) — Human brief of 2026-11-05 (reliability freeze until 2026-11-15)

## Problem Statement

Two runs on 2026-11-04 each ended with a technical stop that a check before the first builder could have named. The Human's
brief lists six causes; they are one theme: **a plan that cannot succeed is found only after builders have spent tokens on it.**

1. **A plan that asks for what a commit guard blocks.** FoodVibe plan 513 required a log line the pack's pre-commit guard
   (`packs/angular/scripts/pre-commit-security-grep.mjs`) refuses; the builder built it, the commit was blocked, and the plan
   parked after the work was done. The guard also misses the real leak: it flags a log call only when a PII name appears *on the
   log line itself* (`PII_NAMES.test(line)`, l.38-41), so `const t = user.token` … `console.log(t)` passes, while an innocent
   line is blocked, and the only way out is to rewrite the code. There is no marker for a deliberate, explained exception.
2. **No login recipe for a role.** [ui] cards name a role; the project config holds one QA login at most (`ORCH_QA_USER`,
   `--login`, `core/scripts/orch-preflight.mjs` `uiChecks()`), so a card for a second role cannot log in and fails late.
3. **Leftovers of earlier runs.** Branches and occupied slots from a parked run are found only when `worktree` fails
   (`core/scripts/orch-state.mjs` `worktree()`, l.905-962). On a park the builder's uncommitted work stays in the slot, so the slot
   stays occupied and the work is easy to lose.
4. **An unlisted database write.** A builder may run a seed, migration or write script against a database the plan never said it
   would touch; nothing asks first.
5. **The report says "Decisions: none" with 16 decisions.** Run run-513-516c printed `## Decisions` / `- none` and `ask: 0` although
   `status.json` held 16. (`core/scripts/lib/orch-run.mjs` `decisionsSection` l.346-348 and `formatReport` l.406 read
   `decisions ?? status.decisions`; `core/scripts/orch-state.mjs` `finish` l.1389-1391 passes `status.decisions`.) The cause is not yet
   known — Step 0 reproduces it before any fix.
6. **No way to resume only the merge.** Run run-065 built and checked plan 065, then lost the merge to an environment problem;
   the only way back was a full relaunch. `orchestrate.js` has the in-run `merge-retry` mode (l.1012, l.1112) but no entry that
   starts a run at the merge of a plan already built and checked.

## Goals & Success Criteria

**Primary:** a plan that will fail for one of these reasons is parked or asked about *before* any builder starts, naming the cause;
the report counts the decisions the run really took; a built and checked plan can be merged on its own.

- [auto] `node --test tools/test/security-grep.test.mjs` passes, with tests that fail on today's code: (a) a log call of a variable assigned from a PII-named expression earlier in the same file (`const t = user.token` … `console.log(t)`) is reported; (b) a line carrying `// security-grep-allow: <reason of at least 10 characters>` is not reported for that line only — the next line, the same line with an empty or shorter reason, and a file in the same folder are still reported; (c) no option, path or folder name switches the guard off.
- [auto] `node --test tools/test/orchestrator-preflight-plan.test.mjs` passes, with tests that fail on today's code: (d) a plan whose text prescribes `console.log(user.token)` is parked by preflight before a builder starts, with `guard pre-commit-security-grep.mjs line <n>: log call references likely-PII name` and the plan line it came from; the same plan with the allow marker and a reason in the prescribed line is not parked; (e) a plan with a [ui] card for role `admin` and no `ui.logins.admin` in the project config is flagged `ui login: no recipe for role admin (plan NNN card <n>)` by preflight, and a plan whose roles all have a recipe is not; (f) preflight lists leftover `park/*` and `feat/NNN-*` branches and occupied slots of earlier runs, one line each, and a clean repository lists none.
- [auto] `node --test tools/test/orchestrator-park-branch.test.mjs` passes, with tests that fail on today's code: on a park, the builder's uncommitted work is committed as `WIP: park <run> <NNN>` on the branch `park/<run>-<NNN>` (fixed name), that branch is pushed, the slot is released (detached, no marker), and a second park of the same plan adds to the same branch; a park with nothing to commit creates no branch.
- [auto] `node --test tools/test/db-write-ask.test.mjs` passes, with tests that fail on today's code: `dbWriteKind(cmd)` names `migrate`, `seed`, `raw-write` or `null` for the commands in the table in Technical Considerations; a builder command of one of those kinds that the plan's text does not list makes the guard answer with `ESCALATE: db-write <command>` before the command runs, and the workflow records an `ask` (not a plain park) with that text; a listed one runs. The rule applies only inside an orchestrator builder's worktree, detected from the run's own marker or state (never from the session's start folder): the same unlisted `npm run seed` is asked about in a builder worktree and runs untouched in a plain worktree (a Human session or a Worker `/take-plan` slot), where the guard behaves exactly as today.
- [auto] `node --test tools/test/orchestrator-decisions-count.test.mjs` passes, with tests that fail on today's code: a `status.json` holding 16 decisions (the shape in Step 0) gives a report whose `## Decisions` section lists 16 and a `triage:` line whose `ask:` equals the number of `ask` verdicts, not 0; a run with no decision still prints `- none`.
- [auto] `node --test tools/test/orchestrator-merge-only.test.mjs` passes, with tests that fail on today's code: `args { "mode": "merge", "run": "<run>", "plans": ["065"] }` on a run whose plan 065 is `parked` at the merge with a recorded checked head runs no builder, no gate and no checker, merges once, and the final gate runs; the same call for a plan with no recorded checked head, or whose branch head differs from it, is refused with the reason and merges nothing.
- [auto] `node --test "tools/test/*.test.mjs"` and `npm run build` pass; `node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .` reports no drift.
- [auto] `node scripts/scope-check.mjs --deps --tags --tests --arch --plan=plans/083-the-preflight-stops-a-plan-that-will-fail-before-any-builder-starts.plan.md` exits 0.
- [human] On the next orchestrator run in a project, a plan that prescribes a guarded log line stops at preflight with the rule and line named, and nobody has to open a log to find out why.

## Execution Mode
- Parallel: no.
- Concurrent plans: none. Plan 068 first (both edit `core/scripts/orch-preflight.mjs`). Plan 061 runs after this one and also edits `core/scripts/orch-state.mjs`, `core/.claude/workflows/orchestrate.js` and `tools/test/orchestrator-folders.test.mjs`; plan 074 runs last (shared: `orch-run.mjs`, `orchestrate.js`, `kit-runner.md` untouched here).
- Isolated DB: no.
- Kit edits: one kit branch and one kit PR; one commit per sub-task.

## Read-Write Scope

Always allowed: this plan file itself and `.claude/sessions/**`, plus the append-only hotspot `CHANGELOG.md` (add an entry, never rewrite one).

```scope
packs/angular/scripts/pre-commit-security-grep.mjs
core/scripts/orch-preflight.mjs
scripts/orch-preflight.mjs
core/scripts/orch-state.mjs
scripts/orch-state.mjs
core/scripts/lib/orch-run.mjs
scripts/lib/orch-run.mjs
core/scripts/lib/db-write.mjs
scripts/lib/db-write.mjs
core/scripts/lib/guard.mjs
scripts/lib/guard.mjs
core/scripts/lib/plan-guard-scan.mjs
scripts/lib/plan-guard-scan.mjs
core/.claude/workflows/orchestrate.js
.claude/workflows/orchestrate.js
core/.claude/commands/orchestrate.md
.claude/commands/orchestrate.md
core/.claude/agents/orch-builder.md
.claude/agents/orch-builder.md
core/docs/agent/orchestrator.md
docs/agent/orchestrator.md
kit.config.json
tools/lib/kit.mjs
tools/test/security-grep.test.mjs
tools/test/orchestrator-preflight-plan.test.mjs
tools/test/orchestrator-park-branch.test.mjs
tools/test/db-write-ask.test.mjs
tools/test/orchestrator-decisions-count.test.mjs
tools/test/orchestrator-merge-only.test.mjs
docs/brain/scorecard.md
docs/brain/follow-ups.md
CHANGELOG.md
```

## Read Scope

Entire repo, including `docs/orchestrator/runs/run-065/` (status.json and report.md are the shape reference) and the run folders of any project the Human names.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry. Tags and releases: wait for the Human's go.

## Architecture Impact
- INV-1: preserves — no `Touches` glob of INV-1 (`core/docs/agent/model-routing.md`, `core/.claude/agents/orch-readiness.md`) is in scope; no agent's `model:` key changes.
- Everything else: orchestrator scripts and workflow, one pack guard script, tests. No invariant is changed or deviated from.

## Step 0 — Reality Check

1. Re-read, on `origin/main`, every file:line named in the Problem Statement after plan 068 merged (it edits `orch-preflight.mjs`); drop a sub-task the code already covers.
2. Item 5 (decision count) has **no known cause**. Before writing any fix, reproduce it: read `.claude/orchestrator-runs/run-513-516c/status.json` in the FoodVibe project folder (read only) if the Human names its path; otherwise build a fixture from the shape of `docs/orchestrator/runs/run-065/status.json` with 16 decisions over two plans and two attempts. Run `orch-state.mjs finish` on it and name in Execution Notes which of these is the cause: decisions never written (`decisions --b64` rejected all-or-nothing, `orch-state.mjs` l.1195-1207), written to a different `status.json`, dropped by the attempt filter (`orch-state.mjs` l.1391), or lost by `formatReport`. If none reproduces: do NOT stop the run — drop C1 from this plan, append an entry to `docs/brain/follow-ups.md` (what was tried, the fixture used, the result), record a `- decision:` line in Execution Notes, and continue with every other sub-task (Human, 2026-11-05).
3. Item 6: read how a plan's state, `round` and checked head are stored in `status.json` today (`orch-state.mjs set`, `plans[N]`). If no checked head is recorded at the point where the gate and checkers pass, sub-task M1 records it first (in scope); say so in Execution Notes.
4. [ui] cards: read how a card names its role today (`core/scripts/lib/done-when.mjs` and the card text in a real plan). If a card carries no role at all, sub-task L1 reads the role from the phrase `as <role>` in the card and flags a card with no role as `no role named` — and says so in Execution Notes.

## Atomic Sub-tasks

- [x] G1: Write the failing guard tests first — variable carrying a PII value into a log call, the allow marker with its reason, no folder switch — packs/angular guard under test — tools/test/security-grep.test.mjs
- [x] G2: Make the guard a function `scanGuardText(text, file)` that returns `{ line, rule, ruleLine, text }` hits (the script's CLI part only calls it); catch a log call of a variable assigned from a PII-named expression earlier in the same file; accept `// security-grep-allow: <reason>` (reason of at least 10 characters) on the same line, for that line only; no folder or path exemption — packs/angular/scripts/pre-commit-security-grep.mjs
- [x] P1: Add the scan of the plan's own text: every fenced code block and inline code span that prescribes a statement is run through `scanGuardText` of each guard the project installed; preflight parks the plan before any builder with `guard <script> line <n>: <rule>` and the plan line — core/scripts/lib/plan-guard-scan.mjs, core/scripts/orch-preflight.mjs, tools/test/orchestrator-preflight-plan.test.mjs
- [x] L1: Add `ui.logins` to the project config (`{ "<role>": { "url": …, "userEnv": …, "passEnv": … } }`, names of environment variables only, never values); preflight flags a [ui] card whose role has no entry, and `uiChecks()` uses the role's recipe — kit.config.json, tools/lib/kit.mjs, core/scripts/orch-preflight.mjs, tools/test/orchestrator-preflight-plan.test.mjs
- [x] S1: Preflight lists leftovers of earlier runs, one line each: local or remote `feat/NNN-*` branches of the run's plans that are not on the run branch, `park/*` branches, slots with a `.worktree-plan` marker or a non-detached head — core/scripts/orch-preflight.mjs, tools/test/orchestrator-preflight-plan.test.mjs
- [x] S2: On park, commit the builder's uncommitted work as `WIP: park <run> <NNN>` on `park/<run>-<NNN>`, push it, release the slot; nothing to commit → no branch — core/scripts/orch-state.mjs, core/.claude/workflows/orchestrate.js, tools/test/orchestrator-park-branch.test.mjs
- [x] D1: Add `dbWriteKind(command)` and the guard rule: a database-writing command that the plan text does not list is answered `ESCALATE: db-write <command>` before it runs; the workflow records it as an `ask`. `guard.mjs` is the PreToolUse hook of every session, so the rule applies only when the folder is an orchestrator builder's worktree (read from the run's own marker or state, not from the session's start folder); a Human session and a Worker `/take-plan` slot behave exactly as today; the test covers both — core/scripts/lib/db-write.mjs, core/scripts/lib/guard.mjs, core/.claude/agents/orch-builder.md, core/.claude/workflows/orchestrate.js, tools/test/db-write-ask.test.mjs
- [x] C1: Reproduce the decision count fault from Step 0 item 2 as a failing test, then fix the cause where it is — core/scripts/lib/orch-run.mjs, core/scripts/orch-state.mjs, tools/test/orchestrator-decisions-count.test.mjs
- [x] M1: Record the checked head when a plan passes its gate and checkers (only if Step 0 item 3 finds none); add the `merge` mode to the workflow args and `/orchestrate` — it skips builder, gate and checkers for a plan with a recorded checked head equal to its branch head, merges, runs the final gate; any other plan is refused with the reason — core/.claude/workflows/orchestrate.js, core/.claude/commands/orchestrate.md, core/scripts/orch-state.mjs, tools/test/orchestrator-merge-only.test.mjs
- [x] R1: Document the new checks, the park branch, the allow marker, `ui.logins` and the merge mode where the orchestrator is described; resync installed copies; changelog entry; add this plan's row to the scorecard — core/docs/agent/orchestrator.md, docs/brain/scorecard.md, CHANGELOG.md

## Technical Considerations
- **Allow marker, not exemption.** The marker is a comment on the line it excuses, with a written reason; the reason is printed when the guard passes the line, so a reviewer sees every exception in the commit output. No glob, folder or environment variable turns the guard off (Done-when (c)).
- **Variable tracking is deliberately small:** within one file, `const|let|var <name> = <expression with a PII name>` or `<name> = …`, then a log call (`console.log`, `.log(`, `LoggingService`) on a later line that contains `<name>` as a word. No data-flow analysis; a miss is possible, a false block is fixed by the allow marker.
- **Plan-text scan (P1)** reads only code the plan *prescribes* (fenced blocks and inline spans), never prose, so a plan that says "never log the token" is not parked.
- **How this splits from plan 061.** 061 fixes the *rerun*: reusing a parked plan's `feat/NNN` branch (plan-file conflict, upstream tracking). This plan fixes the two ends around it: *before* a run (detect leftovers, S1) and *at the park* (commit the work on `park/<run>-<NNN>`, release the slot, S2). The `feat/NNN` branch is not touched by S2, so 061's reuse logic and this plan's park branch do not meet; 061 starts from `feat/NNN` as before and the Human or a later plan decides whether to bring `park/…` work back. No file region is shared except `worktree()`/`park`, which is why 061 runs after this plan.
- **Database write kinds (D1):** `migrate` — `prisma migrate|db push`, `drizzle-kit push|migrate`, `knex migrate`, `typeorm migration:run`, `npm|pnpm run (migrate|db:migrate|db:push)`; `seed` — `npm|pnpm run seed|db:seed`, `prisma db seed`, `node … seed*`; `raw-write` — `psql`/`mongosh`/`mongo`/`sqlite3` with `INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|insertOne|insertMany|updateMany|deleteMany|drop`. A command the plan text contains (as written) is "listed". Read-only database commands are never asked about.
- Backend / API: none. Auth and validation: the guard change is a security check; it only gets stricter in one case and adds one explicit, reasoned exception. Security surface: the allow marker is the only new way to pass the guard; it is per line and visible. Data / migration: none. Model changes: none. Project checks: none.

## Out of Scope
- Changing which guards a project installs, or adding a rule to the guard other than variable-carried logging.
- Moving `park/…` work back into a rerun (plan 061 owns the rerun).
- Anything in `tools/test/orchestrator.test.mjs` (a test it needs goes in the new files).
- Plans 069-073 and 076-082 (parked: reliability freeze, 2026-11-05).

## Critical Questions
- Q: A database write the plan does not list — park the plan, or ask and continue? A: the plan records an `ask` and stops that plan only; the run continues with the other plans (recommended; reversible — Human, 2026-11-05 brief: "becomes an ask before it runs").
- Q: Is the park branch name fixed? A: yes, `park/<run>-<NNN>` (Human brief, 2026-11-05).

## Execution Notes
- decision: D1's database-write ask is limited to an orchestrator builder's worktree, detected from the run's own marker or state; every other session (Human, Worker `/take-plan`) keeps today's guard — Human, 2026-11-05 ("`core/scripts/lib/guard.mjs` is the PreToolUse hook for every session"). Recorded before the build.
- Step 0 (2026-11-05, after 068 merged): every file:line of the Problem Statement re-read on origin/main; no sub-task was already covered. Item 3: `status.json` held no checked head (only `sha` at the gate step), so M1 adds `set --checked-head`, written just before the merge. Item 4: a [ui] card carries no role field (`done-when.mjs uiItems` returns the card text only), so L1 reads the role from the card text.
- Step 0 item 2 / C1 reproduced (partly): fixture of 16 decisions over two plans, all recorded by launch 1, `attempts: 2` (the run-065 shape; run-065 itself has 9 decisions, attempt 1, and reports them correctly). The real `finish` printed `triage.ask: []` and `ask: 0` while status.json held 16 — cause: the attempt filter in `publishReport` (`d.attempt === status.attempts`) dropped every earlier-launch decision from what the command prints. Not reproduced: the report file's own `## Decisions` section printing `- none` — `formatReport` always gets the full `status.decisions` and lists 16. The fix covers the reproduced cause only; the `- none` in a report file stays unexplained without the app project's own status.json.
- decision: `--plan-checks` is its own preflight mode, and the run's preflight returns `parkPlans` and `warnings` in its JSON instead of failing — a plan the guard scan names is parked with the reason, the run goes on with the others. Reason: the plan asks to park the plan, not to stop the run; reversible (drop the mode).
- decision: a plan that depends on a preflight-parked plan is skipped with `depends on parked <NNN>` before the waves start, like a plan behind a plan parked in a wave. Reason: building it would fail on the missing dependency; reversible.
- decision: a [ui] card's role is read from the phrases `role: <x>`, `as the <x> user` / `as a <x> role`, or `as <x>` when x is a role with a recipe; the warning `no role named` is printed only when the project has at least one `ui.logins` recipe. Reason: Step 0 item 4 found no role field; without recipes every card would warn and the warning would be noise.
- decision: `ui.logins` is read at run time from `.kit/config.json`, then `kit.config.json`, not rendered into the scripts. Reason: it is project data the scripts only read; nothing to re-sync when a role is added.
- decision: `park-save` snapshots the folder with a separate git index (`GIT_INDEX_FILE` in the git dir), commits with `commit-tree` and only then cleans the folder, and releases the slot itself instead of calling `releaseSlot` (`orch-folders.mjs` is outside the scope). Reason: the folder's own index and the plan branch stay untouched until the commit is on origin; a failed push keeps the folder as it was.
- decision: the security guard's allow marker excuses a PII log line only, and only inside a comment (`//`, `/*`, `<!--`), never in a string literal; an innerHTML hit has no exception. Reason: the independent review pointed out that Out of Scope forbids widening the guard beyond variable-carried logging (the first build had let the marker excuse innerHTML too).
- decision: `ui.logins` is a list of `{ role, url, userEnv, passEnv }`, not the map keyed by role the L1 text shows. Reason: the kit's config check (`tools/lib/kit.mjs orchestratorProblems`) validates one value per dotted key, and a list lets it refuse a duplicate role, an extra key (a password) and a value in place of a variable name item by item; the role is still the lookup key. Reversible.
- decision: the plan-text guard scan skips the sections that only describe a plan (Problem Statement, Goals, Out of Scope, Critical Questions, Execution Notes, Step 0, Architecture Impact, Escalation Protocol, the scope sections); the db-write listing still reads every section. Reason: the independent review found that a plan quoting the bad line as the fault it fixes (this plan does, at its Done-when) would be parked in a project with the angular guard — against "a plan that says never log the token is not parked".
- decision: D1's builder marker lives in the worktree's git dir (`orch-builder.json`, never among its files) and counts only while the branch it names is checked out; `release` and `park-save` remove it. Reason: a slot given back and reused by a Worker must be judged as before, even if a removal is missed.
- decision: D1 "listed" = a line of the code the plan prescribes (fenced block line or inline code span) equal to the command, read from the run branch's commit sha in the marker — not a substring of the plan text and not the builder's copy. Reason: the commit security review showed a substring match lists `npm run seed` from prose like "never run npm run seed", and a builder could list a command by editing its own plan copy; stricter than "contains as written", reversible.
- decision: D1 also counts a database client fed a script it does not show (`psql -f file`, `sqlite3 db < file`) as a raw write, checks the whole line when a client write is split across quoted `;` segments, and refuses (fails closed) when the check throws in a worktree that has a builder marker. Reason: two automated security review passes on the D1 commits; each closes a way past the ask.
- decision: the db-write ask parks the plan with `ask: ESCALATE: db-write …` and records a decision whose verdict is forced to `ask` (`forced: db-write`) whatever the triage says; no fix round. Reason: Critical Questions answer (an ask that stops that plan only).
- decision: C1's fix keeps an earlier launch's decision in the command's view until a grade row of this run names its id (`decisionsInView`), and `finish` returns those records as `earlierDecisions`, which the workflow appends to its `decisions`. Reason: a decision graded when its launch ended stays hidden as before; one never graded is no longer lost.
- decision: merge mode refuses a plan without a checked head or whose branch on origin moved, records the refusal as a run note and leaves the plan's state as it was (outcome parked, nothing merged); the run's preflight plan scan does not park a plan in merge mode. Reason: the code already passed its checks; reversible.
- decision: the checked head is the full 40-character sha the state script's `diff` read for the checkers (recorded only when it is the commit the gate ran on), never the builder's reported sha; `merge-ready` compares it exactly, and every merge with a checked head — merge mode and a normal run — is pinned to that commit (`PLAN_HEAD`; a branch that moved is refused). Reason: third automated security review pass (a short builder-reported sha and an unpinned merge left a gap between the check and the merge).
- decision: `.kit/install.json` is not committed on this branch (outside the scope); the installed copies were rendered with sync and drift-check passes. Reason: scope rule; the manifest refresh lands with plan 061, whose scope holds it.
- decision: an inline code span counts as prescribed only when it is a statement (holds `(` or `=`) and no prohibition (never, not, no, avoid, without, instead of, must not, stop) ends within the two words before it; a fenced block always counts. A miss is no hole: the commit guard still blocks the line at the builder's commit. Reason: the bugs checker showed "never bind `[innerHTML]` to user text" parked a correct plan.
- decision: a command whose word (after variable assignments and launchers: npx, sudo, doas, env, yarn, bunx, nohup, nice, time, exec, command, stdbuf, timeout, xargs, npm exec, pnpm exec/dlx) is a known read-only or package tool (git, rg, grep, echo, cat, an install …) is judged by the db-write patterns anchored at that word only, so a word in its commit message, search or package name is never a write; any other command (an unknown wrapper, `bash -c "…"`, `eval`) is judged by the same patterns anywhere in it (fail closed). Reason: the bugs checker showed `git commit -m "feat: add sqlite3 create-table helper"` asked as a write; the security review then showed pure anchoring let `bash -c "npm run seed"` and `yarn prisma migrate dev` through.
- decision: a "safe tool" (whose commit message or search may name a database command without being asked about) is safe only as its own command — plain git subcommands (status, log, diff, show, add, commit, branch, switch, fetch, push, rev-parse, ls-files, grep, restore, stash), rg, grep, echo, cat, an install — with no `$( )`, backticks or process substitution in it and every option on a short known list (`-m`, `-a`, `-n`, `--stat` …), read outside quoted text. Reason: five automated security-review rounds each found one more option that can run a program (`rebase -x`, `--upload-pack`, `-O`, `--pre`); an option allowlist ends that list instead of growing a block list. The ask catches a builder's unplanned database write; it is not a sandbox against a hostile builder.
- decision: the security guard compares real paths to tell it runs as the script (as `pre-commit-secret-scan.mjs` does). Reason: the bugs checker showed it scanned nothing and exited 0 when run through a junction.
- follow-up: C1 remainder — a run report file printing `## Decisions` / `- none` while status.json holds decisions is not reproduced (formatReport always lists `status.decisions`); needs the app project's run-513-516c status.json and report.md to trace.
- follow-up: the merge pin is an instruction to the merge agent (`git rev-parse MERGE_HEAD must print PLAN_HEAD`); a script check after the merge (the merge commit's second parent equals `checkedHead`, e.g. in `orch-state.mjs clean`) would enforce it.
- follow-up: `db-write.mjs` seed pattern still matches a script whose name starts with `seed` but only checks (`node scripts/seed-check.mjs`) — over-cautious, never unsafe.
- follow-up: the guard speed test (`tools/test/guards.test.mjs`, 2000 ms limit) fails under full-suite load on Windows (2202 ms, 4033 ms); alone the guard runs ~115 ms.
- review: independent opus review PASS (6 findings: plan-scan sections, allow marker in a string, arrow-function carrier, `node --test` seed match fixed; pin enforcement and the C1 remainder are follow-ups).
- review: commit security review (automated plugin) ran on every commit: 4 + 2 + 4 + 2 + 2 + 4 + 2 + 1 + 2 findings, all fixed on the branch (see the D1, checked-head and safe-tool decisions above).
- review: checkers kept 3 dropped 0 rechecked 0 minutes ~25 models check-plan sonnet, check-bugs sonnet, check-rules sonnet — plan PASS, rules PASS, bugs 3 (guard fail-open via a junction, a prohibition span parked a plan, db-write words in a commit message) all fixed in `3f08c2e`; no orch-verify call (every finding accepted and fixed, none disputed).
- test: full `node --test "tools/test/*.test.mjs"` 494/498 on a loaded Windows machine; the 4 (guard speed 2000 ms limit, three slot-serve port tests) pass alone (folders 28/28) and none touches this diff.
