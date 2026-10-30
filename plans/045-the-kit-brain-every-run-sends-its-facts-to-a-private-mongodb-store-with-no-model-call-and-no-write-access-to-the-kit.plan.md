# Plan 045 — The kit brain: every run sends its facts to a private MongoDB store, with no model call and no write access to the kit

Status: draft
Depends-on: 030, 041
Snapshot: a363b42

## Problem Statement

The kit improves only when the Human carries a run's report into a kit session by hand. The run-499-502 hand-off
(2026-10-30) took a whole kit Planner session to rebuild facts the run already had in `status.json`: when each plan
moved (`plans[].history[].at`), why plan 500 parked, which plans were skipped and why, which decisions repeated.
Five gaps keep the facts from reaching the kit by themselves:

1. **Nothing leaves the project.** Plan 030 keeps a run log, role lessons and a trend line, but all of it lives in
   one project's `docs/brain/`. A second project starts from zero, and the kit cannot see that the same failure hit
   two projects (P2 — the manifest failure — hit FoodVibe twice in two days; a second project would have hit it too).
2. **The only path to the kit is a pull request.** `scripts/kit-feedback.mjs` opens a kit PR with `gh`, so a project
   needs push rights on the kit repo, every lesson is a PR, and the kit repo is public — the Human wants it to stay
   public, so evidence with product detail cannot go there.
3. **No numbers per kit version.** Nothing says whether v1.13 runs park less, take less time or ask the Human less
   than v1.12 did, across projects. "Better from run to run" cannot be checked.
4. **The kit cannot see what the Planner did by hand after a run** (run-499-502 §2 steps 8–12: dropping a check,
   fixing the manifest, querying the log, looking up DB ids for cards with a scratch script). That toil is where the
   next automation is, and it is lost when the session ends.
5. **Token cost per role is unknown** (030 Out of Scope: "only if Step 0 finds the runtime exposes it").

The Human chose (2026-10-30): run evidence goes to a **new, dedicated MongoDB Atlas free cluster**; the kit repo
stays public and holds only decisions (plans, kit-owned lessons, fixtures); projects must not need write access to the
kit repo.

## Prerequisites
- Plan 030 merged: `status.json` facts (`--candidates`, `--refuted`, `--miss`), `docs/brain/run-log.md`.
- Plan 041 merged: `docs/brain/decision-grades.jsonl` rows (every graded decision, triage verdict next to the Human's).
- **[human] H0, before building:** the Human creates the cluster, the two users and the network entry
  (`core/docs/agent/kit-brain.md` "Setup", written in C1 from the Human's own run of it), and sets on each machine:
  ```powershell
  [Environment]::SetEnvironmentVariable("KIT_BRAIN_URI", "<writer connection string>", "User")
  [Environment]::SetEnvironmentVariable("KIT_BRAIN_READER_URI", "<reader connection string>", "User")
  ```
  The reader string is set only on machines that run kit sessions.

## Goals & Success Criteria
**Primary:** when a run finishes, its facts reach the kit's private store with no model call, no Human step and no
access to the kit repo; a machine that is offline or not set up loses nothing; the kit can print, per kit version, how
runs went across every project.

- [auto] `node scripts/brain.mjs digest --run <name> --dry-run` on the fixture `tools/fixtures/orchestrator/brain/`
  (a copy of a real-shaped `status.json` with two plans, one parked, one skipped, one flake, one runner retry) prints
  the documents for `runs`, `plans` and `events` as JSON lines, with `minutes` per phase computed from
  `plans[].history[].at` and `_id` values that are the same on a second call (idempotent).
- [auto] `brain.mjs` signature test: two park reasons that differ only in a path, a number, a hash or a time
  (`gate (main folder): node scripts/log-query.mjs --since=plan-start --level=error` in two runs, `wt-1` vs `wt-3`,
  `round 2` vs `round 3`) produce the same `signature`; two different reasons do not.
- [auto] Redaction test: a park reason holding `api_key="abcd…16+ chars"`, a `mongodb+srv://user:pass@` string or a
  `Bearer <token>` is stored as `[redacted:<pattern name>]`; a code fence or a diff hunk in a note is cut to its first
  line plus `[code cut]`.
- [auto] Send tests with a stub driver module (`--driver <module.mjs>`, like `agent-eval.mjs --runner`):
  no `KIT_BRAIN_URI` → the documents go to `<home>/.kit-brain/queue/<_id>.json` and the line is
  `BRAIN: queued <n> (KIT_BRAIN_URI not set)`, exit 0; a driver that throws → queued, `BRAIN: queued <n> (<error first
  line>)`, exit 0; a driver that succeeds → `BRAIN: sent <n>, queue drained <m>` (oldest first); a duplicate-key error
  (`E11000`) on a queued document counts as sent and removes it from the queue.
- [auto] `finish()` calls `brain.mjs send --run <name>` after the report is written; a send that fails or hangs past
  10 s never changes `finish`'s exit code or its report (orchestrator test with a stub that hangs).
- [auto] Plan 041's `decision-log.mjs grade` sends the rows it just wrote to `decision-grades.jsonl` (`brain.mjs send
  --grades --run`), `ok` and `✗` alike (they are the triage calibration data), same queue rules.
- [auto] `kit-feedback.mjs`: with `KIT_BRAIN_URI` set, a lesson goes to the `lessonsIn` collection after the same
  refusal checks as today, prints `KIT_FEEDBACK: sent to the kit brain`, and opens no PR; without it, today's PR path
  is unchanged (test with the stub driver and stubbed `gh`).
- [auto] `brain.mjs backfill` sends every `.claude/orchestrator-runs/*/status.json` in the project once
  (`_id` idempotent); `--dry-run` lists them.
- [auto] `brain.mjs check` prints `BRAIN: ok — reachable, insert allowed, read denied` against a stub that allows
  `insertOne` and rejects `find`; it prints `BRAIN: WARN — this user can read` when `find` succeeds (least privilege
  is checked, not assumed).
- [auto] `node tools/brain-query.mjs trend --by kitVersion` (kit-only) prints one row per kit version from a stub
  reader: runs, plans, parked per run, fix rounds per plan, minutes per plan, decisions to grade per plan, `✗` per
  plan, flakes per run, tokens per plan (or `-`).
- [auto] Install and sync refuse a `brain.*` config value that looks like a connection string
  (`/mongodb(\+srv)?:\/\//`): `brain.uri is not a config key — the connection string lives in KIT_BRAIN_URI`.
- [auto] `node --test tools/test/`, `node tools/install-check.mjs`, `node tools/e2e-check.mjs`,
  `node tools/leak-check.mjs`, and R1's sync + drift pass.
- [human] After H0 and a kit sync into FoodVibe: `node scripts/brain.mjs setup` then `node scripts/brain.mjs check`
  print `BRAIN: ok` on each machine; `node scripts/brain.mjs backfill` sends the past runs; after the next
  `/orchestrate`, `node tools/brain-query.mjs runs --last 3` in the kit shows that run with minutes per phase.

## Execution Mode
- Parallel: no
- Concurrent plans: 046 builds on this plan's collections; build 045 first.
- Isolated DB: no (the stub driver stands in for Atlas in every test; no test touches the network)

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/scripts/brain.mjs
core/scripts/lib/brain-doc.mjs
core/scripts/orch-state.mjs
core/scripts/decision-log.mjs
core/scripts/kit-feedback.mjs
core/.claude/commands/orchestrate.md
core/docs/agent/kit-brain.md
core/docs/agent/orchestrator.md
core/docs/agent/decision-review.md
core/docs/agent/workflow-map.md
templates/docs/brain/index.md
tools/brain-query.mjs
tools/lib/kit.mjs
tools/install-check.mjs
tools/test/brain.test.mjs
tools/test/orchestrator.test.mjs
tools/test/kit-feedback.test.mjs
tools/fixtures/orchestrator/brain/**
kit.config.json
.claude/**
scripts/**
docs/agent/**
docs/brain/**
.kit/install.json
CHANGELOG.md
README.md
```

## Read Scope

Entire repo. FoodVibe's `.claude/orchestrator-runs/*/status.json` (read only, for the fixture's shape).

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry. Creating anything in Atlas, adding an IP entry, or writing an
environment variable on the Human's machine is the Human's step (H0) — show the exact step, never do it.

## Architecture Impact
- INV-none: preserves — one new kit script and its library, one kit-only tool, calls added at the end of `finish`
  and of 041's `grade`. No app, server or schema file of a project is touched. The workflow (`orchestrate.js`) is not
  changed: the send runs inside `orch-state.mjs finish`, which already runs from the main folder.
- New outbound network call from a project machine (to the Human's Atlas cluster), only when `KIT_BRAIN_URI` is set.

## Step 0 — Reality Check
1. `scope-check.mjs --drift`; check `finish()`, 041's `decision-log.mjs grade`, `kit-feedback.mjs` by symbol.
2. Spike (≤30 min, findings written into this plan's Execution Notes): does an orchestrator run leave per-agent
   transcripts under `~/.claude/projects/` whose assistant lines carry `message.usage`, and can they be tied to the
   run (session id from the Planner session, `agent_type` per subagent)? Yes → T3 sums tokens per role (dedupe by
   `message.id`). No → `tokens: null` and the Out of Scope note on OpenTelemetry stands. The transcript format is not
   an official contract: the reader must fail soft (`tokens: null`, one note) on any shape it does not know.
3. Confirm `mongodb` driver 6.x installs and connects from Node on Windows with `npm install --prefix`.

## User Stories
- As the Human, I want every run's facts to reach the kit by themselves, so I stop carrying reports into a kit session.
- As the Human, I want a second project to benefit from what the first one taught the kit.
- As the Human, I want to see per kit version whether runs got faster, park less and ask me less.
- As the Human, I want a machine without the setup, or offline, to lose nothing and fail nothing.

## Functional Requirements

### Must Have (P0)
- [ ] `brain.mjs digest | send | backfill | check | setup | queue` — documents from `status.json`, the run report
  facts and the grades; the shared schema in `core/docs/agent/kit-brain.md` §Schema.
- [ ] Local queue in `<home>/.kit-brain/queue/` with retry on every later send; never fails `finish` or `grade`.
- [ ] Redaction and code cut before anything is queued or sent.
- [ ] Deterministic `_id` and `signature`.

### Should Have (P1)
- [ ] `kit-feedback.mjs` sends lessons to `lessonsIn` when the brain is set up (replaces the PR path for set-up machines).
- [ ] The Planner's post-run toil lines (`toil`).
- [ ] `tools/brain-query.mjs` (kit-only): `runs`, `events --signature`, `trend --by kitVersion|project`.

### Nice to Have (P2)
- [ ] Tokens per role from transcripts (only if Step 0's spike says yes).

## UI/UX Notes
- One line per send in the run's closing output: `BRAIN: sent 14, queue drained 0` or `BRAIN: queued 14 (…)`.
- The Human never types a connection string into a file the kit manages. `kit-brain.md` "Setup" is the only place
  that walks through Atlas, in the UI words Atlas shows today (C1).

## Atomic Sub-tasks

These are the plan's milestones: a Worker does them in order and ticks each one after it is checked.

- [ ] B1: Build the documents from a run's state with no network and no model — `lib/brain-doc.mjs`: `runDoc(status, report facts)`, `planDocs`, `eventDocs`, `gradeDocs`, `toilDocs`, per `core/docs/agent/kit-brain.md` §Schema (`schema: 1`, `kitVersion`/`kitCommit` from `.kit/install.json`, `project` = `brain.projectId` or `project.repoName`, `machine` = first 8 hex of sha256(hostname)); `minutes` per phase from `history[].at` (readiness → building → gate → checks → ui → merge → final gate; a phase with no timestamps is `null`); `_id` = `<project>:<run>:<kind>:<key>` — core/scripts/lib/brain-doc.mjs, tools/test/brain.test.mjs, tools/fixtures/orchestrator/brain/**
- [ ] B2: Give every problem a signature that matches across runs and projects — `signature(text)`: lower-case; replace ISO times, dates, hex ≥7, numbers, `wt-<n>`, quoted strings and path segments under the project root with `<t> <d> <h> <n> <slot> <s> <p>`; collapse spaces; cut at 120 chars; event `kind` from the park reason prefix or note kind (`park | timeout | env-fail | flake | runner-retry | model-fallback | main-check-dropped | stuck | final-gate-fail`) — core/scripts/lib/brain-doc.mjs, tools/test/brain.test.mjs
- [ ] B3: Keep secrets and code out of the store — `redact(text)` reuses the patterns of `pre-commit-secret-scan.mjs` (import them; move the list to `lib/` if it is not exported) plus `mongodb(+srv)://user:pass@` and `Bearer <token>`; a code fence or `@@ … @@` hunk keeps its first line + `[code cut]`; every string field passes through it — core/scripts/lib/brain-doc.mjs, core/scripts/pre-commit-secret-scan.mjs (export only), tools/test/brain.test.mjs
- [ ] B4: Send with a queue that never loses a document and never fails a run — `brain.mjs send`: loads the driver from `<home>/.kit-brain/node_modules/mongodb` with `createRequire` (or `--driver <module>` in tests); `insertMany(ordered: false)` per collection, 10 s `serverSelectionTimeoutMS`, 10 s overall; any failure writes the unsent documents to `<home>/.kit-brain/queue/`; every send first drains the queue oldest first; `E11000` = already sent; exit 0 always (exit 2 only for bad arguments) — core/scripts/brain.mjs, tools/test/brain.test.mjs
- [ ] B5: Set up a machine once — `brain.mjs setup` runs `npm install --prefix <home>/.kit-brain mongodb@6 --no-audit --no-fund` (prints the command first; no project folder is touched); `brain.mjs check` connects with `KIT_BRAIN_URI`, inserts one `events` document `{kind: "setup-check"}`, tries one `find` and prints `ok — … read denied` or `WARN — this user can read`; `brain.mjs queue` lists queued documents — core/scripts/brain.mjs, tools/test/brain.test.mjs
- [ ] B6: Send at the end of every run and after every grading — `finish()` runs `send --run` after the local report is written and before the branch commit, in a child process with a 15 s kill, and adds the `BRAIN:` line to its output; plan 041's `decision-log.mjs grade` runs `send --grades --run` after it wrote the grades file (both `ok` and `✗` rows) — core/scripts/orch-state.mjs, core/scripts/decision-log.mjs, tools/test/orchestrator.test.mjs
- [ ] B7: Send lessons to the brain instead of a kit PR when the machine is set up — `kit-feedback.mjs`: after the existing refusal checks, `KIT_BRAIN_URI` set → one `lessonsIn` document `{role, title, text, why}` via `brain.mjs send --lesson-file`; else today's `gh` path unchanged; `--dry-run` names the path it would take — core/scripts/kit-feedback.mjs, tools/test/kit-feedback.test.mjs
- [ ] B8: Record what the Planner did by hand after the run — `/orchestrate` step 5 (after the learning step) adds: "Write at most 8 lines of what you did by hand for this run after it finished (step, minutes if known, could a script do it: yes/no) to `.claude/sessions/toil-<run>.json`, then `node scripts/brain.mjs send --toil --run <run>`. None → skip." (inside the existing Planner turn; ~1–2k tokens) — core/.claude/commands/orchestrate.md, core/scripts/brain.mjs
- [ ] B9: Send every past run once — `brain.mjs backfill [--dry-run]` reads `.claude/orchestrator-runs/*/status.json` (and `docs/orchestrator/runs/*/status.json` on the current checkout) and sends them; idempotent by `_id` — core/scripts/brain.mjs, tools/test/brain.test.mjs
- [ ] B10: Let the kit read the brain — `tools/brain-query.mjs` (kit-only, never rendered; `KIT_BRAIN_READER_URI`): `runs [--last n] [--project p]`, `events [--signature s | --kind k] [--since d]`, `trend --by kitVersion|project` (the Goals columns), `--driver` stub in tests — tools/brain-query.mjs, tools/test/brain.test.mjs, tools/install-check.mjs
- [ ] B11: Tokens per role, only if Step 0 found them — read the run's agent transcripts, sum `message.usage` (input, output, cache read, cache creation) per `agent_type`, dedupe by `message.id`; unknown shape → `tokens: null` + one run note — core/scripts/lib/brain-doc.mjs, tools/test/brain.test.mjs
- [ ] B12: Config without secrets — `brain.projectId` (slug, default `project.repoName`) and `brain.enabled` (default true); install and sync refuse a value matching `/mongodb(\+srv)?:\/\//` anywhere under `brain.*`; `$comment` names `KIT_BRAIN_URI` — kit.config.json, tools/lib/kit.mjs, tools/test/brain.test.mjs
- [ ] C1: Document the brain — new `core/docs/agent/kit-brain.md`: what goes where (project files vs brain vs kit repo — the table from the Human's 2026-10-30 discussion), §Schema (collections, fields, `_id`, signature rule), §Setup (Atlas free cluster, the `brainInsert` custom role with `INSERT` on `runs plans grades events toil lessonsIn`, users `kit-brain-writer` and `kit-brain-reader`, the IP entry, the two environment variables in PowerShell, one admin step that creates the indexes with a Temporary User), §Limits (0.5 GB, 100 ops/s, a cluster with no connection for 30 days is paused — the nightly 047 run keeps it awake), §Privacy (redaction, no code, the kit repo stays public); `workflow-map.md`, `orchestrator.md`, `decision-review.md`, `templates/docs/brain/index.md` point to it; CHANGELOG Unreleased — core/docs/agent/kit-brain.md, core/docs/agent/workflow-map.md, core/docs/agent/orchestrator.md, core/docs/agent/decision-review.md, templates/docs/brain/index.md, CHANGELOG.md, README.md
- [ ] T1: Prove each behaviour with tests that fail on today's code — the Goals' test items, all with the stub driver; no test opens a network connection (the test asserts the real driver is never loaded) — tools/test/brain.test.mjs, tools/test/orchestrator.test.mjs, tools/test/kit-feedback.test.mjs
- [ ] R1: Render the kit's own installed copies and check drift — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .` — scripts/, .claude/, docs/agent/, docs/brain/, .kit/install.json

## Technical Considerations
- Dependencies: `orch-state.mjs` `finish()` (writes the local report, then commits on the run branch — the send goes
  between the two, so a failed push still sends), plan 041's `decision-log.mjs grade`, `kit-feedback.mjs` refusal checks,
  plan 041's grades file, plan 030's `status.json` fields.
- The driver lives per machine in `<home>/.kit-brain/node_modules`, not in a project's `scripts/package.json`: no
  project, CI job or audit sees it, and `brain.mjs` stays Node built-ins only when the brain is off.
- Atlas facts this plan relies on (checked 2026-10-30, `mongodb.com/docs/atlas/reference/free-shared-limitations`):
  free cluster 0.5 GB, 100 ops/s (throttled, not refused), 500 connections, one free cluster per Atlas project,
  MongoDB 8.0; the Data API reached end of life in September 2025, so a driver is required; custom roles can grant
  `INSERT` or `FIND` per collection and are created in the Atlas UI (not with `createRole` on a free cluster); an
  insert-only user cannot upsert or create indexes — hence deterministic `_id` and indexes made once by an admin.
- Size: a run document is ~2–4 KB, a plan ~1 KB, a grade ~0.5 KB. 1,000 runs of 5 plans with 40 decisions ≈ 30 MB —
  far under 0.5 GB. Writes: one `insertMany` per collection per run, far under 100 ops/s.
- Security surface: a new outbound connection with a password in a user environment variable. The writer can only
  insert (checked by `brain.mjs check`); a leaked writer password lets someone add documents, not read or delete
  them. The reader string lives only on kit machines. Nothing secret is sent (B3). Network access: see Critical
  Questions.
- Cost: no model call in B1–B7, B9–B12; B8 ~1–2k tokens inside the Planner's existing turn.

## Out of Scope
- What the kit does with the evidence (`/kit-learn`, the issue ledger, kit-owned lessons) — plan 046.
- Nightly runs and autonomy levels — plan 047. Agent prompt improvement from evals — plan 048.
- OpenTelemetry export to a collector (`CLAUDE_CODE_ENABLE_TELEMETRY`, `claude_code.token.usage`): the official way
  to get tokens, but it needs a collector process on each machine; revisit if B11's transcript reading proves
  fragile.
- Vector search over lessons (the free tier allows 3 search indexes; not needed while lessons are capped).
- Removing plan 030's L10 (`/kit-inbox`, `seen-in` PRs): done by editing 030 before it is built — see Execution Notes.

## Critical Questions
- Q: Where does run evidence live? A: a new dedicated MongoDB Atlas free cluster; the kit repo stays public (Human,
  2026-10-30).
- Q: Projects need write access to the kit repo? A: no — they insert into the brain; they receive the kit through
  `kit-sync` as today (Human, 2026-10-30).
- Network access for machines whose IP changes: `0.0.0.0/0` plus least privilege (insert-only writer, long random
  passwords, one writer user per machine so one can be revoked), or each machine adds its current IP as a temporary
  entry (`atlas accessLists create --currentIp --deleteAfter …`) before a run? A: `0.0.0.0/0` with one writer
  user per machine (Human, 2026-10-30).
- One writer user for all machines, or one per machine? A: one per machine (`kit-brain-writer-<pc>`) (Human,
  2026-10-30).
- `brain.projectId`: the repo name, or a short alias the Human picks per project? A: the repo name (Human,
  2026-10-30).
- Should the Planner's toil lines (B8) be written every run, or only when the run had a park or a Human round trip?
  A: every run, capped at 8 lines (Human, 2026-10-30).

## Execution Notes
- Source: run-499-502 hand-off (§2 steps 8–12 for toil, §3 for the problem kinds) and the Human's choices on
  2026-10-30 (Mongo for evidence, public kit, dedicated free cluster, no kit write access from projects).
- **Edit to plan 030 before it is built:** remove sub-task L10 and the Goals bullet "Kit side" (`/kit-inbox`,
  `kit-feedback.mjs` `seen-in`), and add to its Out of Scope: "The kit side of lessons — moved to plans 045/046 (the
  kit brain)." Everything else in 030 stays; 045 depends on it.
- Research behind the design (checked 2026-10-30): idempotent ids per event (Langfuse scores accept an id for
  idempotent submission); signature grouping so recurrence is counted as a rate over runs, not raw counts
  (agentpatterns.ai instruction-library governance loop); facts written by code, never by the agents about themselves
  (Darwin Gödel Machine faked its own test logs — arXiv 2505.22954).

## Finish — review hand-off (replaces /ship)

Build order: wave 3 — after 030 and 041; parallel with 042; the Human's Atlas setup (H0) comes first.

When the plan is fully implemented, finish with a review hand-off instead of shipping. Do NOT merge, do NOT run /ship,
do NOT open a PR. This replaces every merge, `/ship`, PR, release or tag step written elsewhere in this plan. `[human]`
items and Human steps stay open and are listed under "Open risks".

While implementing: whenever the plan leaves something open and you choose, note it right away so it appears under
"Decisions you made on your own".

Finishing steps:
1. Fetch origin and rebase this branch on the latest origin/main. If there are conflicts, stop and tell me which files
   conflict.
2. From the kit root run: npm run build, npm run lint, npm test. Fix failures that belong to this plan, then rerun.
   Also run this plan's own `[auto]` Done-when commands (they include `node --test tools/test/`, which `npm test` does
   not run); any that still fail go under "Open risks".
3. Commit everything and push the branch to origin.
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
<if any failed: the failing lines only>

Files changed (git diff --stat origin/main...HEAD):
<paste>

Open risks / things you could not verify:
<list, or "none">
=== END ===
```
