# Plan 010 — Slot-Serve Installs Packages That Are Missing (excerpt)

Eval-case excerpt: only the sub-task that changes slot-serve is kept.

## Functional Requirements
3. **Messages:** `slot-serve.mjs` prints `npm install ran in <label> (packages missing|lockfile changed)`.

## Atomic Sub-tasks
- [x] D2: Install the missing packages before starting servers and say why — reason in the slot-serve and take-plan messages, exact manual command on failure — core/scripts/slot-serve.mjs, core/scripts/take-plan.mjs

## Read-Write Scope

```scope
core/scripts/slot-serve.mjs
core/scripts/take-plan.mjs
```
