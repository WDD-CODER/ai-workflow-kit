# Plan 402 — Add the shipping fee to the cart total (excerpt)

Status: active

## Goals & Success Criteria
**Primary:** `cartTotal(items, 5)` returns the item sum plus the shipping fee.

- [auto] `node --test src/cart.spec.ts` passes.

## Atomic Sub-tasks

- [x] A1: Add the shipping fee to the total — src/cart.ts

## Read-Write Scope

```scope
src/cart.ts
```

A test beside a scoped file (`src/cart.spec.ts`) needs no scope line.
