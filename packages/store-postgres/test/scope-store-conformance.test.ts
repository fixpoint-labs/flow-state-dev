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
import type { PGlite } from "@electric-sql/pglite";
import { createScopeStoreConformanceTests } from "@flow-state-dev/engine/testing";
import { createPostgresStores, type QueryExecutor } from "../src";
import { freshPglite } from "./shared-pglite";

// Every case, the shared pair included, runs on this file's one PGlite with
// an empty schema; `shared-pglite` closes it after the last case.

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

createScopeStoreConformanceTests({
  name: "PostgresSessionStore",
  createStore: async () => {
    const stores = await createPostgresStores({ executor: pgliteExecutor(await freshPglite()) });
    return stores.session;
  },
  createSharedPair: async () => {
    const executor = pgliteExecutor(await freshPglite());
    const a = await createPostgresStores({ executor });
    const b = await createPostgresStores({ executor });
    return { a: a.session, b: b.session };
  }
});
