/**
 * The read across an owner's sessions, store half, on Postgres (PGlite). The
 * executor the resource-state store gets records every statement, so the
 * suite can check a page is one statement that reads from `sessions`.
 */
import { createAcrossSessionsConformanceTests } from "@flow-state-dev/engine/testing";
import {
  createPostgresResourceStateStore,
  createPostgresSessionStore,
  initializeSchema,
  type QueryExecutor
} from "../src/host";
import { freshPglite } from "./shared-pglite";

createAcrossSessionsConformanceTests({
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
    return {
      sessions: createPostgresSessionStore(executor),
      resourceState: createPostgresResourceStateStore(recording),
      statements
    };
  }
});
