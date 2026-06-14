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
import type { PostgresStoreOptions, QueryExecutor } from "@flow-state-dev/store-postgres";
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
 *  `.gitignore`'s `**​/.fsdev/**` rule covers it (the filesystem store's old home). */
const PGLITE_DATA_DIR = path.join(process.cwd(), ".fsdev", "pglite");
/** Committed `app.*` migrations, read at runtime by the in-process dev migrator. */
const MIGRATIONS_DIR = path.join(process.cwd(), "src", "db", "migrations");

function databaseUrl(): string | undefined {
  return process.env.FSD_DB_URL ?? process.env.DATABASE_URL;
}

async function buildBacking(): Promise<Backing> {
  const url = databaseUrl();
  if (url) {
    const pool = new Pool({ connectionString: url, max: 10 });
    return {
      storesOptions: { pool, liveTailPool: null },
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
