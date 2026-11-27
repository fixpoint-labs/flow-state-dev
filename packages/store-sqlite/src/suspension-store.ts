// FIX-140; FIX-141.
/**
 * SQLite-backed suspension record store for durable execution.
 *
 * Stores the full SuspensionRecord as JSON in the `data` column.
 * Scalar columns (`request_id`, `suspension_id`, `created_at`) enable
 * indexed queries; nested filter fields (flowKind, userId, etc.) are
 * filtered in JS from the parsed JSON blob via `matchesSuspensionFilter`.
 *
 * The denormalized `status` / `resolved_at` columns mirror the
 * blob and back the `(status, resolved_at)` index, so `pruneTerminalBefore`
 * runs a bounded indexed DELETE rather than scanning every row.
 *
 * `listPendingForUser` is one statement that joins each
 * suspension to its request and puts every scope predicate in its `WHERE`.
 */
import type Database from "better-sqlite3";
import {
  TERMINAL_SUSPENSION_STATUSES,
  USER_SUSPENSION_REASONS,
  matchesSuspensionFilter,
  projectUserSuspension,
  type PendingUserSuspension,
  type PendingUserSuspensionQuery,
  type SuspensionFilter,
  type SuspensionRecord
} from "@flow-state-dev/core/types";
import type { SuspensionStore } from "@flow-state-dev/engine/host";

/** A JSON column `json_extract` returned as text, parsed; absent when NULL. */
function parsedJson<T>(value: unknown): T | undefined {
  return typeof value === "string" ? (JSON.parse(value) as T) : undefined;
}

/** A row of the pending read, as SQLite returns it. */
type PendingRow = {
  suspensionId: string;
  requestId: string;
  flowKind: string;
  flowId: string | null;
  sessionId: string | null;
  reason: string;
  kind: string | null;
  title: string | null;
  message: string;
  allow: string | null;
  resumeSchema: string | null;
  render: string | null;
  createdAt: number;
  expiresAt: number | null;
};

// FIX-2770; FIX-2683 ER-6.
/**
 * The pending read for `kinds` flow kinds, with or without a cursor: one
 * statement, the request joined (an inner join, so a suspension whose request
 * is missing drops) and every predicate inside it. Tenant and organization
 * match NULL-safe (`IS ?`), as the request list's clauses do.
 */
function pendingForUserSql(kinds: number, after: boolean): string {
  const reasons = USER_SUSPENSION_REASONS.map(() => "?").join(", ");
  return `SELECT s.suspension_id AS suspensionId, s.request_id AS requestId, r.flow_kind AS flowKind,
       COALESCE(r.flow_id, json_extract(s.data, '$.flowId')) AS flowId, r.session_id AS sessionId,
       json_extract(s.data, '$.reason') AS reason, json_extract(s.data, '$.kind') AS kind,
       json_extract(s.data, '$.title') AS title, json_extract(s.data, '$.message') AS message,
       json_extract(s.data, '$.allow') AS allow, json_extract(s.data, '$.resumeSchema') AS resumeSchema,
       json_extract(s.data, '$.render') AS render, s.created_at AS createdAt,
       json_extract(s.data, '$.expiresAt') AS expiresAt
     FROM suspension_records s
     JOIN requests r ON r.id = s.request_id
     WHERE s.status = 'pending'
       AND json_extract(s.data, '$.userId') = ?
       AND r.user_id = ?
       AND r.tenant_id IS ?
       AND r.org_id IS ?
       AND r.flow_kind IN (${Array.from({ length: kinds }, () => "?").join(", ")})
       AND json_extract(s.data, '$.reason') IN (${reasons})
       AND (json_extract(s.data, '$.expiresAt') IS NULL OR json_extract(s.data, '$.expiresAt') > ?)
       ${after ? "AND (s.created_at > ? OR (s.created_at = ? AND (s.request_id > ? OR (s.request_id = ? AND s.suspension_id > ?))))" : ""}
     ORDER BY s.created_at ASC, s.request_id ASC, s.suspension_id ASC
     LIMIT ?`;
}

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

  // One prepared statement per flow-kind count and cursor presence.
  const pendingStmts = new Map<string, Database.Statement>();
  const pendingStmt = (kinds: number, after: boolean): Database.Statement => {
    const key = `${kinds}:${after}`;
    let stmt = pendingStmts.get(key);
    if (stmt === undefined) pendingStmts.set(key, (stmt = db.prepare(pendingForUserSql(kinds, after))));
    return stmt;
  };

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
    },

    async listPendingForUser(query: PendingUserSuspensionQuery): Promise<PendingUserSuspension[]> {
      if (query.flowKinds.length === 0 || query.limit <= 0) return [];
      const after = query.after;
      const rows = pendingStmt(query.flowKinds.length, after !== undefined).all(
        query.userId,
        query.userId,
        query.tenantId ?? null,
        query.orgId ?? null,
        ...query.flowKinds,
        ...USER_SUSPENSION_REASONS,
        query.now,
        ...(after !== undefined ? [after.createdAt, after.createdAt, after.requestId, after.requestId, after.suspensionId] : []),
        query.limit
      ) as PendingRow[];
      return rows.map((row) =>
        projectUserSuspension({
          suspensionId: row.suspensionId,
          requestId: row.requestId,
          flowKind: row.flowKind,
          flowId: row.flowId,
          sessionId: row.sessionId,
          reason: row.reason,
          kind: row.kind as PendingUserSuspension["kind"] | null,
          title: row.title,
          message: row.message,
          allow: parsedJson(row.allow),
          resumeSchema: parsedJson(row.resumeSchema),
          render: parsedJson(row.render),
          createdAt: row.createdAt,
          expiresAt: row.expiresAt
        })
      );
    }
  };
}
