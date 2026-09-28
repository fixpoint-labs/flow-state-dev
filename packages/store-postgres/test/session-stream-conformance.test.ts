/**
 * The session stream's conformance suite on Postgres, over PGlite. The suite is
 * the engine's; this file supplies the backends. The shared pair is two
 * registries over one database: two servers on one database, which is the
 * arrangement the stream exists to serve.
 */
import type { PGlite } from "@electric-sql/pglite";
import { createSessionStreamConformanceTests } from "@flow-state-dev/engine/testing";
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

createSessionStreamConformanceTests({
  name: "Postgres",
  createStores: async () =>
    createPostgresStores({ executor: pgliteExecutor(await freshPglite()) }),
  createSharedPair: async () => {
    const executor = pgliteExecutor(await freshPglite());
    return {
      a: await createPostgresStores({ executor }),
      b: await createPostgresStores({ executor })
    };
  },
  itemsReadableWhileRunning: true
});
