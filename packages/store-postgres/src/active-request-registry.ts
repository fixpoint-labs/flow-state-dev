/**
 * PostgreSQL ActiveRequestRegistry implementation.
 * Tracks in-flight requests with heartbeat timestamps for stale detection.
 */

import type {
  ActiveRequestEntry,
  ActiveRequestRegistry
} from "@flow-state-dev/server";
import type { QueryExecutor } from "./types";

function serializeEntry(entry: ActiveRequestEntry): unknown[] {
  return [
    entry.requestId,
    entry.flowKind,
    entry.actionName,
    entry.sessionId ?? null,
    entry.userId,
    entry.projectId ?? null,
    entry.input !== undefined ? JSON.stringify(entry.input) : null,
    entry.metadata !== undefined ? JSON.stringify(entry.metadata) : null,
    entry.startedAt,
    entry.lastHeartbeatAt
  ];
}

function deserializeRow(row: Record<string, unknown>): ActiveRequestEntry {
  const entry: ActiveRequestEntry = {
    requestId: row.request_id as string,
    flowKind: row.flow_kind as string,
    actionName: row.action_name as string,
    userId: row.user_id as string,
    startedAt: Number(row.started_at),
    lastHeartbeatAt: Number(row.last_heartbeat_at)
  };

  if (row.session_id !== null) {
    entry.sessionId = row.session_id as string;
  }
  if (row.project_id !== null) {
    entry.projectId = row.project_id as string;
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
          (request_id, flow_kind, action_name, session_id, user_id, project_id,
           input, metadata, started_at, last_heartbeat_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT(request_id) DO UPDATE SET
          flow_kind = $2, action_name = $3, session_id = $4, user_id = $5,
          project_id = $6, input = $7, metadata = $8, started_at = $9,
          last_heartbeat_at = $10`,
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
