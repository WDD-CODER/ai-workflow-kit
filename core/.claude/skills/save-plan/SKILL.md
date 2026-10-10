---
name: save-plan
description: >
  Persist a Plan Contract to plans/ with name-similarity validation, ledger sync,
  and Human confirm on collisions. Use when the user pastes/approves a big plan,
  says save the plan, or any agent (Claude or Cursor) receives a Plan Contract to execute.
---

# Skill: save-plan

**Model Guidance:** Use Haiku/Flash for Phases 0–1 and 3. Use Sonnet for Phase 2 only when validating PRD alignment on a complex plan.

## Triggers (any agent — Claude Code or Cursor)

Run this skill **before executing milestones** when any of these is true:

- User says "save the plan" / "save plan" / confirms a plan and asks to persist it
- User pastes a **Plan Contract** / big plan (milestones, Atomic Sub-tasks, Goals)
- User says "here is the plan" / "execute this plan" / drops a plan body into chat
- Architect `/plan` or Cursor plan mode produced a contract that is not yet under `plans/`

**Hard rule:** Do not start Brief/milestone execution until the plan is on disk under `plans/` (or Human explicitly cancels save).

---

## Plan Rules (inline)

- Plan numbering: `node scripts/next-plan-number.mjs` (highest number used by any plan or `<type>/NNN-*` branch, + 1, zero-padded)
- Refactor variant suffix: `NNN-R`
- No plans yet → start at `001`
- Write to `plans/<NNN>-<slug>.plan.md` in project root only — never `~/.cursor/plans/`
- Preferred H1 shape: `# Plan NNN — <Human Title>` (name must describe the work — similarity depends on it)
- Todo / Atomic Sub-tasks sync happens as part of save (see phases)
- Every sub-task: `[ ] Brief description of target file(s)`
- Medium/Large plan touching auth/storage → note security surface
- Not on a worktree + plan involves code changes → suggest `feat/` branch checkout
- Every Done-when / Success Criteria item starts with `[auto]` or `[human]`. `[auto]` = the expected output is exact: an exact string, an exit code, a byte-identical diff, `npm run {{commands.build}}` or a test suite passing, or deterministic CLI output. `[human]` = visual/UI judgement, live interaction, subjective or design quality, product decisions. Untagged counts as `[human]`. A UI-touching plan whose only Done-when is `[auto]` `npm run {{commands.build}}` passes is under-specified — the planner must add a `[human]` item. Only the plan author tags; agents never promote an item to `[auto]`.

---

## Phase 0: Detect + Name Similarity Gate (mandatory)

1. Extract a **plan display name** from the H1 / YAML `name:` / first heading (e.g. `Project Memory Bank`).
2. Propose a slug: lowercase kebab-case from that name (e.g. `project-memory-bank`).
3. Run the shared checker (Claude and Cursor — same script):

```bash
node scripts/plan-name-similarity.mjs --name="<Plan Display Name>"
```

4. Interpret stdout:

| Result | Action |
| --- | --- |
| `no similar plans` | Proceed to Phase 1 — **do not** ask rewrite/new/cancel |
| `similar plan(s)` | **Stop.** Show Human a short validation block (below). Wait for answer |

### Human validation block (only when hits exist)

Copy the script output into chat, then ask exactly:

```text
Similar plan(s) found — validate:
- <path> — <title>
  why: similar because name shares: <tokens>
  excerpt: <one short line>

Reply: rewrite existing | save as new | cancel
```

- **rewrite existing** → Edit/overwrite the chosen existing path; sync its Atomic Sub-tasks + `.claude/todo.md`; do **not** allocate a new `NNN`.
- **save as new** → Continue Phase 1 with next `NNN`. Before Write, put the relative path in `.claude/.plan-write-ack` (one line, e.g. `plans/291-foo.plan.md`) so the PreToolUse guard allows the create.
- **cancel** → Stop. Do not write. Do not execute briefs.

---

## Phase 1: Ledger Sync

**Planner-only.** This phase (NNN assignment + `.claude/todo.md` append) runs only for the
Planner — main folder, checked out on `main`. A Worker inside a `{{slots.nameFormat}}` slot never assigns a
new `NNN` and never touches `.claude/todo.md`; see Phase 4 for what a Worker does instead.

Do not Read .claude/todo.md in full.

**Todo Update:** Extract `# Atomic Sub-tasks` (or equivalent checklist), write it to a temp file, and run `node scripts/todo-query.mjs append --from <file>` to insert it under `### Plan NNN — <Title>` before `.claude/todo.md`'s footers.

**Sub-task Formatting:** Every task `[ ]` with target file(s) when known.

**State Verification:** Run `node scripts/todo-query.mjs open` — if unrelated open tasks exist → surface them before proceeding.

**Numbering (save as new only):** run `node scripts/next-plan-number.mjs` and use the number it prints. It fetches, then takes the highest number used by local plans, `origin/{{git.mainBranch}}`'s plans, the main worktree's plans, and any local or remote `<type>/NNN-*` branch (a Worker's open branch whose plan you may not see yet), plus 1. Never compute `NNN` by hand from `plans/` alone — that is how a Worker's open branch number got reused. Re-run it right before the write if anything else saved a plan meanwhile.

---

## Phase 2: Logic Validation

**PRD Alignment:** Atomic sub-tasks cover the plan requirements — no requirement without a task.

**Risk Audit:** Medium/Large + auth/storage → note security surface; rely on pre-commit security grep + CI.

**Shape lint (mandatory before saving):** a Worker's `take-plan.mjs` refuses a plan without these, so check them here where the fix is cheap:

- `## Read-Write Scope` holds the globs in one of the two shapes `scripts/lib/plan-scope.mjs` parses: a fenced block opened with ```` ```scope ```` (one glob per line), or a `**Scope:**` line followed by bullets that each start with a `` `backticked` `` glob. A bare `scope` line, or bullets without backticks, are not parsed.
- Exactly one `Status:` line, with a value (`Status: draft` for a new plan; take-plan sets `active`; after the merge the todo-sync workflow's `plan-close.mjs` sets `done` and moves the plan into `plans/<range>/`).
- A `Snapshot:` line (see Phase 3) — the Worker's drift check compares against it.
- **Architecture gate (block):** `node scripts/scope-check.mjs --arch --plan=<path>` exits 0 (`ARCH: ok …`, or `ARCH: skipped …` for a grandfathered plan / no registry). It fails when the scope touches an invariant in `docs/brain/invariants.md` that has no `## Architecture Impact` line, or a `deviation`/`changes` line lacks `Arch-approved: Human YYYY-MM-DD` or a valid ADR. Fix the draft; only the Human's explicit `approve arch change INV-n` in chat allows an `Arch-approved:` line.

**Prerequisites Gate (Planner only):** If the draft has a `## Prerequisites` section, check it's already true against `origin/{{git.mainBranch}}` *before* saving — do not hand a Worker a plan that will STOP on take. If unmet:

- **Tiny, Planner-owned fix** (a few lines, no plan-worthy scope of its own) → land it directly as its own chore commit/PR to `{{git.mainBranch}}` now, then save this plan.
- **Anything bigger** → save the prerequisite as its own plan (`NNN-1`, sequenced before this one) instead of writing a Prerequisites gate that STOPs a Worker. A plan should never ship with a hard gate the Worker who takes it cannot clear itself.

---

## Phase 3: Write Plan File

**Worktree Verification:** If not on a worktree and plan involves code changes → suggest `feat/` branch checkout.

**Write:**

- rewrite → overwrite the existing plan path Human confirmed
- save as new → write `plans/<NNN>-<slug>.plan.md` (after `.claude/.plan-write-ack` if the write-guard may block)

Never write under `~/.cursor/plans/`. `Snapshot:` — every plan has one. Fill it with the current
`origin/{{git.mainBranch}}` SHA (`git rev-parse origin/{{git.mainBranch}}`) when the draft left it empty or has no
`Snapshot:` line at all; never overwrite a SHA the Architect already filled in.

**Pre-commit branch check (Planner only):** Run `git branch --show-current` immediately
before committing. If it is not `main` (or `master`) — e.g. `branch-guard.sh` mis-fired and
auto-switched to a `feat/session-*` branch — STOP before committing: `git checkout main`
first, so the commit lands directly on `main`. Do not commit on a stray branch and fix it
after; catch it here.

**Commit (Planner, on `main`, only):** `git add` only the plan file and `.claude/todo.md`
(never `-A`), then commit. This is the Planner's admin-bypass write to `main` — see
`AGENTS.md`'s Planner-Worker bullet, enforced by `scripts/branch-guard.sh` and
`.husky/pre-push`. A Worker saving mid-brief inside a `{{slots.nameFormat}}` slot does not commit here —
its commit happens at `/ship` time on its `feat/NNN-*` branch, plan file only (Phase 4).

**Push + Verify (Planner only, mandatory — do this before telling the Human the plan is
ready):**

1. `git push origin main`. If the push is blocked (permission prompt, rejected, or any
   non-zero exit) — STOP. Do not tell the Human to execute the plan yet; surface the
   blocker and ask for a decision first. A Worker's `take-plan.mjs` only reads
   `origin/{{git.mainBranch}}`, so an unpushed plan fails silently in the worktree instead of here where
   it's cheap to fix.
2. After a successful push, confirm it actually landed: `git fetch origin --quiet` then
   `git ls-tree origin/{{git.mainBranch}} --name-only -- plans/<NNN>-<slug>.plan.md` must print the path
   (non-empty). If empty, the push did not do what it looked like — STOP and investigate
   before announcing done.
3. Only once both checks pass does the Completion Gate's "Plan NNN pushed" line become true.

---

## Phase 4: Brief / mid-flight sync (ongoing — not only at save)

After the plan is saved, **any agent** executing a brief from it must keep the plan file live:

1. Brief must name its **parent plan path** (e.g. `plans/290-….plan.md`).
2. If review fail / fallout / Human adds a stage → **append** a new `[ ]` Atomic Sub-task
   (and milestone row if needed) **before** doing the new work.
   - **Worker (inside a `{{slots.nameFormat}}` slot):** append to the plan file **only**. Never touch
     `.claude/todo.md` — it is Planner-owned; the Planner's `todo-query.mjs sync --merged`
     picks this up once the branch merges.
   - **Planner (main folder, on `main`):** append to the plan file **and**
     `.claude/todo.md`, as before.
3. On validation per `docs/agent/job-validation.md` (Human reply, ship Y, or the Tier 1 auto path) → mark the matching item(s) `[x]`.
   - **Worker:** mark `[x]` in the plan file's own Atomic Sub-tasks only.
   - **Planner:** mark `[x]` in both the plan file and `.claude/todo.md` (see
     `docs/agent/job-validation.md`).

---

## Completion Gate

Output:

```text
Plan saved: plans/<NNN>-<slug>.plan.md
Ledger updated. Similarity: <none | rewrite | save-as-new>
```

Then the last line depends on who saved it:

- **Planner (main folder, on `main`):** `Plan NNN pushed. Open a free slot and say: execute plan NNN.`
  The Planner never starts execution itself, even for a one-milestone plan.
- **Worker (inside a `{{slots.nameFormat}}` slot) or anywhere else:** `Ready to execute Task 1: [Task Name].`
