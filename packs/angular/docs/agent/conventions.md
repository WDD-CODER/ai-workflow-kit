# Conventions — Angular / CSS / TypeScript / Translation

> Tool-agnostic. Load when creating or editing Angular components, templates, SCSS/CSS, or translation keys.

---

## Angular & reactivity

* Standalone components + `ChangeDetectionStrategy.OnPush` always.
* Signals only: `signal()`, `computed()`, `effect()`. Private state: `data_ = signal<T>(...)`. Public read-only via `.asReadonly()`. No `BehaviorSubject` / `Subject` for state.
* `inject()` for all DI — never constructor injection.
* Component API: `input()`, `input.required()`, `output()`, `model()` — never `@Input()` / `@Output()`.
* No `any`. Single quotes in `.ts`, no semicolons. Double quotes in `.html`.
* Selectors kebab-case; `app-` prefix only for native HTML collisions. Filename matches selector. Classes PascalCase. Booleans use `is` / `has` prefix.
* Services: `src/app/core/services/`, suffix `.service.ts`, `@Injectable({ providedIn: 'root' })`, signals + `AsyncStorageService` + `UserMsgService`.
* Folder structure: `core/` (services, models, guards, pipes, directives), `shared/` (reusable UI), `pages/[name]/` (routed views + local `components/`). Path aliases: `@services/*`, `@models/*`, `@directives/*`.
* Shared helpers → `util.service.ts` or `core/utils/` — pure functions only.
* Component class section order: injected services → inputs → outputs → signals/constants → computed → CRDUL methods (Create, Read, Delete, Update, List).
* Before new UI: scan `src/app/shared/` and `{{paths.hotspots}}` (`.c-*` engines) for something composable.

---

## CSS / SCSS

* `.c-*` engine classes live in `{{paths.hotspots}}` only — never in component SCSS.
* Logical CSS properties only (`margin-inline`, `padding-block` — not left/right).
* Native nesting, `@layer`. No inline styles unless the value is dynamic/runtime.
* Property order (five-group rhythm): Layout → Dimensions → Content → Structure → Effects.
* No hardcoded colors/radii/shadows/blur — use `var(--*)` design tokens.
* Responsive breakpoints via project tokens (`$break-mobile`, `$break-tablet`, `$break-desktop`) — never hardcode pixel breakpoints.
* Before creating or editing any `.scss`/`.css` in `src/`, follow the `cssLayer` skill.

---

## Translation ({{project.uiLocale}})

* All user-facing text goes through the translate pipe and `{{project.i18nFile}}`; never hardcode UI strings in templates or TypeScript.
* Keys: lowercase, underscores only; group them by section (units, categories, general, …).
* Canonical identifiers (units, categories and similar registries): resolve user input to the existing key through the translation service; never store the translated label as the ID.
* If no matching key exists: prompt for the key, then add the label to the dictionary.
* Reuse one shared "missing translation key" modal; do not build a second one.
* Icons used in templates must be registered with the project's icon registry before use.
