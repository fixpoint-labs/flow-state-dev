import type { ActiveRequestEntry, ActiveRequestRegistry, RequestRecord } from "./types";

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
