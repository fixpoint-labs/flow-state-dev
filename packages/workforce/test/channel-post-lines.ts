/**
 * Test helper: the lines a channel's posts left behind, read the way a client
 * reads them — the session's `channel-post` component items, in post order.
 *
 * A post's line is its item, not a copy in session state, so a test that asks
 * "did the post land" reads this rather than `state.transcript`. Reads the
 * request log straight out of the store, with no history window, so it sees
 * every post a session holds.
 */
import type { StoreRegistry } from "@flow-state-dev/engine";

/** One line as a `channel-post` item carries it. */
export type PostedLine = {
  id: string;
  at: number;
  principal?: string;
  author?: string;
  authorVerified: boolean;
  body: string;
};

/**
 * Every `channel-post` item on a session, oldest first.
 *
 * @param stores The host's stores.
 * @param sessionId The channel's session id.
 * @returns The item data, one per post that landed.
 */
export async function postedLines(stores: StoreRegistry, sessionId: string): Promise<PostedLine[]> {
  const requests = await stores.request.list({ sessionId, withItems: true, orderBy: "startedAtMs" });
  return [...requests]
    .sort((a, b) => a.startedAtMs - b.startedAtMs)
    .flatMap((request) => request.items ?? [])
    .filter(
      (item) =>
        item.type === "component" && (item as { component?: string }).component === "channel-post"
    )
    .map((item) => (item as unknown as { data: PostedLine }).data);
}

/**
 * Refuse the event write of the first `channel-post` line whose body contains
 * `marker`, as a store that failed that one write would: the line's emission
 * rejects and the request that posted it fails, while the request's own
 * record, written as it fails, still keeps the line as an item.
 *
 * @param stores The host's stores, patched in place.
 * @param marker Text the refused line's body contains.
 */
export function failLineWrite(stores: StoreRegistry, marker: string): void {
  let armed = true;
  const refusing = new Set<string>();
  const persistEvents = stores.request.persistEvents.bind(stores.request);
  const flushEvents = stores.request.flushEvents.bind(stores.request);
  stores.request.persistEvents = (requestId, events) => {
    const isLine = (event: (typeof events)[number]) => {
      const item = (event as { item?: { component?: string; data?: { body?: string } } }).item;
      return event.type === "item.added" && item?.component === "channel-post" && (item.data?.body ?? "").includes(marker);
    };
    if (armed && events.some(isLine)) {
      armed = false;
      refusing.add(requestId);
      return;
    }
    persistEvents(requestId, events);
  };
  stores.request.flushEvents = async (requestId) => {
    if (refusing.delete(requestId)) throw new Error("the store could not keep the line");
    return flushEvents(requestId);
  };
}
