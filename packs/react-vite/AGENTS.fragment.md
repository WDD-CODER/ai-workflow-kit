## Hard rules

- Server state through the query library (`useQuery` / `useMutation`); caller-scoped query keys carry the user (and tenant) id. No Zustand/Redux for server data.
- One shared session source, read through one hook; UI permission checks only hide controls — the server enforces access.
- Data access in hooks or `src/lib/`, through the typed client — no raw `fetch(` in pages or components; generated client and type files are never hand-edited.
- Pages are lazy routes in `{{paths.routesFile}}` (append, never reorder); Tailwind tokens and logical (RTL-safe) utilities, no hex literals.
- Match the existing code style of each file (quotes, semicolons); never reformat untouched lines.

## Skill triggers

| Before creating or reviewing a page, component or hook under `src/` | `.claude/skills/react-component-structure/SKILL.md` |
| Auth, sessions, roles, server-function access, logging, anything storing user data | `.claude/skills/auth-and-logging/SKILL.md` |
| Before styling a component, the global stylesheet or `tailwind.config.*` | `.claude/skills/cssLayer/SKILL.md` |

## Standards index

| `docs/agent/standards-react.md` | Pages, components, hooks, data access, routing, styling |
| `docs/agent/conventions.md` | Folder layout, naming, imports, code style |
