# Plan 019 — Agent Eval Harness: Measure an Agent Before Trusting It (excerpt)

Eval-case excerpt: only the comparison sub-task is kept.

## Atomic Sub-tasks
- [x] A2: Compare an agent's findings with the expected ones by file, rule and severity, never by exact text — line tolerance, reworded findings still match — tools/lib/agent-eval/compare.mjs

## Read-Write Scope

```scope
tools/lib/agent-eval/**
```
