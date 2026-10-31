// @vitest-environment happy-dom
/**
 * `useSession` re-reads a session's state without its item history: through
 * `refresh({ items: false })`, at every end of a request it follows, and
 * after a stop. And `followedRequest` reports the status of the request the
 * view shows last, even when a request sent beside it is the newest.
 *
 * Why it matters: an app that re-read the whole snapshot to pick up a few
 * state keys paid a page of items per hundred, every turn, so a long session
 * got slower each turn; and a page whose newest request was a steered line
 * could not read its turn's status from the hook.
 *
 * The client is faked (`support/fake-client`); each state read is held until
 * the test lands it, so reads can land out of order.
 *
 * Red states produced before these were trusted:
 *   - the state-only path calling the full read: the "one read" case fails
 *     (an item page is read).
 *   - no state sequence (a state-only read always lands): the "late
 *     state-only read" case fails, state rewinds.
 *   - a full read always taking state: the "newer state-only read" case
 *     fails, state rewinds to the full read's.
 *   - no state read in the stream's non-completed end: the "failed end"
 *     case fails.
 *   - no state read after a stop: the "stop" case fails.
 *   - `followedRequest` from `latestRequest` alone: both "beside it" cases
 *     fail (null, or only the stream's status with no times).
 *   - reading the followed request's status as soon as its stream ends,
 *     before the latest-request read lands: the "record when it ends" case
 *     fails (a status read the latest read made needless).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

type StateCall = { options: Record<string, unknown>; resolve: (value: unknown) => void };

const { connections, stateCalls, sessionsMock, flowMock, requestMock } = vi.hoisted(() => ({
  connections: [] as Array<{ url: string; callbacks: Record<string, ((e: unknown) => void) | undefined> }>,
  stateCalls: [] as StateCall[],
  sessionsMock: { get: vi.fn(), state: vi.fn(), requests: vi.fn(), children: vi.fn() },
  flowMock: { send: vi.fn(), abort: vi.fn() },
  requestMock: { status: vi.fn() },
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
        request: requestMock,
        requestStream: (options) => {
          connections.push({ url: options.url, callbacks: options as never });
          return { close() {}, get lastEventId() { return undefined; } };
        },
      }),
  };
});

import { useSession } from "../src/hooks/useSession";

function message(id: string, requestId: string) {
  return {
    id,
    type: "message",
    role: "assistant",
    status: "completed",
    requestId,
    itemIndex: 0,
    provenance: { blockName: "test", blockInstanceId: "test-1", phase: "main" },
    ts: 1000,
    content: [{ type: "output_text", text: id }],
  };
}

function snapshot(phase: string, items: unknown[] = []) {
  return {
    sessionId: "sess1",
    flowKind: "demo",
    clientData: { session: { phase } },
    items,
    pagination: { offset: 0, limit: items.length, total: items.length, hasMore: false, nextOffset: items.length },
  };
}

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
};

/** Land the state read made at `index` with `value`. */
async function land(index: number, value: unknown) {
  await act(async () => {
    stateCalls[index]!.resolve(value);
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

const itemReads = () => stateCalls.filter((call) => call.options.includeItems === true);
const stateOnlyReads = () => stateCalls.filter((call) => call.options.includeItems === false);

/** Mount with one item from `req_turn` and the state `phase: "mounted"`. */
async function mount() {
  const hook = renderHook(() => useSession("sess1", { flowKind: "demo", items: true }));
  await flush();
  await land(0, snapshot("mounted", [message("m1", "req_turn")]));
  return hook;
}

beforeEach(() => {
  connections.length = 0;
  stateCalls.length = 0;
  vi.clearAllMocks();
  sessionsMock.get.mockResolvedValue({ id: "sess1", flowKind: "demo", userId: "devuser", createdAt: 0, updatedAt: 0 });
  sessionsMock.state.mockImplementation(
    (_sessionId: string, options: Record<string, unknown>) =>
      new Promise((resolve) => stateCalls.push({ options, resolve })),
  );
  sessionsMock.requests.mockResolvedValue([]);
  sessionsMock.children.mockResolvedValue([]);
  flowMock.abort.mockResolvedValue(undefined);
  requestMock.status.mockResolvedValue({ id: "req_turn", status: "completed", startedAtMs: 10, completedAtMs: 20, ageMs: 1 });
});

afterEach(() => cleanup());

describe("refresh({ items: false })", () => {
  it("reads state once with no item page, and leaves the items on screen as they are", async () => {
    const { result } = await mount();
    const itemsBefore = result.current.items;
    const readsBefore = stateCalls.length;
    const childReadsBefore = sessionsMock.children.mock.calls.length;

    let done!: Promise<void>;
    act(() => {
      done = result.current.refresh({ items: false });
    });
    await flush();

    expect(stateCalls.length).toBe(readsBefore + 1);
    expect(stateCalls.at(-1)!.options).toEqual({ includeItems: false });
    expect(sessionsMock.children.mock.calls.length).toBe(childReadsBefore + 1);

    await land(stateCalls.length - 1, snapshot("after-steer"));
    await act(async () => {
      await done;
    });

    expect(result.current.snapshot?.clientData.session).toEqual({ phase: "after-steer" });
    expect(result.current.items).toBe(itemsBefore);
    expect(result.current.items.map((item) => item.id)).toEqual(["m1"]);
  });

  it("a late state-only read does not rewind state a newer full read set", async () => {
    const { result } = await mount();

    act(() => void result.current.refresh({ items: false }));
    await flush();
    const stateOnly = stateCalls.length - 1;
    act(() => void result.current.refresh());
    await flush();
    const full = stateCalls.length - 1;

    await land(full, snapshot("newer", [message("m1", "req_turn"), message("m2", "req_turn")]));
    await land(stateOnly, snapshot("older"));

    expect(result.current.snapshot?.clientData.session).toEqual({ phase: "newer" });
    expect(result.current.items.map((item) => item.id)).toEqual(["m1", "m2"]);
  });

  it("a full read landing after a newer state-only read loads its items and keeps the newer state", async () => {
    const { result } = await mount();

    act(() => void result.current.refresh());
    await flush();
    const full = stateCalls.length - 1;
    act(() => void result.current.refresh({ items: false }));
    await flush();
    const stateOnly = stateCalls.length - 1;

    await land(stateOnly, snapshot("newer"));
    await land(full, snapshot("older", [message("m1", "req_turn"), message("m2", "req_turn")]));

    expect(result.current.items.map((item) => item.id)).toEqual(["m1", "m2"]);
    expect(result.current.snapshot?.clientData.session).toEqual({ phase: "newer" });
  });
});

describe("state at a request's end", () => {
  it("a failed end re-reads state only", async () => {
    const { result } = await mount();
    act(() => void result.current.followRequest("req_turn"));
    const itemReadsBefore = itemReads().length;

    act(() => connections.at(-1)!.callbacks.onRequestStatus?.({ type: "request.failed", status: "failed" }));
    await flush();

    expect(stateOnlyReads()).toHaveLength(1);
    expect(itemReads()).toHaveLength(itemReadsBefore);
    await land(stateCalls.indexOf(stateOnlyReads()[0]!), snapshot("failure-recorded"));
    expect(result.current.snapshot?.clientData.session).toEqual({ phase: "failure-recorded" });
  });

  it("a completed end makes the full read it always made, and no state-only one", async () => {
    const { result } = await mount();
    act(() => void result.current.followRequest("req_turn"));
    const itemReadsBefore = itemReads().length;

    act(() => connections.at(-1)!.callbacks.onRequestStatus?.({ type: "request.completed", status: "completed" }));
    await flush();

    expect(itemReads()).toHaveLength(itemReadsBefore + 1);
    expect(stateOnlyReads()).toHaveLength(0);
  });

  it("a stop re-reads state only", async () => {
    const { result } = await mount();
    act(() => void result.current.followRequest("req_turn"));

    await act(async () => {
      await result.current.abortRequest();
    });
    await flush();

    expect(stateOnlyReads()).toHaveLength(1);
  });
});

describe("followedRequest", () => {
  it("reads the stream's status while it runs, then the record when it ends", async () => {
    const { result } = await mount();
    act(() => void result.current.followRequest("req_turn"));
    expect(result.current.followedRequest).toEqual({ id: "req_turn", status: "in_progress" });

    sessionsMock.requests.mockResolvedValue([
      { id: "req_turn", status: "completed", startedAtMs: 10, completedAtMs: 20, flowKind: "demo", actionName: "turn", userId: "devuser", createdAt: 0, updatedAt: 0 },
    ]);
    act(() => connections.at(-1)!.callbacks.onRequestStatus?.({ type: "request.completed", status: "completed" }));
    await flush();

    expect(result.current.followedRequest).toEqual({ id: "req_turn", status: "completed", startedAtMs: 10, completedAtMs: 20 });
    // The latest-request read named it: no status read.
    expect(requestMock.status).not.toHaveBeenCalled();
  });

  it("a followed request that ends with a request sent beside it newest reads its own status", async () => {
    const { result } = await mount();
    act(() => void result.current.followRequest("req_turn"));

    sessionsMock.requests.mockResolvedValue([
      { id: "req_steer", status: "completed", flowKind: "demo", actionName: "steer", userId: "devuser", createdAt: 0, updatedAt: 0 },
    ]);
    act(() => connections.at(-1)!.callbacks.onRequestStatus?.({ type: "request.failed", status: "failed" }));
    requestMock.status.mockResolvedValue({ id: "req_turn", status: "failed", startedAtMs: 10, completedAtMs: 30, ageMs: 1 });
    await flush();

    expect(requestMock.status).toHaveBeenCalledTimes(1);
    expect(result.current.followedRequest).toEqual({ id: "req_turn", status: "failed", startedAtMs: 10, completedAtMs: 30 });
  });

  it("when a request sent beside it is the newest, reads the shown request's own status once", async () => {
    sessionsMock.requests.mockResolvedValue([
      { id: "req_steer", status: "completed", flowKind: "demo", actionName: "steer", userId: "devuser", createdAt: 0, updatedAt: 0 },
    ]);
    const { result } = await mount();
    await flush();

    expect(requestMock.status).toHaveBeenCalledTimes(1);
    expect(requestMock.status).toHaveBeenCalledWith("req_turn");
    expect(result.current.latestRequest?.id).toBe("req_steer");
    expect(result.current.followedRequest).toEqual({ id: "req_turn", status: "completed", startedAtMs: 10, completedAtMs: 20 });

    // A re-render with nothing new reads nothing more.
    await flush();
    expect(requestMock.status).toHaveBeenCalledTimes(1);
  });
});
