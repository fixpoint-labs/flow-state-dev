/**
 * getByPrefixPaged conformance for the Postgres content and resource-state
 * stores, run against the indexed SQL keyset implementation via PGlite.
 *
 * Mirrors the `pglite-request-subscribe` wiring: each conformance case gets a
 * fresh PGlite with the schema applied, so the paging cases start from an
 * empty `resource_content` / `resource_state` table.
 */
import { PGlite } from "@electric-sql/pglite";
import {
  createPostgresContentStore,
  createPostgresResourceStateStore,
  initializeSchema,
  type QueryExecutor
} from "../src";
import {
  createContentStoreConformanceTests,
  createResourceStateStoreConformanceTests
} from "@flow-state-dev/server/testing";

const pglites: PGlite[] = [];

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

async function freshExecutor(): Promise<QueryExecutor> {
  const pglite = new PGlite();
  pglites.push(pglite);
  const executor = pgliteExecutor(pglite);
  await initializeSchema(executor);
  return executor;
}

async function cleanup(): Promise<void> {
  while (pglites.length > 0) {
    const pglite = pglites.pop();
    await pglite?.close();
  }
}

createContentStoreConformanceTests({
  name: "PostgresContentStore",
  createStore: async () => createPostgresContentStore(await freshExecutor()),
  cleanup
});

createResourceStateStoreConformanceTests({
  name: "PostgresResourceStateStore",
  createStore: async () => createPostgresResourceStateStore(await freshExecutor()),
  cleanup
});
