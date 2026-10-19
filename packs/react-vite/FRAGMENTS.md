# React-Vite pack fragments

Each `## <name>` section replaces the `<!-- PACK:<name> -->` (or `# PACK:<name>`) line in the core files.
Not installed itself. Placeholders render as in any kit file.

## style:refactor

- Reference `cssLayer` skill before changing Tailwind classes, the global stylesheet or `tailwind.config.*` — tokens and logical (RTL-safe) utilities only.

## loads:refactor

- `react-component-structure` skill — component order, where pages, hooks and `src/lib/` helpers go
- `cssLayer` skill — design tokens, `cn()`, logical utilities

## loads:security

- `auth-and-logging` skill — one session source, server-side access checks, secrets out of the client bundle, no PII in logs

## techdebt

- `node scripts/techdebt-report.mjs scan` also counts the React rules: `inner-html` (`dangerouslySetInnerHTML`, needs a sanitizer review each time), `banned-state` (Zustand / Redux / MobX / Recoil / Jotai imports) and `raw-fetch` (`fetch(` in `src/`, where data goes through the typed client)
- An old codebase starts far above zero: record the baseline once (`scan --write-baseline`) and judge the **delta** (`NEW_DEBT: yes` is a finding; the absolute count is context)
- When the whole repo has old lint debt, lint only the files in scope (`npx eslint <files>`) and count those

## workflow-map:skills

| `react-component-structure` | creating or reviewing a page, component or hook under `src/` | `docs/agent/conventions.md`, `docs/agent/standards-react.md` | — |
| `cssLayer` | styling, the global stylesheet, `tailwind.config.*` (tokens, `cn()`, logical classes) | `docs/agent/standards-react.md` | — |
| `auth-and-logging` | auth, roles, server-function access, logging | `docs/agent/standards-security.md` | — |
