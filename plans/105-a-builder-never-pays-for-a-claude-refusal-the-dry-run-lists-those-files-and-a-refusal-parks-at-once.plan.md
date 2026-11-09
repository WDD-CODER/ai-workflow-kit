# Plan 105 — A builder never pays for a .claude/ refusal: the dry run lists those files and a refusal parks at once

Status: draft
Parked: 2026-11-09 — the Human froze new work until the workflow runs clean on FoodVibe; reopen only when a validation case, a CI check or a real run fails on what this plan fixes.
Depends-on: 103, 104
Snapshot: e53dd0a
Source: run-100 (2026-11-08/09), error review rows "builders refused every edit under `.claude/`". The Human chose on 2026-11-09: keep the kit's sources under `core/.claude/`, let the Planner write those files by hand, and stop paying for the refusal. Reliability fix; no new capability.

## Problem Statement
1. **An unattended builder cannot write any file under a `.claude/` folder.** Claude Code's sensitive-file protection refuses `claude -p` edits to `.claude/…` and `core/.claude/…` ("Claude requested permissions to edit … which is a sensitive file"), with `Edit`, `Write` and a Bash `cp` alike. A test on 2026-11-08 found that no allow rule (command line or settings file) and no `acceptEdits` lifts it; only bypass mode does, and the Human ruled bypass out.
2. **The run pays for the refusal twice.** Plan 100's build-tier builder was refused, then the run escalated to a judgment-tier builder that was refused the same way: about 9.5M input tokens, then a park. Plan 101 parked twice the same way.
3. **Nobody is told before the run.** The dry run says `WOULD START: yes` for a plan whose scope holds `.claude/` files, so the Planner learns only from a park that it must write them by hand.

## Goals & Success Criteria
**Primary:** a plan with `.claude/` files is known before the run; its builder builds everything else, and a refusal costs one builder call, never an escalation.

- [auto] `node --test tools/test/run-plans-claude-paths.test.mjs` passes, with tests (fake claude) that fail on today's code:
  (a) the dry run prints, for a plan whose `## Read-Write Scope` or Atomic Sub-task targets name a path with a `.claude/` segment, one line `HAND <NNN>: <paths> — a builder cannot edit .claude/ files; the Planner writes them on feat/<NNN> before the run` (paths with an installed copy name the source under `core/` only), and still `WOULD START: yes`;
  (b) that plan's builder prompt lists those files under `PLANNER WRITES:` with the rule "do not edit them; build the rest; name them in notDone";
  (c) a builder result whose `blocker` or a `notDone` entry quotes the refusal (`sensitive file`, or `requested permissions to edit` with a `.claude/` path) parks the plan at once with `needs the Planner: .claude/ files <paths>`. No fix round and no judgment-tier builder follow, and the work is saved on `park/<run>-<NNN>` as any park saves it;
  (d) a plan with no `.claude/` path gets no `HAND` line, and its prompt has no `PLANNER WRITES:` block.
- [auto] `docs/agent/orchestrator.md` describes the hand-off: the Planner writes the `.claude/` files on `feat/<NNN>` (source and installed copy, then the kit sync), and the next launch resumes the plan from its saved work.
- [auto] `npm run build`, `npm run lint`, `npm test`, `node --test tools/test/size-budget.test.mjs` and `node tools/drift-check.mjs --target .` pass (the builder runs the kit sync with apply first; it is a step, not a check).
- [human] On the kit, a dry run of a plan whose scope names `core/.claude/commands/orchestrate.md` prints its `HAND` line, and a run of it parks with `needs the Planner` after one builder call (reply `ok`).

## Execution Mode
- Parallel: no.
- Concurrent plans: none.
- Isolated DB: no.
- Run: solo flow or `/orchestrate 105` after the run-100 PR is merged into `main`. The run branch merges into `main` only by a PR the Human approves.
- Fallback: when the dry run says `WOULD START: no`, append one line with the date and the reason to `docs/brain/error-review.md` first, then build this plan by the solo flow (`feat/105-<slug>`, then `/ship`).

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspots `CHANGELOG.md` and `docs/brain/error-review.md`.

```scope
core/scripts/run-plans.mjs
scripts/run-plans.mjs
core/docs/agent/orchestrator.md
docs/agent/orchestrator.md
tools/test/run-plans-claude-paths.test.mjs
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
- INV-1: preserves — no role's model tier changes; a refusal parks instead of starting the judgment tier, so fewer model calls are made, never a different model.

## Step 0 — Reality Check
1. `run-plans.mjs` `lintPlan` and the dry run's per-plan lines: where a `HAND` line is printed beside `test files`, and where plan 101's `plannedTestPaths` reads the sub-task targets (reuse its parse).
2. `builderPrompt`: where a `PLANNER WRITES:` block goes, beside `HANDOFF:` / `FINDINGS:` / `ANSWER:`.
3. The builder-result handling after `parseResult` (plan 104's asks): the refusal check runs before the escalation and before an ask is written; it parks, it does not ask.
4. The installed-copy map (`tools/sync.mjs`, `.kit/install.json`): how a `.claude/x` path is matched to its `core/.claude/x` source for the `HAND` line.
5. The orch-builder agent file is itself under `.claude/`: this plan does not edit it (the prompt carries the rule).

## Atomic Sub-tasks
- [ ] S1: Write the failing tests first for the dry-run line, the prompt block, the refusal park and a plan with no such files — cases (a)–(d) — tools/test/run-plans-claude-paths.test.mjs
- [ ] S2: List a plan's .claude/ files in the dry run so the Planner knows before the run — HAND line — core/scripts/run-plans.mjs
- [ ] S3: Tell the builder which files the Planner writes, so it builds the rest — PLANNER WRITES block — core/scripts/run-plans.mjs
- [ ] S4: Park at once on a .claude/ refusal instead of paying a stronger builder — refusal check before escalation and asks — core/scripts/run-plans.mjs
- [ ] S5: Describe the Planner's hand-off for .claude/ files, resync, run every check, add the changelog entry — core/docs/agent/orchestrator.md, CHANGELOG.md

## Technical Considerations
- The refusal text is Claude Code's; match it loosely (`sensitive file`, or `requested permissions to edit` together with a `.claude/` path) and keep the match in one function with a test, so a new wording is one line to change.
- The `HAND` line is advice, not a refusal: the Planner may write the files before the run or after the park; both resume through plan 102's rule.

## Out of Scope
Moving the kit's sources out of `core/.claude/` (the Human chose to keep them); bypass mode or a deny-list workaround (ruled out); writing the `.claude/` files by any agent.

## Critical Questions
None open. (The Human chose on 2026-11-09: keep sources under `core/.claude/`, the Planner writes them by hand, no bypass mode.)

## Execution Notes
