# {{project.name}} Workflow — Three-Agent Manual Bridge

## Roles (Planner-Worker workflow)

| Role | Where | Job |
|---|---|---|
| **Planner** | Main folder, checked out on `main` | Plans. Writes and pushes Plan Contracts (`plans/NNN-slug.plan.md`) + `.claude/todo.md` directly to `main` — the one admin-bypass write, enforced by `scripts/branch-guard.sh` + `.husky/pre-push`. |
| **Worker** | One of 3 permanent slots — `{{slots.nameFormat}}` ({{slots.fePorts}}+1/{{slots.bePorts}}+1), `{{slots.nameFormat}}` ({{slots.fePorts}}+2/{{slots.bePorts}}+2), `{{slots.nameFormat}}` ({{slots.fePorts}}+3/{{slots.bePorts}}+3) | Claims a plan via "execute plan NNN", executes its milestones on `feat/NNN-<slug>`, may write only inside that plan's `## Read-Write Scope`. |
| **Reviewer** | `/review-it` (either tool) | Report-only by default. Never silently fixes. |
| **Human Director (Dandan)** | You | Assigns plans to slots, approves ships/merges, the only `--no-verify` override. |

## Role flexibility / cost routing

Pools A / B / C are **defaults for cost control**, not hard locks. The Human Director
can explicitly collapse roles into whichever pool has budget:

- Ask **Claude Code (C)** to implement, plan, or mark a verified milestone done when
  Pool C has tokens and B/A do not.
- Ask **Cursor (B)** to review or plan when that is cheaper or more convenient.
- Keep **Architect on Claude.ai (A)** for heavy planning when flat-rate budget is open.

Rules of thumb:
- Explicit Human override wins for that request only.
- `/review-it` stays report-only (no silent fixes) unless Human also asks for fixes.
- Git stays Human-first: agents prepare; commit/push only on explicit ask + approval.
- Stack and path-scoped rules (`/_shared/tech-stack.md`, `.claude/rules/`) still apply
  no matter which pool is executing.

## Day-to-day loop

1. Plan in the main folder → push (`.claude/commands/plan.md` Planner protocol).
2. In a free slot, say "execute plan NNN" (`.claude/commands/take-plan.md`).
3. Worker executes the plan's milestones, then `/review-it`, then `/ship` (PR).
4. Dandan merges the PR; the slot releases automatically the next time it's taken.
5. Back to the Planner for the next plan.

## Authoritative files

- Reviewer rules (default + overrides): `CLAUDE.md`
- Contractor rules (default + overrides): `.cursor/rules/contractor-role.mdc`
- Stack: `/_shared/tech-stack.md`
- Current state capsule: `/_shared/current-state.md`
- Path-scoped standards: `.claude/rules/{{{stack.name}},security,domain,backend}.md`
- Review command: `.claude/commands/review-it.md`

## What retired

Team Leader as execution dispatcher, MemPalace, retired `/plan-implementation` and
`/execute-it` (use `/feat` → `/plan` → Contractor → `/review-it` instead),
nightly-audit/reflect cron automation, end-of-session 14-phase agent. See PRD Appendix.

## Old vs new plans

Existing `plans/NNN-name.plan.md` files stay. New work uses `/plans/[feature]_v[N].md`.
