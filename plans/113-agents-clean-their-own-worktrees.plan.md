# Plan 113 — A project cleans up the worktree folders its agents made, by script, without asking the Human

Status: draft
Depends-on: none
Snapshot: 0ebea33
Source: the Human, 2026-11-10 (feature request + Architect + PM review in the kit main folder; the six recommendations accepted with "recommended b" and "go", which is also the freeze yes for this plan).

## Problem Statement
1. **Folders pile up beside each project.** After runs, fixes and reviews, sibling worktrees stay: `<repo>-orch-<run>-<NNN>` (builders), `<repo>-orch-merge-<run>`, `<repo>-orch-review-<run>-<NNN>`, `<repo>-review-<NNN>` (/review-it), and folders agents make by hand (`foodVibe1.0-fix-541`, `foodVibe1.0-kit-310` today: both clean, merged into origin/main, remote branch gone, and nothing in the kit removes them).
2. **When an agent deletes, it is refused, and the Human gets a command.** 28 refused or failed deletes in FoodVibe sessions (2026-10-18 → 2026-11-10), all in interactive sessions. None came from the kit's guard hooks. Two sources: the Human's global `~/.claude/settings.json` deny list (`Bash(rm -r:*)`, `Bash(rm -rf:*)`, `Bash(git branch -D:*)` → "Permission to use Bash … has been denied"), and the auto-mode classifier ("[Git Destructive]" on `git worktree remove`, "[Irreversible Local Destruction]" on `Remove-Item`).
3. **Windows: `git worktree remove` fails with "Directory not empty".** Seen on 7 merge folders (run-497-419, 507, 409-410, 499-502, 513-516, 536, 540). Only `removeFolder` in `core/scripts/lib/orch-folders.mjs` retries and renames aside; `sweepLeftovers` and `free-merged-slots.mjs` print "kept"/"left alone".
4. **The sweeps are narrow and late.** `sweepLeftovers` (`core/scripts/run-supervisor.mjs:262`) runs only at supervisor start and matches only `<repo>-orch-*` builder names (`-orch-merge-*` excluded); a detached `-orch-review-*` folder of a killed run is "on no branch" and kept forever. `free-merged-slots.mjs` removes a merge folder only after the Human merges the run branch. `/review-it` (`core/.claude/commands/review-it.md:19-23`) has the model run `git worktree remove` itself after the verdict, so an early STOP or a refusal leaves the folder.
5. **One existing script breaks the safety rules.** `core/scripts/prune-merged-worktrees.sh:69` runs `git worktree remove --force … || rm -rf` on a merged `.claude/worktrees/*` folder without checking it is clean.

## Goals & Success Criteria
**Primary:** after a run, a fix and a review that all merged, no worktree the kit or its agents made is left beside the project (the permanent `wt-N` slots stay); anything unsafe to remove stays with one reason line; nothing stops to ask the Human for a delete.

- [auto] `node --test tools/test/worktree-clean.test.mjs` passes. In a scratch repo with an origin, the sweep removes: a clean builder folder whose branch is merged into `origin/<run branch>` or `origin/main`; a `-fix-*` and a `-scratch-*` folder whose branch is merged or whose upstream is `[gone]`; a detached `-orch-review-*` / `-review-*` folder of a run that is not live whose HEAD commit is on an origin branch; the merge folder of a finished (not live) run when it is clean and its run branch tip is on `origin/<run branch>`; a merged clean `.claude/worktrees/*` folder. It keeps, each with a `kept — <reason>` line: uncommitted files, an unmerged branch, a `park/…` branch, a folder named in a hand-off, a live run's folder, a detached folder whose commit is on no origin branch, a git-locked worktree. It never touches the main folder, a `wt-N` slot, or a sibling whose name matches no kit pattern (e.g. `<repo>-mvp-review`). Local branches are kept in every case.
- [auto] Same test: when `git worktree remove` fails (injected failure), the script retries 3 times, then falls back to `removeFolder`; when that fails too it prints `kept — could not remove: <error>` and exits 0. No call passes `--force` for a folder with uncommitted files, and no packages are linked from the main folder.
- [auto] `node --test tools/test/run-supervisor.test.mjs` passes, with a new case: a supervised run that ends `finished` runs the sweep at the end (its `SUPERVISOR_SWEEP:` lines are logged), so that run's builder folders and merge folder are gone without a second supervisor start. The existing leftover-sweep case still passes.
- [auto] `node --test tools/test/worktree-clean.test.mjs` also checks the agent helper: `add <slug> --branch <b>` creates `<repo>-scratch-<slug>` beside the project; `remove <path>` applies the same rules (kept with a reason when dirty).
- [auto] `core/scripts/prune-merged-worktrees.sh` no longer contains `--force` or `rm -rf`; a test in `tools/test/worktree-clean.test.mjs` reads the file and asserts it.
- [auto] `npm test`, `npm run build`, `npm run lint` and `node tools/drift-check.mjs --target .` pass after `node tools/sync.mjs --target . --apply`.
- [human] In a live Claude Code session in auto mode (FoodVibe, after `kit-sync` of the release), ask the agent to run `node scripts/worktree-clean.mjs --sweep`: it runs with no permission prompt and no classifier refusal, and `foodVibe1.0-fix-541` and `foodVibe1.0-kit-310` are gone.
- [human] In FoodVibe: after the next orchestrator run finishes, no `-orch-*` folder of that run is left; `/review-it <other branch>` leaves no `-review-<NNN>` folder, also when it STOPs early.

## Execution Mode
- Parallel: no.
- Concurrent plans: none.
- Isolated DB: no.
- Run: **solo flow** (`git switch -c feat/113-<slug>` from `origin/main`, build here, then `/ship`). Not `/orchestrate`: the change touches the run scripts and `core/.claude/**`.
- After the merge: a minor release; each project gets it with `kit-sync`.

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspots `CHANGELOG.md` and `docs/brain/error-review.md`.

```scope
core/scripts/worktree-clean.mjs
core/scripts/run-supervisor.mjs
core/scripts/free-merged-slots.mjs
core/scripts/lib/orch-folders.mjs
core/scripts/prune-merged-worktrees.sh
core/.claude/commands/review-it.md
core/.claude/commands/fix.md
core/.claude/commands/cleanup.md
core/.claude/settings.json
core/docs/brain/gotchas/git-workflow.md
core/docs/agent/orchestrator.md
core/docs/agent/workflow-map.md
tools/test/worktree-clean.test.mjs
tools/test/run-supervisor.test.mjs
scripts/**
.claude/commands/**
.claude/settings.json
docs/agent/**
docs/brain/gotchas/**
kit.json
CHANGELOG.md
```

## Read Scope

Entire repo, plus read-only checks in `C:\coding projects\Cursor\foodVibe1.0` (`git worktree list`, `git status`, no writes).

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a step needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry.

## Architecture Impact
- INV-1: preserves — no model, tier or agent changes; `run-plans.mjs` is not edited (its review folder already removes itself in a `finally`; a killed run's leftover is handled by the sweep).

## Step 0 — Reality Check
1. `git worktree list --porcelain` in a scratch repo: confirm `worktree`, `branch`, `detached`, `locked` lines are what the parser reads.
2. Confirm the names the kit makes: `builderFolder`/`mergeFolder` in `core/scripts/orch-state.mjs:287-288`, the review folder in `core/scripts/run-plans.mjs:1541`, `/review-it`'s `<folder>-review-<NNN>`, and `{{project.repoName}}` / `{{slots.folderSuffix}}` from `kit.config.json`.
3. Auto mode and allow rules: check in the Claude Code docs whether auto mode honours a narrow allow rule (`Bash(node scripts/worktree-clean.mjs:*)`) while it ignores the broad `Bash(*)` already in `core/.claude/settings.json`. Record the answer under Execution Notes; S6 depends on it.

## Atomic Sub-tasks
- [ ] S1: Write the failing tests for the sweep rules, the Windows fallback and the agent helper in a scratch repo — tools/test/worktree-clean.test.mjs
- [ ] S2: Add one cleanup script that judges every kit-made worktree from git's own list and removes the safe ones — patterns `<repo>-orch-*`, `-review-*`, `-fix-*`, `-scratch-*`, `-kit-*`, `-sync-*` and `.claude/worktrees/*`, from `{{project.repoName}}`; never the main folder or a `{{slots.folderSuffix}}` slot; rules: clean, merged (origin/main, origin/<run branch>, upstream gone), merge folder of a not-live run with its branch on origin, detached HEAD on an origin branch; kept for park/, hand-off, live run, locked, dirty, unmerged; `git worktree remove` without --force, 3 tries, then `removeFolder`; one `WORKTREE_CLEAN: <path>: removed|kept — <reason>` line each, exit 0; modes `--sweep`, `--path <folder>`, `add <slug>`, `remove <path>`, `--dry-run` — core/scripts/worktree-clean.mjs, core/scripts/lib/orch-folders.mjs
- [ ] S3: Make the supervisor's sweep use the new script and run it also when a run ends, not only at the next start — sweepLeftovers calls it; `end()` runs it after `finished`/`stopped` — core/scripts/run-supervisor.mjs, tools/test/run-supervisor.test.mjs
- [ ] S4: Let the Planner's sync remove merged agent folders too — free-merged-slots.mjs calls the sweep after its merge-folder step, keeping its own lines — core/scripts/free-merged-slots.mjs
- [ ] S5: Stop the old prune script from force-deleting a folder it never checked — line 69 calls `node scripts/worktree-clean.mjs --path` instead; /cleanup's YES stays only for sessions and anything the rules keep — core/scripts/prune-merged-worktrees.sh, core/.claude/commands/cleanup.md
- [ ] S6: Let agents run the cleanup script without a refusal — one narrow allow rule for `node scripts/worktree-clean.mjs`, per Step 0 item 3 — core/.claude/settings.json
- [ ] S7: Make /review-it remove its folder by script in every outcome, and point /fix and the gotcha at the helper for any scratch checkout — review-it step 1 adds and removes via the script as a finally-style last step (also after a STOP); fix.md one line; gotcha replaces "git worktree add … then git worktree remove" with the helper — core/.claude/commands/review-it.md, core/.claude/commands/fix.md, core/docs/brain/gotchas/git-workflow.md
- [ ] S8: Document the cleanup in the orchestrator doc and the workflow map — core/docs/agent/orchestrator.md, core/docs/agent/workflow-map.md
- [ ] S9: Resync the installed copy, run every check, and release it — scripts/**, .claude/**, docs/**, kit.json, CHANGELOG.md

## Technical Considerations
- The delete runs inside a node process, so it goes through neither the Human's global Bash deny list nor the auto-mode classifier when the supervisor calls it. When an agent calls it (`/review-it`, `/fix`, the helper), the classifier still judges one `node scripts/worktree-clean.mjs …` call; S6 makes that call allowed.
- Detached folders: "merged" cannot be tested on a branch; the rule is "HEAD is contained in an origin branch" (`git branch -r --contains HEAD`), so no commit can be lost.
- Merge folder at run end: its branch is the run branch, which only the Human merges. Removing the folder is safe once the folder is clean and the run branch tip is on `origin/<run branch>`: the local branch stays and the work is on origin (Human, 2026-11-10).
- A kit-named folder that git does not list as a worktree (a half-deleted leftover) is kept with a reason: the script cannot tell whether it holds unsaved work.
- Live run, hand-off and park checks reuse `liveRuns` / `handoffTexts` from `run-supervisor.mjs` (export them, or move them into the new script) — one copy, not two.
- Never link packages from the main folder (git removes through a Windows junction and would delete the main folder's packages); the script only removes.

## Out of Scope
The Human's global `~/.claude/settings.json` (deny list, auto mode); deleting local or remote branches; sibling folders whose names match no kit pattern (folders the Human made); `run-plans.mjs`'s own review-folder code; slot (`wt-N`) handling in `free-merged-slots.mjs`.

## Critical Questions
None open.

## Execution Notes
- 2026-11-10 Planner: Human decisions from the review — (1) one script does every delete, plus a narrow allow rule; (2) merge folder removed at run end when clean and pushed; (3) only kit/agent-named folders are judged, the Human's own never; (4) detached folders removable when clean and their commit is on origin; (5) `core/.claude/**` edits go in this branch (the kit repo builds solo, not headless); (6) fix `prune-merged-worktrees.sh`'s `--force`; keep `--force` in `run-plans.mjs` (read-only review checkout) and `plan-park.mjs` (after the save step).
- 2026-11-10 Planner: the brief's "names from kit.config.json" is met by `{{project.repoName}}` and `{{slots.folderSuffix}}`; no new config key.
