# react-vite gotchas

Traps from adopting the workflow in a React + Vite + TypeScript app.

## Vite moves to the next free port unless `--strictPort` is set

**What hurt:** A slot's dev server was started on its port while another process held it. Vite printed
"Port N is in use, trying another one…" and served on N+1. The slot tools then saw nothing on the slot's port,
started a second server, and the first one kept running unnoticed.

**Why the obvious fix is wrong:** Killing whatever is on N+1 hides the problem and can stop another slot's server.

**What to do instead:** Start slot servers with `--port <n> --strictPort` (the pack's `slots.fePortArgs`), so a
taken port is an error the slot tools report. Vite binds `host: "::"` in many templates; the slot tools read
`[::]:<port>` listeners too.

---

## After a deploy, an open tab asks for deleted chunks and goes blank

**What hurt:** Lazy routes (`React.lazy(() => import(…))`) load hashed chunks. After a publish the old hashes are
gone, so a tab that was open before the deploy throws "Failed to fetch dynamically imported module" on the next
navigation and renders nothing.

**Why the obvious fix is wrong:** Turning lazy loading off grows the first load; catching the error per route
repeats the same code everywhere.

**What to do instead:** One lazy helper that reloads the page once when a chunk fails (with a guard so it cannot
loop), plus a `vite:preloadError` listener in the entry file. Register pages through that helper and render routes
inside an error boundary.

---

## Every `VITE_*` variable is public

**What hurt:** Vite inlines any environment variable whose name starts with `VITE_` into the client bundle, where
anyone can read it.

**Why the obvious fix is wrong:** "It is in `.env`, so it is private" — not for a `VITE_` name. Renaming the
variable in the bundle does not help either; the value is still shipped.

**What to do instead:** Only public client values (an API URL, a publishable key) get a `VITE_` name. Secrets stay
in server-side environments (server functions, CI secrets). Never print `.env` values in chat, logs or commits.

---

## The same query key served one user's data to the next

**What hurt:** A query keyed `["projects"]` cached the rows the server returned for user A; after a switch to user
B in the same tab, B saw A's rows until the cache went stale.

**Why the obvious fix is wrong:** Clearing the whole cache on every auth event (including token refreshes) refetches
everything every hour and flashes empty screens.

**What to do instead:** Put the caller's identity in caller-scoped query keys, and clear the cache only when the
user id actually changes or the user signs out.
