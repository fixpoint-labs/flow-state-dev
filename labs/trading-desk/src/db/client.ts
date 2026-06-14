/**
 * Drizzle client factory for the app-owned portfolio tables (FIX-772).
 *
 * The trading-desk runs on two Postgres drivers depending on environment:
 * embedded PGlite in local dev (no Docker) and a real `pg.Pool` in deployment.
 * Drizzle's query API is identical across both, so the repository is written
 * once against a single `Db` type. The driver-specific seams live here: the
 * pglite instance is narrowed to the canonical `Db` type, and the in-process
 * dev migration (which the deploy path runs out-of-band instead) is applied
 * through the pglite migrator.
 */
import type { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzleNodePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { Pool } from "pg";
import * as schema from "./schema";

/**
 * The canonical Drizzle handle the repository is typed against. Both drivers
 * produce a structurally identical query surface; the node-postgres type is the
 * representative (the pglite instance is narrowed to it).
 */
export type Db = NodePgDatabase<typeof schema>;

/** Build a Drizzle handle over a shared `pg.Pool` (deployment). Migrations run
 *  out-of-band via `scripts/migrate.ts`, so this does not migrate. */
export function createDb(pool: Pool): Db {
  return drizzleNodePg(pool, { schema });
}

/**
 * Build a Drizzle handle over an embedded PGlite instance (local dev / tests)
 * and apply the committed `app.*` migrations in-process first. PGlite's query
 * surface matches node-postgres, so the handle is narrowed to the canonical
 * `Db` type and the repository never branches on driver.
 */
export async function createMigratedPgliteDb(
  pglite: PGlite,
  migrationsFolder: string,
): Promise<Db> {
  const db = drizzlePglite(pglite, { schema });
  await migratePglite(db, { migrationsFolder });
  return db as unknown as Db;
}
