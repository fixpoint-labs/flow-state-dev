/**
 * PostgreSQL-backed suspension record store for durable execution (FIX-140).
 *
 * Stores the full SuspensionRecord as JSONB in the `data` column.
 * Scalar columns (`request_id`, `suspension_id`, `created_at`) enable
 * indexed queries; `list` pushes filters down to SQL (JSONB accessors for
 * blob-only fields, scalar columns for the rest).
 *
 * The denormalized `status` / `resolved_at` columns (FIX-141) mirror the
 * blob and back the `(status, resolved_at)` index, so `pruneTerminalBefore`
 * runs a bounded indexed DELETE via `ctid` rather than scanning every row.
 */
import {
  TERMINAL_SUSPENSION_STATUSES,
  type SuspensionFilter,
  type SuspensionRecord
} from "@flow-state-dev/core/types";
import type { SuspensionStore } from "@flow-state-dev/engine";
import type { QueryExecutor } from "./types";

export function createPostgresSuspensionStore(executor: QueryExecutor): SuspensionStore {
  return {
    async set(record: SuspensionRecord): Promise<void> {
      await executor.query(
        `INSERT INTO suspension_records (request_id, suspension_id, data, created_at, status, resolved_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (request_id, suspension_id) DO UPDATE SET
           data = EXCLUDED.data,
           created_at = EXCLUDED.created_at,
           status = EXCLUDED.status,
           resolved_at = EXCLUDED.resolved_at`,
        [
          record.requestId,
          record.suspensionId,
          JSON.stringify(record),
          record.createdAt,
          record.status,
          record.resolvedAt ?? null
        ]
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
      if (filter?.createdBefore !== undefined) {
        conditions.push(`created_at < $${paramIdx++}`);
        params.push(filter.createdBefore);
      }
      if (filter?.resolvedBefore !== undefined) {
        // `resolved_at IS NOT NULL` so unresolved records never match — the
        // sweeper-visible semantics defined in `matchesSuspensionFilter`.
        conditions.push(`resolved_at IS NOT NULL AND resolved_at < $${paramIdx++}`);
        params.push(filter.resolvedBefore);
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
    },

    async pruneTerminalBefore(cutoffMs: number, limit: number): Promise<number> {
      // Bounded indexed delete: the inner SELECT walks the
      // (status, resolved_at) index for the terminal-status set and caps at
      // `limit` ctids, so the DELETE touches at most `limit` rows regardless
      // of table size. `ctid` is the physical row pointer — the standard
      // Postgres idiom for a LIMIT-bounded delete.
      const result = await executor.query(
        `DELETE FROM suspension_records
         WHERE ctid IN (
           SELECT ctid FROM suspension_records
           WHERE status = ANY($1::text[])
             AND resolved_at IS NOT NULL
             AND resolved_at < $2
           LIMIT $3
         )`,
        [TERMINAL_SUSPENSION_STATUSES, cutoffMs, limit]
      );
      return result.rowCount ?? 0;
    }
  };
}
