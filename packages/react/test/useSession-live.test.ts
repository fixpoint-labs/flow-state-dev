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
 *
 * A request stream the hook attaches to, or reads from a send's response, is
 * captured too, so a case can drop the view's own stream partway through.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import type { OutputItem, SessionStreamEvent } from "@flow-state-dev/core/items";
import type { CreateSessionSSEClientOptions, CreateSSEClientOptions } from "@flow-state-dev/client";

const { sessionClientMock, clientMock, recoveryClientMock, streams, requestStreams, realStream } = vi.hoisted(
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
    requestStreams: [] as CreateSSEClientOptions[],
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
    createSSEClient: (options: CreateSSEClientOptions) => {
      requestStreams.push(options);
      return noopSSE();
    },
    createSSEClientFromResponse: (options: CreateSSEClientOptions) => {
      requestStreams.push(options);
      return noopSSE();
    },
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

function snapshot(items: OutputItem[] = [], at?: number) {
  return {
    sessionId: "sess1",
    flowKind: "demo",
    at,
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
    requestStreams.length = 0;
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

  // An omitted `since` reaches back only a minute, and a snapshot can take
  // longer than that to arrive. Starting from the snapshot's own read time
  // loses nothing kept after it.
  it("starts the stream where the snapshot's read began, by the server's clock", async () => {
    sessionClientMock.getSessionState.mockResolvedValue(snapshot([], 1_700_000_000_000));
    await mountLive();
    expect(streams[0]?.options.since).toBe(1_700_000_000_000);
  });

  it("opens without `since` when the snapshot names no read time", async () => {
    await mountLive();
    expect(streams[0]?.options.since).toBeUndefined();
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

  // A keyed item's id comes from its key, so two requests that keep the same
  // key keep the same id. Each is its own item: neither is a repeat of the
  // other, and neither replaces the other.
  it("shows both of two requests' items that share an id, as a reload shows them (BR-22)", async () => {
    const fromA = message("req_a", "keyed", "from a", 1);
    const fromB = message("req_b", "keyed", "from b", 2);
    sessionClientMock.getSessionState.mockResolvedValue(snapshot([fromA]));
    const { result } = await mountLive();

    deliver(item("req_b", fromB));
    expect(texts(result.current.items)).toEqual(["from a", "from b"]);

    sessionClientMock.getSessionState.mockResolvedValue(snapshot([fromA, fromB]));
    const reload = renderHook(() => useSession("sess1", { flowKind: "demo" }));
    await waitFor(() => expect(reload.result.current.isLoading).toBe(false));
    expect(texts(reload.result.current.items)).toEqual(["from a", "from b"]);
  });

  it("orders live items as a reload would, not by arrival (BR-5)", async () => {
    const { result } = await mountLive();

    deliver(item("req_2", message("req_2", "later", "second", 20)));
    deliver(item("req_1", message("req_1", "earlier", "first", 10)));
    expect(texts(result.current.items)).toEqual(["first", "second"]);
  });

  // Two requests' items can share a time and a request-local index. Live, they
  // arrive in any order; a reload lists them in whatever order the server's
  // store gave. Both have to come out the same.
  it("orders two requests' items that tie on time and index the same way live and on reload", async () => {
    const fromA = message("req_a", "a1", "from a", 5);
    const fromB = message("req_b", "b1", "from b", 5);
    const { result } = await mountLive();

    deliver(item("req_b", fromB));
    deliver(item("req_a", fromA));
    expect(texts(result.current.items)).toEqual(["from a", "from b"]);

    sessionClientMock.getSessionState.mockResolvedValue(snapshot([fromB, fromA]));
    const reload = renderHook(() => useSession("sess1", { flowKind: "demo" }));
    await waitFor(() => expect(reload.result.current.isLoading).toBe(false));
    expect(texts(reload.result.current.items)).toEqual(["from a", "from b"]);
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

  // Whether a snapshot may drop a live item is a question of order, whether
  // its read began before the item arrived, and never of how long it took.
  it("keeps a live item a snapshot lacks whose read began first, however late the read lands", async () => {
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

    // The tab sleeps for two minutes before the read lands.
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120_000);
    try {
      await act(async () => {
        release(snapshot());
        await refreshing;
      });
    } finally {
      clock.mockRestore();
    }
    expect(texts(result.current.items)).toEqual(["arrived mid-read"]);
  });

  // The session stream sends only what the server has kept, so a read that
  // began after a line arrived holds it, or shows it is gone.
  it("drops a live item a snapshot lacks whose read began after it arrived", async () => {
    const { result } = await mountLive();
    deliver(item("req_seat", message("req_seat", "m1", "since removed", 2)));
    expect(texts(result.current.items)).toEqual(["since removed"]);

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.items).toEqual([]);
  });

  // The view shows the user's message the moment it is sent, until the
  // server's copy replaces it. That copy can come from either stream.
  describe("the message the view shows while it sends", () => {
    function userMessage(requestId: string, id: string, text: string): OutputItem {
      return { ...message(requestId, id, text, 3), role: "user" } as OutputItem;
    }

    /** Send `text` as the user's message; the request's id, and the stream its response opened. */
    async function send(result: { current: ReturnType<typeof useSession> }, text: string) {
      clientMock.sendActionStream.mockResolvedValue(
        new Response("", { headers: { "content-type": "text/event-stream" } })
      );
      await act(async () => {
        await result.current.sendAction("say", { text }, { userMessage: text });
      });
      const options = clientMock.sendActionStream.mock.calls.at(-1)?.[2] as { requestId: string };
      return { requestId: options.requestId, own: requestStreams.at(-1)! };
    }

    it("gives way to the server's copy from its own stream", async () => {
      const { result } = await mountLive();
      const { requestId, own } = await send(result, "hi there");

      act(() => {
        own.onItemAdded?.({
          stream: "request",
          requestId,
          sequence_number: 1,
          ts: 3,
          type: "item.added",
          item: userMessage(requestId, "u1", "hi there")
        } as never);
      });
      expect(texts(result.current.items)).toEqual(["hi there"]);
      expect(result.current.items[0]?.id).toBe("u1");
    });

    it("gives way to the server's copy from the session stream when its own stream dropped first", async () => {
      const { result } = await mountLive();
      const { requestId, own } = await send(result, "hi there");
      expect(texts(result.current.items)).toEqual(["hi there"]);

      act(() => {
        own.onError?.(new Error("connection dropped"));
      });
      deliver(item(requestId, userMessage(requestId, "u1", "hi there")));
      expect(texts(result.current.items)).toEqual(["hi there"]);
      expect(result.current.items[0]?.id).toBe("u1");
    });

    it("stays when another request's message arrives", async () => {
      const { result } = await mountLive();
      await send(result, "mine");

      deliver(item("req_other", userMessage("req_other", "u9", "theirs")));
      expect(texts(result.current.items)).toEqual(["theirs", "mine"]);
    });
  });

  // The session stream sends only finished items, so a held copy that is
  // still unfinished can only be a partial one.
  describe("a finished copy over a partial one (BR-3)", () => {
    const partial = (text: string): OutputItem =>
      ({ ...message("req_mine", "m1", text, 2), status: "in_progress" }) as OutputItem;

    /** Mount live, attached to the view's own running request `req_mine`. */
    async function mountAttached() {
      sessionClientMock.getSession.mockResolvedValue({
        id: "sess1",
        flowKind: "demo",
        userId: "devuser",
        createdAt: 0,
        updatedAt: 0,
        latestRequestId: "req_mine"
      });
      sessionClientMock.listSessionRequests.mockResolvedValue([
        { id: "req_mine", sessionId: "sess1", status: "in_progress", createdAt: 1, updatedAt: 1 }
      ]);
      const view = await mountLive({ autoResume: true });
      await waitFor(() => expect(requestStreams).toHaveLength(1));
      return { ...view, own: requestStreams[0]! };
    }

    function requestEvent(type: string, fields: Record<string, unknown>) {
      return { stream: "request", requestId: "req_mine", sequence_number: 1, ts: 2, type, ...fields } as never;
    }

    it("shows the finished item when the view's own stream dropped partway through it", async () => {
      const { result, own } = await mountAttached();
      act(() => {
        own.onItemAdded?.(requestEvent("item.added", { item: partial("Hel") }));
        own.onError?.(new Error("connection dropped"));
      });
      expect(texts(result.current.items)).toEqual(["Hel"]);

      deliver(item("req_mine", message("req_mine", "m1", "Hello there", 2)));
      expect(texts(result.current.items)).toEqual(["Hello there"]);
      expect(result.current.items[0]?.status).toBe("completed");
    });

    it("drops text still queued for the partial copy, which the finished one already holds", async () => {
      const { result, own } = await mountAttached();
      act(() => {
        own.onItemAdded?.(requestEvent("item.added", { item: partial("") }));
      });
      act(() => {
        // Queued for the next flush, and the finished copy lands first.
        own.onContentDelta?.(requestEvent("content.delta", { itemId: "m1", contentIndex: 0, delta: "Hel" }));
        streams[streams.length - 1]!.options.onItem?.(
          item("req_mine", message("req_mine", "m1", "Hello there", 2)) as never
        );
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(texts(result.current.items)).toEqual(["Hello there"]);
    });

    it("keeps the finished item when its own stream catches up after it, then drops", async () => {
      const { result, own } = await mountAttached();
      deliver(item("req_mine", message("req_mine", "m1", "Hello there", 2)));

      // The own stream lags: it now sends the item's start, then drops.
      act(() => {
        own.onItemAdded?.(requestEvent("item.added", { item: partial("") }));
        own.onContentAdded?.(
          requestEvent("content.added", { itemId: "m1", contentIndex: 0, content: { type: "output_text", text: "" } })
        );
        own.onContentDelta?.(requestEvent("content.delta", { itemId: "m1", contentIndex: 0, delta: "Hel" }));
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      act(() => {
        own.onError?.(new Error("connection dropped"));
      });

      expect(texts(result.current.items)).toEqual(["Hello there"]);
      expect(result.current.items[0]?.status).toBe("completed");
    });

    // A finished message can still gain a part, such as synthesized audio,
    // after its text is done. That is not an older copy, so it lands.
    it("still takes a part added to an item after it finished", async () => {
      const { result, own } = await mountAttached();
      const audio = { type: "output_audio", audio: "AAAA", mediaType: "audio/mpeg" };
      const partTypes = () =>
        (result.current.items[0] as unknown as { content: Array<{ type: string }> }).content.map((part) => part.type);
      act(() => {
        own.onItemAdded?.(requestEvent("item.added", { item: partial("") }));
        own.onItemDone?.(requestEvent("item.done", { item: message("req_mine", "m1", "Hello there", 2) }));
        // Streamed audio opens its part here and closes it once playback is sent.
        own.onContentAdded?.(requestEvent("content.added", { itemId: "m1", contentIndex: 1, content: audio }));
      });
      expect(partTypes()).toEqual(["output_text", "output_audio"]);

      act(() => {
        own.onContentDone?.(requestEvent("content.done", { itemId: "m1", contentIndex: 1, content: audio }));
      });
      expect(partTypes()).toEqual(["output_text", "output_audio"]);
      expect(texts(result.current.items)).toEqual(["Hello there"]);
    });

    // The session stream sends each copy once, so a part another request's
    // item gains after it finished reaches the view in a later snapshot: the
    // same copy, read later, settles the one the view holds.
    it("takes a later snapshot's copy of a finished item that has gained a part since", async () => {
      const { result } = await mountLive();
      deliver(item("req_seat", message("req_seat", "m1", "Hello there", 2)));

      const voiced = message("req_seat", "m1", "Hello there", 2) as unknown as { content: unknown[] };
      voiced.content.push({ type: "output_audio", audio: "AAAA", mediaType: "audio/mpeg" });
      sessionClientMock.getSessionState.mockResolvedValueOnce(snapshot([voiced as unknown as OutputItem]));
      await act(async () => {
        await result.current.refresh();
      });
      const parts = (result.current.items[0] as unknown as { content: Array<{ type: string }> }).content;
      expect(parts.map((part) => part.type)).toEqual(["output_text", "output_audio"]);
    });

    it("keeps a live finished item over a slower snapshot read that holds it partial", async () => {
      const { result } = await mountLive();

      let release: (value: unknown) => void = () => {};
      sessionClientMock.getSessionState.mockImplementationOnce(
        () => new Promise((resolve) => (release = resolve))
      );
      let refreshing: Promise<void> = Promise.resolve();
      act(() => {
        refreshing = result.current.refresh();
      });
      deliver(item("req_mine", message("req_mine", "m1", "Hello there", 2)));

      await act(async () => {
        // Read while the line was still being written.
        release(snapshot([partial("Hel")]));
        await refreshing;
      });
      expect(texts(result.current.items)).toEqual(["Hello there"]);
    });

    it("keeps an item its own stream delivered after a slower snapshot read began", async () => {
      const { result, own } = await mountAttached();

      let release: (value: unknown) => void = () => {};
      sessionClientMock.getSessionState.mockImplementationOnce(
        () => new Promise((resolve) => (release = resolve))
      );
      let refreshing: Promise<void> = Promise.resolve();
      act(() => {
        refreshing = result.current.refresh();
      });
      act(() => {
        own.onItemAdded?.(requestEvent("item.added", { item: partial("") }));
        own.onItemDone?.(requestEvent("item.done", { item: message("req_mine", "m1", "Hello there", 2) }));
      });

      await act(async () => {
        // Read before the item was kept.
        release(snapshot());
        await refreshing;
      });
      expect(texts(result.current.items)).toEqual(["Hello there"]);
    });

    // A keyed item is sent again, finished, each time it is emitted: one id,
    // a later time and index, the whole data replaced. Two such copies can
    // arrive in either order, from either stream or a snapshot, and the view
    // keeps the one emitted last.
    describe("two finished copies of one keyed item", () => {
      function plan(step: number, ts: number, itemIndex: number): OutputItem {
        return {
          id: "item_component_keyed:plan",
          type: "component",
          status: "completed",
          requestId: "req_mine",
          itemIndex,
          ts,
          provenance: { blockName: "b", blockInstanceId: "b_1", phase: "main" },
          component: "plan-view",
          data: { step },
          key: "plan"
        } as unknown as OutputItem;
      }
      const steps = (items: readonly OutputItem[]) =>
        items.map((shown) => (shown as unknown as { data: { step: number } }).data.step);

      it("keeps the later copy when the session stream brings it before the view's own stream brings the earlier", async () => {
        const { result, own } = await mountAttached();
        deliver(item("req_mine", plan(2, 5, 3)));

        act(() => {
          own.onItemAdded?.(requestEvent("item.added", { item: plan(1, 4, 1) }));
          own.onItemDone?.(requestEvent("item.done", { item: plan(1, 4, 1) }));
        });
        expect(steps(result.current.items)).toEqual([2]);
      });

      it("takes the later copy from the session stream over the earlier one its own stream brought", async () => {
        const { result, own } = await mountAttached();
        act(() => {
          own.onItemAdded?.(requestEvent("item.added", { item: plan(1, 4, 1) }));
          own.onItemDone?.(requestEvent("item.done", { item: plan(1, 4, 1) }));
          own.onError?.(new Error("connection dropped"));
        });
        expect(steps(result.current.items)).toEqual([1]);

        deliver(item("req_mine", plan(2, 5, 3)));
        expect(steps(result.current.items)).toEqual([2]);
      });

      it("keeps the later copy over a snapshot that holds the earlier one", async () => {
        const { result, own } = await mountAttached();
        act(() => {
          own.onItemDone?.(requestEvent("item.done", { item: plan(2, 5, 3) }));
        });

        // Read after the later copy arrived, but before it was kept.
        sessionClientMock.getSessionState.mockResolvedValueOnce(snapshot([plan(1, 4, 1)]));
        await act(async () => {
          await result.current.refresh();
        });
        expect(steps(result.current.items)).toEqual([2]);
      });

      // Copies emitted in one millisecond share a time; the index still orders them.
      it("orders two copies that share a time by their index", async () => {
        const { result, own } = await mountAttached();
        deliver(item("req_mine", plan(2, 5, 3)));
        act(() => {
          own.onItemDone?.(requestEvent("item.done", { item: plan(1, 5, 1) }));
        });
        expect(steps(result.current.items)).toEqual([2]);
      });
    });
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
