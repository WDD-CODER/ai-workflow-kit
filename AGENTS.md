# AGENTS.md — ai-workflow-kit (tool-agnostic)

Single source of truth for hard rules and skill triggers. Both agents defer here.

## Hard rules

- **This is the kit repo, installed into itself — solo flow, no slots.** One folder: `/plan` saves and pushes the plan on `main`, then `git switch -c feat/NNN-<slug>` and build the plan here, then `/ship`. No `wt-N` slots, no `/take-plan`, no `.claude/todo.md`: the plan's own checkboxes are the record. `/ship` holds a `feat/NNN-<slug>` branch to plan NNN's Read-Write Scope.
- **Edit sources, never the installed copies.** `scripts/`, the commands, skills, agents, references and instructions under `.claude/`, `docs/agent/`, `docs/brain/` (managed files) and `README_WORKFLOW.md` are rendered from `core/`, `packs/`, `layers/`, `templates/`. Change the source, then `node tools/sync.mjs --target . --apply` in the same branch; CI `drift-check` fails otherwise. This repo's config is `.kit/config.json` (`kit.config.json` is the scaffold projects start from).
- Never write on `main` — except plans (`plans/*.plan.md`). All code goes through a `feat/`/`fix/`/`chore/` branch.
- `npm run build` must pass before any commit.
- Secrets live in `.env` only. Never read, print, hardcode, or commit them.
- Browser checks: hand the Human a numbered click/check list for multi-step UI checks; do single-step cheap checks yourself (DB query, log read, one screenshot).
- Compaction: on a context-full warning, state open signals/todos in chat, then prefer `/compact focus on <current job + open signals>`; between unrelated tasks prefer `/clear` and read the plan's Execution Notes.
- **Job validation (all agents):** A job is not done until every Done-when item is validated — `[auto]` by agent evidence, `[human]`/untagged by the Human; never self-mark `[human]` items or skip marking with "Contractor does not mark." When the work is finished and a `[human]` item remains: servers up (every page URL answers), HOW TO VALIDATE cards (plain terminal text, grouped by page, every value to type alone on its own line — English; the app's own language only as literal app data, with one line that opens every page), then wait for the Human's reply (it may come page by page: `ok: <numbers>`, `failed: <numbers>`; a failed card is fixed at once) — before `/ship`, a PR or a merge. Full procedure: `docs/agent/job-validation.md`.
- **Plan Contracts (all agents):** A pasted/approved big plan must be persisted under `plans/` via `.claude/skills/save-plan/SKILL.md` before milestone execution. Mid-brief new tasks append to that plan's Atomic Sub-tasks (and `.claude/todo.md` — Planner only).
- **Plan scope:** work on a plan branch writes only inside the plan's `## Read-Write Scope`; `--no-verify` push to `main` is human-only.
- **Architecture invariants (`docs/brain/invariants.md`):** every plan fills `## Architecture Impact`. Any question to the Human whose answer could break an invariant is asked as: INV-n · current rule · proposed change · who loses what. A yes becomes an ADR (supersede) plus an `Arch-approved:` line, never only a plan-note/commit note. Agents never write `Arch-approved:` without the Human's explicit `approve arch change INV-n` in chat. Blocking is bypassed only by that explicit Human approval.
- **Architect + PM review (Planner):** the Planner is the Architect and the Product Manager. Every plan the Planner saves — written here or received from Claude.ai, Cursor or another agent — gets `/plan`'s `## Architect + PM review (always)` before it is saved, plus this project's own checks in `docs/project/plan-checks.md` when that file exists. A received plan is reviewed, not silently rewritten.
- **Worker blocked outside scope (including an unmet plan Prerequisite):** offer `approved: <path>` first — per the plan's Escalation Protocol — never conclude unprompted that "this needs its own plan." That costs a full Planner round trip; a one-line `approved:` reply does not.

## Compact instructions

Preserve across `/compact`: current plan number + branch, open todos, and any failing checks.

## Job validation (all agents)

`[auto]` items self-verify by agent evidence (exact output/exit code/build pass — only the plan author tags `[auto]`); `[human]`/untagged need the Human. Counts: `done`/`verified`/`approved`, `/done`. Doesn't: `/ship` **Y**/`--yes` alone (commit consent), `thanks`/`ok`/silence/CI green alone. Full procedure: `docs/agent/job-validation.md`.

## Skill triggers

| Trigger | File |
| --- | --- |
| Session start or after time away (once/day) | `.claude/skills/github-sync/SKILL.md` (gate: `scripts/github-sync-gate.mjs`) |
| Before dev server / browser / database workflows | `.claude/skills/preflight/SKILL.md` (`node scripts/preflight.mjs`) |
| "save the plan" or pastes a Plan Contract to execute | `.claude/skills/save-plan/SKILL.md` (+ `scripts/plan-name-similarity.mjs`) |
| Brief adds a new stage / review fallout task | Append `[ ]` to parent plan's Atomic Sub-tasks first |
| Before PR, or "audit tech debt" | `.claude/skills/techdebt/SKILL.md` (+ `scripts/techdebt-report.mjs`) |
| "execute plan NNN" | Solo flow (hard rules above): `git switch -c feat/NNN-<slug>` from `origin/main`, run the plan's Step 0, build its sub-tasks here, then `/ship` |
| Changed a source under `core/`, `packs/`, `layers/`, `templates/` | `node tools/sync.mjs --target . --apply`, then `node tools/drift-check.mjs --target .` |
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
| `docs/agent/standards-security.md` | Auth, guards, interceptors, storage, crypto, security reviews |
| `docs/agent/standards-git.md` | Any git write; mandatory Post-push Merge Gate + brain capture |
| `docs/agent/brain-capture.md` | Writing a `docs/brain/` entry — shapes, usefulness gate |
| `docs/agent/job-validation.md` | When a job is done; marking todos `[x]` |

Stack: `docs/project/tech-stack.md`.
