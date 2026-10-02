# Pattern: Defer singleton data with `ensureLoaded`

## Problem

Many `providedIn: 'root'` data services call `loadInitialData()` (or equivalent) from the constructor. Angular constructs them on first inject — often at login reload or via a root-adjacent service — so the app fires GETs for collections the current route never needs (equipment, venues, menu events, preparations, section categories). Cold `/dashboard` pays for all of them.

## Solution

1. **Audit first** — grep signal reads (`allX_`, etc.). If a service is read from dashboard overview or another always-on surface, leave it eager. Only defer route-scoped data.
2. **Stop constructor fetch** — `BaseEntityDataService` `autoLoad: false`, or empty constructor + private `loaded_` / `loadPromise_` for non-base services.
3. **`ensureLoaded()`** — public, idempotent, shares one in-flight promise; `reloadFromStorage()` resets the guard then calls `ensureLoaded()`.
4. **Wire the owning surface** — route `ResolveFn` on the earliest lazy route that needs the data, and/or `ensureLoaded()` in dashboard-embedded components that mount behind `@if (tab)`.
5. **Gate login reload** — `UserService._reloadDataServices()` must call `reloadFromStorage()` on deferred services only when `hasLoaded()` is true (same pattern as venues / menu-events).

Recipe / Dish were audited and deferred in plan 304 M2 (2026-09-15) — the consumers that read them outside a resolver-gated route (dashboard-overview's counts, metadata-manager's label-in-use check, preparation-category-manager's category-usage check) were migrated to the lightweight `/count` endpoint or given their own `ensureLoaded()` call. Keep Product / Supplier / UnitRegistry / MetadataRegistry eager unless a future audit proves otherwise — Product in particular is the most widely consumed and was deliberately left alone. Do not change demo-loader / backup — they use `reloadFromStorage()` after explicit user actions.

## When to use

Adding or refactoring a root data service whose collection is only needed inside a lazy route (or a dashboard tab that is not the default overview). Prefer extending the existing resolver + `ensureLoaded` pattern over inventing a new loader framework.

See also: gotcha **Login reload bypasses deferred constructor load**; pattern **Global loading feedback via `LoadingService.track()`** — wraps this pattern's `loadInitialData()` fetch so the user sees the pot-with-steam overlay while an `ensureLoaded()` call (eager or deferred) is in flight.
