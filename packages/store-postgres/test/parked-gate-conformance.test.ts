/**
 * A park writes its gate to the request's item log, on the Postgres stores
 * (PGlite).
 */
import { createParkedGateConformanceTests } from "@flow-state-dev/engine/testing";
import { createPostgresStores, type QueryExecutor } from "../src";
import { freshPglite } from "./shared-pglite";

createParkedGateConformanceTests({
  name: "Postgres",
  createStores: async () => {
    const pglite = await freshPglite();
    const executor: QueryExecutor = {
      async query(text: string, values?: unknown[]) {
        const result = await pglite.query(text, values);
        return { rows: result.rows as Record<string, unknown>[], rowCount: result.affectedRows ?? 0 };
      }
    };
    return createPostgresStores({ executor });
  }
});
