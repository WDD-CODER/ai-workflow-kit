# Plan 058 — Orchestrator preflight starts the main folder's servers itself, instead of stopping the run to ask the Human to start them

Status: draft
Depends-on: none
Snapshot: 24d6e2976aed2c0ed89adc239abf546d7ec8c98f

## Problem Statement

A run starts only from the main folder (`orch-preflight.mjs` refuses any other folder). The preflight's `dev server` check
(`core/scripts/orch-preflight.mjs`, `devServer()`) is documented and coded as "the dev server answers on the base port, or
`scripts/slot-serve.mjs` starts it". It can never start it: `core/scripts/slot-serve.mjs` line 39 stops at once with
`not a slot - the main folder's dev servers are the Human's; start them by hand`, because the main folder has no
`.worktree-port`, and `ports()` in `core/scripts/lib/slot.mjs` returns `null` there, so the script could not continue even
without that line. Result, every time: a run whose plans do not even need a dev server stops at preflight with
`nothing answers on http://localhost:4200/ … start the dev server, then relaunch`, and the Human starts it by hand
(seen 2026-11-02, plans 512 and 422 of a FoodVibe run, readiness blocker 1).

A second gap sits next to it: a plan's `[auto:main]` Done-when item reads the live environment (`.env`, a database, a log)
from the main folder (`docs/agent/orchestrator.md`, `orchestrate.js` "main-folder check"), so it needs the main folder's
**backend**. The preflight never checks or starts the backend, so such a check fails later, after a builder has spent
rounds, or is dropped.

Also found while reading: `slot-serve.mjs` starts a slot's backend with the hard-coded script `dev:local` through `npm`
(`spawnNpm`), although `commands.devLocal` exists in the config (`core/docs/agent/workflow-map.md` documents the backend
as `npm run {{commands.devLocal}}`) and `project.packageManager` can be `pnpm`.

## Decision (Human, 2026-11-02)

- The preflight **checks, and starts what is missing, then carries on**. It must never end in "please start a server".
- The main folder's backend runs on the **local** database (`dev:local`) unless the Human asks for remote in that run.
- Which servers: the frontend as today (`commands.dev` set) and the backend when a plan in the run needs it
  ([auto:main] item). Assumed from the Human's answers: the Human starts the backend by hand with
  `npm run dev:local` / `npm run dev:remote` inside `server/`, and `pnpm run …` works for the same scripts.
- Assumed (Planner default, change on a no): a start that fails (port held by another program, a build error, the database
  down) stops the run with the real error from the server log, as a failed start does today. Nothing is swallowed.

## Goals & Success Criteria
**Primary:** `/orchestrate` on a main folder with no dev server running starts the servers the run needs and proceeds to
`go` with no server question; a server that already answers is never touched.

- [auto] `node scripts/slot-serve.mjs --main` in a scratch main folder (no `.worktree-port`) starts a stub frontend
  (a `commands.dev` script that listens on the base port), prints `SLOT_SERVE: main fe=<port> started`, and a second run
  prints `kept` without starting a second process. Test in `tools/test/orchestrator-folders.test.mjs`.
- [auto] `slot-serve.mjs --main` refuses in a slot (`.worktree-port` present), refuses a port held by another program with
  the holder's PID and command in the message (never kills it), and runs no package install, no `environment.slot`
  copy and no `commands.slotPrepare` step.
- [auto] With `--servers be`, the backend starts in `server/` with `<project.packageManager> run <commands.devLocal>` (default
  script `dev:local`), with the process environment unchanged (no `PORT`, no `ALLOWED_ORIGIN` set by the kit); `remote`
  runs `commands.devRemote` (default `dev:remote`) instead.
- [auto] A chain started with `pnpm` or with the `dev:remote` script is recognised as a dev-server chain (`CHAIN_CMD` in
  `core/scripts/lib/slot-procs.mjs`), so a failed start is killed from its root and `slot-stop.mjs --main` stops it —
  unit test on the matcher plus the stub-server stop test.
- [auto] `orch-preflight.mjs` starts a missing frontend through `slot-serve.mjs --main` and prints `OK dev server`;
  it starts the backend only when a plan named in `--plans` has an open `[auto:main]` item (new helper
  `mainAutoItems` in `core/scripts/lib/done-when.mjs`, unit-tested), else prints `SKIP backend: no plan needs it`.
- [auto] A failed start is a `FAIL` that carries the last lines of the server log (as `startServer` returns them), and the
  JSON line keeps `envFailure: true`.
- [auto] `slot-stop.mjs --main` stops only the chains `slot-serve --main` recorded in `.claude/.main-serve-pids` (still the
  same process by creation time) and never a server the Human started by hand in that folder (test: a second stub
  server started outside the script survives).
- [auto] `/orchestrate … remote` makes the preflight start the backend with `commands.devRemote`, the run report names the
  database mode, and a run without the word uses local. (P1 — see Must/Should Have.)
- [auto] `commands.devRemote` is accepted as an npm script name and rejected as a full command (`tools/lib/kit.mjs`,
  same rule as the other `commands.*` script keys); test in the existing config-validation test file.
- [auto] `npm run build`, `npm run lint` (leak check), `npm test`, `node --test "tools/test/*.test.mjs"`,
  `node tools/orchestrator-e2e.mjs` and `node tools/drift-check.mjs --target .` all exit 0.
- [auto] `node scripts/scope-check.mjs --tests --plan=plans/058-orchestrator-preflight-starts-the-main-folder-servers-itself.plan.md`
  prints `SCOPE_TESTS: ok`, and `node scripts/scope-check.mjs --diff=origin/main` on the finished branch prints `SCOPE: ok`.
- [human] On the Human's PC, from the main folder with no dev server running: `/orchestrate` of two small plans reaches
  readiness with `OK dev server` and no "start the server" blocker; the frontend answers on its base port afterwards.
- [human] On the Human's PC, a run with one plan that has an `[auto:main]` item starts the backend with `dev:local`
  (the server log is `.claude/be.log`) before the run, and the item runs against it.

## Execution Mode
- Parallel: no
- Concurrent plans: shares `core/scripts/orch-preflight.mjs`, `core/.claude/workflows/orchestrate.js` and
  `tools/test/orchestrator*.test.mjs` with other orchestrator plans; `plan-order` lock groups decide the turn. Shares
  `kit.config.json` (its one-line `$comment`), `tools/lib/kit.mjs`, `tools/test/orchestrator.test.mjs` and
  `workflow-map.md` with plan 057, which is built but not merged: build this plan after 057 merges (Execution Notes).
- Isolated DB: no

## Read-Write Scope

Always allowed regardless of the list below: this plan file itself, its own
`.claude/sessions/**`, `.worktree-*`, and the append-only
hotspots (`CHANGELOG.md, README.md` — add to them, never rewrite or remove an existing entry without escalating).

```scope
core/scripts/slot-serve.mjs
core/scripts/slot-stop.mjs
core/scripts/orch-preflight.mjs
core/scripts/local-excludes.mjs
core/scripts/lib/slot-procs.mjs
core/scripts/lib/done-when.mjs
core/scripts/lib/orch-run.mjs
core/.claude/workflows/orchestrate.js
core/.claude/commands/orchestrate.md
core/docs/agent/orchestrator.md
core/docs/agent/workflow-map.md
core/docs/brain/gotchas/agent-workflow.md
kit.config.json
tools/lib/kit.mjs
tools/test/orchestrator-folders.test.mjs
tools/test/orchestrator.test.mjs
tools/test/ui-tier.test.mjs
.gitignore
scripts/**
.claude/**
docs/agent/**
docs/brain/**
.kit/install.json
CHANGELOG.md
```

`scripts/**`, `.claude/**`, `docs/agent/**`, `docs/brain/**` and `.kit/install.json` are the rendered copies, written only by
`node tools/sync.mjs --target . --apply`. `tools/test/ui-tier.test.mjs` already imports `done-when.mjs`; the `mainAutoItems` unit tests go there.

## Read Scope

Entire repo and its git history.

## Escalation Protocol

Thinking outside the box is expected; writing outside it requires explicit consent. If a
Worker needs a file outside the `## Read-Write Scope` above: STOP, tell the Human the file,
the exact change, and why it can't be done in-scope; offer `approved: <path>`; then
append the path to the scope block above and retry.

## Architecture Impact
- INV-none: preserves — the orchestrator still never writes the main folder's tracked files and never merges to main. It
  starts the same dev servers the Human starts by hand (same scripts, same ports) and records only its own processes
  in an ignored file. The Human's hand-started servers stay the Human's: the stop path ignores them.

## Step 0 — Reality Check

1. Runs only when `scope-check.mjs --drift` reports `REALITY: drift`: check the listed commits by symbol, print `ok`
   or `conflict: <what>` per commit; stop for a go only on a conflict.
2. `git grep -n "isSlot()\|ports()\|slotNumber()" -- core/scripts` — list every caller that would break when run in the
   main folder (`ports()` is `null` there). The `--main` mode must not change what any slot caller sees. (Planner, on
   `24d6e29`: `slot-procs.mjs:360` `stopSlotServers`, `ship-prep.mjs:242,267,334`, `slot-serve.mjs:39,41,54`,
   `slot-stop.mjs:15`, `take-plan.mjs:148,160,164`.)
3. Find how the `[ui]` step's page servers come up (`orchestrate.js` `ui env`, `orch-preflight.mjs --ui`): does anything
   start a slot's frontend before that check? Report in Execution Notes. Fixing it is **out of scope** unless it is one
   line; say so and stop for the Human only if the `[ui]` step has the same "asks the Human to start a server" gap.
4. Read what `finish` does with `commands.logQuery` when the main backend is not running (the report's "App errors since
   the run started" section). Report in Execution Notes; do not change it here.
5. Confirm main's frontend is used by something (`git grep -n "fePorts\|devPort" -- core`). If nothing in a run uses it,
   say so; the unconditional frontend start stays (the Human asked for check-then-start), the finding goes to the Human.
6. `node tools/install-check.mjs` and `node --test "tools/test/*.test.mjs"` pass before any edit.

## User Stories
- As the Human, I want `/orchestrate` to start the servers it needs, so a run never waits at preflight for me to type
  `pnpm start`.
- As the Human, I want a plan that checks live data to find the backend already running on the local database, and to
  get the remote one only when I say so.
- As the Human, I want the servers I started myself left alone.

## Functional Requirements

### Must Have (P0)
- [ ] `slot-serve.mjs --main [--servers fe,be] [--db local|remote]`: allowed only outside a slot. Ports are the config base
      ports (`slots.fePorts`, `slots.bePorts`; main = base, as `orch-preflight.mjs` `devPort()` already assumes).
      The frontend runs `<pm> run <commands.dev>` with no port arguments (the project's script owns its port, as
      `pnpm start` does by hand); the backend runs `<pm> run <commands.devLocal | commands.devRemote>` in `server/` with the
      unchanged environment. No install, no `environment.slot`, no `commands.slotPrepare`. A server that answers is `kept`;
      a held port is refused with the holder named; a start that does not come up is killed from its root (existing
      `startServer`) and its log tail is the error. Prints `SLOT_SERVE: main be=<port> started|kept, fe=<port> started|kept`.
- [ ] A package-manager-aware spawn (`spawnPm`) next to `spawnNpm` in `slot-procs.mjs`: `pnpm`/`npm` by
      `project.packageManager`, `.cmd` through a shell on Windows; `spawnNpm` stays for the slot paths. `CHAIN_CMD`
      (`slot-procs.mjs:35`) also matches `pnpm` and the configured backend scripts, so their chains are found and killed.
- [ ] Recorded processes: `slot-serve --main` writes the chain roots (pid + creation time) to `.claude/.main-serve-pids`;
      `slot-stop.mjs --main` stops only those; the file is in `core/scripts/local-excludes.mjs` and `.gitignore`.
      The servers a run started keep running after it (as a hand-started server would); `slot-stop.mjs --main` stops them.
- [ ] `orch-preflight.mjs`: `devServer()` calls `slot-serve.mjs --main --servers fe`; a new `backend()` check starts the
      backend (`--servers be`) when `mainAutoItems` of any `--plans` plan is non-empty, else `SKIP`. `--env-only` and
      `--ui` modes unchanged.
- [ ] `mainAutoItems(planText)` in `done-when.mjs`: the open `- [ ] [auto:main] …` Done-when items, same section rules as
      `openAutoItems`.
- [ ] `commands.devRemote` (optional npm script name, default empty = `dev:remote`): `kit.config.json`, the
      `SCRIPT_NAME_KEYS` list in `tools/lib/kit.mjs`, and the `$comment`.
- [ ] `slot-serve.mjs` (slot mode) takes the backend script from `commands.devLocal` (fallback `dev:local`) instead of the
      hard-coded string, so the two modes agree.
- [ ] `orchestrator.md` (preflight row and the "start through slot-serve" sentence), `workflow-map.md` and one
      `agent-workflow.md` gotcha: *"The preflight said it would start the dev server; the script refused in the main
      folder"* — what hurt, why the obvious fix (telling the Human to start it) is wrong, what to do instead.
- [ ] CHANGELOG entry: what changed, and "a project with `commands.dev` set no longer needs its dev server started by hand
      before `/orchestrate`".

### Should Have (P1)
- [ ] `/orchestrate <plans> remote`: the command file and the workflow pass `--db remote` to the preflight calls
      (`orchestrate.js` lines of `runner('orch-preflight.mjs', …)` for readiness and run), the way the word `ask` is
      passed; the run report names the database mode once. Never stored; the next run without the word is local.
- [ ] The failure message of a start names the log file (`.claude/fe.log` / `.claude/be.log`) and the exact command that was
      run, so the Human can repeat it by hand.

### Nice to Have (P2)
- None.

## UI/UX Notes
None (scripts and docs only). Preflight output stays one line per check.

## Atomic Sub-tasks

Every step names its own test location.

- [x] A1: Reproduce the gap with failing tests before any fix — in `tools/test/orchestrator-folders.test.mjs`: preflight in a scratch main folder whose `commands.dev` script starts a stub server returns `FAIL dev server … not a slot` today; `slot-serve.mjs --main` is an unknown flag today; add the Step 0 findings to Execution Notes; print the failures, then continue (no Human stop unless Step 0 item 3 found a second gap)
  - Scope: `tools/test/orchestrator-folders.test.mjs`
- [x] B1: Add the main-folder serve mode — `spawnPm`, `CHAIN_CMD` matching `pnpm` and the backend scripts, `.claude/.main-serve-pids` read/write with a file-name parameter on the existing helpers, a stop that reads only that file, `slot-serve.mjs --main`, `slot-stop.mjs --main`, the slot backend script from `commands.devLocal`; tests for: starts, kept, refused in a slot, held port named and not killed, no install/prepare, a pnpm / `dev:remote` chain matched, hand-started server survives `slot-stop --main`
  - Scope: `core/scripts/slot-serve.mjs`, `core/scripts/slot-stop.mjs`, `core/scripts/lib/slot-procs.mjs`, `core/scripts/local-excludes.mjs`, `.gitignore`, `tools/test/orchestrator-folders.test.mjs`
- [x] B2: Make the preflight start what it checks — `devServer()` through `--main --servers fe`, the new `backend()` check from `mainAutoItems`, `commands.devRemote` in the config and its validation, the failure message naming log and command; tests: `OK` after a start, `SKIP backend`, backend started for an `[auto:main]` plan, `FAIL` with log tail, unit tests of `mainAutoItems`
  - Scope: `core/scripts/orch-preflight.mjs`, `core/scripts/lib/done-when.mjs`, `kit.config.json`, `tools/lib/kit.mjs`, `tools/test/orchestrator.test.mjs`, `tools/test/ui-tier.test.mjs`
- [x] B3: Let a run ask for the remote database with one word (P1) — `/orchestrate … remote` reaches both preflight calls and the report; tests in the workflow test that a run without the word never passes `--db remote`
  - Scope: `core/.claude/commands/orchestrate.md`, `core/.claude/workflows/orchestrate.js`, `core/scripts/lib/orch-run.mjs`, `tools/test/orchestrator.test.mjs`
- [x] D1: Document the new preflight behaviour and the trap it fixes — `orchestrator.md`, `workflow-map.md`, the gotcha
  - Scope: `core/docs/agent/orchestrator.md`, `core/docs/agent/workflow-map.md`, `core/docs/brain/gotchas/agent-workflow.md`
- [x] R1: Render the kit's own installed copies, run every check and add the changelog entry — `node tools/sync.mjs --target . --apply`, `node tools/drift-check.mjs --target .`, build, lint, `npm test`, the full `tools/test` run, `node tools/orchestrator-e2e.mjs`
  - Scope: `scripts/**`, `.claude/**`, `docs/agent/**`, `docs/brain/**`, `.kit/install.json`, `CHANGELOG.md`
- [ ] H1: [human] On the Human's PC, a real /orchestrate from the main folder with no dev server running starts it, and a plan with an [auto:main] item gets the backend on dev:local — keeps this plan open until the Human replies done

## Technical Considerations
- **Why start in the preflight and not in the workflow:** the preflight is the one place that already proves the environment
  and already names a failed start an environment failure (`envFailure`), so the retry path (`--env-only`) keeps working.
- **Why the main mode does not install, prepare or write `environment.slot`:** a run never writes the main folder, and the
  preflight's `packages` check already fails when `node_modules` is missing. `pnpm install` run by a script in the Human's
  folder is the one thing this plan must not add.
- **Why the frontend gets no port arguments:** a slot needs a strict port flag so two slots never collide; the main folder
  owns the base port and the project's own script already sets it (`pnpm start`).
- **Why not set `PORT` / `ALLOWED_ORIGIN` for the backend in main:** the Human's `.env` and script already decide them; the
  kit would override a working setup.
- **Detached processes on Windows:** the existing `startServer` (detached, hidden window, log file) is reused; the cost is
  that the Human has no terminal for them, which is why `slot-stop.mjs --main` and the log paths are part of this plan.
- **`server/` folder:** the main mode uses the same `server/` folder the slot mode already uses (`slot-serve.mjs:144`), so
  the two modes cannot disagree; making it configurable is not part of this plan.
- **Timeouts:** the preflight waits at most `SERVE_TIMEOUT_MS` (4 min, `orch-preflight.mjs:56`) per `slot-serve` call;
  the frontend (180 s) and backend (90 s) start in separate calls, each inside it.
- **Leak check:** shared files stay product-agnostic; fixtures use scratch folders and stub servers, no project names.

## Out of Scope
- Starting a slot's frontend for the `[ui]` step's page check (Step 0 item 3 reports; a separate plan if there is a gap).
- Changing what `finish` does with `commands.logQuery` when the backend is down (Step 0 item 4 reports).
- Seeding or checking test data: a running server does not create data. A plan that needs data states it in its
  environment needs, which readiness already asks about up front.
- Any change to the Human's `.env`, database, or the `dev:remote` script itself.
- Stopping the servers a run started when the run ends (they stay up, like hand-started ones).

## Critical Questions
- None open. Decided by the Human on 2026-11-02: check, then start, then continue; backend on the local database unless
  asked for remote. Assumed (Planner default): a failed start stops the run with the real error; the frontend start stays
  unconditional when `commands.dev` is set, the backend start is need-based.

## Execution Notes
- Source: a FoodVibe orchestrator run, 2026-11-02 (plans 512 and 422): readiness blocked on `dev server: nothing answers on
  http://localhost:4200/`, although neither plan needs a dev server. Read from kit `main` @ 24d6e29; nothing in
  FoodVibe was read (its `server/package.json` scripts are from the Human's description).
- Architect + PM review (Planner, 2026-11-02, against `origin/main` `24d6e29`): every named file and symbol exists
  (`slot-serve.mjs:39` refusal, `devServer()` `orch-preflight.mjs:148`, `startServer` / `spawnNpm` / `CHAIN_CMD` in
  `slot-procs.mjs`, `openAutoItems` and the `auto:main` tag in `done-when.mjs`, `commands.devLocal` and
  `SCRIPT_NAME_KEYS` in `tools/lib/kit.mjs:52`, the `ask` word in `orchestrate.md`, two `runner('orch-preflight.mjs', …)`
  run calls in `orchestrate.js:489,1053`); new: `.claude/.main-serve-pids`, `mainAutoItems`, `spawnPm`,
  `commands.devRemote`. Number 058 from `next-plan-number.mjs`. Similarity none; related 020, 029, 032, 041, 044 (closed,
  not the same work); follow-ups none. Fixed in review: `CHAIN_CMD` matches only npm and `dev:local`, so a pnpm or
  `dev:remote` chain could not be killed or stopped → added to B1 and the Goals; servers left running after a run made
  explicit (Out of Scope); `server/` and timeout notes; build order after 057 (it shares `kit.config.json`'s one-line
  `$comment`, `tools/lib/kit.mjs`, `tools/test/orchestrator.test.mjs`, `workflow-map.md`).
- Built on `feat/058-preflight-starts-main-servers` from `origin/main` `c9bb15f`, after 057 merged (PR #85). `--drift` →
  `REALITY: drift` on one commit, `67f4e07` (plan 057: the shared files above) — ok, no conflict with this plan's changes.
- Step 0 findings (2026-11-02):
  - (2) slot callers: `slot-procs.mjs` `stopSlotServers`, `ship-prep.mjs:242,267,334`, `slot-serve.mjs` (slot mode),
    `slot-stop.mjs`, `take-plan.mjs` — all left as they were; `--main` is a branch of its own before the slot check.
  - (3) the `[ui]` step: `orch-preflight.mjs --ui` only checks that the cards' pages answer (`orchestrate.js` `ui env`);
    nothing starts a slot's frontend before it. It reports `uiBlocked` instead of asking the Human to start a server, so
    it is not the same "please start it" stop — but a page on a slot port that is not up blocks the cards. Pages on the
    main folder's base port are now covered by the preflight's frontend start. Not changed here (Out of Scope).
  - (4) `finish` runs `commands.logQuery` once from the main folder for "App errors since the run started"; it does
    not need the backend running (it reads what the app logged). Not changed.
  - (5) the main frontend is read by `orch-preflight.mjs` `devPort()` and the validation cards' main-folder URLs
    (`job-validation.md`), and the `[ui]` pages when they point at the base port. Kept unconditional.
  - (6) the clean-start full test run was replaced by the final full run (the plan-057 run on `c9bb15f` was green:
    `tools/test` 421/421).
  - (A1) reproduction: on `c9bb15f`, `slot-serve.mjs` stopped at line 39 outside a slot (`not a slot - … start them by
    hand`), so the preflight's start could never work; the new tests in `orchestrator-folders.test.mjs` exercise the
    path that replaced it (`--main` was an unknown flag there).
- Decisions while building:
  - A port held inside a chain this script recorded (`.claude/.main-serve-pids`, same creation time) counts as kept;
    a dev server from elsewhere on the base port is refused, not kept — the preflight's own check (HTTP answer for the
    frontend, TCP for the backend) runs first and passes a server the Human started, so `slot-serve --main` is only
    called when nothing answers.
  - pnpm runs as `pnpm.cmd` through a shell on Windows (as the plan says); npm keeps npm's own CLI under node, whose
    log capture is proven. A pnpm start's log may be empty on Windows (the shell drops the detached process's
    handles — the reason `spawnNpm` avoids the shell); the failure message still names the command and the log file.
  - The database mode is one run note (`database: local|remote — …`), so the report names it once without a new state field.
  - The kit's own `docs/brain/gotchas/agent-workflow.md` is a project-owned seed that already differs from core; the
    new gotcha is in the core source (rendered into projects on sync), not copied by hand into the kit's own brain.
- Left running by the first, hung test attempt (a `cmd start /b` held the test's pipes; replaced by a detached spawn):
  two stub processes in deleted scratch folders, `node stub.js 63227 fe.json` (PID 28276) and
  `node ../stub.js 63228 be.json local` (PID 5916). Killing them was refused by the session's permission rules — the
  Human can end them in Task Manager; they hold only those two random ports.
- Evidence (2026-11-02): `npm run build` → PACK_CHECK ok; `npm run lint` → 0 leaks (3 roots); `npm test` → INSTALL_CHECK
  ok, 0 problems; `node --test "tools/test/*.test.mjs"` → 428 pass, 0 fail (then `orchestrator-folders` 26/26 after the
  last message change); `node tools/orchestrator-e2e.mjs` → 90 cases passed; `drift-check` → 0 undeclared;
  `scope-check --diff=origin/main` → SCOPE: ok; `--tests` → SCOPE_TESTS: ok. The first full run failed on the link check
  (backticked `.claude/…` runtime paths a fresh install lacks), the rendered-constants check (an `export` inside the
  block install-check evaluates) and the e2e `devfail` case (it reads `slot-serve.mjs did not start it (exit 1: …)`):
  all three fixed and re-run above.
- Checker review at `/ship` (kept 3, all minor; fixed, then re-checked by `orch-verify` only):
  - bugs-1: with `--db remote` and a backend already answering, the preflight said `OK backend` and the run note said
    remote → the preflight now prints `WARN backend: a backend already answers … kept as it is`, and the note says the
    remote database is used only when the preflight starts the backend.
  - plan-1: a plan with an open `[auto:main]` item in a folder with no `server/package.json` was a `SKIP` → now a `FAIL`
    before any builder (the failure the plan exists to prevent).
  - plan-2: A1 asked for failing-first tests; they were not run failing before the fix. The reproduction was by
    reading `slot-serve.mjs:39` on `c9bb15f` and the Problem Statement's own run; the tests were written with the fix.
    Recorded as a deviation (the Human may untick A1).
- Final run after the fixes: `npm test` INSTALL_CHECK ok; `tools/test` 428/428; e2e 90 cases; lint 0 leaks; drift 0;
  build ok; SCOPE: ok. `orch-verify` re-check: all 3 fixed findings refuted (no longer hold).
- review: checkers kept 3 dropped 0 rechecked 3 minutes 30.3 models check-plan=claude-sonnet-5-5,check-bugs=claude-sonnet-5-5,check-rules=claude-sonnet-5-5,verify=claude-sonnet-5-5
- Open: the two `[human]` Done-when items (a real `/orchestrate` on the Human's PC: frontend started; an `[auto:main]`
  plan gets the backend on `dev:local`); sub-task H1 keeps the plan open until the Human validates.
