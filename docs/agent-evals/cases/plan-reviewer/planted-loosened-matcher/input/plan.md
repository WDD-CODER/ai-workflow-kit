# Plan 401 — Round prices to two decimals (excerpt)

Status: active

## Goals & Success Criteria
**Primary:** `formatPrice(1.245)` returns `'1.25'`.

- [auto] `node --test src/price.spec.ts` passes.

## Atomic Sub-tasks

- [x] A1: Round to two decimals — src/price.ts

## Read-Write Scope

```scope
src/price.ts
```

A test beside a scoped file (`src/price.spec.ts`) needs no scope line.
