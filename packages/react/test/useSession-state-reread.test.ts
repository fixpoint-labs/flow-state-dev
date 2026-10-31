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
 *     fails, state rewinds to the full read's; a full read always setting
 *     its detail: the same case fails on the title, and the "before the
 *     mount read" case too.
 *   - no state read in the stream's non-completed end: the "failed end"
 *     case fails.
 *   - a non-completed end that changed resources taking the full read, as
 *     it did: the "changed resources" case fails (an item page is read).
 *   - no live changes put back on a state read that was out: the "live
 *     change while a state read is out" case fails, state rewinds.
 *   - no state read after a stop: the "stop" case fails.
 *   - `followedRequest` from `latestRequest` alone: both "beside it" cases
 *     fail (null, or only the stream's status with no times).
 *   - every live change put back, `increment` too: the "counted twice" case
 *     fails (the count reads 2); every repeatable one put back, skipping the
 *     rest: the "set then an increment" case fails (the count reads 1); every change before
 *     an `atomic` or updater patch put back too: the "set then an atomic" and
 *     "updater patch" cases fail (the set's 1 over the read); none put back
 *     after one either: the "set after an atomic" case fails; no check for
 *     dropped changes: the "partly dropped" case fails (the count reads 0).
 *   - a state-only read that lands before the mount read dropped, as it was:
 *     the "before the mount read" case fails, state is the mount read's.
 *   - no stream status set by a stop: the "stopped" case fails (the request
 *     still reads in progress); not cleared on a refused stop: the "refused"
 *     case fails.
 *   - no session fence on the status read: the "session changed" case fails
 *     (the old session's record shows); a session fence alone: the "shown
 *     request changed" case fails (followedRequest reads null).
 *   - no session check after the stop or dismissal's await: the "resolves
 *     after the session changed" case fails (a read for the old session).
 *   - no stream status cleared by a dismissal: the "dismissed" case fails
 *     (the request still reads in progress).
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

import { ClientHttpError } from "@flow-state-dev/client";
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
    const detail = (title: string) => ({ id: "sess1", flowKind: "demo", userId: "devuser", title, createdAt: 0, updatedAt: 0 });
    sessionsMock.get.mockResolvedValueOnce(detail("older")).mockResolvedValueOnce(detail("newer"));

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
    // The detail was read with each state, so it is the newer one's too.
    expect(result.current.detail?.title).toBe("newer");
  });
});

describe("a live change while a state read is out", () => {
  it("is put back on top of what the read returned", async () => {
    const { result } = await mount();
    act(() => void result.current.followRequest("req_turn"));

    act(() => void result.current.refresh({ items: false }));
    await flush();
    const stateOnly = stateCalls.length - 1;

    // The turn's stream patches state after the read was requested; the
    // server answered the read before it kept that patch.
    act(() =>
      connections.at(-1)!.callbacks.onItemAdded?.({
        type: "item.added",
        item: {
          id: "sc1",
          type: "state_change",
          status: "completed",
          requestId: "req_turn",
          itemIndex: 1,
          provenance: { blockName: "test", blockInstanceId: "test-1", phase: "main" },
          ts: 2000,
          scope: "session",
          operation: "set",
          delta: { phase: "streamed" },
          version: 2,
          transient: false,
        },
      }),
    );
    expect(result.current.snapshot?.clientData.session).toEqual({ phase: "streamed" });

    await land(stateOnly, snapshot("read-before-the-patch"));
    expect(result.current.snapshot?.clientData.session).toEqual({ phase: "streamed" });
  });
});

describe("live changes a state read may already hold", () => {
  const counted = (count: number, items: unknown[] = []) => ({
    ...snapshot("counting", items),
    clientData: { session: { phase: "counting", count } },
  });
  const change = (id: string, operation: string, delta: unknown) => ({
    type: "item.added",
    item: {
      id,
      type: "state_change",
      status: "completed",
      requestId: "req_turn",
      itemIndex: 1,
      provenance: { blockName: "test", blockInstanceId: "test-1", phase: "main" },
      ts: 2000,
      scope: "session",
      operation,
      delta,
      version: 2,
      transient: false,
    },
  });
  async function mountCounting() {
    const hook = renderHook(() => useSession("sess1", { flowKind: "demo", items: true }));
    await flush();
    await land(0, counted(0, [message("m1", "req_turn")]));
    act(() => void hook.result.current.followRequest("req_turn"));
    act(() => void hook.result.current.refresh({ items: false }));
    await flush();
    return { ...hook, stateOnly: stateCalls.length - 1 };
  }

  it("an increment the read already holds is not counted twice", async () => {
    const { result, stateOnly } = await mountCounting();
    act(() => connections.at(-1)!.callbacks.onItemAdded?.(change("sc-inc", "increment", { count: 1 })));
    expect(result.current.snapshot?.clientData.session).toEqual({ phase: "counting", count: 1 });
    // The server kept the increment before it answered the read.
    await land(stateOnly, counted(1));
    expect(result.current.snapshot?.clientData.session).toEqual({ phase: "counting", count: 1 });
  });

  it("a set then an increment the read already holds land in order, not the set alone", async () => {
    const { result, stateOnly } = await mountCounting();
    act(() => connections.at(-1)!.callbacks.onItemAdded?.(change("sc-set", "set", { count: 1 })));
    act(() => connections.at(-1)!.callbacks.onItemAdded?.(change("sc-inc", "increment", { count: 1 })));
    expect(result.current.snapshot?.clientData.session).toEqual({ phase: "counting", count: 2 });
    await land(stateOnly, counted(2));
    expect(result.current.snapshot?.clientData.session).toEqual({ phase: "counting", count: 2 });
  });
  it("a set then an atomic change the read already holds: the read's state, not the set put back over it", async () => {
    const { result, stateOnly } = await mountCounting();
    act(() => connections.at(-1)!.callbacks.onItemAdded?.(change("sc-set", "set", { count: 1 })));
    act(() => connections.at(-1)!.callbacks.onItemAdded?.(change("sc-atomic", "atomic", undefined)));
    expect(result.current.snapshot?.clientData.session).toEqual({ phase: "counting", count: 1 });
    await land(stateOnly, counted(2));
    expect(result.current.snapshot?.clientData.session).toEqual({ phase: "counting", count: 2 });
  });

  it("a set after an atomic change is still put back", async () => {
    const { result, stateOnly } = await mountCounting();
    act(() => connections.at(-1)!.callbacks.onItemAdded?.(change("sc-atomic", "atomic", undefined)));
    act(() => connections.at(-1)!.callbacks.onItemAdded?.(change("sc-set", "set", { count: 7 })));
    // The server answered after the atomic change and before the set.
    await land(stateOnly, counted(3));
    expect(result.current.snapshot?.clientData.session).toEqual({ phase: "counting", count: 7 });
  });

  it("an updater patch counts as one that can't be put back", async () => {
    const { result, stateOnly } = await mountCounting();
    act(() => connections.at(-1)!.callbacks.onItemAdded?.(change("sc-set", "set", { count: 1 })));
    act(() =>
      connections.at(-1)!.callbacks.onItemAdded?.({
        ...change("sc-patch", "patch", { path: "count" }),
        item: { ...change("sc-patch", "patch", { path: "count" }).item, path: "count" },
      }),
    );
    await land(stateOnly, counted(5));
    expect(result.current.snapshot?.clientData.session).toEqual({ phase: "counting", count: 5 });
  });

  it("a read whose window of live changes was partly dropped is not reconciled", async () => {
    const { result, stateOnly } = await mountCounting();
    act(() => connections.at(-1)!.callbacks.onItemAdded?.(change("sc-inc", "increment", { count: 1 })));
    act(() => {
      for (let i = 0; i < 300; i += 1) {
        connections.at(-1)!.callbacks.onItemAdded?.(change(`sc-set-${i}`, "set", { phase: `p${i}` }));
      }
    });
    expect(result.current.snapshot?.clientData.session).toEqual({ phase: "p299", count: 1 });
    // The read holds neither the increment nor the sets.
    await land(stateOnly, counted(0));
    expect(result.current.snapshot?.clientData.session).toEqual({ phase: "p299", count: 1 });
  });
});

describe("a state-only read that lands before the mount read", () => {
  it("is what the mount read loads, since it is newer", async () => {
    sessionsMock.get.mockResolvedValueOnce({ id: "sess1", flowKind: "demo", userId: "devuser", title: "mount", createdAt: 0, updatedAt: 0 });
    sessionsMock.get.mockResolvedValueOnce({ id: "sess1", flowKind: "demo", userId: "devuser", title: "held", createdAt: 0, updatedAt: 0 });
    const { result } = renderHook(() => useSession("sess1", { flowKind: "demo", items: true }));
    await flush();
    act(() => void result.current.refresh({ items: false }));
    await flush();
    const stateOnly = stateCalls.length - 1;

    await land(stateOnly, snapshot("newer"));
    expect(result.current.snapshot).toBeNull();
    await land(0, snapshot("mounted", [message("m1", "req_turn")]));

    expect(result.current.items.map((item) => item.id)).toEqual(["m1"]);
    expect(result.current.snapshot?.clientData.session).toEqual({ phase: "newer" });
    expect(result.current.detail?.title).toBe("held");
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

  it("a failed end that changed resources still re-reads state only, not the history", async () => {
    const { result } = await mount();
    act(() => void result.current.followRequest("req_turn"));
    const itemReadsBefore = itemReads().length;

    act(() =>
      connections.at(-1)!.callbacks.onItemAdded?.({
        type: "item.added",
        item: {
          id: "rc1",
          type: "resource_change",
          status: "completed",
          requestId: "req_turn",
          itemIndex: 1,
          provenance: { blockName: "test", blockInstanceId: "test-1", phase: "main" },
          ts: 2000,
          resourcePath: "notes",
          changeType: "created",
          transient: true,
        },
      }),
    );
    act(() => connections.at(-1)!.callbacks.onRequestStatus?.({ type: "request.failed", status: "failed" }));
    await flush();

    expect(itemReads()).toHaveLength(itemReadsBefore);
    expect(stateOnlyReads()).toHaveLength(1);
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

  it("a stop or dismissal that resolves after the session changed reads nothing for the next session", async () => {
    for (const stop of ["abortRequest", "dismissRequest"] as const) {
      stateCalls.length = 0;
      let release!: () => void;
      flowMock.abort.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));
      const { result, rerender, unmount } = renderHook(({ id }) => useSession(id, { flowKind: "demo", items: true }), {
        initialProps: { id: "sess1" },
      });
      await flush();
      await land(0, snapshot("mounted", [message("m1", "req_turn")]));
      act(() => void result.current.followRequest("req_turn"));

      let stopped!: Promise<void>;
      act(() => {
        stopped = result.current[stop]("req_turn" as never);
      });
      rerender({ id: "sess2" });
      await flush();
      await land(stateCalls.length - 1, { ...snapshot("second"), sessionId: "sess2" });
      const readsBefore = stateCalls.length;

      await act(async () => {
        release();
        await stopped;
      });
      await flush();
      expect(stateCalls.length, stop).toBe(readsBefore);
      expect(result.current.snapshot?.clientData.session, stop).toEqual({ phase: "second" });
      unmount();
    }
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
  it("a stopped request reads stopped, not still in progress", async () => {
    const { result } = await mount();
    act(() => void result.current.followRequest("req_turn"));
    await act(async () => {
      await result.current.abortRequest();
    });
    await flush();
    expect(result.current.followedRequest?.status).toBe("aborted");
  });

  it("a refused stop leaves the request's own record to say how it ended", async () => {
    const { result } = await mount();
    act(() => void result.current.followRequest("req_turn"));
    flowMock.abort.mockRejectedValue(new ClientHttpError("Abort request failed (409)", { status: 409, body: "" }));
    sessionsMock.requests.mockResolvedValue([
      { id: "req_turn", status: "completed", startedAtMs: 10, completedAtMs: 20, flowKind: "demo", actionName: "turn", userId: "devuser", createdAt: 0, updatedAt: 0 },
    ]);
    await act(async () => {
      await result.current.abortRequest();
    });
    await flush();
    expect(result.current.followedRequest).toEqual({ id: "req_turn", status: "completed", startedAtMs: 10, completedAtMs: 20 });
  });

  it("a dismissed request reads its record, not still in progress", async () => {
    const { result } = await mount();
    act(() => void result.current.followRequest("req_turn"));
    sessionsMock.requests.mockResolvedValue([
      { id: "req_turn", status: "aborted", startedAtMs: 10, flowKind: "demo", actionName: "turn", userId: "devuser", createdAt: 0, updatedAt: 0 },
    ]);
    await act(async () => {
      await result.current.dismissRequest("req_turn");
    });
    await flush();
    expect(result.current.followedRequest?.status).toBe("aborted");
  });

  it("a status read for a request no longer shown does not land over the shown one's", async () => {
    sessionsMock.requests.mockResolvedValue([
      { id: "req_steer", status: "completed", flowKind: "demo", actionName: "steer", userId: "devuser", createdAt: 0, updatedAt: 0 },
    ]);
    const answers: Array<(value: unknown) => void> = [];
    requestMock.status.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    const { result } = await mount();
    await flush();
    expect(answers).toHaveLength(1);

    // A refresh shows a newer request's item before the first read answers.
    act(() => void result.current.refresh());
    await flush();
    await land(stateCalls.length - 1, snapshot("later", [message("m1", "req_turn"), { ...message("m2", "req_next"), ts: 2000 }]));
    await flush();
    expect(answers).toHaveLength(2);

    await act(async () => {
      answers[1]!({ id: "req_next", status: "completed", startedAtMs: 40, completedAtMs: 50, ageMs: 1 });
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    await act(async () => {
      answers[0]!({ id: "req_turn", status: "completed", startedAtMs: 10, completedAtMs: 20, ageMs: 1 });
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    expect(result.current.followedRequest).toEqual({ id: "req_next", status: "completed", startedAtMs: 40, completedAtMs: 50 });
  });

  it("a status read for the session before does not land after the session changed", async () => {
    sessionsMock.requests.mockResolvedValue([
      { id: "req_steer", status: "completed", flowKind: "demo", actionName: "steer", userId: "devuser", createdAt: 0, updatedAt: 0 },
    ]);
    const answers: Array<(value: unknown) => void> = [];
    requestMock.status.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    const { result, rerender } = renderHook(({ id }) => useSession(id, { flowKind: "demo", items: true }), {
      initialProps: { id: "sess1" as string | undefined },
    });
    await flush();
    await land(0, snapshot("mounted", [message("m1", "req_turn")]));
    await flush();
    expect(requestMock.status).toHaveBeenCalledTimes(1);

    rerender({ id: "sess2" });
    await flush();
    // The new session shows an item of the same request id; its own read is
    // still out when the old session's answer arrives.
    await land(stateCalls.length - 1, { ...snapshot("other", [message("m9", "req_turn")]), sessionId: "sess2" });
    await act(async () => {
      answers[0]!({ id: "req_turn", status: "failed", startedAtMs: 1, completedAtMs: 2, ageMs: 1 });
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    // The new session's own read is still out: nothing is known yet.
    expect(result.current.followedRequest).toBeNull();
  });

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
