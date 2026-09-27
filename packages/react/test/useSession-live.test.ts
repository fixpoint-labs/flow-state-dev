// @vitest-environment happy-dom
/**
 * `useSession({ live: true })`: a view that hears requests it didn't send.
 *
 * The stream is faked at the client seam, so each case hands the hook exactly
 * the events it would get and asserts on what the view shows. The one case
 * about an older server runs the real client against a fetch that answers 404,
 * because "no error, no retry" is the client and hook together.
 *
 * Reads are counted where the view would look the same either way: a hook
 * that polls, or opens a stream nobody asked for, renders identically.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import type { OutputItem, SessionStreamEvent } from "@flow-state-dev/core/items";
import type { CreateSessionSSEClientOptions } from "@flow-state-dev/client";

const { sessionClientMock, clientMock, recoveryClientMock, streams, realStream } = vi.hoisted(
  () => ({
    sessionClientMock: {
      getSession: vi.fn(),
      getSessionState: vi.fn(),
      listSessionRequests: vi.fn(),
      listChildSessions: vi.fn()
    },
    clientMock: {
      sendActionStream: vi.fn(),
      abortRequest: vi.fn()
    },
    recoveryClientMock: {
      continueStream: vi.fn(),
      continue: vi.fn(),
      retry: vi.fn(),
      resumeSuspension: vi.fn(),
      resumeSuspensionStream: vi.fn(),
      checkInterrupted: vi.fn()
    },
    streams: [] as Array<{ options: CreateSessionSSEClientOptions; closed: boolean }>,
    realStream: { on: false }
  })
);

vi.mock("@flow-state-dev/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/client")>();
  const noopSSE = () => ({
    close() {},
    get lastEventId() {
      return undefined;
    }
  });
  return {
    ...actual,
    createSSEClient: noopSSE,
    createSSEClientFromResponse: noopSSE,
    createRecoveryClient: () => recoveryClientMock,
    createSessionClient: () => ({ ...sessionClientMock }),
    createClient: () => clientMock,
    createSessionSSEClient: (options: CreateSessionSSEClientOptions) => {
      if (realStream.on) return actual.createSessionSSEClient(options);
      const entry = { options, closed: false };
      streams.push(entry);
      return {
        close: () => {
          entry.closed = true;
        },
        lastAt: undefined,
        stopped: false
      };
    }
  };
});

import { useSession } from "../src/hooks/useSession";

function message(requestId: string, id: string, text: string, ts: number): OutputItem {
  return {
    id,
    type: "message",
    status: "completed",
    requestId,
    itemIndex: 0,
    ts,
    provenance: { blockName: "b", blockInstanceId: "b_1", phase: "main" },
    role: "assistant",
    content: [{ type: "output_text", text }]
  } as unknown as OutputItem;
}

function snapshot(items: OutputItem[] = []) {
  return {
    sessionId: "sess1",
    flowKind: "demo",
    clientData: {},
    items,
    pagination: { offset: 0, limit: 100, total: items.length, hasMore: false, nextOffset: items.length }
  };
}

function textOf(item: OutputItem): string {
  return ((item as unknown as { content: Array<{ text: string }> }).content[0]?.text) ?? "";
}

function texts(items: readonly OutputItem[]): string[] {
  return items.map(textOf);
}

/** Deliver one event on the most recent open stream. */
function deliver(event: SessionStreamEvent): void {
  const open = streams.filter((s) => !s.closed);
  const stream = open[open.length - 1];
  if (stream === undefined) throw new Error("no open session stream");
  act(() => {
    if (event.type === "session.item") stream.options.onItem?.(event);
    if (event.type === "session.runs") stream.options.onRuns?.(event);
  });
}

function item(requestId: string, value: OutputItem): SessionStreamEvent {
  return { stream: "session", sessionId: "sess1", at: 1, type: "session.item", requestId, item: value };
}

function runs(ids: string[]): SessionStreamEvent {
  return {
    stream: "session",
    sessionId: "sess1",
    at: 1,
    type: "session.runs",
    runs: ids.map((id) => ({ id, parentSessionId: "sess1", createdAt: 1, updatedAt: 1, flowId: `seat.${id}` }))
  };
}

async function mountLive(options: Record<string, unknown> = {}, sessionId = "sess1") {
  const view = renderHook(
    ({ id }: { id: string }) => useSession(id, { flowKind: "demo", live: true, ...options }),
    { initialProps: { id: sessionId } }
  );
  await waitFor(() => {
    expect(streams.filter((s) => !s.closed)).toHaveLength(1);
  });
  return view;
}

describe("useSession live", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    streams.length = 0;
    realStream.on = false;
    sessionClientMock.getSession.mockResolvedValue({
      id: "sess1",
      flowKind: "demo",
      userId: "devuser",
      createdAt: 0,
      updatedAt: 0
    });
    sessionClientMock.getSessionState.mockResolvedValue(snapshot());
    sessionClientMock.listSessionRequests.mockResolvedValue([]);
    sessionClientMock.listChildSessions.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("without `live`, opens no stream and reads nothing new (BR-18)", async () => {
    const { result } = renderHook(() => useSession("sess1", { flowKind: "demo" }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(streams).toHaveLength(0);
    // Today's mount, read for read.
    expect(sessionClientMock.getSessionState).toHaveBeenCalledTimes(1);
    expect(sessionClientMock.listChildSessions).toHaveBeenCalledTimes(1);
    expect(sessionClientMock.listSessionRequests).toHaveBeenCalledTimes(1);
  });

  it("opens the stream only once the snapshot has been applied (BR-12)", async () => {
    let release: (value: unknown) => void = () => {};
    sessionClientMock.getSessionState.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve))
    );
    renderHook(() => useSession("sess1", { flowKind: "demo", live: true, items: { itemTypes: ["message"] } }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(streams).toHaveLength(0);

    await act(async () => {
      release(snapshot());
    });
    await waitFor(() => expect(streams).toHaveLength(1));
    expect(streams[0].options).toMatchObject({ sessionId: "sess1", itemTypes: ["message"] });
  });

  it("shows a line another request kept, once, however often it arrives (BR-1, BR-13)", async () => {
    sessionClientMock.getSessionState.mockResolvedValue(snapshot([message("req_mine", "m0", "hello", 1)]));
    const { result } = await mountLive();

    deliver(item("req_seat", message("req_seat", "m1", "from the seat", 2)));
    expect(texts(result.current.items)).toEqual(["hello", "from the seat"]);

    deliver(item("req_seat", message("req_seat", "m1", "from the seat", 2)));
    expect(texts(result.current.items)).toEqual(["hello", "from the seat"]);
  });

  it("drops the live copy of an item its own request already delivered (BR-3)", async () => {
    sessionClientMock.getSessionState.mockResolvedValue(snapshot([message("req_mine", "m0", "as streamed", 1)]));
    const { result } = await mountLive();

    deliver(item("req_mine", message("req_mine", "m0", "stale copy", 1)));
    expect(texts(result.current.items)).toEqual(["as streamed"]);
  });

  it("keeps an item from another request that shares an id, as a reload keeps it (BR-22)", async () => {
    sessionClientMock.getSessionState.mockResolvedValue(snapshot([message("req_a", "keyed", "from a", 1)]));
    const { result } = await mountLive();

    deliver(item("req_b", message("req_b", "keyed", "from b", 2)));
    // Not dropped as a repeat of req_a's: told apart by request and item id.
    expect(texts(result.current.items)).toEqual(["from b"]);
  });

  it("orders live items as a reload would, not by arrival (BR-5)", async () => {
    const { result } = await mountLive();

    deliver(item("req_2", message("req_2", "later", "second", 20)));
    deliver(item("req_1", message("req_1", "earlier", "first", 10)));
    expect(texts(result.current.items)).toEqual(["first", "second"]);
  });

  it("applies the view's own item filter to live items", async () => {
    const { result } = await mountLive({ items: { itemTypes: ["message"] } });

    deliver(
      item("req_1", { ...message("req_1", "s1", "", 1), type: "status", message: "busy" } as unknown as OutputItem)
    );
    deliver(item("req_1", { ...message("req_1", "t1", "passing", 2), transient: true } as OutputItem));
    expect(result.current.items).toEqual([]);
  });

  it("leaves the latest request and the streaming flag alone (BR-19)", async () => {
    const { result } = await mountLive();
    const requestReads = sessionClientMock.listSessionRequests.mock.calls.length;

    deliver(item("req_seat", message("req_seat", "m1", "from the seat", 2)));
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.latestRequest).toBeNull();
    expect(sessionClientMock.listSessionRequests).toHaveBeenCalledTimes(requestReads);
  });

  it("keeps a live item a slower snapshot read lacks", async () => {
    const { result } = await mountLive();

    let release: (value: unknown) => void = () => {};
    sessionClientMock.getSessionState.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve))
    );
    let refreshing: Promise<void> = Promise.resolve();
    act(() => {
      refreshing = result.current.refresh();
    });
    deliver(item("req_seat", message("req_seat", "m1", "arrived mid-read", 2)));

    await act(async () => {
      // Read before the line was kept, so it doesn't hold it.
      release(snapshot());
      await refreshing;
    });
    expect(texts(result.current.items)).toEqual(["arrived mid-read"]);
  });

  it("re-reads the runs on a nudge and keeps a run the page lacks (BR-7, BR-23)", async () => {
    sessionClientMock.listChildSessions.mockResolvedValue([
      { id: "run_new", parentSessionId: "sess1", createdAt: 5, updatedAt: 5, flowId: "seat.run_new", status: "active" }
    ]);
    const { result } = await mountLive();
    await waitFor(() => expect(result.current.childSessions).toHaveLength(1));
    const reads = sessionClientMock.listChildSessions.mock.calls.length;

    deliver(runs(["run_new", "run_old"]));
    await waitFor(() =>
      expect(sessionClientMock.listChildSessions).toHaveBeenCalledTimes(reads + 1)
    );
    await waitFor(() =>
      expect(result.current.childSessions.map((row) => [row.id, row.status, row.flowId])).toEqual([
        ["run_new", "active", "seat.run_new"],
        ["run_old", "active", "seat.run_old"]
      ])
    );

    // Both finish: the page re-read shows them finished and nothing is kept.
    sessionClientMock.listChildSessions.mockResolvedValue([
      { id: "run_new", parentSessionId: "sess1", createdAt: 5, updatedAt: 6, status: "completed" }
    ]);
    deliver(runs([]));
    await waitFor(() =>
      expect(result.current.childSessions.map((row) => [row.id, row.status])).toEqual([
        ["run_new", "completed"]
      ])
    );
  });

  it("closes on unmount, and on a session switch opens for the new session after its snapshot", async () => {
    const view = await mountLive();
    const first = streams[0];

    sessionClientMock.getSessionState.mockResolvedValue({ ...snapshot(), sessionId: "sess2" });
    view.rerender({ id: "sess2" });
    await waitFor(() => expect(streams).toHaveLength(2));
    expect(first.closed).toBe(true);
    expect(streams[1].options.sessionId).toBe("sess2");

    view.unmount();
    expect(streams[1].closed).toBe(true);
  });

  it("treats a server without the stream as no stream: no error, no retry (BR-16)", async () => {
    realStream.on = true;
    const fetchMock = vi.fn(async () => new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSession("sess1", { flowKind: "demo", live: true }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_200));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("/api/flows/sessions/sess1/stream");
    expect(result.current.error).toBeNull();
  });
});
