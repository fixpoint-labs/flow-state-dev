// A stand-in for the page's shared session feed (`useSharedSessionFeed`), for a component test:
// `vi.mock("../src/lib/session-feeds", async () => (await import("./helpers/fake-feed")).fakeFeeds(...))`.
import { useEffect, useState } from "react";

/** Where a fake feed reports: what its first read answered, what a case pushes, and a failure. */
export type FakeFeed = {
  sessionId: string;
  closed: boolean;
  onRead(read: { items: unknown[]; truncated: boolean; loadEarlier?: () => Promise<void> }): void;
  onFailure(failure: { message: string }): void;
};

/**
 * The session-feeds module with a hook whose first answer is `read(sessionId)`'s (when given), and
 * each feed it opens pushed to `opened`. A failure after items landed keeps them, as the feed does.
 */
export function fakeFeeds(opened: FakeFeed[], read?: (sessionId: string) => unknown) {
  return {
    useSharedSessionFeed: (sessionId: string | null | undefined) => {
      const [held, setHeld] = useState<{ sessionId: string; items?: unknown[]; hasEarlier: boolean; loadEarlier: () => Promise<void>; error: Error | null }>();
      useEffect(() => {
        if (sessionId == null) return;
        const entry: FakeFeed = {
          sessionId,
          closed: false,
          onRead: (got) => {
            if (!entry.closed) setHeld({ sessionId, items: got.items, hasEarlier: got.truncated, loadEarlier: got.loadEarlier ?? (async () => {}), error: null });
          },
          onFailure: (why) => {
            if (!entry.closed) setHeld((was) => (was?.items !== undefined ? was : { sessionId, hasEarlier: false, loadEarlier: async () => {}, error: new Error(why.message) }));
          },
        };
        opened.push(entry);
        if (read !== undefined) {
          Promise.resolve(read(sessionId)).then(
            (got) => entry.onRead(got as never),
            (error: unknown) => entry.onFailure({ message: error instanceof Error ? error.message : String(error) }),
          );
        }
        return () => void (entry.closed = true);
      }, [sessionId]);
      return held === undefined || held.sessionId !== sessionId ? undefined : { ...held, state: "live", runs: null, followResponse: () => {} };
    },
  };
}
