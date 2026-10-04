# {{project.name}} — Agent Workflow Map

> Purpose: precise, hand-off-ready inventory of every workflow, command, skill, hook,
> script, rule source, and state store in this project, plus how they connect.
> Written for a visualization agent — every node is a real file path; every edge is
> labeled `invokes`, `loads`, `reads`, `writes`, `gates`, or `triggers`.
> Generated from the kit; regenerate per project after install.

---

## 1. Roles (three-agent workflow)

| Role | Who | Responsibility |
| --- | --- | --- |
| Human Director | The user | Approves plans, validates jobs (`done` / ship `Y`), answers gates |
| Architect | Claude.ai (default; Claude Code/Cursor on explicit override) | Produces Plan Contracts via `/plan`-style scoping. Read-only against the app |
| Contractor | Cursor (or Claude Code) | Executes **one milestone at a time** from the saved plan, writes `sessions/[date].md`, stops |
| Reviewer | Claude Code via `/review-it` | Checks milestone vs Plan Contract. Report-only, never fixes, never commits |
| Shipping agent | Whichever agent runs `/ship` | Build gate → review → commit approval → merge gate → brain capture |

Rule: **a job is never done until every Done-when item is validated** — `[auto]` by agent evidence, `[human]`/untagged by the Human (`docs/agent/job-validation.md`).

---

## 2. Rule sources (precedence roots)

| File | Scope | Notes |
| --- | --- | --- |
| `AGENTS.md` | Both agents | Single source of truth: hard rules, skill triggers, standards index, job validation, Plan Contracts |
| `CLAUDE.md` | Claude Code only | Imports `AGENTS.md` + addendum: branch guard, session hooks, "Yes chef!" gate |
| `.cursor/rules/*.mdc` | Cursor only | Ships with the optional `layer:cursor` (phase 3): advisory skill/convention mirrors, two `alwaysApply: true` role rules. |
| `docs/agent/` | Both, load-on-demand | conventions, standards-<stack> (stack pack), standards-security/-git, brain-capture, job-validation, pr-check-fix-loop |
| `{{paths.sharedDocs}}/tech-stack.md` | Both | Stack detail |
| `docs/brain/` | Both | Second brain: `index.md`, `gotchas.md` (index) + `gotchas/` (domain files), `patterns/`, `decisions/` (ADRs), `glossary.md`, `projectbrief.md`, `how-it-works.md` |

Cursor rule files ship with the optional `layer:cursor`; the stack pack adds stack-specific rules.

---

## 3. Commands — Claude Code (`.claude/commands/`)

### Core plan/execute/ship pipeline

| Command | Invokes / loads | Reads | Writes |
| --- | --- | --- | --- |
| `/plan` | loads `.claude/references/prd-template.md`, `hld-template.md`, `_shared/*`, `docs/agent/*` (path-scoped) | codebase (read-only) | Plan Contract under `plans/` |
| `/feat` | invokes `/plan` then `/review-it`; loads the stack pack's `standards-*.md`, `{{docs.domainStandards}}`, `{{paths.sharedDocs}}/tech-stack.md` | — | product code (via Contractor milestones) |
| `/fix` | bug-fix path (analog of `/feat` for fixes) | — | product code |
| `/refactor` | refactor path | — | product code |
| `/brief` | see §6 flow F2; syncs parent plan via save-plan Phase 4 | `git diff/log`, `.claude/todo.md` (retroactive mode) | `.claude/sessions/{session-id}/brief.md` |
| `/review-it` | Reviewer protocol | newest `sessions/*.md`, parent plan in `plans/`, milestone files | verdict in chat only (never `[x]`, never commits) |
| `/ship` | Phase 0 classifies FAST/ULTRA-TRIVIAL/REGULAR first (`/ship fast`\|`regular` overrides); REGULAR invokes `/review`; runs `scripts/session-manifest-ship.py` (multi-worktree), `scripts/brain-review-check.mjs --scope=full` (feature-complete path) | `.claude/.session-state-path`, brief Done-when | commit; marks `.claude/todo.md` + plan `[x]`; `docs/brain/**` (auto-writes on `Y`, unless `no brain`; skipped by default on FAST/ULTRA-TRIVIAL); session-state file |
| `/done` | job-validation Path B close-out | `.claude/todo.md`, parent plan | marks `[x]` on Human confirm (or Tier 1 evidence for all-`[auto]`) |
| `/review` | standalone review pass (used by `/ship` Phase 2) | session diff | report only |
| `/end-session` | alias territory of `/ship` ("wrap up") | — | — |

### Support / maintenance commands

| Command | Purpose |
| --- | --- |
| `/security` | security review path |
| `/fix-pr-checks` | runs `docs/agent/pr-check-fix-loop.md` (bounded: 2 rounds; security findings always surfaced) |
| `/cleanup` | session & worktree pruning (`scripts/prune-merged-worktrees.sh`, `scripts/prune-old-sessions.sh`) |
| `/sweep-stale-todos` | prune stale `.claude/todo.md` entries |
| `/docs-refresh` | on-demand documentation refresh |
| `/auto-solve` | autonomous solve loop (browse-based verification) |
| `/skills`, `/commands` | listings |

### Commands — Cursor (`.cursor/commands/`)

Redirect stubs for palette discoverability ship with the optional `layer:cursor`.

---

## 4. Skills (`.claude/skills/*/SKILL.md`) — shared by both agents

| Skill | Trigger | Key connections | Cursor `.mdc` |
| --- | --- | --- | --- |
| `save-plan` | Plan Contract pasted / "save the plan" / plan not yet under `plans/` | runs `scripts/plan-name-similarity.mjs`; writes `plans/NNN-slug.plan.md` + `.claude/todo.md`; `.claude/.plan-write-ack` handshake with `plan-write-guard.sh`; Phase 4 = mid-flight brief↔plan sync | `save-plan-must-use-skill` |
| `brief-detection` | 3+ structured H2 markers in first message | gates execution → routes to `/feat` (option b) or discussion | `brief-detection-must-use-skill` |
| `elegant-fix` | after hacky fix / duplicate logic | — | `elegant-fix-must-use-skill` |
| `github-sync` | session start, once per day | writes `notes/github-sync/YYYY-MM-DD.md` | `github-sync-must-use-skill` — best-effort, no `SessionStart`-hook equivalent in Cursor |
| `preflight` | before dev server / browser / DB workflows | env check | `preflight-must-use-skill` |
| `techdebt` | end of session / before PR / audit | — | `techdebt-must-use-skill` |
| `update-docs` | after significant features / before PR | — | `update-docs-must-use-skill` |
| `worktree-setup` | "setup worktree" (explicit only) | — | `worktree-setup-must-use-skill` |

<!-- PACK:stack — stack skill rows (component structure, pipe/directive logic, auth, styling layer, breadcrumb navigator) come from the stack pack -->

---

## 5. Automation: hooks + scripts

### Claude Code hooks (`.claude/settings.json`)

| Event | Script | Effect |
| --- | --- | --- |
| PreToolUse (Edit\|Write\|MultiEdit) | `scripts/branch-guard.sh` | **blocks writes on `main`**, except the Planner's `plans/*.plan.md` / `.claude/todo.md` admin-bypass |
| PreToolUse (Edit\|Write\|MultiEdit) | `scripts/plan-write-guard.sh` | gates **new** `plans/*.plan.md` writes: runs similarity check; denies when similar plans exist unless `.claude/.plan-write-ack` names the target; existing-plan edits always allowed |
| PreToolUse (Edit\|Write\|MultiEdit) | `scripts/scope-guard.sh` | inside a `{{slots.nameFormat}}` slot with an active plan, denies a write outside that plan's `## Read-Write Scope` (`SCOPE_GUARD:` message); silent allow outside a slot, in an idle slot, or on an internal check failure — the `/ship` scope gate is the backstop |
| SessionStart (startup) | `scripts/session-startup.sh` | loads previous session-state; sets `.claude/.session-state-path` save target; injects `PLANNER:` / `WORKER: plan=…` / `IDLE SLOT:` via `scripts/lib/slot.mjs --describe` (see slot model below) |
| PostToolUse (Edit\|Write) | `scripts/session-manifest-hook.py` | records this-session file touches (multi-worktree staging safety); refreshes this slot's liveness heartbeat |
| PreCompact | `scripts/pre-compact-reminder.sh` | reminds the agent to save state before compaction |
| Stop | `scripts/handoff-check.sh` | handoff completeness check at turn end; releases this slot's liveness lock |

**Cursor runs none of these hooks.** Its equivalent enforcement is advisory `.mdc` rules + the shared pre-commit/pre-push
hooks below — the `/ship` scope gate and `.husky/pre-push` are what make scope enforcement hold for Cursor too, since it
has no PreToolUse hook of its own.

### Git hooks (`.husky/`, shared by both agents)

| Hook | Effect |
| --- | --- |
| `pre-commit` | `lint-staged`, secret-scan, `plan-ledger-check.mjs` (+ stack-pack checks) |
| `pre-push` | On a push whose remote ref is `refs/heads/{{git.mainBranch}}`: diffs the pushed range and exits 1 unless every file matches `plans/<name>.plan.md` or `.claude/todo.md` — the Planner's admin-bypass shape. Other branches pass untouched. Human-only override: `git push --no-verify`. |

### Planner-Worker slot model (replaces the retired two-slot system)

3 permanent worktrees, fixed ports, no auto-claim:

| Slot | Frontend | Backend |
| --- | --- | --- |
| `main` (Planner) | {{slots.fePorts}} | {{slots.bePorts}} |
| `{{slots.nameFormat}}` | {{slots.fePorts}}+1 | {{slots.bePorts}}+1 |
| `{{slots.nameFormat}}` | {{slots.fePorts}}+2 | {{slots.bePorts}}+2 |
| `{{slots.nameFormat}}` | {{slots.fePorts}}+3 | {{slots.bePorts}}+3 |

- **Planner** (main folder, on `main`): plans only. Writes and pushes `plans/*.plan.md` +
  `.claude/todo.md` directly — the admin-bypass restricted by `branch-guard.sh` +
  `.husky/pre-push`.
- **Worker** (a `{{slots.nameFormat}}` slot): says "execute plan NNN" → `scripts/take-plan.mjs` (see
  `.claude/commands/take-plan.md`) claims the slot — safety checks (dirty tree, busy slot,
  plan must exist on `origin/{{git.mainBranch}}`), branch `feat/NNN-<slug>`, conditional `npm install`,
  generated `{{paths.slotEnvFile}}`, port/PID-safe server spawn (`npm run {{commands.devLocal}}`
  on port {{slots.fePorts}}+N, backend with `PORT={{slots.bePorts}}+N`/`ALLOWED_ORIGIN`), optional isolated
  per-slot {{stack.backend}} database (`{{slots.dbNameFormat}}`), then reports `scope-check.mjs --drift` so the
  Worker knows whether to run the plan's Step 0 reality check before starting milestones.
- Idle slots are always detached at `origin/{{git.mainBranch}}`, never on `main`. Releasing a slot
  (taking a new plan into it) only happens once its current branch is merged.
- Liveness lock (`.claude/.session-lock`, `scripts/session-lock.sh`) is claimed by
  `take-plan.mjs` and released by `handoff-check.sh` on `Stop` — same file format as
  before, no separate two-slot pairing logic left to maintain.

### Workflow scripts (shared, `scripts/`)

| Script | Called by |
| --- | --- |
| `plan-name-similarity.mjs` | save-plan Phase 0 (both agents), `plan-write-guard.sh` |
| `session-manifest-ship.py` | `/ship` Phase 3, outside a slot, only when another slot is on a live (non-detached) branch — otherwise skipped in favor of `scope-check.mjs` |
| `brain-review-check.mjs` | `/ship` feature-complete path (advisory) |
| `brain-capture-comment.mjs` | PR sticky brain-capture comment |
| `pre-commit-secret-scan.mjs` (+ stack-pack checks) | pre-commit hooks (source of truth for enforcement per `AGENTS.md`) |
| `prune-merged-worktrees.sh`, `prune-old-sessions.sh` | `/cleanup` |
| `lib/slot.mjs` | `session-startup.sh` (`--describe`), `scope-check.mjs`, `ship-prep.mjs`, `take-plan.mjs`; `--list` for the Planner protocol |
| `session-state-path.mjs` | `session-startup.sh`, `handoff-check.sh`, `write-session-state.mjs` — one resolver, no duplicated logic |
| `scope-check.mjs` | `scope-guard.sh` (`--file`), `ship-prep.mjs` (`--diff`), the Planner protocol (`--overlap`), `take-plan.mjs` + `take-plan.md` (`--drift`) |
| `take-plan.mjs` | "execute plan NNN" / "take plan NNN" (`.claude/commands/take-plan.md`) |
| `todo-query.mjs sync --plan NNN` / `sync --merged` | the Planner protocol (`.claude/commands/plan.md`), after a `feat/NNN-*` branch merges |
| `free-merged-slots.mjs` | the Planner protocol (`.claude/commands/plan.md`), step 2 — detaches a `{{slots.nameFormat}}` back to idle once its branch merges into `origin/{{git.mainBranch}}` |


---

## 6. State stores (the "ledger" layer)

| Store | Written by | Read by |
| --- | --- | --- |
| `plans/NNN-slug.plan.md` (+ `plans/1-100/` archive) | save-plan; mid-flight Phase 4 appends | `/review-it`, `/brief`, `/ship` todo sync, Contractor |
| `.claude/todo.md` | save-plan Phase 1; mid-flight sync; `/ship`/`/done` mark `[x]` | `/brief` retroactive, `/ship`, `/done`, session startup |
| `.claude/todo-archive.md` | `/ship` (archives fully-complete plan sections) | — |
| `.claude/sessions/{session-id}/brief.md` | `/brief` | `/ship` Done-when check |
| `sessions/YYYY-MM-DD.md` | Contractor after each milestone | `/review-it` step 1 (handoff) |
| `docs/session-state*.md` (target in `.claude/.session-state-path`) | `/ship` Phase 5 | `session-startup.sh` on next session |
| `docs/brain/**` | `/ship` brain capture (auto-write on gate reply, opt out with `no brain`) | session start on unfamiliar work; architectural choices |
| `.claude/.plan-write-ack` | save-plan (save-as-new after Human confirm) | consumed once by `plan-write-guard.sh` |
| `notes/github-sync/YYYY-MM-DD.md` | github-sync skill | — |
| `.qa-reports/` | QA/audit runs | audits |

---

## 7. Flows (edges for the diagram)

### F1 — Plan lifecycle (persist gate)

```
Human describes feature
  → Architect (claude.ai) drafts Plan Contract
  → Human pastes contract into Cursor or Claude Code
  → [gate] save-plan skill (MANDATORY before any milestone work)
      → Phase 0: node scripts/plan-name-similarity.mjs --name="…"
          → no hits  → save as next NNN, no questions
          → hits     → STOP → Human: rewrite existing | save as new | cancel
      → Phase 1: append Atomic Sub-tasks to .claude/todo.md; allocate NNN (collision guard)
      → Phase 3: write plans/NNN-slug.plan.md
          (Claude Code: plan-write-guard.sh hook re-checks; .plan-write-ack unlocks save-as-new)
  → only now: brief/milestone execution may begin
```

### F2 — Milestone / brief execution loop

```
/brief (proactive) → brief.md names Parent plan path
  → Contractor executes ONE milestone → writes sessions/[date].md → STOPS
  → /review-it: reads newest session file → reads parent plan → checks milestone
      → APPROVE | RETURN TO CURSOR | ESCALATE TO ARCHITECT
  → mid-flight scope change (review fallout / Human adds stage):
      [gate] append [ ] to parent plan Atomic Sub-tasks + .claude/todo.md BEFORE doing the work
      (save-plan Phase 4 + job-validation "Plan file sync")
  → validation (Human done / ship Y / Tier 1 evidence) → next milestone or /ship
```

### F3 — Ship pipeline (`/ship`)

```
Phase 0  lane classification — FAST / ULTRA-TRIVIAL / REGULAR by diff size + sensitive-path check; /ship fast|regular overrides
Phase 1  npm run {{commands.build}}            — unconditional hard stop on fail, all lanes
Phase 2  /review             — REGULAR: one fix-and-recheck cycle max (or --skip-review "reason"); FAST/ULTRA-TRIVIAL: eslint --fix + single diff read instead, brain-mining skipped too
Phase 3  manifest check      — >1 worktree: session-manifest-ship.py; ≤1 worktree: branch/HEAD-drift check (baseline captured at ship start)
Phase 4  approval gate       — REGULAR: visual tree, Human Y = job validation, separate Phase 4.5 wait
                                FAST: same tree, single Y also answers Phase 4.5 (merge/later/open-pr-only)
                                ULTRA-TRIVIAL: no wait — auto-commit+push, tree printed as receipt after
         on Y (hard order): mark todos/plan [x] → write approved brain drafts
                            → git add listed paths → one commit → rename branch → push if asked
         commit-vs-PR judgment: brief Done-when met → PR; else checkpoint (no PR); ad-hoc → ask
Phase 4.5 Merge Gate         — mandatory after any successful push (standards-git.md); folded into Phase 4's single Y for FAST lane
         replies: merge | later | open-pr-only (brain draft auto-writes; add "no brain" to opt out, "brain edit …" to revise)
Phase 5  session-state write — target from .claude/.session-state-path
Phase 6  (todo sync already done in Phase 4)
```

### F4 — Job validation without ship (Path B)

```
Agent finishes job → MUST print HOW TO VALIDATE bullets, then "JOB DONE" block
  → Human: done/verified/approved → mark matching todo + plan [x] on disk
  → verify → agent walks checklist, then re-show JOB DONE
  → not yet → keep [ ]   |   edit list → revise, re-show
(thanks/ok/silence/CI-green never count)
```

### F5 — Session lifecycle (Claude Code)

```
SessionStart → session-startup.sh → loads docs/session-state*.md + sets save target
  → github-sync skill (once per calendar day)
  → work … (branch-guard + plan-write-guard on every write; session-manifest on every edit)
  → context full → PreCompact reminder fires → /compact focus … (or /clear + state reload)
  → Stop → handoff-check.sh
  → /ship Phase 5 → writes session-state for next session
```

### F6 — PR checks fix loop

```
PR checks fail → /fix-pr-checks → docs/agent/pr-check-fix-loop.md
  → max 2 rounds; security-scan findings ALWAYS surfaced to Human; then stop
```

### F7 — Brain capture (knowledge loop)

```
Durable learning in session (decision/gotcha/pattern)
  → /ship Phase 4/4.5 proposes: path + title + FULL draft body (fenced)
  → usefulness gate; one-liner proposals forbidden
  → auto-writes verbatim to docs/brain/** on the gate reply (Y / merge / later / open-pr-only); "no brain" opts out
  → next sessions: read docs/brain/index.md → relevant sub-file only
```

---

## 8. Connection matrix (quick edge list)

```
/feat        --invokes-->  /plan, /review-it
/ship        --invokes-->  /review; --runs--> session-manifest-ship.py, brain-review-check.mjs
/ship        --writes-->   .claude/todo.md, plans/*.plan.md ([x]), docs/brain/**, session-state
/review-it   --reads-->    sessions/*.md, plans/*
/brief       --writes-->   .claude/sessions/{id}/brief.md; --reads--> plans/* (parent)
save-plan    --runs-->     plan-name-similarity.mjs; --writes--> plans/*, .claude/todo.md, .plan-write-ack
plan-write-guard.sh --gates--> Write/Edit on plans/*.plan.md; --runs--> plan-name-similarity.mjs
branch-guard.sh     --gates--> all Write/Edit (blocks main)
brief-detection     --gates--> structured pasted briefs; --routes--> /feat | discussion
job-validation      --gates--> marking any [x]; --requires--> Human done / ship Y / Tier 1 evidence
brain-capture.md    --gates--> any docs/brain write (shown, then auto-writes; "no brain" opts out)
standards-git.md    --gates--> post-push (Merge Gate, mandatory)
pre-commit hooks    --gate--> every commit (secret-scan, plan-ledger-check, stack-pack checks) [shared with Cursor]
```

---

## 9. Known inconsistencies

Recorded per project, in the project's own copy of this file after install.
