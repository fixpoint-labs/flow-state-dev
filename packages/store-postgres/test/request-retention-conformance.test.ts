/**
 * Retention reused-id conformance on the Postgres stores (PGlite): a request
 * id freed by retention must not carry its previous run's stream events to a
 * new owner.
 */
import type { PGlite } from "@electric-sql/pglite";
import { createRequestRetentionConformanceTests } from "@flow-state-dev/engine/testing";
import { createPostgresStores, type QueryExecutor } from "../src";
import { freshPglite } from "./shared-pglite";

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

createRequestRetentionConformanceTests({
  name: "Postgres stores",
  createStores: async () => createPostgresStores({ executor: pgliteExecutor(await freshPglite()) })
});
