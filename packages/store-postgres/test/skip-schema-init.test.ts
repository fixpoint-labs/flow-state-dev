/**
 * Verifies that `skipSchemaInit: true` actually skips DDL execution.
 *
 * Regression guard: the option exists so deploys that run migrations
 * out-of-band (e.g. as a build step) can avoid the per-cold-start
 * advisory-lock + idempotent-DDL cost. If a future refactor accidentally
 * removes the gate, the option silently becomes a no-op and runtime cost
 * comes back.
 */
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createPostgresStores } from "../src";
import type { QueryExecutor } from "../src";

function pgliteExecutor(pglite: PGlite): QueryExecutor {
  return {
    async query(text: string, values?: unknown[]) {
      const result = await pglite.query(text, values);
      return {
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.affectedRows ?? 0
      };
    }
  };
}

async function tableExists(pglite: PGlite, table: string): Promise<boolean> {
  const result = await pglite.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = $1
     ) AS exists`,
    [table]
  );
  return result.rows[0]?.exists === true;
}

describe("createPostgresStores — skipSchemaInit", () => {
  it("creates tables when skipSchemaInit is omitted (default)", async () => {
    const pglite = new PGlite();
    const stores = await createPostgresStores({ executor: pgliteExecutor(pglite) });
    expect(await tableExists(pglite, "sessions")).toBe(true);
    expect(await tableExists(pglite, "orgs")).toBe(true);
    await stores.close();
    await pglite.close();
  });

  it("does NOT create tables when skipSchemaInit is true", async () => {
    const pglite = new PGlite();
    const stores = await createPostgresStores({
      executor: pgliteExecutor(pglite),
      skipSchemaInit: true
    });
    expect(await tableExists(pglite, "sessions")).toBe(false);
    expect(await tableExists(pglite, "orgs")).toBe(false);
    await stores.close();
    await pglite.close();
  });
});
