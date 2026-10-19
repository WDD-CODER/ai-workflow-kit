---
name: react-component-structure
description: How a page, component or hook is built in {{project.name}} (React + Vite + TypeScript) — file placement, export style, the top-to-bottom order inside a component (props → shared hooks → server state → local state → derived values → effects → handlers → render), data through query hooks, auth from the shared session hook, lazy route registration. Use before creating, scaffolding, refactoring or reviewing ANY `*.tsx` under `src/pages` or `src/components` or a hook under `src/hooks`, when adding a page, dialog, sheet, tab or widget, and whenever the user mentions a component, page, modal, dialog, hook or "structure" — even without naming this skill.
paths:
  - "src/pages/**/*.tsx"
  - "src/components/**/*.tsx"
  - "src/hooks/**/*.ts"
  - "src/hooks/**/*.tsx"
---

# react-component-structure

The checklist you apply to one file. Rules with their reasons live in `docs/agent/conventions.md` (layout, naming)
and `docs/agent/standards-react.md` (data, auth, routing). Check how neighbouring files do it first; the project's
consistent habit wins over the examples here.

## Where it goes

- A routed page: `src/pages/<Name>.tsx` (PascalCase, **default export**, because a lazy import needs one),
  registered in `{{paths.routesFile}}` as a lazy import (through the project's lazy-with-reload helper when it has
  one). The router file is a hotspot: add your route, never reorder or rewrite the others.
- A feature component: `src/components/<feature>/<Name>.tsx`.
- Component primitives (`src/components/ui/`) are composed, not forked.
- Reusable logic: a hook in `src/hooks/useX.ts(x)`, or a pure function in `src/lib/` with a `*.test.ts` beside it.

## Order inside a component

1. Props type (`type Props = { … }` or an inline object type) — no `any`.
2. Context and shared hooks: translation / language, the session hook, tenant or permission hooks.
3. Server state: `useQuery` / `useMutation` (in a hook when reused). Keys include the caller's identity; gate with
   `enabled: isReady && !!user`.
4. Local UI state: `useState` / `useReducer`.
5. Derived values: `useMemo` (or plain expressions) — derive, don't mirror props or query data into state.
6. Effects: `useEffect` only for subscriptions and imperative sync; clean up what you subscribe to.
7. Handlers: `const handleX = …` / `useCallback` when passed to memoized children.
8. Early returns for loading / empty / error, then the JSX.

## Checks before you finish

- Data goes through the typed client in a hook or `src/lib/`, not a raw `fetch(` inside a page or component
  (`node scripts/techdebt-report.mjs scan` counts it).
- Permissions in the UI only hide controls; the real check is on the server.
- User-facing text comes from the translation files when the project has them, and the layout works right-to-left
  (logical Tailwind classes, see `cssLayer`).
- Imports use the project's path alias.
- Files over 300 lines: extract a hook or a child component rather than growing the file.
