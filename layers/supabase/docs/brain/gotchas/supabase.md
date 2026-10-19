# supabase gotchas

Traps from working on a Supabase backend (Postgres + row-level security + edge functions).

## The live database can be ahead of `supabase/migrations`

**What hurt:** The migrations folder stopped weeks before the generated types file did. Tables, columns and access
helpers that the app used every day had no migration at all: they were created from the dashboard or by an app
builder that applies changes to the live database directly.

**Why the obvious fix is wrong:** Reading the migrations to learn the schema or a policy gives an old answer.
Writing a new migration from them can recreate a function or policy the live database has already replaced.

**What to do instead:** Read columns, tables and RPC signatures from the generated types file (never edit it). For
policies and function bodies, which the types do not hold, read the live definition (dashboard,
`pg_get_functiondef`) before relying on it, and say "unverified in repo" otherwise. Compare the dates first:
`git log -1 --format=%cs -- supabase/migrations` against the types file.

---

## `verify_jwt = false` functions are public endpoints

**What hurt:** Most functions in `supabase/config.toml` had `verify_jwt = false` — webhooks and scheduled jobs, but
also user actions. Review assumed the gateway checked the JWT for all of them.

**Why the obvious fix is wrong:** Flipping them to `verify_jwt = true` breaks webhook providers and schedulers that
do not send a user JWT.

**What to do instead:** Every `verify_jwt = false` function authenticates inside: verify the bearer
(`auth.getUser(token)`), verify the provider signature, or compare a machine secret header. Flag any new
`verify_jwt = false` entry that does none of these.

---

## The service-role client bypasses row-level security

**What hurt:** A function created the service-role client at the top and then queried with ids taken from the
request body. Any signed-in user could read another tenant's rows by changing an id.

**Why the obvious fix is wrong:** Switching that function to the anon client breaks the legitimate cross-table work it
does.

**What to do instead:** Verify the caller first, check that the caller may access the tenant or row named in the
request, and only then use the service-role client, scoped to that tenant.
