# Plan 112 — The fleet run panel shows live progress: each step, a ticking clock, the gate check running now and what the builder is doing

Status: draft
Depends-on: none
Snapshot: 6218247
Source: the Human, 2026-11-09, on FoodVibe run-519. The fleet run chip appeared only after the Human sent a message, and then showed only `529 · merged ✓ / 531 · building · 1 min`. The Human approved this plan as an exception to the 2026-11-09 freeze ("plan A+B+C"). Part A1 is the bug fix; the rest is new capability the Human asked for.

## Problem Statement
1. **The chip does not start on its own.** `mods/fleet/hooks/run-progress.tsx` `registerRunProgress` arms its watch (`watchingUntil`) only after a `Workflow` tool call. Since plan 088 / ADR 0017, `/orchestrate` starts `scripts/run-supervisor.mjs` with a plain Bash call and returns, so nothing arms the watch. Fleet re-reads runs only at session start and at each answer's end. At that moment `status.json` often does not exist yet, so no timer starts until the Human sends another message.
2. **The panel shows almost nothing.** It shows one word per plan and the minutes since the last state change. The run already records far more:
   - `status.json`: `history[]` with a time per state, `models.<stage>.model`, `round` and `tier`.
   - `calls.csv`: per call, the seconds, the tokens and the exit code of every builder, reviewer and gate command.

   None of this is shown.
3. **Nothing says what is happening inside a step.**
   - The gate runs 10–20 checks; plan 529's took 3 min 43 s, and `test:ci` alone took 2 min 18 s. Nothing records which check is running.
   - The builder's `claude -p --output-format json` call prints only at its end (plan 529's builder ran 2 min 39 s, with 667k tokens in). Nothing shows its tools, files or tokens while it works.
   - The old "current agent" line read the Workflow `journal.jsonl`, which no longer exists. `findWorkflow` and `openAgent` in run-progress.tsx are dead code.

## Goals & Success Criteria
**Primary:** while an orchestrator run is live in this checkout, fleet shows the run chip without the Human typing anything. Its panel shows, per plan: a step bar (build · gate · review · merge) with each finished step's time; a clock ticking every second on the running step; the model, the round and the tokens; in the gate, the check running now ("gate 4/16: pnpm run test:ci · 0:42"); in the builder, a live "now:" line with the last tool, its file, the tool count and the tokens so far. The run line carries the total elapsed time and the total tokens.

Target layout (each line is truncated at the terminal width):
```
run run-519 · 63% · 14:02 · 1.1M tokens
 529 ✓ merged    build 2:39 · gate 3:43 · review 0:08 · merge 0:41
 531 ▶ building  [build ▶ · gate · review · merge]  1:12  sonnet · round 0
      now: Edit server/mcp/mongo.ts · 23 tools · 210k tokens
 532 · waiting
```

- [auto] `node --test tools/test/run-plans-live.test.mjs` passes. It fails on today's code and covers:
  - the scratch-project fixture's run with the fake `claude` writes `.claude/orchestrator-runs/<run>/live-<NNN>.json` holding `gate: { index, total, command, startedAt }` while a gate command runs;
  - after the builder's call it holds `builder: { tools, lastTool, lastTarget, tokensIn, tokensOut, at }` with the counts the fake's stream printed;
  - `builder-<NNN>.events.jsonl` holds the fake's stream lines;
  - the plan still ends `merged`.
- [auto] `node --test tools/test/claude-run-stream.test.mjs` passes:
  - `runAgent` with `stream` set returns the same `text`, `usage`, `tokens`, `costUsd`, `ok` and `error` for a stream whose final `result` event equals `tools/test/fixtures/claude-p-ok.json` as the JSON mode returns for that file;
  - `onEvent` gets each event in order;
  - a tool result that contains the words "rate limit" does not set `rateLimited`; only the `result` event, stderr or `api_error_status` 429 can.
- [auto] `node --test tools/test/run-plans.test.mjs tools/test/run-plans-ask.test.mjs tools/test/run-plans-final-only.test.mjs tools/test/run-supervisor.test.mjs` pass unchanged. The reviewer call still uses `--output-format json`.
- [auto] Fleet:
  - `claude plugin validate mods/fleet` and `claude plugin test mods/fleet` pass.
  - The new tests in `mods/fleet/tests/run-progress.test.ts` cover the cases below. The Bash test fails on today's code:
    - a `Bash` tool call whose command contains `run-supervisor.mjs` or `run-plans.mjs` sets `watchingUntil`, and a plain Bash call does not;
    - the step bar and step times built from a `status.json` history plus `calls.csv` rows;
    - the gate and builder lines from a `live-<NNN>.json`;
    - the run totals;
    - a missing or half-written live file falls back to the plain line.
  - `grep -n "journal" mods/fleet/hooks/run-progress.tsx` prints nothing.
- [auto] `npm run build`, `npm run lint`, `npm test` (it includes the size budget), every kit tool test (`node --test` over `tools/test`), `node tools/leak-check.mjs` (as CI runs it on mods/) and `node tools/drift-check.mjs --target .` pass. The kit sync with apply runs first; it is a step, not a check.
- [auto] `node tools/validate-orchestrator.mjs --mode real` reports every case PASS before the release (the freeze's release rule; about 600k tokens).
- [human] On FoodVibe, after syncing the release and updating fleet, start `/orchestrate` on one plan and send nothing more. Within a minute the run chip appears. Pressing it shows:
  - the step bar, with a clock that visibly ticks;
  - during the gate, a "gate n/N: <command>" line;
  - during the builder, a "now:" line whose tool count rises.

  Reply `ok`, or name what is missing.

## Execution Mode
- Parallel: no.
- Concurrent plans: none.
- Isolated DB: no.
- Run: **solo flow** (`git switch -c feat/112-fleet-live-run-panel` from `origin/main`, build here, then `/ship`). Not `/orchestrate`: the plan changes the builder call `/orchestrate` runs.
- After the merge: release `v3.1.0` (new capability, no project action; fleet `0.6.0`). The Human approves the merge.

## Read-Write Scope

Always allowed: this plan file itself, `.claude/sessions/**`, `.kit/install.json`, plus the append-only hotspots `CHANGELOG.md` and `docs/brain/error-review.md`.

```scope
core/scripts/run-plans.mjs
scripts/run-plans.mjs
core/scripts/lib/claude-run.mjs
scripts/lib/claude-run.mjs
core/scripts/lib/plan-gate.mjs
scripts/lib/plan-gate.mjs
core/scripts/lib/run-live.mjs
scripts/lib/run-live.mjs
core/docs/agent/orchestrator.md
docs/agent/orchestrator.md
tools/test/run-plans-live.test.mjs
tools/test/claude-run-stream.test.mjs
tools/test/fixtures/fake-claude.mjs
tools/test/fixtures/claude-p-stream.jsonl
tools/test/lib/run-plans-fixture.mjs
mods/fleet/hooks/run-progress.tsx
mods/fleet/hooks/register.tsx
mods/fleet/types/index.d.ts
mods/fleet/tests/run-progress.test.ts
mods/fleet/.claude-plugin/plugin.json
mods/README.md
mods/SECURITY.md
kit.json
CHANGELOG.md
docs/brain/error-review.md
```

## Read Scope

Entire repo.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a step needs a file outside
the `## Read-Write Scope`: STOP, tell the Human the file, the change, and why; offer `approved: <path>`; then append
the path to the scope block and retry.

## Architecture Impact
- INV-1: preserves. The builder runs on the same model and tier with the same flags, plus `--output-format stream-json --verbose` in place of `--output-format json`. The reviewer call is unchanged. No tier, setting or agent changes.

## Step 0 — Reality Check
1. `core/scripts/lib/claude-run.mjs`:
   - `claudeArgs` (l.74–88) and `spawnClaude` (l.163–210): stdout is buffered whole; `lastActive` already counts output as activity.
   - `runAgent` (l.221–252): `JSON.parse(r.stdout)` and the `RATE_LIMIT_RE` test over all of stdout. With a stream, stdout holds tool results (file contents), so that test must move to the `result` event and stderr only.
2. Confirm with one real `claude -p --output-format stream-json --verbose` call, in a scratch folder with a trivial prompt:
   - the final line is `{"type":"result", …}` with the same `result`, `usage`, `total_cost_usd`, `is_error` and `api_error_status` fields as the JSON mode;
   - assistant messages carry `message.content[]` items of `type: "tool_use"` (`name`, `input.file_path` / `input.command` / `input.pattern`) and `message.usage`.

   Save a trimmed copy as `tools/test/fixtures/claude-p-stream.jsonl`, with no machine paths.
3. `core/scripts/run-plans.mjs`:
   - the builder call at l.983 (`modelCall` → `runAgent`);
   - the gate calls at l.1040 and l.1047 and the final gate at l.1344, through `runGate` in `core/scripts/lib/plan-gate.mjs` l.175 (only `onResult` today);
   - `setPlan` (l.800) goes through an `orch-state.mjs set` subprocess per write: too slow for live events, so the live file is written in-process.
4. `mods/fleet/hooks/run-progress.tsx`:
   - `registerRunProgress` (l.327);
   - `scanRuns` (l.267);
   - `RUN_POLL_MS` 30 s (l.15);
   - the dead `findWorkflow`, `agentNow` and `openAgent` (journal);
   - `mods/fleet/hooks/register.tsx` l.605 and l.695 call `refreshRuns`;
   - how `$.fs.read` handles a file another process is renaming over (a half-read must fall back, never throw out of a hook).

## Atomic Sub-tasks
- [ ] A1: Make the run chip start watching when `/orchestrate` starts a run. In `registerRunProgress`, also arm on a `Bash` tool call whose command names `run-supervisor.mjs` or `run-plans.mjs`. Delete the `Workflow` trigger and the journal code (`findWorkflow`, `agentNow`, `openAgent`, `journalNamesRun`). Files: mods/fleet/hooks/run-progress.tsx, mods/fleet/tests/run-progress.test.ts
- [ ] B1: Make the gate report the check it is starting. Add `onStart({ command, index, total })` to `runGate`, called before each command; the retry reuses the same index. Files: core/scripts/lib/plan-gate.mjs
- [ ] B2: Add a small live-file writer, `writeLive(runDir, nnn, patch)`. It merges the patch into `live-<NNN>.json`, writes a temp file and renames it over, and writes at most once per 2 s per plan, except a step change, which writes at once. It never throws. Files: core/scripts/lib/run-live.mjs
- [ ] B3: Wire the live file into the run.
  - The plan gate's and the final gate's `onStart` write `gate`.
  - Each `setPlan` state change writes `step` and `stepAt`, and clears `gate` and `builder` when the step changes.
  - Files: core/scripts/run-plans.mjs
- [ ] C1: Let the builder call stream. Add an optional `stream: { onEvent }` to `runAgent`:
  - `claudeArgs` swaps `--output-format json` for `--output-format stream-json --verbose`;
  - `spawnClaude` splits stdout into lines and calls `onEvent` with each parsed event, ignoring lines that do not parse;
  - the final `result` event becomes the `json` the existing code reads;
  - `rateLimited` reads only the result event's text, stderr and `api_error_status`.

  Without `stream`, nothing changes. Files: core/scripts/lib/claude-run.mjs
- [ ] C2: Make the builder call stream into the run folder. Each event line is appended to `builder-<NNN>.events.jsonl`. For each assistant event, count the `tool_use` items, keep the last tool name and its target (`file_path`, else the first 60 characters of `command`, else `pattern`), and add up `usage` input and output tokens. Write them as `builder` through `writeLive`. Files: core/scripts/run-plans.mjs
- [ ] C3: Teach the fake `claude` to stream. When its argv has `stream-json`, it prints two `tool_use` assistant events, then the `result` event, instead of the single JSON. Write the stream and live-file tests. Files: tools/test/fixtures/fake-claude.mjs, tools/test/fixtures/claude-p-stream.jsonl, tools/test/run-plans-live.test.mjs, tools/test/claude-run-stream.test.mjs, tools/test/lib/run-plans-fixture.mjs
- [ ] A2: Show it in the panel.
  - Read `calls.csv` and `live-<NNN>.json` next to `status.json`; skip a file over 1 MiB.
  - Per plan, show the step bar from `history` (build covers building and fixing; gate; review covers checking; merge covers merging), each finished step's time, the model, the round and the tokens.
  - Show a gate line while `gate` is set and a "now:" line while `builder` is set.
  - The run line shows the total elapsed time and the total tokens.
  - Re-read the disk every 5 s while a run is live (30 s before). Redraw the clocks every second only while the panel is open, from the stored times and with no disk read.
  - Files: mods/fleet/hooks/run-progress.tsx, mods/fleet/types/index.d.ts, mods/fleet/hooks/register.tsx, mods/fleet/tests/run-progress.test.ts
- [ ] D1: Document it.
  - Describe the live file and the events log in orchestrator.md (what is in them, that they stay local under `.claude/orchestrator-runs/`, and that nothing reads them back into a run).
  - Update the panel paragraph in mods/README.md.
  - Add the new reads (`calls.csv`, `live-*.json`) to the fleet section of mods/SECURITY.md.
  - Files: core/docs/agent/orchestrator.md, mods/README.md, mods/SECURITY.md
- [ ] R1: Resync the installed copies (`node tools/sync.mjs --target . --apply`) and run every check above. Then:
  - one error-review row for the chip that never armed;
  - the CHANGELOG `## [3.1.0]` section;
  - `kit.json` 3.1.0 and fleet `plugin.json` 0.6.0;
  - the real-mode validation run.

  Files: kit.json, CHANGELOG.md, docs/brain/error-review.md, mods/fleet/.claude-plugin/plugin.json

## Technical Considerations
- **Risk is in C1.** The builder's result must parse exactly as before, or every run breaks.
  - The JSON path stays as it is, and the stream path only feeds it the `result` event.
  - The stream test compares both paths on the same answer.
  - The fake `claude` streams, so every existing run-plans test runs the stream path.
  - The real-mode validation run is the last proof before the release.
- `spawnClaude` keeps buffering stdout for the error tail. The events log can grow to a few MB per builder call. It stays in the run folder, which is git-ignored and local. Fleet never reads it, only the small live file.
- Rate-limit detection over streamed stdout would match the words "rate limit" in any file the builder reads. Hence the C1 rule, and its test.
- Live writes are best-effort: a failed write never stops or slows a run (try/catch, temp file plus rename, a 2 s throttle).
- No new `kit.config.json` key: streaming is always on for the builder. The orchestrator-key size budget stays at 15.
- `run-plans.mjs` is 1563 lines. The live logic sits in `lib/run-live.mjs`, so run-plans gains only the wiring.

## Out of Scope
- Streaming the reviewer, which takes a few seconds.
- A live view anywhere other than fleet's panel (the status line, the phone push, `orch-state.mjs watch`).
- Per-tool history or a scrollback view of the events log.
- Changing what `status.json` holds.
- FoodVibe's own runs and settings.

## Critical Questions
None open. The Human chose A+B+C on 2026-11-09.

## Execution Notes
