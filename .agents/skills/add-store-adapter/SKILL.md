---
name: fsd:add-store-adapter
description: Create a new persistence store adapter package implementing all StoreRegistry interfaces. Produces a complete package with factory, individual stores, schema initialization, and tests.
argument-hint: "<database name, e.g. 'mongodb' or 'dynamodb'>"
---

You are a development agent creating a new persistence store adapter for the flow-state-dev framework. Store adapters implement the `StoreRegistry` interface from `@flow-state-dev/engine` and ship as independent packages to isolate database-specific dependencies.

## Core Principle

**Follow the existing adapters as templates.** The `store-sqlite` and `store-postgres` packages are reference implementations. Match their structure, naming conventions, and test patterns.

## Workflow

### Step 1: Read the Reference Implementations

Before writing any code, read these files:

**SQLite adapter** (synchronous, embedded):
1. `packages/store-sqlite/src/index.ts` — factory function and exports
2. `packages/store-sqlite/src/schema.ts` — DDL initialization
3. `packages/store-sqlite/src/session-store.ts` — SessionStore implementation
4. `packages/store-sqlite/src/request-store.ts` — RequestStore + item/event persistence
5. `packages/store-sqlite/src/content-store.ts` — ContentStore implementation
6. `packages/store-sqlite/src/sqlite-store.ts` — generic record store base
7. `packages/store-sqlite/package.json` — package configuration
8. `packages/store-sqlite/tsconfig.json` — TypeScript config

**PostgreSQL adapter** (async, pooled, serverless-safe):
1. `packages/store-postgres/src/index.ts` — async factory with QueryExecutor abstraction
2. `packages/store-postgres/src/schema.ts` — DDL with `pg_advisory_lock` for serverless schema init
3. `packages/store-postgres/src/types.ts` — `QueryExecutor` interface (works with both `pg.Pool` and PGlite)
4. `packages/store-postgres/src/content-store.ts` — ContentStore backed by PostgreSQL
5. `packages/store-postgres/test/stores.test.ts` — uses `@electric-sql/pglite` for zero-infrastructure testing

Key patterns in the Postgres adapter worth noting:
- **Advisory locks for schema init**: `pg_advisory_lock` / `pg_try_advisory_lock` prevent race conditions when multiple serverless instances initialize concurrently. Lock and unlock must run on the same connection, so `initializeSchemaWithDedicatedClient` checks out a single client from the pool.
- **Serverless pool timeouts**: `connectionTimeoutMillis` (default 10s) and `idleTimeoutMillis` (default 30s) prevent frozen serverless function instances from holding stale connections.
- **QueryExecutor abstraction**: A minimal `{ query(text, values?) }` interface that both `pg.Pool` and `@electric-sql/pglite` satisfy. This lets tests run against an embedded PGlite instance with zero external infrastructure.

Also read the store interfaces:
- `packages/engine/src/stores/types.ts` — `StoreRegistry`, `SessionStore`, `RequestStore`, `UserStore`, `ProjectStore`, `ActiveRequestRegistry`, `ContentStore`

### Step 2: Create the Package

Create `packages/store-<name>/` with this structure:

```
packages/store-<name>/
  src/
    index.ts                    # Factory + re-exports
    types.ts                    # Adapter-specific types (connection options, etc.)
    schema.ts                   # DDL/schema initialization
    <name>-store.ts             # Generic record store abstraction (optional)
    session-store.ts            # SessionStore implementation
    request-store.ts            # RequestStore + item/event persistence
    user-store.ts               # UserStore implementation
    project-store.ts            # ProjectStore implementation
    active-request-registry.ts  # ActiveRequestRegistry implementation
    content-store.ts            # ContentStore implementation
  test/
    stores.test.ts              # Comprehensive test suite
  package.json
  tsconfig.json
  README.md
```

### Step 3: Write package.json

```json
{
  "name": "@flow-state-dev/store-<name>",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "license": "MIT",
  "files": ["dist"],
  "publishConfig": {
    "access": "public"
  },
  "dependencies": {
    "@flow-state-dev/engine": "workspace:*",
    "<db-driver>": "^<version>"
  },
  "devDependencies": {
    "@types/node": "^22.0.0"
  },
  "scripts": {
    "build": "pnpm --filter @flow-state-dev/core build && pnpm --filter @flow-state-dev/engine build && tsc -p tsconfig.json",
    "typecheck": "pnpm --filter @flow-state-dev/core build && pnpm --filter @flow-state-dev/engine build && node ../../scripts/typecheck.mjs",
    "test": "pnpm --filter @flow-state-dev/core build && pnpm --filter @flow-state-dev/engine build && vitest run --root .",
    "test:watch": "pnpm --filter @flow-state-dev/core build && pnpm --filter @flow-state-dev/engine build && vitest --root ."
  }
}
```

### Step 4: Write the Factory

The main export is a factory function that returns a typed `StoreRegistry`:

```typescript
import type { StoreRegistry } from "@flow-state-dev/engine";

export type <Name>StoreOptions = {
  /** Connection string or config */
  // ...adapter-specific options
};

export type <Name>StoreRegistry = StoreRegistry & {
  /** Close the underlying connection */
  close(): void | Promise<void>;
};

/**
 * Create a StoreRegistry backed by <Name>.
 * Schema auto-initializes on first call.
 */
export function create<Name>Stores(
  options: <Name>StoreOptions
): <Name>StoreRegistry {  // or Promise<<Name>StoreRegistry> for async init
  // 1. Create/connect to database
  // 2. Initialize schema (tables, indexes)
  // 3. Return registry with all 6 stores

  return {
    session: create<Name>SessionStore(/* ... */),
    request: create<Name>RequestStore(/* ... */),
    user: create<Name>UserStore(/* ... */),
    project: create<Name>ProjectStore(/* ... */),
    activeRequests: create<Name>ActiveRequestRegistry(/* ... */),
    content: create<Name>ContentStore(/* ... */),
    close() { /* cleanup */ }
  };
}

// Export individual store constructors for advanced use
export { create<Name>SessionStore } from "./session-store";
export { create<Name>RequestStore } from "./request-store";
export { create<Name>UserStore } from "./user-store";
export { create<Name>ProjectStore } from "./project-store";
export { create<Name>ActiveRequestRegistry } from "./active-request-registry";
export { create<Name>ContentStore } from "./content-store";
export { initializeSchema } from "./schema";
```

### Step 5: Implement the 6 Store Interfaces

Each store must implement its interface from `@flow-state-dev/engine`:

#### SessionStore
- `get(id)` — fetch by session ID
- `set(id, record)` — insert or update session
- `delete(id)` — remove session
- `list(filters?)` — list with optional `flowKind`, `userId` filters + pagination (`limit`, `offset`)

#### RequestStore
- `get(id)` — fetch by request ID
- `set(id, record)` — insert or update request
- `delete(id)` — remove request
- `list(filters?)` — filters include `sessionId`, `userId`, `flowKind`, `status`
- `persistItems(requestId, items)` — batch item persistence (use microtask batching, non-blocking)
- `flushItems(requestId)` — wait for all pending item writes to complete (called before terminal status)
- `countItems(requestId)` — count persisted items without materializing them (retention's `maxItems` check; use an indexed COUNT when items live in a dedicated table)
- `persistEvents(requestId, events)` — batch event persistence with sequence ordering (non-blocking)
- `flushEvents(requestId)` — wait for all pending event writes to complete (called before terminal status)
- `getEvents(requestId)` — retrieve persisted stream events sorted by sequence number (for completed-request replay)

#### UserStore
- Same CRUD pattern (`get`, `set`, `delete`, `list`)
- `list(filters?)` — no indexed filters beyond basic listing

#### ProjectStore
- Same CRUD pattern (`get`, `set`, `delete`, `list`)
- `list(filters?)` — `userId` filter

#### ActiveRequestRegistry
- `register(entry)` — register an in-flight request (accepts an `ActiveRequestEntry` object)
- `heartbeat(requestId)` — update heartbeat timestamp
- `deregister(requestId)` — remove request from registry on terminal status
- `listStale(thresholdMs)` — find entries whose `lastHeartbeatAt` is older than `Date.now() - thresholdMs`
- `listAll()` — return all currently registered entries
- `get(requestId)` — return a single entry by requestId, or undefined

#### ContentStore
- `get(scopeType, scopeId, resourceKey)` — read a single resource's content (`Promise<string | undefined>`)
- `set(scopeType, scopeId, resourceKey, content)` — write a single resource's content (creates or overwrites)
- `delete(scopeType, scopeId, resourceKey)` — delete a single resource's content
- `getAll(scopeType, scopeId)` — read all content for a scope instance (`Promise<Record<string, string>>`)
- `deleteAll(scopeType, scopeId)` — delete all content for a scope instance

`ContentScopeType = "session" | "user" | "project"` (not request-scoped). Content is addressed by the triple `(scopeType, scopeId, resourceKey)`, allowing adapters to store content independently of scope record metadata.

### Step 6: Schema Design Principles

Follow the SQLite adapter's hybrid approach:
- **JSONB/JSON data column** for the full record (flexible schema)
- **Indexed scalar columns** for filtered query fields (flowKind, userId, sessionId, status)
- **Timestamps** as millisecond epoch (use BIGINT for databases where INTEGER is 32-bit)

### Step 7: Write Tests

Create a comprehensive test suite. If the database has an embeddable/in-memory mode (like SQLite's `:memory:` or PGlite for Postgres), use that for zero-infrastructure testing.

Test categories:
1. Schema initialization (idempotent)
2. CRUD for all 4 record stores (session, request, user, project)
3. List filtering (flowKind, userId, sessionId, status)
4. Pagination (limit, offset, edge cases)
5. Item persistence with microtask batching (`persistItems` + `flushItems`)
6. Event persistence with sequence ordering and overwrite (`persistEvents` + `flushEvents` + `getEvents`)
7. Active request registry (register, heartbeat, stale detection via `listStale`, `listAll`, `get`, deregister)
8. ContentStore CRUD (`get`, `set`, `delete`, `getAll`, `deleteAll` across session/user/project scopes)
9. Complex nested JSON round-trip
10. Drop-in replacement compatibility (same behavior as in-memory stores)

### Step 8: Write README

Follow the established structure: Purpose, Quick Start, API Surface, Scripts.

### Step 9: Register in Workspace

Add the package to `pnpm-workspace.yaml` if not auto-detected:
```yaml
packages:
  - "packages/*"
```

Run `pnpm install` to link the new package.

### Step 10: Verify

```bash
pnpm install
pnpm --filter @flow-state-dev/store-<name> typecheck
pnpm --filter @flow-state-dev/store-<name> test
```

## Guidelines

- **Match the reference adapters exactly.** Same method signatures, same return types, same error semantics. The stores are interchangeable.
- **Async factory is OK.** Unlike SQLite (synchronous), most databases need async initialization. Return `Promise<StoreRegistry>`.
- **Microtask batching for items/events.** Follow the SQLite adapter's pattern of buffering writes and flushing on microtask. This prevents excessive database round-trips during streaming.
- **Don't reinvent the record model.** The record shape (SessionRecord, RequestRecord, etc.) is defined by the server package. Your adapter serializes/deserializes it — nothing more.
- **Test with real queries, not mocks.** Use an embeddable database for tests. Don't mock the database driver — that tests nothing.
- **Schema initialization must be idempotent.** `CREATE TABLE IF NOT EXISTS` or equivalent. Multiple calls to `initializeSchema` must not fail.
