---
sidebar_position: 1
---

# Persistence

flow-state.dev stores three categories of data: **scope state** (session, user, org), **resources** (content files with metadata), and **items** (the accumulated conversation log). All of this goes through a store abstraction. The server ships with an in-memory store by default. Swap it for the filesystem, SQLite, or Postgres adapter when you need data to survive restarts.

## Store adapters

You declare stores on `createFlowState` as a map of named profiles. A profile maps capability slots (typed containers for a category of storage) to adapters. Every adapter below backs the required `primary` slot — the catch-all state store for sessions, requests, users, orgs, checkpoints, content, and traces. The `blobs`, `queue`, and `scheduler` slots exist in the type but are forward-compatible: no backing store ships for them in Phase 1, so declaring them is a no-op.

| Adapter | Persistence | When to use |
|---------|------------|-------------|
| **In-memory** (default) | None — data is lost on restart | Development, testing, demos |
| **File** | Nested file tree (`.md`/`.json`) on disk | Local development with persistence, single-server deployments |
| **SQLite** | Embedded SQLite database | Single-server deployments wanting concurrency-safe writes |
| **Postgres** | PostgreSQL with `LISTEN/NOTIFY` for cross-process live tail | Production, multi-instance fleets, serverless with shared Postgres |

### In-memory (default)

The default. No configuration needed. All state, resources, and items live in memory. Fast, zero dependencies, gone when the process exits.

```ts
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";

const flowstate = createFlowState({
  flows: { myFlow },
  stores: { default: { primary: inMemoryStores() } },
});
```

### Filesystem store

Writes each scope's data into a directory on disk, surviving restarts. Resource content and resource state persist as a real nested file tree — a resource key like `notes/meeting` becomes `notes/meeting.md` (content) or `notes/meeting.json` (state), so the store directory is browsable in an editor and diffable in git. Good for local development.

```ts
import { createFlowState, filesystemStores } from "@flow-state-dev/engine";

const flowstate = createFlowState({
  flows: { myFlow },
  stores: { default: { primary: filesystemStores({ rootDir: "./.flow-state-data" }) } },
});
```

The directory structure mirrors the scope hierarchy: each scope (session, user, org) gets its own subdirectory. The org scope is stored under `projects/` — the directory name predates the scope rename and is preserved for compatibility.

### Postgres

For production and multi-instance fleets. Stores state in PostgreSQL with `LISTEN/NOTIFY` for cross-process live tail.

```ts
import { createFlowState } from "@flow-state-dev/engine";
import { postgresStores } from "@flow-state-dev/store-postgres";

const flowstate = createFlowState({
  flows: { myFlow },
  stores: {
    default: {
      primary: postgresStores({ connectionString: process.env.FSD_DB_URL }),
    },
  },
});
```

On Vercel, use `vercelPostgresStores()` from `@flow-state-dev/vercel/store` instead — it bakes in the pool tuning and Neon client swap. Postgres provides the concurrency safety that CAS (Compare-and-Swap) operations rely on. In-memory and filesystem stores serialize writes, which works for single-process development but doesn't scale across instances.

## What gets persisted

| Data | Where it lives | Persistence behavior |
|------|---------------|---------------------|
| **Scope state** | Session, user, org scopes | Always persisted (except request scope, which is ephemeral) |
| **Resources** | Attached to scopes | Always persisted with their scope |
| **Items** | Session item log | Persisted by default. `status` items are always transient. `state_change`/`resource_change` are transient in production. |
| **Request state** | Request scope | Lives for one action execution, then discarded |
| **Sequencer state** | Sequencer execution | In-memory only, never persisted |

## Tenant isolation

If you send a tenant id (the `x-tenant-id` header by default), session storage is namespaced by tenant automatically. Two tenants using the same session id get separate records. The isolation is per scope:

| Scope | Tenant-isolated? |
|-------|------------------|
| Session (record, state, session-scoped resources) | Yes |
| Request (history, listing) | Yes |
| User | No — shared across tenants by design |
| Org | No — shared across tenants by design |

The session store key becomes `${tenantId}:${sessionId}`; request records keep a bare `sessionId` and a separate `tenantId` that listing filters on. Persistent adapters (SQLite, Postgres) add a nullable `tenant_id` column through an idempotent migration, so upgrading an existing database needs no manual step and existing rows read back as no-tenant. Single-tenant apps that never send the header are unchanged. See [State and scopes](/docs/fundamentals/state-and-scopes#multi-tenant-isolation) for the full model.

## Custom stores

The store interface is pluggable. If you need Redis, an alternative SQL backend, or another store, implement the `StoreRegistry` shape and pass it in. The contracts are documented per-method in `@flow-state-dev/engine`. A custom store isolates by tenant the same way the built-ins do: namespace records by their `id` (already tenant-prefixed for sessions) and honor the `tenantId` field on `SessionListOptions` / `RequestListOptions` (present means exact-match, including `undefined`; absent means no filter).

### Live tail

`RequestStore` exposes `subscribeToEvents(requestId, options)` so the SSE wire can serve a request started on any instance. Stores choose their own delivery mechanism:

- The in-memory store fans out from an in-process bus.
- SQLite runs one shared poll loop per request, fanned out to every subscriber and woken in-process by the write path; the filesystem store polls `getEvents(requestId, fromSequence)`.
- Postgres uses `LISTEN/NOTIFY` on a dedicated client. See `@flow-state-dev/store-postgres` for details.

### Incremental items storage

Backed adapters store items incrementally rather than inside the request record's JSONB column. The SQLite and Postgres adapters write one row per item into a dedicated child table (`request_items`); the filesystem store appends items and events to an append-only log instead. The change avoids a write-amplification pathology on long-running requests (on Postgres, a TOAST rewrite under serverless-throttled autovacuum). The framework surface is unchanged — the same `RequestStore.persistItems` and `get` shape — but two operator-visible consequences are worth knowing. See [Persistence cost model](/docs/server/setup#persistence-cost-model) for how each backend stores its data.

- `RequestStore.list()` no longer populates `record.items` by default on any adapter; pass `withItems: true` to opt in.
- `RequestStore.countItems(requestId)` returns how many items a request holds without loading their payloads — session retention's `maxItems` check uses it so a sweep stays cheap on long histories. A custom store must implement it; the backed adapters answer with an indexed `COUNT` on `request_items`.
- Upgrade is lazy (no offline backfill), but the deploy is **forward-only**. Validate in staging before rolling out.

See the [`@flow-state-dev/store-postgres` README](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/store-postgres/README.md#items-storage) for the schema, the optional storage-reclamation steps (`pg_repack`), and the rollback constraints.

`getEvents` accepts an optional `fromSequence` for cursor reads — omitting it returns the full log (used by completed-request replay). A custom store that doesn't need cross-process tail can implement `subscribeToEvents` as an iterator that yields the catch-up via `getEvents` and then ends; clients fall back to bulk replay for completed requests.

The exact interface may evolve. Check the `@flow-state-dev/engine` package source for the current contract.

## Looking up sessions by metadata

Some apps don't carry a session id around. The natural identity of a session is whatever combination of inputs the user just chose — a ticker and a date, a project id and a branch, a customer id and a quarter. For those apps, set `title` and `metadata` at create time and resolve sessions by filtering the list.

```ts
import { createSessionClient } from "@flow-state-dev/client";

const sessions = createSessionClient({ baseUrl: "" });

type RunKey = { ticker: string; date: string };

async function resolveSession(flowKind: string, userId: string, key: RunKey) {
  const list = await sessions.listSessions({ flowKind, userId });
  const match = list.find(
    (s) =>
      s.metadata?.ticker === key.ticker && s.metadata?.date === key.date,
  );
  if (match) return match.id;

  const created = await sessions.createSession({
    flowKind,
    userId,
    title: `${key.ticker} · ${key.date}`,
    metadata: key,
  });
  return created.id;
}
```

Server-side `metadata` filtering on `GET /api/flows/sessions` is not yet available; the route returns the full list for `(flowKind, userId)` and the client filters in memory. That's fine for local development and small-tenant use. Apps that expect hundreds of sessions per user should treat this as a deliberate ceiling and revisit when a server-side filter lands.

The trading-desk example uses this pattern end-to-end — see the [walkthrough](/guides/trading-desk-walkthrough#session-lifecycle-and-persistence).

## Choosing a store

- **Developing locally?** Start with in-memory (default). Switch to the filesystem store when you want persistence across restarts.
- **Deploying a single server?** Filesystem or SQLite works. Both are simple and reliable for low-concurrency scenarios.
- **Production with multiple servers?** Use Postgres. You need a shared data store with proper concurrency semantics.
- **Special requirements?** Implement a custom store adapter against the `StoreAdapter` interface.
