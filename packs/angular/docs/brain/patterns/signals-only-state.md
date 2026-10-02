<!-- ADR-0004 gate, reviewed 2026-07-20: keep-as-is (Human override — retain founding why) -->
# Pattern: Signals-only state

## Problem

Mixing `BehaviorSubject`-based reactive state with Angular signals produces two parallel change-detection/reactivity models in the same codebase — harder to reason about, easy to get subscription-leak bugs from.

## Solution

All component and service state uses Angular signals exclusively: `signal()` / `computed()`, trailing underscore for private state (`data_ = signal(...)`), public read access via `.asReadonly()`. No `BehaviorSubject` anywhere in the app.

## When to use

Every new component or service. This is a hard rule in `AGENTS.md` and detailed in `docs/agent/standards-angular.md` / `docs/agent/conventions.md` — this pattern file records the "why" (single reactivity model, no subscription leaks), not the syntax checklist.
