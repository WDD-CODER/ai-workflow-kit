---
name: auth-and-logging
description: Security checklist for {{project.name}}'s auth and logging surface — route guards, `isLoggedIn()` at mutation entry points, sessionStorage-only credentials, no PII in logs, and the `auth-crypto.ts` hashing/token rules. Use when touching routes, guards, interceptors, user/auth services, HTTP CRUD, login/signup, tokens, hashing, `LoggingService` calls or anything that stores user data — and whenever the user mentions auth, login, permissions, security, logging or PII.
paths:
  - "{{paths.srcRoot}}app.routes.ts"
  - "{{paths.srcRoot}}core/guards/**"
  - "{{paths.srcRoot}}core/interceptors/**"
  - "{{paths.srcRoot}}core/services/user*.ts"
  - "{{paths.srcRoot}}core/services/logging*.ts"
  - "{{paths.srcRoot}}core/auth-crypto.ts"
  - "server/routes/auth.js"
  - "server/middleware/**"
---

# auth-and-logging

The full standard is `docs/agent/standards-security.md` (read it for anything not covered here). This skill is the working checklist for the surface you are editing right now, plus the one command that proves you didn't leak anything.

## Checklist — copy into your reply and tick as you go

```
Auth & logging:
- [ ] Every new/changed protected route in app.routes.ts has canActivate: [authGuard]
- [ ] Every non-route mutation entry (add/edit/delete button, modal, FAB) calls userService.isLoggedIn() first
- [ ] Session data only in sessionStorage (key loggedInUser); nothing auth-related in localStorage
- [ ] LoggingService calls carry { event, message, context? } and no password/hash/token/name/email — user._id only
- [ ] User-facing security messages go through UserMsgService (e.g. 'sign_in_to_use'), never alert/console
- [ ] [innerHTML] absent, or sanitized with a documented reason
- [ ] node scripts/pre-commit-security-grep.mjs exits 0
```

Why the entry-point check: a guard protects navigation, not a button the user can reach from an unguarded page. The `isLoggedIn()` call at the handler is what stops a logged-out mutation.

## Crypto (only when `{{paths.srcRoot}}core/auth-crypto.ts` is in scope)

- Hashing PBKDF2 (100k iterations, SHA-256, random 16-byte salt); encryption AES-256. Raw SHA-256 is legacy read-only — never for new users.
- Salts and IVs are generated at runtime per call, never hardcoded, never logged — including in specs.
- Crypto failures return one generic message; distinguishing "bad padding" from "bad key" is what timing/padding attacks read.
- Any new crypto dependency is typed, in `package.json`, and named in the PR.

## Verify

```bash
node scripts/pre-commit-security-grep.mjs
```

Fix every hit and re-run until it exits 0. This grep is also the pre-commit hook, so a hit here is a hit at `/ship`.
