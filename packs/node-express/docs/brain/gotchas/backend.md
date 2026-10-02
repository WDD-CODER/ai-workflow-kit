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

---

## Metered API usage counters must fire at dispatch, not at downstream success

**What hurt:** `server/routes/ai.js`'s shared `GEMINI_USAGE` daily counter only incremented after the full pipeline succeeded (JSON parsed + schema validated). Every 502 caused by Gemini's own errors (bad key, model overload) or by our post-processing (parse/validation failure) left the counter untouched, so `GET /api/v1/ai/usage` read "0/1000" even after several real calls had gone out — looked like a stale/broken counter when it was accurately tracking "successful requests," not "requests made."

**Why the obvious fix is wrong:** Incrementing on every response including outright guard-clause rejections (missing API key, no prompt, already at the daily cap) overcounts — those never reach Gemini at all, so counting them defeats the point of a budget guard.

**What to do instead:** Increment the counter the moment the route actually dispatches the call to the metered API (immediately before `await fetch(GEMINI_URL...)`), not after any downstream success check. This naturally excludes the early-return guard clauses (they never reach that line) while counting every real spend, including the provider's own error responses and timeouts.

---

---

## A silent list-endpoint cap looks exactly like a client load-order race

**What hurt:** Users reported intermittent blank ingredient names in recipe-builder — some rows resolved, some didn't, and it seemed to "fix itself" after navigating away and back. That pointed straight at a load-order race (component reads a signal before the underlying `ensureLoaded()` finishes) — and there *was* one (fixed via a route resolver gate). But fixing it didn't fix the symptom. The real cause: `server/routes/generic.js`'s `GET /:type` had capped every list response at 500 docs (max 1000) since March, invisible until an account's collection actually exceeded that — which a large data import (`PRODUCT_LIST` 1,478, `RECIPE_LIST` 1,112, `DISH_LIST` 1,001 docs for one account) did for the first time. Every full-collection fetch silently returned a random 500-doc subset; whether a given ingredient resolved was luck of which subset loaded.

**Why the obvious fix is wrong:** Both bugs produce the *identical* symptom — non-deterministic, per-item resolution failures that seem to resolve on reload — because both are "the data a component needs isn't in memory yet/at all when it renders." Fixing the race (a real, legitimate bug) and declaring victory left the actual live-affecting bug in place; only checking the raw HTTP response size (not just status code) against the known collection count surfaced it.

**What to do instead:** When intermittent per-item resolution failures don't reproduce consistently, check the actual byte size / item count of the list responses against the true collection count in the DB *before* assuming a client-side timing bug — `curl`/network-tab a full-list endpoint directly. A 200 status with a suspiciously round item count (500, 1000) is the tell for a silent server-side cap, not a race.

---

---

## Registering a request logger after `express.static` makes every static-asset request invisible

**What hurt:** `server/index.js` had `app.use(express.static(STATIC_DIR))` registered *before* `app.use(morgan('tiny'))`. `express.static` fully terminates the response for any file it matches — the request never reaches later middleware. Result: the ~30 static-asset requests a real page load makes (JS chunks, CSS, images) never produced a morgan log line, with no error and no warning. It looked like the app just wasn't serving static assets through the logged path, when it was serving them fine — just silently.

**Why the obvious fix is wrong:** Upgrading the morgan *format* to add `:response-time`/`:res[content-length]` (plan 302 M1's actual goal) doesn't fix this — you get richer logs for whatever traffic still reaches morgan, while static assets remain completely absent, and it's easy to mistake "no static-asset log lines" for "the app makes very few static requests" instead of "the logger never sees them."

**What to do instead:** Any middleware that can fully terminate a response (`express.static`, a catch-all `res.sendFile()`, an early `res.json()`) must be registered **after** the request logger, not before. To verify the fix actually worked, `curl` a known static asset path directly and confirm a log line appears for that specific 200 — the absence of a log line for a request you know succeeded is the tell, not the presence of errors.

---

## A blanket `immutable` cache on `express.static` poisons every unhashed asset

**What hurt:** Plan 302 M3 said to add `maxAge: '1y', immutable: true` to
`express.static`, justified by `"outputHashing": "all"` in `angular.json`. That option
only hashes the JS/CSS bundles Angular *generates*. Everything under `public/` is copied
verbatim and keeps its name across deploys - including
`{{project.i18nFile}}`, which every {{project.uiLocale}} UI string flows through per
AGENTS.md. Shipping the blanket option
would have pinned a stale dictionary in returning browsers for a year, with `immutable`
telling them not even to ask.

**Why the obvious fix is wrong:** Guarding only `index.html` (which the plan does call
out) feels like the whole job, because index.html is the file everyone thinks of as "the
unhashed one". It isn't. Every `public/` asset shares that property, and they fail
silently - no error, just users on stale translations with no way to self-recover short
of a hard reload.

**What to do instead:** Never apply `immutable` to a whole static directory. Gate it on
the filename actually being content-hashed, and default everything else to `no-cache`:
`const HASHED_ASSET = /-[A-Z0-9]{8,}\.[a-z0-9]+$/` checked inside `setHeaders`.
`no-cache` still yields a 0-byte 304, so the unhashed path costs nothing versus before.
Related: you cannot test any of this through `ng serve` (`npm run dev:local` /
`dev:remote`) - it never executes `server/index.js` and hard-codes its own
`Cache-Control: no-cache`, so cache headers always look broken there. Use
`npm run serve:prod`, and uncheck DevTools "Disable cache" before concluding anything.

---

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

---

---

## A fixed CORS/auth bug can still leave a third-party integration dead — check CSP too

**What hurt:** Recipe/venue image upload (direct browser → Cloudinary, `CloudinaryService.upload`) was reported broken on the Render deployment. Session 1 found and fixed a real bug: `auth.interceptor.ts` attached the app's `Authorization` header to the Cloudinary request whenever `environment.apiUrl`/`authApiUrl` was `''` (same-origin prod build), which Cloudinary's CORS policy rejects. That fix shipped and was confirmed live in the deployed bundle — but the user still saw the exact same failure afterward. `curl` to the same Cloudinary endpoint with matching `Origin`/`Referer` succeeded every time; only requests from the actual page failed. The real cause was one layer further out: `server/index.js`'s helmet CSP sets `connect-src 'self'` and `img-src 'self' data: blob:`, so the *browser itself* blocks the fetch to `api.cloudinary.com` before it's even sent — completely independent of whatever CORS headers Cloudinary's response would have carried, and independent of the interceptor being correct.

**Why the obvious fix is wrong:** Fixing the CORS/auth-header bug and confirming it's deployed feels like closing the loop — the request now leaves clean, Cloudinary would accept it, and the code diff clearly addressed a real, reproducible defect. But CORS and CSP are two independent browser gates: CORS is enforced by the *target server's* response headers, CSP is enforced by *this app's own* response headers regardless of what the target allows. A CSP `connect-src`/`img-src` that never accounted for a third-party integration will silently block it forever, no matter how correct the app-side request code becomes. `read_network_requests`-style tooling can even misreport a CSP-blocked request as a generic error status (503 was observed here) rather than surfacing it as blocked — don't trust that number over the browser's own signal.

**What to do instead:** When a direct-browser third-party call (upload widget, analytics beacon, payment SDK, etc.) fails and CORS/auth looks fixed, check the CSP next — specifically listen for the browser's own `document.addEventListener('securitypolicyviolation', ...)` event (fires async; wait a tick before reading) or check DevTools' Console/Network CSP violation entries directly, rather than reasoning from HTTP status codes alone. `server/index.js`'s CSP is allowlist-only by design (`docs/agent/standards-security.md` #6-7) — any new third-party host a component fetches from or renders `<img>`/`<script>`/etc. from must be added explicitly to the matching directive (`connectSrc` for fetch/XHR, `imgSrc` for images, ...). Grep `server/index.js`'s `contentSecurityPolicy.directives` before assuming a "why does this external call still not work" bug is purely app-code.

---

---

## `server/.env`'s `MONGO_URI` missing the database name silently targets the wrong database

**What hurt:** `server/.env`'s `MONGO_URI` was `mongodb+srv://…@cluster0.objqrlt.mongodb.net/?appName=Cluster0` — no database name segment. Every script using it (`verify-against-source.js`, `import-foodcomposer.js`, a new one-off backfill script) connected fine, read real-looking data, and wrote successfully — but Mongo's driver silently falls back to a default database when the URI has no path segment, so all of it landed in a different, unrelated database than the one Render's deployed server actually reads from (Render's own env var *does* include `/{{project.name}}`). A direct DB write appeared to succeed (verified by reading it straight back) while the live app kept serving stale/unfixed data — no error at any layer, because nothing was wrong with the *connection*, only with *which* database it silently picked.

**Why the obvious fix is wrong:** Re-checking "did the write succeed" by reading the same URI back always says yes — the bug is invisible from inside the script that has the bug. Assuming local `.env` mirrors whatever Render has configured is also wrong: Render's env vars live only in its dashboard, are never sourced from the committed (gitignored) `.env`, and can drift silently.

**What to do instead:** Any Mongo connection string used by a script that's meant to touch "the real" database must include an explicit `/<dbname>` path segment — never rely on the driver's default-database fallback. When a write against "production" doesn't show up live, suspect a database-name (or whole cluster) mismatch before suspecting caching or deploy lag — verify by comparing the exact URI (including path) against the target platform's own dashboard-configured value, not just the hostname.

---

## Mongo `listCollections()` silently includes `system.*` namespaces the app DB user can't read

**What hurt:** `server/scripts/db-backup.js` looked like it was working — it printed a clean per-collection line for all 29-30 real collections, in order — but crashed with `not authorized on {{project.name}} to execute command { find: "system.views"... }` right after the last one, before ever writing `_manifest.json`. Every prior "backup" taken with this script was silently incomplete: the JSON files were all on disk, but with no manifest, `db-restore.js` (Plan 321 Phase 0) couldn't verify anything against it — and a human skimming the console output for "N collections written" would reasonably have assumed it finished.

**Why the obvious fix is wrong:** The bug isn't in *reading* `system.views` (that call correctly fails — the app DB user has no privilege on it) — it's that `db.listCollections().toArray()` enumerates `system.views` as an ordinary collection name in the first place, indistinguishable from a real one until you `find()` it. Filtering by `{ type: 'collection' }` in the `listCollections` call doesn't help either: MongoDB reports `system.views` with `type: 'collection'`, not `type: 'view'` — only the view itself (`RECIPE_BOOK_VIEW`) correctly reports `type: 'view'`.

**What to do instead:** Filter out any `listCollections()` name starting with `system.` before iterating — `db-backup.js` now does `.filter(name => !name.startsWith('system.'))`. Any other script walking `db.listCollections()` over a database containing a Mongo *view* (this project has exactly one, `RECIPE_BOOK_VIEW`) needs the same filter, or it hits the identical crash the moment it tries to read every listed name.
