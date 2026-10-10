---
name: save-plan
description: Persists a Plan Contract to `plans/NNN-slug.plan.md` with the name-similarity gate, shape lint, architecture gate, ledger sync and (Planner only) commit + push to {{git.mainBranch}} with verification. Use when the user says "save the plan" / "save plan", pastes or approves a Plan Contract or big plan (Milestones, Atomic Sub-tasks, Goals), says "here is the plan" / "execute this plan", or when `/plan` or Cursor plan mode produced a contract that is not yet under `plans/`. Runs before any milestone execution.
allowed-tools: Bash(node scripts/plan-name-similarity.mjs *) Bash(node scripts/next-plan-number.mjs *) Bash(node scripts/todo-query.mjs *) Bash(node scripts/scope-check.mjs *) Bash(git branch *) Bash(git rev-parse *) Bash(git ls-tree *) Bash(git fetch *)
---

# save-plan

A plan is not real until it is on disk under `plans/` — and, for the Planner, until it is on `origin/{{git.mainBranch}}`, because a Worker's `take-plan.mjs` reads only `origin/{{git.mainBranch}}`. Everything below exists to make that true without reusing a number, duplicating a plan, or shipping a plan a Worker cannot take.

**Who am I?** `git branch --show-current` on `{{git.mainBranch}}` in the main folder = **Planner**. Inside a `{{slots.nameFormat}}` slot (`.worktree-root` exists) = **Worker** saving mid-brief. The two differ in Phases 1 and 3; everything else is shared.

## Checklist — copy into your reply and tick

```
save-plan:
- [ ] 0 similarity: node scripts/plan-name-similarity.mjs --name="<Display Name>" → no hits, or Human chose rewrite/new/cancel
- [ ] 1 number (Planner, save-as-new only): node scripts/next-plan-number.mjs → NNN
- [ ] 1 ledger (Planner): Atomic Sub-tasks appended to .claude/todo.md via todo-query.mjs append
- [ ] 2 shape: Read-Write Scope parses, exactly one Status:, Snapshot: present, every Done-when tagged [auto]/[human]
- [ ] 2 arch gate: node scripts/scope-check.mjs --arch --plan=<path> → exit 0
- [ ] 2 prerequisites (Planner): already true on origin/{{git.mainBranch}}, or split into NNN-1
- [ ] 3 written to plans/NNN-slug.plan.md (never ~/.cursor/plans/)
- [ ] 3 Planner: on {{git.mainBranch}} → commit plan + todo only → push → git ls-tree origin/{{git.mainBranch}} prints the path
- [ ] 4 completion line printed
```

## Plan rules (what a saved plan looks like)

- Path `plans/<NNN>-<slug>.plan.md`, H1 `# Plan NNN — <Human Title>` (the title drives similarity — make it describe the work). Refactor variant: `NNN-R`.
- `## Read-Write Scope` in a shape `scripts/lib/plan-scope.mjs` parses: a fenced ```` ```scope ```` block, one glob per line, **or** a `**Scope:**` line followed by bullets whose first token is a `` `backticked` `` glob. A bare `scope` line or un-backticked bullets are not parsed and `take-plan` refuses the plan.
- Exactly one `Status:` line (`Status: draft` for new; `take-plan` sets `active`; after the merge the todo-sync workflow's `plan-close.mjs` sets `done` and moves the plan into `plans/<range>/`). One `Snapshot:` line (filled in Phase 3).
- Every Atomic Sub-task is `[ ] <what> — <target file(s)>`.
- Every Done-when item starts with `[auto]` or `[human]`. `[auto]` means the expected output is exact — a string, an exit code, `npm run {{commands.build}}` passing, deterministic CLI output. `[human]` is visual/UI judgement, live interaction, product decisions; untagged counts as `[human]`. A UI-touching plan whose only Done-when is `[auto] npm run {{commands.build}}` is under-specified — add a `[human]` item. Only the plan author tags; agents never promote to `[auto]`.
- Medium/large plan touching auth or storage → a one-line security-surface note; `scripts/pre-commit-security-grep.mjs` is the gate.

## Phase 0 — similarity gate (always)

1. Extract the display name from the H1 / `name:` / first heading; derive the kebab-case slug.
2. `node scripts/plan-name-similarity.mjs --name="<Display Name>"`
3. `no similar plans` → go on, do **not** ask rewrite/new/cancel. `similar plan(s)` → paste the script output and ask exactly:

```text
Similar plan(s) found — validate:
- <path> — <title>
  why: similar because name shares: <tokens>
  excerpt: <one short line>

Reply: rewrite existing | save as new | cancel
```

- **rewrite existing** → overwrite that path, sync its Atomic Sub-tasks + `.claude/todo.md`, no new `NNN`.
- **save as new** → continue; before the Write put the relative path in `.claude/.plan-write-ack` (one line, e.g. `plans/291-foo.plan.md`) so the PreToolUse guard allows the create.
- **cancel** → stop, write nothing, execute nothing.

## Phase 1 — number + ledger (Planner only)

A Worker never assigns `NNN` and never touches `.claude/todo.md` (it is Planner-owned; `todo-query.mjs sync --merged` collects the Worker's plan-file changes after merge).

- **Number (save-as-new):** `node scripts/next-plan-number.mjs`. The script's number wins even when the pasted H1 already carries one (an Architect drafting in chat cannot see Workers' open branches) — rename the H1 and tell the Human in the completion line. It fetches, then takes the highest number across local plans, `origin/{{git.mainBranch}}` plans, the main worktree, and every local/remote `<type>/NNN-*` branch — a Worker's open branch whose plan you cannot see yet — plus 1. Never count `plans/` by hand; that is exactly how a number got reused. Re-run right before the write if anything else saved a plan meanwhile.
- **Ledger:** don't read `.claude/todo.md` in full. Extract the Atomic Sub-tasks into a temp file and `node scripts/todo-query.mjs append --from <file>` (it inserts under `### Plan NNN — <Title>` before the footers). Then `node scripts/todo-query.mjs open` — unrelated open items get surfaced, not silently buried.

## Phase 2 — lint the draft (cheap here, expensive in a slot)

- **Shape:** scope block parses; one `Status:`; a `Snapshot:` line exists (may be empty until Phase 3); Done-when tags present.
- **Coverage:** every requirement in the plan has an Atomic Sub-task.
- **Architecture gate:** `node scripts/scope-check.mjs --arch --plan=<path>` must exit 0 (`ARCH: ok …` or `ARCH: skipped …`). A crash that is environmental (`Cannot find package 'picomatch'` → `node_modules` missing, run `npm ci`) is not a gate result — fix the environment and re-run; do not reason the gate out by hand. It fails when the scope touches an invariant in `docs/brain/invariants.md` with no `## Architecture Impact` line, or a `deviation`/`changes` line lacking `Arch-approved: Human YYYY-MM-DD` or a valid ADR. Fix the draft. Only the Human's literal `approve arch change INV-n` in chat allows an `Arch-approved:` line — never write one on your own.
- **Prerequisites (Planner):** if the draft has `## Prerequisites`, verify each is already true on `origin/{{git.mainBranch}}` *now*. A tiny Planner-owned fix (a few lines) → land it as its own chore commit first. Anything bigger → save it as its own plan `NNN-1`, sequenced before this one. A Worker must never take a plan with a gate it cannot clear itself.

## Phase 3 — write, and (Planner) commit + push + verify

- `Snapshot:` = `git rev-parse origin/{{git.mainBranch}}` when the draft left it empty; never overwrite a SHA the Architect filled in. If `origin/{{git.mainBranch}}` cannot be resolved (no remote, fetch failed), leave it empty and say so — a local `HEAD` SHA is not what the Worker's drift check compares against, and substituting it hides the problem.
- Write the file (rewrite → existing path; new → `plans/<NNN>-<slug>.plan.md`). Never under `~/.cursor/plans/`.
- Not in a worktree and the plan changes code → suggest a `feat/` branch for whoever executes it.

**Planner only:**

1. `git branch --show-current` **immediately before committing** — if it is not `{{git.mainBranch}}` (e.g. `branch-guard.sh` auto-switched to `feat/session-*`), `git checkout {{git.mainBranch}}` first. Catch it here, not after.
2. `git add` the plan file and `.claude/todo.md` only (never `-A`), commit. This is the Planner's admin write to `{{git.mainBranch}}` (`AGENTS.md` Planner-Worker bullet; enforced by `scripts/branch-guard.sh` and `.husky/pre-push`).
3. `git push origin {{git.mainBranch}}`. Blocked, rejected or non-zero → **stop**; surface the blocker and ask. Do not tell the Human the plan is ready.
4. `git fetch origin --quiet` then `git ls-tree origin/{{git.mainBranch}} --name-only -- plans/<NNN>-<slug>.plan.md` must print the path. Empty → the push did not land; stop and investigate.

A Worker saving mid-brief does not commit here — its plan-file change rides its `feat/NNN-*` branch at `/ship`.

## Phase 4 — completion line

```text
Plan saved: plans/<NNN>-<slug>.plan.md
Ledger updated. Similarity: <none | rewrite | save-as-new>
```

then, **Planner:** `Plan NNN pushed. Open a free slot and say: execute plan NNN.` — the Planner never starts execution, even for a one-milestone plan. **Worker / anywhere else:** `Ready to execute Task 1: [Task Name].`

## After the save — keeping the plan live

Briefs executed from a saved plan must keep the plan file current (new sub-tasks appended *before* the work, `[x]` only after validation per `docs/agent/job-validation.md`). The Planner/Worker split for that is in [reference/mid-flight-sync.md](reference/mid-flight-sync.md) — read it when a brief adds a stage, a review produces fallout, or you are marking items done.
