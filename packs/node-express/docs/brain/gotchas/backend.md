# backend gotchas

## Flipping a blocklist to an allowlist without reconciling every real client caller

**Status:** draft — generalized from a project lesson; review before relying on it.

When flipping a blocklist to an allowlist, enumerate every real client caller first, or legitimate requests start failing.

---

## `node --watch` full-restart on every server edit

**What hurt:** `server/package.json`'s `dev` / `dev:local` / `dev:remote` scripts all run `node --watch index.js` — any saved file change triggers a full process restart, dropping in-flight requests and any in-memory state.

**Why the obvious fix is wrong:** There's nothing to "fix" here — the restart is `node --watch`'s designed behavior, not a bug. Debouncing or ignoring it doesn't help.

**What to do instead:** Expect a short gap (~1s) after any server-side edit before requests succeed again; don't fire requests immediately after editing server code in the same script/test run.

---

## A silent list-endpoint cap looks exactly like a client load-order race

**What hurt:** Users reported intermittent blank ingredient names in recipe-builder — some rows resolved, some didn't, and it seemed to "fix itself" after navigating away and back. That pointed straight at a load-order race (component reads a signal before the underlying `ensureLoaded()` finishes) — and there *was* one (fixed via a route resolver gate). But fixing it didn't fix the symptom. The real cause: `server/routes/generic.js`'s `GET /:type` had capped every list response at 500 docs (max 1000) since March, invisible until an account's collection actually exceeded that — which a large data import (`PRODUCT_LIST` 1,478, `RECIPE_LIST` 1,112, `DISH_LIST` 1,001 docs for one account) did for the first time. Every full-collection fetch silently returned a random 500-doc subset; whether a given ingredient resolved was luck of which subset loaded.

**Why the obvious fix is wrong:** Both bugs produce the *identical* symptom — non-deterministic, per-item resolution failures that seem to resolve on reload — because both are "the data a component needs isn't in memory yet/at all when it renders." Fixing the race (a real, legitimate bug) and declaring victory left the actual live-affecting bug in place; only checking the raw HTTP response size (not just status code) against the known collection count surfaced it.

**What to do instead:** When intermittent per-item resolution failures don't reproduce consistently, check the actual byte size / item count of the list responses against the true collection count in the DB *before* assuming a client-side timing bug — `curl`/network-tab a full-list endpoint directly. A 200 status with a suspiciously round item count (500, 1000) is the tell for a silent server-side cap, not a race.

---

## Running `node index.js` directly never picks up server code changes

**What hurt:** Editing `server/` files and testing against a manually-launched `node index.js`
process kept serving stale behavior — new routes/logic just didn't appear, with no error to
explain why. Cost time on both a Human session and this session independently (this session hit
`EADDRINUSE: address already in use :::{{slots.bePorts}}` repeatedly — a previous plain `node index.js` was
still bound to the port from an earlier test, invisibly serving old code the whole time).

**Why the obvious fix is wrong:** `server/package.json`'s `"start": "node index.js"` script (and
launching it that way directly, which is the natural thing to type) has no file-watching at all —
Node only reloads code on process restart. It *looks* like a normal dev server, so nothing about
running it suggests a restart is needed after every edit.

**What to do instead:** Use `npm run dev:local` (or `dev:remote`) from `server/`, not
`node index.js` — that script is `node --watch index.js`, which auto-restarts on file changes. If a
restart still doesn't seem to take effect, check for a leftover process on port {{slots.bePorts}} first
(`netstat -ano | findstr :{{slots.bePorts}}` on Windows, kill the PID) before assuming the code change is wrong —
`--watch` restarts cleanly but a stray manually-launched instance from an earlier session won't have
been killed by it.
