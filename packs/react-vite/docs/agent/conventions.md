# Conventions — React / TypeScript / Tailwind

> Tool-agnostic. Load when creating, editing or reviewing anything under `src/`. Data, auth, routing and realtime
> rules live in `docs/agent/standards-react.md`. This file is layout and style only. Where this project already
> does something differently and consistently, the project's way wins: check a few neighbouring files first.

---

## Folder structure

* `src/pages/` — one routed page per file, PascalCase (`Projects.tsx`, `ProjectDetails.tsx`), default export (a lazy
  import needs one), registered in `{{paths.routesFile}}`. A sub-area gets a folder (`src/pages/admin/`).
* `src/components/<feature>/` — feature components, one folder per feature. `src/components/ui/` holds the
  component primitives only (shadcn/ui); app chrome (layout, error boundary, banners) gets its own folder.
* `src/hooks/` — one hook per file, `useX.ts` or `useX.tsx`.
* `src/lib/` — pure helpers and logic pulled out of pages, with tests beside them (`*.test.ts`).
* `src/contexts/` — app-wide React contexts.
* Generated code (API clients, database types) stays in its own folder and is never hand-edited.

## Components and hooks

* Function components only. Pages use a default export; feature components follow the project's majority (named
  exports are the common choice).
* Components and their files are PascalCase; hooks start with `use`; booleans read `isX` / `hasX`.
* Put reusable logic in a hook or a `src/lib/` function, not in a page.

## Imports and typing

* Import through the path alias the project configures (usually `@/` → `src/`, set in `vite.config.ts`
  `resolve.alias` and `tsconfig.json` `paths`) instead of long `../../` chains.
* **Match the existing code style** (quotes, semicolons, trailing commas) of the file and the project. Never run a
  formatter over files you did not change, and never introduce a formatter config that disagrees with the code.
* Type new props and return values explicitly. When the project's TypeScript is not strict (`strict: false`),
  guard nullable values by hand: the compiler won't.
* Lint with `npm run {{commands.lint}}`; when the whole repo has old lint debt, lint only the files you changed
  (`npx eslint <files>`).

## Tailwind and component primitives

* Build UI from `src/components/ui/*` and merge classes with the project's class helper (`cn()`); let callers pass
  `className`.
* Before a new dialog, picker or table, look for one in `src/components/ui/` or the feature folder.
* No new CSS files for component styling: a Tailwind class or a design token. Tokens live in the global stylesheet
  and `tailwind.config.*`.

## Text and direction

* User-facing strings go through the project's translation files and hook when it has them.
* Layout direction comes from the language state, never from the text. Use logical utilities
  (`ms-`/`me-`/`ps-`/`pe-`/`text-start`/`text-end`), not `ml-`/`mr-`/`text-left`.
* Numbers, phone numbers, emails and codes inside right-to-left text need left-to-right handling (a `dir="ltr"`
  span or the project's formatter helpers).
