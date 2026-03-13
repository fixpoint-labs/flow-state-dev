---
sidebar_position: 1
---

# Persistence

flow-state.dev stores three categories of data: **scope state** (session, user, project), **resources** (content files with metadata), and **items** (the accumulated conversation log). All of this goes through a store abstraction. The server ships with an in-memory store by default. Swap it for a file store or MongoDB when you need data to survive restarts.

## Store adapters

| Adapter | Persistence | When to use |
|---------|------------|-------------|
| **In-memory** (default) | None — data is lost on restart | Development, testing, demos |
| **File** | JSON files on disk | Local development with persistence, single-server deployments |
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

The directory structure mirrors the scope hierarchy: sessions, users, and projects each get their own subdirectory.

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
| **Scope state** | Session, user, project scopes | Always persisted (except request scope, which is ephemeral) |
| **Resources** | Attached to scopes | Always persisted with their scope |
| **Items** | Session item log | Persisted by default. `status` items are always transient. `state_change`/`resource_change` are transient in production. |
| **Request state** | Request scope | Lives for one action execution, then discarded |
| **Sequencer state** | Sequencer execution | In-memory only, never persisted |

## Custom stores

The store interface is pluggable. If you need Redis, PostgreSQL, or another backend, implement the `Store` interface:

```ts
interface Store {
  getScope(identity: ScopeIdentity): Promise<ScopeData | undefined>;
  setScope(identity: ScopeIdentity, data: ScopeData): Promise<void>;
  deleteScope(identity: ScopeIdentity): Promise<void>;
  listSessions(params: ListParams): Promise<SessionListResult>;
}
```

The exact interface may evolve. Check the `@flow-state-dev/server` package source for the current contract.

## Choosing a store

- **Developing locally?** Start with in-memory (default). Switch to file store when you want persistence across restarts.
- **Deploying a single server?** File store works. It's simple and reliable for low-concurrency scenarios.
- **Production with multiple servers?** Use MongoDB. You need a shared data store with proper concurrency semantics.
- **Special requirements?** Implement a custom store against the interface.
