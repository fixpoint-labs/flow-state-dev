/**
 * Locks in the no-LISTEN polling path of `createPostgresRequestStore`.
 *
 * Vercel + Neon-pooled deployments can't use LISTEN/NOTIFY (pgbouncer
 * transaction mode recycles the backend that holds the registration), so
 * kitchen-sink and similar serverless setups pass `liveTailPool: null`
 * to force this fallback. The conformance harness exercises catch-up,
 * live-phase delivery, terminal-event closure, abort behavior, and the
 * liveness-timeout path against the same store implementation that ships
 * to production.
 */
import type { PGlite } from "@electric-sql/pglite";
import { freshPglite } from "./shared-pglite";
import {
  createPostgresRequestStore,
  initializeSchema,
  type QueryExecutor
} from "../src";
import { createRequestStoreConformanceTests } from "@flow-state-dev/engine/testing";

const POLL_INTERVAL_MS = 25;

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

createRequestStoreConformanceTests({
  name: "PostgresRequestStore (liveTailPool: null, polling)",
  pollIntervalMs: POLL_INTERVAL_MS,
  createStore: async () => {
    const pglite = await freshPglite();
    const executor = pgliteExecutor(pglite);
    await initializeSchema(executor);
    return createPostgresRequestStore(executor, {
      liveTailPool: null,
      subscribePollIntervalMs: POLL_INTERVAL_MS
    });
  }
});
