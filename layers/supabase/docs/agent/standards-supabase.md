---
paths:
  - "supabase/**"
---

# Backend Standards (Supabase: Postgres + row-level security + edge functions)

> Load this file when: a plan or fix touches data (tables, columns, policies, RPCs) or an API (edge function,
> webhook, scheduled job). Client-side data rules (query library, typed client) are in the stack pack's standards
> doc; security review rules in `docs/agent/standards-security.md`.
>
> Before applying a rule, look at how this project already does it (its `supabase/` folder, its shared function
> helpers, its generated types) and follow that; the names below are the common shapes.

---

## 0 — Tech stack

| Layer | Technology | Notes |
|---|---|---|
| Database | Supabase Postgres | row-level security (RLS) on every tenant table |
| API | PostgREST via `@supabase/supabase-js` | typed with the generated database types |
| Server code | Deno edge functions, `supabase/functions/<name>/index.ts` | shared helpers in `supabase/functions/_shared/` |
| Jobs | scheduled calls (pg_cron or an external scheduler) → an edge function | the caller proves itself with a machine secret |
| Auth | Supabase Auth JWT | the gateway check per function is set in `supabase/config.toml` |

---

## 1 — Schema source of truth

- **Do** read columns, tables and RPC signatures from the generated types file (the one the typed client imports;
  generated from the live database, never hand-edited). Regenerate it after a schema change.
- `supabase/migrations` is the source of truth only when every schema change goes through it. When the live
  database was changed by other means (a dashboard, an AI app builder, another repo), compare dates first:
  `git log -1 --format=%cs -- supabase/migrations` against the types file. Newer types = the migrations are behind.
- Policies and function bodies are not in the types file. Before relying on one, read its live definition
  (dashboard, `pg_get_functiondef`), otherwise mark the claim "unverified in repo".

## 2 — Row-level security first

- Tenant isolation is RLS, not client filters. A client may also filter by tenant id for speed, but that filter is
  never the only thing that hides another tenant's rows.
- Policies on large tables use set-wise helpers (one function returning the caller's visible ids, evaluated once per
  statement), not a per-row function call. When an access helper has set-wise copies, a change to one is mirrored
  in each.

## 3 — RPCs: SECURITY DEFINER vs invoker

- **Invoker** (the default) when RLS should decide the rows: feeds, lists, read-only enrichment.
- **SECURITY DEFINER** only when the function enforces a rule RLS can't, and then it guards itself: `SET search_path`,
  `auth.uid()` is null → raise, the caller's access to the row is checked → raise, the role or state rule is
  checked → raise.
- Expose an RPC with `GRANT EXECUTE … TO authenticated` only when the browser calls it.
- A write with a business rule has exactly one RPC; the table is not updated directly for that column.
- When a result could exceed the API row cap, return one JSON value (or page explicitly) instead of a set of rows.

## 4 — Edge function contract

- **Auth per function.** A function with `verify_jwt = false` in `supabase/config.toml` is a public endpoint. It
  authenticates inside, one of:
  - a user call: verify the bearer (`supabase.auth.getUser(token)`, or the project's shared helper);
  - a scheduler or function-to-function call: a machine secret header compared with a function secret;
  - a provider webhook: the provider's signature or shared token.
  Flipping such a function to `verify_jwt = true` breaks callers that do not send a user JWT; add the check instead.
- **CORS.** Answer `OPTIONS` and send CORS headers on every response; prefer one shared CORS helper.
- **Service role after authorization.** The service-role client bypasses RLS: check the caller's tenant membership or
  row access before using it, and scope every query to the caller's tenant.
- **Errors and logs.** Return a sanitized error body to the browser, never raw error text, provider secrets, keys or
  signed URLs. Log through a masking logger (no phone numbers, emails, tokens).
- **Shared code.** Reuse `supabase/functions/_shared/` helpers instead of copying them into a function.

## 5 — When this applies

Load this standard when a plan or fix involves: a new table or column, a policy, an RPC, an edge function, a
webhook, a scheduled job, or UI that writes rule-bearing data.

## 6 — Plan annotation rule

Every plan that touches persisted data or an edge function **must** include:

```markdown
## Backend Impact
- Tables / RPCs / functions affected: [names]
- Schema or policy change: [yes/no — if yes: migration file, or a brief for whoever owns the database]
- Invariants touched: [INV-n from docs/brain/invariants.md, or none]
```

If there is no impact, write `## Backend Impact — None` explicitly.

## 7 — Destructive data operations

A bulk repair, re-import or delete runs only with a fresh backup and counts checked before and after. When the repo
has no database credentials, write the SQL or steps as a brief for the database owner, including how to snapshot
and verify.
