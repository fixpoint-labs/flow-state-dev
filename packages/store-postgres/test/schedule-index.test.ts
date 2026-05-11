/**
 * Tests for `createPostgresScheduleIndex` against a PGlite-backed
 * executor. Verifies the contract through the shared conformance
 * suite, plus a Postgres-specific check that `beginTx` is required.
 */
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createScheduleIndexConformanceTests } from "@flow-state-dev/scheduled/testing";
import { createPostgresScheduleIndex } from "../src/schedule-index";
import { createSingleConnectionTx } from "../src/tx";
import { initializeSchema } from "../src/schema";
import type { QueryExecutor } from "../src/types";

function pgliteExecutor(pg: PGlite): QueryExecutor {
  return {
    async query(text: string, values?: unknown[]) {
      const result = await pg.query(text, values);
      return {
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.affectedRows ?? 0
      };
    },
    async beginTx() {
      return createSingleConnectionTx(async (text, values) => {
        const result = await pg.query(text, values);
        return {
          rows: result.rows as Record<string, unknown>[],
          rowCount: result.affectedRows ?? 0
        };
      });
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

describe("createPostgresScheduleIndex", () => {
  it("throws when executor.beginTx is missing", () => {
    const bareExecutor: QueryExecutor = {
      async query() {
        return { rows: [], rowCount: 0 };
      }
    };
    expect(() => createPostgresScheduleIndex(bareExecutor)).toThrow(/beginTx/);
  });
});
