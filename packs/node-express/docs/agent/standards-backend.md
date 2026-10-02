---
paths:
  - "{{paths.serverRoot}}**"
---

# Backend Persistence Standards (Node / Express / MongoDB pack)

## 0 — Tech Stack

Fill the versions your project actually runs; check them before debugging runtime or network issues.

| Layer | Technology | Version | Notes |
|---|---|---|---|
| **Runtime** | Node.js | | Note platform quirks here (e.g. DNS SRV resolution on Windows needs explicit DNS servers) |
| **Framework** | Express | | |
| **ODM / driver** | Mongoose or native driver | | |
| **Database** | MongoDB (managed or local) | | SRV connection string `mongodb+srv://` for managed clusters |
| **Auth** | jsonwebtoken | | |
| **Security** | helmet | | |
| **Rate limiting** | express-rate-limit | | |
| **Config** | dotenv | | |

> Load this file when: adding a new entity type, adding fields to an existing entity, changing CRUD logic in a data service, creating a new data service, or building UI that reads/writes persisted data.

> **Security**: API security rules (token expiry, rate limiting, lockout, body caps) live in `standards-security.md`, Backend Security Rules. Do not duplicate them here.

---

## 1 — Collection Registry

Keep one registry of persisted entity types in code and mirror it as a table here. The code-level list is the source of truth; this table must stay in sync with it.

| `entityType` key | Domain | Purpose |
|---|---|---|
| | | |

---

## 2 — When This Applies

Load this standard when a plan or feature involves any of: a new entity type, new fields on an existing entity, changed CRUD logic in a data service, a new data service, or UI that reads or writes persisted data.

---

## 3 — New Collection Checklist

1. Add the model type under the project's models folder.
2. Create a data service on the project's base entity service.
3. Choose an `entityType` key: `SCREAMING_SNAKE_CASE`, domain-prefixed.
4. Add the key to the project's registry constant and to the server allowlist (see §5).
5. Wire the reload-from-storage method into the post-login/logout data-reload flow.
6. If the entity needs an endpoint beyond generic CRUD, add it under the server's routes folder and document it in §5.

---

## 4 — Existing Feature Persistence Check

When modifying an existing feature:

- Identify which `entityType` the feature reads/writes (use the registry above).
- Confirm the data service already handles the CRUD path.
- **Adding fields**: with schema-less storage no backend migration is needed; update the model type only.
- **Changing persisted data shape**: consider backward compatibility for existing documents in every store the app writes to.

---

## 5 — Backend API Contract

State for every route whether it requires auth, allows optional auth, or is public. Write routes (`POST`/`PUT`/`DELETE`) require `Authorization: Bearer <token>`.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/data/:type` | per project | List all |
| `GET` | `/api/v1/data/:type/:id` | per project | Get one |
| `POST` | `/api/v1/data/:type` | required | Create |
| `PUT` | `/api/v1/data/:type/:id` | required | Replace one |
| `PUT` | `/api/v1/data/:type` | required | Replace all (requires an explicit confirmation header) |
| `DELETE` | `/api/v1/data/:type/:id` | required | Remove one |

> Allowlist guard: only types in the server's entity-type allowlist are reachable through the generic router; everything else returns `403`. A new entity type means adding it to the allowlist first.

---

## 6 — Plan Annotation Rule

Every implementation plan that touches persisted data **MUST** include a `## Backend Impact` section:

```markdown
## Backend Impact
- Collections affected: [list entityType keys]
- New collections: [yes/no — if yes, list with justification]
- Server changes needed: [yes/no — if yes, describe]
```

If there is no impact, write `## Backend Impact — None` explicitly so the decision is visible rather than assumed.

---

## 7 — Backup & Restore

Before any destructive data operation (re-import, bulk repair, schema migration), take a full snapshot with the project's backup script (`{{commands.dbBackup}}`) and prove it is usable by restoring it into a named scratch database. A snapshot that has never been restored is not a rollback path.

- Write snapshots OUTSIDE the repo (`../{{project.name}}-db-backups/<target>-<timestamp>/`); a snapshot contains real data and must never be committed.
- The restore script refuses to run over the source database, refuses a non-empty target, and exits non-zero on any per-collection count mismatch.
- Drop the scratch database manually when done; the app's DB user may lack drop privileges outside its primary database, so use an admin-scoped connection if needed.
- Filter out Mongo's internal `system.*` namespaces when snapshotting.
