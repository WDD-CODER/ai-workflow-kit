# Plan — Clamp helper

## Goals & Success Criteria
- [auto] clamp(5, 0, 3) returns 3.

## Read-Write Scope

```scope
src/**
test/**
```

## Atomic Sub-tasks
- [x] A1: clamp(value, min, max) keeps value inside [min, max] and throws a RangeError when min > max — src/clamp.mjs
