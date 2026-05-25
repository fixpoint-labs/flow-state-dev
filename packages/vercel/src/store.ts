/**
 * Vercel/Neon-tuned Postgres store adapter for `createFlowState`.
 *
 * `vercelPostgresStores()` returns a `StoreAdapter` for the `primary`
 * capability slot with the Vercel deployment defaults baked in:
 * `vercelPgPoolOptions`, the Neon WebSocket `Client` swap when the URL is a
 * Neon endpoint, `skipSchemaInit: true` (migrations run out-of-band at
 * build), and `liveTailPool: null` (polling fallback, correct on Vercel's
 * pgbouncer). User code declares it as a profile slot — no `process.env.VERCEL`
 * checks, no URL sniffing.
 *
 * It also declares the `scheduler` capability and exposes a `scheduleIndex`
 * backed by the same pool. `scheduler` is a forward-compatible slot (it backs
 * no `StoreRegistry` sub-store), so the index reaches scheduled flows through
 * the app's own stable proxy — install it with the app's `setScheduleIndexImpl`
 * equivalent. The index no-ops until the pool is resolved on first request.
 */
import type { StoreAdapter } from "@flow-state-dev/server";
import type { ScheduleIndex, ScheduleIndexRow } from "@flow-state-dev/scheduled";
import {
  createPostgresStores,
  createPostgresScheduleIndex,
  createPgPoolTx,
  type PostgresStoreRegistry,
  type QueryExecutor
} from "@flow-state-dev/store-postgres";
import type { Pool, PoolConfig } from "pg";
import { vercelPgPoolOptions } from "./pg";

export interface VercelPostgresStoresOptions {
  /**
   * Postgres connection string. Defaults to `FSD_DB_URL` then `DATABASE_URL`.
   * The Neon `Client` swap is applied automatically for `.neon.tech` URLs.
   */
  connectionString?: string;
}

/** A `StoreAdapter` that also exposes a same-pool `ScheduleIndex`. */
export interface VercelPostgresStoresAdapter extends StoreAdapter {
  /**
   * Schedule index bound to the same pool the stores use. Install it behind
   * the app's stable schedule-index proxy (e.g. `setScheduleIndexImpl`) so
   * scheduled flows resolve against the same database. No-ops until the pool
   * is resolved on first `getRouter()` / `ready()`.
   */
  readonly scheduleIndex: ScheduleIndex;
}

const NOOP_INDEX: ScheduleIndex = {
  async upsert() {},
  async claimDue() {
    return [];
  },
  async remove() {}
};

export function vercelPostgresStores(
  options: VercelPostgresStoresOptions = {}
): VercelPostgresStoresAdapter {
  let registry: PostgresStoreRegistry | undefined;
  let realIndex: ScheduleIndex | undefined;
  let building: Promise<PostgresStoreRegistry> | undefined;

  async function build(): Promise<PostgresStoreRegistry> {
    const connectionString =
      options.connectionString ??
      process.env.FSD_DB_URL ??
      process.env.DATABASE_URL;
    if (connectionString === undefined || connectionString.length === 0) {
      throw new Error(
        "vercelPostgresStores: no connection string. Set FSD_DB_URL / DATABASE_URL " +
          "or pass { connectionString }."
      );
    }

    const poolConfig: PoolConfig = {
      connectionString,
      ...vercelPgPoolOptions
    };

    // Neon's WebSocket Client trims the 1–3s wake-up latency the default pg
    // driver pays on the first request against an auto-suspended endpoint.
    if (connectionString.includes(".neon.tech")) {
      const { Client } = await import("@neondatabase/serverless");
      poolConfig.Client = Client as unknown as PoolConfig["Client"];
    }

    const { default: pg } = await import("pg");
    const pool: Pool = new pg.Pool(poolConfig);
    // A pool with no 'error' listener crashes the process on a dead-socket
    // event from an auto-suspended endpoint.
    pool.on("error", () => {});

    // Same-pool executor so the schedule index shares connections with the
    // stores rather than opening a second pool.
    const executor: QueryExecutor = {
      async query(text: string, values?: unknown[]) {
        const result = await pool.query(text, values);
        return {
          rows: result.rows as Record<string, unknown>[],
          rowCount: result.rowCount ?? 0
        };
      },
      async beginTx() {
        return createPgPoolTx(pool);
      }
    };
    realIndex = createPostgresScheduleIndex(executor);

    registry = await createPostgresStores({
      pool,
      // Migrations run out-of-band at build (vercel-build), so the runtime
      // pool skips the DDL roundtrips and advisory-lock dance on cold start.
      skipSchemaInit: true,
      // Neon's pooled endpoint can't hold a usable LISTEN session; force the
      // store's polling fallback.
      liveTailPool: null
    });
    return registry;
  }

  const scheduleIndex: ScheduleIndex = {
    upsert: (row: ScheduleIndexRow) => (realIndex ?? NOOP_INDEX).upsert(row),
    claimDue: (now: number, limit?: number) =>
      (realIndex ?? NOOP_INDEX).claimDue(now, limit),
    remove: (userId: string, key: string) =>
      (realIndex ?? NOOP_INDEX).remove(userId, key)
  };

  return {
    capabilities: ["primary", "scheduler"],
    resolve() {
      building ??= build();
      return building;
    },
    async dispose() {
      await registry?.close();
    },
    scheduleIndex
  };
}
