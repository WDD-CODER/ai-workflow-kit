# {{project.name}} Workflow — Planner and Workers

One Planner in the main folder plans; Workers in permanent slots build; the Human Director decides and merges.
The Planner is the Architect and the Product Manager: every plan it saves, its own or one drafted elsewhere, gets the
Architect + PM review in `.claude/commands/plan.md` before it is saved.

## Roles (Planner-Worker workflow)

| Role | Where | Job |
|---|---|---|
| **Planner** (Architect + Product Manager) | Main folder, checked out on `main` | Scopes with the Human, runs the Architect + PM review on every plan it saves, then writes and pushes Plan Contracts (`plans/NNN-slug.plan.md`) + `.claude/todo.md` directly to `main` — the one admin-bypass write, enforced by `scripts/branch-guard.sh` + `.husky/pre-push`. |
| **Worker** | One of {{slots.count}} permanent slots — `{{slots.nameFormat}}` for N = 1..{{slots.count}} (ports {{slots.fePorts}}+N / {{slots.bePorts}}+N) | Claims a plan via "execute plan NNN", executes its milestones on `feat/NNN-<slug>`, may write only inside that plan's `## Read-Write Scope`. |
| **Reviewer** | `/review-it` (either tool) | Report-only by default. Never silently fixes. |
| **Human Director** | You | Answers the Planner's questions, assigns plans to slots, approves ships/merges, the only `--no-verify` override. |
| **Drafting tool** (optional) | Claude.ai, Cursor or another agent | May draft a plan or brief. It cannot see the current code, so the Planner reviews the draft against the codebase and shows the gaps before saving. |

## Role flexibility / cost routing

The tool behind each role is a default, not a hard lock. The Human Director can explicitly move work to
whichever tool has budget:

- Ask **Claude Code** to implement, plan, or mark a verified milestone done.
- Ask **Cursor** to review or draft a plan when that is cheaper or more convenient.
- Use **Claude.ai** to think a plan through in chat; paste the draft into the Planner, which reviews and saves it.

Rules of thumb:
- Explicit Human override wins for that request only.
- Whoever drafts, the Planner's Architect + PM review runs before a plan is saved.
- `/review-it` stays report-only (no silent fixes) unless Human also asks for fixes.
- Git stays Human-first: agents prepare; commit/push only on explicit ask + approval.
- Stack and path-scoped rules (`{{paths.sharedDocs}}/tech-stack.md`, `docs/agent/`) still apply
  no matter which tool is executing.

## Day-to-day loop

1. Plan in the main folder: `/plan` (or paste a draft) → Architect + PM review → push
   (`.claude/commands/plan.md` Planner protocol).
2. In a free slot, say "execute plan NNN" (`.claude/commands/take-plan.md`).
3. Worker executes the plan's milestones, then `/review-it`, then `/ship` (PR).
4. The Human merges the PR; the slot releases automatically the next time it's taken.
5. Back to the Planner for the next plan.

## Authoritative files

- Planning (roles, review, Planner protocol): `.claude/commands/plan.md`
- Reviewer rules (default + overrides): `CLAUDE.md`
<!-- KIT:if kit.cursor -->
- Contractor rules (Cursor layer, default + overrides): `.cursor/rules/contractor-role.mdc`
<!-- KIT:end -->
- Stack: `{{paths.sharedDocs}}/tech-stack.md`
- Current state capsule: `{{paths.sharedDocs}}/current-state.md`
- Path-scoped standards: `docs/agent/`
- Review command: `.claude/commands/review-it.md`

## What retired

Team Leader as execution dispatcher, the Architect and Product Manager agent personas (their work is the
Planner's review in `/plan`), MemPalace, retired `/plan-implementation` and `/execute-it` (use `/feat` →
`/plan` → Worker → `/review-it` instead), nightly-audit/reflect cron automation, end-of-session 14-phase agent.

## Plan files

Plans live at `plans/NNN-slug.plan.md` (`NNN-R-slug.plan.md` for refactor variants); `save-plan` assigns the
number. Existing plans keep their names.
