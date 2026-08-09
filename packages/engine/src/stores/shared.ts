import type { ActiveRequestEntry, RequestRecord } from "./types";

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
