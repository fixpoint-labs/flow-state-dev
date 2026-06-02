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
      const conditions: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (filter?.flowKind) {
        conditions.push(`data->>'flowKind' = $${paramIdx++}`);
        params.push(filter.flowKind);
      }
      if (filter?.userId) {
        conditions.push(`data->>'userId' = $${paramIdx++}`);
        params.push(filter.userId);
      }
      if (filter?.sessionId) {
        conditions.push(`data->>'sessionId' = $${paramIdx++}`);
        params.push(filter.sessionId);
      }
      if (filter?.status) {
        conditions.push(`data->>'status' = $${paramIdx++}`);
        params.push(filter.status);
      }

      const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
      const limit = filter?.limit !== undefined ? ` LIMIT $${paramIdx++}` : "";
      if (filter?.limit !== undefined) params.push(filter.limit);

      const result = await executor.query(
        `SELECT data FROM suspension_records${where} ORDER BY created_at DESC${limit}`,
        params
      );

      return result.rows.map((row) => {
        const data = row.data;
        return typeof data === "string" ? (JSON.parse(data) as SuspensionRecord) : (data as SuspensionRecord);
      });
    },

    async deleteForRequest(requestId: string): Promise<void> {
      await executor.query(
        "DELETE FROM suspension_records WHERE request_id = $1",
        [requestId]
      );
    }
  };
}
