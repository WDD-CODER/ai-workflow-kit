---
paths:
  - "src/app/**/*.ts"
  - "src/app/**/*.html"
  - "src/app/**/*.scss"
---

# Angular & CSS Standards

> Load this file when: creating or refactoring components, pipes, directives, writing SCSS/CSS, designing folder structure, or evaluating architecture trade-offs.

---

## Angular 19 & Reactivity

* **Architecture**: Adapter Pattern via `IStorageAdapter`. Standalone Components + `inject()`.
* **Reactivity**: Signals only. `data_ = signal()`, public `.asReadonly()`. No BehaviorSubject.
* **API**: Use `input()`, `output()`, `model()` — no `@Input`/`@Output`.
* **Logic**: project-specific domain rules live in `{{docs.domainStandards}}`, not here.
* **Syntax**: Path aliases `@services/*`, no `any`, single quotes in TS, double quotes in HTML, no semicolons.
* **Naming**: Selectors kebab-case; `app-` prefix only for native HTML collisions. Filename matches selector. Classes PascalCase; boolean flags `is`/`has`.
* **Utils**: Put shared helpers in `src/app/core/services/util.service.ts` (or `core/utils/`); no one-off helpers in components. Utilities must be pure (same inputs → same outputs; no I/O or mutation of arguments/shared state).
* **Pipes & directives**: `core/pipes/` and `shared/directives/`, `standalone: true`. A pipe implements `PipeTransform` and `transform()` is pure — same inputs, same output, no I/O, no shared-state mutation (an impure pipe re-runs every change-detection cycle). Directives use `inject(ElementRef)` / `inject(Renderer2)`, never constructor injection. Export from the barrel when shared. Specs test the pure logic only — no DOM in pipe specs.
* **Services**: All services in `src/app/core/services/`, suffix `.service.ts`. `@Injectable({ providedIn: 'root' })`, Signals for state, `AsyncStorageService` for persistence, `UserMsgService` for feedback. Expose read-only state via `.asReadonly()`. Add `.spec.ts` when the service is finalized.

---

## UI, CSS & Folder Structure

* **Hierarchy**: `core/` (services, models, guards, pipes, directives), `shared/` (reusable UI), `pages/[name]/` (routed views + local `components/`).
* **breadcrumbs.md**: Keep maps at **major** seams (`src/app/core/`, `core/services`, `core/models`, `core/components`, `shared/`, `pages/`) — not in every leaf folder. If you add a new `pages/<feature>/` or top-level subtree under `src/app/`, add or refresh the nearest `breadcrumbs.md` via the `breadcrumbs` skill (`node scripts/breadcrumbs-check.mjs` shows what is stale).
* **Styles**: Scoped SCSS, native nesting, `@layer`. No inline styles unless dynamic. Before any new or edited `.scss`/`.css` in `src/`, run the `cssLayer` skill.
* **Engine placement (hard rule)**: `.c-*` engine classes belong **only** in `src/styles.scss`. Never define a `.c-*` class in a component `.scss` file — Angular view encapsulation will scope it and break cross-component reuse.
* **Property order**: Layout → Dimensions → Content → Structure → Effects.
* **Shared UI**: Before any new UI (control, layout, or pattern), scan `src/app/shared/` and `src/styles.scss` (`.c-*` engines) for something composable. Prefer shared structures — add page-local markup only when nothing fits.
* **Shared modals**: Before any modal (translation-key, confirm, leave guard, destructive action), search `src/app/shared/` for an existing dialog pattern and reuse it. If a new kind is needed across features, implement or extend it in `shared/`.

---

## Test Standards

* **Unit tests**: Add or update `.spec.ts` when a unit is finalized, at `/ship`, or when the user asks — avoid churn mid-iteration. Run only **targeted** specs for files you changed. Run the **full** suite only at `/ship` or when the user asks.
* **Do NOT write `.spec.ts` during iterative plan execution** — spec authoring is for `/ship` or explicit user request only.
* **Playwright**: `getByRole` or `getByTestId`; no `page.locator`. Web-first assertions. TDD-first; Jasmine/Karma for unit tests.

