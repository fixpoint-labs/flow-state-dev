import type { OutputItem } from "@flow-state-dev/core/items";
import type {
  ActiveRequestEntry,
  ActiveRequestRegistry,
  RequestRecord,
  RequestStatus
} from "./types";

/**
 * Request-status list-filter predicate (FIX-1010). A single status matches by
 * equality; an array matches set membership, which is what lets "does any
 * non-terminal run exist" be one read instead of one per member. An absent
 * filter passes everything; an empty array passes nothing.
 *
 * The in-memory and filesystem stores call this directly; the SQL adapters
 * mirror it as `status = ?` / `status IN (…)` because the filter has to be a
 * SQL clause there.
 */
export function matchesRequestStatusFilter(
  filter: RequestStatus | readonly RequestStatus[] | undefined,
  recordStatus: RequestStatus
): boolean {
  if (filter === undefined) return true;
  if (Array.isArray(filter)) return filter.includes(recordStatus);
  return recordStatus === filter;
}

/**
 * Request-session list-filter predicate: a single id matches by equality, an
 * array by set membership, absent passes everything and an empty array
 * nothing. Same shape as {@link matchesRequestStatusFilter}, and the SQL
 * adapters mirror it the same way (`session_id = ?` / `session_id IN (…)`).
 */
export function matchesRequestSessionFilter(
  filter: string | readonly string[] | undefined,
  recordSessionId: string | undefined
): boolean {
  if (filter === undefined) return true;
  if (Array.isArray(filter)) return recordSessionId !== undefined && filter.includes(recordSessionId);
  return recordSessionId === filter;
}

export function applyOffsetLimit<TValue>(
  values: TValue[],
  options: { offset?: number; limit?: number } | undefined
): TValue[] {
  const offset = Math.max(0, options?.offset ?? 0);
  const limit = options?.limit;
  const sliced = values.slice(offset);

  if (limit === undefined) {
    return sliced;
  }

  return sliced.slice(0, Math.max(0, limit));
}

/**
 * Backfill `source` on records persisted before FIX-438 added the field.
 * New writes always carry it; this guard runs at every read site so callers
 * see a complete record without having to re-handle the historical default.
 */
export function withRequestSourceDefault<T extends RequestRecord | undefined>(
  record: T
): T {
  if (record === undefined) return record;
  if (typeof (record as RequestRecord).source === "string") return record;
  return { ...(record as RequestRecord), source: "http" } as T;
}

/**
 * Force a request record's `abortRequested` to the value already stored,
 * whatever the incoming record says (FIX-1026).
 *
 * The single helper behind `RequestStore.set`'s rule that the flag is off its
 * write surface in both directions. Adapters call it on the value they are
 * about to persist, passing the stored flag they just read; `undefined` drops
 * the key so a record that never carried it does not gain one.
 *
 * Kept here rather than inlined per adapter so the four implementations cannot
 * drift into three subtly different readings of "ignores".
 */
export function withStoredAbortRequested<T extends RequestRecord>(
  value: T,
  stored: boolean | undefined
): T {
  if (stored === undefined) {
    if (value.abortRequested === undefined) return value;
    const { abortRequested: _dropped, ...rest } = value;
    return rest as T;
  }
  if (value.abortRequested === stored) return value;
  return { ...value, abortRequested: stored };
}

export function withActiveRequestSourceDefault<T extends ActiveRequestEntry | undefined>(
  entry: T
): T {
  if (entry === undefined) return entry;
  if (typeof (entry as ActiveRequestEntry).source === "string") return entry;
  return { ...(entry as ActiveRequestEntry), source: "http" } as T;
}

/**
 * Read a request registry's cross-process sharedness declaration, fail-closed
 * (FIX-999).
 *
 * An adapter compiled against the contract before the declaration existed
 * reports `undefined`, and this returns `false` for it — the `== null` guard
 * BP-030 asks for. The direction matters: liveness answers "is this request
 * running?" from registry entries, and on a per-process registry another
 * process's healthy request is simply absent. Guessing `true` would report live
 * work dead, which is the answer that causes double execution. Guessing `false`
 * only refuses the verb, which an operator can see.
 */
export function isRegistrySharedAcrossProcesses(
  registry: Pick<ActiveRequestRegistry, "sharedAcrossProcesses">
): boolean {
  return registry.sharedAcrossProcesses === true;
}

/**
 * Guard the depth of a field path for `patchField` / `deleteField`.
 *
 * Both the in-memory and filesystem stores support depth-1 and depth-2 paths
 * only; anything else is a caller bug, so it throws rather than writing a
 * shape the store cannot read back.
 */
export function assertMaxDepthTwo(path: string[], verb: string): void {
  if (path.length < 1 || path.length > 2) {
    throw new Error(
      `${verb} supports depth-1 or depth-2 paths; received path of length ${path.length}`
    );
  }
}

/**
 * A full-record `set` whose record carries no `items` keeps the items the
 * store holds (FIX-1735), on the stores that keep items on the record
 * (in-memory, filesystem). A state write in the middle of a run is built from
 * a snapshot that predates the items persisted since, so it leaves `items`
 * off rather than replace them; the SQL adapters keep items out of `set`
 * entirely, so the same write leaves theirs alone too. A record that does
 * carry `items` still replaces them.
 */
export function withHeldItems<T extends RequestRecord>(
  value: T,
  held: OutputItem[] | undefined
): T {
  if (value.items !== undefined || held === undefined) return value;
  return { ...value, items: held };
}

/**
 * Union two item logs by `id`, last write wins per id, in order: `prior` keeps
 * its positions and ids new in `next` append in `next`'s order. The
 * `RequestStore.persistItems` merge contract (FIX-811), shared by the runtime's
 * terminal write of a same-request continuation and the stores that hold
 * items on the record (in-memory, filesystem); the SQL adapters do the same
 * with an UPSERT.
 */
export function mergeItemsById(
  prior: readonly OutputItem[],
  next: readonly OutputItem[]
): OutputItem[] {
  const byId = new Map<string, OutputItem>();
  for (const item of prior) byId.set(item.id, item);
  for (const item of next) byId.set(item.id, item);
  return [...byId.values()];
}
