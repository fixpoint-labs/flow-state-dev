/**
 * Lease-store conformance on the Postgres lease store (PGlite), through two
 * executors: a plain one, and one that implements `beginTx` the way a
 * `pg.Pool`-backed executor does. Acquire must stay exclusive on both.
 *
 * PGlite is a single connection, so the `beginTx` executor's transactions
 * share it: statements from concurrent acquirers interleave the way two
 * READ COMMITTED transactions' statements do when neither holds a row lock,
 * which is the state a `SELECT ... FOR UPDATE` on a missing row leaves.
 */
import type { PGlite } from "@electric-sql/pglite";
import { createLeaseStoreConformanceTests } from "@flow-state-dev/engine/testing";
import { createPostgresLeaseStore, initializeSchema, type QueryExecutor, type TxClient } from "../src";
import { freshPglite } from "./shared-pglite";

function pgliteExecutor(pg: PGlite): QueryExecutor {
  return {
    async query(text: string, values?: unknown[]) {
      const result = await pg.query(text, values);
      return {
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.affectedRows ?? 0
      };
    }
  };
}

function pgliteTxExecutor(pg: PGlite): QueryExecutor {
  const { query } = pgliteExecutor(pg);
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

createLeaseStoreConformanceTests({
  name: "Postgres (pglite)",
  createStore: async () => {
    const executor = pgliteExecutor(await freshPglite());
    await initializeSchema(executor);
    return createPostgresLeaseStore(executor);
  }
});

createLeaseStoreConformanceTests({
  name: "Postgres (pglite, transaction-capable executor)",
  createStore: async () => {
    const executor = pgliteTxExecutor(await freshPglite());
    await initializeSchema(executor);
    return createPostgresLeaseStore(executor);
  }
});
