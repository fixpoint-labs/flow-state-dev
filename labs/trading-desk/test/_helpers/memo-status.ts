/**
 * Test seam for asserting memo lifecycle transitions.
 *
 * The memos collection is `client: { live: true }`, so every memo mutation
 * streams the full projected memo state inline as a transient `resource_change`
 * item (the channel that replaced the retired `memoStatus` session mirror —
 * FIX-750). These helpers read that stream back from a `testBlock` / `testFlow`
 * result's `items`, so a test asserts the SAME projected state the navigator
 * renders, against the memo resource rather than a shadow session field.
 *
 * `memoKey` is the full storage key (e.g. `memos/p1/fundamentals`), matching the
 * `memoKey` field on each `ALL_MEMO_KEYS` registry entry and the `resourcePath`
 * on the streamed delta.
 */

type ResourceChangeLike = {
  type?: string;
  resourcePath?: string;
  changeType?: string;
  delta?: Record<string, unknown> | null;
};

/** Latest projected memo state streamed for `memoKey`, or `undefined` if the
 *  memo never mutated in this run. Reverse-scans so the final transition wins
 *  (a memo may stream `pending → writing → published` within one run). */
export function latestMemoDelta(
  items: ReadonlyArray<unknown>,
  memoKey: string,
): Record<string, unknown> | undefined {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i] as ResourceChangeLike;
    if (item.type === "resource_change" && item.resourcePath === memoKey) {
      return item.delta ?? undefined;
    }
  }
  return undefined;
}

/** Latest streamed `status` for `memoKey` — the resource-backed replacement for
 *  the old `memoStatus[shortName]` read. */
export function latestMemoStatus(
  items: ReadonlyArray<unknown>,
  memoKey: string,
): string | undefined {
  return latestMemoDelta(items, memoKey)?.status as string | undefined;
}
