// @vitest-environment happy-dom
/**
 * Characterization of the fenced reads the panels and the flow navigator make:
 * the panels' row read and item read, the flow list, and a leaf's session
 * list. Pinned before those reads were moved onto one shared internal read, and
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
import type { FlowListEntry, SessionSummary } from "@flow-state-dev/client";
import { useFlowInventory, useLeafSessions } from "../src/components/flow-navigator/reads";
import type { FlowNavigatorLeaf } from "../src/components/flow-navigator/grouping";
import { usePanelItem, usePanelRows } from "../src/components/panels/reads";
import { Roster } from "../src/components/panels/Roster";
import { FlowProvider } from "../src/context/FlowContext";

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

const flow = (kind: string): FlowListEntry => ({ kind }) as unknown as FlowListEntry;
const session = (id: string): SessionSummary =>
  ({
    id,
    flowKind: "agent",
    userId: "u",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  }) as unknown as SessionSummary;
const leaf = (address: string): FlowNavigatorLeaf => ({
  kind: "agent",
  address,
  cardinality: "collection"
});
const page = (...topics: string[]) => ({
  items: topics.map((topic) => ({ topic, clientData: { topic } }))
});

function flowSource() {
  const { calls, fn } = heldMethod<FlowListEntry[]>();
  return { calls, listFlows: fn };
}
function sessionSource() {
  const { calls, fn } = heldMethod<SessionSummary[]>();
  return { calls, listSessions: fn };
}
function rowSource() {
  const { calls, fn } = heldMethod<ReturnType<typeof page>>();
  return { calls, listCollectionItems: fn };
}
function itemSource() {
  const { calls, fn } = heldMethod<{ topic: string; clientData?: unknown } | null>();
  return { calls, getCollectionItemState: fn };
}

const kinds = (flows: readonly FlowListEntry[]) => flows.map((f) => f.kind);
const topics = (rows: readonly { topic: string }[]) => rows.map((r) => r.topic);

// ---------------------------------------------------------------------------
// The flow list
// ---------------------------------------------------------------------------

describe("useFlowInventory · late and racing responses", () => {
  it("BR-1 · discards a response that lands after the host swapped its client", async () => {
    const a = flowSource();
    const b = flowSource();
    const { result, rerender } = renderHook(({ source }) => useFlowInventory(source as never), {
      initialProps: { source: a }
    });
    await waitFor(() => expect(a.calls).toHaveLength(1));
    rerender({ source: b });
    await waitFor(() => expect(b.calls).toHaveLength(1));

    await act(async () => a.calls[0]!.release([flow("from-a")]));
    await settle();

    expect(result.current).toMatchObject({ flows: [], isLoading: true, error: null });
  });

  it("BR-2 · an older read resolving last never overwrites a newer one", async () => {
    const source = flowSource();
    const { result } = renderHook(() => useFlowInventory(source as never));
    await waitFor(() => expect(source.calls).toHaveLength(1));
    act(() => result.current.refresh());
    await waitFor(() => expect(source.calls).toHaveLength(2));

    await act(async () => source.calls[1]!.release([flow("newer")]));
    await act(async () => source.calls[0]!.release([flow("older")]));
    await settle();

    expect(kinds(result.current.flows)).toEqual(["newer"]);
  });

  it("BR-3 · a failure after a newer read started is discarded", async () => {
    const source = flowSource();
    const { result } = renderHook(() => useFlowInventory(source as never));
    await waitFor(() => expect(source.calls).toHaveLength(1));
    act(() => result.current.refresh());
    await waitFor(() => expect(source.calls).toHaveLength(2));

    await act(async () => source.calls[0]!.fail(new Error("stale failure")));
    await settle();

    expect(result.current.error).toBeNull();
  });

  it("BR-4 · never returns the previous client's flows, not even for one render", async () => {
    const a = flowSource();
    const b = flowSource();
    const seen: Array<{ source: unknown; flows: string[] }> = [];
    const { result, rerender } = renderHook(
      ({ source }) => {
        const inventory = useFlowInventory(source as never);
        seen.push({ source, flows: kinds(inventory.flows) });
        return inventory;
      },
      { initialProps: { source: a } }
    );
    await waitFor(() => expect(a.calls).toHaveLength(1));
    await act(async () => a.calls[0]!.release([flow("from-a")]));
    await waitFor(() => expect(kinds(result.current.flows)).toEqual(["from-a"]));

    rerender({ source: b });
    await waitFor(() => expect(b.calls).toHaveLength(1));

    const underB = seen.filter((entry) => entry.source === b);
    expect(underB.length).toBeGreaterThan(0);
    expect(underB.every((entry) => entry.flows.length === 0)).toBe(true);
  });
});

describe("useFlowInventory · what it shows and when it asks", () => {
  it("BR-7 · a failure that is not an Error shows the flow list's own text", async () => {
    const source = flowSource();
    const { result } = renderHook(() => useFlowInventory(source as never));
    await waitFor(() => expect(source.calls).toHaveLength(1));
    await act(async () => source.calls[0]!.fail("not an error"));
    await waitFor(() => expect(result.current.error).toBe("Failed to load flows"));
  });

  it("BR-7 · an Error with a blank message shows the same text", async () => {
    const source = flowSource();
    const { result } = renderHook(() => useFlowInventory(source as never));
    await waitFor(() => expect(source.calls).toHaveLength(1));
    await act(async () => source.calls[0]!.fail(new Error("   ")));
    await waitFor(() => expect(result.current.error).toBe("Failed to load flows"));
  });

  it("BR-9 · mounting sends exactly one request, with no arguments", async () => {
    const source = flowSource();
    renderHook(() => useFlowInventory(source as never));
    await settle();
    expect(source.listFlows).toHaveBeenCalledTimes(1);
    expect(source.calls[0]!.args).toEqual([]);
  });

  it("BR-10 · a host re-render with the same client sends no new request", async () => {
    const source = flowSource();
    const { rerender } = renderHook(({ source: s }) => useFlowInventory(s as never), {
      initialProps: { source }
    });
    await settle();
    rerender({ source });
    rerender({ source });
    await settle();
    expect(source.listFlows).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// A leaf's session list
// ---------------------------------------------------------------------------

describe("useLeafSessions · what it shows", () => {
  it("BR-6 · an Error with a message shows that message", async () => {
    const source = sessionSource();
    const { result } = renderHook(() =>
      useLeafSessions(source as never, leaf("seat-a"), "u", false, true)
    );
    await waitFor(() => expect(source.calls).toHaveLength(1));
    await act(async () => source.calls[0]!.fail(new Error("sessions down")));
    await waitFor(() => expect(result.current.error).toBe("sessions down"));
  });

  it("BR-7 · a failure that is not an Error shows the session list's own text", async () => {
    const source = sessionSource();
    const { result } = renderHook(() =>
      useLeafSessions(source as never, leaf("seat-a"), "u", false, true)
    );
    await waitFor(() => expect(source.calls).toHaveLength(1));
    await act(async () => source.calls[0]!.fail({ status: 500 }));
    await waitFor(() => expect(result.current.error).toBe("Failed to load sessions"));
  });

  it("BR-10 · a host re-render with the same leaf (a fresh object of the same values) sends no new request", async () => {
    const source = sessionSource();
    const { rerender } = renderHook(
      ({ tick }: { tick: number }) =>
        useLeafSessions(source as never, { ...leaf("seat-a"), tick } as never, "u", false, true),
      { initialProps: { tick: 0 } }
    );
    await settle();
    rerender({ tick: 1 });
    rerender({ tick: 2 });
    await settle();
    expect(source.listSessions).toHaveBeenCalledTimes(1);
  });
});

describe("useLeafSessions · the closed leaf", () => {
  it("BR-13 · a leaf mounted closed asks for nothing and reports no sessions, loading, no error", async () => {
    const source = sessionSource();
    const { result } = renderHook(() =>
      useLeafSessions(source as never, leaf("seat-a"), "u", false, false)
    );
    await settle();

    expect(source.listSessions).not.toHaveBeenCalled();
    // Nothing is held for a closed leaf, so it reads as loading, not as an
    // empty list that finished: the held identity stays unset.
    expect(result.current).toMatchObject({ sessions: [], isLoading: true, error: null });
  });

  it("BR-14 · refreshing a closed leaf sends no request", async () => {
    const source = sessionSource();
    const { result } = renderHook(() =>
      useLeafSessions(source as never, leaf("seat-a"), "u", false, false)
    );
    await settle();

    act(() => result.current.refresh());
    act(() => result.current.refresh());
    await settle();

    expect(source.listSessions).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ sessions: [], isLoading: true, error: null });
  });
});

// ---------------------------------------------------------------------------
// The panels' row read
// ---------------------------------------------------------------------------

describe("usePanelRows · late and racing responses", () => {
  it("BR-1 · discards a response that lands after the session changed", async () => {
    const source = rowSource();
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
    const source = rowSource();
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
    const source = rowSource();
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
    const source = rowSource();
    const seen: Array<{ sessionId: string; rows: string[] }> = [];
    const { result, rerender } = renderHook(
      ({ sessionId }) => {
        const state = usePanelRows(source as never, sessionId, "roster", undefined, "Panel failed");
        seen.push({ sessionId, rows: topics(state.rows) });
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
    expect(underS2.every((entry) => entry.rows.length === 0)).toBe(true);
  });
});

describe("usePanelRows · what it shows and when it asks", () => {
  it("BR-7 · a failure that is not an Error shows the panel's own text", async () => {
    const source = rowSource();
    const { result } = renderHook(() =>
      usePanelRows(source as never, "s1", "roster", undefined, "Failed to load the roster")
    );
    await waitFor(() => expect(source.calls).toHaveLength(1));
    await act(async () => source.calls[0]!.fail(undefined));
    await waitFor(() => expect(result.current.error).toBe("Failed to load the roster"));
  });

  it("BR-10 · a host re-render with the same identity sends no new request", async () => {
    const source = rowSource();
    const { rerender } = renderHook(
      // A new render each time, with the same values: nothing in the identity moved.
      (_: { tick: number }) => usePanelRows(source as never, "s1", "roster", 25, "Panel failed"),
      { initialProps: { tick: 0 } }
    );
    await settle();
    rerender({ tick: 1 });
    rerender({ tick: 2 });
    await settle();
    expect(source.listCollectionItems).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// The panels' item read
// ---------------------------------------------------------------------------

describe("usePanelItem · late and racing responses", () => {
  it("BR-1 · discards a response that lands after the topic changed", async () => {
    const source = itemSource();
    const { result, rerender } = renderHook(
      ({ topic }) => usePanelItem(source as never, "s1", "roster", topic, "Seat failed"),
      { initialProps: { topic: "seat-a" } }
    );
    await waitFor(() => expect(source.calls).toHaveLength(1));
    rerender({ topic: "seat-b" });
    await waitFor(() => expect(source.calls).toHaveLength(2));

    await act(async () => source.calls[0]!.release({ topic: "seat-a", clientData: { id: "a" } }));
    await settle();

    expect(result.current).toMatchObject({ item: null, isLoading: true, error: null });
  });

  it("BR-2 · an older read resolving last never overwrites a newer one", async () => {
    const source = itemSource();
    const { result } = renderHook(() =>
      usePanelItem<{ id: string }>(source as never, "s1", "roster", "seat-a", "Seat failed")
    );
    await waitFor(() => expect(source.calls).toHaveLength(1));
    act(() => result.current.refresh());
    await waitFor(() => expect(source.calls).toHaveLength(2));

    await act(async () => source.calls[1]!.release({ topic: "seat-a", clientData: { id: "newer" } }));
    await act(async () => source.calls[0]!.release({ topic: "seat-a", clientData: { id: "older" } }));
    await settle();

    expect(result.current.item).toEqual({ id: "newer" });
  });
});

describe("usePanelItem · what it shows and when it asks", () => {
  it("BR-7 · a failure that is not an Error shows the panel's own text", async () => {
    const source = itemSource();
    const { result } = renderHook(() =>
      usePanelItem(source as never, "s1", "roster", "seat-a", "Failed to load this seat")
    );
    await waitFor(() => expect(source.calls).toHaveLength(1));
    await act(async () => source.calls[0]!.fail(42));
    await waitFor(() => expect(result.current.error).toBe("Failed to load this seat"));
  });

  it("BR-9 · mounting sends exactly one request, addressed to the session, ref and topic", async () => {
    const source = itemSource();
    renderHook(() => usePanelItem(source as never, "s1", "roster", "seat-a", "Seat failed"));
    await settle();
    expect(source.getCollectionItemState).toHaveBeenCalledTimes(1);
    expect(source.calls[0]!.args).toEqual(["s1", "roster", "seat-a"]);
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
    const seatRow = (seatId: string) => ({
      topic: seatId,
      clientData: { seatId, flow: "agent", instructions: null }
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

    await act(async () => pending[1]!.release({ items: [seatRow("from-b")] }));
    await act(async () => pending[0]!.release({ items: [seatRow("from-a")] }));
    await settle();

    const seats = [...document.querySelectorAll("[data-seat-id]")].map((el) =>
      el.getAttribute("data-seat-id")
    );
    expect(seats).toEqual(["from-b"]);
  });
});
