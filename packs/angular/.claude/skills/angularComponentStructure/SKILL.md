---
name: angularComponentStructure
description: The required class layout for every Angular component in {{project.name}} — section order (injected → inputs → outputs → signals → computed → CRDUL methods), signals-only state, `inject()`, `input()`/`output()`/`model()`, OnPush. Use before creating, scaffolding, refactoring or reviewing ANY `*.component.ts`, when adding a page or modal, and whenever the user mentions a component, page, modal, dialog, widget or "class structure" — even without naming this skill.
paths:
  - "{{paths.srcRoot}}**/*.component.ts"
---

# angularComponentStructure

Every component class reads the same way, top to bottom, so any agent or developer can find state, API and behaviour without scanning. The order is the rule; the rest of the Angular conventions (signals only, `inject()`, no `any`, quotes/semicolons) are in `AGENTS.md` and `docs/agent/standards-angular.md` and are not repeated here.

## Class section order

```ts
@Component({
  selector: 'recipe-card',            // kebab-case, no app- prefix unless it collides with native HTML
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, LucideAngularComponent],
  templateUrl: './recipe-card.component.html',
  styleUrl: './recipe-card.component.scss',
})
export class RecipeCardComponent {
  // 1. INJECTED
  private readonly recipeService = inject(RecipeService)
  private readonly userMsg = inject(UserMsgService)

  // 2. INPUTS  — input(), model()
  recipe = input.required<Recipe>()
  expanded = model(false)

  // 3. OUTPUTS — output()
  selected = output<Recipe>()

  // 4. SIGNALS & CONSTANTS — writable private state ends with _; expose it via asReadonly(). computed() never carries the _ suffix
  private readonly saving_ = signal(false)
  readonly saving = this.saving_.asReadonly()
  readonly maxTags = 5

  // 5. COMPUTED
  readonly title = computed(() => this.recipe().name.trim())

  // 6. METHODS in CRDUL order: Create, Read, Delete, Update, List — then UI handlers
  addTag(tag: string) { /* C */ }
  tagById(id: string) { /* R */ }
  removeTag(id: string) { /* D */ }
  rename(name: string) { /* U */ }
  tags() { /* L */ }
  toggleExpanded() { /* UI handlers (toggle, dismiss, next…) come after the five data groups, never between them */ }
}
```

Why CRDUL and not alphabetical: the verbs map to the data flow a reader is tracing, and grouping them makes a missing branch (a delete with no confirm, an update with no validation) visible at a glance.

## When you create a component

- Four files: `.ts`, `.html`, `.scss`, `.spec.ts` (skip `.spec.ts` during iterative plan work — specs are written when the unit is finalized or on request, per `docs/agent/standards-angular.md`).
- Register every Lucide icon the template uses in `app.config.ts` before using it — an unregistered icon renders nothing and fails silently.
- Styles follow `cssLayer` (it activates on its own when you touch the `.scss`).
- UI strings go through the translation pipe + `{{project.i18nFile}}` (append-only hotspot).

## When you refactor an existing component

Reorder the existing members into the six sections in place; do not recreate files. Keep behaviour identical — a reorder commit should contain no logic change.

## Check before finishing

Re-read the class top to bottom and confirm: sections appear in order 1–6 with nothing interleaved; CRDUL is contiguous with UI handlers after it; no `@Input`/`@Output`, `BehaviorSubject`, constructor injection or `any`; writable private signals end with `_` and are exposed read-only; nothing public carries the `_` suffix. Build is checked at `/ship`, not here.
