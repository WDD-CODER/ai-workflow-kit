# Pattern: Split a computed()'s expensive catalog scan from its cheap per-toggle decoration

## Problem

A `computed()` that both (a) scans a large collection signal to derive structure and (b) reads a small, frequently-changing signal to decorate that structure (e.g. attaching `checked_` state from active filters) re-runs its **entire body** — including the expensive scan — every time either dependency changes. `recipe-book-list.component.ts` and `inventory-product-list.component.ts`'s `filterCategories_` read both the full recipe/product list and `activeFilters_()` in one computed to build per-option filter counts; toggling a single filter checkbox re-scanned the entire catalog (up to 2113 recipes / 1478 products in the real production account) just to flip one boolean. This is the same class of catalog-rescan cost documented in `reports/performance-audit-2026-08-13.md`.

## Solution

Split into two `computed()`s:
1. A catalog-only pass that depends only on the large collection signal and produces the expensive-to-derive structure (e.g. per-option counts as a `Map`). It only recomputes when the catalog itself changes.
2. A cheap decoration pass that depends on the first computed's (memoized) output plus the small, frequently-toggled signal, and layers UI state on top (e.g. `checked_`). Its cost is bounded by the number of distinct options, not the catalog size.

See `src/app/core/utils/filter-category-counts.util.ts` (`buildFilterOptionCounts` + `attachFilterCheckedState`) for the extracted, reusable shape — both list components call the same two functions instead of each inlining their own tally logic.

## When to use

Any Angular `computed()` that mixes "derive structure from a large/expensive signal" with "annotate with state from a small/frequently-changing signal" — filter sidebars, faceted search counts, any list-shell filter panel. Don't bother splitting if the collection is small (bounded, low hundreds) or the per-toggle signal changes as rarely as the collection itself — the split adds a layer of indirection that isn't worth it below that scale.
