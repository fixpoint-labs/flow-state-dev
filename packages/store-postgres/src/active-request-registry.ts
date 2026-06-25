/**
 * PostgreSQL ActiveRequestRegistry implementation.
 * Tracks in-flight requests with heartbeat timestamps for stale detection.
 */

import type {
  ActiveRequestEntry,
  ActiveRequestRegistry
} from "@flow-state-dev/engine";
import type { QueryExecutor } from "./types";

function serializeEntry(entry: ActiveRequestEntry): unknown[] {
  return [
    entry.requestId,
    entry.flowKind,
    entry.actionName,
    entry.sessionId ?? null,
    entry.userId,
    entry.orgId ?? null,
    entry.tenantId ?? null,
    entry.source,
    entry.input !== undefined ? JSON.stringify(entry.input) : null,
    entry.metadata !== undefined ? JSON.stringify(entry.metadata) : null,
    entry.startedAt,
    entry.lastHeartbeatAt
  ];
}

function deserializeRow(row: Record<string, unknown>): ActiveRequestEntry {
  // Pre-FIX-438 rows that haven't been migrated read back without a
  // `source` column; default to the HTTP transport. The schema migration
  // adds the column with a NOT NULL DEFAULT, so once a database has been
  // touched by the new code path this fallback is unreachable.
  const source =
    typeof row.source === "string" && row.source.length > 0
      ? (row.source as string)
      : "http";

  const entry: ActiveRequestEntry = {
    requestId: row.request_id as string,
    flowKind: row.flow_kind as string,
    actionName: row.action_name as string,
    userId: row.user_id as string,
    source,
    startedAt: Number(row.started_at),
    lastHeartbeatAt: Number(row.last_heartbeat_at)
  };

  if (row.session_id !== null) {
    entry.sessionId = row.session_id as string;
  }
  if (row.org_id !== null) {
    entry.orgId = row.org_id as string;
  }
  if (row.tenant_id !== null && row.tenant_id !== undefined) {
    entry.tenantId = row.tenant_id as string;
  }
  if (row.input !== null) {
    entry.input = JSON.parse(row.input as string);
  }
  if (row.metadata !== null) {
    entry.metadata = JSON.parse(row.metadata as string);
  }

  return entry;
}

export function createPostgresActiveRequestRegistry(
  executor: QueryExecutor
): ActiveRequestRegistry {
  return {
    async register(entry: ActiveRequestEntry): Promise<void> {
      const values = serializeEntry(entry);
      await executor.query(
        `INSERT INTO active_requests
          (request_id, flow_kind, action_name, session_id, user_id, org_id,
           tenant_id, source, input, metadata, started_at, last_heartbeat_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT(request_id) DO UPDATE SET
          flow_kind = EXCLUDED.flow_kind,
          action_name = EXCLUDED.action_name,
          session_id = EXCLUDED.session_id,
          user_id = EXCLUDED.user_id,
          org_id = EXCLUDED.org_id,
          tenant_id = EXCLUDED.tenant_id,
          source = EXCLUDED.source,
          input = EXCLUDED.input,
          metadata = EXCLUDED.metadata,
          started_at = EXCLUDED.started_at,
          last_heartbeat_at = EXCLUDED.last_heartbeat_at`,
        values
      );
    },

    async heartbeat(requestId: string): Promise<void> {
      await executor.query(
        "UPDATE active_requests SET last_heartbeat_at = $1 WHERE request_id = $2",
        [Date.now(), requestId]
      );
    },

    async deregister(requestId: string): Promise<void> {
      await executor.query(
        "DELETE FROM active_requests WHERE request_id = $1",
        [requestId]
      );
    },

    async listStale(thresholdMs: number): Promise<ActiveRequestEntry[]> {
      const cutoff = Date.now() - thresholdMs;
      const result = await executor.query(
        "SELECT * FROM active_requests WHERE last_heartbeat_at < $1",
        [cutoff]
      );
      return result.rows.map((row) => deserializeRow(row as Record<string, unknown>));
    },

    async listAll(): Promise<ActiveRequestEntry[]> {
      const result = await executor.query("SELECT * FROM active_requests");
      return result.rows.map((row) => deserializeRow(row as Record<string, unknown>));
    },

    async get(requestId: string): Promise<ActiveRequestEntry | undefined> {
      const result = await executor.query(
        "SELECT * FROM active_requests WHERE request_id = $1",
        [requestId]
      );
      if (result.rows.length === 0) return undefined;
      return deserializeRow(result.rows[0] as Record<string, unknown>);
    }
  };
}
