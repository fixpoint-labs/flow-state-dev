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
