/**
 * The server's own records, read straight from an app's SQLite store: the
 * sessions, the requests, and every user and org resource's version. Each
 * leg grades on these, never on a view's answer or a hook's return.
 *
 * A watcher polls the resource table while a leg runs, so every version a
 * user or org resource takes is seen with the time it was first seen: what
 * `w:recorded` matches against the requests, and what `a:row-changes` times
 * the page against.
 */
import { DatabaseSync } from "node:sqlite";

export type StoredSession = { id: string; flow_kind: string; user_id: string; org_id: string | null; created_at: number; parent_session_id: string | null };
export type StoredRequest = { id: string; flow_kind: string; user_id: string; session_id: string | null; status: string; created_at: number; updated_at: number };
export type StoredResource = { scope_type: string; scope_id: string; resource_key: string; version: number; state: string };
/** One version of a user or org resource, and when the watcher first saw it. */
export type Version = { scope: string; cell: string; key: string; version: number; state: any; seenAt: number; previousSeenAt: number };

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
    sessions: (since = 0) => query<StoredSession>("select id, flow_kind, user_id, org_id, created_at, parent_session_id from sessions where created_at >= ?", since),
    requests: (since = 0) => query<StoredRequest>("select id, flow_kind, user_id, session_id, status, created_at, updated_at from requests where created_at >= ? or updated_at >= ?", since, since),
    /** Every user and org resource now. */
    resources: () => query<StoredResource>("select scope_type, scope_id, resource_key, version, state from resource_state where scope_type in ('user', 'org')"),
  };
}

export type Store = ReturnType<typeof storeAt>;

/**
 * Watch every user and org resource, every `everyMs`: each new version is
 * recorded with when it was first seen and when the watcher last looked
 * before it. `stop()` ends the watch and hands the versions back.
 */
export function watchVersions(store: Store, everyMs = 100) {
  const seen = new Map<string, number>();
  const versions: Version[] = [];
  const listeners = new Set<(v: Version) => void>();
  let last = Date.now();
  // What is stored before the watch starts is the baseline, not a write of this run.
  let starting = true;
  const look = () => {
    let rows: StoredResource[];
    try {
      rows = store.resources();
    } catch {
      return; // The file is being made; the next look reads it.
    }
    const now = Date.now();
    for (const row of rows) {
      const id = `${row.scope_type}|${row.scope_id}|${row.resource_key}`;
      if (seen.get(id) === row.version) continue;
      seen.set(id, row.version);
      if (starting) continue;
      let state: unknown;
      try {
        state = JSON.parse(row.state);
      } catch {
        state = row.state;
      }
      const v: Version = { scope: row.scope_type, cell: row.scope_id, key: row.resource_key, version: row.version, state, seenAt: now, previousSeenAt: last };
      versions.push(v);
      for (const listener of listeners) listener(v);
    }
    last = now;
  };
  look();
  starting = false;
  const timer = setInterval(look, everyMs);
  return {
    versions,
    /** Hear each new version as it is seen. */
    onVersion: (listener: (v: Version) => void) => listeners.add(listener),
    stop: () => {
      clearInterval(timer);
      look();
      return versions;
    },
  };
}
