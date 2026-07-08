/**
 * Tests for the per-row crash-recovery continuation hook (FIX-865). Mocks
 * `createSSEClientFromResponse` (capturing the callbacks it's given) while
 * keeping the real `createRequestStreamStore` / `bindStoreToCallbacks` so the
 * seed-then-merge behavior is exercised for real, not asserted against a mock.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { calls } = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
}));

vi.mock("@flow-state-dev/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/client")>();
  return {
    ...actual,
    createSSEClientFromResponse: (opts: Record<string, unknown>) => {
      calls.push(opts);
      return { close: vi.fn(), get lastEventId() { return undefined; } };
    },
  };
});

import { useContinueRequest } from "../src/react/hooks/use-continue-request";

function makeItem(id: string, itemIndex: number) {
  return {
    id,
    type: "message",
    status: "completed",
    requestId: "req_1",
    itemIndex,
    provenance: { blockName: "b", blockInstanceId: "req_1:root:0", phase: "main" },
    ts: 1000 + itemIndex,
    content: [{ type: "output_text", text: `item-${id}` }],
  };
}

function itemAddedEvent(item: unknown, requestId = "req_1") {
  return {
    type: "item.added",
    stream: "request",
    requestId,
    sequence_number: 1,
    ts: Date.now(),
    item,
  };
}

describe("useContinueRequest", () => {
  let recoveryClient: { continueStream: ReturnType<typeof vi.fn> };
  const fakeResponse = {
    ok: true,
    headers: new Headers({ "content-type": "text/event-stream" }),
  } as Response;

  beforeEach(() => {
    calls.length = 0;
    recoveryClient = { continueStream: vi.fn().mockResolvedValue(fakeResponse) };
  });

  it("calls recoveryClient.continueStream with {flowKind, sessionId, requestId, includeTrace: true}", async () => {
    const onItems = vi.fn();
    const { result } = renderHook(() =>
      useContinueRequest({
        recoveryClient: recoveryClient as unknown as import("@flow-state-dev/client").RecoveryClient,
        flowKind: "demo",
        sessionId: "sess_1",
        onItems,
      }),
    );

    await act(async () => {
      await result.current.continueRequest("req_1", []);
    });

    // The DevTool always wants trace items for the resumed portion so the
    // Trace tab can show what ran (FIX-865 gap fix).
    expect(recoveryClient.continueStream).toHaveBeenCalledWith({
      flowKind: "demo",
      sessionId: "sess_1",
      requestId: "req_1",
      includeTrace: true,
    });
  });

  it("seeds the stream with the row's existing items — they are not cleared when new items arrive", async () => {
    const onItems = vi.fn();
    const existing = [makeItem("m1", 0)];
    const { result } = renderHook(() =>
      useContinueRequest({
        recoveryClient: recoveryClient as unknown as import("@flow-state-dev/client").RecoveryClient,
        flowKind: "demo",
        sessionId: "sess_1",
        onItems,
      }),
    );

    await act(async () => {
      await result.current.continueRequest("req_1", existing);
    });

    const opts = calls[calls.length - 1]!;
    act(() => {
      (opts.onItemAdded as (e: unknown) => void)(itemAddedEvent(makeItem("m2", 1)));
    });

    const [, items] = onItems.mock.calls[onItems.mock.calls.length - 1]!;
    const ids = (items as Array<{ id: string }>).map((i) => i.id);
    expect(ids).toContain("m1");
    expect(ids).toContain("m2");
  });

  it("continues two different request ids independently", async () => {
    const onItems = vi.fn();
    const { result } = renderHook(() =>
      useContinueRequest({
        recoveryClient: recoveryClient as unknown as import("@flow-state-dev/client").RecoveryClient,
        flowKind: "demo",
        sessionId: "sess_1",
        onItems,
      }),
    );

    await act(async () => {
      await result.current.continueRequest("req_1", [makeItem("a1", 0)]);
      await result.current.continueRequest("req_2", [makeItem("b1", 0)]);
    });

    expect(calls.length).toBe(2);
    expect(result.current.isContinuing("req_1")).toBe(true);
    expect(result.current.isContinuing("req_2")).toBe(true);

    // Feeding req_1's stream must not affect req_2's reported items.
    act(() => {
      (calls[0]!.onItemAdded as (e: unknown) => void)(itemAddedEvent(makeItem("a2", 1)));
    });

    const [reqId, items] = onItems.mock.calls[onItems.mock.calls.length - 1]!;
    expect(reqId).toBe("req_1");
    expect((items as Array<{ id: string }>).map((i) => i.id)).toEqual(["a1", "a2"]);
  });

  it("stops tracking the request as continuing once a terminal status arrives", async () => {
    const onItems = vi.fn();
    const { result } = renderHook(() =>
      useContinueRequest({
        recoveryClient: recoveryClient as unknown as import("@flow-state-dev/client").RecoveryClient,
        flowKind: "demo",
        sessionId: "sess_1",
        onItems,
      }),
    );

    await act(async () => {
      await result.current.continueRequest("req_1", []);
    });
    expect(result.current.isContinuing("req_1")).toBe(true);

    const opts = calls[calls.length - 1]!;
    act(() => {
      (opts.onRequestStatus as (e: unknown) => void)({
        type: "request.completed",
        stream: "request",
        requestId: "req_1",
        sequence_number: 2,
        ts: Date.now(),
        status: "completed",
      });
    });

    expect(result.current.isContinuing("req_1")).toBe(false);
  });

  it("marks the row as continuing before the POST resolves, not after", async () => {
    let resolvePost!: (r: Response) => void;
    recoveryClient.continueStream.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolvePost = resolve;
      }),
    );
    const { result } = renderHook(() =>
      useContinueRequest({
        recoveryClient: recoveryClient as unknown as import("@flow-state-dev/client").RecoveryClient,
        flowKind: "demo",
        sessionId: "sess_1",
        onItems: vi.fn(),
      }),
    );

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.continueRequest("req_1", []);
    });
    // The POST hasn't resolved yet — the guard must already cover this window.
    expect(result.current.isContinuing("req_1")).toBe(true);

    await act(async () => {
      resolvePost(fakeResponse);
      await pending;
    });
    expect(result.current.isContinuing("req_1")).toBe(true);
  });

  it("clears the continuing flag if the POST rejects", async () => {
    recoveryClient.continueStream.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() =>
      useContinueRequest({
        recoveryClient: recoveryClient as unknown as import("@flow-state-dev/client").RecoveryClient,
        flowKind: "demo",
        sessionId: "sess_1",
        onItems: vi.fn(),
      }),
    );

    await act(async () => {
      await expect(result.current.continueRequest("req_1", [])).rejects.toThrow("network down");
    });
    expect(result.current.isContinuing("req_1")).toBe(false);
  });

  it("stops tracking and calls onSettled on a non-streaming 202 JSON fallback, without touching createSSEClientFromResponse", async () => {
    const jsonResponse = {
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      body: { cancel: vi.fn().mockResolvedValue(undefined) },
    } as unknown as Response;
    recoveryClient.continueStream.mockResolvedValue(jsonResponse);
    const onSettled = vi.fn();
    const { result } = renderHook(() =>
      useContinueRequest({
        recoveryClient: recoveryClient as unknown as import("@flow-state-dev/client").RecoveryClient,
        flowKind: "demo",
        sessionId: "sess_1",
        onItems: vi.fn(),
        onSettled,
      }),
    );

    await act(async () => {
      await result.current.continueRequest("req_1", []);
    });

    expect(calls.length).toBe(0);
    expect(result.current.isContinuing("req_1")).toBe(false);
    expect(onSettled).toHaveBeenCalledWith("req_1");
  });

  it("calls onSettled once a terminal status arrives over the inline stream", async () => {
    const onSettled = vi.fn();
    const { result } = renderHook(() =>
      useContinueRequest({
        recoveryClient: recoveryClient as unknown as import("@flow-state-dev/client").RecoveryClient,
        flowKind: "demo",
        sessionId: "sess_1",
        onItems: vi.fn(),
        onSettled,
      }),
    );

    await act(async () => {
      await result.current.continueRequest("req_1", []);
    });
    const opts = calls[calls.length - 1]!;
    act(() => {
      (opts.onRequestStatus as (e: unknown) => void)({
        type: "request.completed",
        stream: "request",
        requestId: "req_1",
        sequence_number: 2,
        ts: Date.now(),
        status: "completed",
      });
    });

    expect(onSettled).toHaveBeenCalledWith("req_1");
  });

  it("flushes buffered content deltas before publishing items", async () => {
    const onItems = vi.fn();
    const { result } = renderHook(() =>
      useContinueRequest({
        recoveryClient: recoveryClient as unknown as import("@flow-state-dev/client").RecoveryClient,
        flowKind: "demo",
        sessionId: "sess_1",
        onItems,
      }),
    );

    await act(async () => {
      await result.current.continueRequest("req_1", [makeItem("m1", 0)]);
    });

    const opts = calls[calls.length - 1]!;
    const message = makeItem("m2", 1);
    act(() => {
      (opts.onItemAdded as (e: unknown) => void)(itemAddedEvent(message));
      (opts.onContentDelta as (e: unknown) => void)({
        type: "content.delta",
        stream: "request",
        requestId: "req_1",
        sequence_number: 3,
        ts: Date.now(),
        itemId: "m2",
        contentIndex: 0,
        delta: "-more",
      });
    });

    const [, items] = onItems.mock.calls[onItems.mock.calls.length - 1]!;
    const m2 = (items as Array<{ id: string; content: Array<{ text?: string }> }>).find(
      (i) => i.id === "m2",
    );
    // The delta must already be folded in by the time onItems fires — not
    // stuck in the store's buffer until a later content.done/replacement.
    expect(m2?.content?.[0]?.text).toBe("item-m2-more");
  });
});
