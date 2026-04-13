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
| Connection string | `connectionString: string`, `max?: number` | Creates a `pg.Pool` internally. `max` defaults to 10. |
| Pre-configured pool | `pool: Pool` | Uses an existing `pg.Pool` instance. You manage pool lifecycle. |
| Custom executor | `executor: QueryExecutor` | Any object with a `query(text, values?)` method. Useful for testing with PGlite. |

## Schema

Tables are created automatically on first connection (idempotent `CREATE TABLE IF NOT EXISTS`). The schema uses:

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
