// @vitest-environment happy-dom
// FIX-2625.
/**
 * One change to a collection reads its list once. A change reaches the hook
 * twice: as a `resourceChanges` entry naming its path, then as the
 * snapshot's count moving once the session reads its state, a few
 * milliseconds later. Read on both and a screen pays two list reads for one
 * write. No read is ever skipped: the hook holds each signal for a short
 * window and reads once after the last one, and at least once per cap while
 * signals keep coming. A read that skipped would need proof it covered the
 * change, which the server can't give.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor, type RenderHookResult } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { FlowProvider, useResourceCollectionList } from "../src";
import { LIST_SIGNAL_CAP_MS, LIST_SIGNAL_WINDOW_MS } from "../src/hooks/useResourceCollection";
import type { SessionView } from "../src/hooks/useSession";

const REF = "docs";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The fields `useResourceCollection` reads: the changes it has heard, and the snapshot's count. */
function view(count: number, changes: string[]): SessionView {
  return {
    sessionId: "s1",
    resourceChanges: changes.map((resourcePath) => ({ resourcePath })),
    snapshot: { sessionId: "s1", flowKind: "test", clientData: {}, resources: { session: { [REF]: { count } } } }
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

type Listed = RenderHookResult<ReturnType<typeof useResourceCollectionList>, { session: SessionView }>;

/** Let `ms` pass on the fake clock, and every read that lands meanwhile settle. */
async function pass(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Mount a list over `stored` on the fake clock, settled on its first read. */
async function mountTimed(stored: string[]) {
  vi.useFakeTimers();
  const reads = server(stored);
  const hook: Listed = renderHook(({ session }: { session: SessionView }) => useResourceCollectionList(session, REF), {
    wrapper,
    initialProps: { session: view(stored.length, []) }
  });
  await pass(0);
  await pass(0);
  expect(hook.result.current.items.map((i) => i.topic)).toEqual(stored);
  return { reads, hook, shown: () => hook.result.current.items.map((i) => i.topic) };
}

describe("a collection list's change signals, on the clock", () => {
  it("costs one read for the two signals of one change inside the window", async () => {
    const stored = ["a"];
    const { reads, hook, shown } = await mountTimed(stored);
    const before = reads.length;
    stored.push("b");
    hook.rerender({ session: view(1, ["docs/b"]) });
    await pass(10);
    hook.rerender({ session: view(2, ["docs/b"]) });
    await pass(LIST_SIGNAL_WINDOW_MS + 10);
    expect(reads.length - before).toBe(1);
    expect(shown()).toEqual(["a", "b"]);
  });

  it("reads twice for signals further apart than the window, and ends on the store", async () => {
    const stored = ["a"];
    const { reads, hook, shown } = await mountTimed(stored);
    const before = reads.length;
    stored.push("b");
    hook.rerender({ session: view(1, ["docs/b"]) });
    await pass(LIST_SIGNAL_WINDOW_MS + 10);
    expect(shown()).toEqual(["a", "b"]);
    // Another session's write, which no entry names, and the count that says so.
    stored.splice(0, stored.length, "b", "c");
    hook.rerender({ session: view(2, ["docs/b"]) });
    await pass(LIST_SIGNAL_WINDOW_MS + 10);
    expect(reads.length - before).toBe(2);
    expect(shown()).toEqual(["b", "c"]);
  });

  it("ends on the latest entries when the count arrives before the change's entry", async () => {
    const stored = ["a"];
    const { reads, hook, shown } = await mountTimed(stored);
    const before = reads.length;
    stored.push("b", "c");
    hook.rerender({ session: view(3, []) });
    await pass(5);
    hook.rerender({ session: view(3, ["docs/c"]) });
    await pass(LIST_SIGNAL_WINDOW_MS + 10);
    expect(shown()).toEqual(["a", "b", "c"]);
    expect(reads.length - before).toBe(1);
  });

  it("reads by the cap while signals keep coming", async () => {
    const stored = ["a"];
    const { reads, hook } = await mountTimed(stored);
    const before = reads.length;
    const changes: string[] = [];
    // A signal every half window, never a quiet window to end on.
    for (let at = 0; at <= LIST_SIGNAL_CAP_MS; at += LIST_SIGNAL_WINDOW_MS / 2) {
      stored.push(`e${at}`);
      changes.push(`docs/e${at}`);
      hook.rerender({ session: view(1, [...changes]) });
      await pass(LIST_SIGNAL_WINDOW_MS / 2);
    }
    expect(reads.length - before).toBeGreaterThanOrEqual(1);
  });
});

describe("a collection list, for one change", () => {
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
    rerender({ session: view(2, ["docs/b"]) });
    await waitFor(() => expect(result.current.items.map((i) => i.topic)).toEqual(["b", "c"]));
    expect(reads.length - before).toBe(1);
  });
  // The server serving a list before a state read sent first needs the real session view:
  // `useSession-scope-notices.test.ts`.
});
