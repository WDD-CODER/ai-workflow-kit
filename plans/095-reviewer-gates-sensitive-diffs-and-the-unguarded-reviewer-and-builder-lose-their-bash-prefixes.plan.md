# Plan 095 — Reviewer gates sensitive diffs; the unguarded reviewer and builder lose their Bash prefixes

Status: draft
Depends-on: 088, 097
Snapshot: 130e979d769df5d0cae061e410b348a9aa980084
Source: automated security review of an installed project's PR (kit v2.1.0 sync), 2026-11-07; the project could not fix it (kit-owned files). Narrowed by the Planner on 2026-11-08 after plan 097 merged. Reliability and security fix, allowed in the freeze; no new capability.

## Problem Statement
Two findings on kit-owned files, both reproduced in an installed project at `scripts/lib/claude-run.mjs` and `scripts/run-plans.mjs`:

1. **Pre-approved Bash prefixes are wider than the agent needs.** `core/scripts/lib/claude-run.mjs`:
   - `READ_ONLY_BASH = ['Bash(git diff:*)', 'Bash(git show:*)', 'Bash(node --test:*)']` (l.52, the reviewer). `git diff --output=<file>` writes a file; `node --test` runs any test file in the folder, so a hostile diff can run code as the reviewer.
   - `BUILDER_BASH = ['Bash(git:*)', 'Bash(npm run:*)', 'Bash(pnpm run:*)', 'Bash(node:*)']` (l.55) is the fallback `allowedTools()` (l.62) uses when the builder has no guard hooks (`guarded: false`). `git:*` and `node:*` are interpreter-wide prefixes, so with no hooks the builder can run anything.
2. **A sensitive diff can still merge on an advisory review.** Since plan 097, a plan's review is enforced (`gate`) unless its `## Execution Mode` says `Reviewer: advisory`. A plan that says so and touches a sensitive path (auth, guards, secrets, `security.sensitivePaths`) still merges on a reviewer STOP, and "review could not run" is only a note in advisory mode. The old `orch-security` / gate agents that enforced this were deleted by the v2.1.0 sync.

## Goals & Success Criteria
**Primary:** an unattended run never merges a sensitive-path diff without an enforced review, and no agent runs with an interpreter-wide Bash allowlist.

- [auto] `node --test tools/test/run-plans.test.mjs` passes, with tests that fail on today's code:
  (a) a plan with `Reviewer: advisory` whose diff touches a sensitive path (the same test as `ship-prep.mjs`'s sensitive-path check, `security.sensitivePaths` included) and a reviewer returning STOP gets one fix round, then parks — never a merge;
  (b) the same plan with the fake claude exiting non-zero ("review could not run") parks;
  (c) the same plan with a non-sensitive diff keeps the advisory behaviour (STOP recorded, plan merges), so plan 097's per-plan rule is unchanged;
  (d) the reviewer's `--allowedTools` holds no `node --test`; `git diff` / `git show` stay only if a test shows `--output` and `--no-index` are refused (else the reviewer gets no Bash: its diff and receipt already come inline);
  (e) `allowedTools()` for a writing agent without guard hooks throws (the run refuses to start an unguarded builder); with hooks it keeps a bare `Bash` as today; `BUILDER_BASH` is gone.
- [auto] `docs/agent/orchestrator.md` and the `kit.config.json` `$comment` for `orchestrator.reviewerMode` state both rules: advisory applies only to a plan with `Reviewer: advisory` (plan 097, left stale there) and never to a sensitive diff (`grep -c "Reviewer: advisory" docs/agent/orchestrator.md` ≥ 1).
- [auto] `npm run build`, `npm run lint`, `npm test` and `node tools/drift-check.mjs --target .` pass (the builder runs the kit sync with apply first; it is a step, not a check).
- [human] Release the kit, run `kit-sync -Ref vX.Y.Z -Apply` on the installed project, and run one `/orchestrate` on a plan that says `Reviewer: advisory` and touches a guard file: it parks on a reviewer STOP instead of merging (reply `ok`).

## Execution Mode
- Parallel: no.
- Concurrent plans: none.
- Isolated DB: no.
- Run: first plan of `/orchestrate 095,098,099` on the kit; merges pre-approved by the Human on 2026-11-08, `orch/<run>` into `main` by a PR after the final gate and the `[human]` cards.
- Fallback: when the dry run says `WOULD START: no`, append one line with the date and the reason to `docs/brain/error-review.md` first, then build this plan by the solo flow (`feat/095-<slug>` in this folder, then `/ship`).

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspots `CHANGELOG.md` and `docs/brain/error-review.md`.

```scope
docs/brain/error-review.md
core/scripts/lib/claude-run.mjs
scripts/lib/claude-run.mjs
core/scripts/run-plans.mjs
scripts/run-plans.mjs
core/scripts/lib/sensitive-paths.mjs
scripts/lib/sensitive-paths.mjs
core/scripts/ship-prep.mjs
scripts/ship-prep.mjs
core/docs/agent/orchestrator.md
docs/agent/orchestrator.md
kit.config.json
tools/lib/kit.mjs
tools/test/run-plans.test.mjs
tools/test/ship-prep*.test.mjs
CHANGELOG.md
```

`core/scripts/lib/sensitive-paths.mjs` is new (only if Step 0 item 2 finds the check is not importable as it is).

## Read Scope

Entire repo.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a step needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry.

## Architecture Impact
- INV-1: preserves — `run-plans.mjs` changes only the review mode of a sensitive diff and the tool lists; the builder and judgment tiers and the dry-run/real-run shared path stay as they are. No invariant on reviewer enforcement exists in `docs/brain/invariants.md` (checked 2026-11-08).

## Step 0 — Reality Check
1. Read `core/scripts/lib/claude-run.mjs` l.50–80 (`READ_ONLY_BASH`, `BUILDER_BASH`, `allowedTools`) and every caller of `allowedTools` / `claudeArgs({ allow: true })`: confirm the builder always gets `settings` in `run-plans.mjs` (l.416 dry run, l.455 real run) so the throw never fires in a normal run.
2. Read `core/scripts/ship-prep.mjs` l.26–40 (`DEFAULT_SENSITIVE_RE`, `sensitiveTests`, `isSensitive`): if `isSensitive` cannot be imported without running ship-prep's main, move it to `core/scripts/lib/sensitive-paths.mjs` and import it from both.
3. Read `run-plans.mjs` `reviewStep` and its two callers (`l.reviewerMode ?? o.reviewerMode`, from plan 097): the sensitive check uses the files of the diff the reviewer sees (`origin/<run branch>...<checked head>`).
4. Try `git diff --output=x` and `git diff --no-index a b` under `--allowedTools 'Bash(git diff:*)'` with the fake claude's argv only (no model call): decides item (d).

## Atomic Sub-tasks
- [ ] S1: Write the failing tests first, for the sensitive diff, the failed review and the tool lists — cases (a)–(e) — tools/test/run-plans.test.mjs
- [ ] S2: Make one sensitive-path check that the ship gate and the runner both use — isSensitive shared, security.sensitivePaths honoured — core/scripts/lib/sensitive-paths.mjs, core/scripts/ship-prep.mjs
- [ ] S3: Enforce the review of a sensitive diff even when the plan asks for advisory, and park when it cannot run — reviewStep mode, park on review error — core/scripts/run-plans.mjs
- [ ] S4: Take test running away from the reviewer and refuse to start a builder with no guard hooks — READ_ONLY_BASH, BUILDER_BASH removed, allowedTools throws — core/scripts/lib/claude-run.mjs
- [ ] S5: Say both review rules where projects read about the setting — orchestrator.md table row, kit.config.json $comment — core/docs/agent/orchestrator.md, kit.config.json
- [ ] S6: Resync the installed copies, run every check, add the changelog entry — CHANGELOG.md

## Technical Considerations
- The sensitive check runs on the reviewed diff's file list, not the plan's scope: a plan can touch a guard file it did not list only if the scope check let it, and the review must still see that.
- A `[human]` item stays: only a real installed-project run shows the review parks there.

## Out of Scope
A new security agent or model call; changing `reviewerModel`; the builder's guard hooks themselves; the `/ship` checker pipeline (`review.ship`).

## Critical Questions
None open. (A sensitive diff is reviewed as `gate` whatever the plan's `Reviewer:` line or the `--reviewer-mode` flag says: that is the Primary goal, not a choice.)

## Execution Notes
