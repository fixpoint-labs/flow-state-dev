/**
 * Minimal query interface that both `pg.Pool` and `@electric-sql/pglite` can satisfy.
 * Allows the adapter to work with a real PostgreSQL server or an embedded PGlite instance.
 */

import type { Pool, PoolConfig } from "pg";

export type QueryResultRow = Record<string, unknown>;

export type QueryResult = {
  rows: QueryResultRow[];
  rowCount: number;
};

export interface QueryExecutor {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
}

/** Re-export of `pg.PoolConfig` so callers don't need a direct `pg` import. */
export type { PoolConfig } from "pg";

export type PostgresStoreOptions =
  | {
      /** Pre-configured pg Pool instance */
      pool: Pool;
    }
  | {
      /** PostgreSQL connection string (e.g. "postgres://user:pass@host:5432/db").
       *  When omitted, reads from env: FSD_DB_URL → DATABASE_URL.
       *  A connectionString inside `poolOptions` takes precedence over this field. */
      connectionString?: string;
      /** Maximum number of connections in the pool (default: 10) */
      max?: number;
      /** Timeout in ms for acquiring a connection from the pool (default: 10000).
       *  Prevents hanging on stale connections in serverless environments. */
      connectionTimeoutMillis?: number;
      /** Time in ms before an idle connection is closed (default: 30000).
       *  Shorter values reduce stale connections on frozen serverless instances. */
      idleTimeoutMillis?: number;
      /** Arbitrary `pg.PoolConfig` merged into the adapter's defaults (caller wins on overlap).
       *  Use this to pass Vercel-safe defaults (see `@flow-state-dev/vercel/pg`), tune
       *  any `pg` option (ssl, keepAlive, statement_timeout, ...), or swap the underlying
       *  client class via `poolOptions.Client` (e.g. `@neondatabase/serverless`'s Client). */
      poolOptions?: PoolConfig;
      /** Pool constructor override. Defaults to `(cfg) => new pg.Pool(cfg)`.
       *  Escape hatch for callers that want to fully replace the Pool class (e.g. use
       *  `@neondatabase/serverless`'s own `Pool` instead of `pg.Pool` wrapping its `Client`). */
      createPool?: (config: PoolConfig) => Pool;
    }
  | {
      /** A QueryExecutor-compatible client (e.g. PGlite for testing) */
      executor: QueryExecutor;
    };
