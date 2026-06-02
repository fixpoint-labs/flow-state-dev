/**
 * PostgreSQL-backed suspension record store for durable execution (FIX-140).
 *
 * Stores the full SuspensionRecord as JSONB in the `data` column.
 * Scalar columns (`request_id`, `suspension_id`, `created_at`) enable
 * indexed queries; nested filter fields are filtered in JS from the
 * parsed JSONB blob.
 */
import type { SuspensionFilter, SuspensionRecord } from "@flow-state-dev/core/types";
import type { SuspensionStore } from "@flow-state-dev/server";
import type { QueryExecutor } from "./types";

export function createPostgresSuspensionStore(executor: QueryExecutor): SuspensionStore {
  return {
    async set(record: SuspensionRecord): Promise<void> {
      await executor.query(
        `INSERT INTO suspension_records (request_id, suspension_id, data, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (request_id, suspension_id) DO UPDATE SET
           data = EXCLUDED.data,
           created_at = EXCLUDED.created_at`,
        [record.requestId, record.suspensionId, JSON.stringify(record), record.createdAt]
      );
    },

    async get(requestId: string, suspensionId: string): Promise<SuspensionRecord | null> {
      const result = await executor.query(
        "SELECT data FROM suspension_records WHERE request_id = $1 AND suspension_id = $2",
        [requestId, suspensionId]
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      const data = row.data;
      return typeof data === "string" ? (JSON.parse(data) as SuspensionRecord) : (data as SuspensionRecord);
    },

    async list(filter?: SuspensionFilter): Promise<SuspensionRecord[]> {
      const result = await executor.query(
        "SELECT data FROM suspension_records ORDER BY created_at DESC"
      );

      let results = result.rows.map((row) => {
        const data = row.data;
        return typeof data === "string" ? (JSON.parse(data) as SuspensionRecord) : (data as SuspensionRecord);
      });

      if (filter?.flowKind) {
        results = results.filter((r) => r.flowKind === filter.flowKind);
      }
      if (filter?.userId) {
        results = results.filter((r) => r.userId === filter.userId);
      }
      if (filter?.sessionId) {
        results = results.filter((r) => r.sessionId === filter.sessionId);
      }
      if (filter?.status) {
        results = results.filter((r) => r.status === filter.status);
      }
      if (filter?.limit !== undefined) {
        results = results.slice(0, filter.limit);
      }

      return results;
    },

    async deleteForRequest(requestId: string): Promise<void> {
      await executor.query(
        "DELETE FROM suspension_records WHERE request_id = $1",
        [requestId]
      );
    }
  };
}
