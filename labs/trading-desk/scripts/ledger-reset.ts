/**
 * Fresh-start ledger wipe (FIX-895) — `pnpm --filter @flow-state-dev/trading-desk
 * ledger-reset`.
 *
 * The lot-identity work made `computeFingerprint` include the linkage fields
 * (`|lk|ck|`) UNCONDITIONALLY. That recipe is only safe on a CLEARED ledger:
 * legacy rows carry pre-`lk|ck` fingerprints, so re-submitting the same legacy
 * unkeyed event would hash differently and bypass the unique index (a duplicate),
 * and retained unkeyed share rows would refuse tax-lot imports at the one-source
 * seam. So this one-time, operator-run step truncates the ledger-derived tables
 * (`ledger_events` + the tables it materializes: `holdings`, `realized_gains`) and
 * records a `rollout_markers` row PROVING the wipe ran — the deploy migrator
 * (`scripts/migrate.ts`) refuses to bring the new recipe up against un-wiped
 * legacy data unless this marker is present.
 *
 * Snapshot-only holdings (CSV/PDF, no ledger history) are re-imported by the user
 * afterward — the accepted one-time cost of the fresh start.
 *
 * DEPLOY-ONLY. Local dev resets by wiping the whole embedded PGlite database
 * (`pnpm db:clean` → deletes `.fsdev/pglite`), so this script refuses to run
 * without a real `FSD_DB_URL`/`DATABASE_URL` (the inverse of `db:clean`).
 * Idempotent: re-running truncates already-empty tables and re-stamps the marker.
 */
import { Pool } from "pg";
import { FRESH_START_MARKER } from "@/db/schema";

const url = process.env.FSD_DB_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error(
    "[ledger-reset] No FSD_DB_URL/DATABASE_URL set. This wipes a real Postgres ledger; " +
      "local dev resets the embedded PGlite database instead — run `pnpm db:clean`.",
  );
  process.exit(1);
}

const pool = new Pool({ connectionString: url });
try {
  await pool.query("BEGIN");
  // The three tables FK only to `accounts` (not each other), so one TRUNCATE
  // clears them atomically. RESTART IDENTITY is a no-op here (text PKs) but keeps
  // the intent explicit; no CASCADE needed (nothing FKs these three).
  await pool.query(
    'TRUNCATE TABLE "app"."ledger_events", "app"."holdings", "app"."realized_gains" RESTART IDENTITY',
  );
  // Stamp the wipe. ON CONFLICT keeps the script idempotent (re-run re-stamps the
  // applied_at); the migrator only checks for the row's presence.
  await pool.query(
    'INSERT INTO "app"."rollout_markers" ("marker", "applied_at") VALUES ($1, now()) ' +
      'ON CONFLICT ("marker") DO UPDATE SET "applied_at" = now()',
    [FRESH_START_MARKER],
  );
  await pool.query("COMMIT");
  console.log(
    "[ledger-reset] Wiped ledger_events / holdings / realized_gains and stamped the " +
      `fresh-start marker (${FRESH_START_MARKER}). Re-import transaction files afterward.`,
  );
} catch (error) {
  await pool.query("ROLLBACK").catch(() => {});
  console.error("[ledger-reset] Failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
