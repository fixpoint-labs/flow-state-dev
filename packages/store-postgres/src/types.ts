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
  /**
   * Begin an interactive transaction bound to a single underlying
   * connection. Required by `createPostgresScheduleIndex` (and any
   * other feature needing `SELECT ... FOR UPDATE SKIP LOCKED` semantics
   * inside a transaction). Optional on the interface so executors that
   * cannot pin a connection (e.g. arbitrary HTTP-proxied query
   * surfaces) remain valid for the rest of the store API.
   */
  beginTx?(): Promise<TxClient>;
}

/**
 * A transaction handle. `query` runs on the pinned connection. The
 * caller MUST eventually call exactly one of `commit` or `rollback`
 * to release the connection back to the pool.
 */
export interface TxClient {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/** Re-export of `pg.PoolConfig` so callers don't need a direct `pg` import. */
export type { PoolConfig } from "pg";

/** Options shared by every `createPostgresStores` shape. */
export type CommonPostgresStoreOptions = {
  /** Skip schema initialization on construction. Default `false`.
   *  Set to `true` when migrations are run out-of-band (e.g. as a build step
   *  via `initializeSchema` / `createPostgresStores` in a deploy script). On
   *  serverless platforms this removes ~30 idempotent DDL roundtrips and the
   *  advisory-lock dance from every cold start. */
  skipSchemaInit?: boolean;
  /**
   * Dedicated `pg.Pool` for cross-process live tail (`LISTEN flow_events`).
   * Supplied separately from the main query executor because LISTEN
   * requires a true `pg.Client` checkout, which only `pg.Pool` provides
   * (PGlite and arbitrary `QueryExecutor`s can't honor it).
   *
   * Behavior:
   * - Omitted (`undefined`): when the store is constructed from
   *   `{ connectionString, ... }` or `{ pool }`, `createPostgresStores`
   *   auto-creates a fresh `Pool` with `max: ENV.LIVE_TAIL_POOL_MAX ?? 10`
   *   so out-of-the-box deployments get cross-process tail with no
   *   wiring. Construction shapes that can't carry a Pool (`{ executor }`
   *   for PGlite) fall back to polling.
   * - Provided: the supplied Pool is used as-is. Caller manages lifecycle.
   * - `null`: explicitly disable LISTEN; `subscribeToEvents` polls instead.
   *
   * See FIX-569 §3.4.
   */
  liveTailPool?: Pool | null;
};

export type PostgresStoreOptions = CommonPostgresStoreOptions &
  (
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
      }
  );
