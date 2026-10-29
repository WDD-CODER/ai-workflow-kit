# Plan 038 — A plan number counts plans on every branch, not only numbered branch names

Status: draft
Track: code — here (kit)
Snapshot: 504cefad6e32decbf0b8db1298012b963fd40eed
Depends-on: none

## Problem Statement

`scripts/next-plan-number.mjs` is the one place a new plan's `NNN` comes from. It takes the highest number across the
open plans in this checkout, the plans on `origin/main`, the main worktree, and every local or remote branch named
`<type>/NNN-<slug>`. It does not look at the plan **files** on other branches. Two plans (035, 036) saved on the branch
`plan/move-skill-improver-and-scout` (PR #62) were invisible to it, and the Planner session was handed 035 for a
third plan on the same day; the collision was caught by hand (`gh pr view 62 --json files`), and the plan became 037.
A branch name without a number — `plan/<slug>`, `chore/<slug>`, a release branch — is a normal thing to carry plan
files, so the number must come from the files, wherever they are.

## Goals & Success Criteria

**Primary:** a plan file on any local or remote branch takes its number, whatever the branch is called.

- [auto] `node --test tools/test/next-plan-number.test.mjs` passes: in a scratch repo with a bare origin, `plans/001-a.plan.md` on `main`, a remote-only branch `plan/two-plans` holding `plans/040-b.plan.md` and `plans/041-c.plan.md`, and a local branch `feat/012-x` with no plan files, the script prints `042`; with the remote branch deleted it prints `013`; a plan file under `plans/done/` on a branch counts too (the max is what matters); `--no-fetch` skips the fetch and still reads the remote-tracking refs it has.
- [auto] `node tools/install-check.mjs`, `node tools/drift-check.mjs --target .`, `node tools/leak-check.mjs` and `npm run build` pass; `core/.claude/skills/save-plan/SKILL.md` Phase 1 names "every plan file on any local or remote branch" in its description of the script.

## Execution Mode

- Parallel: no (kit repo, solo flow)
- Concurrent plans: 030, 031 and 037 edit `CHANGELOG.md`; whichever merges second rebases.
- Isolated DB: no

## Read-Write Scope

```scope
core/scripts/next-plan-number.mjs
core/.claude/skills/save-plan/SKILL.md
tools/test/next-plan-number.test.mjs
tools/install-check.mjs
CHANGELOG.md
scripts/**
.claude/**
.kit/install.json
plans/038-*.plan.md
```

## Read Scope

Entire repo.

## Escalation Protocol

A file outside the scope is needed → STOP, name the file, the change and why; offer `approved: <path>`; append it to
the scope block; retry.

## Architecture Impact

- INV-none: preserves — a read-only kit script reads more refs; no project app file, no write.

## Reuse Check

- Reading plans from a ref — family: the script's own `git ls-tree -r --name-only origin/main -- plans/` line — rung: 2 — why: the same call per ref, same `planRe`.
- Ref list — family: the script's own `for-each-ref` call — rung: 2 — why: the names it already has are the refs to read.

## Step 0 — Reality Check

`node scripts/scope-check.mjs --drift --plan=<this plan>`. Re-read `core/scripts/next-plan-number.mjs` (30 lines) and
`core/scripts/lib/plan-paths.mjs` `listOpenPlans`.

## User Stories

- As the Planner, the number I am handed is free even when a colleague's or another session's plan sits on a branch
  without a number in its name.

## Functional Requirements

1. **Read plan files on every ref (A1).** After the branch-name `take`, for every name from the existing
   `for-each-ref` call except `origin/HEAD` and `origin/main` (already read): `take(git(['ls-tree', '-r',
   '--name-only', name, '--', 'plans/']).split('\n'), planRe)`. One git call per branch; a repo with tens of branches
   pays well under a second, and the fetch it already does costs more. Update the header comment: "a plan file on any
   local or remote branch".
2. **Test (A2).** `tools/test/next-plan-number.test.mjs`: copy the installed `scripts/` into a scratch repo (as
   `tools/test/orchestrator-folders.test.mjs` does), bare origin, the branches from Success; run the script with
   `execFileSync(process.execPath, [script])` from the scratch root and compare stdout.
3. **Docs and changelog (A3).** `save-plan/SKILL.md` Phase 1 "Number": add "and every plan file on any local or remote
   branch — a `plan/<slug>` branch without a number carries plans too". `tools/install-check.mjs`: the rendered
   `save-plan/SKILL.md` contains that phrase. `CHANGELOG.md` Unreleased → Fixed, two sentences, no project names.
4. **Render (A4).** `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .`.

## UI/UX Notes

- None (kit tooling).

## Atomic Sub-tasks

- [ ] A1: Count the plan files on every local and remote branch when choosing the next plan number, so a plan on an unnumbered branch is never handed out twice — ls-tree per ref from the existing for-each-ref list, planRe, header comment — core/scripts/next-plan-number.mjs
- [ ] A2: Prove it with a scratch repo where a remote-only unnumbered branch holds two plans — 042 with the branch, 013 without, done/ plans count, --no-fetch — tools/test/next-plan-number.test.mjs
- [ ] A3: Say it in the save-plan skill and the changelog — Phase 1 Number sentence, install-check assert, Unreleased Fixed — core/.claude/skills/save-plan/SKILL.md, tools/install-check.mjs, CHANGELOG.md
- [ ] A4: Render the kit's own copies and check drift — scripts/, .claude/, .kit/install.json

## Technical Considerations

- `for-each-ref` over `refs/heads` and `refs/remotes/origin` already lists every ref the script may read; nothing new
  is fetched. A ref whose tree has no `plans/` folder returns an empty list.
- A plan on a fork's branch, or on a remote other than `origin`, is still invisible — out of scope, as today.
- Security surface, backend / API, auth, data: none (kit tooling, read-only git).

## Out of Scope

- Reading open pull requests through `gh` (a branch is enough; the PR's branch is on `origin`).
- Reserving a number before the plan is written.

## Critical Questions

- Q: Why not require a number in every branch name instead? A: `/plan` saves on `main`, release branches and `plan/<slug>` branches are legitimate, and a rule nobody enforces is not a fix.
- Q: Does one `ls-tree` per branch slow `save-plan`? A: tens of calls at a few milliseconds each; the `git fetch` the script already runs dominates.

## Execution Notes

- Origin (2026-10-29): plans 035 and 036 on `plan/move-skill-improver-and-scout` (kit PR #62) were not counted;
  `next-plan-number.mjs` offered 035 for the plan that became 037. Caught by hand.
