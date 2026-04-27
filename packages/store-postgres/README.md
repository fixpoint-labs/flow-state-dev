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
| `request_events` | `(request_id, sequence_number)` | Stream event replay for completed requests |

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

## Interrupted Request Recovery

This adapter fully supports the interrupted request recovery feature. The `ActiveRequestRegistry` implementation stores in-flight request entries with heartbeat timestamps, enabling `listStale()` to detect abandoned requests via an indexed range query on `last_heartbeat_at`.

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
