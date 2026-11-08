# Plan 084 — Cleanup after the reliability run: steady Windows tests, lesson paths to six folders, the probe in the gate's folder and a committed install manifest

Status: done
Depends-on: none
Snapshot: a513c5e40fe29742e8ee5d7cae573c7ba2d29095
Source: the follow-ups of the 2026-11-05 run (plans 075, 068, 083, 061, 074; their Execution Notes), sorted with the Human the same day: fix these now, keep the C1 remainder waiting for a reproduction, the merge pin is plan 085.

## Problem Statement
Seven small leftovers from the run, each a few lines:

1. **Lesson paths cut at four folders (074).** `SAFE_PATH` in `core/scripts/lib/orch-run.mjs` keeps a path of at most four segments, so most app paths (`src/app/pages/x/x.component.ts`) drop out of the lesson line. The Human chose six (2026-11-05).
2. **The probe looks in the wrong folder (068).** After a gate `env-fail`, `orch-preflight.mjs --probe` checks the command's file or script in the main root folder (`probeOf(cmd, root)`, line 170), not the folder where the gate ran. A check file that only the plan's branch adds fails the probe, and the plan parks at once instead of getting its one retry.
3. **The seed pattern matches a check script (083).** `core/scripts/lib/db-write.mjs:46` treats `node scripts/seed-check.mjs` as a database seed write, so a builder that runs a read-only check gets asked first. This is over-cautious, never unsafe.
4. **Slot-serve port tests flake under load on Windows.** Three `slot-serve --main` tests in `tools/test/orchestrator-folders.test.mjs` (lines 670, 710, 726) fail in the full suite when another process takes their port, and pass alone. Every plan of the run needed a rerun.
5. **The guard speed test flakes under load.** `tools/test/guards.test.mjs` has a 2000 ms limit (line 26); under the full suite on Windows it measured 2202 and 4033 ms, while alone the guard takes about 115 ms.
6. **`.kit/install.json` goes stale on main.** Sync rewrites it on every plan branch, and `scope-check` already allows it in every plan (`GENERATED`, `core/scripts/scope-check.mjs:78`). But nothing in the solo flow says to commit it, so plans 068, 083 and 074 left it uncommitted.
7. **Two small text and argument leftovers (074).** `core/docs/agent/orchestrator.md:326` still names the test-file gate's old rule text (`test file outside the plan's scope`). `tools/install-check.mjs` reads `--target <dir>` but ignores `--target=<dir>` and silently runs the fixtures instead.

## Goals & Success Criteria
**Primary:** each leftover is fixed, with a test where the behaviour is code.

- [auto] `node --test tools/test/orchestrator.test.mjs` passes, with a test that a six-segment path is kept in a lesson line and a seven-segment one is left out.
- [auto] (F02) `node --test tools/test/orchestrator-env-retry.test.mjs` passes, with a test that a probe of `node tools/x.mjs` passes when the file exists only in the folder the gate ran in, and fails when it exists in neither.
- [auto] `node --test tools/test/db-write-ask.test.mjs` passes, with a test that `node scripts/seed-check.mjs` and `node scripts/seed-checker.mjs --dry` are not a write, while `node scripts/seed.mjs`, `node scripts/seed-users.mjs` and `npm run seed` still are.
- [auto] `node --test tools/test/orchestrator-folders.test.mjs` passes three times in a row inside the full suite on Windows: `node --test "tools/test/*.test.mjs"` → 0 failures, three runs, with the slot-serve tests each taking a port nothing else holds.
- [auto] `node --test tools/test/guards.test.mjs` passes inside the full suite on Windows on three runs, and the speed check still fails a guard that is really slow (a test with a stubbed 5 s guard fails it).
- [auto] `/ship` Phase 3 (`core/.claude/commands/ship.md`) says to stage `.kit/install.json` when sync rewrote it, and this plan's own branch commits the refreshed file: `git diff origin/main -- .kit/install.json` is part of this plan's diff, and `node tools/sync.mjs --target .` afterwards reports nothing to write.
- [auto] `docs/agent/orchestrator.md` names the test-file gate's rule as "no scope line names a test location" (`grep -c "test file outside the plan's scope" docs/agent/orchestrator.md` → 0), and `node tools/install-check.mjs --target=<dir>` acts like `--target <dir>` (a test in `tools/test/agent-rules-sections.test.mjs`).
- [auto] `npm run build`, `npm run lint`, `npm test`, `node tools/orchestrator-e2e.mjs` and `node --test "tools/test/*.test.mjs"` pass; `node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .` reports no drift.
- [human] Next full test run on your PC: no slot-serve or guard-speed failure, and the orchestrator report's lesson lines carry file paths again.

## Execution Mode
- Parallel: no.
- Concurrent plans: none. Plan 085 also edits `orchestrate.js` and `orch-state.mjs`; this plan goes first.
- Isolated DB: no.
- Kit edits: one kit branch and one PR; one commit per sub-task row.

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspot `CHANGELOG.md` (add an entry, never rewrite one).

```scope
core/scripts/lib/orch-run.mjs
scripts/lib/orch-run.mjs
core/scripts/orch-preflight.mjs
scripts/orch-preflight.mjs
core/.claude/workflows/orchestrate.js
.claude/workflows/orchestrate.js
core/scripts/lib/db-write.mjs
scripts/lib/db-write.mjs
core/docs/agent/orchestrator.md
docs/agent/orchestrator.md
core/.claude/commands/ship.md
.claude/commands/ship.md
tools/install-check.mjs
tools/test/orchestrator.test.mjs
tools/test/orchestrator-env-retry.test.mjs
tools/test/orchestrator-folders.test.mjs
tools/test/guards.test.mjs
tools/test/db-write-ask.test.mjs
tools/test/agent-rules-sections.test.mjs
tools/test/lib/**
docs/brain/scorecard.md
CHANGELOG.md
```

## Read Scope

Entire repo.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry. Tags and releases: wait for the Human's go.

## Architecture Impact
- INV-1: preserves — no model key, role or tier changes.
- Everything else: fixes in kit scripts and tests, one doc line and one flow sentence.

## Step 0 — Reality Check
Checked on `origin/main` `a513c5e` (2026-11-05): every line named above exists as described. Before each sub-task re-read the named line on `origin/main` and drop a sub-task the code already covers. For A2, find how the workflow calls the env check after a gate `env-fail` and which folder the gate ran in (the plan's worktree or slot); pass that folder, never a path a model wrote.

## Atomic Sub-tasks

- [x] A1: Keep lesson paths up to six folders deep so most app paths stay in the lesson line — SAFE_PATH segment limit 4 → 6 — core/scripts/lib/orch-run.mjs, tools/test/orchestrator.test.mjs
- [x] A2: Check a failed command's file or script in the folder where the gate ran, so a branch-only file gets its retry — a --probe-dir the workflow fills with the gate's folder; root stays the default — core/scripts/orch-preflight.mjs, core/.claude/workflows/orchestrate.js, tools/test/orchestrator-env-retry.test.mjs
- [x] A3: Stop asking before a read-only check script whose name starts with seed — seed-check / seed-checker are not a write; seed.mjs, seed-users.mjs, npm run seed still are — core/scripts/lib/db-write.mjs, tools/test/db-write-ask.test.mjs
- [x] A4: Give each slot-serve test a port nothing else holds, so the full suite stops flaking on Windows — ask the OS for a free port per test — tools/test/orchestrator-folders.test.mjs, tools/test/lib/**
- [x] A5: Time the guard alone so the speed test measures the guard, not the machine's load — best of three timed runs, limit unchanged — tools/test/guards.test.mjs
- [x] A6: Commit the refreshed install manifest with each plan so main never goes stale — one sentence in /ship Phase 3, and this branch commits it — core/.claude/commands/ship.md, .kit/install.json
- [x] A7: Fix the old rule wording in the orchestrator doc and let install-check read --target=<dir> too — core/docs/agent/orchestrator.md, tools/install-check.mjs, tools/test/agent-rules-sections.test.mjs
- [x] T1: Resync installed copies, run every check, add a changelog entry and this plan's scorecard row — CHANGELOG.md, docs/brain/scorecard.md

## Technical Considerations
- A2 keeps the probe read-only: it still reads only `package.json` and file existence, now in the given folder; an absolute or `..` path stays "no precondition".
- A5 must not hide a slow guard: the test with a stubbed slow guard proves the check still fails.
- Backend / API: none. Auth and validation: none. Security surface: A3 narrows a builder ask (only names that are check scripts by pattern `seed-check*`); a real seed write is still asked. Data / migration: none. Model changes: none.

## Out of Scope
- The C1 remainder (a report printing `- none` while status.json holds decisions): waits for a reproduction.
- The merge pin enforced by script: plan 085.
- 061's notes deduplication and the hooks on the resolving commit: kept as they are.

## Critical Questions
- None open. Lesson paths: six segments (Human, 2026-11-05).

## Execution Notes
- 2026-11-05 A1 (`bcb05b4`): the first sync on this branch reported a conflict on `scripts/lib/orch-run.mjs` because `.kit/install.json` on main was stale (the A6 problem). The manifest was refreshed before the A1 change was synced; that refresh is part of this branch's diff.
- A2 (`52353a1`): the gate's env-fail result carries `probeDir: ctx.wt.path` (the folder the code gave the gate; the main folder for `[auto:main]` checks). `orch-preflight.mjs --probe-dir` accepts only an absolute folder that exists, else the root folder.
- A3 (`33921ca`, review `b58b8ac`): the security review flagged that `seed(?!-check)` also let `seed-checkout.mjs` through. Now only exactly `seed-check` / `seed-checker` (with an optional .js/.mjs/.cjs/.ts) is read-only; `seed-checkout.mjs`, `seed-checks-off.mjs` and `seed-check.mjs.bak` stay a seed write (tested).
- A4 (`689138e`): reproduced in a full run: `SLOT_SERVE: fe server port 54067 was taken by PID 19848, not by this start`. Port 0 hands out the dynamic range (49152–65535) that every other connection uses. `tools/test/lib/free-port.mjs` picks a random port in 20000–31999 that can be bound and does not answer, never twice in one process. `ui-tier.test.mjs` also uses port 0 and is outside this plan's scope; it was left as is.
- A5 (`56d54e7`): the test already took the fastest of three runs (Step 0), and still flaked (2488 ms in today's full run). Each sample is now the guard run minus a `bash -c "node -e 0"` start-up timed right before it. The limit is unchanged; a stubbed 5 s guard still fails the check (new test).
- A6 (`5fa5c4f`), A7 (`118113a`): as written.
- T1: three full-suite runs in a row, 519/519 each. Build, lint and `npm test` pass; drift-check ok. The plan checker found that the six-segment test path had only five segments; the test now keeps `src/app/pages/x/y/x.component.ts` (exactly six). The slow-guard stub is 8 s, so a slow start-up sample cannot bring it under the limit.
