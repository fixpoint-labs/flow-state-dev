---
name: fsd:add-store-adapter
description: Create a new persistence store adapter package implementing all StoreRegistry interfaces. Produces a complete package with factory, individual stores, schema initialization, and tests.
argument-hint: "<database name, e.g. 'mongodb' or 'dynamodb'>"
---

You are a development agent creating a new persistence store adapter for the flow-state-dev framework. Store adapters implement the `StoreRegistry` interface from `@flow-state-dev/server` and ship as independent packages to isolate database-specific dependencies.

## Core Principle

**Follow the SQLite adapter as a template.** The `store-sqlite` package is the reference implementation. Match its structure, naming conventions, and test patterns exactly.

## Workflow

### Step 1: Read the Reference Implementation

Before writing any code, read these files:

1. `packages/store-sqlite/src/index.ts` — factory function and exports
2. `packages/store-sqlite/src/schema.ts` — DDL initialization
3. `packages/store-sqlite/src/session-store.ts` — SessionStore implementation
4. `packages/store-sqlite/src/request-store.ts` — RequestStore + item/event persistence
5. `packages/store-sqlite/src/sqlite-store.ts` — generic record store base
6. `packages/store-sqlite/package.json` — package configuration
7. `packages/store-sqlite/tsconfig.json` — TypeScript config

Also read the store interfaces:
- `packages/server/src/stores/types.ts` — `StoreRegistry`, `SessionStore`, `RequestStore`, `UserStore`, `ProjectStore`, `ActiveRequestRegistry`

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
    "@flow-state-dev/server": "workspace:*",
    "<db-driver>": "^<version>"
  },
  "devDependencies": {
    "@types/node": "^22.0.0"
  },
  "scripts": {
    "build": "pnpm --filter @flow-state-dev/core build && pnpm --filter @flow-state-dev/server build && tsc -p tsconfig.json",
    "typecheck": "pnpm --filter @flow-state-dev/core build && pnpm --filter @flow-state-dev/server build && node ../../scripts/typecheck.mjs",
    "test": "pnpm --filter @flow-state-dev/core build && pnpm --filter @flow-state-dev/server build && vitest run --root .",
    "test:watch": "pnpm --filter @flow-state-dev/core build && pnpm --filter @flow-state-dev/server build && vitest --root ."
  }
}
```

### Step 4: Write the Factory

The main export is a factory function that returns a typed `StoreRegistry`:

```typescript
import type { StoreRegistry } from "@flow-state-dev/server";

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
  // 3. Return registry with all 5 stores

  return {
    session: create<Name>SessionStore(/* ... */),
    request: create<Name>RequestStore(/* ... */),
    user: create<Name>UserStore(/* ... */),
    project: create<Name>ProjectStore(/* ... */),
    activeRequests: create<Name>ActiveRequestRegistry(/* ... */),
    close() { /* cleanup */ }
  };
}

// Export individual store constructors for advanced use
export { create<Name>SessionStore } from "./session-store";
export { create<Name>RequestStore } from "./request-store";
export { create<Name>UserStore } from "./user-store";
export { create<Name>ProjectStore } from "./project-store";
export { create<Name>ActiveRequestRegistry } from "./active-request-registry";
export { initializeSchema } from "./schema";
```

### Step 5: Implement the 5 Store Interfaces

Each store must implement its interface from `@flow-state-dev/server`:

#### SessionStore
- `get(id)` — fetch by session ID
- `create(record)` — insert new session
- `update(id, record)` — update existing
- `delete(id)` — remove session
- `list(filters?)` — list with optional `flowKind`, `userId` filters + pagination (`limit`, `offset`)

#### RequestStore
- Same CRUD as SessionStore
- `list(filters?)` — filters include `sessionId`, `status`
- `persistItems(requestId, items)` — batch item persistence (use microtask batching)
- `persistEvents(requestId, events)` — batch event persistence with sequence ordering

#### UserStore
- Same CRUD pattern
- `list(filters?)` — no indexed filters beyond basic listing

#### ProjectStore
- Same CRUD pattern
- `list(filters?)` — `userId` filter

#### ActiveRequestRegistry
- `register(requestId, metadata)` — mark request as active
- `heartbeat(requestId)` — update heartbeat timestamp
- `deregister(requestId)` — mark request as inactive
- `getStale(thresholdMs)` — find requests with stale heartbeats

### Step 6: Schema Design Principles

Follow the SQLite adapter's hybrid approach:
- **JSONB/JSON data column** for the full record (flexible schema)
- **Indexed scalar columns** for filtered query fields (flowKind, userId, sessionId, status)
- **Timestamps** as millisecond epoch (use BIGINT for databases where INTEGER is 32-bit)

### Step 7: Write Tests

Create a comprehensive test suite. If the database has an embeddable/in-memory mode (like SQLite's `:memory:` or PGlite for Postgres), use that for zero-infrastructure testing.

Test categories:
1. Schema initialization (idempotent)
2. CRUD for all 4 record stores
3. List filtering (flowKind, userId, sessionId, status)
4. Pagination (limit, offset, edge cases)
5. Item persistence with microtask batching
6. Event persistence with sequence ordering and overwrite
7. Active request registry (register, heartbeat, stale detection, deregister)
8. Complex nested JSON round-trip
9. Drop-in replacement compatibility (same behavior as in-memory stores)

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

- **Match the SQLite adapter exactly.** Same method signatures, same return types, same error semantics. The stores are interchangeable.
- **Async factory is OK.** Unlike SQLite (synchronous), most databases need async initialization. Return `Promise<StoreRegistry>`.
- **Microtask batching for items/events.** Follow the SQLite adapter's pattern of buffering writes and flushing on microtask. This prevents excessive database round-trips during streaming.
- **Don't reinvent the record model.** The record shape (SessionRecord, RequestRecord, etc.) is defined by the server package. Your adapter serializes/deserializes it — nothing more.
- **Test with real queries, not mocks.** Use an embeddable database for tests. Don't mock the database driver — that tests nothing.
- **Schema initialization must be idempotent.** `CREATE TABLE IF NOT EXISTS` or equivalent. Multiple calls to `initializeSchema` must not fail.
