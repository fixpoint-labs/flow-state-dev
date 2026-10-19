// @vitest-environment happy-dom
/**
 * A collection read belongs to one identity: the transport (client), the
 * session, and the collection ref. Pages read under one identity must never be
 * served to another, and a response that lands after its identity has been
 * left must never be written where the new identity will read it.
 *
 * The hazard is silent: two sessions holding a same-named collection with the
 * same item count used to share one page cache, so switching session showed
 * the previous session's items and made no request at all. These tests drive
 * the real hook and the real resource client against a stubbed `fetch`, so a
 * cache that stops keying on identity fails here by serving the wrong rows.
 */
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
