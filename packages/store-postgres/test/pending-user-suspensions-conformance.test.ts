// FIX-2770.
/**
 * The pending-asks read's conformance on Postgres (PGlite). The executor the
 * suspension store gets records every statement, so the suite can check the
 * read is one statement that joins `requests`.
 */
import { createPendingUserSuspensionsConformanceTests } from "@flow-state-dev/engine/testing";
import { createPostgresRequestStore, createPostgresSuspensionStore, initializeSchema, type QueryExecutor } from "../src/host";
import { freshPglite } from "./shared-pglite";

createPendingUserSuspensionsConformanceTests({
  name: "Postgres (pglite)",
  createStore: async () => {
    const pg = await freshPglite();
    const executor: QueryExecutor = {
      async query(text: string, values?: unknown[]) {
        const result = await pg.query(text, values);
        return { rows: result.rows as Record<string, unknown>[], rowCount: result.affectedRows ?? 0 };
      }
    };
    await initializeSchema(executor);
    const statements: string[] = [];
    const recording: QueryExecutor = {
      query(text, values) {
        statements.push(text);
        return executor.query(text, values);
      }
    };
    return { requests: createPostgresRequestStore(executor), suspensions: createPostgresSuspensionStore(recording), statements };
  }
});
