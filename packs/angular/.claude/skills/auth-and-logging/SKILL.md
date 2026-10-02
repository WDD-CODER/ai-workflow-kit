---
name: auth-and-logging
description: Audits and hardens authentication guards, mutation entry points, and logging calls in compliance with project Security & QA standards.
---

# Skill: auth-and-logging
**Model Guidance:** Use Haiku/Flash for Phases 1 and 3. Use Sonnet for Phase 2 only.
**Trigger:** Touching auth guards, interceptors, user services, HTTP CRUD, or any flow requiring protected access.

**Security Rules (inline — no guide read required):**
- Every new protected route → `canActivate: [authGuard]` — no exceptions
- Every mutation handler (add, edit, delete buttons/modals/FABs) → `isLoggedIn()` check at entry point
- Credentials → `sessionStorage` only — never `localStorage`
- Sensitive data handling → use `auth-crypto.ts` and invoke `auth-crypto` skill
- No PII in logs — only `user._id` permitted in audit trails
- User-facing security warnings → `UserMsgService` only (e.g. `'sign_in_to_use'`)
- pre-commit security grep + CI sign-off required before commit if this task touches the security surface

---

## Phase 0 — docs/brain Orient (CONDITIONAL)

If the task involves an unfamiliar area, an architectural choice, or known-recurring auth/security debt: read `docs/brain/index.md`, then only the relevant sub-file (`gotchas.md`, `decisions/`, `patterns/`, etc.). Default: skip for routine guard/logging work. Do not call optional MCP memory tools.

---

## Phase 1: Surface Audit 

**Entry Point Scan:** Identify all new routes in `{{paths.hotspots}}` and new mutation handlers (buttons, FABs, modals) that require protection.

**Storage Check:** Verify all code touching `localStorage` or `sessionStorage` — credentials must use `sessionStorage` only.

**Logging Scan:** List all new `LoggingService` calls and flag any that may include PII.

---

## Phase 2: Security Implementation 

**Guard Application:** Apply `canActivate: [authGuard]` to every new protected route in `{{paths.hotspots}}`.

**Mutation Hardening:** Implement `isLoggedIn()` check at the entry point of all non-route mutation handlers — add, edit, delete buttons and modals.

**Crypto / Logic:** If handling sensitive data → delegate to `auth-crypto.ts` and invoke the `auth-crypto` skill.

---

## Phase 3: Logging & Privacy Audit 

**PII Scrub:** Scan all new `LoggingService` calls — ensure NO PII (emails, names, passwords, tokens) is logged.

**Identity Check:** Only `user._id` is permitted in audit trails — flag anything else.

**Feedback Logic:** Verify all user-facing security warnings route through `UserMsgService`.

---

## Completion Gate

**pre-commit security grep + CI Trigger:** If this task touches the security surface (auth files, `localStorage`/`sessionStorage`, `[innerHTML]`, new routes) → invoke pre-commit security grep + CI agent for final audit before committing. No exceptions.

Output: `"Auth/Logging hardened. [X] mutation handlers protected, PII audit passed."`

