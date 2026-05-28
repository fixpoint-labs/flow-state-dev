import type { ActiveRequestEntry, RequestRecord } from "./types";

/**
 * Keyset-paginate an in-memory set of `{ key, value }` entries for the
 * `getByPrefixPaged` store contract. Sorts lexicographically by key (ascending
 * by default, descending when `order === "desc"`), applies the exclusive
 * `after` bound (`key > after` for asc, `key < after` for desc), then slices to
 * `limit`.
 *
 * nextCursor follows the uniform keyset rule shared by every adapter:
 * `items.length === limit ? lastKey : undefined`. A full page implies there may
 * be more (callers page again); a short/empty page signals the end. This can
 * yield one extra empty page at an exact boundary, which the contract permits.
 */
export function pageEntries<TValue>(
  matches: Array<{ key: string; value: TValue }>,
  opts: { limit: number; after?: string; order?: "asc" | "desc" }
): { items: Array<{ key: string; value: TValue }>; nextCursor?: string } {
  const order = opts.order ?? "asc";
  matches.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (order === "desc") {
    matches.reverse();
  }

  const bounded =
    opts.after === undefined
      ? matches
      : matches.filter((entry) =>
          order === "asc" ? entry.key > opts.after! : entry.key < opts.after!
        );

  const items = bounded.slice(0, Math.max(0, opts.limit));
  const nextCursor =
    items.length === opts.limit && opts.limit > 0
      ? items[items.length - 1]!.key
      : undefined;
  return { items, nextCursor };
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

export function withActiveRequestSourceDefault<T extends ActiveRequestEntry | undefined>(
  entry: T
): T {
  if (entry === undefined) return entry;
  if (typeof (entry as ActiveRequestEntry).source === "string") return entry;
  return { ...(entry as ActiveRequestEntry), source: "http" } as T;
}
