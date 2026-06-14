/**
 * Deploy-time migration runner (FIX-772).
 *
 * Composes the two schema mechanisms against a real Postgres `DATABASE_URL`:
 *   1. the framework's `public.*` store schema (idempotent, advisory-locked),
 *      run by constructing `createPostgresStores` once; and
 *   2. the app-owned `app.*` tables, applied with the committed Drizzle
 *      migrations.
 *
 * Local dev does NOT use this — it runs on embedded PGlite and applies the
 * `app.*` migrations in process (see `lib/portfolio-db.ts`). So with no DB URL
 * set, this exits cleanly (the `apps/kitchen-sink/scripts/migrate.ts` posture).
 *
 * Wire it as the deploy/release step (e.g. a Railway pre-deploy command):
 *   pnpm --filter @flow-state-dev/trading-desk migrate
 */
import path from "node:path";
import { createPostgresStores } from "@flow-state-dev/store-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const url = process.env.FSD_DB_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.log(
    "[migrate] No FSD_DB_URL/DATABASE_URL set — skipping (local dev uses embedded PGlite).",
  );
  process.exit(0);
}

const pool = new Pool({ connectionString: url });
try {
  // Framework public.* schema: constructing the store runs its idempotent init.
  await createPostgresStores({ pool });
  // App-owned app.* tables: versioned, ordered migrations.
  await migrate(drizzle(pool), {
    migrationsFolder: path.join(process.cwd(), "src", "db", "migrations"),
  });
  console.log("[migrate] Framework + app schema up to date.");
} catch (error) {
  console.error("[migrate] Failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
