---
sidebar_position: 1
---

# Persistence

flow-state.dev stores three categories of data: **scope state** (session, user, org), **resources** (content files with metadata), and **items** (the accumulated conversation log). All of this goes through a store abstraction. The server ships with an in-memory store by default. Swap it for a file store or MongoDB when you need data to survive restarts.

## Store adapters

| Adapter | Persistence | When to use |
|---------|------------|-------------|
| **In-memory** (default) | None — data is lost on restart | Development, testing, demos |
| **File** | JSON files on disk | Local development with persistence, single-server deployments |
| **SQLite** | Embedded SQLite database | Single-server deployments wanting concurrency-safe writes |
| **Postgres** | PostgreSQL with `LISTEN/NOTIFY` for cross-process live tail | Production, multi-instance fleets, serverless with shared Postgres |
| **MongoDB** | MongoDB collection | Production, multi-server deployments |

### In-memory (default)

The default. No configuration needed. All state, resources, and items live in memory. Fast, zero dependencies, gone when the process exits.

```ts
import { createFlowApiRouter, createFlowRegistry } from "@flow-state-dev/server";

const registry = createFlowRegistry();
registry.register(myFlow);

const router = createFlowApiRouter({ registry });
// Uses in-memory stores by default
```

### File store

Writes state, resources, and items to JSON files in a directory. Each scope gets its own file. Good for local development when you want data to survive server restarts.

```ts
import {
  createFlowApiRouter,
  createFlowRegistry,
  createFileStore,
} from "@flow-state-dev/server";

const store = createFileStore({ directory: "./.flow-state-data" });

const registry = createFlowRegistry();
registry.register(myFlow);

const router = createFlowApiRouter({ registry, store });
```

The directory structure mirrors the scope hierarchy: each scope (session, user, org) gets its own subdirectory. The org scope is stored under `projects/` — the directory name predates the scope rename and is preserved for compatibility.

### MongoDB

For production. Stores state, resources, and items in MongoDB collections with atomic operations.

```ts
import {
  createFlowApiRouter,
  createFlowRegistry,
  createMongoStore,
} from "@flow-state-dev/server";

const store = createMongoStore({
  uri: process.env.MONGODB_URI!,
  database: "flow-state",
});

const registry = createFlowRegistry();
registry.register(myFlow);

const router = createFlowApiRouter({ registry, store });
```

MongoDB provides the concurrency safety that CAS (Compare-and-Swap) operations rely on. In-memory and file stores serialize writes, which works for single-process development but doesn't scale.

## What gets persisted

| Data | Where it lives | Persistence behavior |
|------|---------------|---------------------|
| **Scope state** | Session, user, org scopes | Always persisted (except request scope, which is ephemeral) |
| **Resources** | Attached to scopes | Always persisted with their scope |
| **Items** | Session item log | Persisted by default. `status` items are always transient. `state_change`/`resource_change` are transient in production. |
| **Request state** | Request scope | Lives for one action execution, then discarded |
| **Sequencer state** | Sequencer execution | In-memory only, never persisted |

## Custom stores

The store interface is pluggable. If you need Redis, an alternative SQL backend, or another store, implement the `StoreRegistry` shape and pass it in. The contracts are documented per-method in `@flow-state-dev/server`.

### Live tail

`RequestStore` exposes `subscribeToEvents(requestId, options)` so the SSE wire can serve a request started on any instance. Stores choose their own delivery mechanism:

- The in-memory store fans out from an in-process bus.
- SQLite and the filesystem store poll `getEvents(requestId, fromSequence)`.
- Postgres uses `LISTEN/NOTIFY` on a dedicated client. See `@flow-state-dev/store-postgres` for details.

`getEvents` accepts an optional `fromSequence` for cursor reads — omitting it returns the full log (used by completed-request replay). A custom store that doesn't need cross-process tail can implement `subscribeToEvents` as an iterator that yields the catch-up via `getEvents` and then ends; clients fall back to bulk replay for completed requests.

The exact interface may evolve. Check the `@flow-state-dev/server` package source for the current contract.

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

- **Developing locally?** Start with in-memory (default). Switch to file store when you want persistence across restarts.
- **Deploying a single server?** File store works. It's simple and reliable for low-concurrency scenarios.
- **Production with multiple servers?** Use MongoDB. You need a shared data store with proper concurrency semantics.
- **Special requirements?** Implement a custom store against the interface.
