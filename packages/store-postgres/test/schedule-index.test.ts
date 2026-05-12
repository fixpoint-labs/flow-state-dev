/**
 * Tests for `createPostgresScheduleIndex` against a PGlite-backed
 * executor. Verifies the contract through the shared conformance suite.
 */
import { PGlite } from "@electric-sql/pglite";
import { createScheduleIndexConformanceTests } from "@flow-state-dev/scheduled/testing";
import { createPostgresScheduleIndex } from "../src/schedule-index";
import { initializeSchema } from "../src/schema";
import type { QueryExecutor, TxClient } from "../src/types";

function pgliteExecutor(pg: PGlite): QueryExecutor {
  async function query(text: string, values?: unknown[]) {
    const result = await pg.query(text, values);
    return {
      rows: result.rows as Record<string, unknown>[],
      rowCount: result.affectedRows ?? 0
    };
  }
  return {
    query,
    async beginTx(): Promise<TxClient> {
      await query("BEGIN");
      let settled = false;
      return {
        query,
        async commit() {
          if (settled) return;
          settled = true;
          await query("COMMIT");
        },
        async rollback() {
          if (settled) return;
          settled = true;
          await query("ROLLBACK");
        }
      };
    }
  };
}

// Each conformance test gets a fresh PGlite. We retain the executor's
// PGlite handle on a WeakMap so cleanup can close it.
const handles = new WeakMap<object, PGlite>();

createScheduleIndexConformanceTests("postgres (pglite)", {
  async createIndex() {
    const pg = new PGlite();
    const executor = pgliteExecutor(pg);
    await initializeSchema(executor);
    const idx = createPostgresScheduleIndex(executor);
    handles.set(idx as object, pg);
    return idx;
  },
  async cleanup(idx) {
    const pg = handles.get(idx as object);
    if (pg) await pg.close();
  }
});
