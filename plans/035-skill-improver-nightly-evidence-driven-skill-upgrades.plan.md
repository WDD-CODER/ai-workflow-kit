# Plan 035 — Skill Improver: Nightly Evidence-Driven Skill Upgrades

Status: draft
Track: code — here (kit)
Snapshot: 8bb9b671a6391c43ac3f584064c8974544566135
Depends-on: none

Moved from FoodVibe plan 410 (2026-10-29): kit work lives in the kit repo.

## Problem Statement

Skills only improve when the Human notices a failure by hand. This plan adds a nightly local job that picks the skill
with the worst evidence from real sessions, writes a better version, proves it with a before/after eval graded by a
separate judge, and opens a PR **only when the new version scores higher**. The Human's only job: validate, then merge.

Decisions (the Human, 2026-10-17):

- **Budget:** hard cap **400k tokens per night**. Always 1 skill; a 2nd skill only when the 1st finished under 200k.
- **Runs on the Human's PC** (transcripts stay local). PC off → the job does not run and does **not** catch up later.
- **Kit-first, all skills:** the improver and its edits live in this repo; PRs go to the kit repo. A project gets the
  change through `kit-sync`. Start with the skills the first project uses (all kit-owned).
- The Scout (new Claude Code / community features) is a separate plan: 036.

Lessons kept from retired project plans: the editor must not grade itself → separate blind judge; prefer
machine-checkable assertions; keep a change only if the score rises. Dropped from them: a custom test-runner /
evaluator / 70-30 score (replaced by the built-in skill-creator `evals/evals.json` format) and a Stop-hook trigger
(replaced by a schedule).

**The kit is a public repo.** Raw transcript text, user quotes and project paths or names never reach a commit, PR
body or eval file. Evidence in the PR is counts plus generic one-line descriptions only, and passes `leak-check`
before push.

Checked on origin/main `8bb9b671` (2026-10-29): the kit has no `tools/skill-improver/`. The orchestrator run that
tried this plan in the first project stopped before S0 produced a result; nothing of it is built. `kit-sync` is in use
(kit v1.11.0), so the old prerequisite (projects on `kit-sync`) is met.

## Goals & Success Criteria

**Primary:** one skill per night gets measurably better, and the Human only validates and merges.

- [auto] Manual run `node tools/skill-improver/run.mjs --once` produces a kit PR `chore/skill-improve-<skill>-<date>` whose body has: evidence counts, the diff summary, before/after eval scores (after > before), and a 3-step "how to validate".
- [auto] A run whose candidate does not beat the old skill opens **no PR** and appends `no-change <skill> <before> <after> <reason>` to the local log.
- [auto] `node tools/skill-improver/run.mjs --target agent` exits 2 with `unknown target agent` (the core is ready for plans 047/048; this plan builds only `skill`), and a run prints `SKILL_IMPROVER: billing plan-limits` or `SKILL_IMPROVER: billing api-key` before its first model call.
- [auto] Budget: `--budget 20000` stops the run, prints `SKILL_IMPROVER: budget reached (N/20000)`, leaves no branch pushed.
- [auto] Path guard: a candidate diff touching anything outside `**/.claude/skills/<skill>/**` aborts with `SKILL_IMPROVER: out-of-scope <path>` and pushes nothing.
- [auto] Leak guard: `node tools/leak-check.mjs` passes on the diff and the PR body before every push.
- [auto] `node --test tools/test/*.test.mjs`, `node tools/install-check.mjs`, `node tools/workflow-link-check.mjs`, `node tools/drift-check.mjs --target .` and `npm run build` pass.
- [auto] `schtasks /query /tn "ai-workflow-kit skill-improver" /xml` shows a daily trigger and `StartWhenAvailable` false.
- [human] The Human receives one scheduled nightly PR, validates it in a project after `kit-sync`, and merges it.
- [human] After one month: a one-page review (adopted PRs, real tokens/night vs 400k, keep / tune / stop).

## Execution Mode

- Parallel: no (kit repo, solo flow)
- Concurrent plans: 036 also edits `CHANGELOG.md` and `README.md`; whichever merges second rebases. Other open kit plans that edit `tools/install-check.mjs` rebase the same way.
- Isolated DB: no

## Read-Write Scope

```scope
tools/skill-improver/**
core/.claude/commands/improve-skill.md
core/.claude/agents/skill-judge.md
kit-skill-improver.ps1
tools/install-check.mjs
tools/test/**
README.md
CHANGELOG.md
scripts/**
.claude/**
docs/agent/**
docs/brain/**
.kit/install.json
plans/035-*.plan.md
```

Per-user state lives under `~/.claude/skill-improver/` (never inside a repo).

## Read Scope

Entire repo; local transcripts `~/.claude/projects/*/*.jsonl` (read by the evidence script only, never copied).

## Escalation Protocol

A file outside the scope is needed → STOP, name the file, the change and why; offer `approved: <path>`; append it to
the scope block; retry. Registering the scheduled task changes the Human's machine: show the exact `schtasks` command
and wait for the Human's go.

## Architecture Impact

- INV-none: preserves — kit tooling plus a local scheduled task; no project app file, hook or settings file is touched.

## Reuse Check

- Evals — family: the skill-creator `evals/evals.json` format — rung: 1 — why: used as is; no new eval format.
- Isolation — family: the orchestrator's fresh-worktree pattern — rung: 2 — why: the runner creates a worktree of `origin/main` the same way, under `~/.claude/skill-improver/wt/`.
- Leak guard — family: `tools/leak-check.mjs` — rung: 1 — why: called as is on the diff and the PR body.

## Step 0 — Reality Check

`node scripts/scope-check.mjs --drift --plan=<this plan>`. Then:

0. Kit `main` clean and equal to `origin/main`; no open kit PR or branch with unmerged skill-improver work (a stale `wip/skill-improver` branch may exist — read it, do not build on it unless it is plainly this plan's start).
1. Spike (≤30 min, write findings into this plan): (a) `claude -p` headless with `--output-format stream-json` exposes per-turn token usage the runner can sum; (b) `--model` works per call; (c) `/skill-doctor` can run headless (`claude -p "/skill-doctor"`) — if not, the context-cost signal comes from SKILL.md size; (d) the skill-creator eval flow runs headless.
2. Confirm the transcript JSONL shape shows Skill tool calls and the user turns after them.
3. No per-turn token usage in (a) → STOP at S0, record the findings, escalate; do not build S1–S7.

## Design

Nightly flow (`tools/skill-improver/run.mjs`, Node — `pwsh` is not installed):

1. **Evidence (0 tokens, pure script):** `evidence.mjs` scans local transcripts since the last run → per skill: times fired, user corrections within 3 turns after it fired, retries or repeated tool failures, "should have fired" hits (trigger phrases from its description seen with no Skill call), SKILL.md size. Output: `~/.claude/skill-improver/evidence-<date>.json` (local only).
2. **Pick:** highest evidence score; ties → least recently improved; skip a skill with an open improver PR; pause entirely when ≥3 improver PRs are open unmerged (no pile-up).
3. **Isolate:** fresh `git worktree` of kit `origin/main` under `~/.claude/skill-improver/wt/` — never the kit checkout the Human works in.
4. **Evals:** use the skill's `evals/evals.json`; if missing, first write 3 generic eval cases derived from the evidence (no project names) — they become part of the PR.
5. **Edit (strong model):** `improve-skill.md` proposes the edit per the skill-authoring standard, only inside the skill folder.
6. **Judge (separate agent `skill-judge.md`, `model: {{models.review}}` — the review tier, default sonnet; never Haiku, the Human's standing rule for any judging role, 2026-10-22):** runs old vs new against the evals blind (no hypothesis, no diff); the runner computes scores.
7. **Decide:** after > before → path guard → leak-check → push branch → `GITHUB_TOKEN= gh pr create` on the kit repo. Else log `no-change`.
8. **Budget:** the runner sums stream-json usage across every call; at 400k it kills the child, writes `budget reached`, pushes nothing half-done.
9. **Delete/merge proposals:** a skill that fired 0 times in 30 days gets a one-line "consider removing/merging" note in the next PR body (never auto-deleted).

Expected cost: evidence 0; edit ~30–60k; evals 6 runs × ~20–40k → **~150–300k per skill**, so usually 1 skill a night, sometimes 2.

## Functional Requirements

### Must Have (P0)

- [ ] Evidence script, picker, isolated worktree, evals (existing or generated), editor, blind judge, decide/push, budget cap, path guard, leak guard, local log.
- [ ] `kit-skill-improver.ps1` (PowerShell 5) registers / removes the daily task, `StartWhenAvailable` false, runs only on AC power.
- [ ] PR body template: evidence counts, before/after, "how to validate" (a `kit-sync` dry-run into a project, then the eval prompts to try by hand).

### Won't Have (this plan)

- Cloud runs; edits to hooks, settings, AGENTS.md, commands or scripts; auto-merge; the Scout (plan 036).

## Atomic Sub-tasks

- [ ] S0: Check the plan is still right and test a headless run before building — Step 0 reality check + headless spike, findings written in this plan — plans/035-skill-improver-nightly-evidence-driven-skill-upgrades.plan.md
- [ ] S1: Count which skills get used and where they fail, from local transcripts — Evidence script over local transcripts (counts only, local output) — tools/skill-improver/evidence.mjs
- [ ] S2: Pick which skill to improve each night, pausing while a PR is open — Picker + rotation state + open-PR pause — tools/skill-improver/pick.mjs
- [ ] S3: Run each improvement in a sandbox with a budget cap and safety guards, built as a core that later plans reuse — `tools/skill-improver/lib/`: `budget.mjs` (sums stream-json usage per call, records tokens AND `total_cost_usd`, and the billing mode: `plan-limits` when Claude Code is signed in with the Claude plan, `api-key` when `ANTHROPIC_API_KEY` is set for the child; prints the mode before the first call), `worktree.mjs` (isolated worktree of `origin/main`), `guards.mjs` (path guard taking an allowed-path list per target, leak guard), `pr.mjs`, `log.mjs` (appends `{date, target, mode, usd, tokens, result}` to `<home>/.claude/skill-improver/spend.jsonl`); `run.mjs --target skill` (the only target in this plan; any other target → exit 2 `unknown target <t>`) — plans 047 (`--target learn`) and 048 (`--target agent`) add targets without rewriting the core — tools/skill-improver/run.mjs, tools/skill-improver/lib/**
- [ ] S4: Let one agent improve a skill while a separate blind judge scores it — Editor command + blind judge agent (`model: {{models.review}}`; `install-check` asserts the rendered judge is not Haiku) + eval generation for skills without evals — core/.claude/commands/improve-skill.md, core/.claude/agents/skill-judge.md, tools/install-check.mjs
- [ ] S5: Open a PR with each night's skill improvement — PR creation + body template — tools/skill-improver/pr.mjs
- [ ] S6: Schedule the nightly run and document it — Scheduler script (PS5; daily at 02:10 by default, so plan 047's kit-learn run at 03:10 follows it) + README/CHANGELOG section + install-check strings + tests — kit-skill-improver.ps1, README.md, CHANGELOG.md, tools/install-check.mjs, tools/test/skill-improver.test.mjs
- [ ] S7: Try a full run by hand, including the budget stop and the safety stop — Manual end-to-end run on one kit-owned skill + budget-stop test + out-of-scope test — kit repo
- [ ] S8: Turn on the nightly schedule after the Human's go and receive the first PR — Register the task (the Human's go), receive one nightly PR — local machine
- [ ] S9: Render the kit's own copies, check drift, release, and bring the improver into the first project — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .`, kit PR + release, then `kit-sync` in the project (runs in that project, shipped with its own workflow) — .claude/**, docs/agent/**, .kit/install.json
- [ ] S10: Review after one month whether the improvements helped — One-month review (2026-11-17 or later) — plans/035-skill-improver-nightly-evidence-driven-skill-upgrades.plan.md

## Technical Considerations

- Dependencies: `tools/leak-check.mjs`, `tools/sync.mjs`, `tools/drift-check.mjs`, the skill-creator eval format.
- New files needed: `tools/skill-improver/*`, `core/.claude/commands/improve-skill.md`, `core/.claude/agents/skill-judge.md`, `kit-skill-improver.ps1`.
- Backend / API: none.
- Auth and validation: none; `gh` runs as the Human with `GITHUB_TOKEN=` cleared so the full-scope keyring credential is used.
- Security surface: reads local transcripts (never copied, never committed); pushes only inside the skill folder after the path and leak guards; registers a scheduled task on the Human's machine only after a go.
- Data / migration: none.

## Out of Scope

The weekly Scout and its HTML page (plan 036); cloud runs; auto-merge.

## Execution Notes

- Carried from the first project's orchestrator readiness (2026-10-29): S8 (scheduled task) and S10 and both `[human]` Done-when items → the nightly job is intentionally not running; they stay open, no task is registered, the plan stays open after the auto items.
- Carried: S7's test skill and PR → pick one kit-owned skill; open the PR only if after > before; keep the 400k cap.
- Carried: kit checkout work happens in a fresh worktree of `origin/main` on `feat/035-skill-improver`; never in a dirty checkout.
- Amended 2026-10-30 before building, for plans 047 (nightly kit-learn) and 048 (eval-gated agent improver), which
  reuse this runner: S3 builds a reusable core (`lib/`) with a `--target` switch; the budget meter records tokens,
  dollars and the billing mode, so the Human can see and control what every nightly job costs; the judge runs on the
  review tier, never Haiku (the Human's standing rule for judging roles); the nightly slot is 02:10 so 047's 03:10 run
  follows. Nothing else in the plan changed.
