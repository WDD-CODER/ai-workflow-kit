# Plan 047 — The learning loop runs by itself at night and earns autonomy per category: propose → draft → build → merge

Status: draft
Depends-on: 046, 035
Snapshot: a363b42

## Problem Statement

Plan 046 makes the kit's learning one command, but the Human still has to remember to run it, wait while it reads
code for every card, and decide every card by hand forever. The Human's goal (2026-10-30): semi-automatic at first —
he approves each step — and automatic later, as the loop proves itself.

Two ways this goes wrong elsewhere, both documented:
1. **Trust granted globally, not earned per kind.** Google's AutoCommenter stalled at ~54% usefulness with one global
   confidence threshold; suppressing 17 non-actionable rules and moving to per-rule thresholds reached the 80% target
   (arXiv 2405.13565). Tricorder disables any analyzer whose "not useful" rate passes 10% until it is fixed.
2. **Automation that can edit its own judges.** The Darwin Gödel Machine faked test logs and removed the markers used
   to catch it when they were in reach (arXiv 2505.22954).

So autonomy must be earned per category of change, measured from the Human's own decisions, capped by a ceiling the
Human sets, demoted automatically on a bad outcome, and never extended to the code that measures it.

## Goals & Success Criteria
**Primary:** every night the kit collects new evidence and prepares the cards on its own, so `/kit-learn` in the
morning shows ready cards with no waiting; each category of change moves up the ladder only when its numbers clear
the gate and the Human says yes; a bad outcome moves it down by itself.

The ladder (per category, stored in the brain `autonomy` collection, ceilings in `kit-learn.config.json`):

| Level | What the loop does by itself | The Human |
|---|---|---|
| L0 propose | collects, ranks, writes cards | decides every card in `/kit-learn` |
| L1 draft | takes its own recommendation and writes the artifact on a `learn/<date>-<issue>` branch, opens a kit PR | reviews and merges or closes the PR |
| L2 build | also builds it (the kit's own plan flow) with its regression test, CI green, opens the PR | merges or closes |
| L3 merge | merges after CI, the eval gate and a soak of `soakDays` with no new evidence against it | reads the morning line; can revert |

Categories and their **hard ceilings** (the Human can lower, never raise past these without editing this plan):
`lesson` (kit-lessons line) L3 · `eval-case` (a new eval case from kit code) L3 · `fixture` (test only) L2 ·
`plan-draft` / `amend` (plan files) L2 · `script-fix` (core/scripts, ≤3 files, with its regression test) L2 ·
`agent-prompt` (`core/.claude/agents/*.md`, only through plan 048's eval gate) L2 · `workflow-code`
(`orchestrate.js`, commands, settings, hooks) L1 · `protected` (plan 046 K10 paths) L0.

- [auto] `node tools/kit-learn.mjs autonomy` prints per category: level, ceiling, decided at this level, accepted
  unedited %, rejected/reverted % over the last 30, regressions, and `eligible for L<n+1>` or the gate it misses.
- [auto] Promotion gates (tested with fixture `proposals`): L0→L1 needs ≥20 decided proposals in the category and
  ≥80% accepted as recommended, unedited; L1→L2 ≥30 PRs at L1, ≥80% merged unedited, ≤10% closed or reverted, every
  one with its regression test; L2→L3 ≥60 merged at L2 with 0 reverts and 0 regressions (rule of three: 0 failures
  in 60 bounds the true rate under 5% at 95%), and the category's ceiling allows L3. A category that clears a gate is
  **proposed** (`promote? <category> L1 → L2`); it moves only on the Human's `promote <category>` in `/kit-learn`.
- [auto] Demotion (no Human step): a revert of a loop-made change, a regression of an issue the loop fixed, or >10%
  closed/reverted over the rolling 30 → the category drops one level, a `proposals` row records why, and the next
  `/kit-learn` shows it first. Two kit versions in a row with a worse KPI line (046 K11: minutes lost per run or
  parked per run up by >20%) → every category above L0 drops one level.
- [auto] `node tools/kit-learn.mjs nightly --dry-run --driver <stub> --claude <stub>`: runs `collect` (keeps the Atlas
  cluster from its 30-day idle pause), then, only if there is new evidence and budget, one headless card session; L0
  items → cards saved to `.kit-learn/cards-<date>.md`; L1/L2 items → branch + PR per the ladder (stubbed `gh`);
  prints the morning line
  `learn <date>: 3 new · 1 regressed · cards ready 4 · PRs opened 2 (lesson ×2) · autonomy unchanged · tokens 182k/300k`.
- [auto] Budget: `--budget 20000` stops the headless session, records `budget reached`, pushes nothing half-done
  (same mechanism as plan 035's runner — reuse it).
- [auto] Path guard: a loop-made change touching a path outside its category's allowed paths, or any `protected`
  path, aborts before push with `KIT_LEARN: out-of-category <path>`.
- [auto] `leak-check` passes on every diff and PR body before push (the kit repo is public; PR bodies hold counts,
  kit paths and generic one-line descriptions only, never run names or project paths).
- [auto] Kill switch: `kit-learn.config.json` `"paused": true` → `nightly` prints `KIT_LEARN: paused` and does
  nothing else (not even collect).
- [auto] `node --test "tools/test/*.test.mjs"`, `node tools/install-check.mjs`, `node tools/leak-check.mjs`, R1.
- [auto] `schtasks /query /tn "ai-workflow-kit kit-learn" /xml` shows a daily trigger and `StartWhenAvailable` false.
- [human] After the Human's go: the scheduled task runs one night; the next morning `/kit-learn` shows the prepared
  cards at once and the morning line; at the 30-day review the Human sees the autonomy table and decides promotions.

## Execution Mode
- Parallel: no
- Concurrent plans: 035 (skill improver) shares the runner, budget and scheduler pattern — build 035 first; 048 adds
  the `agent-prompt` path.
- Isolated DB: no

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
tools/kit-learn.mjs
tools/lib/kit-learn/**
tools/skill-improver/**
tools/test/kit-learn.test.mjs
tools/test/kit-learn-autonomy.test.mjs
tools/fixtures/kit-learn/**
kit-learn.config.json
kit-learn-nightly.ps1
.claude/commands/kit-learn.md
core/docs/agent/kit-brain.md
.claude/**
scripts/**
docs/agent/**
docs/brain/**
.kit/install.json
CHANGELOG.md
README.md
```

## Read Scope

Entire kit repo; the brain via `KIT_BRAIN_READER_URI`; plan 035's runner code.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry. Registering the scheduled task, enabling auto-merge on the kit
repo, or changing branch protection changes the Human's machine or repo: show the exact command, wait for go.

## Architecture Impact
- INV-none: preserves — kit-only tooling and one local scheduled task. Nothing is rendered into projects.
- New: a process on the Human's PC that opens PRs on the public kit repo at night, bounded by budget, path guard,
  leak-check and the ceilings.

## Step 0 — Reality Check
1. Plan 035 merged: its runner exposes per-call token usage and a budget kill; its scheduler script pattern exists.
   If 035 is not merged, STOP — this plan reuses it.
2. Plan 046 merged: `collect`, `apply`, `proposals`, K10 protected paths.
3. Spike: `claude -p "/kit-learn --nightly" --output-format json` in an isolated worktree of the kit runs the card
   step headless and returns usage; write the finding here.

## User Stories
- As the Human, I want the cards ready when I sit down, so `/kit-learn` costs me reading time only.
- As the Human, I want small, proven kinds of change (lesson lines, eval cases) to stop needing me once they have a
  clean record, and risky kinds to keep needing me forever.
- As the Human, I want one bad outcome to take autonomy back by itself.
- As the Human, I want one switch that stops it all.

## Functional Requirements

### Must Have (P0)
- [ ] `nightly`: collect → (budget) headless card session → L0 cards file / L1–L2 PRs → morning line.
- [ ] Per-category levels, ceilings, gates, Human-confirmed promotion, automatic demotion.
- [ ] Budget, path guard, leak-check, kill switch.

### Should Have (P1)
- [ ] L2 build: the kit drafts the plan and builds it in an isolated worktree with the kit's own flow, CI green and
  the regression test, then opens the PR.
- [ ] Monthly review line in `/kit-learn` on the first run of a month: autonomy table + KPI trend.

### Nice to Have (P2)
- [ ] L3 merge for `lesson` and `eval-case` after `soakDays` (default 3) with green CI and no new evidence against it.

## UI/UX Notes
- The morning line is the first thing `/kit-learn` prints; then the autonomy changes (if any); then the cards.
- PR titles: `learn(<category>): <issue title>`; body: issue id, runs/projects counts, cause (kit path), the
  regression test, the level that made it, how to revert.

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [ ] N1: Hold the settings in git where the Human reviews them — `kit-learn.config.json` (kit root, kit-only): `paused`, `budgetTokens` (300000), `soakDays` (3), `maxPRsOpen` (3 — no new PR while 3 loop PRs are open), per-category `ceiling` (default L0 for every category until the Human raises it), `cardsTop` (5); schema check in `tools/kit-learn.mjs` — kit-learn.config.json, tools/kit-learn.mjs, tools/test/kit-learn-autonomy.test.mjs
- [ ] N2: Count each category's record from the Human's own decisions — `tools/kit-learn.mjs autonomy`: per category from `proposals` (decision, edited or not, PR merged/closed, reverts from `git log --grep "Revert \"learn("`, regressions from 046 K2); the Goals table — tools/lib/kit-learn/**, tools/test/kit-learn-autonomy.test.mjs
- [ ] N3: Promote only with the Human, demote without — gates as in Goals; `apply` accepts `promote <category>` and `ceiling <category> L<n>`; demotion rules as in Goals write the `autonomy` row and a `proposals` row `{action: demote, why}` — tools/kit-learn.mjs, tools/lib/kit-learn/**, tools/test/kit-learn-autonomy.test.mjs
- [ ] N4: Act at each level — L1: for an issue whose recommended action's category is at L1+, write the artifact (a `kit-lessons.mjs add`, an eval case folder, a plan draft via the `/plan` flow headless) on `learn/<date>-<issue>` from a fresh worktree of `origin/main` under `<home>/.kit-learn/wt/`, run `node --test "tools/test/*.test.mjs"`, push, `gh pr create`; L2: also builds the plan's sub-tasks with the kit's Worker flow in that worktree and requires the regression test (046 K6) to fail on `origin/main` and pass on the branch; record the PR in `proposals` — tools/kit-learn.mjs, tools/lib/kit-learn/**, tools/test/kit-learn-autonomy.test.mjs
- [ ] N5: Merge only proven, low-risk kinds (P2) — L3 for `lesson` and `eval-case` only: after `soakDays` with CI green, `node tools/agent-eval.mjs` non-regression on the role's case set (recall and precision each within 0.02 of `main`), and no new event against the issue → `gh pr merge --squash`; anything else waits for the Human — tools/kit-learn.mjs, tools/lib/kit-learn/**, tools/test/kit-learn-autonomy.test.mjs
- [ ] N6: Guard every change the loop makes — allowed paths per category (`lesson` → `core/docs/agent/kit-lessons/**`; `eval-case` → `docs/agent-evals/cases/**`; `fixture` → `tools/test/**`, `tools/fixtures/**` new files only; `plan-draft`/`amend` → `plans/*.plan.md`; `script-fix` → `core/scripts/**` ≤3 files + its test; `agent-prompt` → via 048 only); 046 K10 protected paths → abort; `node tools/leak-check.mjs --root <changed files> --project-only` and a scan of the PR body before push — tools/lib/kit-learn/**, tools/test/kit-learn-autonomy.test.mjs
- [ ] N7: Run at night within a budget — `tools/kit-learn.mjs nightly`: `paused` check; `collect`; if new evidence: one headless `claude -p "/kit-learn --nightly"` through plan 035's runner (budget kill, usage sum); `/kit-learn --nightly` writes cards for L0 items to `.kit-learn/cards-<date>.md` and returns the L1+ list for N4; morning line to `.kit-learn/morning-<date>.txt` and the `cursor` — tools/kit-learn.mjs, .claude/commands/kit-learn.md, tools/test/kit-learn.test.mjs
- [ ] N8: Show the prepared work first in the morning — `/kit-learn` (interactive): if `.kit-learn/cards-<today or newer than the last session>.md` exists, print the morning line and those cards without re-reading code; otherwise behave as 046 — .claude/commands/kit-learn.md
- [ ] N9: Schedule it on the Human's PC — `kit-learn-nightly.ps1` (PowerShell 5) registers / removes the daily task `ai-workflow-kit kit-learn` (default 03:10, after 035's skill-improver slot; `StartWhenAvailable` false, AC power only), prints the `schtasks` command before running it — kit-learn-nightly.ps1, README.md, tools/test/kit-learn.test.mjs
- [ ] C1: Document the ladder — `kit-brain.md` §Autonomy: the table, ceilings, gates with their sources, demotion, kill switch, what is never automated and why; README section; CHANGELOG — core/docs/agent/kit-brain.md, README.md, CHANGELOG.md
- [ ] T1: Prove the rules with tests that fail on today's code — gates, demotion, path guard, budget stop, paused, leak refusal, morning line, L3 only for allowed categories — tools/test/kit-learn-autonomy.test.mjs, tools/test/kit-learn.test.mjs
- [ ] R1: Render the kit's own installed copies and check drift — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .` — scripts/, .claude/, docs/agent/, docs/brain/, .kit/install.json
- [ ] H1: Turn on the schedule after the Human's go and review after 30 days — register the task; after 30 days print `autonomy` and `trend` and record keep / tune / stop in this plan's Execution Notes — local machine, plans/047-*.plan.md

## Technical Considerations
- Gates and their sources (checked 2026-10-30): per-category thresholds instead of one global one (AutoCommenter,
  arXiv 2405.13565); disable a source above 10% "not useful" (Tricorder, CACM); a fix shown only after the failure is
  reproduced and gone (Getafix, SapFix); tests that must build, pass reliably and add coverage before a human sees
  them, 73% then accepted (TestGen-LLM, arXiv 2402.09171); automerge only with passing tests and lowest-risk kinds
  first, plus a soak period (Renovate `minimumReleaseAge`, Dependabot cooldown); rule of three for "0 failures in n".
  The exact numbers (20 / 30 / 60, 80%, 10%) are this plan's defaults, adapted to a one-person kit; the Human can
  tighten them.
- Cost: `collect` 0 tokens; one headless card session per night with new evidence, capped by `budgetTokens`
  (estimate 100–200k when there are 5 new items, 0 on a quiet night); L2 builds count toward the same cap.
- Security surface: a scheduled process with `gh` push rights to the public kit repo, never to `main` directly (PRs
  only; L3 merges a PR through `gh pr merge`, which branch protection still governs). `protected` paths and
  `workflow-code` above L1 are impossible by construction (N6 + ceilings). Kill switch in a reviewed file.
- The 30-day idle pause of a free Atlas cluster is avoided as a side effect of `collect` connecting nightly.

## Out of Scope
- Improving orchestrator agent prompts by evals — plan 048 (it is the only path for `agent-prompt`).
- Cloud runs (the loop needs the reader connection string and `gh` on the Human's PC; plan 036's cloud routine is a
  different job).
- Auto-merge for scripts, plans, workflow code or anything protected — not by any number.

## Critical Questions
- Q: Approve every step at first, automatic later? A: yes — semi-automatic first, then automatic as it proves
  itself (Human, 2026-10-30).
- Start every category at ceiling L0 — or start `lesson` and `eval-case` at ceiling L1 from day one? A: every
  category starts at L0 (Human, 2026-10-30).
- Gate numbers 20 / 30 / 60 decided proposals (80% accepted as recommended) — or lower? A: keep 20 / 30 / 60
  (Human, 2026-10-30).
- Run time? A: 03:10, after the skill improver (Human, 2026-10-30).
- `maxPRsOpen` 3 (default): no new loop PR while 3 are open, so PRs never pile up.

## Execution Notes
- Source: the Human's ask on 2026-10-30 ("semi-automatic, I approve in the first stages, later automatic") and the
  research summarised in Technical Considerations.
- Order: 045 → 046 → (035) → 047 → 048.

## Finish — review hand-off (replaces /ship)

Build order: wave 5 — after 046 and 035.

When the plan is fully implemented, finish with a review hand-off instead of shipping. Do NOT merge, do NOT run /ship,
do NOT open a PR. This replaces every merge, `/ship`, PR, release or tag step written elsewhere in this plan. `[human]`
items and Human steps stay open and are listed under "Open risks".

While implementing: whenever the plan leaves something open and you choose, note it right away so it appears under
"Decisions you made on your own".

Finishing steps:
1. Fetch origin. If this branch was never pushed, rebase it on the latest origin/main. If it was already pushed, merge
   origin/main into it instead (no rebase, so no force push is needed). Known conflicts: CHANGELOG.md → keep both
   sides; .kit/install.json → take origin/main's copy, rerun `node tools/sync.mjs --target . --apply`, and confirm the
   `required` key still lists 5 steps for .github/workflows/ci.yml and 2 for security.yml. Any other conflict → stop
   and tell me which files conflict.
2. From the kit root run: npm run build, npm run lint, npm test, `node tools/drift-check.mjs --target .` and
   `node --test "tools/test/*.test.mjs"` (quoted glob: the bare folder form fails on Node 24). Also run this plan's own
   `[auto]` Done-when commands. Fix failures that belong to this plan, then rerun; any that still fail go under
   "Open risks". A timing failure in tools/test/guards.test.mjs that passes when that file is rerun alone is machine
   load, not this plan: note it under "Open risks" and move on.
3. Commit everything and push the branch to origin. If the push is refused, do not try another route: give me the
   exact command to run.
4. Your final message must be exactly this block, plain text, nothing before or after it:

```text
=== REVIEW HAND-OFF ===
Plan: <number and title>
Branch: <branch name>
Head commit: <short hash>
Based on origin/main at: <short hash>

Steps (one line per plan step):
<step id> | done / partial / skipped | <file(s) changed> | <one-line note>

Not in the plan (changes you made that the plan did not ask for, and why):
<list, or "none">

Decisions you made on your own (anything the plan left open):
<list, or "none">

Checks:
build: pass/fail
lint: pass/fail
test: pass/fail
drift-check: pass/fail
tool tests: pass/fail
<if any failed: the failing lines only>

Files changed (git diff --stat origin/main...HEAD):
<paste>

Open risks / things you could not verify:
<list, or "none">
=== END ===
```

After the Human approves the hand-off: open the PR, wait for both CI checks (leak-check and e2e) to pass, then merge.
If a check fails, stop and show me the failing lines.
