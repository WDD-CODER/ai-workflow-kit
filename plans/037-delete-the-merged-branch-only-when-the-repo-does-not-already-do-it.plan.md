# Plan 037 — Delete the merged branch only when the repo does not already do it

Status: draft
Track: code — here (kit)
Snapshot: e6141fffea34debe0cf510d2d4d20aacb77ea57a
Depends-on: none

## Problem Statement

After a merge from a slot the kit tells the agent to run `git push origin --delete <branch>`
(`core/docs/agent/standards-git.md` "Merging from a slot"; `core/docs/agent/ship-regular.md` and `ship-recovery.md`
name the same delete). A project that already deletes merged branches (the GitHub repo setting
`delete_branch_on_merge`, or a workflow that does it) has the branch gone before the agent's delete runs. First seen
in a project: the agent's `git push origin --delete` was rejected because GitHub had already removed the branch, and
the agent reported it as an open loose end. The kit cannot assume either way.

1. The kit does not look at whether the project deletes merged branches itself.
2. A project that deletes nothing gets no hint to switch the setting on.

## Goals & Success Criteria

**Primary:** the agent deletes a merged branch only when the project does not; when the project does, the agent skips
the delete and never reports it as a loose end; when it cannot tell, it deletes (today's behaviour) and says so.

- [auto] New `core/scripts/branch-autodelete-check.mjs` prints exactly one of `AUTODELETE: auto (<why>)`, `AUTODELETE: manual`, `AUTODELETE: unknown (<why>)` and always exits 0. `auto` when `gh api repos/<owner>/<repo> --jq .delete_branch_on_merge` is `true`, or when a file in `.github/workflows` deletes branches (matches `git/refs`, `git push … --delete`, `gh api -X DELETE … git/refs`, or `delete-branch`). `manual` when the setting is `false` and no workflow matches. `unknown` when `gh` is missing, not signed in, or the call fails. The owner/repo comes from `git remote get-url origin`; the call runs as `GITHUB_TOKEN= gh …` like the kit's other `gh` calls (`standards-git.md`). Every external command runs through `spawnSync` with an argument array — no branch name or workflow text is ever put on a shell command line.
- [auto] `node --test tools/test/branch-autodelete-check.test.mjs` passes with cases for all three answers (setting `true`; workflow only; setting `false` and no workflow; `gh` absent → `unknown`) and one case where a workflow file holds shell characters (`$(id)`, backticks, `;`) and the script still answers without running anything but `git` and `gh`. The `gh` and `git` calls are stubbed through a `PATH` folder in `tools/fixtures/branch-autodelete/`.
- [auto] `core/docs/agent/standards-git.md` "Merging from a slot" runs `node scripts/branch-autodelete-check.mjs` first: `auto` → skip `git push origin --delete`; `manual` / `unknown` → delete as today. `git fetch origin --prune` and `free-merged-slots.mjs` run in every case. On `manual`, the merge summary gets one line suggesting `GITHUB_TOKEN= gh api -X PATCH repos/<owner>/<repo> -f delete_branch_on_merge=true` (a suggestion; the agent never changes the setting). A delete rejected because the branch is already gone is not reported as open. `ship-regular.md` and `ship-recovery.md` use the same wording for the merged-branch delete (`ship-recovery.md`'s rename-case delete of the old branch name is unchanged); `core/.claude/commands/ship.md` points to the same check where it names the merge. `node tools/install-check.mjs` asserts that the four rendered files name `branch-autodelete-check.mjs`.
- [auto] `node tools/install-check.mjs`, `node tools/drift-check.mjs --target .`, `node tools/leak-check.mjs`, `node tools/workflow-link-check.mjs` and `npm run build` pass; `node tools/leak-check.mjs` finds no project name in the new files.
- [human] In a project with `delete_branch_on_merge` on: a slot merge deletes nothing and reports nothing open. In a project with it off and no workflow: the agent deletes the branch and the summary has the one-line suggestion.

## Execution Mode

- Parallel: no (kit repo, solo flow)
- Concurrent plans: 030 and 031 edit `CHANGELOG.md`; plans 035 and 036 (PR #62, not yet merged) may touch `core/.claude/commands/ship.md` — check their scope at Step 0; whichever merges second rebases.
- Isolated DB: no

## Read-Write Scope

```scope
core/scripts/branch-autodelete-check.mjs
core/docs/agent/standards-git.md
core/docs/agent/ship-regular.md
core/docs/agent/ship-recovery.md
core/.claude/commands/ship.md
tools/install-check.mjs
tools/test/branch-autodelete-check.test.mjs
tools/fixtures/branch-autodelete/**
CHANGELOG.md
scripts/**
.claude/**
docs/agent/**
.kit/install.json
plans/037-*.plan.md
```

## Read Scope

Entire repo.

## Escalation Protocol

A file outside the scope is needed → STOP, name the file, the change and why; offer `approved: <path>`; append it to
the scope block; retry.

## Architecture Impact

- INV-none: preserves — a new read-only kit script (git remote, `gh api` GET, workflow files) and wording in agent
  docs; it never writes to the repo or its settings, and a project without `gh` keeps today's behaviour.

## Reuse Check

- Script shape — family: `core/scripts/github-sync-gate.mjs` and the other `gh`-reading kit scripts — rung: 2 — why: the same `spawnSync` + `GITHUB_TOKEN=` pattern, one more read-only question.
- Rendering — family: `tools/sync.mjs` managed files — rung: 2 — why: a file under `core/scripts/` is rendered to `scripts/` by the existing sync; the kit has no separate manifest for its own scripts.
- Doc wording — family: `standards-git.md` "Merging from a slot" — rung: 2 — why: one check inserted before an existing command, same block.

## Step 0 — Reality Check

`node scripts/scope-check.mjs --drift --plan=<this plan>`. Then grep the kit for every `push origin --delete` /
`--delete-branch` line and sort them: the merged-branch delete (changes) versus the rename delete in `ship-recovery.md`
(stays). Confirm that `tools/sync.mjs` renders a new `core/scripts/*.mjs` without any list to edit (it did for every
earlier script); if a list exists, add it to the scope through the Escalation Protocol.

## User Stories

- As the Human merging from a slot in a project whose repo deletes merged branches, the summary has no "could not
  delete the branch" loose end.
- As the Human in a project that deletes nothing, the branch is still removed and I see once how to let GitHub do it.

## Functional Requirements

1. **The check (A1).** `core/scripts/branch-autodelete-check.mjs`: read `origin` with `git remote get-url origin`
   (https and ssh forms → `owner/repo`); ask `gh api repos/<owner>/<repo> --jq .delete_branch_on_merge` with
   `GITHUB_TOKEN` cleared in the child's environment (`env: { ...process.env, GITHUB_TOKEN: '' }`); scan
   `.github/workflows/*.yml|yaml` for the four delete patterns. Print one line, exit 0 always: `auto (repo setting)`,
   `auto (workflow <file>)`, `manual`, `unknown (gh not installed)`, `unknown (gh: <first stderr line>)`,
   `unknown (no origin remote)`.
2. **Tests (A2).** `tools/test/branch-autodelete-check.test.mjs` with a scratch repo per case and a stub `gh` (and
   `git` where needed) on a `PATH` folder under `tools/fixtures/branch-autodelete/`; the hostile-text case puts
   `$(id)`, backticks and `;` into a workflow file and asserts the answer and that no extra process ran (the stub logs
   its calls).
3. **Wiring (A3).** `standards-git.md` "Merging from a slot": run the check first; the three outcomes as in Success;
   the `manual` suggestion line; the already-gone delete is not a loose end. `ship-regular.md`, `ship-recovery.md`,
   `ship.md`: the same sentence where the merged-branch delete is named. `install-check.mjs`: the four rendered files
   contain `branch-autodelete-check.mjs`.
4. **Changelog and render (A4).** `CHANGELOG.md` Unreleased → Added, two sentences, no project names.
   `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .`.

## UI/UX Notes

- None (kit tooling).

## Atomic Sub-tasks

- [x] A1: Add a kit check that says whether the repo already deletes merged branches, without touching anything — auto / manual / unknown, exit 0, gh api GET + workflow scan, spawnSync with argument arrays only — core/scripts/branch-autodelete-check.mjs
- [x] A2: Prove the three answers and that hostile workflow text never reaches a shell — scratch repos, stub gh/git on PATH, call log — tools/test/branch-autodelete-check.test.mjs, tools/fixtures/branch-autodelete/**
- [x] A3: Make the slot merge ask the check before deleting the branch and stop reporting an already-gone branch as open — standards-git.md "Merging from a slot", ship-regular.md, ship-recovery.md (rename delete unchanged), ship.md; manual-mode suggestion line; install-check asserts — core/docs/agent/standards-git.md, core/docs/agent/ship-regular.md, core/docs/agent/ship-recovery.md, core/.claude/commands/ship.md, tools/install-check.mjs
- [x] A4: Note the change in the changelog and render the kit's own copies — Unreleased Added; sync + drift-check — CHANGELOG.md, scripts/, .claude/, docs/agent/, .kit/install.json

## Technical Considerations

- Security surface: read-only. `gh api` GET on the repo, `git remote get-url`, and reading workflow files. No value
  from the repo (branch names, workflow text) is interpolated into a shell string; `spawnSync(cmd, args)` only.
- `GITHUB_TOKEN=` is cleared for the `gh` call so it uses the keyring credential (`standards-git.md` line on token
  precedence); the check must work with either credential since it only reads.
- Backend / API, auth and validation, data / migration: none (kit tooling).

## Out of Scope

- Changing the repo setting for the Human (the line is a suggestion; the agent never runs the PATCH).
- Detecting third-party apps that delete branches outside workflows and the setting (they read as `manual`; the
  delete is then a harmless no-op that GitHub rejects — still not reported as open).
- The non-slot merge (`gh pr merge --delete-branch` outside a slot already lets GitHub delete).

## Critical Questions

- Q: Why not always try the delete and swallow the error? A: the error text differs by git version and language; a
  check before the command is deterministic and gives the Human the suggestion in the `manual` case.
- Q: Why `unknown` → delete? A: that is today's behaviour; a missing `gh` should not change what the merge does.

## Execution Notes

- Origin (2026-10-29): received as an unnumbered draft (`plans/delete-the-merged-branch-….plan.md`, dropped in the
  Planner folder by another session) after a project's slot merge reported a rejected `git push origin --delete` as a
  loose end because the repo's `delete_branch_on_merge` had already removed the branch. Reviewed and saved as plan 037:
  the draft's "kit manifest" sub-task became a Step 0 confirmation (the kit renders `core/scripts/*` through
  `tools/sync.mjs` with no list to edit), its `## Done when` duplicate was folded into the Success Criteria, the fixture
  folder moved under `tools/fixtures/`, and the template sections it lacked were added. Numbers 035 and 036 are taken
  by PR #62 (`plan/move-skill-improver-and-scout`), which `next-plan-number.mjs` could not see because that branch
  name carries no plan number.
- Build (2026-10-29, branch `feat/037-delete-merged-branch-only-when-repo-does-not`): Step 0 drift was only plan 038
  (no scope file in common besides CHANGELOG/install-check); `tools/sync.mjs` rendered the new script with no list to
  edit. One change from the Success wording: a workflow counts as `auto` only when it also runs on `pull_request` /
  `pull_request_target`. Reason: every kit project ships `todo-sync.yml`, which deletes its own bot branch on `push`
  (`git push origin --delete`, `--delete-branch`); the plain pattern match would have read every kit project as
  `auto` and skipped the delete wrongly. A test case covers it. The `gh`/`git` stubs are the node binary linked into a
  scratch PATH folder with `tools/fixtures/branch-autodelete/stub.cjs` preloaded (works on Windows, where a shell-script
  stub cannot be spawned without a shell). Evidence: 5/5 tests pass; install-check, drift-check, leak-check,
  workflow-link-check and `npm run build` pass; on this repo the check prints `AUTODELETE: manual` (setting is `false`).
