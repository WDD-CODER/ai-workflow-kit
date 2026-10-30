# Plan 039 — Fleet shows orchestrator run progress in the dock

Status: draft
Track: code — here (kit)
Snapshot: 95a75dbcdfae0d7cf42e998ab29d9d17884f2397
Depends-on: none

## Problem Statement

While `/orchestrate` runs, the Human cannot see what it is doing. The Claude Code `/workflows` view shows only a few
lines per agent, too small to read. To follow a run today the Human has to know and type
`node scripts/orch-state.mjs watch --run <run>` in a second terminal, and that still prints only one line
(`RUNNING`), not which plan is in which stage. First seen in a project on a one-plan run: the Human asked twice
"is it stuck?" while the builder was working normally.

1. Nothing in the dock says a run is live, which plan is where, or how far along it is.
2. The information already exists on disk (`.claude/orchestrator-runs/<run>/status.json`, the workflow's
   `journal.jsonl`) but nothing turns it into plain lines.

## Goals & Success Criteria

**Primary:** while a run is live in this checkout, fleet's dock shows a run chip with a %. Pressing it opens a panel
with one plain line per plan (stage, how long in it, what the current agent is doing) and the run's watch line.
It costs zero model tokens: fleet only reads files and runs `orch-state.mjs watch`.

- [auto] Fleet finds every live run under `<checkout>/.claude/orchestrator-runs/*/status.json` whose `phase` is not
  finished/stopped, and renders a dock chip `run <name> NN%`. The % = (merged plans + stage weight of each open plan) /
  plan count, with stage weights building 0.25 · gate 0.5 · checking 0.75 · merging 0.9 · merged 1 · parked 1.
- [auto] Pressing the chip (hotkey `o`) opens a panel under the dock: one line per plan in wave order:
  `506 · checks (build running) · 3 min`. Below the plan lines comes the latest `orch-state.mjs watch` line. A `STUCK: …`
  line turns the chip and panel to the warning colour. Pressing again closes it.
- [auto] The "what the current agent is doing" part comes from the newest workflow `journal.jsonl` whose entries name
  the run. It shows the label of the last `started` entry with no matching `result` (`builder 506 build first`) and the
  age of that agent's transcript file. A missing or unreadable journal leaves that part out and never throws.
- [auto] The panel refreshes at each answer's end and on a timer of at most 30 s while a run is live; no timer
  runs when no run is live.
- [auto] `claude plugin validate` and `claude plugin test` pass for fleet. New tests cover the % maths, the
  live/finished filter, the stage line wording, STUCK colouring, a missing journal, and a check that fleet makes no
  `$.model` / `prompt.compose` use for this (grep finds none in the new code).
- [auto] `node tools/install-check.mjs`, `node tools/leak-check.mjs` and `npm run build` pass. `leak-check` finds no
  project name in the new files.
- [human] During a real `/orchestrate` run, the dock shows the run chip with a %. Pressing it shows each plan's stage
  in plain words that match `status.json`, and the line moves on when the plan does (building → checks → reviewers →
  merged).

## Execution Mode

- Parallel: no (kit repo, solo flow)
- Concurrent plans: 038 is open in the kit main folder (save-plan, `.kit/install.json`): no overlap with `mods/fleet/**`.
- Isolated DB: no

## Read-Write Scope

```scope
mods/fleet/hooks/register.tsx
mods/fleet/hooks/run-progress.tsx
mods/fleet/types/index.d.ts
mods/fleet/tests/run-progress.test.ts
mods/fleet/tests/fleet.test.ts
mods/fleet/.claude-plugin/plugin.json
mods/README.md
CHANGELOG.md
plans/039-*.plan.md
```

## Read Scope

Entire repo, plus `core/scripts/orch-state.mjs`, `core/scripts/lib/orch-run.mjs` and
`core/.claude/workflows/orchestrate.js` for the status and journal shapes.

## Escalation Protocol

A file outside the scope is needed → STOP, name the file, the change and why; offer `approved: <path>`; append it to
the scope block; retry.

## Architecture Impact

- INV-none: preserves — fleet gains a read-only view of files the orchestrator already writes. It never writes to a run,
  never starts or messages an agent, and adds no model call. The mod count stays at three (feature goes into fleet).

## Reuse Check

- Panel — family: ship-pilot's plan panel (chip opens a panel under the dock, K7) — rung: 2 — why: same chip → panel
  pattern and dock entry helpers (`dockEntry`, `drawDock`), new data source.
- STUCK logic — family: `orch-state.mjs watch` (`watchLine`) — rung: 1 — why: run the existing command and show its
  line instead of re-implementing stale detection in the mod.
- New file `run-progress.tsx` — family: `quick-reply.tsx` (a fleet feature in its own file, called from register) — rung: 2.

## Step 0 — Reality Check

`node scripts/scope-check.mjs --drift --plan=<this plan>`. Read the current `status.json` shape (plan `state` values
and `history`) and the workflow `journal.jsonl` entry shape (`started` / `result`, `label`, `agentId`). Confirm how a
run maps to its workflow folder: the run name appears in the journal entries' output. If it doesn't, say so before
building and fall back to status.json only. Confirm fleet's dock API still matches K7's panel pattern.

## User Stories

- As the Human starting `/orchestrate`, I see at a glance that the run is live and how far it is, without a second
  terminal.
- As the Human wondering "is it stuck?", I press the % and read which plan is in which stage, for how long, and what
  the agent is doing, in plain words.

## Functional Requirements

1. **Find runs (A1).** Scan `.claude/orchestrator-runs/*/status.json` in the session's checkout; keep runs whose
   `phase` is live. Stage words: building → "building", gate → "checks", checking → "reviewers", merging → "merging",
   merged → "merged ✓", parked → "parked: <reason>".
2. **Chip and panel (A2).** Dock chip `run <name> NN%`, hotkey `o`, panel lines as in Success; `watch` line last;
   warning colour on `STUCK`. Several live runs → one chip each.
3. **Agent detail (A3).** Newest workflow folder whose journal names the run; open agent = last `started` without a
   `result`; show its label and the transcript's age. Every read is guarded and never throws.
4. **Refresh (A4).** At each answer's end, plus a ≤30 s timer only while a run is live.
5. **Tests, docs, version (A5).** Fleet tests; `mods/README.md` one paragraph; `CHANGELOG.md` Unreleased → Added;
   fleet version bump in `plugin.json`.

## UI/UX Notes

- Plain words, one line per plan, no raw JSON or agent ids. Example panel:

```text
run run-506-506 · 55% · RUNNING
  506 · checks (build running) · 3 min
```

## Atomic Sub-tasks

- [x] A1: Find the live orchestrator runs in this checkout and turn each plan's state into plain words — status.json scan, live filter, stage words, % maths — mods/fleet/hooks/run-progress.tsx
- [x] A2: Show a run chip with a % in the dock that opens a panel of one line per plan — chip, hotkey o, panel under the dock, watch line, STUCK colour — mods/fleet/hooks/run-progress.tsx, mods/fleet/hooks/register.tsx, mods/fleet/types/index.d.ts
- [x] A3: Say what the current agent is doing, from the workflow journal — newest journal naming the run, open agent label + transcript age, guarded reads — mods/fleet/hooks/run-progress.tsx
- [x] A4: Keep the panel fresh while a run is live and idle otherwise — refresh at answer end + ≤30 s timer only while live — mods/fleet/hooks/run-progress.tsx, mods/fleet/hooks/register.tsx
- [x] A5: Test it, document it and bump fleet's version — run-progress tests, README paragraph, changelog, plugin.json version — mods/fleet/tests/run-progress.test.ts, mods/fleet/tests/fleet.test.ts, mods/README.md, CHANGELOG.md, mods/fleet/.claude-plugin/plugin.json

## Technical Considerations

- The workflow folder lives under the user's Claude projects directory, not the checkout. Resolve it from the session's
  transcript folder (`subagents/workflows/wf_*`). Never hard-code a machine path.
- `orch-state.mjs watch` exits 1 on STUCK; treat exit 1 as a valid answer, not an error.
- Windows paths: the kit's mods tests already strip drive letters in mocks (plan 015 K1); follow the same helper.

## Open Questions

- None.

## Architect + PM review

- Architect: read-only, no new mod, no model tokens, reuses the K7 panel pattern and the `watch` command. The only new
  coupling is to the status.json and journal shapes, guarded so a shape change hides detail instead of breaking fleet.
- PM: it answers the Human's question ("is it stuck, what is it doing?") in the place they already look. Scope is kept
  to viewing. No stop/resume buttons. Those would be a separate plan if wanted.

## Done when

All [auto] items above pass, and the [human] item is checked during a real run.

## Execution Notes

- 2026-10-29 Planner (from a project session): asked by the Human during a one-plan orchestrator run ("can my mods
  track the workflow agents… see the progress by clicking on the %").
- 2026-10-30 Build (worktree `ai-workflow-kit-039-build`, branch `feat/039-fleet-run-progress`, in parallel with plan
  040 — shared file: `CHANGELOG.md` Unreleased only). Step 0: no drift on the read files; the journal's `result`
  outputs name the run (`--run=run-NNN-NNN`), transcripts sit beside it as `agent-<agentId>.jsonl`. Deviations:
  - Hotkey is `r`, not `o`: ship-pilot's alert row already uses `o` (open-pr-only); a key may appear once.
  - Plan lines are in plan-number order: status.json keeps no wave order.
  - After a Workflow tool call fleet also looks for a new run for 10 min, so a run that starts after the answer
    ended still shows up; outside that and outside a live run no timer runs.
  - The workflow folder is found from `$.plugin.root` (…/<config>/plugins/…) + the checkout's project slug: this
    session first, then the 6 newest sessions of the project. A plugin loaded from elsewhere shows no agent detail.
  - A run whose status.json is a day old counts as crashed, not live.
  - Fixed the pre-existing failing fleet test (refresh notice): `turn.complete` event shape and a 30 s timeout.
