/**
 * Integration test for the shared Postgres backing (FIX-772).
 *
 * The load-bearing claim of the store swap: the framework store
 * (`@flow-state-dev/store-postgres`, the `public.*` tables) and the app-owned
 * portfolio repository (the `app.*` tables) run on ONE backing. This test
 * reconstructs the dev (PGlite) wiring `db/portfolio-db.ts` builds — one PGlite
 * instance, the app migrations applied, a `QueryExecutor` handed to
 * `createPostgresStores` — and asserts both schemas coexist and are writable on
 * the same database.
 *
 * Uses an in-memory PGlite (no persisted dir, no Docker), mirroring the store's
 * own `{ executor }` test precedent.
 */
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { createPostgresStores, type QueryExecutor } from "@flow-state-dev/store-postgres";
import { describe, expect, it } from "vitest";
import { createMigratedPgliteDb } from "@/db/client";
import { createPortfolioRepository } from "@/db/repository";

const MIGRATIONS_DIR = fileURLToPath(new URL("../db/migrations", import.meta.url));

describe("shared portfolio backing", () => {
  it("runs the framework store and the app repository on one PGlite backing", async () => {
    const pglite = new PGlite();

    // App side: Drizzle handle + app.* migrations.
    const repo = createPortfolioRepository(await createMigratedPgliteDb(pglite, MIGRATIONS_DIR));

    // Framework side: the same PGlite, wrapped as a QueryExecutor, inits public.*.
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

    // The app repository writes to app.* on the shared backing.
    await repo.upsertAccount({ id: "acc-1", userId: "devuser", name: "Taxable", type: "taxable" });
    const portfolio = await repo.getPortfolio("devuser");
    expect(portfolio.accounts.map((a) => a.accountId)).toEqual(["acc-1"]);

    // Both schemas live in the same database: app.accounts/holdings (app side)
    // and a framework table (public.sessions) created by the store init.
    const tables = await pglite.query<{ table_schema: string; table_name: string }>(
      `SELECT table_schema, table_name FROM information_schema.tables
       WHERE (table_schema = 'app' AND table_name IN ('accounts', 'holdings'))
          OR (table_schema = 'public' AND table_name = 'sessions')`,
    );
    const present = new Set(tables.rows.map((r) => `${r.table_schema}.${r.table_name}`));
    expect(present).toContain("app.accounts");
    expect(present).toContain("app.holdings");
    expect(present).toContain("public.sessions");

    await stores.close();
  });
});
