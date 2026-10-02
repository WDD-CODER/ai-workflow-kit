---
name: angularComponentStructure
description: Defines the mandatory class structure, section ordering, and CRDUL method grouping for every Angular component in this project.
---

# Skill: angularComponentStructure

**Model Guidance:** Use Haiku/Flash for Phases 1 and 3. Use Sonnet for Phases 2 and 4.

**Trigger:** Before creating or refactoring any Angular component class.

**Component Rules (inline — no guide read required):**
- `standalone: true` — always
- `changeDetection: ChangeDetectionStrategy.OnPush` — always
- `inject()` for all dependencies — no constructor injection ever
- No `.c-*` classes defined in component `.scss` — use `src/styles.scss` engines only
- Icons must be registered with the project icon registry before use in templates
- `.spec.ts` only during `commit-to-github` Phase 0 or explicit user request — never during iterative work
- No `any` types — use explicit TypeScript types for all method parameters and return values

---

## Phase 1: Boilerplate Generation 

**File Creation:** Standard four-file split: `.ts`, `.html`, `.scss`, `.spec.ts` (unless `inlineTemplate` requested). When refactoring an existing component, skip file creation — reorder class sections in place.

**Class Section Order (strict — enforce this sequence every time):**
1. INJECTED services
2. INPUTS (`input()`, `model()`)
3. OUTPUTS (`output()`)
4. SIGNALS & CONSTANTS (`signal()`, `readonly`)
5. COMPUTED SIGNALS (`computed()`)
6. CRDUL methods — Create, Read, Delete, Update, List (grouped in this order)

---

## Phase 2: Reactive State Definition 

**Signal Mapping:** Define internal state using `signal()`. Expose public state via `.asReadonly()`.

**Derived State:** Implement `computed()` values to prevent unnecessary `effect()` calls.

**API Definition:** Use `input()`, `output()`, `model()` for all component communication — no `@Input`/`@Output` decorators.

---

## Phase 3: Template & Style Integration 

**HTML:** Double quotes throughout. Semantic element choice. Verify every icon used is registered with the project icon registry.

**SCSS:** Follow cssLayer skill rules — logical properties (`margin-inline`, `padding-block`), five-group vertical rhythm.

**Engine Check:** Scan component `.scss` for any `.c-*` class definitions → move to `src/styles.scss` if found.

---

## Phase 4: Unit Test Strategy 

> **Only execute this phase during `commit-to-github` Phase 0 or on explicit user request.**

**Spec Logic:** Define core testing requirements for the component's Signal-driven logic.

**Signal Testing:** Ensure `.spec.ts` correctly triggers and asserts signal changes.

---

## Completion Gate

Output: `"Component [Name] created with [X] signals and [Y] inputs. Icon registry verified."`

Update `.claude/todo.md` and proceed to the next atomic task.
