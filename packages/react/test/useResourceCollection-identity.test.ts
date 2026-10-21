// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import type { CollectionListPage } from "@flow-state-dev/client";
import {
  FlowProvider,
  useResourceCollection,
  useResourceCollectionItem,
  useResourceCollectionList
} from "../src";
import type { SessionView } from "../src/hooks/useSession";

const REF = "docs";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The fields `useResourceCollection` reads; the rest of the view is irrelevant to it. */
function sessionView(sessionId: string | undefined, count = 1): SessionView {
  return {
    sessionId,
    resourceChanges: [],
    snapshot: sessionId === undefined
      ? null
      : { sessionId, flowKind: "test", clientData: {}, resources: { session: { [REF]: { count } } } }
  } as unknown as SessionView;
}

/**
 * The view `useSession` gives right after a switch: the new session's id, the
 * old session's snapshot still in place until the new one is read. `entry` is
 * that old snapshot's collection entry, so it can carry `prefetched` and `live`.
 */
function switchedView(sessionId: string, snapshotOf: string, entry: Record<string, unknown>): SessionView {
  return {
    sessionId,
    resourceChanges: [],
    snapshot: { sessionId: snapshotOf, flowKind: "test", clientData: {}, resources: { session: { [REF]: entry } } }
  } as unknown as SessionView;
}

type Pending = { url: URL; resolve: (page: CollectionListPage) => void };

/**
 * Stub `fetch` for collection list reads. Each request is recorded; by default
 * it answers at once with one item named after the host and session it was
 * asked of, so a row says which identity it was read under. With `hold`, the
 * request stays open until the test resolves it.
 */
function stubListFetch(options: { hold?: boolean } = {}) {
  const requests: URL[] = [];
  const pending: Pending[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requests.push(url);
      const respond = (page: CollectionListPage) =>
        new Response(JSON.stringify(page), { status: 200, headers: { "content-type": "application/json" } });
      if (options.hold) {
        return new Promise<Response>((resolve) => {
          pending.push({ url, resolve: (page) => resolve(respond(page)) });
        });
      }
      return Promise.resolve(respond({ items: [{ topic: topicFor(url) }] }));
    })
  );
  return { requests, pending };
}

/** `<host>:<sessionId>` — which identity a stubbed row was read under. */
function topicFor(url: URL): string {
  const sessionId = url.pathname.split("/sessions/")[1]!.split("/")[0]!;
  return `${url.host}:${sessionId}`;
}

let baseUrl = "https://one.test";
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(FlowProvider, { flowKind: "test", userId: "u1", baseUrl, children });

function mountCollection(sessionId: string | undefined, count = 1) {
  baseUrl = "https://one.test";
  return renderHook(
    ({ session }: { session: SessionView }) => useResourceCollection(session, REF),
    { wrapper, initialProps: { session: sessionView(sessionId, count) } }
  );
}

describe("useResourceCollection read identity", () => {
  it("reads the new session's items after a switch between collections of equal count", async () => {
    const { requests } = stubListFetch();
    const { result, rerender } = mountCollection("session-a");

    const first = await result.current.list();
    expect(first.items.map((i) => i.topic)).toEqual(["one.test:session-a"]);

    rerender({ session: sessionView("session-b") });
    const second = await result.current.list();

    expect(second.items.map((i) => i.topic)).toEqual(["one.test:session-b"]);
    expect(requests).toHaveLength(2);
  });

  it("still serves a repeat read of the same identity from cache", async () => {
    const { requests } = stubListFetch();
    const { result } = mountCollection("session-a");

    await result.current.list();
    await result.current.list();

    expect(requests).toHaveLength(1);
  });

  it("reads again when the client is rebuilt on a new baseUrl under the same session", async () => {
    const { requests } = stubListFetch();
    const { result, rerender } = mountCollection("session-a");

    await result.current.list();
    baseUrl = "https://two.test";
    rerender({ session: sessionView("session-a") });
    const page = await result.current.list();

    expect(page.items.map((i) => i.topic)).toEqual(["two.test:session-a"]);
    expect(requests).toHaveLength(2);
  });

  it("does not write a late response from the session just left into the new session's cache", async () => {
    const { requests, pending } = stubListFetch({ hold: true });
    const { result, rerender } = mountCollection("session-a");

    const late = result.current.list();
    await waitFor(() => expect(pending).toHaveLength(1));

    rerender({ session: sessionView("session-b") });
    const fromB = result.current.list();
    await waitFor(() => expect(pending).toHaveLength(2));
    pending[1]!.resolve({ items: [{ topic: "from-b" }] });
    expect((await fromB).items.map((i) => i.topic)).toEqual(["from-b"]);

    // A's response lands only now, after B's page is cached under the same query.
    await act(async () => {
      pending[0]!.resolve({ items: [{ topic: "late-from-a" }] });
      await late;
    });

    const again = await result.current.list();
    expect(again.items.map((i) => i.topic)).toEqual(["from-b"]);
    expect(requests.map(topicFor)).toEqual(["one.test:session-a", "one.test:session-b"]);
  });

  it("does not let a stale list() from the session just left read or fill the new session's cache", async () => {
    const { requests } = stubListFetch();
    const { result, rerender } = mountCollection("session-a");
    const staleList = result.current.list;

    rerender({ session: sessionView("session-b") });
    const fresh = await result.current.list();
    expect(fresh.items.map((i) => i.topic)).toEqual(["one.test:session-b"]);

    // A caller still holding A's callback gets A's rows, not B's cached page...
    const stale = await staleList();
    expect(stale.items.map((i) => i.topic)).toEqual(["one.test:session-a"]);

    // ...and leaves B's cache as it found it.
    const again = await result.current.list();
    expect(again.items.map((i) => i.topic)).toEqual(["one.test:session-b"]);
    expect(requests.map(topicFor)).toEqual(["one.test:session-b", "one.test:session-a"]);
  });

  it("does not keep a response from an earlier visit when the switches return to the same session", async () => {
    const { pending } = stubListFetch({ hold: true });
    const { result, rerender } = mountCollection("session-a");

    const firstVisit = result.current.list();
    await waitFor(() => expect(pending).toHaveLength(1));

    rerender({ session: sessionView("session-b") });
    rerender({ session: sessionView("session-a") });

    const secondVisit = result.current.list();
    await waitFor(() => expect(pending).toHaveLength(2));
    pending[1]!.resolve({ items: [{ topic: "a-second-visit" }] });
    expect((await secondVisit).items.map((i) => i.topic)).toEqual(["a-second-visit"]);

    // The first visit's response lands last; it must not replace the second's.
    await act(async () => {
      pending[0]!.resolve({ items: [{ topic: "a-first-visit" }] });
      await firstVisit;
    });

    const again = await result.current.list();
    expect(again.items.map((i) => i.topic)).toEqual(["a-second-visit"]);
    expect(pending).toHaveLength(2);
  });

  it("asks for nothing while there is no session, and reads once one arrives", async () => {
    const { requests } = stubListFetch();
    const { result, rerender } = mountCollection(undefined);

    expect(await result.current.list()).toEqual({ items: [] });
    expect(requests).toHaveLength(0);

    rerender({ session: sessionView("session-a") });
    const page = await result.current.list();
    expect(page.items.map((i) => i.topic)).toEqual(["one.test:session-a"]);
  });
});

describe("useResourceCollectionList across a session switch", () => {
  const mountList = () => {
    baseUrl = "https://one.test";
    return renderHook(
      ({ session }: { session: SessionView }) => useResourceCollectionList(session, REF),
      { wrapper, initialProps: { session: sessionView("session-a") } }
    );
  };

  it("does not show the old session's rows while the new session's page loads", async () => {
    const { pending } = stubListFetch({ hold: true });
    const { result, rerender } = mountList();
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => {
      pending[0]!.resolve({ items: [{ topic: "from-a" }] });
    });
    expect(result.current.items.map((i) => i.topic)).toEqual(["from-a"]);

    rerender({ session: sessionView("session-b") });

    expect(result.current.items).toEqual([]);
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => {
      pending[1]!.resolve({ items: [{ topic: "from-b" }] });
    });
    expect(result.current.items.map((i) => i.topic)).toEqual(["from-b"]);
  });

  it("keeps the rows on screen while the same collection refetches", async () => {
    const { pending } = stubListFetch({ hold: true });
    const { result } = mountList();
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => {
      pending[0]!.resolve({ items: [{ topic: "from-a" }] });
    });

    act(() => result.current.refetch());

    expect(result.current.items.map((i) => i.topic)).toEqual(["from-a"]);
  });

  it("does not show the old session's prefetched or live rows before the new session's snapshot arrives", async () => {
    // Held open, so the list shows only the snapshot's rows.
    stubListFetch({ hold: true });
    const fromA = { count: 2, prefetched: [{ topic: "prefetched-a" }], live: { "live-a": { clientData: {} } } };
    const { result, rerender } = renderHook(
      ({ session }: { session: SessionView }) => useResourceCollectionList(session, REF),
      { wrapper, initialProps: { session: switchedView("session-a", "session-a", fromA) } }
    );
    expect(result.current.items.map((i) => i.topic)).toEqual(["prefetched-a", "live-a"]);

    rerender({ session: switchedView("session-b", "session-a", fromA) });

    expect(result.current.items).toEqual([]);
    expect(result.current.hasMore).toBe(false);
  });

  it("loads the next page from the refreshed first page, not the one a refresh replaced", async () => {
    const { pending } = stubListFetch({ hold: true });
    const { result, rerender } = mountList();
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => {
      pending[0]!.resolve({ items: [{ topic: "old-first" }], nextCursor: "old-cursor" });
    });

    // A change to the collection lands, so the first page is read again.
    const changed = { ...sessionView("session-a"), resourceChanges: [{ resourcePath: `${REF}/x` }] };
    rerender({ session: changed as unknown as SessionView });
    await waitFor(() => expect(pending).toHaveLength(2));
    // Paging while the refresh is still in flight must not discard it.
    act(() => result.current.loadMore());
    await act(async () => {
      pending[1]!.resolve({ items: [{ topic: "new-first" }], nextCursor: "new-cursor" });
    });

    expect(result.current.items.map((i) => i.topic)).toEqual(["new-first"]);
    expect(pending.map((p) => p.url.searchParams.get("cursor"))).toEqual([null, null]);
  });

  it("shows the new session's items even when the old session's page lands last", async () => {
    const { pending } = stubListFetch({ hold: true });
    const { result, rerender } = mountList();
    await waitFor(() => expect(pending).toHaveLength(1));

    rerender({ session: sessionView("session-b") });
    await waitFor(() => expect(pending).toHaveLength(2));

    await act(async () => {
      pending[1]!.resolve({ items: [{ topic: "from-b" }] });
    });
    await act(async () => {
      pending[0]!.resolve({ items: [{ topic: "late-from-a" }] });
    });

    expect(result.current.items.map((i) => i.topic)).toEqual(["from-b"]);
    expect(result.current.isLoading).toBe(false);
  });
});

describe("useResourceCollectionItem across a session switch", () => {
  it("does not show the old session's item while the new session's item loads", async () => {
    const { pending } = stubListFetch({ hold: true });
    baseUrl = "https://one.test";
    const { result, rerender } = renderHook(
      ({ session }: { session: SessionView }) => useResourceCollectionItem(session, REF, "t1"),
      { wrapper, initialProps: { session: sessionView("session-a") } }
    );
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => {
      pending[0]!.resolve({ topic: "t1", clientData: { from: "a" } } as unknown as CollectionListPage);
    });
    expect(result.current.item?.clientData).toEqual({ from: "a" });

    rerender({ session: sessionView("session-b") });

    expect(result.current.item).toBeNull();
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => {
      pending[1]!.resolve({ topic: "t1", clientData: { from: "b" } } as unknown as CollectionListPage);
    });
    expect(result.current.item?.clientData).toEqual({ from: "b" });
  });

  it("does not rebuild the old session's item from its live overlay after a switch", async () => {
    stubListFetch({ hold: true });
    baseUrl = "https://one.test";
    const fromA = { count: 1, live: { t1: { clientData: { from: "a-live" } } } };
    const { result, rerender } = renderHook(
      ({ session }: { session: SessionView }) => useResourceCollectionItem(session, REF, "t1"),
      { wrapper, initialProps: { session: switchedView("session-a", "session-a", fromA) } }
    );
    expect(result.current.item?.clientData).toEqual({ from: "a-live" });

    rerender({ session: switchedView("session-b", "session-a", fromA) });

    expect(result.current.item).toBeNull();
  });

  it("does not show the old session's error after a switch", async () => {
    let fail = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => (fail ? Promise.resolve(new Response("boom", { status: 500 })) : new Promise<Response>(() => {})))
    );
    baseUrl = "https://one.test";
    const renders: { sessionId: string | undefined; error: Error | undefined }[] = [];
    const { result, rerender } = renderHook(
      ({ session }: { session: SessionView }) => {
        const view = useResourceCollectionItem(session, REF, "t1");
        renders.push({ sessionId: session.sessionId, error: view.error });
        return view;
      },
      { wrapper, initialProps: { session: sessionView("session-a") } }
    );
    await waitFor(() => expect(result.current.error).toBeDefined());

    fail = false;
    rerender({ session: sessionView("session-b") });

    // Every render, not only the last: the switch's first render runs before any effect clears state.
    expect(renders.filter((r) => r.sessionId === "session-b").map((r) => r.error)).toEqual(
      renders.filter((r) => r.sessionId === "session-b").map(() => undefined)
    );
    expect(result.current.isLoading).toBe(true);
  });

  it("keeps the newest read when two refetches of the same item overlap", async () => {
    const { pending } = stubListFetch({ hold: true });
    baseUrl = "https://one.test";
    const { result } = renderHook(
      ({ session }: { session: SessionView }) => useResourceCollectionItem(session, REF, "t1"),
      { wrapper, initialProps: { session: sessionView("session-a") } }
    );
    await waitFor(() => expect(pending).toHaveLength(1));
    act(() => result.current.refetch());
    await waitFor(() => expect(pending).toHaveLength(2));

    await act(async () => {
      pending[1]!.resolve({ topic: "t1", clientData: { read: "newer" } } as unknown as CollectionListPage);
    });
    await act(async () => {
      pending[0]!.resolve({ topic: "t1", clientData: { read: "older" } } as unknown as CollectionListPage);
    });

    expect(result.current.item?.clientData).toEqual({ read: "newer" });
  });

  it("stops loading when the first read fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    baseUrl = "https://one.test";
    const { result } = renderHook(
      ({ session }: { session: SessionView }) => useResourceCollectionItem(session, REF, "t1"),
      { wrapper, initialProps: { session: sessionView("session-a") } }
    );

    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.isLoading).toBe(false);
    expect(result.current.item).toBeNull();
  });
});
