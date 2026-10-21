# Plan — Version tag parser

## Goals & Success Criteria
- [auto] parseVersion('v1.2') returns { major: 1, minor: 2 }.

## Read-Write Scope

```scope
src/**
test/**
```

## Atomic Sub-tasks
- [x] A1: parseVersion('v1.2') returns { major: 1, minor: 2 }; anything else returns null — src/version.mjs
