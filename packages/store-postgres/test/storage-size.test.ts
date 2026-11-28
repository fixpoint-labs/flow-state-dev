/**
 * The Postgres store's size reading on PGlite: the sum of
 * `pg_total_relation_size` over the store's own tables, every one of them, and
 * nothing of a table the app keeps in the same database.
 */
import { describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshPglite } from "./shared-pglite";
import { createPostgresStores } from "../src/host";
import type { QueryExecutor } from "../src/host";
import { storeTableNames } from "../src/schema";

function pgliteExecutor(pglite: PGlite): QueryExecutor {
  return {
    async query(text: string, values?: unknown[]) {
      const result = await pglite.query(text, values);
      return { rows: result.rows as Record<string, unknown>[], rowCount: result.affectedRows ?? 0 };
    }
  };
}

async function relationBytes(pglite: PGlite, tables: string[]): Promise<number> {
  const { rows } = await pglite.query<{ bytes: string }>(
    "SELECT COALESCE(SUM(pg_total_relation_size(quote_ident(t)::regclass)), 0)::text AS bytes FROM unnest($1::text[]) AS t",
    [tables]
  );
  return Number(rows[0]!.bytes);
}

describe("Postgres storageSize", () => {
  it("names every table the schema creates", async () => {
    const pglite = await freshPglite();
    const stores = await createPostgresStores({ executor: pgliteExecutor(pglite) });
    const { rows } = await pglite.query<{ name: string }>(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema()"
    );

    expect([...storeTableNames()].sort()).toEqual(rows.map((r) => r.name).sort());
    await stores.close();
  });

  it("is the total relation size of the store's tables, and grows with writes", async () => {
    const pglite = await freshPglite();
    const stores = await createPostgresStores({ executor: pgliteExecutor(pglite) });
    const before = await stores.storageSize!();
    const now = Date.now();
    for (let i = 0; i < 50; i++) {
      await stores.session.set(
        `sess_${i}`,
        { id: `sess_${i}`, flowKind: "f", userId: "u", orgId: "o", state: { pad: "x".repeat(4000) }, version: 0, createdAt: now, updatedAt: now, journal: [] },
        "any"
      );
    }
    const after = await stores.storageSize!();

    expect(after.kind).toBe("postgres");
    expect(typeof after.location).toBe("string");
    expect(after.bytes).toBe(await relationBytes(pglite, storeTableNames()));
    expect(after.bytes).toBeGreaterThan(before.bytes);
    await stores.close();
  });

  it("leaves out a table the app keeps in the same database", async () => {
    const pglite = await freshPglite();
    const stores = await createPostgresStores({ executor: pgliteExecutor(pglite) });
    const before = (await stores.storageSize!()).bytes;
    await pglite.exec("CREATE TABLE app_things (body text); INSERT INTO app_things SELECT repeat('y', 5000) FROM generate_series(1, 200);");

    expect((await stores.storageSize!()).bytes).toBe(before);
    await stores.close();
  });

  it("counts a table not created yet as 0", async () => {
    const pglite = await freshPglite();
    const stores = await createPostgresStores({ executor: pgliteExecutor(pglite), skipSchemaInit: true });

    expect((await stores.storageSize!()).bytes).toBe(0);
    await stores.close();
  });
});
