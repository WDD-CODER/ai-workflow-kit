# The kit brain

Every run sends its facts to a private document store (a hosted database cluster) that only the kit owner reads. No model is called, no step is asked
of the Human, and the project needs no access to the kit repository. A machine that is offline or not set up loses
nothing: the documents wait in a local queue and go out with the next send.

## What goes where

| Where | What | Who can see it |
| --- | --- | --- |
| The project's own files (`docs/brain/` and each run's `status.json`) | The project's rules, lessons, run log, grade rows | The project |
| The kit brain (one dedicated free cluster at a hosted database provider) | Run facts of every project: runs, plans, events, grades, the Planner's by-hand toil, lessons on their way to the kit | The kit owner only |
| The kit repository (public) | Decisions: plans, kit-owned lessons, fixtures | Everyone |

Evidence with product detail never goes to the kit repository. Projects insert into the brain; they receive the kit through
`kit-sync` as before.

## Commands

All are `node scripts/brain.mjs <command>`; `send` always exits 0 (a failure queues the documents).

| Command | What it does |
| --- | --- |
| `digest --run <name>` | Prints the documents of a run as JSON lines; sends nothing |
| `send --run <name>` | Runs, plans and events of a run. `finish` runs it after the report is written |
| `send --grades --run <name>` | The run's rows of `decision-grades.jsonl` (in `docs/brain/`), `ok` and `✗` alike. `decision-log.mjs grade` runs it |
| `send --toil --run <name>` | The Planner's by-hand lines of `.claude/sessions/toil-<run>.json` (at most 8) |
| `send --lesson-file <file>` | One lesson `{ role, title, text, why }` for the kit. `kit-feedback.mjs` runs it when `KIT_BRAIN_URI` is set |
| `backfill [--dry-run]` | Every past `status.json` of the project once, and its grade rows |
| `setup [--dry-run]` | Installs the driver into `<home>/.kit-brain` (no project folder is touched) |
| `check` | Connects with `KIT_BRAIN_URI`, inserts one `setup-check` event, tries one read |
| `queue` | Lists the documents still waiting |

One line per send: `BRAIN: sent 14, queue drained 0` or `BRAIN: queued 14 (<first line of the error>)`. Without
`KIT_BRAIN_URI` the line is `BRAIN: queued <n> (KIT_BRAIN_URI not set)`. A send that has not finished after 10 s is queued;
`finish` and `grade` kill it after 15 s. Nothing here can change a run's exit code or its report.

The kit side reads with `node tools/brain-query.mjs runs | events | trend --by kitVersion|project` (kit repository only,
never rendered into a project; it needs `KIT_BRAIN_READER_URI`).

## Schema

Database `kitbrain`. Every document has `schema: 1`, `project` (`brain.projectId`, default `project.repoName`), `run`,
`machine` (first 8 hex of the host name's SHA-256), `kitVersion` and `kitCommit` (from `.kit/install.json`). The `_id` is
`<project>:<run>:<kind>:<key>`, built from the run's own facts and never from the clock, so a second send of the same run
changes nothing (`E11000` = already there, counted as sent).

| Collection | One document per | Key fields |
| --- | --- | --- |
| `runs` | run | `startedAt`, `finishedAt`, `minutes`, `finalGate`, `counts` (plans, merged, parked, skipped, fixRounds, flakes, decisions, notes), `tokens`, `tokensNote` |
| `plans` | plan in the run | `state`, `round`, `tier`, `reason`, `signature`, `models` per role, `attempts`, `flakes`, `minutes` per phase |
| `events` | problem | `kind`, `plan`, `signature`, `text` (redacted, 300 characters), `at` |
| `grades` | graded decision | the row of `decision-grades.jsonl`: `kind`, `triageVerdict`, `humanVerdict`, `humanChoice`, `kitVersion` |
| `toil` | by-hand line | `step`, `minutes`, `script` (yes/no: could a script do it) |
| `lessonsIn` | lesson | `role`, `title`, `text`, `why` |

`minutes` per phase come from `plans[].history[].at`: readiness (`queued`), building (`building`, `fixing`), gate, checks
(`checking`), merge (`merging`); `envPaused` is `env-paused`. The workflow records no state for the `[ui]` check or the final
gate, so `ui` and `finalGate` are `null`, as is any phase with no timestamps.

**Event kinds:** `park`, `timeout`, `env-fail`, `flake`, `runner-retry`, `model-fallback`, `main-check-dropped`, `stuck`,
`final-gate-fail`.

**Signature.** The text of a problem with what changes between runs taken out, so the same failure in two runs or two
projects matches: secrets and code cut first, then lower-case; quoted strings, ISO times, dates, hex ids of 7+ characters,
`wt-<n>`, absolute paths (and the project root) and numbers become `<s> <t> <d> <h> <slot> <p> <n>`; spaces collapse; at
most 120 characters. A path is `<p>` whether it is absolute or relative (two slashes or a file extension); the script a command runs
(`node` followed by a script path) stays, because it names what failed.

**Tokens.** Read from the transcripts Claude Code keeps of a Workflow's agents
(`~/.claude/projects/<project>/<session>/subagents/workflows/wf_<id>/agent-*.jsonl` and `.meta.json`): the assistant lines carry
`message.usage` and `message.id` (a message id counts once). A workflow folder belongs to the run when its newest agent file
was written between `startedAt` and a minute after `finishedAt`. The totals are kept twice:

- `byPhase`: per `workflowPhase` (`Start`, `Readiness`, `Build`, `Report` in an orchestrator run).
- `byRole`: per role. The role is the meta file's `agentType` (`orch-builder`, `orch-gate`, the finders, `orch-verify`,
  `orch-merge`, `kit-runner`, …); an agent with no `agentType`, or the generic `workflow-subagent`, falls back to
  `phase:<Phase>`. The free-text `description` is never read.

**Phases that mix roles.** Every orchestrator phase holds more than one role (`Start`, `Readiness` and `Report` share their
phase with the `kit-runner` that runs the commands; `Build` holds the builder, gate, three finders, verifier, security, `[ui]`
and merge agents). A phase total with `mixedRoles: true` is the sum of those roles and is never split by a guess; read
`byRole` for the split. The transcript format is not an official contract: any shape the reader does not know gives
`tokens: null` and a `tokensNote`, and never fails `finish`.

## Setup

Done once by the Human (the kit never does it, and never writes an environment variable on a machine).

1. **Cluster.** At the hosted database provider create one dedicated free cluster (the document database the driver
   speaks to; the kit's own choice is a free-tier cluster, one per provider project).
2. **Role.** Create a custom database role `brainInsert` with the `INSERT` privilege on the collections `runs`, `plans`,
   `grades`, `events`, `toil` and `lessonsIn` of database `kitbrain`. (Custom roles are created in the provider's web UI; a free
   cluster has no `createRole`.)
3. **Users.** One writer user per machine, `kit-brain-writer-<pc>`, with only the `brainInsert` role and a long random
   password (a leaked writer password can add documents, not read or delete them; one machine's user can be revoked alone).
   One reader user, `kit-brain-reader`, with `read` on `kitbrain`.
4. **Network.** Add the IP access entry `0.0.0.0/0` (machine addresses change); least privilege is what protects the store.
5. **Indexes.** With a temporary admin user, once: `events` on `{ signature: 1 }` and `{ kind: 1, at: 1 }`, `runs` on
   `{ kitVersion: 1 }`, `plans` on `{ run: 1 }`, `grades` on `{ kitVersion: 1 }`. An insert-only user cannot create indexes,
   and the ids are deterministic, so nothing else is needed. Delete the temporary user afterwards.
6. **Environment variables**, in PowerShell, on each machine (the reader string only on machines that run kit sessions):

   ```powershell
   [Environment]::SetEnvironmentVariable("KIT_BRAIN_URI", "<writer connection string>", "User")
   [Environment]::SetEnvironmentVariable("KIT_BRAIN_READER_URI", "<reader connection string>", "User")
   ```

7. **Driver and check**, in a project: `node scripts/brain.mjs setup`, then `node scripts/brain.mjs check`. `BRAIN: ok —
   reachable, insert allowed, read denied` is the answer you want; `BRAIN: WARN — this user can read` means the writer has
   more rights than it should. Then `node scripts/brain.mjs backfill` sends the past runs.

The connection string is never a config value: `brain.*` in `kit.config.json` takes only `projectId` and `enabled`, and
install and sync refuse a value that looks like a connection string.

## Limits

- The free cluster holds 0.5 GB and throttles at about 100 operations per second. A run is ~2–4 KB, a plan ~1 KB, a grade
  ~0.5 KB: a thousand runs of five plans with forty decisions is about 30 MB. A run writes one `insertMany` per collection.
- A cluster with no connection for 30 days is paused. A run or the nightly job keeps it awake.
- The provider's HTTP data API is gone; a driver is required. It lives per machine in `<home>/.kit-brain/node_modules`, not in a
  project, so `brain.mjs` stays Node built-ins only when the brain is off.

## Privacy

- Every string field is redacted before it is queued or sent: the pre-commit secret patterns (API keys, bearer tokens,
  private keys, database strings with a password) become `[redacted:<pattern>]`, and a code fence or diff hunk in a note is
  cut to its first line plus `[code cut]`. Signatures are computed from the redacted text.
- No code, no file contents and no transcript text leave the machine: only the run's facts and the token counts.
- The kit repository stays public; this store is the only place run evidence lives outside the project.
- Under `node --test`, `brain.mjs send` does nothing unless the test names its own `KIT_BRAIN_HOME` or a stub driver.
