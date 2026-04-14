/**
 * PostgreSQL persistence adapter for flow-state-dev.
 * Implements all 5 store interfaces using `pg` with connection pooling.
 * Schema auto-initializes on first call.
 */

import type { StoreRegistry } from "@flow-state-dev/server";
import type { PostgresStoreOptions, QueryExecutor } from "./types";
import { initializeSchema } from "./schema";
import { createPostgresSessionStore } from "./session-store";
import { createPostgresRequestStore } from "./request-store";
import { createPostgresUserStore } from "./user-store";
import { createPostgresProjectStore } from "./project-store";
import { createPostgresActiveRequestRegistry } from "./active-request-registry";
import { createPostgresContentStore } from "./content-store";

export type PostgresStoreRegistry = StoreRegistry & {
  /** Drain the connection pool and disconnect */
  close(): Promise<void>;
};

/**
 * Create a StoreRegistry backed by PostgreSQL.
 * Schema auto-initializes on first call (idempotent).
 *
 * Accepts one of:
 * - `{ pool }` — a pre-configured pg.Pool
 * - `{ connectionString?, max? }` — connection config (pool created internally).
 *    When `connectionString` is omitted, reads from `FSD_DB_URL` then `DATABASE_URL`.
 * - `{ executor }` — a QueryExecutor-compatible client (e.g. PGlite for testing)
 */
export async function createPostgresStores(
  options: PostgresStoreOptions
): Promise<PostgresStoreRegistry> {
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
    if (!connStr) {
      throw new Error(
        "createPostgresStores: no connection string provided. " +
        "Pass { connectionString } or set FSD_DB_URL / DATABASE_URL."
      );
    }
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({
      connectionString: connStr,
      max: options.max ?? 10,
      // Serverless-safe defaults: detect stale connections from frozen function
      // instances instead of hanging indefinitely on half-open TCP sockets.
      connectionTimeoutMillis: options.connectionTimeoutMillis ?? 10_000,
      idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
      allowExitOnIdle: true
    });
    executor = {
      async query(text: string, values?: unknown[]) {
        const result = await pool.query(text, values);
        return { rows: result.rows as Record<string, unknown>[], rowCount: result.rowCount ?? 0 };
      }
    };
    closePool = () => pool.end();
  }

  await initializeSchema(executor);

  return {
    session: createPostgresSessionStore(executor),
    request: createPostgresRequestStore(executor),
    user: createPostgresUserStore(executor),
    project: createPostgresProjectStore(executor),
    activeRequests: createPostgresActiveRequestRegistry(executor),
    content: createPostgresContentStore(executor),
    async close() {
      await closePool();
    }
  };
}

export {
  createPostgresSessionStore,
  createPostgresRequestStore,
  createPostgresUserStore,
  createPostgresProjectStore,
  createPostgresActiveRequestRegistry,
  createPostgresContentStore
};

export { initializeSchema } from "./schema";
export type { PostgresStoreOptions, QueryExecutor } from "./types";
