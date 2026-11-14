// @vitest-environment happy-dom
// FIX-2625.
/**
 * One change to a collection reads its list once. A change reaches the hook
 * twice: as a `resourceChanges` entry naming its path, then as the
 * snapshot's count moving once the session reads its state. Read on both and
 * a screen pays two list reads for one write; the count is the fallback for a
 * change no entry named, so a list whose read started after the count's was
 * is not read again. A count from a snapshot read after the list, or one no
 * read marked, reads again: its entries may differ at the same length.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { FlowProvider, useResourceCollectionList } from "../src";
import type { SessionView } from "../src/hooks/useSession";
import { markSnapshotRead, nextReadPosition } from "../src/hooks/read-position";

const REF = "docs";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * The fields `useResourceCollection` reads: the changes it has heard, and the
 * snapshot's count; `readAt` marks the snapshot with where its read started,
 * as `useSession` does.
 */
function view(count: number, changes: string[], readAt?: number): SessionView {
  const snapshot = { sessionId: "s1", flowKind: "test", clientData: {}, resources: { session: { [REF]: { count } } } };
  return {
    sessionId: "s1",
    resourceChanges: changes.map((resourcePath) => ({ resourcePath })),
    snapshot: readAt === undefined ? snapshot : markSnapshotRead(snapshot, readAt)
  } as unknown as SessionView;
}

/** A server holding `stored` entries; every list read is counted. */
function server(stored: string[]) {
  const reads: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      if (url.pathname.endsWith("/manifest")) return Promise.resolve(json({ flowKind: "", resources: [] }));
      reads.push(url);
      return Promise.resolve(json({ items: stored.map((topic) => ({ topic })) }));
    })
  );
  return reads;
}

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(FlowProvider, { flowKind: "test", userId: "u1", baseUrl: "https://one.test", children });

describe("a collection list, for one change", () => {
  it("reads once when the change's entry and the count it moved arrive one after the other", async () => {
    const stored = ["a"];
    const reads = server(stored);
    const { result, rerender } = renderHook(({ session }: { session: SessionView }) => useResourceCollectionList(session, REF), {
      wrapper,
      initialProps: { session: view(1, []) }
    });
    await waitFor(() => expect(result.current.items.map((i) => i.topic)).toEqual(["a"]));
    const before = reads.length;

    // One write: the entry lands, and the session starts reading its state.
    stored.push("b");
    const stateRead = nextReadPosition();
    // The change names the entry, and the list reads it.
    rerender({ session: view(1, ["docs/b"]) });
    await waitFor(() => expect(result.current.items.map((i) => i.topic)).toEqual(["a", "b"]));
    // Then the state read lands and moves the count, for the same write.
    rerender({ session: view(2, ["docs/b"], stateRead) });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(reads.length - before).toBe(1);
  });

  it("still reads when only the count moves, a change no entry named", async () => {
    const stored = ["a"];
    const reads = server(stored);
    const { result, rerender } = renderHook(({ session }: { session: SessionView }) => useResourceCollectionList(session, REF), {
      wrapper,
      initialProps: { session: view(1, []) }
    });
    await waitFor(() => expect(result.current.items.map((i) => i.topic)).toEqual(["a"]));
    const before = reads.length;

    stored.push("b");
    rerender({ session: view(2, []) });
    await waitFor(() => expect(result.current.items.map((i) => i.topic)).toEqual(["a", "b"]));
    expect(reads.length - before).toBe(1);
  });

  it("reads again when the count moves past what the list read after the change holds", async () => {
    const stored = ["a"];
    const reads = server(stored);
    const { result, rerender } = renderHook(({ session }: { session: SessionView }) => useResourceCollectionList(session, REF), {
      wrapper,
      initialProps: { session: view(1, []) }
    });
    await waitFor(() => expect(result.current.items.map((i) => i.topic)).toEqual(["a"]));

    stored.push("b");
    rerender({ session: view(1, ["docs/b"]) });
    await waitFor(() => expect(result.current.items.map((i) => i.topic)).toEqual(["a", "b"]));
    // A second write no entry named: the count says three.
    stored.push("c");
    rerender({ session: view(3, ["docs/b"]) });
    await waitFor(() => expect(result.current.items.map((i) => i.topic)).toEqual(["a", "b", "c"]));
    expect(reads.length).toBeGreaterThanOrEqual(3);
  });

  // Gitar on #5232: a count that lands on the length read says nothing of the entries.
  it("reads again when a change no entry named keeps the count at the length read but changes the entries", async () => {
    const stored = ["a"];
    const reads = server(stored);
    const { result, rerender } = renderHook(({ session }: { session: SessionView }) => useResourceCollectionList(session, REF), {
      wrapper,
      initialProps: { session: view(1, []) }
    });
    await waitFor(() => expect(result.current.items.map((i) => i.topic)).toEqual(["a"]));

    // A named change creates b, and the list reads [a, b].
    stored.push("b");
    rerender({ session: view(1, ["docs/b"]) });
    await waitFor(() => expect(result.current.items.map((i) => i.topic)).toEqual(["a", "b"]));
    const before = reads.length;
    // Another session's write, which no entry names: a goes, c comes. The state
    // read that sees it starts after the list's, and moves the count 1 to 2.
    stored.splice(0, stored.length, "b", "c");
    rerender({ session: view(2, ["docs/b"], nextReadPosition()) });
    await waitFor(() => expect(result.current.items.map((i) => i.topic)).toEqual(["b", "c"]));
    expect(reads.length - before).toBe(1);
  });
});
