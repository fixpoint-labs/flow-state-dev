/**
 * PostgreSQL persistence adapter for flow-state-dev.
 * Implements all 5 store interfaces using `pg` with connection pooling.
 * Schema auto-initializes on first call.
 */

import type { StoreRegistry } from "@flow-state-dev/server";
import type { Pool, PoolConfig } from "pg";
import type { PostgresStoreOptions, QueryExecutor } from "./types";
import { initializeSchema, initializeSchemaWithDedicatedClient } from "./schema";
import { createPostgresSessionStore } from "./session-store";
import { createPostgresRequestStore } from "./request-store";
import { createPostgresUserStore } from "./user-store";
import { createPostgresOrgStore } from "./org-store";
import { createPostgresActiveRequestRegistry } from "./active-request-registry";
import { createPostgresContentStore } from "./content-store";
import { createPostgresCheckpointStore } from "./checkpoint-store";

export type PostgresStoreRegistry = StoreRegistry & {
  /** Drain the connection pool and disconnect */
  close(): Promise<void>;
};

/**
 * Create a StoreRegistry backed by PostgreSQL.
 * Schema auto-initializes on first call (idempotent), unless `skipSchemaInit: true`.
 *
 * Accepts one of:
 * - `{ pool }` — a pre-configured pg.Pool
 * - `{ connectionString?, max?, poolOptions?, createPool? }` — connection config (pool created internally).
 *    When `connectionString` is omitted, reads from `FSD_DB_URL` then `DATABASE_URL`.
 *    `poolOptions` is merged onto the adapter's defaults (caller wins). `createPool` overrides
 *    the Pool constructor (defaults to `(cfg) => new pg.Pool(cfg)`).
 * - `{ executor }` — a QueryExecutor-compatible client (e.g. PGlite for testing)
 *
 * Pass `skipSchemaInit: true` (along with any of the above shapes) when migrations
 * run out-of-band — e.g. a deploy-time script that calls `createPostgresStores` once
 * with `skipSchemaInit` unset and then `await stores.close()`.
 */
export async function createPostgresStores(
  options: PostgresStoreOptions
): Promise<PostgresStoreRegistry> {
  const skipSchemaInit = options.skipSchemaInit === true;
  let executor: QueryExecutor;
  let closePool: () => Promise<void>;

  if ("executor" in options) {
    executor = options.executor;
    closePool = async () => {};
  } else if ("pool" in options) {
    const pool = options.pool;
    executor = {
      async query(text: string, values?: unknown[]) {
        const result = await pool.query(text, values);
        return { rows: result.rows as Record<string, unknown>[], rowCount: result.rowCount ?? 0 };
      }
    };
    closePool = () => pool.end();
  } else {
    const connStr =
      options.connectionString ??
      process.env.FSD_DB_URL ??
      process.env.DATABASE_URL;

    const defaults: PoolConfig = {
      max: options.max ?? 10,
      // Serverless-safe defaults: detect stale connections from frozen function
      // instances instead of hanging indefinitely on half-open TCP sockets.
      connectionTimeoutMillis: options.connectionTimeoutMillis ?? 10_000,
      idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
      allowExitOnIdle: true
    };
    if (connStr) defaults.connectionString = connStr;

    const poolConfig: PoolConfig = { ...defaults, ...options.poolOptions };

    // Trust `pg` to validate connection info at connect time if caller supplied
    // poolOptions; only reject the no-information case to preserve the prior
    // actionable error message.
    if (!poolConfig.connectionString && !poolConfig.host) {
      throw new Error(
        "createPostgresStores: no connection string provided. " +
        "Pass { connectionString } or set FSD_DB_URL / DATABASE_URL."
      );
    }

    let pool: Pool;
    if (options.createPool) {
      pool = options.createPool(poolConfig);
    } else {
      const { default: pg } = await import("pg");
      pool = new pg.Pool(poolConfig);
    }

    // pg.Pool supports multiple 'error' listeners, but the process crashes if
    // *none* are attached — a dead-socket event from an auto-suspended Neon/RDS
    // endpoint would otherwise take the function down. Callers can still attach
    // their own handlers on top of this.
    pool.on("error", () => {});

    executor = {
      async query(text: string, values?: unknown[]) {
        const result = await pool.query(text, values);
        return { rows: result.rows as Record<string, unknown>[], rowCount: result.rowCount ?? 0 };
      }
    };
    closePool = () => pool.end();

    // Schema init needs session-scoped advisory locks — lock and unlock MUST
    // run on the same pg connection. Use a dedicated client, not the pool.
    if (!skipSchemaInit) {
      await initializeSchemaWithDedicatedClient(pool);
    }

    return {
      session: createPostgresSessionStore(executor),
      request: createPostgresRequestStore(executor),
      user: createPostgresUserStore(executor),
      org: createPostgresOrgStore(executor),
      activeRequests: createPostgresActiveRequestRegistry(executor),
      content: createPostgresContentStore(executor),
      checkpoints: createPostgresCheckpointStore(executor),
      async close() {
        await closePool();
      }
    };
  }

  if (!skipSchemaInit) {
    await initializeSchema(executor);
  }

  return {
    session: createPostgresSessionStore(executor),
    request: createPostgresRequestStore(executor),
    user: createPostgresUserStore(executor),
    org: createPostgresOrgStore(executor),
    activeRequests: createPostgresActiveRequestRegistry(executor),
    content: createPostgresContentStore(executor),
    checkpoints: createPostgresCheckpointStore(executor),
    async close() {
      await closePool();
    }
  };
}

export {
  createPostgresSessionStore,
  createPostgresRequestStore,
  createPostgresUserStore,
  createPostgresOrgStore,
  createPostgresActiveRequestRegistry,
  createPostgresContentStore,
  createPostgresCheckpointStore
};

export { initializeSchema } from "./schema";
export type { PostgresStoreOptions, PoolConfig, QueryExecutor } from "./types";
