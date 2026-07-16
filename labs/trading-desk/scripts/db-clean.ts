/**
 * Dev database reset (`pnpm --filter @flow-state-dev/trading-desk db:clean`).
 *
 * Wipes the embedded PGlite dev database (`.fsdev/pglite` — both the framework
 * `public.*` store tables and the app-owned `app.*` portfolio tables live in
 * it) and regenerates a fresh, fully-migrated one by running the SAME two init
 * paths the dev server runs on first use: the committed Drizzle `app.*`
 * migrations and the framework store's idempotent schema init.
 *
 * Dev-only by design: with FSD_DB_URL/DATABASE_URL set the backing is a real
 * Postgres — wiping that is a destructive operation this script refuses to
 * perform. Stop the dev server first: PGlite is single-connection, so a live
 * server holding the old directory open would corrupt both instances.
 */
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createPostgresStores, type QueryExecutor } from "@flow-state-dev/store-postgres";
import { createMigratedPgliteDb } from "../db/client";

if (process.env.FSD_DB_URL ?? process.env.DATABASE_URL) {
  console.error(
    "[db:clean] FSD_DB_URL/DATABASE_URL is set — this script only resets the embedded PGlite dev database, never a real Postgres. Unset it to proceed.",
  );
  process.exit(1);
}

// Keep in sync with PGLITE_DATA_DIR in db/portfolio-db.ts.
const dataDir = path.join(process.cwd(), ".fsdev", "pglite");

rmSync(dataDir, { recursive: true, force: true });
console.log(`[db:clean] Wiped ${path.relative(process.cwd(), dataDir)}.`);

// PGlite's NodeFS mkdirs only the leaf data dir (non-recursive), so ensure the
// `.fsdev/` parent exists — same guard as db/portfolio-db.ts.
mkdirSync(dataDir, { recursive: true });
const pglite = new PGlite(dataDir);
await createMigratedPgliteDb(pglite, path.join(process.cwd(), "db", "migrations"));
const executor: QueryExecutor = {
  async query(text, values) {
    const result = await pglite.query(text, values as unknown[]);
    return {
      rows: result.rows as Record<string, unknown>[],
      rowCount: result.affectedRows ?? 0,
    };
  },
};
const stores = await createPostgresStores({ executor });
await stores.close();
await pglite.close();
console.log("[db:clean] Fresh database generated (app.* migrations + framework store schema).");
