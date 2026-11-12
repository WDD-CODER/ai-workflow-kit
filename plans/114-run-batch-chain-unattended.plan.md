# Plan 114 — A chain of orchestrator batches runs one after another by itself, also after the session ends

Status: draft
Parked: 2026-11-12 — the Human: save it with its context now, build it later (freeze: new work)
Depends-on: none
Snapshot: ef9d67c
Source: FoodVibe Planner hand-off 2026-11-12, items 5 and 7a, and that session's answers (transcripts 0cf30f88, b3c34f2d, 57408b87 under `C:\Users\danwe\.claude\projects\C--coding-projects-Cursor-foodVibe1-0\`). The Human, 2026-11-12: "5, add the plan … add the context so we understand what it's about"; "7a — fold it to 5".

## Problem Statement

**What the Human asked for (FoodVibe, 2026-11-11 20:57Z, their words, shortened).** Five batches, run names fixed, each batch's run branch made from the previous one:

| Run | Plans |
| --- | --- |
| run-546 (batch 1) | 546, 558, 567, 575, 579 |
| batch-2 | 580, 581, 547, 568 (542 dropped) |
| batch-3 | 553, 554, 551, 552 |
| batch-4 | 556, 555 |
| batch-5 | 557, 559 |

Dependency lanes: 546→547→551 · 567→568 · 579→581 · 580→582 · 553→555→557 · 554→556→559 · 552, 558, 575 alone; 555 waits for 558; 554 depends on 580.

For each batch k = 2..5, in order, the agent was to:
1. Wait until the previous run is no longer RUNNING, then read its status.json. A parked or skipped dependency of batch k stops the chain, with the reason shown to the Human.
2. Run `node scripts/run-supervisor.mjs --free-mem`. Under 4 GB, say so and wait. Never kill processes to free memory.
3. Make `orch/batch-k` from the previous branch: `git fetch origin`, then `git push origin origin/<previous>:refs/heads/orch/batch-k`.
4. Dry run. `WOULD START: no` stops the chain, and the reason goes to the Human. Never edit around a refusal.
5. Start it with `run-supervisor.mjs --run batch-k --plans <list>` and print every ASK card as soon as it appears. The agent never answers an ASK itself.
6. When it ends, follow `/orchestrate` section 4.
7. Serve the batch in an idle slot (wt-1..3, in rotation) with `slot-serve.mjs --ref orch/batch-k`, then print its cards.
8. Go straight on to k+1 without waiting for the Human's validation.

The Human merges into main, in order. The agent never merges into main. A fix for a failed card lands on that batch's branch and is merged forward into every later batch branch. Merging origin/main into each new batch branch came from an earlier session's memory note, not from the Human's text.

**What happened.**
- Batch 1 started at 20:11Z. The Planner session watched it with a background shell wait. At 22:45Z Claude Code killed that wait: "stopped because the system is running low on memory". The agent asked the Human to restart the watch, and the Human was away.
- Batch 1 finished at 23:02Z. Nothing was waiting for it, so batch 2 started only when a new session started it by hand at 05:51Z the next day, **6 h 49 min idle**.
- Every chain step was done by hand, with different commands each time:
  - plumbing (`merge-tree --write-tree` + `commit-tree` + push) because another live session held the checkout;
  - a scratch worktree;
  - a `--detach` worktree.
- The detached merge wrote `Merge remote-tracking branch 'origin/main' into HEAD` (806e3e2a). With `--no-edit` on a detached HEAD, git names it "HEAD" (hand-off item 7a).
- Batch 2's dry run pulled 546, 567 and 579 back into wave 1, although they were merged on the base. Three empty marker commits were the workaround. That part is a separate fix: item 3 of the hand-off, `lib/plan-deps.mjs` `mergeSubjectRe(branch)`. This plan needs it first (see Prerequisites).

**The gap.** The supervisor already runs detached and outlives the session (`core/scripts/run-supervisor.mjs:7`, `detachedOptions`). What has no owner is the step *between* runs: making the next branch, merging main, the dry run, the start, and the stop rules. Today that lives only in a session's background wait, which Claude Code may kill and which ends with the session.

## Goals & Success Criteria

**Primary:** the Human writes the chain once, as a file. The kit then starts each batch when the previous one ends, without any session alive. It stops at the first rule that says stop and writes why. Nothing merges into main.

- [auto] `node --test tools/test/run-chain.test.mjs` passes (fake runs and a scratch repo with an origin):
  - A 3-batch chain file runs batch 2 only after batch 1's status is no longer RUNNING.
  - `orch/batch-k` is made from the previous run branch on origin and pushed.
  - origin/main is merged into it with the message `Merge origin/main into orch/batch-k`, never "into HEAD".
  - Then the dry run, then the start.
- [auto] Same test: each stop rule stops the chain and writes `STOPPED: <reason>` to the chain status file, with no later branch made:
  - a parked or skipped dependency;
  - `WOULD START: no`, with the dry run's reason quoted;
  - a merge conflict on the main merge;
  - an open ASK that is still unanswered when the run ends.
- [auto] Same test: free memory under the chain's limit (default 4 GB) makes the chain wait and re-check, never kill a process. The status says `WAITING: free memory <n> GB < 4 GB`.
- [auto] Same test: the chain process is detached. The test starts it, its parent exits, and the next batch still starts. A second `--chain` on the same file while one is alive is refused.
- [auto] `node scripts/orch-state.mjs watch --chain <file>` prints one line, `RUNNING batch-k` / `WAITING …` / `FINISHED` / `STOPPED: <reason>`, plus any open ASK card of the current batch.
- [auto] `npm test`, `npm run build`, `npm run lint` and `node tools/drift-check.mjs --target .` pass after `node tools/sync.mjs --target . --apply`.
- [human] In FoodVibe, a 2-batch chain is started and the session is closed. Batch 2 starts by itself when batch 1 ends, and the chain's status file says `FINISHED` (or a clear `STOPPED:` reason) the next morning.

## Execution Mode
- Parallel: no.
- Concurrent plans: none.
- Isolated DB: no.
- Run: **solo flow** (`git switch -c feat/114-<slug>` from `origin/main`, then `/ship`). Not `/orchestrate`: it changes the run scripts.
- After the merge: a minor release, which each project gets through `kit-sync`.

## Prerequisites
- The fix for hand-off item 3 is merged on origin/main: a run branch made from another run branch counts the plans merged in its history (`Merge … into orch/<any> (plan NNN)`). Without it every chained batch would rebuild the previous batch's dependencies.

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspots `CHANGELOG.md` and `docs/brain/error-review.md`.

```scope
core/scripts/run-supervisor.mjs
core/scripts/run-chain.mjs
core/scripts/lib/run-chain.mjs
core/scripts/orch-state.mjs
core/scripts/lib/orch-run.mjs
core/.claude/commands/orchestrate.md
core/docs/agent/orchestrator.md
core/docs/agent/workflow-map.md
tools/test/run-chain.test.mjs
tools/test/run-supervisor.test.mjs
scripts/**
.claude/commands/**
docs/agent/**
kit.json
CHANGELOG.md
```

## Read Scope
Entire repo, plus the FoodVibe run files named in Source (read only).

## Escalation Protocol
Thinking outside the box is expected; writing outside it requires explicit consent. If a step needs a file outside the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append the path to the scope block and retry.

## Architecture Impact
- INV-1: preserves — no model, tier or agent change; `run-plans.mjs` is not edited (the chain calls it as it is, dry run then supervised start).

## Step 0 — Reality Check
1. Re-read `run-supervisor.mjs` start/end and `detachedOptions` (Windows: own hidden console). Decide whether the chain is a loop inside the supervisor or its own detached process that starts one supervisor per batch. Record the choice and why under Execution Notes.
2. Confirm that `run-plans.mjs` uses `origin/orch/<run>` as the base when that branch exists, as the FoodVibe session read it.
3. Confirm the item 3 fix is on origin/main (Prerequisites).

## Atomic Sub-tasks
- [ ] C1: Write the failing tests for a chain that starts each batch after the previous one and stops on the first rule — tools/test/run-chain.test.mjs
- [ ] C2: Read a chain file and keep a chain status file that a person or a session can read at any time — format `{ chain, batches: [{ run, plans }], memLimitGb? }`; status under `.claude/orchestrator-runs/<chain>.chain.json` — core/scripts/lib/run-chain.mjs
- [ ] C3: Make the next batch's branch from the previous one and merge main into it with a named message — the push `origin/<prev>:refs/heads/orch/<run>`, the merge in the kit's own merge folder with `-m "Merge origin/main into <branch>"` (item 7a), a conflict stops the chain — core/scripts/lib/run-chain.mjs
- [ ] C4: Run the dry run, then start the batch under the supervisor, and stop the chain on every refusal — `WOULD START: no`, a parked or skipped dependency, an unanswered ASK at run end, free memory below the limit waits — core/scripts/run-chain.mjs, core/scripts/run-supervisor.mjs
- [ ] C5: Let a session or the Human read the chain's state in one line — `orch-state.mjs watch --chain <file>` — core/scripts/orch-state.mjs, core/scripts/lib/orch-run.mjs
- [ ] C6: Document how to start, watch and stop a chain — core/.claude/commands/orchestrate.md, core/docs/agent/orchestrator.md, core/docs/agent/workflow-map.md
- [ ] C7: Resync the installed copy, run every check, and release it — scripts/**, .claude/**, docs/**, kit.json, CHANGELOG.md

## Technical Considerations
- The chain never merges into main and never answers an ASK. Those stay with the Human, as in their own rules.
- Serving each batch in a slot and printing its cards (step 7) needs a session to show the cards. The chain writes `serve: orch/batch-k` into its status, and the next session serves it. It does not start dev servers headless.
- Merging a card fix forward into later batch branches is a Human-triggered step. It is not part of this plan.
- Windows: a detached process has no console, so every child opens a window (`run-supervisor.mjs:103`). Reuse `detachedOptions`.

## Out of Scope
- Merging into main, answering ASKs, card fixes merged forward, serving slots headless.
- The item 3 fix itself (a separate `fix/` branch).

## Critical Questions
1. Should an ASK that is still open when a batch ends stop the chain, or let the next batch start when the open plan is not one of its dependencies? The plan assumes **stop**, the safer choice.

## Execution Notes
- 2026-11-12 Planner: saved parked, from the FoodVibe hand-off and that session's answers; item 7a ("into HEAD") folded in as C3.
