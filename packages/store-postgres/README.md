# @flow-state-dev/store-postgres

PostgreSQL persistence adapter for flow-state-dev. Implements all 5 store interfaces (`SessionStore`, `RequestStore`, `UserStore`, `ProjectStore`, `ActiveRequestRegistry`) using `pg` with connection pooling.

## Why PostgreSQL

PostgreSQL is the most widely deployed relational database in modern stacks. Its JSONB column type stores the flexible record schemas while enabling SQL-based querying, joins, and transactional guarantees. Good fit for teams already running Postgres and for production workloads that need proper connection pooling and concurrent access.

## Installation

```bash
pnpm add @flow-state-dev/store-postgres pg
```

## Usage

```ts
import { createPostgresStores } from "@flow-state-dev/store-postgres";

// From connection string (pool created automatically)
const stores = await createPostgresStores({
  connectionString: "postgres://user:pass@localhost:5432/mydb",
  max: 20 // pool size, default: 10
});

// Or with a pre-configured pg.Pool
import { Pool } from "pg";

const pool = new Pool({ connectionString: "postgres://..." });
const stores = await createPostgresStores({ pool });

// Use as a drop-in replacement for createInMemoryStores()
const server = createFlowServer({
  stores,
  // ...
});

// Close when done (drains the connection pool)
await stores.close();
```

## Configuration

The `createPostgresStores` factory accepts one of three option shapes:

| Option shape | Fields | Description |
|--------------|--------|-------------|
| Connection string | `connectionString?`, `max?`, `poolOptions?`, `createPool?` | Creates a `pg.Pool` internally. See "Configuring the pool" below. When `connectionString` is omitted, reads from env `FSD_DB_URL` then `DATABASE_URL`. |
| Pre-configured pool | `pool: Pool` | Uses an existing `pg.Pool` instance. You manage pool lifecycle. |
| Custom executor | `executor: QueryExecutor` | Any object with a `query(text, values?)` method. Useful for testing with PGlite. |

## Configuring the pool

`poolOptions` is a `pg.PoolConfig` merged into the adapter's internal `new pg.Pool(...)` call. Caller values win on overlap. Use it for pool tuning (sizing, timeouts, SSL, keep-alive), for swapping the underlying `Client` class, or for dropping in pre-baked defaults like `vercelPgPoolOptions`:

```ts
import { createPostgresStores } from "@flow-state-dev/store-postgres";
import { vercelPgPoolOptions } from "@flow-state-dev/vercel/pg";

const stores = await createPostgresStores({
  connectionString: process.env.DATABASE_URL,
  poolOptions: process.env.VERCEL ? vercelPgPoolOptions : undefined
});
```

The adapter also attaches a default `pool.on('error', ...)` listener so unhandled pool-level errors (e.g. dead sockets from an auto-suspended database) don't crash the process. `pg.Pool` supports multiple listeners — you can still attach your own.

### Neon serverless driver

`pg.PoolConfig.Client` is `pg`'s documented seam for swapping the underlying client class. `@neondatabase/serverless` ships a drop-in `Client`:

```ts
import { createPostgresStores, type PoolConfig } from "@flow-state-dev/store-postgres";
import { vercelPgPoolOptions } from "@flow-state-dev/vercel/pg";
import { Client as NeonClient } from "@neondatabase/serverless";

// Runtime drop-in, but Neon's connect() signature doesn't structurally match
// pg's, so cast once at the seam.
const NeonClientForPg = NeonClient as unknown as PoolConfig["Client"];

const stores = await createPostgresStores({
  connectionString: process.env.DATABASE_URL,
  poolOptions: {
    ...vercelPgPoolOptions,
    Client: NeonClientForPg
  }
});
```

This uses Neon's WebSocket transport while keeping `pg.Pool` as the pool implementation. If you want Neon's own `Pool` class (which has additional WebSocket socket-reuse optimizations), use `createPool`:

```ts
import { Pool as NeonPool } from "@neondatabase/serverless";

const stores = await createPostgresStores({
  connectionString: process.env.DATABASE_URL,
  poolOptions: vercelPgPoolOptions,
  createPool: (cfg) => new NeonPool(cfg) as unknown as import("pg").Pool
});
```

### Named convenience fields

For simple cases you can pass the most common knobs directly. `poolOptions` wins if both are set.

| Field | Default | Equivalent `poolOptions` key |
|-------|---------|------------------------------|
| `max` | `10` | `max` |
| `connectionTimeoutMillis` | `10_000` | `connectionTimeoutMillis` |
| `idleTimeoutMillis` | `30_000` | `idleTimeoutMillis` |

## Schema

Tables are created automatically on first call to `createPostgresStores` (idempotent `CREATE TABLE IF NOT EXISTS`). On serverless platforms this runs on every cold start — see [Skipping runtime schema init](#skipping-runtime-schema-init) below if that latency matters.

The schema uses:

- **JSONB** for the full record `data` column (enables future query-time JSON operators)
- **BIGINT** for timestamp columns (millisecond epoch values)
- **B-tree indexes** on common filter columns (`flow_kind`, `user_id`, `session_id`, `status`, `updated_at`)

### Tables

| Table | Primary Key | Purpose |
|-------|-------------|---------|
| `sessions` | `id` | Session records with flow kind, user, project |
| `requests` | `id` | Request records with status tracking |
| `users` | `id` | User-scoped state and resources |
| `projects` | `id` | Project-scoped state and resources |
| `active_requests` | `request_id` | In-flight request registry for interrupted request recovery |
| `resource_content` | `(scope_type, scope_id, resource_key)` | Resource content bodies (`TEXT`), keyed per resource, separate from scope records |
| `resource_state` | `(scope_type, scope_id, resource_key)` | Resource state (`JSONB`), single + collection instances, keyed per resource, separate from scope records |
| `request_events` | `(request_id, sequence_number)` | Stream event replay for completed requests |
| `request_items` | `(request_id, item_id)` | Output items produced by a request (one row per item) |

### Resource state carries a version, and deletes leave a row behind

`resource_state` gained two columns: `version` (monotonic per key, never reused) and `lifecycle` (`live` or `deleted`). Writes are compare-and-swap: a write states the version it expects, and is refused if the row moved since it was read.

**What that guarantee covers, and what it does not yet.** The compare-and-swap is real, and it protects any caller that passes the version it read — code holding a `ResourceStateStore` directly. It does not yet reach resource mutations authored inside a flow. The runtime still persists those unconditionally, so two flow contexts writing the same resource remain last-write-wins, on this adapter and on every other. Threading the observed version through the runtime's resource writes is the next piece of this work. Choose an adapter here for durability and for the version and tombstone semantics described below, not for protection against concurrent flow-authored writes.

The migration is applied automatically on open and is **purely additive**: `ADD COLUMN` with defaults, no table rebuild, no backfill, indexes untouched, and `state` stays `NOT NULL`. Rows written before the upgrade read as **live at version 1**. Re-opening an already-migrated database is a no-op, so it is safe to roll forward repeatedly.

**Operator-visible:** deleting a resource does not remove its row. It marks the row `deleted`, keeps the version, and replaces the payload with `{}`. That retained version is what makes delete-then-recreate safe. Nothing reclaims these rows — there is no sweep, no timer, no retention window — so a workload that creates and deletes many resource keys accumulates one small row per deleted key. Plan for it rather than expecting a cleanup pass that does not exist.

## Items storage

Output items produced by a request are stored one row per item in the `request_items` table, separate from the `requests` record:

```sql
CREATE TABLE request_items (
  request_id  TEXT   NOT NULL,
  item_id     TEXT   NOT NULL,
  sequence    BIGINT NOT NULL,
  item_type   TEXT   NOT NULL,
  data        JSONB  NOT NULL,
  PRIMARY KEY (request_id, item_id)
);
CREATE INDEX idx_request_items_request_sequence ON request_items(request_id, sequence);
```

A typical query, in order:

```sql
SELECT data FROM request_items WHERE request_id = $1 ORDER BY sequence ASC;
```

The framework's `RequestStore.persistItems` API is unchanged. The adapter handles batched UPSERT inside `persistItems` / `flushItems` calls, keyed by `(request_id, item_id)` so keyed-component re-emissions update in place.

## Why a separate table

In the prior shape, items were stored as a JSONB sub-path inside `requests.data->'items'` and rewritten on every coalesced flush. Postgres keeps large column values out-of-line in a side table called TOAST; updating a JSONB column produces a new TOAST copy and leaves the prior chunks dead until autovacuum reclaims them. On serverless Postgres (Neon, Vercel Postgres, RDS Aurora Serverless), autovacuum runs less aggressively because compute suspends between requests, so dead TOAST tuples accumulate faster than they clear.

A production request with about 4.5MB of items JSON ended up occupying 349MB on disk — a 78x amplification.

After the change, an item INSERT pays the TOAST cost once. An UPDATE only rewrites the one row's payload, not the entire items array. Unchanged item rows are never re-TOAST'd. Storage cost is proportional to data emitted, not to flush cadence.

## Upgrading from older versions

Migration is lazy. There is no offline step and no required backfill.

- New requests after the deploy: items go straight to `request_items`. The `requests.data` JSONB no longer carries a `data.items` slice for new writes.
- Legacy requests at deploy time: items still live in `data.items`. The adapter's read path returns them via a fallback that merges `request_items` rows with `data.items`, ordered by `itemIndex`.
- In-flight requests at deploy time: items emitted before the deploy live in `data.items`; items emitted after live in `request_items`. The merge returns both, in order.

The merge is one-directional, which makes this **a forward-only deploy**. Once new code has written even one row to `request_items`, that data is invisible to the old code (which only reads `data.items`). Rolling back requires manually exporting `request_items` rows back into `data.items` JSONB arrays. Validate the deploy in a staging environment before rolling out.

## Reclaiming storage from the legacy bloat

After upgrade, the legacy `data.items` arrays on already-migrated requests are still occupying disk space inside the bloated `requests` table. Two optional, operator-driven steps reclaim it.

1. Strip the legacy slice from migrated rows:

   ```sql
   UPDATE requests
   SET data = data - 'items'
   WHERE id IN (SELECT request_id FROM request_items GROUP BY request_id)
     AND data ? 'items';
   ```

   The statement is idempotent and safe to run on a live database. After it runs, the lazy fallback in the read path is a no-op for those requests.

2. Reclaim the dead TOAST tuples with [`pg_repack`](https://reorg.github.io/pg_repack/):

   ```bash
   pg_repack requests --no-superuser-check
   ```

   Neon supports `pg_repack` ([docs](https://neon.com/docs/extensions/pg_repack)). The repack rewrites the table without an exclusive lock, but it produces WAL that lands in the deployment's history-window billed storage during execution. Consider temporarily shrinking the history window during the run on Neon.

Neither step is required for correctness. They reclaim disk that was wasted by the prior write pattern; new requests under the new code path don't incur the bloat in the first place.

## Breaking change in `list()` behavior

`RequestStore.list()` no longer populates `record.items` by default on the Postgres adapter. Items are stored in a separate table and populating them costs an additional query per call; default-off avoids paying that cost on the many listing endpoints that don't read items.

Pass `withItems: true` to opt in:

```ts
const requests = await stores.request.list({ sessionId, withItems: true });
```

The three framework-internal callers that depend on items in listings are already updated: cross-turn history reconstruction, the `?includeItems` state endpoint, and the session-requests listing endpoint. Other adapters (memory, filesystem, SQLite) still return items inline regardless of the flag. Custom application code that read `record.items` from a `list()` result on Postgres must add the flag.

### Skipping runtime schema init

Schema init runs ~30 idempotent DDL statements plus a Postgres advisory-lock acquisition every time `createPostgresStores` is called. On serverless platforms (Vercel, Lambda) that's once per cold start, adding noticeable latency to the first request after a function spins up.

To skip it at runtime, run migrations as a separate deploy step and pass `skipSchemaInit: true`:

```ts title="Deploy step (e.g. vercel-build, CI, or a one-shot script)"
import { createPostgresStores } from "@flow-state-dev/store-postgres";

const stores = await createPostgresStores({ connectionString: process.env.DATABASE_URL });
await stores.close();
```

```ts title="Runtime"
const stores = await createPostgresStores({
  connectionString: process.env.DATABASE_URL,
  skipSchemaInit: true,
});
```

Migrations are still idempotent if you forget — `skipSchemaInit` is a performance optimization, not a correctness requirement. See `apps/kitchen-sink/scripts/migrate.mjs` in the flow-state-dev repo for a full example.

## Schedule index

`createPostgresScheduleIndex(executor)` returns a `ScheduleIndex` implementation backed by the `schedule_index` table. Use it with `defineScheduleCollection` from `@flow-state-dev/scheduled` to auto-mirror dynamic schedules, then point a cron tick at the index to dispatch due rows.

```ts
import pg from "pg";
import { createPostgresScheduleIndex } from "@flow-state-dev/store-postgres";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const executor = {
  async query(text: string, values?: unknown[]) {
    const r = await pool.query(text, values);
    return { rows: r.rows, rowCount: r.rowCount ?? 0 };
  },
  async beginTx() {
    return createPgPoolTx(pool);
  }
};
const index = createPostgresScheduleIndex(executor);
```

`claimDue` reads + advances inside one transaction using `SELECT ... FOR UPDATE SKIP LOCKED` so multiple replicas can tick concurrently without double-firing. The factory requires the executor to implement `beginTx()` — the pool-backed executors `createPostgresStores` returns do. For PGlite-style single-connection executors, use the exported `createSingleConnectionTx` helper.

See [the schedule index reference](https://flowstate.dev/docs/server/schedule-index) for the full interface and contract.

## Interrupted Request Recovery

This adapter fully supports the interrupted request recovery feature. The `ActiveRequestRegistry` implementation stores in-flight request entries with heartbeat timestamps, enabling `listStale()` to detect abandoned requests via an indexed range query on `last_heartbeat_at`.

## Cross-process live tail

Multi-instance deployments can serve an SSE tail for a request started on a different instance. The adapter uses PostgreSQL's `LISTEN/NOTIFY` — the database's pub/sub primitive — to broadcast a small signal whenever a new request event is persisted, so other instances know when to pull fresh rows.

### How it works

`persistEvents` runs `pg_notify('flow_events', '<requestId>:<seq>')` inside the same transaction as the `INSERT INTO request_events`. The notification is suppressed if the transaction rolls back, so subscribers never see signals for events that didn't make it to the table.

`subscribeToEvents` checks out a dedicated `pg.Client` from a separate `liveTailPool`, issues `LISTEN flow_events`, and waits for notifications. On each notification it filters by `requestId`, then drains via `getEvents(id, lastSeen)`. N notifications collapse into one query (the Notifier Pattern), so bursty workloads don't fan out into N+1 reads.

### Configuration

Zero-config by default: when you construct via `{ connectionString, ... }`, a fresh `liveTailPool` is auto-created with `max: 10` (override via the `LIVE_TAIL_POOL_MAX` env var). Pass `liveTailPool` explicitly for fleet-wide tuning, or `liveTailPool: null` to disable LISTEN entirely and fall back to polling.

```ts
import pg from "pg";
import { createPostgresStores } from "@flow-state-dev/store-postgres";

// Default: auto-creates a separate Pool({ max: LIVE_TAIL_POOL_MAX ?? 10 })
const stores = await createPostgresStores({
  connectionString: process.env.DATABASE_URL!
});

// Or supply your own tail pool (e.g. tuned to fleet size)
const queryPool = new pg.Pool({ connectionString, max: 20 });
const tailPool = new pg.Pool({ connectionString, max: 50 });
const tuned = await createPostgresStores({
  pool: queryPool,
  liveTailPool: tailPool
});
```

The liveness timeout (how long subscribers wait before yielding a synthetic `request.interrupted` on a stalled originating instance) defaults to 30s and is configurable via `LIVE_TAIL_LIVENESS_MS`.

### PGlite

[`@electric-sql/pglite`](https://pglite.dev) does not support `LISTEN/NOTIFY`. When constructed via `{ executor }`, `subscribeToEvents` polls instead of listening — same shape as the SQLite store. PGlite remains supported for tests and embedded deployments.

### Limitations

- `content.delta` events are in-process only. Cross-process subscribers snap to the next persisted snapshot (`item.added` / `item.done` / item-update) rather than receiving per-token deltas.
- A dropped originating instance surfaces as a clean stream end with a synthetic `request.interrupted` event after the liveness timeout (default 30s). Clients can reconnect with `Last-Event-ID` to resume.
- LISTEN/NOTIFY's scaling ceiling is per-NOTIFY-volume — see [Recall.ai's writeup](https://www.recall.ai/blog/postgres-listen-notify-does-not-scale). Below tens of thousands of simultaneous in-flight requests the pattern is fine; above that, look at Redis pub/sub or NATS.

## Testing with PGlite

For zero-infrastructure testing, use `@electric-sql/pglite` (embedded PostgreSQL via WASM):

```ts
import { PGlite } from "@electric-sql/pglite";
import { createPostgresStores } from "@flow-state-dev/store-postgres";
import type { QueryExecutor } from "@flow-state-dev/store-postgres";

function pgliteExecutor(pglite: PGlite): QueryExecutor {
  return {
    async query(text, values?) {
      const result = await pglite.query(text, values);
      return {
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.affectedRows ?? 0
      };
    }
  };
}

const pglite = new PGlite();
const stores = await createPostgresStores({ executor: pgliteExecutor(pglite) });
```

## Individual Store Constructors

For advanced use cases, individual store constructors are also exported:

```ts
import {
  initializeSchema,
  createPostgresSessionStore
} from "@flow-state-dev/store-postgres";
import type { QueryExecutor } from "@flow-state-dev/store-postgres";

// Initialize schema first, then create individual stores
await initializeSchema(executor);
const sessionStore = createPostgresSessionStore(executor);
```
