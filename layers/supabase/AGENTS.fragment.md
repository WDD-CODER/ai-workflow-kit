## Hard rules

- Supabase: row-level security is the access control (client filters are only for speed); a `verify_jwt = false` edge function authenticates inside; the service-role client only after the caller is verified. Read `docs/agent/standards-supabase.md` before a schema, policy, RPC or edge-function change.

## Skill triggers

## Standards index

| `docs/agent/standards-supabase.md` | Tables, policies, RPCs, edge functions, webhooks, scheduled jobs |
