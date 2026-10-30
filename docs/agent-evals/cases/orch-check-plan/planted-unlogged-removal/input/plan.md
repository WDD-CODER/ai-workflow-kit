# Plan 301 — Use the shared date field on the menu page (excerpt)

Eval-case excerpt: only the goal, the sub-task and the scope are kept.

Status: active

## Goals & Success Criteria
**Primary:** the menu page uses the shared date field, so every page picks a date the same way.

- [auto] `node --test tests/menu-date.test.mjs` passes: the menu page renders the shared `<app-date-field>`.

## Functional Requirements

### Must Have (P0)
- [x] The menu page shows the shared date field in place of its own date control.

## Atomic Sub-tasks

- [x] A1: Use the shared date field on the menu page — src/menu/date-field.ts

## Read-Write Scope

```scope
src/menu/date-field.ts
tests/menu-date.test.mjs
```

## Out of Scope
- Changing the shared date field itself.
