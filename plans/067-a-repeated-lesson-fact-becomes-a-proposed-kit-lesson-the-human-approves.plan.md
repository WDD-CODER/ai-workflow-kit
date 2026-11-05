# Plan 067 — A repeated lesson fact becomes a proposed kit lesson the Human approves

Status: draft
Parked: 2026-11-05 — reliability freeze, revisit 2026-11-15
Depends-on: 066
Snapshot: 9909c12f1572d8e1e0a4aa133ab2b362c468c1ee
Source: Human decision "approve: code facts only" (2026-11-02); follows plans 046 (kit-learn) and 066 (counted lesson lines)

## Problem Statement

**What exists (plan 046 open draft; its database prerequisite (brainKit in Atlas) is met as of 2026-11-03):** `tools/kit-learn.mjs` reads run evidence from the kit brain, keeps a problem ledger and shows up
to five problem cards; the Human's one-line reply (`I<n> lesson <role>`, `tools/lib/kit-learn/reply.mjs`) is parsed into an action;
`applyDecisions` (`tools/lib/kit-learn/apply.mjs:20-60`) marks the issue `planned` with `lessonRole`, and the next step is only
**printed** as a command (`apply.mjs:14`: `node tools/kit-lessons.mjs add --role <role> --text "<the lesson>" --why "<why>" --issue <id>`).
`tools/kit-lessons.mjs` writes kit lessons by id into `core/docs/agent/kit-lessons/<role>.md` (cap 2000 characters per role,
`KIT_LESSON_CAP`, `tools/lib/kit-learn/lessons.mjs:19`). The ledger reads the `lessonsIn` collection (`EVIDENCE`,
`tools/lib/kit-learn/store.mjs:9`) — today only lessons a person sent with the feedback skill (`role`, `title`, `text`, `why`,
`lessonDoc`, `core/scripts/lib/brain-doc.mjs:293`) — and groups them by word overlap (`LESSON_SIMILARITY` 0.6,
`ledger.mjs:238-254`).

**What is missing (this plan adds):**
1. A project's repeated lesson facts (plan 065/066 lines) never leave the project: `finish` sends runs, plans, grades, events and
   toil (`brainSend`, `orch-state.mjs:1336-1380`) but no lesson facts, so the kit cannot see that the same fact came back in
   many runs or many projects.
2. The ledger groups by likeness, which merges different facts and counts a repeat only as another look-alike; facts made by code
   have an exact text and should be grouped by it.
3. The Human's approval stops at a printed command; nothing writes the kit lesson.

Prerequisite (plan 046): the brain database (`brainKit` in Atlas) is confirmed by the Human. All code here is tested with the
existing brain stub (`--driver <module.mjs>`, `store.mjs`); the live check is `[human]`.

## Goals & Success Criteria
**Primary:** a lesson fact that came back in at least 3 runs or 2 projects shows up as one problem card; the Human's existing reply
approves it; the approved kit lesson is written by `tools/kit-lessons.mjs` — no agent writes lesson text.

- [auto] `finish` sends each lesson fact of the run as a structured document `{ role, kind, fact, count }` (`count` = the line's
  "seen in N runs") with the existing brain send (`orch-state.mjs:1336`, `brainSend`), no new runner call; the document is built by a
  new `lessonFactDocs` next to `lessonDoc` in `core/scripts/lib/brain-doc.mjs`, redacted like the others, `_id` from
  project, role and the fact text, and held to the kit's `lessonsIn` insert privilege (no new collection). Test in
  `tools/test/orchestrator.test.mjs` and `tools/test/brain.test.mjs` with the stub driver: documents appear in the queue, a second
  `finish` for the same run sends the same `_id`s.
- [auto] The ledger groups run-fact lessons by the exact fact key (`role` + `fact`), never by likeness, with a run count and a
  project count (`ledger.mjs`, section 4 at :238-254; human-written `lessonsIn` keep the likeness grouping). Test in
  `tools/test/kit-learn.test.mjs`: two facts that differ by one word are two issues; the same fact in two projects is one issue with
  `projects: 2`.
- [auto] A card appears only at 3 or more runs or 2 or more projects; below that the issue stays in the ledger and no card is shown.
  Test: exactly 2 runs / 1 project gives no card; 3 runs / 1 project and 2 runs / 2 projects each give one.
- [auto] The existing reply `I<n> lesson <role>` is the approval: `applyDecisions` records it, and the apply step now runs
  `tools/kit-lessons.mjs add` for the fact (`--text` the fact, `--why` "seen in N runs in M projects", `--issue` the id) instead of
  printing the command. The 2000-char cap and id-based edits of `kit-lessons.mjs` apply unchanged; a refused add (cap, safety wording)
  is reported on the card line, and the issue stays `planned`-not-done. Test: reply approves, the file holds one new `K<n>` line,
  a repeat of the same reply adds nothing, an over-cap add is refused with its reason.
- [auto] No lesson text comes from an agent: the text of the kit lesson is the fact string from the evidence, unchanged. Test:
  a fact containing a model-looking sentence is rejected by the sender's strict shape check and never reaches the brain.
- [auto] `npm run build`, `npm run lint`, `npm test`, `node --test "tools/test/*.test.mjs"`, `node tools/orchestrator-e2e.mjs` and
  `node tools/drift-check.mjs --target .` all exit 0.
- [auto] `node scripts/scope-check.mjs --tests --plan=plans/067-a-repeated-lesson-fact-becomes-a-proposed-kit-lesson-the-human-approves.plan.md`
  prints `SCOPE_TESTS: ok`, and `node scripts/scope-check.mjs --diff=origin/main` on the finished branch prints `SCOPE: ok`.
- [human] With the live brain: after real runs repeat a lesson fact, `node tools/kit-learn.mjs collect` shows a card for it; reply
  `I<n> lesson <role>`; the line appears in `core/docs/agent/kit-lessons/<role>.md` with its `K<n>` id.

## Execution Mode
- Parallel: no
- Concurrent plans: shares `orch-state.mjs` and `tools/test/orchestrator.test.mjs` with 065 and 066; built last of the three.
- Isolated DB: no

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/scripts/orch-state.mjs
core/scripts/lib/brain-doc.mjs
core/scripts/brain.mjs
core/docs/agent/kit-brain.md
core/docs/agent/orchestrator.md
tools/kit-learn.mjs
tools/lib/kit-learn/**
tools/kit-lessons.mjs
tools/test/orchestrator.test.mjs
tools/test/kit-learn.test.mjs
tools/test/kit-lessons.test.mjs
tools/test/brain.test.mjs
scripts/**
.claude/**
docs/agent/**
docs/brain/**
.kit/install.json
CHANGELOG.md
```

`scripts/**`, `.claude/**`, `docs/agent/**`, `docs/brain/**` and `.kit/install.json` are rendered copies, written only by
`node tools/sync.mjs --target . --apply`.

## Read Scope

Entire repo and its git history.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry.

## Architecture Impact
- INV-none: preserves — a new kind of document in an existing brain collection, a stricter grouping, and the apply step doing what
  it only printed; the Human's approval is still required for every kit lesson, and lesson files are written only by script. No
  registered invariant in `docs/brain/invariants.md` is touched (INV-1 is the only one). This plan does not touch judgment-model
  routing.

## Step 0 — Reality Check

1. Runs only when `scripts/scope-check.mjs --drift` reports `REALITY: drift`: check the listed commits by symbol, print `ok` or
   `conflict: <what>` per commit; stop for a go only on a conflict.
2. Plans 065 and 066 are merged (the fact text and the "seen in N runs" count this plan sends); otherwise stop.
3. Read `brainSend` and the `finish` call site (`orch-state.mjs:1336-1380`), `core/scripts/brain.mjs send` (what it queues and
   when), `lessonDoc` and the other doc builders (`brain-doc.mjs:293`), `COLLECTIONS` (:21), the `lessonsIn` schema in
   `core/docs/agent/kit-brain.md:55`, `tools/lib/kit-learn/ledger.mjs:238-254`, `apply.mjs:14-60`, `reply.mjs`, and
   `tools/kit-lessons.mjs` `add` (`lessons.mjs:19`, cap check) as they are on `origin/main`.
4. Confirm the writer user's `brainInsert` role already covers `lessonsIn` (`kit-brain.md:162-163`), so the send needs no new
   privilege; if not, stop and tell the Human.
5. Confirm with the Human the brain database is live (046 prerequisite); if not, the `[human]` item waits and the rest proceeds
   against the stub.
6. `node tools/install-check.mjs` and `node --test "tools/test/*.test.mjs"` pass before any edit.

## User Stories
- As the Human, I want one card when the same fact keeps coming back, not a card per run.
- As the Human, I want my one-line reply to be enough to put the lesson into the kit.

## Functional Requirements

### Must Have (P0)
- [ ] Lesson facts sent as structured evidence at `finish`.
- [ ] Exact-key grouping with run and project counts; card threshold 3 runs or 2 projects.
- [ ] The reply `I<n> lesson <role>` makes the apply step write the kit lesson through `kit-lessons.mjs`.
- [ ] `kit-brain.md` (document shape) and a CHANGELOG entry.

### Should Have (P1)
- [ ] The card text shows the fact, the counts and the role it would go to.

### Nice to Have (P2)
- None.

## UI/UX Notes
None (scripts and docs only). The card is existing terminal text from `kit-learn`.

## Atomic Sub-tasks

Every step names its own test location.

- [ ] A1: Failing tests first — lesson facts are not sent, look-alike facts merge, and an approved lesson is only printed — Step 0 findings to Execution Notes — `tools/test/orchestrator.test.mjs`, `tools/test/kit-learn.test.mjs`
- [ ] B1: Send each lesson fact as run evidence with the existing brain send — `core/scripts/lib/brain-doc.mjs`, `core/scripts/orch-state.mjs`, `core/docs/agent/kit-brain.md`, `tools/test/orchestrator.test.mjs`, `tools/test/brain.test.mjs`
- [ ] B2: Group lesson facts by their exact text with run and project counts — `tools/lib/kit-learn/ledger.mjs`, `tools/test/kit-learn.test.mjs`
- [ ] B3: Show a card only for a fact seen in three runs or two projects — `tools/lib/kit-learn/ledger.mjs`, `tools/kit-learn.mjs`, `tools/test/kit-learn.test.mjs`
- [ ] B4: Write the approved kit lesson when the Human replies, within the existing cap — `tools/lib/kit-learn/apply.mjs`, `tools/kit-learn.mjs`, `tools/kit-lessons.mjs`, `tools/test/kit-learn.test.mjs`, `tools/test/kit-lessons.test.mjs`
- [ ] D1: Document the new evidence shape and the approval path — `core/docs/agent/kit-brain.md`, `core/docs/agent/orchestrator.md`
- [ ] R1: Render the installed copies, run every check, add the changelog entry — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .`, build, lint, `npm test`, `node --test "tools/test/*.test.mjs"`, `node tools/orchestrator-e2e.mjs`
  - Scope: `scripts/**`, `.claude/**`, `docs/agent/**`, `docs/brain/**`, `.kit/install.json`, `CHANGELOG.md`

## Technical Considerations
- **No new runner call:** `finish` already calls `brainSend` once (`orch-state.mjs:1336`); the lesson-fact documents join the same
  queue, so the runner-call count of a run does not change (062).
- **No new collection:** the writer user may insert into `lessonsIn` already; a run-fact document is told apart from a human-written
  lesson by a `source: 'run'` field plus `kind`, `fact`, `count`; the likeness grouping keeps handling the human-written ones.
- **Exact key** = `role` + `|` + fact text (as sent, after the sender's redaction). Counting: the ledger counts distinct run keys
  and distinct projects per key; a project resending the same run is one run (deterministic `_id`).
- **Apply is idempotent:** it looks up the issue's `K<n>` by `--issue`; an issue that already has a kit lesson adds nothing
  (`kit-lessons.mjs` is id-based).
- **Safety lessons:** `isSafety` (`kit-lessons.mjs:13-14`) wording still blocks an automatic retire; an add is allowed.

## Out of Scope
- Autonomy and the nightly loop (plan 047) and scoring (plan 048).
- A filtered copy of agent text (park reason, readiness question title) is a possible later plan, not part of this one.
- Changing the 2000-character kit-lesson cap or the id-based edit rules.
- Reading lesson facts from the project's lesson files at the kit side: the kit only sees what `finish` sends.

## Critical Questions
- None open. Assumed (change on a no): run-fact documents reuse the `lessonsIn` collection (no new database privilege) instead of a
  new collection.

## Execution Notes
- Source: Human decisions of 2026-11-02. Facts from the kit at `origin/main` `9909c12` (v2.0.0). Build order: 065, 066, 067.
- Prerequisite: plan 046's brain database confirmed by the Human; the live check is `[human]`, all code is tested with the stub.
- Architect + PM review (Planner, 2026-11-02): no duplicate of 046 (it built the ledger, cards, reply and `kit-lessons.mjs`; 067 adds
  the run-fact evidence, exact-key grouping, the card threshold and the write on approval) nor of 047 (no autonomy, no nightly run:
  every kit lesson still needs the Human's card reply). Scope fixed from the draft: the brain test is `tools/test/brain.test.mjs`,
  `tools/test/kit-lessons.test.mjs` added, `tools/lib/kit-learn/**` covers `reply.mjs` and `store.mjs`.
