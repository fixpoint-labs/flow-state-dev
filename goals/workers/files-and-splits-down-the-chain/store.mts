/**
 * The oracle: what a run's SQLite store holds, read straight off the file,
 * read-only. No app code decodes it: a task row is the JSON the ledger
 * stored, a session's state is its record's `state`, an item is the item.
 *
 * Not through the HTTP routes: the session route sends a client only the
 * state a flow exposes, and the coordinator exposes neither its task notices
 * nor its delegates' ledger.
 */
import { DatabaseSync } from "node:sqlite";

/** A task row as the ledger stored it, with the partition its key names. */
export type StoredTask = {
  partition: string;
  id: string;
  goal: string;
  status: string;
  attempts: number;
  assignee?: string;
  error?: string;
  output?: unknown;
  metadata?: Record<string, unknown>;
  createdAt?: number;
  updatedAt?: number;
  completedAt?: number;
  run?: { sessionId: string; requestId: string; attempt: number };
};

export type StoredSession = {
  id: string;
  flowKind: string;
  userId: string;
  parentSessionId: string | null;
  createdAt: number;
  state: Record<string, unknown>;
};

export type StoredRequest = {
  id: string;
  sessionId: string | null;
  flowKind: string;
  actionName: string;
  status: string;
  source: string | undefined;
  createdAt: number;
  /** When it ended, or its last write while it runs. */
  updatedAt: number;
};

export type StoredItem = Record<string, any> & { type: string; requestId: string };

function open<T>(file: string, read: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    return read(db);
  } finally {
    db.close();
  }
}

/** Every task row in `userId`'s cell in `org`, on the conversation ledger (`tasks/<partition>/<id>`). */
export function taskRows(file: string, userId: string, org: string): StoredTask[] {
  return open(file, (db) =>
    (db.prepare("SELECT resource_key, state FROM resource_state WHERE scope_type = 'user' AND scope_id = ? AND resource_key LIKE 'tasks/%'").all(`${userId}:~org:${org}`) as Array<{ resource_key: string; state: string }>).map(
      (row) => {
        const [, segment] = row.resource_key.split("/");
        return { ...(JSON.parse(row.state) as StoredTask), partition: decodeURIComponent(segment ?? "") };
      },
    ),
  );
}

/** Every task row in the store, whoever's cell it sits in, with that cell's scope id. */
export function allTaskRows(file: string): Array<StoredTask & { scopeId: string }> {
  return open(file, (db) =>
    (db.prepare("SELECT scope_id, resource_key, state FROM resource_state WHERE resource_key LIKE 'tasks/%'").all() as Array<{ scope_id: string; resource_key: string; state: string }>).map((row) => {
      const [, segment] = row.resource_key.split("/");
      return { ...(JSON.parse(row.state) as StoredTask), partition: decodeURIComponent(segment ?? ""), scopeId: row.scope_id };
    }),
  );
}

/** Every session the store holds. */
export function sessions(file: string): StoredSession[] {
  return open(file, (db) =>
    (db.prepare("SELECT id, flow_kind, user_id, parent_session_id, created_at, data FROM sessions").all() as Array<Record<string, any>>).map((row) => ({
      id: row.id,
      flowKind: row.flow_kind,
      userId: row.user_id,
      parentSessionId: row.parent_session_id ?? null,
      createdAt: row.created_at,
      state: ((JSON.parse(row.data) as { state?: Record<string, unknown> }).state ?? {}) as Record<string, unknown>,
    })),
  );
}

/** Every request the store holds, oldest first. */
export function requests(file: string): StoredRequest[] {
  return open(file, (db) =>
    (db.prepare("SELECT id, session_id, flow_kind, status, created_at, updated_at, data FROM requests ORDER BY created_at").all() as Array<Record<string, any>>).map((row) => {
      const data = JSON.parse(row.data) as { actionName?: string; source?: string; finalizedAtMs?: number };
      return {
        id: row.id,
        sessionId: row.session_id ?? null,
        flowKind: row.flow_kind,
        actionName: data.actionName ?? "",
        status: row.status,
        source: data.source,
        createdAt: row.created_at,
        updatedAt: data.finalizedAtMs ?? row.updated_at,
      };
    }),
  );
}

/** The items of every request in `sessionId`, of `type`, in request then item order. */
export function items(file: string, sessionId: string, type: string): StoredItem[] {
  return open(file, (db) =>
    (
      db
        .prepare(
          "SELECT i.data FROM request_items i JOIN requests r ON r.id = i.request_id WHERE r.session_id = ? AND i.item_type = ? ORDER BY r.created_at, i.sequence",
        )
        .all(sessionId, type) as Array<{ data: string }>
    ).map((row) => JSON.parse(row.data) as StoredItem),
  );
}

/** A message item's text. */
export function textOf(item: Record<string, any>): string {
  if (typeof item.text === "string") return item.text;
  if (typeof item.content === "string") return item.content;
  if (Array.isArray(item.content)) return item.content.map((part) => String((part as { text?: unknown }).text ?? "")).join("");
  return "";
}

/** A tool output's value, parsed when it was stored as JSON text. */
export function toolOutput(item: StoredItem): any {
  const value = item.output ?? item.error ?? null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
