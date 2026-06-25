/**
 * The shared Postgres backing for the trading-desk (FIX-772).
 *
 * One backing, chosen by environment, serves BOTH the framework store
 * (`@flow-state-dev/store-postgres`, the `public.*` tables) and the app-owned
 * portfolio repository (the `app.*` tables):
 *
 *   - Deployment (`DATABASE_URL` / `FSD_DB_URL` set): a single host-owned
 *     `pg.Pool` is handed to `createPostgresStores({ pool })` AND to the Drizzle
 *     repository, so both share one connection budget (the
 *     `packages/vercel/src/store.ts` precedent). App migrations run out-of-band
 *     via `scripts/migrate.ts`.
 *   - Local dev (no DB URL): a single embedded PGlite instance — Postgres in
 *     WASM, persisted to a gitignored dir so data survives restarts, no Docker.
 *     The store gets a PGlite `QueryExecutor`; the repository gets a Drizzle
 *     handle over the same instance with the `app.*` migrations applied in
 *     process.
 *
 * Memoized: the pool / PGlite instance, the store backing, and the repository
 * are created exactly once per process.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { StoreAdapter } from "@flow-state-dev/engine";
import {
  createPostgresStores,
  type PostgresStoreOptions,
  type QueryExecutor,
} from "@flow-state-dev/store-postgres";
import { Pool } from "pg";
import { createDb, createMigratedPgliteDb } from "@/src/db/client";
import { createPortfolioRepository, type PortfolioRepository } from "@/src/db/repository";

type Backing = {
  /** Options handed to `createPostgresStores` so the FSD store shares this backing. */
  storesOptions: PostgresStoreOptions;
  /** The portfolio repository over the same backing. */
  repository: PortfolioRepository;
};

/** Where the embedded PGlite dev database lives. Under `.fsdev/` so the root
 *  `.gitignore`'s `**​/.fsdev/**` rule covers it (the filesystem store's old home).
 *
 *  `TRADING_DESK_DATA_DIR` overrides the location. PGlite is single-process —
 *  concurrent `fsdev run` children cannot share one data dir — so the headless
 *  BATCH harness points each run at its own temp dir via this env var to run
 *  them concurrently without contention. Unset (single runs, the app) → the
 *  shared default, so those runs appear in Past Reports. */
const PGLITE_DATA_DIR =
  process.env.TRADING_DESK_DATA_DIR ?? path.join(process.cwd(), ".fsdev", "pglite");
/** Committed `app.*` migrations, read at runtime by the in-process dev migrator. */
const MIGRATIONS_DIR = path.join(process.cwd(), "src", "db", "migrations");

function databaseUrl(): string | undefined {
  return process.env.FSD_DB_URL ?? process.env.DATABASE_URL;
}

async function buildBacking(): Promise<Backing> {
  const url = databaseUrl();
  if (url) {
    const pool = new Pool({ connectionString: url, max: 10 });
    // node-postgres emits 'error' on the Pool when an *idle* client drops (a
    // Postgres restart, a TCP/idle timeout). With no listener that surfaces as
    // an unhandled EventEmitter error and takes the whole process down — and
    // this pool is long-lived on a persistent server. Log and swallow: the pool
    // discards the dead client and the next checkout gets a fresh one.
    pool.on("error", (err) => {
      console.error("[portfolio-db] idle pool client error:", err);
    });
    return {
      // Deploy runs `scripts/migrate.ts` as a pre-deploy step, so the framework
      // `public.*` schema already exists: skip the runtime init. This avoids
      // repeating the advisory-lock DDL on every cold start across pooled
      // connections (the kitchen-sink / Vercel deploy posture). The dev PGlite
      // branch below keeps init on — it has no separate framework migrate step.
      storesOptions: { pool, liveTailPool: null, skipSchemaInit: true },
      repository: createPortfolioRepository(createDb(pool)),
    };
  }
  const pglite = new PGlite(PGLITE_DATA_DIR);
  const db = await createMigratedPgliteDb(pglite, MIGRATIONS_DIR);
  const executor: QueryExecutor = {
    async query(text, values) {
      const result = await pglite.query(text, values as unknown[]);
      return {
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.affectedRows ?? 0,
      };
    },
  };
  return { storesOptions: { executor }, repository: createPortfolioRepository(db) };
}

let backingPromise: Promise<Backing> | null = null;

/** The shared store backing + repository, built once per process. */
export function getBacking(): Promise<Backing> {
  backingPromise ??= buildBacking();
  return backingPromise;
}

/** The portfolio repository — the single source of truth for accounts and
 *  holdings. Server-only; called by action handlers, the analysis seed, and the
 *  read API route. */
export async function getRepository(): Promise<PortfolioRepository> {
  return (await getBacking()).repository;
}

/**
 * Framework store adapter for `createFlowState` (FIX-772) — realizes the FSD
 * store over the shared backing. The runtime calls `resolve()` lazily on first
 * use (first `getRouter()` / `ready()`), so the Postgres/PGlite init and the
 * `app.*` migrations happen then, not at config-module load. The app repository
 * shares the same backing via `getBacking`'s memoization, so the store and the
 * portfolio tables live on one pool / PGlite instance.
 */
let resolvedStores: Awaited<ReturnType<typeof createPostgresStores>> | null = null;
export const portfolioStoreAdapter: StoreAdapter = {
  capabilities: ["primary"],
  async resolve() {
    const { storesOptions } = await getBacking();
    resolvedStores = await createPostgresStores(storesOptions);
    return resolvedStores;
  },
  async dispose() {
    await resolvedStores?.close();
  },
};
