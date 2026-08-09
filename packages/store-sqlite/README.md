# @flow-state-dev/store-sqlite

SQLite persistence adapter for flow-state-dev. Implements the full `StoreRegistry` — including durable resource content and resource state — using `better-sqlite3`.

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

The registry declares `sharedAcrossProcesses: false`. A SQLite file can sit on a volume every worker opens or on a local disk only one process sees, and the adapter cannot tell which from the database handle it is given — so it reports not shared. Runtime behaviour that depends on reading another process's in-flight requests stays disabled rather than answering from a registry that may be process-local.

## Resource persistence

Everything this adapter stores survives a process restart, including resource state and resource content. A file-backed registry is a true persistent store, at parity with the Postgres adapter.

| Data | Durable | Stored in |
|------|---------|-----------|
| Scope records (session, user, org) | Yes | `sessions` / `users` / `orgs` |
| Request items and stream events | Yes | `request_items` / `request_events` |
| Resource state (single + collection instances) | Yes | `resource_state` |
| Resource content (artifacts, collection bodies, client data) | Yes | `resource_content` |
| Sequencer checkpoints, suspensions, leases, traces | Yes | dedicated tables |

### Resource state carries a version, and deletes leave a row behind

`resource_state` gained two columns: `version` (monotonic per key, never reused) and `lifecycle` (`live` or `deleted`). Writes are compare-and-swap: a write states the version it expects, and is refused if the row moved since it was read.

**What that guarantee covers.** The compare-and-swap protects any caller that passes the version it read, and that includes resource mutations authored inside a flow: the runtime writes them at the version the execution context observed, so two flow contexts patching one resource can no longer silently drop a write. Choose an adapter here for durability and for the version and tombstone semantics described below — the concurrency guarantee itself is the same on every adapter except the filesystem one, which compares within a single process only.

The migration is applied automatically on open and is **purely additive**: `ADD COLUMN` with defaults, no table rebuild, no backfill, indexes untouched, and `state` stays `NOT NULL`. Rows written before the upgrade read as **live at version 1**. Re-opening an already-migrated database is a no-op, so it is safe to roll forward repeatedly.

**Operator-visible:** deleting a resource does not remove its row. It marks the row `deleted`, keeps the version, and replaces the payload with `{}`. That retained version is what makes delete-then-recreate safe. Nothing reclaims these rows — there is no sweep, no timer, no retention window — so a workload that creates and deletes many resource keys accumulates one small row per deleted key. Plan for it rather than expecting a cleanup pass that does not exist.

```ts
const stores = createSQLiteStores({ filename: "./data/flowstate.db" });
await stores.content.set("session", sessionId, "artifacts/report", "…body…");
stores.close();

// After a restart, reopen the same file — the content is still there.
const reopened = createSQLiteStores({ filename: "./data/flowstate.db" });
await reopened.content.get("session", sessionId, "artifacts/report"); // "…body…"
```

Live-tail subscriptions (`request.subscribeToEvents`) share one poll loop per request rather than one per subscriber: N concurrent SSE viewers of the same request issue one shared query per tick, woken in-process by the write path. The subscription contract is unchanged.

## Schema evolution

The store auto-applies schema changes on connection open via `initializeSchema`. No manual migration step.

The `request_items` table was added for incremental item persistence: instead of rewriting the whole request blob on every item boundary, the store upserts one row per changed item keyed by `(request_id, item_id)`. Existing databases upgrade transparently — items written to the old `requests.data` blob are read via a fallback merge, and new items go to the table.

`sessions.parent_session_id` backs the `SessionListOptions.parentage` filter. It is nullable, applied automatically on open as a plain `ADD COLUMN`, and needs no backfill — a row without it counts as a top-level session. A plain btree index on the column serves `{ parentOf }` lookups.

## Individual Store Constructors

For advanced use cases, individual store constructors are also exported:

```ts
import Database from "better-sqlite3";
import { initializeSchema, createSQLiteSessionStore } from "@flow-state-dev/store-sqlite";

const db = new Database("./data/flowstate.db");
initializeSchema(db);
const sessionStore = createSQLiteSessionStore(db);
```
