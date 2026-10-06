# AGENTS.md — {{project.name}} (tool-agnostic)

Single source of truth for hard rules and skill triggers. Both agents defer here.

## Hard rules

- Never write on `{{git.mainBranch}}` — except the Planner committing `plans/*.plan.md` + `.claude/todo.md`. All code goes through a `feature/`/`fix/`/`chore/` branch (Worker slots use `feat/NNN-<slug>`).
- `npm run {{commands.build}}` must pass before any commit.
<!-- PACK:hard-rules -->
- Secrets live in `.env` only. Never read, print, hardcode, or commit them.
- Browser tool: {{tools.browser}}. Default: hand the Human a numbered click/check list for multi-step UI checks; do single-step cheap checks yourself (DB query, log read, one screenshot).
- Compaction: on a context-full warning, state open signals/todos in chat, then prefer `/compact focus on <current job + open signals>`; between unrelated tasks prefer `/clear` + session-state reload.
- **Job validation (all agents):** A job is not done until every Done-when item is validated — `[auto]` by agent evidence, `[human]`/untagged by the Human; never self-mark `[human]` items or skip marking with "Contractor does not mark." Full procedure: `docs/agent/job-validation.md`.
- **Plan Contracts (all agents):** A pasted/approved big plan must be persisted under `plans/` via `.claude/skills/save-plan/SKILL.md` before milestone execution. Mid-brief new tasks append to that plan's Atomic Sub-tasks (and `.claude/todo.md` — Planner only).
- **Planner-Worker workflow:** Planner (main, on `{{git.mainBranch}}`) writes/pushes `plans/*.plan.md` + `.claude/todo.md` directly; Workers use slots `{{slots.nameFormat}}` (frontend port {{slots.fePorts}}+N, backend {{slots.bePorts}}+N; `{{git.mainBranch}}` = {{slots.fePorts}}/{{slots.bePorts}}), writing only inside their plan's `## Read-Write Scope`. Hotspots (`{{paths.hotspots}}`) are append-only; Workers never write `.claude/todo.md`; `--no-verify` push to `{{git.mainBranch}}` is human-only. Rest: `docs/brain/decisions/0009-planner-worker-worktrees.md`.
- **Architecture invariants (`docs/brain/invariants.md`):** every plan fills `## Architecture Impact`. Any question to the Human whose answer could break an invariant is asked as: INV-n · current rule · proposed change · who loses what. A yes becomes an ADR (supersede) plus an `Arch-approved:` line, never only a session-state/commit note. Agents never write `Arch-approved:` without the Human's explicit `approve arch change INV-n` in chat. Blocking is bypassed only by that explicit Human approval.
- **Worker blocked outside scope (including an unmet plan Prerequisite):** offer `approved: <path>` first — per the plan's Escalation Protocol — never conclude unprompted that "this needs its own plan." That costs a full Planner round trip; a one-line `approved:` reply does not.

## Compact instructions

Preserve across `/compact`: current plan number + branch, open todos, and any failing checks.

## Job validation (all agents)

`[auto]` items self-verify by agent evidence (exact output/exit code/build pass — only the plan author tags `[auto]`); `[human]`/untagged need the Human. Counts: `/ship` **Y**/`--yes`, `done`/`verified`/`approved`, `/done`. Doesn't: `thanks`/`ok`/silence/CI green alone. Full procedure: `docs/agent/job-validation.md`.

## Skill triggers

| Trigger | File |
| --- | --- |
<!-- PACK:skill-triggers -->
| After a hacky fix, or duplicate/special-case logic appears | `.claude/skills/elegant-fix/SKILL.md` |
| Session start or after time away (once/day) | `.claude/skills/github-sync/SKILL.md` |
| Before dev server / browser / database workflows | `.claude/skills/preflight/SKILL.md` |
| "save the plan" or pastes a Plan Contract to execute | `.claude/skills/save-plan/SKILL.md` (+ `scripts/plan-name-similarity.mjs`) |
| Brief adds a new stage / review fallout task | Append `[ ]` to parent plan's Atomic Sub-tasks + `.claude/todo.md` first |
| Before PR, or "audit tech debt" | `.claude/skills/techdebt/SKILL.md` |
| Before a PR | `.claude/skills/update-docs/SKILL.md` |
| "execute plan NNN" inside a `{{slots.nameFormat}}` slot | `.claude/commands/take-plan.md` |
| "setup worktree" (one-time slot init, not per-plan) | `.claude/skills/worktree-setup/SKILL.md` |
| List skills / commands | `.claude/commands/skills.md` / `commands.md` |
| Finishing a feature | `/ship` — auto-classifies lane, commits/pushes, PRs only when feature-complete. Mandatory Post-push Merge Gate + brain capture: `docs/agent/standards-git.md`. |
| Job validation — finishing a job, marking todos `[x]`, or done/verified/approved | `docs/agent/job-validation.md` + `/done` |
| PR checks failing | `docs/agent/pr-check-fix-loop.md` (via `/fix-pr-checks`), 2 rounds max |
| Session start on unfamiliar work | `docs/brain/index.md`, then the relevant sub-file |
| Architectural choice | `docs/brain/invariants.md` first, then `docs/brain/decisions/`; supersede, never edit in place |
| Surprising behavior / a trap cost time | `docs/brain/gotchas.md` first |

## Standards index

| File | Load when |
| --- | --- |
<!-- PACK:standards-index -->
| `docs/agent/standards-security.md` | Auth, guards, interceptors, storage, crypto, security reviews |
| `docs/agent/standards-git.md` | Any git write; mandatory Post-push Merge Gate + brain capture |
| `docs/agent/brain-capture.md` | Writing a `docs/brain/` entry — shapes, usefulness gate |
| `docs/agent/job-validation.md` | When a job is done; marking todos `[x]` |

Stack: `{{paths.sharedDocs}}/tech-stack.md`.
