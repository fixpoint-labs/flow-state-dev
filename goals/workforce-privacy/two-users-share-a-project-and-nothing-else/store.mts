/**
 * Read-only reads of the store file a run's install writes, for what the
 * install's routes don't send a client: a coordinator conversation's session
 * record (its delegates and its delivery ledger, which the coordinator flow
 * doesn't expose), task rows across every partition, and which user owns each
 * session row. Opened read-only and closed after each read; never written.
 */
import { DatabaseSync } from "node:sqlite";
import { routedDeliveries, type RoutedDelivery } from "../../lib/routed-tasks.mts";

export type StoredTask = {
  partition: string;
  scopeId: string;
  id: string;
  goal: string;
  status: string;
  attempts: number;
  assignee?: string;
  error?: string;
  output?: unknown;
  input?: Record<string, unknown>;
  createdAt?: number;
  completedAt?: number;
  run?: { sessionId: string; requestId: string; attempt: number };
  /** The session a routed task is worked in, when the coordinator named one (server-written, FIX-2083). */
  targetSessionId?: string;
  /** Server-written; a routed task's brief (see `isRoutedTask`). A row stored before FIX-2083 as a post carries `session`, where the delegate worked it. */
  sealed?: { postId?: string; delegate?: unknown; session?: { id?: string } };
};

export type StoredSession = {
  id: string;
  flowKind: string;
  userId: string;
  parentSessionId: string | null;
  createdAt: number;
  state: Record<string, any>;
};

function open<T>(file: string, read: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    return read(db);
  } finally {
    db.close();
  }
}

/** Every task row, with its partition (the conversation it was filed in) and the scope that holds it. */
export function taskRows(file: string): StoredTask[] {
  return open(file, (db) =>
    (db.prepare("SELECT scope_id, resource_key, state FROM resource_state WHERE resource_key LIKE 'tasks/%'").all() as Array<{ scope_id: string; resource_key: string; state: string }>).map((row) => {
      const [, segment] = row.resource_key.split("/");
      return { ...(JSON.parse(row.state) as StoredTask), partition: decodeURIComponent(segment ?? ""), scopeId: row.scope_id };
    }),
  );
}

/** Every session row, with its owner and state. */
export function sessionRows(file: string): StoredSession[] {
  return open(file, (db) =>
    (db.prepare("SELECT id, flow_kind, user_id, parent_session_id, created_at, data FROM sessions").all() as Array<Record<string, any>>).map((row) => ({
      id: String(row.id).replace(/^[^:]*:(?=wks_|dsx_|sess_|s_)/, ""),
      flowKind: row.flow_kind,
      userId: row.user_id,
      parentSessionId: row.parent_session_id ?? null,
      createdAt: Number(row.created_at),
      state: ((JSON.parse(row.data) as { state?: Record<string, unknown> }).state ?? {}) as Record<string, any>,
    })),
  );
}

export type Delivery = RoutedDelivery;

/** A coordinator conversation's record, from the rows `userId` owns: its delegates, its routed tasks and best fit's hold. */
export function conversationRecord(file: string, userId: string, sessionId: string): { delegates: Array<{ worker: string }> | null; ledger: Delivery[]; hold: unknown } {
  return open(file, (db) => {
    const row = db.prepare("SELECT data FROM sessions WHERE (id = ? OR id = tenant_id || ':' || ?) AND user_id = ?").get(sessionId, sessionId, userId) as { data: string } | undefined;
    const state = row === undefined ? undefined : (JSON.parse(row.data) as { state?: Record<string, any> }).state;
    return { delegates: state?.delegates ?? null, ledger: routedDeliveries(file, userId, sessionId), hold: state?.bestFitHold ?? null };
  });
}

/** Whether any request in the store still runs. */
export function anythingRunning(file: string): boolean {
  return open(file, (db) => ((db.prepare("SELECT COUNT(*) AS n FROM requests WHERE status IN ('pending','queued','in_progress','running')").get() as { n: number }).n ?? 0) > 0);
}

/** One of `userId`'s worker rows (`workforce/workers/<id>`) as stored, whatever the client projection exposes. */
export function workerRow(file: string, userId: string, id: string): Record<string, any> | undefined {
  return open(file, (db) => {
    const row = db.prepare("SELECT state FROM resource_state WHERE resource_key = ? AND scope_id LIKE ?").get(`workforce/workers/${id}`, `${userId}:%`) as { state: string } | undefined;
    return row === undefined ? undefined : (JSON.parse(row.state) as Record<string, any>);
  });
}
