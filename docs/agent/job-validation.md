# Job validation — when a task is “done”

> Load when: finishing any requested job, marking todos `[x]`, or the Human says `done` / `mark done` / `/done`.  
> Hard rule lives in `AGENTS.md`. This file is the full procedure.

---

## Core rule

A job is **done** when every Done-when item is validated. `[auto]` items are validated by agent evidence (Tier 1). `[ui]` items are validated by a script that drives the real UI and saves a screenshot (Tier 1b). `[human]` or untagged items are validated only by the Human. Agents never promote an item to `[auto]` or `[ui]`; only the plan author tags it. Tag syntax: `.claude/skills/save-plan/SKILL.md` Plan Rules. Rationale: agent-verifiable checks (`[auto]`, `[ui]`) close without a human round-trip while subjective checks still need the Human.

Plans with no tags behave exactly as before: everything is `[human]`.

| Tag | Checked by | Evidence | Use for |
| --- | --- | --- | --- |
| `[auto]` | the agent, one exact command | the command and its output / exit code | build, tests, exact CLI output |
| `[ui]` | one short end-to-end test per item (the project's e2e command, `commands.e2e`), then a browser agent only if that test fails or none can be written | the test's pass and its screenshot path | open a page, do one thing, see a quoted text or element |
| `[human]` | the Human | a validation word after the card | look and feel, product judgement, anything a script cannot decide |

The table below applies to `[human]` and untagged items:

| Validation (counts) | Does **not** count |
| --- | --- |
| `done` / `mark done` / `mark it` | `thanks` / `ok` / `cool` / `nice` |
| `verified` / `approved` | Emoji alone |
| `LGTM for this job` | Silence / moving to another topic |
| `/done` then Human confirms the list | CI green without Human looking |
| | `/ship` **Y** / `--yes` on its own — it is commit/push consent, not a check of the cards |
| | Agent: “I think we’re finished” |

---

## HOW TO VALIDATE checklist — the hand-off at the end of the work

### Core rule

- **Cards only when a human is needed.** Every Done-when item `[auto]` → the `VERIFIED BY AGENT` evidence block, no cards, no servers.
- **Cards when the work is finished** — never at plan start or at claim time. Show them and wait for `ok: <numbers>` / `done` / `verified` / `not yet` / `failed: <numbers>` (answered page by page, see "Faster hand-off") **before** `/ship`, opening a PR, or merging.
- **Servers first** (below): every page URL in the cards answers before the cards are shown.
- **Grouped by page** (Format, below), so the Human opens each page once.

Skip only for pure planning / architecture / docs-only turns with no behavior change to validate.

### When that moment is

| Situation | Where the cards appear | What `/ship` Phase 4 shows |
| --- | --- | --- |
| Worker finishes a plan in a slot (also the last of several plans run in one session) | The end-of-work close-out (`/take-plan` step "Close-out", JOB DONE block, Path B) — **before** `/ship`, a PR or a merge | `VALIDATED BY HUMAN` — one line per card with the Human's reply word |
| Chat job, no ship | The `/done` close-out (Path B) | — |
| Human runs `/ship` right after the work and no close-out happened | The Phase 4 approval tree — the agent stops there for the cards; **Y** alone does not validate them | the cards, then wait for a validation word |
| Merges pre-approved (the Human said "merges pre-approved" for this run) | **After** the merge, in the final message | — the `[human]` items stay `[ ]` until the Human replies |

The Human reads the cards while the app is running and the work is fresh, **not** while approving a commit. The commit gate repeats nothing: it records that validation already happened. If the agent cannot point to the Human's validation reply in this session, the cards are still open and `/ship` shows them first.

### Servers first (hard step)

Before the cards, every page URL in them must answer. The agent starts the servers itself — the Human never asks for the ports:

1. In a `wt-N` slot: `node scripts/slot-serve.mjs` (servers are off by default in a slot).
2. Outside a slot: the project's own dev command (its README or `package.json` scripts).
3. Open each page URL the cards name. One does not answer → read the log tail, fix the start (missing packages, env file, port held), and re-check. Never hand over cards with a page that does not answer.
4. No check needs the app (all in a terminal or outside the app) → no servers.

Slot servers stop again at the merge.

### Format — plain terminal text, grouped by place, one card per check

Cards are printed in a terminal (Claude Code) or in Cursor chat, so they are plain text: no colors, emoji, tables, circled digits or box drawing. Structure comes from indentation, rule lines and labels.

Two rules for everything the Human types:

- **Copy-ready.** Anything the Human must type, paste or run sits alone on its own line, with no label, bullet or word before or after it, so one triple-click selects exactly the value. Commands, paths, flags and numbers are English.
- **Hebrew only as app data.** A value is Hebrew only when it is literal data the app or database holds (a name, a label, an on-screen message). Write it exactly as the app has it, alone on its own line. Never put Hebrew and English words on one line: a terminal scrambles the order.

Places in click order: a page that creates data another page needs comes first. Numbers run on across places. Checks outside the app go in a last place named by its window. One `=` rule line separates places.

```text
HOW TO VALIDATE - {N} checks on {P} places
Reply any time, page by page: ok: <numbers> | failed: <numbers> <what you saw> | done | not yet | verify
Open all pages (paste in PowerShell):
Start-Process "{url 1}"; Start-Process "{url 2}"
==========================================================

PAGE: {Page name}
URL:  {full URL, a real id for :id routes}

[1] {plain title: what is checked}
    Before: {only when the check needs data or state that may not exist}
    Do:
      a) {one plain action: the spot on the page and what to click}
      b) {action that needs a typed value}, paste:
         {exact value, alone on its line}
    Expect: {what success looks like; quote on-screen text exactly}
    Fail:   {only when failure is more than "Expect did not happen"}

[2] {plain title}                        (needs [1] done first)
    Do:
      a) ...
    Expect: ...

==========================================================

PLACE: {exact window, e.g. "the Claude window of Worker slot 2"}

[3] {plain title}
    Do:
      {command, alone on its line}
    Expect: ...
```

Example (one app page, one terminal check):

```text
HOW TO VALIDATE - 2 checks on 2 places
Reply any time, page by page: ok: <numbers> | failed: <numbers> <what you saw> | done | not yet | verify
Open all pages (paste in PowerShell):
Start-Process "http://localhost:4200/records"
==========================================================

PAGE: Saved records
URL:  http://localhost:4200/records

[1] A new record shows up without a reload
    Do:
      a) At the top right, click "New record"
      b) In the name field, paste:
         Test record 1
      c) Click "Save"
    Expect: "Test record 1" is the first row of the list
    Fail:   the list stays the same until you reload the page

==========================================================

PLACE: the Claude window of Worker slot 2

[2] A finished branch is not reused    (squash merge = GitHub folds the branch into one commit on main)
    Before: plan 42's branch is already merged on GitHub (it is)
    Do:
      Paste:
         take plan 42
    Expect: a line ending
         was merged - starting fresh
    Fail:   it asks you to reset the branch by hand, or the push is rejected
```

### Card rules

- Written for someone who is not an engineer: any person can follow it without asking
- The header says how many checks on how many places and the reply words; every PAGE block carries the full URL, so the Human never scrolls back or asks for a port
- The title says what is checked and what it proves, in the user's words: never the commit subject or the plan's Done-when text. There is no WHY line. When a term of art can't be avoided, gloss it once in brackets after the title
- Before appears only when the check needs data or state that may not exist: one line saying how to get it, or that the agent already seeded it
- Rewrite each Done-when item in plain words: never copy the plan's wording verbatim
- One check per card, completable in under a minute
- Do is a list of steps a), b), c)…, one action each. A step names the spot on the page and what to click (the URL is in the PAGE block). A typed value follows a step that ends "paste:", alone on the next line. A terminal check puts the command alone on its line under Do and names the window in PLACE: never "run the script" or a description of a command
- Expect is required: quote on-screen text exactly, and put Hebrew text alone on its own line
- Fail appears only when failure is more than "Expect did not happen": a wrong result, a message that must not appear, a side effect
- A check that uses data another card creates says "(needs [n] done first)" after its title
- Cover the **happy path** and any **edge / failure rule** the job introduced (its own card)
- Bug fixes: the card triggers the previously broken scenario
- Never ask the Human to open DevTools, read source files, or work out a command themselves
- Non-visible changes (config, refactor, backend) with nothing to click: one line instead of cards: what changed and why no check is needed

### Faster hand-off: answer page by page, open every page in one line, data prepared

**Answering page by page.** The Human may answer in several messages while checking, in any order:

- `ok: 1,2` validates those cards.
- `failed: 3 <what you saw>` fails card 3; the words after the numbers are the first clue for the fix.
- `done` validates every card still unanswered. `not yet` validates nothing more and the agent asks what remains. `verify` is unchanged.

After each reply, before waiting again, the agent:

1. Records the validated cards. They become the `VALIDATED BY HUMAN` lines for ship, for exactly those cards: `ok:` for some cards never validates the others.
2. On `failed:`, starts the fix at once and does not wait for the other pages. It runs its own `[auto]` / `[ui]` checks, then re-shows only that card, marked `(re-check: fixed)` after the title.
3. Re-shows as `(re-check: fixed)` any card already answered `ok:` on a page the fix touched. A fix in shared code is stated in one line with the pages it may affect.
4. Queues replies that arrive during a fix and records them when the current step ends.

The hand-off ends when every card is validated; only then `/ship`, a PR or a merge.

**Open every page in one line.** After the servers answer (Servers first), the cards header carries two lines: a label line, then the command alone on its own line, with every page URL of the cards in click order. PowerShell: `Start-Process "<url>"` for each page, joined with `; `. Name another shell once in the label line when the Human is not on Windows (`open "<url>"` on macOS, `xdg-open "<url>"` on Linux). The URLs are exactly those in the PAGE blocks, with real ids. Print it whenever the cards name at least one page.

**Prepare the data the cards need.** The agent creates any record a check needs (the project's seed command, a script, or its dev API) in the slot's own dev database and puts the real id in the card's URL. Never in shared or production data, never with real customer data. Before appears only when the agent cannot prepare it (a real login, an outside service, a physical action), with one line saying how. A card that creates data a later card uses keeps "(needs [n] done first)": the Human does that part.

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

Then wait for `done` (or `not yet` / `failed: <numbers>`).

Do **not** ask “verify / I’ll check?” at task start — the checklist is unconditional at close-out; `verify` is opt-in after.

---

## Tier 1 — auto-verified

Runs automatically, without a `verify` reply, for `[auto]` Done-when items only. An item is `[auto]` when its expected output is exact: an exact string, an exit code, a byte-identical diff, `npm run build` or a test suite passing, or deterministic CLI output.

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

## Tier 1b — `[ui]`, checked by a script first, a browser only for failures

A `[ui]` item is one a script can check in the running app: **navigate** to one page, do **one action**, **assert** a
quoted text or element, **save a screenshot**. It sits between `[auto]` (no app needed) and `[human]` (a person's
judgement). Only the plan author tags it; an agent never re-tags `[human]` as `[ui]`.

- **The builder writes one short end-to-end test per `[ui]` item** with the project's e2e command
  (`commands.e2e` in the kit config; Playwright when the project has none), named after the item, that saves one screenshot. It reports
  per item: the card title, the page URL, the test command and the screenshot path.
- **The gate runs those tests.** A passing test is the evidence (`✓ [ui] {item} — {test} → pass; screenshot {path}`);
  that item never reaches a browser agent.
- **A browser agent looks only at the rest:** a test that failed, or an item no test can check. It gets the
  "pre-checked — skip" list (the items whose tests passed) and the known-findings list, and returns per item
  `pass`, `fail` or `plan-drift`.
- **Plan drift is not a bug.** "The plan says X, the app has Y" (a renamed button, a moved control) is reported in its
  own section with no severity and costs no fix round; the Human updates the card or the plan.
- **Environment first.** Before any browser step: the page's server answers, the QA login works, the backend answers
  from the page's origin. A blocked environment stops before the browser agent, with the reason, and costs no fix round.
- An item that stays unchecked (no test possible and no browser step) falls back to `[human]`: the Human still gets its card.

```text
VERIFIED BY AGENT
- ✓ [ui] {item} — `{test command}` → pass; screenshot `{path}`
- ⚠ [ui→human] {item} — {why no script or browser could check it}
```

---

## Path A — Formal ship (commit / push)

Order is hard (see `.claude/commands/ship.md` Phase 4 On approval):

0. Show **VALIDATED BY HUMAN** in the Phase 4 approval tree when the Human already answered the cards in this session (format below). When no close-out happened before `/ship`, run "Servers first", show **HOW TO VALIDATE** there and wait for a validation word — **Y** alone does not validate the cards (see "When that moment is").
1. Human **Y** (commit/push consent)
2. Mark matching todos / plan Atomic Sub-tasks `[x]`:
   - **Inside a `wt-N` slot:** mark `[x]` in the plan file's own Atomic Sub-tasks only. Never run `todo-query.mjs mark` or `todo-archive.mjs` — `.claude/todo.md` is Planner-owned; `todo-query.mjs sync --merged` picks up this plan's checkboxes once the branch merges.
   - **Outside a slot (Planner/main):** do not Read `.claude/todo.md` in full. Run `node scripts/todo-query.mjs open` (add `--plan NNN` when known), then `node scripts/todo-query.mjs mark --line N[,N…]` on matches (and the plan's Atomic Sub-tasks the same way); then `node scripts/todo-archive.mjs` to move fully-`[x]` plan sections into `.claude/todo-archive/NNN.md` volumes.
   - Never invent completion for work not in this ship. Never skip with "Contractor does not mark." No match → note `Todo: no matching open items — skipped`.
3. Stage with the job (+ brain if any)
4. Commit → push if asked

One commit. No second push just for checkboxes.

**Validated after the merge (slot):** when the Human validates `[human]` items only after the PR merged, the Worker does **not** open a branch or PR just to tick boxes. It tells the Human: "Tell the Planner: plan NNN validated (items …)". The Planner marks those items `[x]` in `plans/NNN-*.plan.md` on `main` (a Planner write it already owns) and runs `node scripts/todo-query.mjs sync --merged`.

**Already validated (format):**

```text
VALIDATED BY HUMAN
  - ✓ [1] {card title} — "{reply word}" (this chat, {time or turn})
  - ✓ [2] {card title} — "{reply word}"
  - ⚠ [3] {card title} — not answered yet → its card is repeated below
```

Only cards the Human did not answer are repeated under a HOW TO VALIDATE heading beneath it. A `[human]` item is validated only by a validation word (`done` / `verified` / `approved` …, or `ok: <numbers>` for exactly those cards) given after its card was shown — never by **Y** alone. A reply such as `done Y` both validates the cards and approves the commit.

**All items `[auto]`:** the `VERIFIED BY AGENT` block replaces HOW TO VALIDATE in the Phase 4 tree. **Y** is still required as commit/push consent. Todos marked on ship **Y** get no `(auto-verified)` suffix.

---

## Path B — Chat / small job (no ship, maybe no PR)

When the agent finishes a requested job and is **not** immediately entering `/ship`, pick the case by the plan's Done-when tags:

| Case | What the agent does |
| --- | --- |
| **All `[auto]`, all pass** | Print the `VERIFIED BY AGENT` block. Mark matching todos with `todo-query mark --line … --auto-verified`. Do **not** print the JOB DONE ask; the job finishes without a wait. |
| **Any `[human]` item** | Run "Servers first", then print the full close-out block: `VERIFIED BY AGENT` on top (the `[auto]` items), then HOW TO VALIDATE with a card for **only** the `[human]` items, then JOB DONE. Wait. |
| **No plan, or untagged items** | Unchanged: the close-out block below, then wait. |

For the last two cases:

1. **Must** end the turn with the close-out block below (do not skip).
2. Wait for Human reply.
3. On `done` / `mark done` / `verified` / `approved` / `mark it` / `LGTM for this job`:
   - Mark matching `.claude/todo.md` / plan Atomic Sub-tasks `[x]`
   - If a commit is about to happen in the same turn → stage todo/plan files in that commit
   - If no commit yet → mark on disk and say: `Todo: marked [x] (uncommitted — include in next commit)`
4. On `not yet` → leave `[ ]`; continue work.
5. On `failed: <numbers>` → leave `[ ]`; start fixing those checks at once (do not wait for the other pages), re-check, then re-show only their cards as `(re-check: fixed)` and wait again. On `ok: <numbers>` → mark exactly those cards validated and keep waiting for the rest.
6. On `edit list` → revise the matched-todo list; re-show the block; wait again.
7. On `verify` → run the optional agent-verify flow above, then re-show JOB DONE and wait.

### Required close-out block

```text
HOW TO VALIDATE - {N} checks on {P} places
Reply any time, page by page: ok: <numbers> | failed: <numbers> <what you saw> | done | not yet | verify
Open all pages (paste in PowerShell):
Start-Process "{url 1}"; Start-Process "{url 2}"
==========================================================

PAGE: {Page name}
URL:  {full URL}

[1] {plain title}
    Before: {only when needed}
    Do:
      a) {action}
      b) {action}, paste:
         {exact value, alone on its line}
    Expect: {success}
    Fail:   {only when needed}

[2] {plain title}                        (needs [1] done first)
    ...

==========================================================

PLACE: {exact window}

[3] ...

JOB DONE — awaiting your validation
Matched todos (still [ ]):
  - {plan / id / short text}
  - …
Reply: ok: <numbers>  |  failed: <numbers>  |  done  |  not yet  |  verify  |  edit list
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
2. **Worker (inside a `wt-N` slot):** stop there — append to the plan file **only**. Never
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
