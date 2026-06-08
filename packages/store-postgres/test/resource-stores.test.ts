/**
 * FIX-687: runs the shared keyed-resource-store conformance suites against the
 * Postgres `ContentStore` and `ResourceStateStore`. These adapters were already
 * durable (the SQLite work that introduced the shared suites is the reference's
 * mirror); wiring Postgres into the same cases keeps both adapters honest about
 * scoped reads, last-write-wins, literal prefix matching, and scope isolation.
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

async function cleanupAll(): Promise<void> {
  while (pglites.length > 0) {
    const pglite = pglites.pop();
    await pglite?.close();
  }
}

createContentStoreConformanceTests({
  name: "PostgresContentStore",
  createStore: async () => createPostgresContentStore(await freshExecutor()),
  cleanup: cleanupAll
});

createResourceStateStoreConformanceTests({
  name: "PostgresResourceStateStore",
  createStore: async () => createPostgresResourceStateStore(await freshExecutor()),
  cleanup: cleanupAll
});
