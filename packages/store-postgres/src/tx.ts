/**
 * Transaction helpers for `pg.Pool`-backed `QueryExecutor`s.
 *
 * Used by `createPostgresScheduleIndex` to run `SELECT ... FOR UPDATE
 * SKIP LOCKED` + `UPDATE` against a pinned connection so the row-level
 * locks taken in the SELECT survive until the matching UPDATE.
 */

import type { Pool } from "pg";
import type { TxClient } from "./types";

/**
 * Acquire a pool client, BEGIN, and return a `TxClient` that pins all
 * subsequent queries to that connection. Caller MUST end with exactly
 * one `commit()` or `rollback()`; either releases the client back to
 * the pool.
 */
export async function createPgPoolTx(pool: Pool): Promise<TxClient> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
  } catch (err) {
    client.release();
    throw err;
  }

  let settled = false;
  return {
    async query(text: string, values?: unknown[]) {
      const result = await client.query(text, values);
      return {
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.rowCount ?? 0
      };
    },
    async commit() {
      if (settled) return;
      settled = true;
      try {
        await client.query("COMMIT");
      } finally {
        client.release();
      }
    },
    async rollback() {
      if (settled) return;
      settled = true;
      try {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    }
  };
}

