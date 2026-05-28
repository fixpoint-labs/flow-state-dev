/**
 * Keyset pagination helper for the SQLite adapter's in-memory content and
 * resource-state stores. Implements the `getByPrefixPaged` store contract:
 * sort lexicographically by key (ascending by default, descending when
 * `order === "desc"`), apply the exclusive `after` bound (`key > after` for
 * asc, `key < after` for desc), then slice to `limit`.
 *
 * nextCursor follows the uniform keyset rule shared by every store adapter:
 * `items.length === limit ? lastKey : undefined`. A full page implies there
 * may be more (callers page again); a short/empty page signals the end. This
 * can yield one extra empty page at an exact boundary, which the contract
 * permits.
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
