import type Database from "better-sqlite3";
import type {
  ActiveRequestEntry,
  ActiveRequestRegistry
} from "@flow-state-dev/server";

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
    startedAt: row.started_at as number,
    lastHeartbeatAt: row.last_heartbeat_at as number
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

export function createSQLiteActiveRequestRegistry(
  db: Database.Database
): ActiveRequestRegistry {
  const registerStmt = db.prepare(`
    INSERT OR REPLACE INTO active_requests
      (request_id, flow_kind, action_name, session_id, user_id, project_id,
       input, metadata, started_at, last_heartbeat_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const heartbeatStmt = db.prepare(
    "UPDATE active_requests SET last_heartbeat_at = ? WHERE request_id = ?"
  );

  const deregisterStmt = db.prepare(
    "DELETE FROM active_requests WHERE request_id = ?"
  );

  const listStaleStmt = db.prepare(
    "SELECT * FROM active_requests WHERE last_heartbeat_at < ?"
  );

  const listAllStmt = db.prepare("SELECT * FROM active_requests");

  const getStmt = db.prepare(
    "SELECT * FROM active_requests WHERE request_id = ?"
  );

  return {
    async register(entry: ActiveRequestEntry): Promise<void> {
      registerStmt.run(...serializeEntry(entry));
    },

    async heartbeat(requestId: string): Promise<void> {
      heartbeatStmt.run(Date.now(), requestId);
    },

    async deregister(requestId: string): Promise<void> {
      deregisterStmt.run(requestId);
    },

    async listStale(thresholdMs: number): Promise<ActiveRequestEntry[]> {
      const cutoff = Date.now() - thresholdMs;
      const rows = listStaleStmt.all(cutoff) as Record<string, unknown>[];
      return rows.map(deserializeRow);
    },

    async listAll(): Promise<ActiveRequestEntry[]> {
      const rows = listAllStmt.all() as Record<string, unknown>[];
      return rows.map(deserializeRow);
    },

    async get(requestId: string): Promise<ActiveRequestEntry | undefined> {
      const row = getStmt.get(requestId) as Record<string, unknown> | undefined;
      return row === undefined ? undefined : deserializeRow(row);
    }
  };
}
