// @vitest-environment happy-dom
/**
 * `useSession.followRequest` (FIX-2265): a request sent without the hook is
 * followed only when the page asks, so until then the page stays on the
 * request it follows.
 *
 * The client is faked (`support/fake-client`); the request streams it opens
 * are captured so the test can see which request each follows and feed it.
 *
 * Red states produced before these were trusted:
 *   - attach without making the request the active one, and the "stop
 *     reaches it" case fails (the stop goes to nothing).
 *   - let a stop's cleanup close whatever stream is open when the stop's
 *     answer lands, and the "stop that lands late" case fails: the request
 *     followed meanwhile loses its stream.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

const { connections, sessionsMock, flowMock } = vi.hoisted(() => ({
  connections: [] as Array<{ url: string; callbacks: Record<string, ((e: unknown) => void) | undefined>; closed: boolean }>,
  sessionsMock: { get: vi.fn(), state: vi.fn(), requests: vi.fn() },
  flowMock: { send: vi.fn(), abort: vi.fn() },
}));

vi.mock("@flow-state-dev/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/client")>();
  const { fakeClient } = await import("./support/fake-client");
  return {
    ...actual,
    createClient: () =>
      fakeClient({
        sessions: { ...sessionsMock },
        flow: flowMock,
        request: { status: vi.fn(async () => ({ status: "in_progress" })) },
        requestStream: (options) => {
          const rec = { url: options.url, callbacks: options as never, closed: false };
          connections.push(rec);
          return { close() { rec.closed = true; }, get lastEventId() { return undefined; } };
        },
      }),
  };
});

import { useSession } from "../src/hooks/useSession";

function message(id: string, requestId: string, text: string) {
  return {
    id,
    type: "message",
    role: "assistant",
    status: "completed",
    requestId,
    itemIndex: 0,
    provenance: { blockName: "test", blockInstanceId: "test-1", phase: "main" },
    ts: 1000,
    content: [{ type: "output_text", text }],
  };
}

beforeEach(() => {
  connections.length = 0;
  vi.clearAllMocks();
  sessionsMock.get.mockResolvedValue({ id: "sess1", flowKind: "demo", userId: "devuser", createdAt: 0, updatedAt: 0 });
  sessionsMock.state.mockResolvedValue({
    sessionId: "sess1",
    flowKind: "demo",
    clientData: {},
    items: [],
    pagination: { offset: 0, limit: 0, total: 0, hasMore: false, nextOffset: 0 },
  });
  sessionsMock.requests.mockResolvedValue([]);
  flowMock.abort.mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe("useSession.followRequest (FIX-2265)", () => {
  it("streams the named request's items into the session, and sends nothing", async () => {
    const { result } = renderHook(() => useSession("sess1", { flowKind: "demo" }));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => result.current.followRequest("req_line"));

    expect(flowMock.send).not.toHaveBeenCalled();
    expect(result.current.isStreaming).toBe(true);
    const stream = connections.at(-1)!;
    expect(stream.url).toContain("/requests/req_line/stream");
    act(() => stream.callbacks.onItemAdded?.({ type: "item.added", item: message("m1", "req_line", "BRAVO") }));
    expect(result.current.items.find((item) => item.id === "m1")).toMatchObject({ requestId: "req_line" });
  });

  it("closes the stream it followed before", async () => {
    const { result } = renderHook(() => useSession("sess1", { flowKind: "demo" }));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => result.current.followRequest("req_turn"));
    const first = connections.at(-1)!;
    act(() => result.current.followRequest("req_line"));

    expect(first.closed).toBe(true);
    expect(connections.at(-1)!.url).toContain("/requests/req_line/stream");
  });

  it("makes the followed request the one a stop reaches", async () => {
    const { result } = renderHook(() => useSession("sess1", { flowKind: "demo" }));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => result.current.followRequest("req_line"));
    await act(async () => {
      await result.current.abortRequest();
    });

    expect(flowMock.abort).toHaveBeenCalledWith("req_line");
  });

  it("keeps the request followed while a stop was out: the stop closes only the request it stopped", async () => {
    const { result } = renderHook(() => useSession("sess1", { flowKind: "demo" }));
    await act(async () => {
      await Promise.resolve();
    });
    let answerStop: () => void = () => undefined;
    flowMock.abort.mockImplementation(() => new Promise<void>((resolve) => (answerStop = resolve)));

    act(() => result.current.followRequest("req_turn"));
    let stopped: Promise<void> = Promise.resolve();
    act(() => {
      stopped = result.current.abortRequest();
    });
    // The stopped turn ends before the stop's answer lands, and the page follows the next one.
    act(() => result.current.followRequest("req_line"));
    const line = connections.at(-1)!;
    await act(async () => {
      answerStop();
      await stopped;
    });

    expect(line.url).toContain("/requests/req_line/stream");
    expect(line.closed).toBe(false);
    expect(result.current.isStreaming).toBe(true);
    // A stop now reaches the line.
    flowMock.abort.mockResolvedValue(undefined);
    await act(async () => {
      await result.current.abortRequest();
    });
    expect(flowMock.abort).toHaveBeenLastCalledWith("req_line");
  });
});
