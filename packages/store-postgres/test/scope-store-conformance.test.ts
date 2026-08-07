/**
 * Postgres adapter compliance with the shared scope-store CAS contract
 * (FIX-1007).
 *
 * The suite is the engine's; this file only supplies the backends. The
 * cross-connection pair is two `PostgresStoreRegistry` instances over one
 * PGlite database — the same "simulates two nodes" arrangement
 * `cas-contract.test.ts` uses, and what makes the `ON CONFLICT (id) DO
 * NOTHING` insert the thing actually deciding the create race rather than a
 * read-then-insert in front of it.
 */
import { afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createScopeStoreConformanceTests } from "@flow-state-dev/engine/testing";
import { createPostgresStores, type QueryExecutor } from "../src";

const pglites: PGlite[] = [];

function freshPglite(): PGlite {
  const pglite = new PGlite();
  pglites.push(pglite);
  return pglite;
}

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

afterAll(async () => {
  await Promise.all(pglites.map((pglite) => pglite.close()));
});

createScopeStoreConformanceTests({
  name: "PostgresSessionStore",
  createStore: async () => {
    const stores = await createPostgresStores({ executor: pgliteExecutor(freshPglite()) });
    return stores.session;
  },
  createSharedPair: async () => {
    const executor = pgliteExecutor(freshPglite());
    const a = await createPostgresStores({ executor });
    const b = await createPostgresStores({ executor });
    return { a: a.session, b: b.session };
  }
});
