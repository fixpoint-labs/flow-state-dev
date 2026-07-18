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
 * `app.*` migrations in process (see `db/portfolio-db.ts`). So with no DB URL
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
import { createDb } from "@/db/client";
import { createPortfolioRepository } from "@/db/repository";
import { FRESH_START_MARKER } from "@/db/schema";
import { assertFreshStartRollout } from "@/db/fresh-start-gate";

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
  // App-owned app.* tables: versioned, ordered migrations. Uses drizzle's
  // default `drizzle.__drizzle_migrations` journal — the dev migrator and
  // `drizzle.config.ts` agree on it, so there is a single journal location.
  // The journal stays out of `app` because migration 0000 runs
  // `CREATE SCHEMA "app"` and must not collide with a pre-created schema.
  await migrate(drizzle(pool), {
    migrationsFolder: path.join(process.cwd(), "db", "migrations"),
  });
  // Fresh-start rollout gate (FIX-895): the lot-identity fingerprint recipe
  // (`|lk|ck|`, now unconditional) is only safe on a cleared ledger. Refuse to
  // bring it up against legacy rows that predate the wipe — the operator must run
  // `pnpm --filter @flow-state-dev/trading-desk ledger-reset` first, which
  // truncates the ledger-derived tables and stamps the marker checked here. A
  // genuinely fresh deploy (empty ledger) passes; a post-wipe ledger (marker
  // present) passes. Runs before the backfill so it fails fast.
  const legacyCount = Number(
    (await pool.query('SELECT count(*)::text AS count FROM "app"."ledger_events"')).rows[0].count,
  );
  const hasMarker =
    ((
      await pool.query('SELECT 1 FROM "app"."rollout_markers" WHERE "marker" = $1', [
        FRESH_START_MARKER,
      ])
    ).rowCount ?? 0) > 0;
  assertFreshStartRollout(legacyCount, hasMarker);
  // One-time realized-gains rollout (FIX-874): materialize every existing
  // account's realized gains, so history isn't empty until an unrelated mutation
  // touches each account. Idempotent (delete-then-reinsert under a per-account
  // advisory lock), so it's safe to run on every deploy.
  await createPortfolioRepository(createDb(pool)).backfillRealizedGains();
  console.log("[migrate] Framework + app schema up to date; realized gains backfilled.");
} catch (error) {
  console.error("[migrate] Failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
