# Plan 086 — Four cheap fixes: blind the checkers, escalate from a clean base, guards at write time, idempotent park

Status: draft
Depends-on: none
Snapshot: fd212e119ef16c0b26ebfaf6b44f450fee26d8f5
Source: kit audit 2026-11-06 (NotebookLM review verified against the code), plan A.

## Problem Statement
Four measured failures each have a one-day fix:
1. The checkers read the builder's own `## Execution Notes` (`core/.claude/workflows/orchestrate.js:797` passes the plan file the builder wrote into; `core/.claude/agents/orch-check-plan.md:27` tells the finder to read those notes) — a known source of confirmation bias (Hamel Husain: context rot; Eugene Yan: self-enhancement bias). The kit's eval tool already has `--redact` for this and it was never adopted.
2. The escalated judgment-tier builder patches on top of the failed diff (`core/.claude/agents/orch-builder.md:62-65`; the hand-off in `orchestrate.js:1216-1235` never resets the worktree). Applied LLMs: recovery inside a failed trajectory is poor; 66–80 % of reopened bugs are bad fixes (ICSE 2010, cited in plan 046).
3. A forbidden line the builder writes (a log naming PII) is caught only at the commit, after the whole build (12.5 minutes lost three runs in a row). Plan 083 scans the plan's prescribed code before the build; it cannot see what the builder invents. Chip Huyen: a static guard belongs inline, synchronous, before downstream work.
4. A stop or a park leaves a live `.claude/.session-lock`, a local `park/<run>-<NNN>` branch and a worktree with running servers behind; the next run collides with them (`core/scripts/orch-state.mjs:1088-1130` park-save; `core/scripts/session-lock.sh`).

## Goals & Success Criteria
**Primary:** each of the four failures is closed by code and proven by a test that fails on today's code.

- [auto] `node --test tools/test/plan-info-no-notes.test.mjs` passes: `node scripts/orch-state.mjs plan-info --run r --plan 123 --no-notes` writes `<run folder>/plan-123.reviewed.md` with every line of the plan except the `## Execution Notes` section (heading included), and prints its path in `ORCH_JSON` as `reviewPath`; the original plan file is untouched.
- [auto] `node --test tools/test/agent-contracts.test.mjs` passes with a test that `orch-check-plan.md`, `orch-check-bugs.md`, `orch-check-rules.md`, `orch-security.md` and `orch-verify.md` contain neither `Execution Notes` nor `git log`.
- [auto] `node --test tools/test/orchestrator.test.mjs` passes with a test that the checkers' task carries `PLAN: <reviewPath>` (the redacted copy), never the plan's own path.
- [auto] `node --test tools/test/handoff-reset-base.test.mjs` passes: `node scripts/orch-state.mjs handoff --run r --plan 123 --reset-base` leaves the builder worktree at the plan branch's base commit with no uncommitted change (`git status --porcelain` empty, `git rev-parse HEAD` = the recorded base), and the hand-off file's `Failed:` and `Output tail:` still describe the discarded attempt; without `--reset-base` nothing is reset (today's behaviour).
- [auto] `node --test tools/test/guards.test.mjs` passes with new cases: a `Write` whose content holds a line the Angular pack's `scanGuardText` refuses is blocked by the PreToolUse hook with the guard's rule and line in the message; a `Write` with no hit passes; a project with no `scripts/pre-commit-*.mjs` exporting `scanGuardText` passes everything; the hook finishes in under 300 ms on the test fixture.
- [auto] `node --test tools/test/plan-park.test.mjs` passes: `node scripts/plan-park.mjs --plan 123 --reason "x"` run twice in a row exits 0 both times; after it: no `.claude/.session-lock` in the slot, no local `park/` branch for that plan (the remote one keeps the WIP commit), the worktree folder removed, the slot freed in `.claude/slots.json`, and the park recorded once in `.claude/orchestrator-runs/<run>/status.json`.
- [auto] `npm run build`, `npm run lint`, `npm test`, `node --test "tools/test/*.test.mjs"` pass; `node tools/sync.mjs --target . --apply` then `node tools/drift-check.mjs --target .` report no drift.

## Execution Mode
- Parallel: no.
- Concurrent plans: none (goes first in the goal run).
- Isolated DB: no.

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspot `CHANGELOG.md`.

```scope
core/scripts/orch-state.mjs
scripts/orch-state.mjs
core/scripts/plan-park.mjs
scripts/plan-park.mjs
core/scripts/lib/orch-run.mjs
scripts/lib/orch-run.mjs
core/scripts/lib/guard.mjs
scripts/lib/guard.mjs
core/scripts/lib/slot-procs.mjs
scripts/lib/slot-procs.mjs
core/.claude/settings.json
.claude/settings.json
core/.claude/workflows/orchestrate.js
.claude/workflows/orchestrate.js
core/.claude/agents/orch-builder.md
.claude/agents/orch-builder.md
core/.claude/agents/orch-check-plan.md
.claude/agents/orch-check-plan.md
core/.claude/agents/orch-check-bugs.md
.claude/agents/orch-check-bugs.md
core/.claude/agents/orch-check-rules.md
.claude/agents/orch-check-rules.md
core/.claude/agents/orch-security.md
.claude/agents/orch-security.md
core/.claude/agents/orch-verify.md
.claude/agents/orch-verify.md
core/.claude/commands/review-it.md
.claude/commands/review-it.md
core/docs/agent/orchestrator.md
docs/agent/orchestrator.md
core/docs/agent/model-routing.md
docs/agent/model-routing.md
tools/test/plan-info-no-notes.test.mjs
tools/test/handoff-reset-base.test.mjs
tools/test/plan-park.test.mjs
tools/test/guards.test.mjs
tools/test/agent-contracts.test.mjs
tools/test/orchestrator.test.mjs
tools/test/lib/**
tools/test/fixtures/**
CHANGELOG.md
```

## Read Scope

Entire repo.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry. In the goal run: a file under `core/scripts/lib/**` or `tools/test/**` is
pre-approved; anything else stops the run.

## Architecture Impact
- INV-1: preserves — no model key or tier changes; the reset is a script step, the agents keep their deny list (no `git reset --hard` by an agent).
- INV-none otherwise: four script and prompt changes; the run branch and main are untouched.

## Step 0 — Reality Check
On `origin/main`: read `plan-info` and `handoff` in `core/scripts/orch-state.mjs` (lines ~901 and ~1309), `checkers()` in `orchestrate.js` (~784–812), `park-save` (~1088), the PreToolUse `Edit|Write` hooks in `core/.claude/settings.json`, and `killPort`/`taskkill` in `core/scripts/lib/slot-procs.mjs` (~246). Confirm `scanGuardText(text, file)` in `packs/angular/scripts/pre-commit-security-grep.mjs:52` returns `[{ line, rule, ruleLine, text }]`. Print one `ok` / `conflict:` line per item.

## Atomic Sub-tasks

- [x] B1: Give `plan-info` a `--no-notes` flag that writes a redacted copy of the plan (everything but `## Execution Notes`) next to the run's status file and reports it as `reviewPath` — core/scripts/orch-state.mjs, tools/test/plan-info-no-notes.test.mjs
- [x] B2: Pass the redacted copy to the finders and the verifier, in the workflow and in `/review-it` — `PLAN:` is `reviewPath`; delete the Execution-Notes bullet in orch-check-plan.md line 27; remove `git log` from the five checkers' Bash allowances; add the contract test — core/.claude/workflows/orchestrate.js, core/.claude/commands/review-it.md, core/.claude/agents/orch-check-plan.md, orch-check-bugs.md, orch-check-rules.md, orch-security.md, orch-verify.md, tools/test/agent-contracts.test.mjs, tools/test/orchestrator.test.mjs
- [x] B3: Give `handoff` a `--reset-base` flag that restores the builder worktree to the plan branch's base (`git checkout -- . && git clean -fd`, then `git reset --hard <base sha>` by the script — the script may, agents may not) after the hand-off file is written, and record `resetToBase: <sha>` in status.json; the workflow passes it when escalating to the judgment tier — core/scripts/orch-state.mjs, core/.claude/workflows/orchestrate.js, tools/test/handoff-reset-base.test.mjs
- [x] B4: Tell the escalated builder it starts from the base: replace lines 62–65 of orch-builder.md with "A hand-off file (you are the fresh, stronger builder): the worktree is at the plan's base commit; the hand-off file holds what the first builder changed, what failed and the output tail. Re-implement the plan from the base; do not reconstruct the discarded diff" — core/.claude/agents/orch-builder.md, core/docs/agent/model-routing.md (Builder escalation paragraph)
- [x] B5: Add a write-time guard: `node scripts/lib/guard.mjs write` runs every `scripts/pre-commit-*.mjs` that exports `scanGuardText` over the `content` (Write) or `new_string` (Edit/MultiEdit) of the tool input and blocks with `GUARD <script> line <n>: <rule>` on a hit; register it as the fourth PreToolUse `Edit|Write|MultiEdit` hook in settings.json; no guard module exporting the function → pass silently — core/scripts/lib/guard.mjs, core/.claude/settings.json, tools/test/guards.test.mjs, tools/test/fixtures/**
- [ ] B6: Write `plan-park.mjs`, the one idempotent teardown: kill the slot's processes (slot-procs `taskkill /T /F` / POSIX kill), `park-save` the uncommitted work, delete `.claude/.session-lock` in the slot, `git worktree remove --force`, delete the local `park/` branch (the remote one stays), free the slot, record the park once (a second run finds it recorded and does nothing) — exit 0 always, every step logged — core/scripts/plan-park.mjs, core/scripts/orch-state.mjs (park-save reused), core/scripts/lib/slot-procs.mjs, tools/test/plan-park.test.mjs
- [ ] B7: The workflow's park path calls `plan-park.mjs` instead of `park-save` + `release` — core/.claude/workflows/orchestrate.js, core/docs/agent/orchestrator.md (Runner calls table: one row replaces two)
- [ ] T1: Resync the installed copies, run every check, add the changelog entry — CHANGELOG.md

## Technical Considerations
- Dependencies: `packs/angular/scripts/pre-commit-security-grep.mjs` (the only guard exporting `scanGuardText` today); `core/scripts/lib/guard.mjs` already runs as a Bash PreToolUse hook (`guard.mjs plan`) — B5 adds a second sub-command, same file, same hook shape.
- New files: `core/scripts/plan-park.mjs`, three test files.
- Hook input: Claude Code passes the tool call as JSON on stdin (`tool_name`, `tool_input.file_path`, `tool_input.content` / `new_string`); block = exit 2 with the message on stderr, like `scope-guard.sh`.
- Windows: `taskkill` is already called through `execFileSync` in slot-procs; never through Git Bash (it rewrites `/PID`).
- Backend / API: none. Auth and validation: none. Security surface: B5 blocks more, never less. Data / migration: none.
- Project checks: `docs/project/plan-checks.md` when it exists.

## Out of Scope
- Replacing the five checkers with one reviewer (plan 087 measures it, plan 088 builds it).
- The runner script (plan 088). Deleting the workflow (plan 090).

## Critical Questions
- none (the write-time guard blocks exactly what the commit guard would block later; no new rule).

## Execution Notes
- Step 0 (origin/main 47d0804; since the snapshot only plan 084 touched orchestrate.js, in gate()/envCheck(), not the lines this plan edits):
  - ok: `plan-info` (orch-state.mjs ~901) and `handoff` (~1309) as described.
  - ok: `checkers()` in orchestrate.js 784–831 passes `PLAN: ctx.info.path` to the finders (797) and the verifier (815).
  - ok: `park-save` (~1088) snapshots, pushes park/<run>-<NNN>, cleans and releases a slot.
  - ok: PreToolUse `Edit|Write|MultiEdit` in core/.claude/settings.json holds 3 hooks (branch-guard, plan-write-guard, scope-guard).
  - conflict: slot-procs.mjs has no `killPort`; the kill is `killTree(pid)` (~244, `taskkill /PID <pid> /T /F` via execFileSync) and `stopSlotServers({ root })`.
  - ok: `scanGuardText(text, file)` (packs/angular/scripts/pre-commit-security-grep.mjs:52) returns `[{ line, id, rule, ruleLine, text, file }]`.
  - conflict: `.claude/slots.json` does not exist anywhere in the kit; a slot is a `<repo>-wt-N` worktree, claimed by its `.worktree-plan` marker (lib/slot.mjs listSlots).
- decision: behaviour: B6 "slot freed in .claude/slots.json" = the slot released the existing way (detached at the run branch, `.worktree-plan` and the builder marker removed, so `listSlots()` shows it idle); a permanent wt-N slot is freed, never removed; only a plan's own builder folder (`<repo>-orch-<run>-<NNN>`) is `git worktree remove --force`d. Reverse: add a slots.json writer in plan-park.mjs.
- B1: `plan-info --no-notes` (switch; `--no-notes=yes` too) writes `.claude/orchestrator-runs/<run>/plan-<NNN>.reviewed.md` via `planWithoutNotes()` (lib/orch-run.mjs; a `## ` inside a code fence does not end the section) and returns `reviewPath`. Evidence: `node --test tools/test/plan-info-no-notes.test.mjs` failed before (`unknown flag --no-notes`), now 2/2 pass.
- B2: the workflow asks plan-info for `--no-notes` and hands every finder and the verifier `PLAN: .claude/orchestrator-runs/<run>/plan-<NNN>.reviewed.md` (built from RUN + nnn in the code, the same path plan-info writes); `/review-it` runs `plan-info --run review --plan <NNN> --no-notes` and passes its reviewPath; `git log` left the Bash allowance of check-plan/bugs/rules/verify, the Execution-Notes bullet left orch-check-plan.md (orch-security had neither). Evidence: the new contract test and workflow test failed before; now `node --test tools/test/orchestrator.test.mjs` 150/150 and agent-contracts pass; two exact plan-info command regexes in orchestrator.test.mjs gained `--no-notes=yes`.
- decision: behaviour: B3 "the plan branch's base" = `git merge-base HEAD origin/<run branch>` in the plan's folder (slot or own folder); after the local reset the script also moves origin/<branch> to that base with `--force-with-lease=<branch>:<the head it saw>`, because the builder pushes with a plain `git push -u origin <branch>` and would otherwise be refused as non-fast-forward. The discarded head is kept as `resetFrom` in status.json and on the hand-off file's `Reset:` line. Reverse: drop the push in `handoff` and let the builder push with a lease.
- B3: `handoff --reset-base` writes the hand-off file first (Files changed / Done / Failed / Output tail still describe the attempt), then `git checkout -- .`, `git clean -fdq --exclude=.worktree-*`, `git reset --hard <base>` in the plan's folder; status.json gets `resetToBase` and `resetFrom`; the workflow passes `--reset-base=yes` on every escalation. Evidence: `node --test tools/test/handoff-reset-base.test.mjs` failed before (folder still dirty), now 2/2; the orchestrator escalation test asserts `--reset-base=yes` (152/152 with it).
- B4: orch-builder.md's hand-off bullet now reads the plan's sentence verbatim (worktree at the base, re-implement, do not reconstruct the discarded diff); model-routing.md's Builder escalation paragraph names `handoff --reset-base`, and rule 5 says the file is the fresh builder's only view of the discarded diff. Evidence: synced, `node --test tools/test/agent-contracts.test.mjs` 25/25.
- decision: behaviour: B5 blocks the way the other guards in guard.mjs do — the deny JSON on stdout with exit 0 (Claude Code reads `hookSpecificOutput.permissionDecision`, Cursor reads `permission`), not exit 2 + stderr as the plan's Technical Considerations line says; the guards test parses that JSON. Reverse: write the message to stderr and exit 2 in the `write` branch.
- decision: behaviour: B5 judges only the files the commit guard judges — a guard module's exported `GUARD_FILES` RegExp when it has one, else the commit script's own filter `\.(ts|html|js)$` (pre-commit-security-grep.mjs filters staged files that way and lives in packs/, outside this plan's scope), so a plan or a doc that quotes a forbidden line is not blocked. A guard module that cannot be read or imported, and unreadable input, are allowed (the commit guard stays the backstop). Reverse: drop the filter in `writeGuardDecision`.
- B5: `node scripts/lib/guard.mjs write` (`writeGuardDecision`) runs every `scripts/pre-commit-*.mjs` whose text exports `scanGuardText` over `content` / `new_string` / `edits[].new_string` and denies with `GUARD <script> line <n>: <rule> — <text>`; registered as the fourth `Edit|Write|MultiEdit` PreToolUse hook. Evidence: the deny, speed and settings cases failed before; `node --test tools/test/guards.test.mjs` 37/37; the hook takes about 180 ms here, ~135 ms of it node start-up (speed test: fastest of 5 wall-time runs < 300 ms).
