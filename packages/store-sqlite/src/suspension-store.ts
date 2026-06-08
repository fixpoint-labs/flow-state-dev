/**
 * SQLite-backed suspension record store for durable execution (FIX-140).
 *
 * Stores the full SuspensionRecord as JSON in the `data` column.
 * Scalar columns (`request_id`, `suspension_id`, `created_at`) enable
 * indexed queries; nested filter fields (flowKind, userId, etc.) are
 * filtered in JS from the parsed JSON blob via `matchesSuspensionFilter`.
 *
 * The denormalized `status` / `resolved_at` columns (FIX-141) mirror the
 * blob and back the `(status, resolved_at)` index, so `pruneTerminalBefore`
 * runs a bounded indexed DELETE rather than scanning every row.
 */
import type Database from "better-sqlite3";
import {
  TERMINAL_SUSPENSION_STATUSES,
  matchesSuspensionFilter,
  type SuspensionFilter,
  type SuspensionRecord,
  type SuspensionStore
} from "@flow-state-dev/server";

export function createSQLiteSuspensionStore(db: Database.Database): SuspensionStore {
  const upsertStmt = db.prepare(
    `INSERT INTO suspension_records (request_id, suspension_id, data, created_at, status, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(request_id, suspension_id) DO UPDATE SET
       data = excluded.data,
       created_at = excluded.created_at,
       status = excluded.status,
       resolved_at = excluded.resolved_at`
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

  // Bounded indexed delete: the inner SELECT walks the (status, resolved_at)
  // index for the terminal-status set and caps at `limit` rowids, so the
  // DELETE touches at most `limit` rows even when the table is large.
  const terminalPlaceholders = TERMINAL_SUSPENSION_STATUSES.map(() => "?").join(", ");
  const pruneStmt = db.prepare(
    `DELETE FROM suspension_records
     WHERE rowid IN (
       SELECT rowid FROM suspension_records
       WHERE status IN (${terminalPlaceholders})
         AND resolved_at IS NOT NULL
         AND resolved_at < ?
       LIMIT ?
     )`
  );

  return {
    async set(record: SuspensionRecord): Promise<void> {
      upsertStmt.run(
        record.requestId,
        record.suspensionId,
        JSON.stringify(record),
        record.createdAt,
        record.status,
        record.resolvedAt ?? null
      );
    },

    async get(requestId: string, suspensionId: string): Promise<SuspensionRecord | null> {
      const row = getStmt.get(requestId, suspensionId) as { data: string } | undefined;
      if (row === undefined) return null;
      return JSON.parse(row.data) as SuspensionRecord;
    },

    async list(filter?: SuspensionFilter): Promise<SuspensionRecord[]> {
      const rows = listStmt.all() as Array<{ data: string }>;
      let results = rows
        .map((r) => JSON.parse(r.data) as SuspensionRecord)
        .filter((r) => matchesSuspensionFilter(r, filter));

      if (filter?.limit !== undefined) {
        results = results.slice(0, filter.limit);
      }

      return results;
    },

    async deleteForRequest(requestId: string): Promise<void> {
      deleteStmt.run(requestId);
    },

    async pruneTerminalBefore(cutoffMs: number, limit: number): Promise<number> {
      const result = pruneStmt.run(...TERMINAL_SUSPENSION_STATUSES, cutoffMs, limit);
      return result.changes;
    }
  };
}
