---
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
---

# React + Vite Standards

> Load this file when: writing, refactoring or reviewing anything under `src/` (pages, components, hooks, data
> access, routing, styling). Layout and naming live in `docs/agent/conventions.md`; the backend (database, access
> rules, server functions) in the project's backend standards when it has them.
>
> Each rule says what to check and why. Before applying one, look at how this project already does it (search for
> the hook, helper or pattern named) and follow the existing code; the examples here are the common shapes, not
> files this project is guaranteed to have.

## Server state

- **Do** fetch server data through the project's query library (usually `@tanstack/react-query`: `useQuery`, and
  `useMutation` + `invalidateQueries` after a write). **Not** a global store (Zustand, Redux) for server data, and
  not `useEffect` + `useState` copies of a response.
- **Do** keep the app-wide defaults (`staleTime`, `gcTime`, `refetchOnWindowFocus`) where the project sets them,
  usually on the shared `QueryClient` next to the app root. Override per query only with a reason in a comment.
- **Do** put the caller's identity (user id, and the tenant or organisation id when there is one) in every query
  key that returns caller-scoped data, e.g. `["projects", userId, orgId]`. **Not** a global key: when the server
  filters rows per user, the same key would serve one user's rows to the next.
- **Do** clear the query cache only when the signed-in identity actually changes (sign-out, a different user id),
  never on a token refresh for the same user.
- **Do** gate queries on auth: `enabled: isReady && !!user`. A query that runs before the session is restored
  returns empty results and caches them.

## Auth and identity

- **Do** read the session from the project's single auth source (one store or context that subscribes to the
  auth client once, read through a hook such as `useAuth()` / `useSession()`). **Not** a new auth listener or a
  `getSession()` call per component: each mount adds a listener and a request.
- Permission checks in the UI only decide what is shown. The server (access rules, server functions) must enforce
  the same rule; a UI-only check on sensitive data is a finding.
- Don't "fix" legacy auth calls as drive-by changes; list them for a plan.

## Data access

- **Do** use the project's one typed client (import it from its module, e.g. `@/lib/api` or the generated client of
  the backend). Generated client and type files are never hand-edited.
- **Do** keep data access in hooks or `src/lib/` helpers, not inline in pages and presentational components, so a
  rule (scoping, error handling, paging) lives in one place.
- **Not** a raw `fetch(` to the project's own API when the typed client covers it.
- When the generated types lag the backend, `as any` on the missing name is tolerated; flag it in new code where
  the type exists.

## Realtime and subscriptions

- **Do** open subscriptions (realtime channels, websockets, event sources) in a `useEffect` with a unique, scoped
  name and a server-side filter, and close them in the cleanup. **Not** an unfiltered, app-wide subscription:
  every change for every user would reach every client.
- On an event, invalidate or refetch the affected queries; don't patch cached rows by hand.

## Routing and lazy pages

- **Do** register every page in the router file (`{{paths.routesFile}}`) as a lazy import, through the project's
  lazy helper when it has one (a wrapper that reloads once when a chunk is missing after a deploy). **Not** plain
  `React.lazy` when such a helper exists: an open tab that requests a deleted chunk goes blank.
- Render routes inside an error boundary + `<Suspense>`. Add new routes above the catch-all route; never reorder
  or rewrite the others (the router file is a shared hotspot).

## Components and hooks

- Function components only. Follow the top-to-bottom order of the `react-component-structure` skill: props type,
  context and shared hooks, server state, local state, derived values, effects, handlers, early returns, JSX.
- Derive values (`useMemo` or a plain expression) instead of mirroring props or query data into state.
- `useEffect` is for subscriptions and imperative sync only, with a cleanup when it subscribes.
- Reusable logic goes into a hook (`useX`) or a pure function in `src/lib/` with a test beside it, not into a page.
- Files over 300 lines: extract a hook or a child component rather than growing the file.

## Styling: Tailwind and component primitives

- **Do** build UI from the project's component primitives (often shadcn/ui under `src/components/ui/`) and compose
  classes with the project's class helper (`cn()` from `@/lib/utils` in shadcn projects). Primitives are composed,
  not forked.
- **Do** use the design tokens (CSS variables exposed as Tailwind colors, e.g. `bg-primary`,
  `text-muted-foreground`). **Not** hex or rgb literals in components.
- **Do** use logical utilities (`ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`, `text-start`/`text-end`) instead of
  `ml-`/`mr-`/`left-`/`right-`/`text-left`, so the layout mirrors in a right-to-left locale.
- Styling details: the `cssLayer` skill.

## Text and direction

- **Do** put user-facing strings in the project's translation files when it has them (see `project.i18nFile` in
  `kit.config.json`), read through its translation hook. No hard-coded user-facing text in components then.
- Direction comes from the language state (`dir` on the document root), never from the text itself.

## Tests

- Unit tests sit next to the code (`*.test.ts` / `*.test.tsx`, usually Vitest). Pure helpers in `src/lib/` get a
  test with the change.
- The gates are the project's npm scripts: `npm run {{commands.build}}`, `npm run {{commands.lint}}`,
  `npm run {{commands.test}}`.
