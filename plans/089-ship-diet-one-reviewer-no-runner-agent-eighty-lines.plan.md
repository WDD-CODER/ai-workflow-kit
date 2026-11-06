# Plan 089 — /ship diet: one reviewer, no runner agent, eighty lines

Status: draft
Depends-on: 088
Snapshot: fd212e119ef16c0b26ebfaf6b44f450fee26d8f5
Source: kit audit 2026-11-06, plan C; Q3 of the notebook (instruction adherence drops to ~68 % at 500 instructions).

## Problem Statement
`core/.claude/commands/ship.md` is 252 lines with 7 phases, 5 flags and 3 lanes, and sends the agent to four more files (`ship-regular.md` 119, `job-validation.md` 421, `standards-git.md` 135, `decision-review.md` 145). Phase 1 hands three commands to the Haiku `kit-runner` agent and then tells the main session to rerun them inline when the copy is unreadable. Phase 2 on a plan branch starts the three finders, the security agent and the verifier (five Sonnet calls, measured recall 0.25–0.33). Phase 4 runs decision grading, the learning step and brain capture on every REGULAR ship. The sources say: deterministic steps in code, one measured judge, the fewest standing instructions that still carry the rules.

## Goals & Success Criteria
**Primary:** `/ship` runs its checks in code, reviews with the single measured reviewer, and fits in 80 lines without losing a rule the Human relies on.

- [auto] `wc -l core/.claude/commands/ship.md` ≤ 80 and `node --test tools/test/ship-review.test.mjs` passes with tests that the file names no `kit-runner`, no `orch-verify`, no finder, and no `docs/agent/ship-regular.md`.
- [auto] Phase 1 is `node scripts/ship-prep.mjs --gate`: build (+ lint; + the test script on REGULAR) + `plan-ledger-check` + `override-check` by `spawnSync`, printing one line per command with its exit, exit 1 on the first failure; `tools/test/ship-prep.test.mjs` covers FAST (no tests) and REGULAR (tests).
- [auto] Phase 2 REGULAR runs `node scripts/lib/plan-review.mjs --branch <current> --base origin/main` (plan 088's library) and prints its verdict line; FAST / ULTRA-TRIVIAL skip Phase 2 and record `Review: SKIPPED (fast-lane)`; `--skip-review "reason"` unchanged; sensitive paths force REGULAR as today (`ship-prep.mjs` lines 26–40 untouched).
- [auto] The commit tree keeps exactly: Branch, Rename, Proposed commit, `Review:` line, Files to stage, and one of VALIDATED BY HUMAN / HOW TO VALIDATE / VERIFIED BY AGENT; the six-lens `Review (checkers):` block is gone; `tools/test/ship-review.test.mjs` asserts the template.
- [auto] Merge needs the literal word `merge` in the request or the gate reply, exactly as today (`/ship fast merge` pre-approves; `Y` alone leaves the PR open); the test covers both.
- [auto] Decision grading, the learning step and brain capture run only when `review.ship` is `learn`; the default is `off`; `kit.config.json` documents the key; with `off` Phase 4 has no decisions block and no `Learning:` line.
- [auto] `docs/agent/ship-regular.md` is deleted; what the Human still needs from it (the Commit-vs-PR judgment, "After opening a PR") moves into `standards-git.md` under one heading of at most 20 lines; `docs/agent/workflow-map.md` F3 updated.
- [auto] A worker's instruction load (`AGENTS.md` + `take-plan.md` + `ship.md` + `job-validation.md` + `standards-git.md`) is under 600 lines: `node tools/instruction-load.mjs` prints the sum and exits 1 above it (the tool is the seed of plan 090's budget test).
- [auto] `npm run build`, `npm run lint`, `npm test`, `node --test "tools/test/*.test.mjs"` pass; sync then drift-check report no drift.
- [human] One `/ship fast merge` of a small kit change and one `/ship` REGULAR on a plan branch: both reach the gate with the tree above; the REGULAR one shows the reviewer's verdict line; nothing you used to rely on is missing (reply `ok` or name it).

## Execution Mode
- Parallel: no.
- Concurrent plans: none; needs 088 merged (`plan-review.mjs`, `claude-run.mjs`).
- Isolated DB: no.

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspot `CHANGELOG.md`.

```scope
core/.claude/commands/ship.md
.claude/commands/ship.md
core/.claude/commands/review-it.md
.claude/commands/review-it.md
core/scripts/ship-prep.mjs
scripts/ship-prep.mjs
core/scripts/lib/plan-review.mjs
scripts/lib/plan-review.mjs
core/docs/agent/ship-regular.md
docs/agent/ship-regular.md
core/docs/agent/standards-git.md
docs/agent/standards-git.md
core/docs/agent/job-validation.md
docs/agent/job-validation.md
core/docs/agent/workflow-map.md
docs/agent/workflow-map.md
core/docs/agent/model-routing.md
docs/agent/model-routing.md
core/docs/agent/decision-review.md
docs/agent/decision-review.md
kit.config.json
.kit/config.json
tools/lib/kit.mjs
tools/instruction-load.mjs
tools/test/ship-review.test.mjs
tools/test/ship-prep.test.mjs
tools/test/lib/**
CHANGELOG.md
```

## Read Scope

Entire repo.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry. In the goal run: `tools/test/**` and `tools/lib/**` are pre-approved.

## Architecture Impact
- INV-1: preserves — the reviewer is the `review`-tier agent of plan 087; no model switch inline (`model-routing.md` rule 1).
- INV-none otherwise: a command gets shorter; the rules it keeps are the same rules.

## Step 0 — Reality Check
Read `ship.md` Phase 4 "On approval" steps 1–7 and list which steps the 80-line version keeps verbatim (todo sync, `git add` only listed paths, one commit, no amend after push, never push to main) — those are the rules; the rest is procedure that moves to `ship-prep.mjs` or is deleted. Read `job-validation.md` → "When that moment is" to keep the three validation blocks exactly. Read `kit.config.json` `review.ship` values today (`checkers` | `light`) and plan the migration: `checkers` → `reviewer`, add `learn`, add `off`.

## Atomic Sub-tasks

- [ ] S1: `ship-prep.mjs --gate`: the Phase 1 commands by `spawnSync`, per-lane test inclusion, one line per command — core/scripts/ship-prep.mjs, tools/test/ship-prep.test.mjs
- [ ] S2: `plan-review.mjs --branch --base` works outside a run (no run folder: the redacted plan goes to the OS temp folder; the gate receipt is `ship-prep --gate`'s output) — core/scripts/lib/plan-review.mjs, tools/test/ship-review.test.mjs
- [ ] S3: Rewrite `ship.md` to ≤ 80 lines: Phase 0 lane; Phase 1 `ship-prep --gate` (hard stop); Phase 2 reviewer (REGULAR) / skip (FAST); Phase 3 manifest + rebase (unchanged rules, shorter text); Phase 4 tree + `Y` / `merge` + the three validation blocks; "On approval" as 5 rules; wrap-up block — core/.claude/commands/ship.md
- [ ] S4: Learning behind `review.ship = learn` (grade, learn, brain capture); default `off`; `reviewer` replaces `checkers` for Phase 2; `tools/lib/kit.mjs` validates the three values and migrates `checkers` → `reviewer` on install/sync with a NOTE line — kit.config.json, .kit/config.json, tools/lib/kit.mjs, core/.claude/commands/ship.md
- [ ] S5: Delete `ship-regular.md`; move the Commit-vs-PR judgment and "After opening a PR" into `standards-git.md` (≤ 20 lines); update workflow-map F3, model-routing's table (kit-runner's `/ship` row and the checkers' `/ship Phase 2` note removed), `review-it.md` becomes "run `plan-review.mjs` and print its table" (≤ 30 lines) — core/docs/agent/ship-regular.md, core/docs/agent/standards-git.md, core/docs/agent/workflow-map.md, core/docs/agent/model-routing.md, core/.claude/commands/review-it.md
- [ ] S6: `tools/instruction-load.mjs`: sums the five files, prints the number, exits 1 above 600 — tools/instruction-load.mjs
- [ ] T1: Resync, run every check, changelog, the two `[human]` ships — CHANGELOG.md

## Technical Considerations
- Dependencies: 088's `plan-review.mjs` and `claude-run.mjs`; `ship-prep.mjs` (lane thresholds at lines 24–46 stay the source of truth).
- `job-validation.md` is not shortened here (plan 080/069 territory); only its cross-references change.
- Backend / API: none. Auth and validation: none. Security surface: sensitive-path forcing to REGULAR is unchanged. Data / migration: `review.ship` value migration on install/sync.

## Out of Scope
- Shortening `job-validation.md` and the card format.
- Removing `git-agent.md` (plan 090 decides).
- Any change to what counts as validation (`done` / `verified` / `approved`; `Y` alone never validates).

## Critical Questions
- Q: `review.ship` default — `off` or `learn`? A: `off` (goal decision 7); the Human flips it to `learn` when the bar in plan 090 is met.

## Execution Notes
