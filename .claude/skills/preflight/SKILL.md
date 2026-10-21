---
name: preflight
description: Environment check before any work that needs the dev server, the browser or the database — verifies the dev server answers on this checkout's port, the database is reachable, and the branch is not `main`. Use at the start of a UI check, a browser flow, a DB query or a plan that runs the app, and whenever something "doesn't load" — run it before debugging.
allowed-tools: Bash(node scripts/preflight.mjs *)
---

# Preflight

Run the script; it prints one line per check and exits non-zero on any `FAIL`:

```bash
node scripts/preflight.mjs            # dev server, database (none (no backend)), branch
node scripts/preflight.mjs --visual   # + browser tool binary, for screenshot/browser flows
```

The port comes from `.worktree-port` (a `wt-N` slot) or `slots.fePorts` in `kit.config.json` (main). Override with `--port`. The database check runs when `DB_PORT` is set (or `--db-port`); the browser check when `BROWSER_BIN` is set. Otherwise they print `SKIP`.

In a `wt-N` slot, dev servers are off until a step needs them: when the dev-server check fails there, run `node scripts/slot-serve.mjs` and re-run preflight. If `slot-serve.mjs` fails, show its log tail; only the steps that need the running app are blocked.

On `FAIL`, fix the named cause before continuing — a dev-server check that fails is not "flaky", it means the next browser step would be testing nothing. If the fix is outside your scope (database not installed, slot not provisioned), report the exact `FAIL` line to the Human and stop.
