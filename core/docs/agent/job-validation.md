# Job validation — when a task is “done”

> Load when: finishing any requested job, marking todos `[x]`, or the Human says `done` / `mark done` / `/done`.  
> Hard rule lives in `AGENTS.md`. This file is the full procedure.

---

## Core rule

A job is **done** when every Done-when item is validated. `[auto]` items are validated by agent evidence (Tier 1). `[human]` or untagged items are validated only by the Human. Agents never promote an item to `[auto]`; only the plan author tags it. Tag syntax: `.claude/skills/save-plan/SKILL.md` Plan Rules. Rationale: two tiers let agent-verifiable checks (`[auto]`) close without a human round-trip while visual or subjective checks still need the Human.

Plans with no tags behave exactly as before: everything is `[human]`.

The table below applies to `[human]` and untagged items:

| Validation (counts) | Does **not** count |
| --- | --- |
| `/ship` Approve **Y** or `--yes` | `thanks` / `ok` / `cool` / `nice` |
| `done` / `mark done` / `mark it` | Emoji alone |
| `verified` / `approved` | Silence / moving to another topic |
| `LGTM for this job` | CI green without Human looking |
| `/done` then Human confirms the list | Agent: “I think we’re finished” |

---

## HOW TO VALIDATE checklist (shown once — at the first validation ask)

Whenever an **execution** job finishes and needs Human validation (brief, milestone, feature, bugfix, or chat job that changed behavior), the agent **must** show a HOW TO VALIDATE block (cards, below) **the first time it asks the Human to validate — and only then.**

### When that moment is

| Situation | Where the cards appear | What `/ship` Phase 4 shows instead |
| --- | --- | --- |
| Worker finishes a plan or milestone in a slot | The end-of-job close-out (JOB DONE block, Path B) — **before** any `/ship` | `VALIDATED BY HUMAN` — one line per card with the Human's reply word |
| Chat job, no ship | The `/done` close-out (Path B) | — |
| Human runs `/ship` right after the work and no close-out happened | The Phase 4 approval tree (Path A) — ship *is* the first ask | the cards |

The Human reads the cards while the app is running and the work is fresh, **not** while approving a commit. The commit gate repeats nothing: it records that validation already happened. If the agent cannot point to the Human's validation reply in this session, the gate is the first ask and shows the cards.

Skip only for pure planning / architecture / docs-only turns with no behavior change to validate.

### Format — one card per check

```text
HOW TO VALIDATE — {N} checks · app: {url, or which window} · reply: done | not yet | verify
① {plain title of what is being checked}
   WHY     {one sentence: what changed and what this check proves}
   ({term} = {short gloss})          ← only when a term of art can't be avoided
   WHERE   {which window, page, or app screen — and how to get there}
   SETUP   {only when needed: data or state the check needs first, and how to get it}
   DO      {one plain action}  — or —  paste:  {exact text}
   SEE ✓   {what success looks like; quote on-screen text exactly}
   FAIL ✗  {what failure looks like}

② …
```

Example (a workflow job, checked in a Worker terminal):

```text
HOW TO VALIDATE — 1 check · app: the Claude window of Worker slot 2 · reply: done | not yet | verify
① A finished branch isn't reused
   WHY     take-plan now notices a branch that was already merged, so a slot never continues on stale work
   (squash merge = GitHub folds the branch into one commit on main)
   WHERE   the Claude window of Worker slot 2
   SETUP   plan 42's branch must already be merged on GitHub (it is, PR #87)
   DO      paste:  take plan 42
   SEE ✓   a line ending "…was merged - starting fresh"
   FAIL ✗  it asks you to reset the branch by hand, or the push is rejected
```

### Card rules

- Written for someone who is not an engineer: any person can follow it without asking
- The header line says how many checks, where the app is running (URL, or which window), and the reply words — the Human should not have to scroll back to find the port
- WHY is one sentence in the user's words: what changed and what this check proves — never the commit subject or the plan's Done-when text
- SETUP appears only when the check needs data or state that may not exist (e.g. "have at least 3 venues"); say how to get it in one line, or that the agent already seeded it
- Rewrite each Done-when item in plain words — never copy the plan's wording verbatim
- One check per card, completable in under a minute
- WHERE names the exact place (app page + what to click to get there, or which terminal window)
- DO is one action. When the only way to check is to type something, give the exact text after `paste:` and name the window — never "run the script" or a description of a command
- SEE ✓ and FAIL ✗ are both required; quote on-screen text exactly when there is any
- Keep a term of art when it's the real name of the thing, and gloss it once in brackets
- Cover the **happy path** and any **edge / failure rule** the job introduced (its own card)
- Bug fixes: the card triggers the previously broken scenario
- Never ask the Human to open DevTools, read source files, or work out a command themselves
- Non-visible changes (config, refactor, backend) with nothing to click: one line instead of cards — what changed and why no check is needed

### Brief-sourced criteria

If a session brief exists (e.g. `.claude/sessions/…/brief.md`), turn its Success Criteria / Done-when items into the first cards, then add task-specific cards below.

### Optional agent verify

(For `[auto]` items this runs automatically — see **Tier 1 — auto-verified** below. The rest of this section is the opt-in `verify` reply for `[human]` items.)

After the cards are shown, the Human may reply `verify`. Then the agent walks each card:

- Pass → mark ✓
- Fail → fix, re-check, then ✓
- Cannot agent-verify (needs real auth data, production, physical interaction) → ⚠ with reason — do not fake it

Report:

```text
## Verified by agent
- ✓ [item] — [what was confirmed]
- ⚠ [item] — needs your check: [reason]

Ready for your final pass.
```

Then wait for `done` / **Y** (or `not yet`).

Do **not** ask “verify / I’ll check?” at task start — the checklist is unconditional at close-out; `verify` is opt-in after.

---

## Tier 1 — auto-verified

Runs automatically, without a `verify` reply, for `[auto]` Done-when items only. An item is `[auto]` when its expected output is exact: an exact string, an exit code, a byte-identical diff, `npm run {{commands.build}}` or a test suite passing, or deterministic CLI output.

- Evidence is raw: the exact command, then its actual output, exit code, or diff hash. No paraphrase.
- An item that fails verification, or cannot be verified, falls back to `[human]` with a ⚠ and a reason.
- Never tag or re-tag an item `[auto]` yourself.

```text
VERIFIED BY AGENT
- ✓ [auto] {item} — `{command}` → {output / exit code}
- ⚠ [auto→human] {item} — {reason it could not be verified}
```

Mark matching todos with `node scripts/todo-query.mjs mark --line N[,N…] --auto-verified` (flips `[ ]` to `[x]`, appends `(auto-verified)`). `todo-archive.mjs` skip rules are unaffected.

---

## Path A — Formal ship (commit / push)

Order is hard (see `.claude/commands/ship.md` Phase 4 On approval):

0. Show **VALIDATED BY HUMAN** in the Phase 4 approval tree when the Human already answered the cards in this session (format below). Show **HOW TO VALIDATE** there only when no close-out happened before `/ship` — then ship is the first ask (see "When that moment is").
1. Human **Y**
2. Mark matching todos / plan Atomic Sub-tasks `[x]`:
   - **Inside a `{{slots.nameFormat}}` slot:** mark `[x]` in the plan file's own Atomic Sub-tasks only. Never run `todo-query.mjs mark` or `todo-archive.mjs` — `.claude/todo.md` is Planner-owned; `todo-query.mjs sync --merged` picks up this plan's checkboxes once the branch merges.
   - **Outside a slot (Planner/main):** do not Read `.claude/todo.md` in full. Run `node scripts/todo-query.mjs open` (add `--plan NNN` when known), then `node scripts/todo-query.mjs mark --line N[,N…]` on matches (and the plan's Atomic Sub-tasks the same way); then `node scripts/todo-archive.mjs` to move fully-`[x]` plan sections into `.claude/todo-archive/NNN.md` volumes.
   - Never invent completion for work not in this ship. Never skip with "Contractor does not mark." No match → note `Todo: no matching open items — skipped`.
3. Stage with the job (+ brain if any)
4. Commit → push if asked

One commit. No second push just for checkboxes.

**Validated after the merge (slot):** when the Human validates `[human]` items only after the PR merged, the Worker does **not** open a branch or PR just to tick boxes. It tells the Human: "Tell the Planner: plan NNN validated (items …)". The Planner marks those items `[x]` in `plans/NNN-*.plan.md` on `{{git.mainBranch}}` (a Planner write it already owns) and runs `node scripts/todo-query.mjs sync --merged`.

**Already validated (format):**

```text
VALIDATED BY HUMAN
  - ✓ ① {card title} — "{reply word}" (this chat, {time or turn})
  - ✓ ② {card title} — "{reply word}"
  - ⚠ ③ {card title} — not answered yet → its card is repeated below
```

Only cards the Human did not answer are repeated under a HOW TO VALIDATE heading beneath it. A `[human]` item the Human never saw a card for is **not** validated by **Y** alone.

**All items `[auto]`:** the `VERIFIED BY AGENT` block replaces HOW TO VALIDATE in the Phase 4 tree. **Y** is still required, but it now means commit/push consent only. Todos marked on ship **Y** get no `(auto-verified)` suffix. With any `[human]` item, **Y** also counts as Human validation of those items.

---

## Path B — Chat / small job (no ship, maybe no PR)

When the agent finishes a requested job and is **not** immediately entering `/ship`, pick the case by the plan's Done-when tags:

| Case | What the agent does |
| --- | --- |
| **All `[auto]`, all pass** | Print the `VERIFIED BY AGENT` block. Mark matching todos with `todo-query mark --line … --auto-verified`. Do **not** print the JOB DONE ask; the job finishes without a wait. |
| **Any `[human]` item** | Print the full close-out block: `VERIFIED BY AGENT` on top (the `[auto]` items), then HOW TO VALIDATE with a card for **only** the `[human]` items, then JOB DONE. Wait. |
| **No plan, or untagged items** | Unchanged: the close-out block below, then wait. |

For the last two cases:

1. **Must** end the turn with the close-out block below (do not skip).
2. Wait for Human reply.
3. On `done` / `mark done` / `verified` / `approved` / `mark it` / `LGTM for this job`:
   - Mark matching `.claude/todo.md` / plan Atomic Sub-tasks `[x]`
   - If a commit is about to happen in the same turn → stage todo/plan files in that commit
   - If no commit yet → mark on disk and say: `Todo: marked [x] (uncommitted — include in next commit)`
4. On `not yet` → leave `[ ]`; continue work.
5. On `edit list` → revise the matched-todo list; re-show the block; wait again.
6. On `verify` → run the optional agent-verify flow above, then re-show JOB DONE and wait.

### Required close-out block

```text
HOW TO VALIDATE — {N} checks · app: {url or window} · reply: done | not yet | verify
① {plain title}
   WHY     {what changed and what this check proves}
   WHERE   {place — and how to get there}
   SETUP   {only when needed}
   DO      {action}  — or —  paste:  {exact text}
   SEE ✓   {success}
   FAIL ✗  {failure}
② …

JOB DONE — awaiting your validation
Matched todos (still [ ]):
  - {plan / id / short text}
  - …
Reply: done  |  not yet  |  verify  |  edit list
```

If the job has no user-visible effect, replace the cards with one line under HOW TO VALIDATE explaining what changed and why no click-test is needed — still show the block.

Never show the JOB DONE ask without HOW TO VALIDATE above it (or `VERIFIED BY AGENT` for an all-`[auto]` job, which has no JOB DONE ask).

If no todo/plan items match, still show the block with:

```text
Matched todos (still [ ]):
  - (none in .claude/todo.md / plan — chat-only job)
```

Human `done` still counts as validation of the chat job (no checkbox to flip).

---

## `/done` command

Human (or agent after finishing work) may run `/done` → follow `.claude/commands/done.md` (same close-out + mark flow as Path B).

---

## Matching todos

Mark only items that clearly match **this** validated job (milestone ID, files touched, or Human-named task). Never invent completion for unrelated open checkboxes.

Whichever agent is present when validation lands marks the todo itself — never skip with "Contractor does not mark."

---

## Plan file sync (mid-flight)

If during a brief you discover work that was not in the parent plan (review fallout, extra stage, Human-added scope):

1. **Before** doing that work, append a new `[ ]` item under Atomic Sub-tasks in the parent `plans/….plan.md` (and a milestone row if needed).
2. **Worker (inside a `{{slots.nameFormat}}` slot):** stop there — append to the plan file **only**. Never
   write `.claude/todo.md`; it is Planner-owned, and `todo-query.mjs sync --merged` picks
   up the plan's checkboxes once the branch merges.
   **Planner (main folder, on `main`):** also mirror the same `[ ]` into `.claude/todo.md`
   under that Plan section, as before.
3. Only then execute. On later Human validation, mark `[x]`: Worker → plan file only;
   Planner → both places.

Do not leave new stages only in chat or only in a session brief.

---

## Todo archive volumes

When matching todos are marked `[x]` and a plan section is **fully** done:

1. Run `node scripts/todo-archive.mjs` (ship / done / sweep do this — do not hand-append).
2. Fully-done sections leave `.claude/todo.md` and land in `.claude/todo-archive/NNN.md`
   (max **300 lines** per volume; rolls to the next number).
3. Keep `.claude/todo.md` **open-work-only** (`### Plan` checkbox sections). No Plan Index
   table in this file — Done history is `.claude/todo-archive/` (+ `INDEX.md` for old
   catalog rows); all plan files live under `plans/`.
4. Skip archiving sections that contain `(deferred)`, `(skipped)`, or `[~]`.
5. Duplicate-name checks (`scripts/plan-name-similarity.mjs`) also scan the **last two**
   archive volumes — agents must not reload the full archive history on every save-plan.
