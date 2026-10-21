/**
 * Wake-store conformance (FIX-2078 D1) on the Postgres wake store, over
 * PGlite: a single connection, so racing writers' statements interleave and
 * the coalescing has to hold in the one upsert.
 */
import type { PGlite } from "@electric-sql/pglite";
import { createWakeStoreConformanceTests } from "@flow-state-dev/engine/testing";
import { createPostgresWakeStore, initializeSchema, type QueryExecutor } from "../src";
import { freshPglite } from "./shared-pglite";

function pgliteExecutor(pg: PGlite): QueryExecutor {
  return {
    async query(text: string, values?: unknown[]) {
      const result = await pg.query(text, values);
      return { rows: result.rows as Record<string, unknown>[], rowCount: result.affectedRows ?? 0 };
    }
  };
}

createWakeStoreConformanceTests({
  name: "Postgres (pglite)",
  createStore: async () => {
    const executor = pgliteExecutor(await freshPglite());
    await initializeSchema(executor);
    return createPostgresWakeStore(executor);
  }
});
