// @vitest-environment happy-dom
/**
 * `useSessionFeed` holds the client's `sessionFeed` for the session a screen
 * shows: one feed per session id, closed when the id changes or the screen
 * goes, and `items` left `undefined` until the history read lands, so a
 * screen can tell "nothing yet" from "nothing there". The client's feed is
 * stood in for here, so each test drives the snapshots it hands the hook.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { SessionFeedSnapshot } from "@flow-state-dev/client";

type Fake = {
  sessionId: string;
  options: { itemTypes?: string[] };
  closed: boolean;
  followed: Response[];
  push(snapshot: Partial<SessionFeedSnapshot>): void;
};

const { feeds } = vi.hoisted(() => ({ feeds: [] as Fake[] }));

vi.mock("@flow-state-dev/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/client")>();
  return {
    ...actual,
    sessionFeed: (_client: unknown, sessionId: string, options: { itemTypes?: string[] }) => {
      let snapshot: SessionFeedSnapshot = { items: [], hasEarlier: false, historyLoaded: false, runs: null, state: "connecting", error: null };
      const listeners = new Set<() => void>();
      const fake: Fake = {
        sessionId,
        options,
        closed: false,
        followed: [],
        push(next) {
          snapshot = { ...snapshot, ...next };
          for (const tell of [...listeners]) tell();
        },
      };
      feeds.push(fake);
      return {
        getSnapshot: () => snapshot,
        subscribe(listener: () => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        followResponse(response: Response) {
          fake.followed.push(response);
        },
        loadEarlier: async () => {},
        close() {
          fake.closed = true;
        },
      };
    },
  };
});

import { useSessionFeed } from "../src/hooks/useSessionFeed";

const client = { sessions: {} } as never;
const message = (id: string) => ({ id, type: "message", status: "completed" }) as never;

afterEach(() => {
  cleanup();
  feeds.length = 0;
});

describe("useSessionFeed", () => {
  it("follows nothing without a session id", () => {
    const { result } = renderHook(() => useSessionFeed(null, { client }));
    expect(result.current).toBeUndefined();
    expect(feeds).toEqual([]);
  });

  it("leaves items undefined until the history lands, then shows them with the connection's state", () => {
    const { result } = renderHook(() => useSessionFeed("s1", { client, itemTypes: ["message"] }));
    expect(feeds.map((feed) => [feed.sessionId, feed.options.itemTypes])).toEqual([["s1", ["message"]]]);
    expect(result.current).toMatchObject({ sessionId: "s1", items: undefined, state: "connecting" });
    act(() => feeds[0]!.push({ items: [message("m1")], historyLoaded: true, state: "live", runs: [] }));
    expect(result.current).toMatchObject({ items: [{ id: "m1" }], state: "live", runs: [] });
  });

  it("shows an empty session as empty once its history is read, while the stream is still connecting", () => {
    const { result } = renderHook(() => useSessionFeed("s1", { client }));
    expect(result.current?.items).toBeUndefined();
    act(() => feeds[0]!.push({ historyLoaded: true }));
    expect(result.current).toMatchObject({ items: [], state: "connecting" });
  });

  it("hands a send's streamed response to the feed", () => {
    const { result } = renderHook(() => useSessionFeed("s1", { client }));
    const response = new Response("");
    result.current!.followResponse(response);
    expect(feeds[0]!.followed).toEqual([response]);
  });

  it("closes the old feed and opens one for a new session; an equal type list keeps it", () => {
    const { result, rerender, unmount } = renderHook(({ id, types }) => useSessionFeed(id, { client, itemTypes: types }), {
      initialProps: { id: "s1", types: ["message"] },
    });
    rerender({ id: "s1", types: ["message"] });
    expect(feeds).toHaveLength(1);
    rerender({ id: "s2", types: ["message"] });
    expect(feeds.map((feed) => [feed.sessionId, feed.closed])).toEqual([["s1", true], ["s2", false]]);
    expect(result.current?.sessionId).toBe("s2");
    unmount();
    expect(feeds[1]!.closed).toBe(true);
  });
});
