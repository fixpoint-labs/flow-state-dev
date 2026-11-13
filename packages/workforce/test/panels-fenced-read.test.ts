// @vitest-environment happy-dom
/**
 * Characterization of the fenced reads the workforce panels make: the
 * panels' row read and item read (the flow navigator's are in
 * `@flow-state-dev/react`'s own tests). Pinned before those reads were moved onto one shared internal read, and
 * left unedited since, so a behaviour change cannot pass as a refactor.
 *
 * The racing cases resolve their promises OUT OF ORDER on purpose. Resolved in
 * order, none of them can fail: the late response is the whole hazard.
 *
 * Rule ids (BR-n) are the cases in the spec's business rules, so a reader can
 * find the rule a red test is about.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { usePanelItem, usePanelRows } from "../src/react/components/reads";
import { Roster } from "../src/react/components/Roster";
import { FlowProvider } from "@flow-state-dev/react";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** One call held open until the test settles it. */
type Held<T> = {
  readonly args: unknown[];
  readonly release: (value: T) => void;
  readonly fail: (error: unknown) => void;
};

/** A method whose every call is held open, in call order, until the test settles it. */
function heldMethod<T>() {
  const calls: Held<T>[] = [];
  const fn = vi.fn(
    (...args: unknown[]) =>
      new Promise<T>((resolve, reject) => {
        calls.push({ args, release: resolve, fail: reject });
      })
  );
  return { calls, fn };
}

/** Let settled promises run their continuations and React commit what they wrote. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const page = (...topics: string[]) => ({
  items: topics.map((topic) => ({ topic, clientData: { topic } }))
});

function entrySource() {
  const { calls, fn } = heldMethod<ReturnType<typeof page>>();
  return { calls, listCollectionResources: fn, resources: { listCollectionResources: fn } };
}
function itemSource() {
  const { calls, fn } = heldMethod<{ topic: string; clientData?: unknown } | null>();
  return { calls, getCollectionResourceState: fn, resources: { getCollectionResourceState: fn } };
}

const topics = (entries: readonly { topic: string }[]) => entries.map((r) => r.topic);

// ---------------------------------------------------------------------------
// The flow list
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// The panels' row read
// ---------------------------------------------------------------------------

describe("usePanelRows · late and racing responses", () => {
  it("BR-1 · discards a response that lands after the session changed", async () => {
    const source = entrySource();
    const { result, rerender } = renderHook(
      ({ sessionId }) => usePanelRows(source as never, sessionId, "roster", undefined, "Panel failed"),
      { initialProps: { sessionId: "s1" } }
    );
    await waitFor(() => expect(source.calls).toHaveLength(1));
    rerender({ sessionId: "s2" });
    await waitFor(() => expect(source.calls).toHaveLength(2));

    await act(async () => source.calls[0]!.release(page("from-s1")));
    await settle();

    expect(result.current).toMatchObject({ rows: [], isLoading: true, error: null });
  });

  it("BR-2 · an older read resolving last never overwrites a newer one", async () => {
    const source = entrySource();
    const { result } = renderHook(() =>
      usePanelRows(source as never, "s1", "roster", undefined, "Panel failed")
    );
    await waitFor(() => expect(source.calls).toHaveLength(1));
    act(() => result.current.refresh());
    await waitFor(() => expect(source.calls).toHaveLength(2));

    await act(async () => source.calls[1]!.release(page("newer")));
    await act(async () => source.calls[0]!.release(page("older")));
    await settle();

    expect(topics(result.current.rows)).toEqual(["newer"]);
  });

  it("BR-3 · a failure after a newer read started is discarded", async () => {
    const source = entrySource();
    const { result } = renderHook(() =>
      usePanelRows(source as never, "s1", "roster", undefined, "Panel failed")
    );
    await waitFor(() => expect(source.calls).toHaveLength(1));
    act(() => result.current.refresh());
    await waitFor(() => expect(source.calls).toHaveLength(2));

    await act(async () => source.calls[0]!.fail(new Error("stale failure")));
    await settle();

    expect(result.current.error).toBeNull();
  });

  it("BR-4 · never returns the previous session's rows, not even for one render", async () => {
    const source = entrySource();
    const seen: Array<{ sessionId: string; entries: string[] }> = [];
    const { result, rerender } = renderHook(
      ({ sessionId }) => {
        const state = usePanelRows(source as never, sessionId, "roster", undefined, "Panel failed");
        seen.push({ sessionId, entries: topics(state.rows) });
        return state;
      },
      { initialProps: { sessionId: "s1" } }
    );
    await waitFor(() => expect(source.calls).toHaveLength(1));
    await act(async () => source.calls[0]!.release(page("from-s1")));
    await waitFor(() => expect(topics(result.current.rows)).toEqual(["from-s1"]));

    rerender({ sessionId: "s2" });
    await waitFor(() => expect(source.calls).toHaveLength(2));

    const underS2 = seen.filter((entry) => entry.sessionId === "s2");
    expect(underS2.length).toBeGreaterThan(0);
    expect(underS2.every((entry) => entry.entries.length === 0)).toBe(true);
  });
});

describe("usePanelRows · what it shows and when it asks", () => {
  it("BR-7 · a failure that is not an Error shows the panel's own text", async () => {
    const source = entrySource();
    const { result } = renderHook(() =>
      usePanelRows(source as never, "s1", "roster", undefined, "Failed to load the roster")
    );
    await waitFor(() => expect(source.calls).toHaveLength(1));
    await act(async () => source.calls[0]!.fail(undefined));
    await waitFor(() => expect(result.current.error).toBe("Failed to load the roster"));
  });

  it("BR-10 · a host re-render with the same identity sends no new request", async () => {
    const source = entrySource();
    const { rerender } = renderHook(
      // A new render each time, with the same values: nothing in the identity moved.
      (_: { tick: number }) => usePanelRows(source as never, "s1", "roster", 25, "Panel failed"),
      { initialProps: { tick: 0 } }
    );
    await settle();
    rerender({ tick: 1 });
    rerender({ tick: 2 });
    await settle();
    expect(source.listCollectionResources).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// The panels' item read
// ---------------------------------------------------------------------------

describe("usePanelItem · late and racing responses", () => {
  it("BR-1 · discards a response that lands after the topic changed", async () => {
    const source = itemSource();
    const { result, rerender } = renderHook(
      ({ topic }) => usePanelItem(source as never, "s1", "roster", topic, "Worker failed"),
      { initialProps: { topic: "worker-a" } }
    );
    await waitFor(() => expect(source.calls).toHaveLength(1));
    rerender({ topic: "worker-b" });
    await waitFor(() => expect(source.calls).toHaveLength(2));

    await act(async () => source.calls[0]!.release({ topic: "worker-a", clientData: { id: "a" } }));
    await settle();

    expect(result.current).toMatchObject({ item: null, isLoading: true, error: null });
  });

  it("BR-2 · an older read resolving last never overwrites a newer one", async () => {
    const source = itemSource();
    const { result } = renderHook(() =>
      usePanelItem<{ id: string }>(source as never, "s1", "roster", "worker-a", "Worker failed")
    );
    await waitFor(() => expect(source.calls).toHaveLength(1));
    act(() => result.current.refresh());
    await waitFor(() => expect(source.calls).toHaveLength(2));

    await act(async () => source.calls[1]!.release({ topic: "worker-a", clientData: { id: "newer" } }));
    await act(async () => source.calls[0]!.release({ topic: "worker-a", clientData: { id: "older" } }));
    await settle();

    expect(result.current.item).toEqual({ id: "newer" });
  });
});

describe("usePanelItem · what it shows and when it asks", () => {
  it("BR-7 · a failure that is not an Error shows the panel's own text", async () => {
    const source = itemSource();
    const { result } = renderHook(() =>
      usePanelItem(source as never, "s1", "roster", "worker-a", "Failed to load this worker")
    );
    await waitFor(() => expect(source.calls).toHaveLength(1));
    await act(async () => source.calls[0]!.fail(42));
    await waitFor(() => expect(result.current.error).toBe("Failed to load this worker"));
  });

  it("BR-9 · mounting sends exactly one request, addressed to the session, ref and topic", async () => {
    const source = itemSource();
    renderHook(() => usePanelItem(source as never, "s1", "roster", "worker-a", "Worker failed"));
    await settle();
    expect(source.getCollectionResourceState).toHaveBeenCalledTimes(1);
    expect(source.calls[0]!.args).toEqual(["s1", "roster", "worker-a"]);
  });
});

// ---------------------------------------------------------------------------
// A panel's own client
// ---------------------------------------------------------------------------

describe("a panel with no client of its own", () => {
  it("BR-19 · builds a new client when the provider's address changes, and discards the old address's late response", async () => {
    const pending: Array<{ origin: string; release: (body: unknown) => void }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (input: RequestInfo | URL) =>
          new Promise<Response>((resolve) => {
            pending.push({
              origin: new URL(String(input)).origin,
              release: (body) => resolve(new Response(JSON.stringify(body), { status: 200 }))
            });
          })
      )
    );
    const workerEntry = (workerId: string) => ({
      topic: workerId,
      clientData: { workerId, flow: "agent", instructions: null }
    });
    const tree = (baseUrl: string) =>
      createElement(
        FlowProvider,
        { baseUrl, children: createElement(Roster, { sessionId: "s1" }) }
      );

    const view = render(tree("https://a.example"));
    await waitFor(() => expect(pending).toHaveLength(1));
    view.rerender(tree("https://b.example"));
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending.map((p) => p.origin)).toEqual(["https://a.example", "https://b.example"]);

    await act(async () => pending[1]!.release({ items: [workerEntry("from-b")] }));
    await act(async () => pending[0]!.release({ items: [workerEntry("from-a")] }));
    await settle();

    const workers = [...document.querySelectorAll("[data-worker-id]")].map((el) =>
      el.getAttribute("data-worker-id")
    );
    expect(workers).toEqual(["from-b"]);
  });
});
