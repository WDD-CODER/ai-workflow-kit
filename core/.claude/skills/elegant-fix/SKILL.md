---
name: elegant-fix
description: Refines a working but mediocre fix into a clean, idiomatic solution after the initial implementation is confirmed to work.
---

# Skill: elegant-fix
**Model Guidance:** Use Haiku/Flash for Phases 1 and 3. Use Sonnet for Phase 2 only.

**Trigger:** After any fix that feels hacky, before submitting a PR with "I know this isn't ideal" comments, or when duplicate logic or too many special cases are noticed.

**Code Quality Rules (inline — no guide read required):**
- Naming follows the project's standards doc; boolean flags read `is`/`has`
- No nested subscriptions or callbacks where a flat composition works
- State follows the project's state rules: {{stack.stateRules}}
- No untyped escape hatches (`any` or the language's equivalent)
- Components or modules over ~300 lines → candidate for split/refactor
- Reusable logic → the project's shared utilities (under `{{paths.srcRoot}}`)
- Adapter/Facade pattern for logic too coupled to external APIs or storage
- Styles touched during refactor → run the project's styling skill, if it has one

<!-- PACK:stack — idiom bullets (reactive primitives, decorators, banned state types) come from the stack pack -->

---

## Phase 0 — docs/brain Orient (CONDITIONAL)

If the task involves an unfamiliar area, an architectural choice, or known-recurring debt: read `docs/brain/index.md`, then only the relevant sub-file (`gotchas.md`, `decisions/`, `patterns/`, etc.). Default: skip for routine cleanup. Do not call optional MCP memory tools.

---

## Phase 1: Complexity Audit

**Identify Smell:** Scan for nested subscriptions or callbacks, large modules (>300 lines), or one-off utility functions that belong in the shared utilities.

**State Check:** Identify any untracked or leaking state — any reactive value not managed the way the project's state rules require.

**Duplication Scan:** Flag any copied logic blocks that should be extracted as pure functions.

---

## Phase 2: Structural Refinement

**Pattern Application:** Apply Adapter Pattern or Facade Pattern if the logic is too coupled to external APIs or storage.

**Reactive Logic:** Convert imperative logic to the project's declarative state primitives. Never introduce a state type the project's rules ban.

**Pure Functions:** Extract reusable logic into the project's shared utilities.

---

## Phase 3: Cleanup & Verification

**Dead Code:** Remove unused imports, commented-out code, temporary console logs.

**Naming:** Verify naming and `is`/`has` boolean flags throughout.

**Style Alignment:** If any local styles were touched during refactor → invoke the project's styling skill, if it has one.

---

## Completion Gate

Output: `"Refactored [target] for elegance. [Summary of what was extracted, simplified, or converted]."`

If the refactor touches critical business logic → invoke CI / npm run {{commands.test}} for verification before committing.
