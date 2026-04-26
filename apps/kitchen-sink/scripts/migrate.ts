#!/usr/bin/env -S tsx
/**
 * Build-time Postgres schema migration for kitchen-sink.
 *
 * Why this exists: by default `createPostgresStores()` runs ~30 idempotent
 * `CREATE TABLE/INDEX IF NOT EXISTS` statements plus an advisory-lock dance on
 * every call. On Vercel that's once per cold start, adding latency to the first
 * request after the function spins up. Running migration once at build time and
 * passing `skipSchemaInit: true` at runtime removes that cost.
 *
 * Why .ts + tsx (not plain .mjs): the workspace's compiled package output uses
 * extensionless relative imports (TS's `moduleResolution: bundler` lets that
 * fly, but raw Node ESM does not). tsx applies bundler-style resolution at
 * runtime so we can `import { createPostgresStores }` without rewriting the
 * package's emit format.
 *
 * Behavior:
 * - No `FSD_DB_URL` / `DATABASE_URL` in the environment → exits 0 quietly.
 *   This keeps preview deploys without a database wired up from failing the
 *   build, and avoids surprises in local builds without the env loaded.
 * - DB URL set → opens a pool, runs schema init via `createPostgresStores`,
 *   tears the pool down, exits 0 on success / non-zero on failure.
 *
 * Run via `pnpm --filter @flow-state-dev/kitchen-sink migrate` or as part of
 * `vercel-build`.
 */
import { createPostgresStores } from "@flow-state-dev/store-postgres";

const dbUrl = process.env.FSD_DB_URL ?? process.env.DATABASE_URL;
if (!dbUrl) {
  console.log("[migrate] No FSD_DB_URL/DATABASE_URL set — skipping schema init.");
  process.exit(0);
}

console.log("[migrate] Initializing Postgres schema…");
const start = Date.now();
const stores = await createPostgresStores({ connectionString: dbUrl });
await stores.close();
console.log(`[migrate] Done in ${Date.now() - start}ms.`);
