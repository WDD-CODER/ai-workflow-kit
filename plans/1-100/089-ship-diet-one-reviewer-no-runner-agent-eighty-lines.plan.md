# Plan 089 — /ship diet: one reviewer, no runner agent, eighty lines

Status: done — S1–S6 built and released in 3.0.0; the Human waived the last /ship check on 2026-11-09
Depends-on: 088, 091
Snapshot: fd212e119ef16c0b26ebfaf6b44f450fee26d8f5
Revised: Human decision 4, 2026-11-07 — REGULAR Phase 2 keeps the checker pipeline by default (`review.ship = checkers`); the single reviewer is the other value, switched when plan 091 shows precision ≥ 0.28.
Source: kit audit 2026-11-06, plan C; Q3 of the notebook (instruction adherence drops to ~68 % at 500 instructions).

## Problem Statement
`core/.claude/commands/ship.md` is 252 lines with 7 phases, 5 flags and 3 lanes, and sends the agent to four more files (`ship-regular.md` 119, `job-validation.md` 421, `standards-git.md` 135, `decision-review.md` 145). Phase 1 hands three commands to the Haiku `kit-runner` agent and then tells the main session to rerun them inline when the copy is unreadable. Phase 2 on a plan branch starts the three finders, the security agent and the verifier (five Sonnet calls, measured recall 0.25–0.33). Phase 4 runs decision grading, the learning step and brain capture on every REGULAR ship. The sources say: deterministic steps in code, one measured judge, the fewest standing instructions that still carry the rules.

## Goals & Success Criteria
**Primary:** `/ship` runs its checks in code, reviews with the checker pipeline by default or the single reviewer when `review.ship = reviewer`, and fits in 80 lines without losing a rule the Human relies on.

- [auto] `wc -l core/.claude/commands/ship.md` ≤ 80 and `node --test tools/test/ship-review.test.mjs` passes with tests that the file names no `kit-runner` and no `docs/agent/ship-regular.md`, and that its REGULAR review is `/review-it` (the checker pipeline) when `review.ship` is `checkers`.
- [auto] Phase 1 is `node scripts/ship-prep.mjs --gate`: build (+ lint; + the test script on REGULAR) + `plan-ledger-check` + `override-check` by `spawnSync`, printing one line per command with its exit, exit 1 on the first failure; `tools/test/ship-prep.test.mjs` covers FAST (no tests) and REGULAR (tests).
- [auto] Phase 2 REGULAR follows `review.ship`: `checkers` (the default) runs `/review-it`, today's checker pipeline, and prints its table; `reviewer` runs `node scripts/lib/plan-review.mjs --branch <current> --base origin/main` (plan 088's library) and prints its verdict line; `light` is the single `/review` pass as today; FAST / ULTRA-TRIVIAL skip Phase 2 and record `Review: SKIPPED (fast-lane)`; `--skip-review "reason"` unchanged; sensitive paths force REGULAR as today (`ship-prep.mjs` lines 26–40 untouched).
- [auto] The commit tree keeps exactly: Branch, Rename, Proposed commit, `Review:` line, Files to stage, and one of VALIDATED BY HUMAN / HOW TO VALIDATE / VERIFIED BY AGENT; the six-lens `Review (checkers):` block becomes the one `Review:` line (with `checkers` it reads `Review: checkers <verdict> — kept <n>, dropped <m>`); `tools/test/ship-review.test.mjs` asserts the template.
- [auto] Merge needs the literal word `merge` in the request or the gate reply, exactly as today (`/ship fast merge` pre-approves; `Y` alone leaves the PR open); the test covers both.
- [auto] Decision grading, the learning step and brain capture run only when the new key `review.learn` is `on`; the default is `off`; `kit.config.json` documents both keys (`review.ship`: `checkers` default | `reviewer` | `light`; `review.learn`: `off` default | `on`) and install/sync refuse other values; with `off` Phase 4 has no decisions block and no `Learning:` line.
- [auto] `docs/agent/ship-regular.md` is deleted; what the Human still needs from it (the Commit-vs-PR judgment, "After opening a PR") moves into `standards-git.md` under one heading of at most 20 lines; `docs/agent/workflow-map.md` F3 updated.
- [auto] A worker's instruction load (`AGENTS.md` + `take-plan.md` + `ship.md` + `job-validation.md` + `standards-git.md`) is at most 800 lines (Human 2026-11-07; back to 600 when job-validation.md is shortened): `node tools/instruction-load.mjs` prints the sum and exits 1 above it (the tool is the seed of plan 090's budget test).
- [auto] `npm run build`, `npm run lint`, `npm test`, `node --test "tools/test/*.test.mjs"` pass; sync then drift-check report no drift.
- [human] One `/ship fast merge` of a small kit change and one `/ship` REGULAR on a plan branch: both reach the gate with the tree above; the REGULAR one shows the checkers' `Review:` line; nothing you used to rely on is missing (reply `ok` or name it).

## Execution Mode
- Parallel: no.
- Concurrent plans: none; needs 088 merged (`plan-review.mjs`, `claude-run.mjs`).
- Isolated DB: no.

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspot `CHANGELOG.md`.

```scope
core/.claude/commands/ship.md
.claude/commands/ship.md
core/.claude/commands/review-it.md
.claude/commands/review-it.md
core/scripts/ship-prep.mjs
scripts/ship-prep.mjs
core/scripts/lib/plan-review.mjs
scripts/lib/plan-review.mjs
core/docs/agent/ship-regular.md
docs/agent/ship-regular.md
core/docs/agent/standards-git.md
docs/agent/standards-git.md
core/docs/agent/job-validation.md
docs/agent/job-validation.md
core/docs/agent/workflow-map.md
docs/agent/workflow-map.md
core/docs/agent/model-routing.md
docs/agent/model-routing.md
core/docs/agent/decision-review.md
docs/agent/decision-review.md
kit.config.json
.kit/config.json
tools/lib/kit.mjs
tools/instruction-load.mjs
tools/test/ship-review.test.mjs
tools/test/ship-prep.test.mjs
tools/test/lib/**
CHANGELOG.md
tools/test/orchestrator.test.mjs
tools/test/instruction-load.test.mjs
tools/install-check.mjs
tools/test/guards.test.mjs
```

## Read Scope

Entire repo.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a Worker needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry. In the goal run: `tools/test/**` and `tools/lib/**` are pre-approved.

## Architecture Impact
- INV-1: preserves — the reviewer is the `review`-tier agent of plan 087; no model switch inline (`model-routing.md` rule 1).
- INV-none otherwise: a command gets shorter; the rules it keeps are the same rules.

## Step 0 — Reality Check
Read `ship.md` Phase 4 "On approval" steps 1–7 and list which steps the 80-line version keeps verbatim (todo sync, `git add` only listed paths, one commit, no amend after push, never push to main) — those are the rules; the rest is procedure that moves to `ship-prep.mjs` or is deleted. Read `job-validation.md` → "When that moment is" to keep the three validation blocks exactly. Read `kit.config.json` `review.ship` values today (`checkers` | `light`) and plan the migration: `checkers` → `reviewer`, add `learn`, add `off`.

## Atomic Sub-tasks

- [x] S1: `ship-prep.mjs --gate`: the Phase 1 commands by `spawnSync`, per-lane test inclusion, one line per command — core/scripts/ship-prep.mjs, tools/test/ship-prep.test.mjs
- [x] S2: `plan-review.mjs --branch --base` works outside a run (no run folder: the redacted plan goes to the OS temp folder; the gate receipt is `ship-prep --gate`'s output) — core/scripts/lib/plan-review.mjs, tools/test/ship-review.test.mjs
- [x] S3: Rewrite `ship.md` to ≤ 80 lines: Phase 0 lane; Phase 1 `ship-prep --gate` (hard stop); Phase 2 by `review.ship` — `/review-it` checkers (default) / reviewer / light (REGULAR), skip (FAST); Phase 3 manifest + rebase (unchanged rules, shorter text); Phase 4 tree + `Y` / `merge` + the three validation blocks; "On approval" as 5 rules; wrap-up block — core/.claude/commands/ship.md
- [x] S4: Put the learning step behind its own switch and add the single reviewer as a second review choice — `review.learn` off (default) | on gates grade, learn, brain capture; `review.ship` keeps `checkers` (default) and `light`, and gains `reviewer`; `tools/lib/kit.mjs` validates both keys; no migration (an existing `checkers` stays `checkers`) — kit.config.json, .kit/config.json, tools/lib/kit.mjs, core/.claude/commands/ship.md
- [x] S5: Delete `ship-regular.md`; move the Commit-vs-PR judgment and "After opening a PR" into `standards-git.md` (≤ 20 lines); update workflow-map F3, model-routing's table (kit-runner's `/ship` row removed; the checkers' `/ship Phase 2` note stays), `review-it.md` keeps the checker pipeline but runs its commands through `ship-prep.mjs --gate` instead of `kit-runner` — core/docs/agent/ship-regular.md, core/docs/agent/standards-git.md, core/docs/agent/workflow-map.md, core/docs/agent/model-routing.md, core/.claude/commands/review-it.md
- [x] S6: `tools/instruction-load.mjs`: sums the five files, prints the number, exits 1 above 600 — tools/instruction-load.mjs
- [-] T1: Resync, run every check, changelog, the two `[human]` ships — CHANGELOG.md

## Technical Considerations
- Dependencies: 088's `plan-review.mjs` and `claude-run.mjs`; `ship-prep.mjs` (lane thresholds at lines 24–46 stay the source of truth).
- `job-validation.md` is not shortened here (plan 080/069 territory); only its cross-references change.
- Backend / API: none. Auth and validation: none. Security surface: sensitive-path forcing to REGULAR is unchanged. Data / migration: `review.ship` value migration on install/sync.

## Out of Scope
- Shortening `job-validation.md` and the card format.
- Removing `git-agent.md` (plan 090 decides).
- Any change to what counts as validation (`done` / `verified` / `approved`; `Y` alone never validates).

## Critical Questions
- Q: learning default? A: `review.learn = off` (goal decision 7); the Human flips it to `on` when the bar in plan 090 is met.
- Q: `review.ship` default? A: `checkers` (Human decision 4, 2026-11-07); `reviewer` when plan 091's REVIEWER line shows precision ≥ 0.28 — a one-line config switch, not part of this plan.

## Execution Notes
- Step 0 (branch feat/089-ship-diet from origin/main c375d93; 086, 087, 058, 088, 091 merged; `scope-check --drift` reports drift — re-read against today's code):
  - ok 1: `ship.md` "On approval" steps kept as rules: 1 todo sync (Path A step 2), 3 `git add` only listed paths in one call + stop on a non-zero exit + one commit with the ticks, 4 commit, 5 rename, 6 push only if asked (FAST: implied), 7 commit-vs-PR; plus "never commit to main, never force-push, never amend after push". Step 2 (brain drafts, grade, learn) is procedure that moves behind `review.learn`.
  - ok 2: `job-validation.md` → "When that moment is" (4-row table) is unchanged; the three blocks (VALIDATED BY HUMAN / HOW TO VALIDATE / VERIFIED BY AGENT, one and never none, the mix rule, `[ui]` fallback) are kept in ship.md.
  - conflict 3: the plan's Step 0 text ("migration `checkers` → `reviewer`") is superseded by the `Revised:` header — no migration; `review.ship` today is `checkers|light` (`tools/lib/kit.mjs` `reviewProblems`); S4 adds `reviewer` and the new key `review.learn` (`off` default | `on`).
  - conflict 4: `tools/install-check.mjs:185` asserts `docs/agent/ship-regular.md` contains `branch-autodelete-check.mjs`; deleting the file fails install-check, and `tools/install-check.mjs` is outside the scope (not pre-approved). See S5.
  - conflict 5: instruction load today: AGENTS.md 57 + take-plan.md 94 + ship.md 253 + job-validation.md 421 + standards-git.md 135 = 960. Without ship.md the four others are already 707 > 600, and job-validation.md is Out of Scope; < 600 cannot be met by this plan. See S6.
  - ok 6: `plan-review.mjs` is a library only (no CLI); `review()` takes agentFile/model/cwd/planText/diffText/receipt; the reviewer model is `orchestrator.reviewerModel` (sonnet); `runAgent({ trustCwdSettings: false })` refuses this folder, which holds `.claude/settings.local.json`.
  - ok 7: `ship-prep.mjs` lines 26–40 (sensitive paths) stay byte for byte; the gate code goes below them (line 14's import gains `spawnSync`, no line shift).
  - ok 8: text pinned by tests: `tools/test/ship-review.test.mjs` (rewritten here), `tools/test/orchestrator.test.mjs:2332` reads `docs/agent/ship-regular.md` (tools/test, pre-approved), `tools/test/ui-tier.test.mjs:154` needs `[ui]` in ship.md, `tools/install-check.mjs:265` needs `node scripts/override-check.mjs` in ship.md.
- Rules checklist (today's ship.md + ship-regular.md → where each lives after S3/S5; checked after the rewrite):
  - [x] R1 never commit to main · R2 never force-push · R3 never amend after push
  - [x] R4 `git add` only listed paths, one `git add -- <paths>` call, stop on a non-zero exit, never relist a `git rm` path
  - [x] R5 one commit with job + todo/plan ticks, never a second push for checkboxes · R6 matching todos listed before Y, marked `[x]` on Y (Path A step 2)
  - [x] R7 merge only on the literal word `merge` in the request or the gate reply; `Y`, `--yes`, "ship fast y", an earlier turn's `merge` never count
  - [x] R8 `Y` alone never validates `[human]` items (`done Y` answers both) · R9 exactly one of the three validation blocks, never repeat answered cards, mix rule, `[ui]` → `[ui→human]` fallback
  - [x] R10 sensitive / build / CI paths force REGULAR (ship-prep) · R11 `fast` on a REGULAR plan branch → light review unless sensitive (ADR 0015)
  - [x] R12 rebase: hotspot add-only conflict → union, any other conflict → STOP
  - [x] R13 Phase 3: BRANCH_CHANGED STOP, HEAD_MOVED re-read, `scope: out` STOP + `approved: <path>`, overlaps STOP, `no_manifest` never `-A`, never stage secrets/`.env`, stage `.kit/install.json`
  - [x] R14 build gate unconditional hard stop; ledger exit 1 blocks, its warnings advisory; `OVERRIDE_CHECK: FAIL` → add the step back
  - [x] R15 review: one fix-and-recheck only, still failing → stop, no commit; `/review` read directly, never through the Skill tool; checkers on the working tree vs merge-base (`git add -N`); review fact line
  - [x] R16 `--skip-review` needs a reason + tags · R17 FAST: eslint --fix + one diff read + SKIPPED line · R18 ULTRA-TRIVIAL auto commit + push, never a PR, receipt tag · R19 `merge` in the request pre-approves, Phase 1/3 stops still stop
  - [x] R20 never open a PR without Done-when met or explicit instruction; commit-vs-PR judgment (override / brief / ask); after a PR `gh pr checks --watch` once, offer the fix loop · R21 `gh -R <owner>/<repo>`, `gh pr edit` → `gh api -X PATCH`
  - [x] R22 Merge Gate mandatory after push (block exactly, `later` / `open-pr-only`, checkpoint banner, slot merge + `branch-autodelete-check.mjs`, plan close after the merge) · R23 recovery → ship-recovery.md
  - [x] R24 brain entry: full draft body, rides Y, `no brain` · R25 decisions graded / learning step (both now behind `review.learn`)
  - [x] R26 rename `feat/session-*` · R27 open items into Execution Notes / PR body, no second commit · R28 wrap-up block · R29 message-only prep → git-agent; `/ship` = commit consent after explicit Y
  - Checked after S3–S5 (a grep for each rule's wording in core ship.md; every one present): R1–R19, R26–R29 in ship.md (header, Phases 0–4.5, On approval 1–4, wrap-up); R6 Path A mechanics in job-validation.md; R9 card layout in job-validation.md Format / Card rules; R20 + R21 in standards-git.md ("Commit-vs-PR judgment", "`gh` in a fork") — ship.md step 4 keeps the hard rule and points there; R22 in standards-git.md "Post-push Merge Gate" (block, replies, slot merge, plan close) — ship.md Phase 4.5 keeps the `merge`-word rule and `branch-autodelete-check.mjs`; R23 ship-recovery.md; R24 ship.md learn block + brain-capture.md + standards-git.md (behind `review.learn`); R25 decision-review.md §5 "In `/ship`" (behind `review.learn`).
- S1: `ship-prep.mjs --gate [--lane]` exports `shipGateCommands` (build, lint, REGULAR only: testCi || test, then plan-ledger-check, override-check; unset scripts left out) and `runShipGate` (spawnSync, one `GATE: <cmd> → exit <n>` line each, the ledger output always, the first failure's last 20 lines + `GATE: FAIL — <cmd>`, exit 1). No `--lane` → classify without rewriting the baseline. Tests red first (3 fails), then `node --test tools/test/ship-prep.test.mjs` 6/6; `node scripts/ship-prep.mjs --gate --lane FAST` → 4 commands, `GATE: PASS`, exit 0; lines 26–40 byte for byte (diff of 24–46 empty).
- S2: `plan-review.mjs` runs as a command (`shipReview`, `planForBranch`, `shipDiff`, `shipGateReceiptPath`): plan from the branch name, redacted into the OS temp folder, diff = branch point → working tree + untracked files (current branch) else `base...branch`, receipt = the last `ship-prep --gate` run's file in the OS temp folder (ship-prep now writes it, `GATE_RECEIPT:` line), gate mode; `REVIEW: PASS|STOP — …` + one line per problem, exit 0/1/2. Tests red first (2 fails before sync), then `node --test tools/test/ship-review.test.mjs` 9/9.
- decision: behaviour: outside a run the reviewer's model is `--model` or the agent file's own `model:` line (`models.review`), not `orchestrator.reviewerModel` — plan-review.mjs is imported unrendered by the kit's eval tool, so it holds no placeholder; Haiku is refused. Reverse: render the key into ship.md's command line as `--model {{orchestrator.reviewerModel}}`.
- decision: security: the /ship reviewer runs in the shipping session's own folder with `trustCwdSettings: true` (its `.claude/settings.local.json` is the Human's, not a builder's), still with no write tool and only the narrow read-only Bash pre-approved. Reverse: run it in a detached review worktree with `trustCwdSettings: false` (then uncommitted work is not seen).
- Security review fixes (coordinator, three findings on S1/S2):
  - decision: security: the /ship reviewer reads `.claude/agents/plan-reviewer.md` from `<base>` (`git show`; refused when absent), runs in a detached worktree at HEAD (temp folder, removed after) with `trustCwdSettings: false`, no write tool and the narrow read-only Bash — the same contract as run-plans' reviewer; a diff that touches `.claude/settings*.json` or the reviewer's agent file gets no verdict (exit 2, never PASS). This replaces the S2 `trustCwdSettings: true` decision. Reverse: run in the session folder again.
  - decision: security: the plan file is left out of the reviewed diff (`-- . ':(exclude)<plan>'`, skipped among untracked files), so the builder's Execution Notes reach the reviewer neither as plan text nor as diff hunks. Reverse: redact the plan's hunks instead.
  - decision: security: the gate receipt moved from a predictable OS-temp path to `<git dir>/kit-ship-gate.json` (per worktree), written atomically (private `wx` 0600 temp file + rename) and stamped with HEAD, `git write-tree` and a hash of `git diff HEAD` + the untracked names; `readShipGateReceipt` ignores a stale or unstamped one (the review runs with an empty receipt and prints why). `--receipt` was dropped. Reverse: the temp path.
  - Evidence: tests red first (4 fails on the old code), then `node --test tools/test/ship-review.test.mjs` — the reviewer and security tests 5/5 pass (the 3 old ship.md text tests fail until S3 rewrites them); `ship-prep --gate --lane FAST` → `GATE_RECEIPT: …\.git\kit-ship-gate.json`.
- S3: `core/.claude/commands/ship.md` rewritten — 79 lines (was 253): Phase 0 lane; Phase 1 `ship-prep --gate` (hard stop); Phase 2 by `review.ship` (checkers → `/review-it` inline, reviewer → `plan-review.mjs`, light → `/review`; FAST skip; one re-check); Phase 3 baseline + rebase STOPs; Phase 4 tree (Branch, Rename, Proposed commit, one `Review:` line, Files to stage, one validation block) + the three blocks + `review.learn` block (KIT:if); On approval as 4 rules; Phase 4.5 points to standards-git's gate; wrap-up. The tests in `tools/test/ship-review.test.mjs` were rewritten for the new text (≤ 80 lines, no kit-runner / ship-regular.md, checkers default, tree order, merge word, hard rules, learn off/on); 13/13 pass; drift-check ok.
- decision: behaviour: the `review.learn` key (`off`) went into kit.config.json and .kit/config.json with this commit — ship.md's `KIT:if review.learn=on` blocks do not render without it; its validation and `$comment` follow in S4. Reverse: drop the blocks.
- S4: `review.ship` takes `checkers` (default, unchanged — no migration) | `reviewer` | `light`; new `review.learn` `off` (default) | `on`; `tools/lib/kit.mjs` `reviewProblems` refuses any other value of either key (install and sync call it); kit.config.json `$comment` documents both. The grade / learn commands left ship.md for `docs/agent/decision-review.md` §5 "In `/ship`" (now saying it runs only with `review.learn` on); ship.md renders its learning block only with `on`. Tests: config + decision-review tests in ship-review.test.mjs; 16/16 pass; drift-check ok.
- Security follow-up (coordinator, on fix 1): `systemPromptOf` reads `docs/agent/agent-roles.md` beside the agent file, so the base's `agent-roles.md` (`git show <base>:…`, refused when absent) is laid out with the base agent file as `<tmp>/.claude/agents/plan-reviewer.md` + `<tmp>/docs/agent/agent-roles.md`. Test: a branch edit of agent-roles.md never reaches the system prompt, which carries the base contract (red first on the old copy, then pass).
  - decision: security: a branch that edits `docs/agent/agent-roles.md` still gets a verdict (the base copy is used, so the edit cannot steer it); only the reviewer's agent file and `.claude/settings*.json` get no verdict. Reverse: add agent-roles.md to REVIEW_TAMPER_RE.
- S5 built except the deletion (left unticked): `standards-git.md` gained "### Commit-vs-PR judgment (before any `gh pr create`)" (16 lines: override, brief Done-when + `brain-review-check --scope=full`, ad-hoc ask, the hard rule, After opening a PR) and its brain-capture paragraph now runs only with `review.learn` on; workflow-map (`/review-it` and `/ship` rows, kit-runner row, F3, the link lines) and model-routing (kit-runner row without `/ship`, plan-reviewer row names `/ship` Phase 2 `reviewer`, rule 7) updated; `review-it.md` step 2 runs `ship-prep.mjs --gate --lane REGULAR` and its other checks inline, no kit-runner. `tools/test/orchestrator.test.mjs` (pre-approved, appended to the scope) reads the slot-stop rule from standards-git.md instead of ship-regular.md. Tests red first (2 fails), then ship-review 18/18, the orchestrator card test pass.
- Blocked: deleting `core/docs/agent/ship-regular.md` — `tools/install-check.mjs:185` (outside the scope, not pre-approved) lists `docs/agent/ship-regular.md` among the files that must contain `branch-autodelete-check.mjs`. Needed: `approved: tools/install-check.mjs`, then drop `'docs/agent/ship-regular.md', ` from that list and `git rm core/docs/agent/ship-regular.md` (sync then removes the installed copy). Nothing links to it any more (ship.md, workflow-map, kit.mjs no longer name it); its text is left as it was until then.
- follow-up: `core/docs/agent/agent-roles.md:104` (outside the scope) still says "`kit-runner` in `/review-it`".
- S6: `tools/instruction-load.mjs [--root] [--max] [--json]` sums AGENTS.md + take-plan.md + ship.md + job-validation.md + standards-git.md as installed, one line per file, `INSTRUCTION_LOAD: <sum> lines (max 600) — ok|over`, exit 0 / 1 above / 2 missing; `tools/test/instruction-load.test.mjs` (pre-approved, appended to the scope; written with the tool) 3/3. On this repo: 57 + 94 + 76 + 421 + 150 = 798 → `over`, exit 1 (was 960). The `[auto]` < 600 item stays open: job-validation.md alone is 421 and is Out of Scope (Step 0 conflict 5) — needs the Human: shorten job-validation.md in its own plan, or set the budget for this plan (e.g. `--max 800`).
- T1 built except the two `[human]` ships (left unticked): CHANGELOG `[Unreleased]` entry. On the branch after S6, every command exit 0 unless named: sync `KIT_SYNC: applied`, `KIT_DRIFT: ok — 0 undeclared differences`; `npm run build` 0 (`PACK_CHECK: ok`); `npm run lint` 0 (`LEAK_CHECK: ok`); `npm test` 0 (`INSTALL_CHECK: ok … 0 problems`, `WORKFLOW_LINK_CHECK: ok`); `node --test "tools/test/*.test.mjs"` 582/583 — the one failure was "write guard: finishes in under 300 ms" at 3154 ms while the e2e batch ran in parallel, rerun alone: pass; `node tools/orchestrator-e2e.mjs` ok 23; `node tools/e2e-check.mjs` ok 55 (1 skipped); `node tools/acceptance-check.mjs --e2e` ok 122; `node tools/install-check.mjs`, `node tools/workflow-link-check.mjs`, `node tools/leak-check.mjs` ok; `wc -l core/.claude/commands/ship.md` 79; `node tools/instruction-load.mjs` 798 → exit 1 (open, see S6).
- approved: tools/install-check.mjs — Human 2026-11-07 (relayed by the coordinator; appended to the scope block). S5 finished: `'docs/agent/ship-regular.md'` left the `branch-autodelete-check.mjs` list at `tools/install-check.mjs:185`; `git rm core/docs/agent/ship-regular.md`; sync removed the installed copy.
- decision: limit: instruction load ≤ 800 lines — Human 2026-11-07 ("limit 800"); `tools/instruction-load.mjs` `DEFAULT_MAX` = 800 and the Done-when line say so; back to 600 when job-validation.md is shortened (a later plan). Reverse: `DEFAULT_MAX = 600`.
- decision: behaviour: the write-guard timing test (`tools/test/guards.test.mjs`, pre-approved, appended to the scope) times the guard's own work — the fastest of 5 hook runs minus the fastest of 5 bare `node -e ""` starts measured side by side — under 300 ms, plus a 2000 ms ceiling on the whole run; it failed only under load (3154 ms with the e2e batch running), not because the guard is slow. Coordinator, for the Human 2026-11-07. Reverse: the old `best.ms < 300`.
- Final checks after the Human's replies (every command exit 0): sync `--apply --prune` → `pruned docs/agent/ship-regular.md`, `KIT_DRIFT: ok — 0 undeclared differences` (160 managed files); `npm run build` `PACK_CHECK: ok`; `npm run lint` `LEAK_CHECK: ok`; `npm test` `INSTALL_CHECK: ok … 0 problems` + `WORKFLOW_LINK_CHECK: ok`; `node --test "tools/test/*.test.mjs"` 583/583 (the guard timing test included, in the full parallel run); `ORCHESTRATOR_E2E: ok — 23`; `E2E_CHECK: ok — 55, 1 skipped`; `ACCEPTANCE_CHECK: ok — 122`; install-check, workflow-link-check, leak-check ok; `node tools/instruction-load.mjs` → `798 lines (max 800) — ok`, exit 0; `wc -l core/.claude/commands/ship.md` 79.
- validated: [human] part 1, `/ship fast merge` of a small kit change (PR #112, plan 093) — Human 2026-11-07: `ok: 1`. Part 2 (one `/ship` REGULAR on a plan branch) still open.
