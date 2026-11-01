---
description: Kit repository only — read the new run evidence, keep the problem ledger, show at most 5 problem cards, and turn the Human's one-line reply into plans, lessons or dismissals
allowed-tools: Read, Grep, Glob, Bash
---

# /kit-learn — the kit learns from its runs

Kit repository only: the command, `tools/kit-learn.mjs` and `tools/kit-lessons.mjs` are never rendered into a project.
It needs `KIT_BRAIN_READER_URI` (`docs/agent/kit-brain.md` "Setup"); without it every step below stops at its first line.
The ledger statuses, the reply grammar, kit lessons and the protected paths are in `docs/agent/kit-brain.md` "Kit side".

Run it in a kit session on a `feat/`/`chore/` branch or on `main` for reading; the plans it drafts follow the usual flow.

1. **Collect and show the trend.**

   ```bash
   node tools/kit-learn.mjs trend --line
   node tools/kit-learn.mjs collect
   ```

   Print the first command's one line (the last 3 kit versions) before anything else. `collect` reads the new evidence,
   updates the ledger and prints the ranked table and a `CARDS:` line with at most 5 ids (regressed first). Nothing to
   show (`CARDS: (none)`) → say so and stop.

2. **Write one card per id on the `CARDS:` line — never more than 5.** Read the kit code the evidence points at first
   (`node tools/brain-query.mjs events --signature "<signature>"` lists the problems; the plan, role file or test the
   signature names is read, not guessed). Each card is one plain-text block, in this order:

   ```text
   I1 · regressed · gate (main folder): <check> needs a slot stamp     runs 3 · projects 1 · lost ~95 min
     seen:      run-499-502 (500 parked after 3 rounds), …   last kit v1.14.0 (has fix 040 @ 3f2a…)
     cause:     core/.claude/workflows/orchestrate.js mainCheckProblem — checks the command's shape, not where it can run
     missed by: readiness (no slot-state rule) · tests (orchestrator.test.mjs l.551 expects a fix round)
     options:   a) drop at launch (040 did)  b) rewrite --since  c) run in a slot
     recommend: amend 040's A1 regex to also match <new form>   guard: fixture <name> in tools/test/orchestrator.test.mjs
     reply:     I1 plan | I1 amend <NNN> | I1 lesson <role> | I1 enforce | I1 dismiss <why> | I1 later
   ```

   - `cause` is `file:symbol` of real kit code you read. `missed by` names the check, agent rule or test that should have
     caught it. `options` are the real alternatives; `recommend` is one of them, and its reply token is written to the
     card record (step 3).
   - A `drift` card (a kit lesson whose problem came back) recommends `enforce`. A `retire` card recommends
     `lesson <role>`, which for that card means `node tools/kit-lessons.mjs retire K<n> --reason enforced:<fixture>`
     (a `safety` line is never offered; retiring one needs the Human's `--human`).
   - A recommendation that names a protected path (`tools/lib/kit-learn/protected.mjs`: the graders, the signature and
     minutes code, this tool, the leak and secret checks) is shown as `human-only`; list those paths in the record.
   - Plain words for the Human: no ledger jargon beyond the ids.

3. **Record the cards, then wait for one reply.** Write `.kit-learn/cards.json` (gitignored) as
   `{ "I1": { "recommend": "plan", "text": "<the card's recommendation, one line>", "paths": ["<files the fix touches>"] }, … }`,
   (`collect` already recorded the `CARDS:` ids as shown) and show the cards. Ask for one line:
   `I1 plan · I2 lesson builder · I3 dismiss covered by 040 · I4 later` — or `ok` to accept every recommendation, or
   `ok · I3 dismiss …` to override single cards. Do nothing else until the reply arrives; a card left unanswered for
   14 days is recorded `expired`.

4. **Apply the reply.**

   ```bash
   node tools/kit-learn.mjs apply --reply "<the Human's line>"
   ```

   An unknown token is refused with the allowed list: show it and ask again. Otherwise it writes one `proposals` row per
   card, sets the issue statuses and prints `NEXT:` lines.

5. **Carry out each decision** (the `NEXT:` lines say how):
   - `plan` → `/plan` with `Source: brain issue <id>` under the title and the card as its problem statement. The plan
     needs an Atomic Sub-task that names a test under `tools/test/` or `tools/fixtures/` (the problem reproduced);
     `node tools/kit-learn.mjs plan-check <plan>` must pass; the next `collect` links the plan to the issue by that `Source:` line.
   - `amend <NNN>` → edit that open plan's sub-tasks (a regression-test sub-task included), add `Source: brain issue
     <id>`; `plan-check` must pass.
   - `lesson <role>` on a `retire` card → `node tools/kit-lessons.mjs retire K<n> --reason enforced:<fixture>` and
     `node tools/kit-lessons.mjs check`. On any other card → propose one line of text and its reason, then
     `node tools/kit-lessons.mjs add --role <role> --text "…" --why "…" --issue <id>`; the tool writes the line, you do not.
     Then `node tools/kit-lessons.mjs check`.
   - `enforce` → `/plan` for the check that makes the lesson unnecessary (same `Source:` rule).
   - `dismiss` and `later` need nothing more.
   After a change to a source under `core/`, `node tools/sync.mjs --target . --apply` then
   `node tools/drift-check.mjs --target .` in the same branch.

6. **Close.** One line per decision: what was recorded and what is left for the Human (a plan to approve, a branch to
   ship). Never merge, never write `Arch-approved:`, never edit a protected path without the Human's `approved: <path>`.
