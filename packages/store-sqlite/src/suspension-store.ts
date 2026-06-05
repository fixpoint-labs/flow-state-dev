/**
 * SQLite-backed suspension record store for durable execution (FIX-140).
 *
 * Stores the full SuspensionRecord as JSON in the `data` column.
 * Scalar columns (`request_id`, `suspension_id`, `created_at`) enable
 * indexed queries; nested filter fields (flowKind, userId, etc.) are
 * filtered in JS from the parsed JSON blob.
 */
import type Database from "better-sqlite3";
import type { SuspensionFilter, SuspensionRecord } from "@flow-state-dev/core/types";
import type { SuspensionStore } from "@flow-state-dev/server";

export function createSQLiteSuspensionStore(db: Database.Database): SuspensionStore {
  const upsertStmt = db.prepare(
    `INSERT INTO suspension_records (request_id, suspension_id, data, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(request_id, suspension_id) DO UPDATE SET
       data = excluded.data,
       created_at = excluded.created_at`
  );

  const getStmt = db.prepare(
    `SELECT data FROM suspension_records WHERE request_id = ? AND suspension_id = ?`
  );

  const listStmt = db.prepare(
    `SELECT data FROM suspension_records ORDER BY created_at DESC`
  );

  const deleteStmt = db.prepare(
    `DELETE FROM suspension_records WHERE request_id = ?`
  );

  return {
    async set(record: SuspensionRecord): Promise<void> {
      upsertStmt.run(
        record.requestId,
        record.suspensionId,
        JSON.stringify(record),
        record.createdAt
      );
    },

    async get(requestId: string, suspensionId: string): Promise<SuspensionRecord | null> {
      const row = getStmt.get(requestId, suspensionId) as { data: string } | undefined;
      if (row === undefined) return null;
      return JSON.parse(row.data) as SuspensionRecord;
    },

    async list(filter?: SuspensionFilter): Promise<SuspensionRecord[]> {
      const rows = listStmt.all() as Array<{ data: string }>;
      let results = rows.map((r) => JSON.parse(r.data) as SuspensionRecord);

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
      deleteStmt.run(requestId);
    }
  };
}
