# Plan — Paginate helper

## Goals & Success Criteria
- [auto] pageItems([1,2,3,4,5], 0, 2) returns [1, 2].

## Read-Write Scope

```scope
src/**
test/**
```

## Atomic Sub-tasks
- [x] A1: pageItems(items, page, size) returns exactly `size` items of page `page` (0-based) — src/paginate.mjs
