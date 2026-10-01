/**
 * Lease-store conformance on the Postgres lease store (PGlite).
 */
import type { PGlite } from "@electric-sql/pglite";
import { createLeaseStoreConformanceTests } from "@flow-state-dev/engine/testing";
import { createPostgresLeaseStore, initializeSchema, type QueryExecutor } from "../src";
import { freshPglite } from "./shared-pglite";

function pgliteExecutor(pg: PGlite): QueryExecutor {
  return {
    async query(text: string, values?: unknown[]) {
      const result = await pg.query(text, values);
      return {
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.affectedRows ?? 0
      };
    }
  };
}

createLeaseStoreConformanceTests({
  name: "Postgres (pglite)",
  createStore: async () => {
    const executor = pgliteExecutor(await freshPglite());
    await initializeSchema(executor);
    return createPostgresLeaseStore(executor);
  }
});
