---
name: cssLayer
description: Enforces the project CSS architecture — engine placement, five-group rhythm, and token tier rules — before any SCSS/CSS file is written or edited.
---

# Skill: cssLayer
**Model Guidance:** Use Haiku/Flash for Phases 1 and 2. Use Sonnet for Phase 3 only when designing a new global `.c-*` engine class.

**Trigger:** Before creating or editing any `.scss` or `.css` file in `src/`.

**CSS Rules (inline — no guide read required):**
- `.c-*` engine classes belong **only** in `src/styles.scss` — never inside a component `.scss`
- Angular view encapsulation will scope `.c-*` defined in components, breaking cross-component reuse
- If a `.c-*` is found in a component file → move to `src/styles.scss` before proceeding
- No inline styles unless the value is dynamic/runtime
- Logical properties only: `padding-inline`, `padding-block`, `margin-inline` — no physical directional values
- Responsive breakpoints must follow project token definitions (`$break-mobile`, `$break-tablet`, `$break-desktop` from `src/styles.scss` — never hardcode pixel values)
- **No hardcoded values** — use `var(--*)` for ALL colors, shadows, radii, blur, and easing. Hardcoding `#ffffff`, `rgba(0,0,0,0.1)`, `8px` radius, or `blur(16px)` is a theme violation — the design system tokens exist for exactly these values

---

## Phase 1: Token & Engine Audit 

**Theme Alignment:** Read the design system comment block at the top of `src/styles.scss` (the `/* Designated global tokens */` section). Identify which tokens apply to the component type you're about to style — surface tokens (`--bg-glass`, `--blur-glass`), semantic tokens (`--bg-warning`, `--text-warning`), radius tokens (`--radius-*`), shadow tokens (`--shadow-*`). Every value you write should map to one of these. If you can't find a token for a value, that's a signal the value might not belong in the design.

**Engine Search:** Scan `src/styles.scss` for existing `.c-*` engine classes that can be composed before writing new styles. Composing an engine means adding it as an HTML class on the host element — not replicating its properties in the component SCSS.

**Component Scan:** Check all component `.scss` files in scope for any `.c-*` definitions → move any found to `src/styles.scss`.

**Shared UI Check:** Scan `src/app/shared/` for composable patterns before writing new markup.

---

## Phase 2: Structural Authoring 

Apply the **Five-Group Vertical Rhythm** in every selector — in this order, each group separated by a blank line:

1. **Layout** — `display`, `flex`, `grid`, `position`, `gap`, `z-index`
2. **Dimensions** — `width`, `height`, `aspect-ratio`
3. **Content** — typography, colors, `content`
4. **Structure** — `margin`, `padding`, `border`, `border-radius`
5. **Effects** — `transition`, `animation`, `shadow`, `opacity`

Use logical properties throughout (`margin-inline`, `padding-block`). Use native CSS nesting syntax. Place responsive breakpoint blocks after the base selector — never before the base styles.

---

## Phase 3: Complexity Review 

> **Only invoke if** the same styles are repeated across more than two components.

**Abstraction:** Propose a new `.c-*` engine class for `src/styles.scss` — name it, define it, register it. Then replace the repeated styles in each affected component file with the new `.c-*` class.

**Performance:** Optimize for layout stability (avoid CLS) and minimal selector depth.

---

## Completion Gate

- No inline styles added (unless value is dynamic/runtime)
- Responsive breakpoints use `$break-*` SCSS variables — no hardcoded pixel values
- No `.c-*` class defined in any component `.scss` file
- Five-Group Vertical Rhythm applied to every new/edited selector
- No hardcoded colors, shadows, radii, or blur values — every value uses `var(--*)` or a `$` SCSS variable from `src/styles.scss`
