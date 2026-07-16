/**
 * drizzle-kit configuration for the app-owned portfolio tables (FIX-772).
 *
 * `schemaFilter: ["app"]` scopes every drizzle-kit operation to the app's own
 * Postgres schema, so it never introspects, diffs, or drops the framework's
 * `public.*` store tables that share the same database. Generated migrations and
 * the migration journal both live inside `app`.
 *
 * `db:generate` (the committed-SQL path) does not connect to a database; the
 * `dbCredentials.url` is only consulted by connecting commands (`migrate`/`push`)
 * and falls back to a local placeholder so generation works with no env set.
 *
 * No `migrations` key: the runtime migrators (dev in-process, deploy script)
 * apply migrations using drizzle's default `drizzle.__drizzle_migrations`
 * journal. Pinning the journal to the `app` schema would make the migrator
 * pre-create `app`, colliding with migration 0000's `CREATE SCHEMA "app"`.
 * `schemaFilter` already scopes the app TABLES to `app`; we only run
 * `drizzle-kit generate` (file-based) here, never `drizzle-kit migrate`.
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  schemaFilter: ["app"],
  dbCredentials: {
    url:
      process.env.FSD_DB_URL ??
      process.env.DATABASE_URL ??
      "postgres://localhost:5432/trading_desk",
  },
});
