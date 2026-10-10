---
name: cssLayer
description: {{project.name}} CSS architecture — where `.c-*` engine classes may live, design-token usage (`var(--*)`, `$break-*`), logical properties and the five-group property order. Use before creating or editing ANY `.scss` or `.css` file under `src/`, when styling a component, adding a breakpoint or a glass surface, and whenever the user mentions styles, SCSS, CSS, theme, tokens, layout, spacing or responsive — even if they never say "cssLayer".
paths:
  - "src/**/*.scss"
  - "src/**/*.css"
---

# cssLayer — writing SCSS in {{project.name}}

The design system lives in `src/styles.scss`: the token block at the top (`/* Designated global tokens */`), the `$break-*` variables, and the `.c-*` engine classes. Component `.scss` files only *compose* that system. Every rule below exists to keep that true.

## Rules and why

- **`.c-*` engine classes are defined only in `src/styles.scss`.** Angular view encapsulation rewrites selectors inside a component stylesheet, so a `.c-*` defined there is scoped to that component and silently stops being reusable. Use an engine by adding its class to the host element in the template, not by copying its properties.
- **No hardcoded design values.** Colors, shadows, radii, blur and easing come from `var(--*)` tokens. A literal `#fff`, `rgba(0,0,0,.1)`, `8px` radius or `blur(16px)` is a theme fork: it will not follow the theme when a token changes. If no token fits, that is a signal the value doesn't belong in the design — ask before inventing one.
- **Breakpoints.** `$break-mobile` (768) / `$break-tablet` (900) / `$break-desktop` (1200) are declared in `src/styles.scss`, and Sass variables there are *not* reachable from a component stylesheet (no `stylePreprocessorOptions.includePaths`). Until a shared `_breakpoints.scss` partial exists, declare a local mirror at the top of the component file with a comment naming the global it mirrors — `$break-tablet: 900px; // mirrors src/styles.scss` — and use that in `@media`. Never a bare number inside `@media`.
- **Logical properties only** (`padding-inline`, `margin-block`, `inset-inline-start`). The UI is RTL ({{project.uiLocale}}); physical `left`/`right` breaks mirroring.
- **No inline styles** unless the value is runtime-dynamic.
- **Native CSS nesting**, breakpoint blocks *after* the base styles of the selector.

## Workflow

1. **Audit before writing.** Read the token block at the top of `src/styles.scss` and pick the tokens for this surface (surface: `--bg-glass`, `--bg-glass-strong`, `--blur-glass`; semantic: `--bg-warning-soft`, `--text-warning`; type: `--fs-*`, `--fw-*`; `--space-*`; `--radius-*`; `--shadow-*`; `--ease-smooth`/`--ease-spring`). Grep `src/styles.scss` for an existing `.c-*` engine and `{{paths.srcRoot}}shared/` for a composable pattern before authoring anything new.
2. **Write each selector in five groups**, blank line between groups, in this order:

   ```scss
   .recipe-card {
     display: grid;                       /* 1 layout: display, flex/grid, position, gap, z-index */
     grid-template-columns: 1fr auto;

     inline-size: 100%;                   /* 2 dimensions: width/height (logical), aspect-ratio */

     color: var(--color-primary);         /* 3 content: typography, colors, content */
     font-size: var(--fs-md);

     padding-inline: var(--space-4);      /* 4 structure: margin, padding, border, radius */
     border-radius: var(--radius-md);

     transition: box-shadow var(--ease-smooth); /* 5 effects: transition, animation, shadow, opacity */
     box-shadow: var(--shadow-glass);

     @media (min-width: $break-tablet) {  /* breakpoints come last; $break-tablet is the local mirror */
       grid-template-columns: 1fr 1fr;
     }
   }
   ```

3. **Promote, don't repeat.** The same block in more than two components → define a `.c-*` engine in `src/styles.scss`, then replace the copies with the class in each template.

## Verify before you finish (loop until both are empty)

```bash
# engines defined in a component stylesheet — must print nothing for the files you edited
grep -nE "^\s*\.c-[a-z]" <edited .scss files>
# hardcoded values — must print nothing (tokens, and the one-line $break-* mirror declaration, are fine)
grep -nE "#[0-9a-fA-F]{3,8}\b|rgba?\(|[0-9]+px.*(radius|blur)|@media.*[0-9]+px" <edited .scss files>
```

A hit means fix it, re-run. Pre-existing hits in files you did not touch are tech debt, not your job here — note them for `techdebt`.
