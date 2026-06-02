/**
 * PostgreSQL persistence adapter for flow-state-dev.
 * Implements all 5 store interfaces using `pg` with connection pooling.
 * Schema auto-initializes on first call.
 */

import type { StoreAdapter, StoreRegistry } from "@flow-state-dev/server";
import type { Pool, PoolConfig } from "pg";
import type { PostgresStoreOptions, QueryExecutor } from "./types";
import { initializeSchema, initializeSchemaWithDedicatedClient } from "./schema";
import { createPostgresSessionStore } from "./session-store";
import { createPostgresRequestStore } from "./request-store";
import { createPostgresUserStore } from "./user-store";
import { createPostgresOrgStore } from "./org-store";
import { createPostgresActiveRequestRegistry } from "./active-request-registry";
import { createPostgresContentStore } from "./content-store";
import { createPostgresResourceStateStore } from "./resource-state-store";
import { createPostgresCheckpointStore } from "./checkpoint-store";
import {
  createInMemoryTraceStore,
  createInMemorySuspensionStore,
  createInMemoryLeaseStore
} from "@flow-state-dev/server";
import { createPgPoolTx } from "./tx";

const DEFAULT_LIVE_TAIL_POOL_MAX = 10;

/** Resolve the auto-created `liveTailPool`'s `max` from env (override `LIVE_TAIL_POOL_MAX`). */
function resolveLiveTailPoolMax(): number {
  const raw = process.env.LIVE_TAIL_POOL_MAX;
  if (raw === undefined || raw === "") return DEFAULT_LIVE_TAIL_POOL_MAX;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LIVE_TAIL_POOL_MAX;
}

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
  // `null` = explicitly disabled (caller passed `liveTailPool: null`).
  // `undefined` here = "decide later based on construction shape".
  // A `Pool` value = use as-is. The auto-create path runs only for shapes
  // that already have a connection string available.
  let liveTailPool: Pool | null | undefined = options.liveTailPool;
  /** Pool we created ourselves and therefore must `end()` on close. */
  let liveTailPoolOwned: Pool | undefined;

  async function closeLiveTailPool(): Promise<void> {
    if (liveTailPoolOwned !== undefined) {
      try {
        await liveTailPoolOwned.end();
      } catch {
        // Pool may already be closed; nothing to do.
      }
    }
  }

  if ("executor" in options) {
    executor = options.executor;
    closePool = closeLiveTailPool;
    // PGlite / arbitrary executors can't service LISTEN. Force polling.
    if (liveTailPool === undefined) liveTailPool = null;
  } else if ("pool" in options) {
    const pool = options.pool;
    executor = {
      async query(text: string, values?: unknown[]) {
        const result = await pool.query(text, values);
        return { rows: result.rows as Record<string, unknown>[], rowCount: result.rowCount ?? 0 };
      },
      async beginTx() {
        return createPgPoolTx(pool);
      }
    };
    closePool = async () => {
      await pool.end();
      await closeLiveTailPool();
    };
    // For the `{ pool }` shape we don't have a connection string to
    // auto-create a separate tail pool from. Callers who want LISTEN must
    // pass `liveTailPool` explicitly.
    if (liveTailPool === undefined) liveTailPool = null;
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
      },
      async beginTx() {
        return createPgPoolTx(pool);
      }
    };
    closePool = async () => {
      await pool.end();
      await closeLiveTailPool();
    };

    // Schema init needs session-scoped advisory locks — lock and unlock MUST
    // run on the same pg connection. Use a dedicated client, not the pool.
    if (!skipSchemaInit) {
      await initializeSchemaWithDedicatedClient(pool);
    }

    if (liveTailPool === undefined && poolConfig.connectionString) {
      const { default: pg } = await import("pg");
      // Inherit the caller's poolOptions so driver-level overrides (e.g. Neon's
      // WebSocket `Client`) apply to the tail pool too — the tail pool runs the
      // same protocol, against the same database, just on a separate set of
      // connections so LISTEN traffic doesn't compete with query traffic.
      // `max` and `allowExitOnIdle` are tail-specific and override any caller
      // values.
      liveTailPoolOwned = new pg.Pool({
        ...poolConfig,
        max: resolveLiveTailPoolMax(),
        allowExitOnIdle: true
      });
      liveTailPoolOwned.on("error", () => {});
      liveTailPool = liveTailPoolOwned;
    } else if (liveTailPool === undefined) {
      // Couldn't resolve a connection string from the merged poolConfig
      // (caller used `host` etc. without a URL). Fall back to polling.
      liveTailPool = null;
    }

    return {
      session: createPostgresSessionStore(executor),
      request: createPostgresRequestStore(executor, { liveTailPool }),
      user: createPostgresUserStore(executor),
      org: createPostgresOrgStore(executor),
      activeRequests: createPostgresActiveRequestRegistry(executor),
      content: createPostgresContentStore(executor),
      resourceState: createPostgresResourceStateStore(executor),
      checkpoints: createPostgresCheckpointStore(executor),
      traces: createInMemoryTraceStore(),
      suspensions: createInMemorySuspensionStore(),
      leases: createInMemoryLeaseStore(),
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
    request: createPostgresRequestStore(executor, { liveTailPool: liveTailPool ?? null }),
    user: createPostgresUserStore(executor),
    org: createPostgresOrgStore(executor),
    activeRequests: createPostgresActiveRequestRegistry(executor),
    content: createPostgresContentStore(executor),
    resourceState: createPostgresResourceStateStore(executor),
    checkpoints: createPostgresCheckpointStore(executor),
    traces: createInMemoryTraceStore(),
    suspensions: createInMemorySuspensionStore(),
    leases: createInMemoryLeaseStore(),
    async close() {
      await closePool();
    }
  };
}

/**
 * Postgres store adapter for `createFlowState`. Backs the `primary`
 * capability slot. Wraps `createPostgresStores`, memoizing the registry so
 * lazy resolution opens the pool once, and disposes it via `close()`.
 */
export function postgresStores(options: PostgresStoreOptions): StoreAdapter {
  let registry: PostgresStoreRegistry | undefined;
  return {
    capabilities: ["primary"],
    async resolve() {
      registry ??= await createPostgresStores(options);
      return registry;
    },
    async dispose() {
      await registry?.close();
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
  createPostgresResourceStateStore,
  createPostgresCheckpointStore
};

export { initializeSchema } from "./schema";
export { createPostgresScheduleIndex } from "./schedule-index";
export { createPgPoolTx } from "./tx";
export type { PostgresStoreOptions, PoolConfig, QueryExecutor, TxClient } from "./types";
