/**
 * `ResourceStateStore.listAcrossSessions` for the stores that keep records in
 * JavaScript (memory and filesystem): the owner's sessions, every parentage,
 * read from the session store the registry factory hands the resource-state
 * store, walked in storage-key order, each session's rows read by the store's
 * own prefix read. The owner predicate is the SQL adapters' `WHERE`, with
 * `tenantId` and `orgId` always present, so an unbound owner matches only
 * unbound sessions. Keys compare by code point, the byte order the SQL stores
 * compare in, so the four stores answer one order.
 */
import { FlowStateConfigError } from "../errors/flow-error";
import { isSameSession } from "./scope-keys";
import type {
  AcrossSessionsQuery,
  AcrossSessionsStoredRow,
  SessionRecord,
  SessionStore,
  VersionedResourceState
} from "./types";

/** What a JS resource-state store reads the owner's sessions through. */
export type AcrossSessionsSessionReads = Pick<SessionStore, "list" | "get">;

/** `a` against `b` by code point: UTF-8 byte order, as SQLite `BINARY` and Postgres `COLLATE "C"` compare. */
function compareByCodePoint(a: string, b: string): number {
  if (a === b) return 0;
  const left = a[Symbol.iterator]();
  const right = b[Symbol.iterator]();
  for (;;) {
    const l = left.next();
    const r = right.next();
    if (l.done === true) return r.done === true ? 0 : -1;
    if (r.done === true) return 1;
    const diff = (l.value.codePointAt(0) as number) - (r.value.codePointAt(0) as number);
    if (diff !== 0) return diff;
  }
}

/** A session record's owner and flow, as a stored row of the read carries them. */
function sessionIdentity(record: SessionRecord): AcrossSessionsStoredRow["session"] {
  return {
    flowKind: record.flowKind,
    ...(record.flowId != null ? { flowId: record.flowId } : {}),
    userId: record.userId,
    ...(record.orgId != null ? { orgId: record.orgId } : {}),
    ...(record.tenantId != null ? { tenantId: record.tenantId } : {})
  };
}

/** Whether `now`, read again by its key, is still the session `listed` was: by its birth token when both carry one. */
function sameIncarnation(listed: SessionRecord, now: SessionRecord): boolean {
  if (listed.incarnationToken != null && now.incarnationToken != null && listed.incarnationToken !== now.incarnationToken) return false;
  return isSameSession(listed, now);
}

/** The refusal a resource-state store built without its session store gives the read. */
export function missingSessionStore(factory: string): FlowStateConfigError {
  return new FlowStateConfigError(
    `${factory} was built without \`sessions\`, the session store a read across sessions is joined to. ` +
      "Pass it (`createInMemoryStores` and `createFilesystemStores` do)."
  );
}

/**
 * One page of the owner's rows: `rowsOf(sessionKey, prefix)` reads one
 * session's live rows under the collection's prefix. A store without index
 * verbs answers an `index` filter with every row; the engine checks each.
 */
export async function listAcrossSessions(
  sessions: AcrossSessionsSessionReads,
  rowsOf: (sessionKey: string, keyPrefix: string) => Promise<Record<string, VersionedResourceState>>,
  query: AcrossSessionsQuery
): Promise<AcrossSessionsStoredRow[]> {
  if (query.limit <= 0) return [];
  const owned = await sessions.list({
    userId: query.owner.userId,
    tenantId: query.owner.tenantId,
    orgId: query.owner.orgId,
    parentage: "all"
  });
  const after = query.after;
  const records = owned
    .filter((record) => after === undefined || compareByCodePoint(record.id, after.sessionKey) >= 0)
    .sort((a, b) => compareByCodePoint(a.id, b.id));
  const rows: AcrossSessionsStoredRow[] = [];
  for (const record of records) {
    const sessionKey = record.id;
    const session = sessionIdentity(record);
    const stored = await rowsOf(sessionKey, query.keyPrefix);
    // The listing and the rows are two reads, not one statement: a session
    // deleted and made again between them (by anyone, for anyone) holds rows
    // that aren't the listed session's. Read it again after its rows; another
    // incarnation, or none, answers none of them.
    const now = await sessions.get(sessionKey);
    if (now === undefined || !sameIncarnation(record, now)) continue;
    const inSession = Object.keys(stored)
      .filter((key) => key.startsWith(query.keyPrefix))
      .filter((key) => query.key === undefined || key === query.key)
      .filter((key) => after === undefined || sessionKey !== after.sessionKey || compareByCodePoint(key, after.key) > 0)
      .sort(compareByCodePoint);
    for (const key of inSession) {
      const row = stored[key]!;
      rows.push({ sessionKey, session, key, state: row.state, version: row.version });
      if (rows.length >= query.limit) return rows;
    }
  }
  return rows;
}
