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

`createSQLiteStores` accepts:

| Option | Type | Description |
|--------|------|-------------|
| `filename` | `string` | Path to the SQLite database file, or `":memory:"` for an in-memory database. If the file doesn't exist, it will be created automatically. |
| `skipSchemaInit` | `boolean` | Skip the `CREATE TABLE/INDEX` and rename-migration step on construction. Per-connection PRAGMAs are always applied. Default `false`. |
| `traceStore` | `{ maxRequests?: number }` | Trace event retention. When unset, defaults to 1000 if `NODE_ENV=development` and 50 otherwise. Explicit values override the env-aware default. |

## WAL Mode

WAL (Write-Ahead Logging) mode is enabled by default. This allows concurrent readers alongside the writer, which is important for server workloads where SSE streams read state while actions write it. The following pragmas are applied on connection open:

- `journal_mode = WAL` — concurrent read/write
- `busy_timeout = 5000` — wait up to 5s for locks
- `synchronous = NORMAL` — balanced durability/performance
- `cache_size = -20000` — 20MB page cache
- `foreign_keys = ON`
- `temp_store = MEMORY`

## Schedule index

`createSQLiteScheduleIndex(db)` returns a `ScheduleIndex` implementation backed by the `schedule_index` table. Pair it with `defineScheduleCollection` from `@flow-state-dev/scheduled` to auto-mirror dynamic schedules, and a cron tick that dispatches the due rows.

```ts
import Database from "better-sqlite3";
import { createSQLiteScheduleIndex, initializeSchema } from "@flow-state-dev/store-sqlite";

const db = new Database("./data/flowstate.db");
initializeSchema(db);
const index = createSQLiteScheduleIndex(db);
```

`claimDue` runs inside `db.transaction` (BEGIN IMMEDIATE), so claim+advance is serialized against other writers. SQLite is single-writer; you can run the tick on a single node without extra coordination.

See [the schedule index reference](https://flowstate.dev/docs/server/schedule-index) for the full interface and contract.

## Interrupted Request Recovery

This adapter fully supports interrupted request recovery. The `ActiveRequestRegistry` implementation stores in-flight request entries with heartbeat timestamps, enabling `listStale()` to detect abandoned requests via an indexed range query.

## Schema evolution

The store auto-applies schema changes on connection open via `initializeSchema`. No manual migration step.

The `request_items` table was added for incremental item persistence: instead of rewriting the whole request blob on every item boundary, the store upserts one row per changed item keyed by `(request_id, item_id)`. Existing databases upgrade transparently — items written to the old `requests.data` blob are read via a fallback merge, and new items go to the table.

## Individual Store Constructors

For advanced use cases, individual store constructors are also exported:

```ts
import Database from "better-sqlite3";
import { initializeSchema, createSQLiteSessionStore } from "@flow-state-dev/store-sqlite";

const db = new Database("./data/flowstate.db");
initializeSchema(db);
const sessionStore = createSQLiteSessionStore(db);
```
