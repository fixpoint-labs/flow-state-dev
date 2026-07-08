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
  const fakeResponse = { ok: true } as Response;

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
});
