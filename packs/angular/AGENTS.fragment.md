## Hard rules

- Signals only: `signal()`, `computed()`, trailing underscore for private state. No `BehaviorSubject`.
- `inject()` for DI — never constructor injection.
- `input()` / `output()` / `model()` — never `@Input` / `@Output`.
- Logical CSS properties only.
- No `any`. Single quotes and no semicolons in `.ts`. Double quotes in `.html`.

## Skill triggers

| Before any Angular component class | `.claude/skills/angularComponentStructure/SKILL.md` |
| Auth guards, interceptors, user services, HTTP CRUD | `.claude/skills/auth-and-logging/SKILL.md` |
| New `pages/<x>/` or top-level subtree; files moved/deleted; before a PR that reshaped folders | `.claude/skills/breadcrumbs/SKILL.md` (+ `scripts/breadcrumbs-check.mjs`) |
| Before any `.scss` / `.css` edit in `src/` | `.claude/skills/cssLayer/SKILL.md` |

## Standards index

| `docs/agent/conventions.md` | Editing components, templates, SCSS/CSS |
| `docs/agent/standards-angular.md` | Components, pipes, directives, SCSS, folder structure |
