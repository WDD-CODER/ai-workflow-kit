# Plan 033 — An unreadable state call is retried once and the park reason shows what the runner returned

Status: draft
Track: code — here (kit)
Snapshot: d21d4bcac6b004ea8c99b6695ed13248c5d8c528
Depends-on: none

## Problem Statement

A project run on kit v1.11.0 parked plan 506 at its first step with `worktree: unreadable ORCH_JSON from: node
scripts/orch-state.mjs worktree --run=run-506-508 --plan=506`. The workflow's journal shows the runner agent returned
exit 0 and a line that reads as well-formed JSON; the workflow could not parse what it received. Three things made
this cost a whole plan and a Planner round trip:

1. **One copy, no second try.** Every state command (`orch-state.mjs init / order / worktree / set / note / …`) goes
   through `runner()` in `core/.claude/workflows/orchestrate.js`: one `kit-runner` call on the mechanical model at
   `effort: 'low'`, which runs the command and copies the `ORCH_JSON` line into its result. The workflow is the only
   reader; it has no file access. A copy that does not parse ends the plan (`park('worktree: …')`) although the
   command itself succeeded — the slot was claimed, the branch created, and nothing used them. The workflow already
   retries a dead agent once (`ask()`, plan 029); it does not retry a live agent whose copy is bad.
2. **The failure says nothing.** `unreadable ORCH_JSON from: <command>` is the whole error. It carries neither the
   line the parser saw nor the parser's message, so the cause (a trailing character, a smart quote, a wrapped line, a
   `\r`, an escaped quote) cannot be told afterwards — this run's cause is still unconfirmed, and the raw output had
   to be dug out of the workflow journal by hand. A `no ORCH_JSON line` error names only the exit code.
3. **The runner ran commands nobody gave it.** The journal shows the same runner ran `git checkout main && git pull`
   in the main folder before the state command, and the parking runner ran `git pull --ff-only origin main` (exit 128,
   `Cannot fast-forward to multiple branches`). `kit-runner.md` says "never retry, never add flags" but not "never
   add a command"; the orchestrator's prompt says "exactly this one command, once" and the agent still prepared the
   folder on its own. In the main folder, during a run beside a Planner session, that is a write nobody asked for.

Smallest fix that removes the park: parse the line tolerantly, say exactly what was received when it still fails,
retry the state call once (safe: `orch-state.mjs worktree` already reuses the folder or slot a plan holds — a
relaunch path — and the other commands are idempotent, except `note` and `finish`, which are excluded), and close
the gap in the runner's rules.

## Goals & Success Criteria

**Primary:** a state command whose first copy does not parse is run once more before the plan is parked; when it
still fails, the park reason and the run note show the parser's message and the raw line; the runner runs only the
command it was given.

- [auto] `node --test tools/test/*.test.mjs` passes with new cases in `tools/test/orchestrator.test.mjs` (the `runFlow` harness gains a `runner(command, attempt)` hook that replaces the runner's returned output): a first `worktree` output of `ORCH_JSON {"ok":true,"path":"/wt/101"` + a smart quote (`“`) in place of the first `"` is followed by a second `worktree` runner command with label `worktree 101 retry` and `effort: 'medium'`, the plan reaches `merged`, and one run note matches `/runner retry: worktree 101 — first attempt: unreadable ORCH_JSON/`; two bad `worktree` outputs park the plan with a reason matching `/^worktree: unreadable ORCH_JSON from: .* after 2 attempts — .*raw: 'ORCH_JSON \{/` that also contains `non-ASCII U+201C at`; an output with no `ORCH_JSON` line at exit 0 is retried the same way and the double failure's reason matches `/no ORCH_JSON line .* after 2 attempts — last lines: /`; a `note` command and a `finish` command with a bad output are never run twice (exactly one runner command each); a line ending in `\r`, a line wrapped in backticks and a line with text after the closing `}` all parse without a retry (one runner command, plan merged).
- [auto] `node --test tools/test/orchestrator-folders.test.mjs` passes with a new case: `orch-state.mjs worktree --run r --plan NNN` run twice for the same plan returns the same `path` both times and creates no second folder and claims no second slot (`listSlots()` shows one slot with that plan, or one `<repo>-orch-<run>-<NNN>` folder).
- [auto] `node tools/orchestrator-e2e.mjs` passes with a new run `kappa` (fixture plan 601, one `[auto]` item): the stub runner garbles its first `worktree` answer for that run (the real `ORCH_JSON` line with its first `"` replaced by `“`); the run reports plan 601 `merged`, `runnerCommands` holds exactly two `orch-state.mjs worktree … --plan=601` entries, the scratch project has one worktree folder for plan 601, and `status.json`'s note list for 601 has one `runner retry: worktree 601` line whose text contains `raw: 'ORCH_JSON {` (quotes kept as `'`).
- [auto] `node tools/install-check.mjs` passes: `kit-runner.md` contains the sentence `Run only the commands in the list`; `orchestrator.md` contains `retried once` under "A dead agent, a loop, and "is it stuck?""; the rendered `orchestrate.js` contains `[capture]` in the runner prompt and the string `after 2 attempts`.
- [auto] `node tools/e2e-check.mjs`, `node tools/workflow-link-check.mjs`, `node tools/drift-check.mjs --target .`, `node tools/leak-check.mjs` and `npm run build` pass.

## Execution Mode

- Parallel: no (kit repo, solo flow)
- Concurrent plans: 030 (role lessons) also edits `orchestrate.js` and `orchestrator.md`; 031 edits `CHANGELOG.md`; whichever merges second rebases.
- Isolated DB: no

## Read-Write Scope

```scope
core/.claude/workflows/orchestrate.js
core/.claude/agents/kit-runner.md
core/docs/agent/orchestrator.md
core/docs/brain/gotchas/agent-workflow.md
tools/install-check.mjs
tools/test/orchestrator.test.mjs
tools/test/orchestrator-folders.test.mjs
tools/orchestrator-e2e.mjs
tools/fixtures/orchestrator/plans.mjs
CHANGELOG.md
scripts/**
.claude/**
docs/agent/**
docs/brain/**
.kit/install.json
plans/033-*.plan.md
```

## Read Scope

Entire repo.

## Escalation Protocol

A file outside the scope is needed → STOP, name the file, the change and why; offer `approved: <path>`; append it to
the scope block; retry.

## Architecture Impact

- INV-none: preserves — kit orchestrator tooling only; no project app file. A retried state command is one the
  first attempt already ran to completion (exit 0, a parsed-but-garbled copy) or that failed on its own; every
  retried command is idempotent on a second run (`worktree` reuses the plan's folder or slot by design, `set` /
  `handoff` / `release` / `stop` rewrite the same state), and the two that are not (`note`, `finish`) are excluded.

## Reuse Check

- Retry — family: `ask()` model fallback (plan 029) — rung: 2 — why: the same shape (one more call, one run note naming both attempts), one level up: a live agent whose copy is bad instead of a dead agent.
- Diagnostic error — family: `runner()`'s existing `error` strings — rung: 2 — why: the same field, with the parser's message and the raw line appended; no new result shape.
- Tolerant parse — family: `tools/test/ui-tier.test.mjs`'s `json()` reader (last `ORCH_JSON` line) — rung: 2 — why: the same lookup with `\r`, backticks and trailing text tolerated.
- Runner rule — family: `kit-runner.md` Rules list — rung: 2 — why: one more line in the list that already says "never retry, never add flags".

## Step 0 — Reality Check

`node scripts/scope-check.mjs --drift --plan=<this plan>`. On `REALITY: drift`, re-read `orchestrate.js` `runner()`,
`q()`, `state()` and `note()`, and `tools/test/orchestrator.test.mjs` `runFlow()`; plan 030 may have merged first.

## User Stories

- As the Human, a plan is not parked because an agent copied one line badly; the run tries once more and goes on.
- As the Human reading a parked plan, I see what the parser received and why it refused it, without opening a journal.
- As the Human working in the main folder beside a run, no runner pulls or switches branches there on its own.

## Functional Requirements

1. **Tolerant parse with a diagnostic error (A1).** `orchestrate.js` gains `readOrchLine(output)`: split on
   `/\r?\n/`, take the last line whose `trim()` starts with `ORCH_JSON `, strip leading and trailing backticks from
   it, and parse the text from its first `{` to its last `}` (inclusive). It returns `{ json }` or
   `{ error, raw, hint }` where `raw` is `JSON.stringify(line.slice(0, 300))` and `hint` is `non-ASCII U+XXXX at
   <index>` for the first character above `\x7e` when there is one (else omitted). When no line matches it returns
   `{ error: 'no ORCH_JSON line', last: JSON.stringify(<the last 3 non-empty lines joined by ' | '>) }`. `runner()`
   uses it; its error strings become `unreadable ORCH_JSON from: <command> — <JSON.parse message> — raw: <raw>[ —
   <hint>]` and `no ORCH_JSON line from: <command> (exit <n>) — last lines: <last>`.
2. **One retry (A2).** In `runner()`, when the first result is a parse failure (either error above) and the state
   command is not `note` and not `finish`, call the runner once more with the same prompt, label `${label} retry`
   and `effort: 'medium'` (through `ask()`, so it counts against `maxAgentCallsPerPlan`). A retry that parses is
   returned, and one run note is written through `note()`: `runner retry: <label> — first attempt: <first error>`
   (the note carries the raw line). A retry that fails again returns the second error with ` after 2 attempts`
   inserted after the command. `note` is excluded because the first attempt already wrote the line and a second
   would duplicate it; `finish` because it commits the report and a second run would report "nothing to commit" for a
   report that was committed. The command name is `argv[0]` of `state()` — pass it to `runner()` as an option
   (`{ once: true }` for the two excluded commands) so `runner()` stays generic for `orch-preflight.mjs`.
3. **Legible reasons and notes (A3).** `q()` maps `"` and backticks to `'` and `\` to `/` instead of a space (`$`,
   `\r` and `\n` still become a space), so a raw JSON sample inside a `--reason` or `--text` value keeps its shape in
   `status.json` and the report. The 400-character cap stays. Update any test that asserted the old spaces.
4. **The runner runs only its list (A4).** `kit-runner.md` Rules gain: "Run only the commands in the list — never a
   `git pull`, `git checkout`, `git fetch` or an install to prepare the folder, even when it looks behind; the list is
   complete." `runner()`'s prompt marks the command `[capture]` (so the runner's own `OUTPUT` block rule applies: full
   output, verbatim) and says "copy the `ORCH_JSON` line character for character — no reformatting, no wrapping, no
   quotes added". `RUNNER.output` gets a `description` saying the same.
5. **Relaunch safety proven (A5).** `tools/test/orchestrator-folders.test.mjs`: `worktree` twice for the same plan
   → same `path`, one folder or one slot (the code path at `orch-state.mjs` "A folder this plan already has wins").
6. **Docs and changelog (C1).** `orchestrator.md`, section "A dead agent, a loop, and "is it stuck?"": a bullet
   **A bad copy of a state line** — the runner's copy of `ORCH_JSON` that does not parse is retried once at effort
   `medium` (not for `note` and `finish`), a run note says `runner retry: …` with the first error, and a second
   failure parks the plan with the parser's message and the raw line. `agent-workflow.md` gotcha: **A state call can
   fail on the copy, not the command** (What hurt: plan 506 parked at `worktree` on exit 0; Why the obvious fix is
   wrong: raising the runner's effort everywhere costs every call for a rare event, and a file hand-off is out of the
   workflow's reach — it has no file access; What to do: retry once, keep the raw line in the reason). `CHANGELOG.md`
   Unreleased: Fixed (retry, diagnostic reason) and Changed (`q()` keeps quotes as `'`; runner rule). No project
   names.
7. **Tests (T1).** As in Success: the `runner(command, attempt)` hook in `runFlow` (records `opts.effort` in
   `calls`), the unit cases, fixture plan 601, run `kappa` in the e2e with the garbling stub, the folders test, the
   three install-check asserts.
8. **Render (R1).** `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .`.

## UI/UX Notes

- None (kit tooling).

## Atomic Sub-tasks

- [x] A1: Read the state line tolerantly and say exactly what was received when it still does not parse — readOrchLine(): \r, backticks and trailing text tolerated; error carries the parser message, the raw line (300 chars, JSON-escaped) and a non-ASCII hint; no-line error carries the last lines — core/.claude/workflows/orchestrate.js
- [x] A2: Run a state command once more when its copy does not parse, so one bad copy no longer parks a plan — retry at effort medium with label suffix retry, one run note with the first error, second failure says after 2 attempts; note and finish never retried — core/.claude/workflows/orchestrate.js
- [x] A3: Keep quotes legible in reasons and notes so the raw line survives the state write — q() maps " and backticks to ' and backslash to /, cap unchanged — core/.claude/workflows/orchestrate.js, tools/test/orchestrator.test.mjs
- [x] A4: Tell the runner to run only the commands it is given and to copy the state line untouched — Rules line in kit-runner.md; [capture] and the copy sentence in the runner prompt; RUNNER.output description — core/.claude/agents/kit-runner.md, core/.claude/workflows/orchestrate.js
- [x] A5: Prove a second worktree call reuses the plan's folder or slot, so the retry is safe for it — folders test: worktree twice, same path, one folder or slot — tools/test/orchestrator-folders.test.mjs
- [x] C1: Explain the retry, the reason text and the runner rule in the docs, one gotcha and the changelog — orchestrator.md bullet, agent-workflow.md gotcha, Unreleased Fixed and Changed — core/docs/agent/orchestrator.md, core/docs/brain/gotchas/agent-workflow.md, CHANGELOG.md
- [x] T1: Prove each change with tests that would fail today — runner hook in runFlow, the unit cases, fixture plan 601, e2e run kappa with a garbled first worktree answer, install-check asserts — tools/test/orchestrator.test.mjs, tools/orchestrator-e2e.mjs, tools/fixtures/orchestrator/plans.mjs, tools/install-check.mjs
- [x] R1: Render the kit's own copies and check drift — scripts/, .claude/, docs/agent/, docs/brain/, .kit/install.json

## Technical Considerations

- The workflow script has no file access (only `agent`, `parallel`, `pipeline`, `phase`, `log`); the runner's
  copy is the only channel for a command's result, so the fix has to live on the reading side and in the prompt.
- A retried state command re-runs for real. Idempotence per command: `init` creates the merge folder only when
  missing; `order`, `check-files`, `plan-info`, `diff`, `clean` read; `worktree` reuses the plan's folder or slot;
  `set`, `handoff`, `release`, `stop` rewrite the same state; `note` appends (excluded); `finish` commits the report
  (excluded). `orch-preflight.mjs` reads only.
- The retry is one more `kit-runner` call only when a copy failed; no cost on a normal run. The run note on a
  successful retry is one more call, kept because it is the evidence the Human asked for after this run.
- `effort: 'medium'` on the retry makes the second attempt differ from the first when the copy itself is the cause;
  when the command's own output is the cause, the raw line in the reason shows it.
- `q()`'s change touches every `--reason` / `--text` value: a quote inside a note now shows as `'` instead of a
  space. Shell safety is unchanged (a `'` inside a double-quoted shell word is literal; `$`, backticks and `\` are
  still neutralised).

## Out of Scope

- Changing the runner's model or default effort (`models.mechanical`, `effort: low`) for every call.
- A file-based hand-off between `orch-state.mjs` and the workflow (the workflow cannot read files).
- Retrying role agents (builder, gate, checkers) on a bad result — they return structured output, not a copied line.
- The security findings on `[auto:main]` checks running without `go` (a separate decision).
- Plan 030's lessons and run log; plan 031's required-step markers.

## Critical Questions

- Q: Why not raise the runner to `medium` everywhere? A: every state call would pay for an event seen once; a retry pays only when it happens, and at `medium`.
- Q: Why retry every state command and not only `worktree`? A: the same copy can fail on any of them, and all but `note` and `finish` are idempotent; excluding those two is cheaper to reason about than listing the safe ones.
- Q: Why keep the raw line JSON-escaped? A: a `\r`, a tab or a zero-width character is invisible in plain text; `JSON.stringify` shows it, and the non-ASCII hint names the first odd character outright.
- Q: Does `[capture]` change what the runner returns? A: it makes the runner's own output rule (full output, verbatim) apply to the state command — the two runners of this run differed exactly there (one echoed the output, one did not).

## Execution Notes

- Origin (2026-10-29): a project run on kit v1.11.0 parked plan 506 at `worktree: unreadable ORCH_JSON …`. The
  workflow journal shows the runner's result as exit 0 and `ORCH_JSON {"ok":true,"path":"…-wt-2","branch":"feat/506-…",
  "base":"origin/orch/run-506-508","head":"3c7fa02…","dirty":[],"slot":2}` with a trailing newline; the parser's
  verdict came from the workflow. The cause stays unconfirmed (no raw line was kept by the kit); this plan keeps it
  next time. The same journal shows the runner running `git checkout main && git pull` before its command, and the
  parking runner running `git pull --ff-only origin main` (exit 128).
- Live check outside this plan's Done-when: the rerun of plan 506 in the same project after the kit is synced.
- Built 2026-10-29. Two details differ from the draft: the non-ASCII hint comes *before* the raw line (a note or
  reason is cut at 400 characters and the hint is the short part), and in the workflow's own result the raw line is
  JSON-quoted with `"` — the `'` form is what the state write (`q()`) stores in `status.json`. The e2e asserts the
  latter, the unit test the former.
- The A5 folders test first met a leftover of its own: orch-state names the merge and builder folders after the
  configured repo, beside the main folder, so a scratch repo straight in the temp folder shared one merge folder with
  the previous run. The test now puts its repo in a folder of its own.
- Evidence (2026-10-29): unit tests 176/176 (37 orchestrator, 14 folders), orchestrator e2e 84 cases (run `kappa`
  included), e2e-check 53 cases, install-check, workflow-link-check, drift-check (0 undeclared), leak-check (0 leaks)
  and `npm run build` pass.
