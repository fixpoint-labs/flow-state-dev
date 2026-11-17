// FIX-140; FIX-141.
/**
 * PostgreSQL-backed suspension record store for durable execution.
 *
 * Stores the full SuspensionRecord as JSONB in the `data` column.
 * Scalar columns (`request_id`, `suspension_id`, `created_at`) enable
 * indexed queries; `list` pushes filters down to SQL (JSONB accessors for
 * blob-only fields, scalar columns for the rest).
 *
 * The denormalized `status` / `resolved_at` columns mirror the
 * blob and back the `(status, resolved_at)` index, so `pruneTerminalBefore`
 * runs a bounded indexed DELETE via `ctid` rather than scanning every row.
 *
 * `listPendingForUser` is one statement that joins each
 * suspension to its request and puts every scope predicate in its `WHERE`.
 */
import {
  TERMINAL_SUSPENSION_STATUSES,
  USER_SUSPENSION_REASONS,
  projectUserSuspension,
  type PendingUserSuspension,
  type PendingUserSuspensionQuery,
  type SuspensionFilter,
  type SuspensionRecord
} from "@flow-state-dev/core/types";
import type { SuspensionStore } from "@flow-state-dev/engine/host";
import type { QueryExecutor } from "./types";

/** A JSONB value, parsed when the driver hands back text; absent when NULL. */
function jsonValue<T>(value: unknown): T | undefined {
  if (value === null || value === undefined) return undefined;
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

/** A nullable text or number column as the projector takes it. */
function nullable<T>(value: unknown): T | null {
  return value === null || value === undefined ? null : (value as T);
}

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
    },

    // FIX-2770; FIX-2683 ER-6.
    async listPendingForUser(query: PendingUserSuspensionQuery): Promise<PendingUserSuspension[]> {
      if (query.flowKinds.length === 0 || query.limit <= 0) return [];
      // One statement: the request joined (an inner join, so a suspension
      // whose request is missing drops) and every predicate inside it. Tenant
      // and organization match NULL-safe, as the request list's clauses do.
      // Ids compare by byte (`COLLATE "C"`), as the other stores order them.
      // The request is part of the order: a suspension id is unique only within it.
      const params: unknown[] = [
        query.userId,
        query.tenantId ?? null,
        query.orgId ?? null,
        [...query.flowKinds],
        [...USER_SUSPENSION_REASONS],
        query.now,
        query.limit
      ];
      const after = query.after;
      if (after !== undefined) params.push(after.createdAt, after.requestId, after.suspensionId);
      const result = await executor.query(
        `SELECT s.suspension_id AS "suspensionId", s.request_id AS "requestId", r.flow_kind AS "flowKind",
           COALESCE(r.flow_id, s.data->>'flowId') AS "flowId", r.session_id AS "sessionId",
           s.data->>'reason' AS reason, s.data->>'kind' AS kind, s.data->>'title' AS title,
           s.data->>'message' AS message, s.data->'allow' AS allow, s.data->'resumeSchema' AS "resumeSchema",
           s.data->'render' AS render, s.created_at AS "createdAt", (s.data->>'expiresAt')::double precision AS "expiresAt"
         FROM suspension_records s
         JOIN requests r ON r.id = s.request_id
         WHERE s.status = 'pending'
           AND s.data->>'userId' = $1
           AND r.user_id = $1
           AND r.tenant_id IS NOT DISTINCT FROM $2
           AND r.org_id IS NOT DISTINCT FROM $3
           AND r.flow_kind = ANY($4::text[])
           AND s.data->>'reason' = ANY($5::text[])
           AND (s.data->>'expiresAt' IS NULL OR (s.data->>'expiresAt')::double precision > $6)
           ${after !== undefined ? `AND (s.created_at > $8 OR (s.created_at = $8 AND (s.request_id COLLATE "C" > $9 OR (s.request_id = $9 AND s.suspension_id COLLATE "C" > $10))))` : ""}
         ORDER BY s.created_at ASC, s.request_id COLLATE "C" ASC, s.suspension_id COLLATE "C" ASC
         LIMIT $7`,
        params
      );
      return result.rows.map((row) =>
        projectUserSuspension({
          suspensionId: String(row.suspensionId),
          requestId: String(row.requestId),
          flowKind: String(row.flowKind),
          flowId: nullable<string>(row.flowId),
          sessionId: nullable<string>(row.sessionId),
          reason: String(row.reason),
          kind: nullable<PendingUserSuspension["kind"]>(row.kind),
          title: nullable<string>(row.title),
          message: String(row.message),
          allow: jsonValue(row.allow),
          resumeSchema: jsonValue(row.resumeSchema),
          render: jsonValue(row.render),
          createdAt: Number(row.createdAt),
          expiresAt: row.expiresAt === null || row.expiresAt === undefined ? null : Number(row.expiresAt)
        })
      );
    }
  };
}
