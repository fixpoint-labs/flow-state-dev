# @flow-state-dev/store-sqlite

SQLite persistence adapter for flow-state-dev. Implements all 5 store interfaces (`SessionStore`, `RequestStore`, `UserStore`, `ProjectStore`, `ActiveRequestRegistry`) using `better-sqlite3`.

## Why SQLite

SQLite is an embedded, file-based database — zero infrastructure required. It bridges the gap between the in-memory adapter (dev/testing) and full client-server databases like PostgreSQL. You get real SQL semantics and proper concurrency control without spinning up a database server.

## Installation

```bash
pnpm add @flow-state-dev/store-sqlite
```

## Usage

```ts
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";

// File-based (persistent)
const stores = createSQLiteStores({ filename: "./data/flowstate.db" });

// In-memory (testing)
const testStores = createSQLiteStores({ filename: ":memory:" });

// Use as a drop-in replacement for createInMemoryStores()
const server = createFlowServer({
  stores,
  // ...
});

// Close when done
stores.close();
```

## Configuration

The `createSQLiteStores` factory accepts a single option:

| Option | Type | Description |
|--------|------|-------------|
| `filename` | `string` | Path to the SQLite database file, or `":memory:"` for an in-memory database. If the file doesn't exist, it will be created automatically. |

## WAL Mode

WAL (Write-Ahead Logging) mode is enabled by default. This allows concurrent readers alongside the writer, which is important for server workloads where SSE streams read state while actions write it. The following pragmas are applied on connection open:

- `journal_mode = WAL` — concurrent read/write
- `busy_timeout = 5000` — wait up to 5s for locks
- `synchronous = NORMAL` — balanced durability/performance
- `cache_size = -20000` — 20MB page cache
- `foreign_keys = ON`
- `temp_store = MEMORY`

## Interrupted Request Recovery

This adapter fully supports the interrupted request recovery feature (FIX-294). The `ActiveRequestRegistry` implementation stores in-flight request entries with heartbeat timestamps, enabling `listStale()` to detect abandoned requests via an indexed range query.

## Individual Store Constructors

For advanced use cases, individual store constructors are also exported:

```ts
import Database from "better-sqlite3";
import { initializeSchema, createSQLiteSessionStore } from "@flow-state-dev/store-sqlite";

const db = new Database("./data/flowstate.db");
initializeSchema(db);
const sessionStore = createSQLiteSessionStore(db);
```
