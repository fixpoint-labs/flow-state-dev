/**
 * The server's own records, read straight from an app's SQLite store: the
 * sessions, the requests, what each request said it changed, and every user
 * and org resource's versions. Each leg grades on these, never on a view's
 * answer or a hook's return.
 *
 * Every version is caught, not sampled: {@link watchVersions} installs
 * triggers on the store's resource table that log each insert, update and
 * delete of a user or org resource, with the time of the write, into a table
 * of the goal's own (`closure_write_log`). A poll of the latest row would
 * miss a version written between two polls, and a delete. The watcher still
 * checks each key's versions run one after another from the baseline it took,
 * and reports any gap, so a write the log didn't see is never read as none.
 */
import { DatabaseSync } from "node:sqlite";

export type StoredSession = { id: string; flow_kind: string; user_id: string; org_id: string | null; created_at: number; parent_session_id: string | null };
export type StoredRequest = { id: string; flow_kind: string; user_id: string; session_id: string | null; status: string; created_at: number; updated_at: number };
export type StoredResource = { scope_type: string; scope_id: string; resource_key: string; version: number; state: string };
/** One write to a user or org resource: a version it took, or its delete, and when it was written. */
export type Version = { op: "insert" | "update" | "delete"; scope: string; cell: string; key: string; version: number; state: any; seenAt: number; previousSeenAt: number };

/** The store of an app whose SQLite file is `file`, opened read-only per call so a write in flight is never held. */
export function storeAt(file: string) {
  const query = <T,>(sql: string, ...args: (string | number)[]): T[] => {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      return db.prepare(sql).all(...args) as T[];
    } finally {
      db.close();
    }
  };
  return {
    file,
    query,
    sessions: (since = 0) => query<StoredSession>("select id, flow_kind, user_id, org_id, created_at, parent_session_id from sessions where created_at >= ?", since),
    requests: (since = 0) => query<StoredRequest>("select id, flow_kind, user_id, session_id, status, created_at, updated_at from requests where created_at >= ? or updated_at >= ?", since, since),
    /** Every user and org resource now. */
    resources: () => query<StoredResource>("select scope_type, scope_id, resource_key, version, state from resource_state where scope_type in ('user', 'org')"),
    /**
     * What each request said it changed: its `resource_change` items, as `scope|path` by request id.
     * A request that changed a resource streams one for it.
     */
    changesByRequest: (): Map<string, Set<string>> => {
      const out = new Map<string, Set<string>>();
      for (const row of query<{ request_id: string; event_data: string }>("select request_id, event_data from request_events where event_data like '%\"resource_change\"%'")) {
        const item = (JSON.parse(row.event_data) as { item?: { type?: string; scope?: string; resourcePath?: string } }).item;
        if (item?.type !== "resource_change" || item.scope === undefined || item.resourcePath === undefined) continue;
        (out.get(row.request_id) ?? out.set(row.request_id, new Set()).get(row.request_id)!).add(`${item.scope}|${item.resourcePath}`);
      }
      return out;
    },
  };
}

export type Store = ReturnType<typeof storeAt>;

/** The time of a write, in ms since the epoch, as SQLite tells it inside the writing transaction. */
const NOW_MS = "CAST(ROUND((julianday('now') - 2440587.5) * 86400000) AS INTEGER)";

/** The goal's write log on `file`: one table and three triggers, made once; writes before it are the baseline. */
function installWriteLog(file: string): void {
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA busy_timeout = 10000");
    db.exec(`CREATE TABLE IF NOT EXISTS closure_write_log (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, op TEXT NOT NULL,
      scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, resource_key TEXT NOT NULL, version INTEGER NOT NULL, state TEXT)`);
    for (const [op, row] of [["INSERT", "NEW"], ["UPDATE", "NEW"], ["DELETE", "OLD"]] as const) {
      db.exec(`CREATE TRIGGER IF NOT EXISTS closure_log_${op.toLowerCase()} AFTER ${op} ON resource_state
        WHEN ${row}.scope_type IN ('user', 'org')
        BEGIN INSERT INTO closure_write_log (at, op, scope_type, scope_id, resource_key, version, state)
          VALUES (${NOW_MS}, '${op.toLowerCase()}', ${row}.scope_type, ${row}.scope_id, ${row}.resource_key, ${row}.version, ${op === "DELETE" ? "NULL" : `${row}.state`}); END`);
    }
  } finally {
    db.close();
  }
}

/**
 * Log every user and org resource write from now on, read every `everyMs`
 * for listeners. `gaps` names each key whose versions skipped one: a write
 * the log did not see. `stop()` reads the log a last time and hands back
 * the writes.
 */
export function watchVersions(store: Store, everyMs = 50) {
  installWriteLog(store.file);
  const latest = new Map<string, number>();
  for (const row of store.resources()) latest.set(`${row.scope_type}|${row.scope_id}|${row.resource_key}`, row.version);
  const versions: Version[] = [];
  const gaps: string[] = [];
  const listeners = new Set<(v: Version) => void>();
  let after = 0;
  const look = () => {
    let rows: { seq: number; at: number; op: Version["op"]; scope_type: string; scope_id: string; resource_key: string; version: number; state: string | null }[];
    try {
      rows = store.query("select * from closure_write_log where seq > ? order by seq", after);
    } catch {
      return; // A write holds the file; the next look reads it.
    }
    for (const row of rows) {
      after = row.seq;
      const id = `${row.scope_type}|${row.scope_id}|${row.resource_key}`;
      const known = latest.get(id);
      if (row.op === "update" && known !== undefined && row.version !== known + 1 && row.version !== known) gaps.push(`${row.scope_type} ${row.resource_key}: v${known} then v${row.version}`);
      if (row.op === "delete") latest.delete(id);
      else latest.set(id, row.version);
      let state: unknown = null;
      try {
        state = row.state === null ? null : JSON.parse(row.state);
      } catch {
        state = row.state;
      }
      const v: Version = { op: row.op, scope: row.scope_type, cell: row.scope_id, key: row.resource_key, version: row.version, state, seenAt: row.at, previousSeenAt: row.at };
      versions.push(v);
      for (const listener of listeners) listener(v);
    }
  };
  const timer = setInterval(look, everyMs);
  return {
    versions,
    gaps,
    /** Hear each write as the log shows it. */
    onVersion: (listener: (v: Version) => void) => listeners.add(listener),
    stop: () => {
      clearInterval(timer);
      look();
      return versions;
    },
  };
}
