---
name: auth-and-logging
description: Security checklist for {{project.name}}'s auth and logging surface in a React + Vite app — one shared session source, server-side access checks as the real guard (UI permission checks only hide controls), secrets never in the client bundle or the repo, the query cache cleared on an identity change, and no PII or tokens in logs. Use when touching login/signup, sessions, roles or permissions, server functions or access rules, API keys or connection credentials, `console`/log calls, or anything that stores user data — and whenever the user mentions auth, login, permissions, roles, security, tokens, logging or PII.
paths:
  - "src/**/auth*"
  - "src/**/*Auth*"
  - "src/**/*Permission*"
---

# auth-and-logging

The kit's `/fix` loads this with `docs/agent/standards-security.md` for `auth` work, and `/security` uses it as the
auth audit checklist. Details: `docs/agent/standards-react.md` (Auth and identity, Data access).
<!-- KIT:if stack.backendDoc -->
Server side (access rules, server functions): `{{stack.backendDoc}}`.
<!-- KIT:end -->

## Client (`src/`)

- One session source: a single store or context subscribed to the auth client once, read through one hook. No new
  auth listeners or per-component session requests.
- Clear the query cache when the user id changes or on sign-out — never on a token refresh, never skipped on
  sign-out (a cross-user cache leak).
- Roles and permission hooks decide what the UI shows. They are **not** security: every read and write must also
  be allowed by the server (access rules, a server function's own check). A UI-only check on sensitive data is a
  finding.
- Only public client values may reach the browser: Vite inlines every `VITE_*` variable into the bundle. A secret
  (service key, provider API key) never gets a `VITE_` name and never sits in client code.
- No tokens, passwords or keys in `localStorage`/`sessionStorage` beyond what the auth client manages itself.
- Never print `.env` values (or keys found in code) in chat, docs, logs, plans or commits; name the variable only.

## Server calls

- A server function the browser calls checks the caller itself (verifies the bearer token, a webhook signature, or a
  machine secret for scheduled calls). An endpoint that skips the gateway's token check is public until it does.
- Elevated-privilege clients (service keys) only after the caller is verified, and scoped to the caller's tenant.
- Third-party credentials come from server environment variables, never from the request or the repo.

## Logging

- No PII (phone numbers, emails, names, message bodies) or tokens in logs. Use the project's masking logger and
  sanitized error responses when it has them; return a generic error body to the browser, not raw error text.
- Client: no `console.log` of user records or responses (`node scripts/techdebt-report.mjs scan` counts
  `console.log`).
