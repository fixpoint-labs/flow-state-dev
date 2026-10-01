/**
 * Regression guard: Postgres lease acquire stays exclusive on plain and
 * transaction-capable executors (PGlite). Both registrations run the shared
 * lease-store conformance cases.
 *
 * The transaction-capable executor implements `beginTx` the way a
 * `pg.Pool`-backed executor does, and is the one that reproduced the double
 * grant: PGlite is a single connection, so concurrent acquirers' statements
 * interleave and each can read "no lease" before either writes. Acquire must
 * not depend on the executor having transactions to stay exclusive.
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
