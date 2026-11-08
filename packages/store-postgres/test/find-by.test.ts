/**
 * `findBy` over a real Postgres registry (PGlite), through `createFlowState`:
 * the shared cross-store cases, plus the ones only a store with index verbs
 * answers (a built index is read without scanning the collection).
 */
import { createFindByConformanceTests } from "@flow-state-dev/engine/testing";
import { createPostgresStores } from "../src/host";
import { freshPglite } from "./shared-pglite";

createFindByConformanceTests({
  name: "Postgres stores",
  indexes: true,
  createStores: async () => {
    const pglite = await freshPglite();
    return createPostgresStores({
      executor: {
        async query(text: string, values?: unknown[]) {
          const result = await pglite.query(text, values);
          return { rows: result.rows as Record<string, unknown>[], rowCount: result.affectedRows ?? 0 };
        },
      },
    });
  },
});
