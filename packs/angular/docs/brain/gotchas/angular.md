# angular gotchas

## Gating a user action on a fire-and-forget side-write silently breaks it for some users

**Status:** draft — generalized from a project lesson; review before relying on it.

Never gate a user action on an un-awaited background write; either await it or decouple so the action works for users whose write has not landed.

---

## Route-resolved data read once in a field initializer goes stale across param-only navigation

**What hurt:** `VenueDetailComponent`'s `venue_` signal was initialized from `this.route.snapshot.data['venue']` in a field initializer. The `venueResolver` correctly re-runs and refetches on every navigation to `/venues/view/:id`, including param-only changes — but Angular's default `RouteReuseStrategy` reuses the component instance across those navigations (same route config, different `:id`), so the field initializer never re-ran and `venue_` stayed pinned to whichever venue loaded first.

**Why the obvious fix is wrong:** The bug was invisible in every manual test this session, because every reachable navigation path into this route goes through `/venues/list` first (a genuine route change, so Angular destroys/recreates the component). It only bites on a same-route param-only transition — a bookmark, browser back/forward across two venue URLs, or any future in-page "next venue" link — none of which existed yet to trigger it.

**What to do instead:** For any component that reads resolver data, use `toSignal(this.route.data)` (reactive) instead of `this.route.snapshot.data` (read-once) unless the route config is provably always destroy/recreate for every reachable navigation into it. See `venue-detail.component.ts`.

---

---

## Component-scoped SCSS can't reach styles.scss's $break-* breakpoint variables

**Status:** draft — generalized from a project lesson; review before relying on it.

Component-scoped stylesheets cannot see another file's preprocessor variables; expose shared breakpoints/tokens as CSS custom properties or an explicit import.

---

## CSS Grid `auto-fill` shares column-track widths across rows — squeezes mixed-length labels

**What hurt:** Inventory's filter-panel checkboxes (category/allergen groups) needed to pack densely on tablet/mobile so short labels (most allergens) sit several per row instead of one per row. First attempt used `display:grid; grid-template-columns:repeat(auto-fill, minmax(0, max-content)); grid-auto-flow:dense`. It compiled and built clean, but the Human immediately reported it unreadable — labels visibly cramped/cut off.

**Why the obvious fix is wrong:** `auto-fill` computes a fixed number of column tracks, and every track's width is shared across *all* rows at that column index — it isn't "size each item to its own content," it's "size each column to the widest item that ever lands in it, across the whole grid." When items vary a lot in natural width (a 3-character allergen next to a long category name), auto-placement can drop a wide item into a track sized for a narrower one, clipping its text. Nothing errors on this — it's a purely visual defect a build/test pass cannot catch.

**What to do instead:** For "pack chip-like items of varying width, wrap to the next line" layouts, use `display:flex; flex-wrap:wrap` — each flex item keeps its own natural content width independent of its neighbors, and simply wraps. Reach for CSS Grid dense-packing only when items are meant to share a uniform track size on purpose (e.g. a card grid); for free-width label/chip wrapping, flex-wrap is the correct default, not grid.

---

---

## Nested `overflow:auto` inside a `max-height`-capped grid row traps scroll instead of letting the page scroll

**What hurt:** `list-shell`'s tablet/mobile layout (shared by Inventory, Recipe Book, Suppliers, Equipment) capped `.list-container` at `max-height:90dvh` with a `1fr` grid row for the table area, while `.table-body` kept its own `overflow-y:auto` (needed for the desktop fixed-height widget). On tablet, opening the filter panel pushed content down, but the page could not scroll past the panel to reach the list below it — even though `.list-container` itself was set to `overflow:visible`.

**Why the obvious fix is wrong:** `overflow:visible` on the *outer* grid container does nothing to stop an *inner* element's own `overflow-y:auto` from claiming all vertical scroll input once that inner box's content exceeds its available height. A `1fr` row inside a `max-height`-bounded grid still computes a bounded height for that row — exactly the budget the inner `overflow:auto` box then scrolls internally instead of letting the outer page take over. Nothing throws or fails a test here; it silently traps input only on real devices at real widths.

**What to do instead:** When a grid layout needs to switch from "internal scroll region" (desktop, fixed-height widget) to "grows with the page" (mobile, page itself scrolls) at a breakpoint, change all three together: the container's height constraint (`max-height` → remove, use `auto`), the row sizing (`1fr` → `auto`, since there's no longer a fixed budget to fill a fraction of), and the previously-scrolling descendant's own `overflow` (`auto` → `visible`). Changing only the outermost `overflow` value is not sufficient on its own.

---

---

## `ngTemplateOutlet` doesn't inherit `[formGroup]` from the element it's outlet-rendered into

**What hurt:** Equipment's row-level inline-edit panel (`equipment-list.component.html`) rendered as a visibly empty box whenever a row's edit was opened — no console error surfaced in normal use, but the browser actually threw `NG01050: formControlName must be used with a parent formGroup directive` mid-render, which aborts that view's change detection the same way an unregistered Lucide icon does (see the entry above this file's earlier "Unregistered Lucide icon" gotcha) — the panel's outer box painted, its `formControlName`-bound fields never did. `[formGroup]="editForm_"` was set correctly on the wrapping `<div class="inline-edit-panel">`, and the form fields lived, in the rendered DOM, as visible descendants of that div — reached only via `<ng-container [ngTemplateOutlet]="panelBody">`.

**Why the obvious fix is wrong:** DOM nesting and Angular's dependency-injection view of a template are not the same thing. `<ng-template #panelBody>`'s content is compiled against the injector context of where the `<ng-template>` is *declared* in the source, not against wherever `ngTemplateOutlet` later projects its instantiated view. Since `#panelBody` was declared as a top-level sibling (outside any `[formGroup]`-bearing element), every `formControlName` inside it looks for a `ControlContainer` up its *declaration-site* ancestry — finds none — and throws, regardless of which real DOM element the outlet renders it into. Putting `[formGroup]` on the two outlet call sites (desktop inline, tablet/mobile modal) looks right and changes nothing.

**What to do instead:** Put `[formGroup]` (or any `ControlContainer`-providing directive) on an element *inside* the `<ng-template>`'s own declared content, not on the element(s) that `ngTemplateOutlet` renders it into. A `<ng-container [formGroup]="form">` wrapping the template's content works and adds no DOM node, so it can't break surrounding flex/grid layout. Reusing one `<ng-template>` from multiple outlet call sites (as here, for a desktop vs. tablet/mobile variant) makes this doubly worth checking — fix it once, inside the template, not once per call site.

---

---

## Global `HttpInterceptorFn` that unconditionally attaches `Authorization` breaks any direct-to-third-party `HttpClient` call

**What hurt:** `CloudinaryService.upload()` posts a `FormData` directly to `https://api.cloudinary.com/v1_1/.../image/upload` via Angular's `HttpClient`. Uploading a venue photo (mirroring the already-existing recipe-photo upload pattern) failed with a browser CORS error: `Request header field authorization is not allowed by Access-Control-Allow-Headers in preflight response`. Nothing in `CloudinaryService` itself looked wrong — it doesn't set an `Authorization` header at all.

**Why the obvious fix is wrong:** `authInterceptor` (`src/app/core/interceptors/auth.interceptor.ts`) is registered globally and unconditionally cloned every outgoing request with `Authorization: Bearer <token>` whenever a token existed — no URL filtering. Angular's `HttpClient` routes *every* request, including calls to third-party domains, through the same interceptor chain, so Cloudinary's request got the app's session token attached too. Cloudinary's CORS preflight doesn't allowlist `Authorization`, so the browser blocks the request before it ever reaches Cloudinary — this reads like a Cloudinary config problem, but it's entirely interceptor-side. The same bug already existed for the recipe-photo upload (identical `CloudinaryService` call site); it simply hadn't been exercised in a way that surfaced the error until this session's venue-photo upload.

**What to do instead:** A global auth interceptor must scope the token to requests targeting your own backend explicitly — e.g. `req.url.startsWith(environment.apiUrl) || req.url.startsWith(environment.authApiUrl)` — never attach it based on token presence alone. Any direct-to-third-party `HttpClient` call (upload providers, external APIs) will otherwise silently inherit your app's bearer token and can fail CORS preflight, or worse, leak the token to that third party if its CORS policy happens to allow the header.

---

---

## A form-rebuilt save payload silently drops any model field the form has no control for

**Status:** draft — generalized from a project lesson; review before relying on it.

A save payload rebuilt from a form silently drops model fields that have no form control; merge the form value onto the original model instead of replacing it.

---

## A service that both `autoLoad`s in its constructor and exposes `reloadFromStorage()` double-fetches on every session bootstrap

**Status:** draft — generalized from a project lesson; review before relying on it.

A data service must not both auto-load in its constructor and expose a reload method without a guard, or session bootstrap fetches twice.

---

## Dev-mode "double-fetch" that isn't: HMR eagerly loads `@defer` blocks

**What hurt:** `KITCHEN_UNITS`/`EQUIPMENT_LIST` appeared to fetch twice on every page load under `ng serve`, surviving two separate investigation sessions and seven ruled-out code-level hypotheses (see plan 309 M1). The duplicate looked exactly like [[Login reload bypasses deferred constructor load]] — a service's own constructor load racing `_reloadDataServices()`'s unconditional `reloadFromStorage()` — but wasn't.

**Why the obvious fix is wrong:** `ng serve`'s console prints `NG0751` on every load once the app has `@defer` blocks: *"this application contains `@defer` blocks and HMR mode is enabled. All `@defer` block dependencies will be loaded eagerly."* That's not advisory text — it means normally-deferred component trees (modals, etc.) actually instantiate eagerly in dev mode, pulling in whatever services their constructors inject, on top of the constructor-time load that already ran. Chasing this as an application-code bug (race-guard logic, injection order, resolver coverage) burns time on something that was never reachable from the served code.

**What to do instead:** Before investigating any dev-mode-only fetch duplication, check the console for `NG0751`. If present, reproduce against a production build first (`ng build`, serve `dist/*/browser` — this repo's local Express server already does, at `:{{slots.bePorts}}`) before touching any application code. If the duplicate doesn't reproduce there, it isn't a bug — stop.

---

---

## Empty `environment.apiUrl` makes `url.startsWith(apiUrl)` match everything

**What hurt:** `auth.interceptor.ts` decided whether a request was "our own backend" (and so should get the `Authorization` header) via `req.url.startsWith(environment.apiUrl) || req.url.startsWith(environment.authApiUrl)`. `environment.prod.ts` — the config `npm run build:render` actually uses — sets both to `''` for same-origin deployment. `''.startsWith('')` is always `true`, so on that build *every* request matched, including the direct browser→Cloudinary image-upload POST. Cloudinary's CORS policy rejects the `Authorization` header on that endpoint, so the browser silently killed the upload — and the calling components swallowed the error, so it just looked like uploads didn't work on Render, with no console signal pointing at the interceptor. Local dev and the remote/staging build have non-empty `apiUrl`, so neither reproduced it.

**Why the obvious fix is wrong:** Requiring `environment.apiUrl` to be non-empty before calling `startsWith` "fixes" the false-positive but reintroduces the opposite bug — on the very deployment that has an empty `apiUrl` *because* the API is same-origin, own-backend calls (relative URLs like `/api/v1/...`) would then wrongly fail the check and never get authenticated. The real defect is testing an absolute, cross-origin URL against a base string that can legitimately be `''`.

**What to do instead:** When "own backend" can mean same-origin with an intentionally empty base URL, don't rely on `url.startsWith(baseUrl)` alone. Check whether the request URL is relative (no `http(s)://` scheme) first — relative always means same-origin, so it's ours regardless of what `apiUrl` is configured to. Only fall back to `startsWith` matching against a *non-empty* configured base when the URL is absolute (third-party). See `src/app/core/interceptors/auth.interceptor.ts`'s `isAbsolute` check.

---

---

## A dirty-check built from the form group silently ignores every signal the save path writes

**Status:** draft — generalized from a project lesson; review before relying on it.

A dirty check derived only from the form group misses state written elsewhere (signals/stores); compute dirtiness from the same source the save path reads.
