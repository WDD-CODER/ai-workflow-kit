# angular gotchas

## Gating a user action on a fire-and-forget side-write silently breaks it for some users

**Status:** draft — generalized from a project lesson; review before relying on it.

Never gate a user action on an un-awaited background write; either await it or decouple so the action works for users whose write has not landed.

---

## Component-scoped SCSS can't reach styles.scss's $break-* breakpoint variables

**Status:** draft — generalized from a project lesson; review before relying on it.

Component-scoped stylesheets cannot see another file's preprocessor variables; expose shared breakpoints/tokens as CSS custom properties or an explicit import.

---

## CSS Grid `auto-fill` shares column-track widths across rows — squeezes mixed-length labels

**What hurt:** Inventory's filter-panel checkboxes (category/allergen groups) needed to pack densely on tablet/mobile so short labels (most allergens) sit several per row instead of one per row. First attempt used `display:grid; grid-template-columns:repeat(auto-fill, minmax(0, max-content)); grid-auto-flow:dense`. It compiled and built clean, but the Human immediately reported it unreadable — labels visibly cramped/cut off.

**Why the obvious fix is wrong:** `auto-fill` computes a fixed number of column tracks, and every track's width is shared across *all* rows at that column index — it isn't "size each item to its own content," it's "size each column to the widest item that ever lands in it, across the whole grid." When items vary a lot in natural width (a 3-character allergen next to a long category name), auto-placement can drop a wide item into a track sized for a narrower one, clipping its text. Nothing errors on this — it's a purely visual defect a build/test pass cannot catch.

**What to do instead:** For "pack chip-like items of varying width, wrap to the next line" layouts, use `display:flex; flex-wrap:wrap` — each flex item keeps its own natural content width independent of its neighbors, and simply wraps. Reach for CSS Grid dense-packing only when items are meant to share a uniform track size on purpose (e.g. a card grid); for free-width label/chip wrapping, flex-wrap is the correct default, not grid.

---

## Nested `overflow:auto` inside a `max-height`-capped grid row traps scroll instead of letting the page scroll

**What hurt:** `list-shell`'s tablet/mobile layout (shared by Inventory, Recipe Book, Suppliers, Equipment) capped `.list-container` at `max-height:90dvh` with a `1fr` grid row for the table area, while `.table-body` kept its own `overflow-y:auto` (needed for the desktop fixed-height widget). On tablet, opening the filter panel pushed content down, but the page could not scroll past the panel to reach the list below it — even though `.list-container` itself was set to `overflow:visible`.

**Why the obvious fix is wrong:** `overflow:visible` on the *outer* grid container does nothing to stop an *inner* element's own `overflow-y:auto` from claiming all vertical scroll input once that inner box's content exceeds its available height. A `1fr` row inside a `max-height`-bounded grid still computes a bounded height for that row — exactly the budget the inner `overflow:auto` box then scrolls internally instead of letting the outer page take over. Nothing throws or fails a test here; it silently traps input only on real devices at real widths.

**What to do instead:** When a grid layout needs to switch from "internal scroll region" (desktop, fixed-height widget) to "grows with the page" (mobile, page itself scrolls) at a breakpoint, change all three together: the container's height constraint (`max-height` → remove, use `auto`), the row sizing (`1fr` → `auto`, since there's no longer a fixed budget to fill a fraction of), and the previously-scrolling descendant's own `overflow` (`auto` → `visible`). Changing only the outermost `overflow` value is not sufficient on its own.

---

## `ngTemplateOutlet` doesn't inherit `[formGroup]` from the element it's outlet-rendered into

**What hurt:** Equipment's row-level inline-edit panel (`equipment-list.component.html`) rendered as a visibly empty box whenever a row's edit was opened — no console error surfaced in normal use, but the browser actually threw `NG01050: formControlName must be used with a parent formGroup directive` mid-render, which aborts that view's change detection the same way an unregistered Lucide icon does (see the entry above this file's earlier "Unregistered Lucide icon" gotcha) — the panel's outer box painted, its `formControlName`-bound fields never did. `[formGroup]="editForm_"` was set correctly on the wrapping `<div class="inline-edit-panel">`, and the form fields lived, in the rendered DOM, as visible descendants of that div — reached only via `<ng-container [ngTemplateOutlet]="panelBody">`.

**Why the obvious fix is wrong:** DOM nesting and Angular's dependency-injection view of a template are not the same thing. `<ng-template #panelBody>`'s content is compiled against the injector context of where the `<ng-template>` is *declared* in the source, not against wherever `ngTemplateOutlet` later projects its instantiated view. Since `#panelBody` was declared as a top-level sibling (outside any `[formGroup]`-bearing element), every `formControlName` inside it looks for a `ControlContainer` up its *declaration-site* ancestry — finds none — and throws, regardless of which real DOM element the outlet renders it into. Putting `[formGroup]` on the two outlet call sites (desktop inline, tablet/mobile modal) looks right and changes nothing.

**What to do instead:** Put `[formGroup]` (or any `ControlContainer`-providing directive) on an element *inside* the `<ng-template>`'s own declared content, not on the element(s) that `ngTemplateOutlet` renders it into. A `<ng-container [formGroup]="form">` wrapping the template's content works and adds no DOM node, so it can't break surrounding flex/grid layout. Reusing one `<ng-template>` from multiple outlet call sites (as here, for a desktop vs. tablet/mobile variant) makes this doubly worth checking — fix it once, inside the template, not once per call site.

---

## A form-rebuilt save payload silently drops any model field the form has no control for

**Status:** draft — generalized from a project lesson; review before relying on it.

A save payload rebuilt from a form silently drops model fields that have no form control; merge the form value onto the original model instead of replacing it.

---

## A service that both `autoLoad`s in its constructor and exposes `reloadFromStorage()` double-fetches on every session bootstrap

**Status:** draft — generalized from a project lesson; review before relying on it.

A data service must not both auto-load in its constructor and expose a reload method without a guard, or session bootstrap fetches twice.

---

## A dirty-check built from the form group silently ignores every signal the save path writes

**Status:** draft — generalized from a project lesson; review before relying on it.

A dirty check derived only from the form group misses state written elsewhere (signals/stores); compute dirtiness from the same source the save path reads.
