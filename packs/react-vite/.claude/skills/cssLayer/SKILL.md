---
name: cssLayer
description: How {{project.name}} is styled — Tailwind utility classes on the project's component primitives (shadcn/ui or similar), the design tokens in the global stylesheet (`hsl(var(--primary))`, never raw hex), `cn()` for conditional classes, right-to-left-safe logical classes (`ms-/me-/ps-/pe-/start-/end-`), dark mode via the `dark` class. Use before styling ANY component, editing the global stylesheet or `tailwind.config.*`, adding a color, spacing, breakpoint or theme value, and whenever the user mentions styles, CSS, Tailwind, theme, tokens, colors, layout, spacing, RTL or responsive — even without naming this skill.
paths:
  - "src/**/*.css"
  - "src/**/*.tsx"
  - "tailwind.config.*"
---

# cssLayer — styling with Tailwind

The kit's `/fix` loads this skill for `css` work. The name is shared with other stack packs; this one covers a
Tailwind + component-primitive codebase. Check the global stylesheet (usually `src/index.css`) and
`tailwind.config.*` first: they hold the tokens and the theme this file talks about.

## Rules

- **Tokens, not values.** Colors come from the CSS custom properties in the global stylesheet (`:root`, plus `.dark`
  when the app has a dark theme) exposed as Tailwind colors in `tailwind.config.*` (`bg-primary`,
  `text-muted-foreground`, `border-border`). No hex/rgb literals in components; a new color is a new token in every
  theme block.
- **Utilities on primitives.** Style with Tailwind classes on the component primitives. Merge classes with the class
  helper (`cn()`) instead of string concatenation; let callers pass `className`.
- **Right-to-left safe.** Use logical classes — `ms-*`/`me-*`, `ps-*`/`pe-*`, `start-*`/`end-*`,
  `text-start`/`text-end` — not `ml-*`/`mr-*`/`left-*`/`right-*`. Icons that point a direction flip with
  `rtl:rotate-180` (or by the language state) when the app supports a right-to-left locale.
- **Dark mode** is usually the `dark` class (`darkMode: ["class"]`): use token colors and it works; `dark:` variants
  only for a deliberate difference.
- **No new global CSS.** The global stylesheet holds tokens and base layers. A component-level need is a Tailwind
  class or a token, not a new stylesheet.
- **Responsive** with Tailwind breakpoints (`sm: md: lg:`), mobile-first; check narrow widths.
- Never run a formatter over files you did not change; match the existing code style.
