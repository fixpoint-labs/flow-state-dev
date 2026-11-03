// @vitest-environment happy-dom
/**
 * `useSession({ live: true })` hears other sessions' changes to the scopes it
 * reads (FIX-1506): after its first snapshot it subscribes its session, user
 * and org topics through `client.subscribe`, and on a notice it reads again,
 * never more than the change needs.
 *
 * Why it matters: two people watching one org's settings or roster saw each
 * other's changes only after a remount, and a write from a worker no browser
 * followed reached no one. The cost side matters as much: a state notice
 * must not page the item history, and the view that made the change must not
 * read it twice.
 *
 * The client is faked at its seam (`support/fake-client`), so each case hands
 * the hook exactly the notices it would hear and counts the reads it makes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { SubscribeOptions, WireNotice, WireTopic } from "@flow-state-dev/client";

const { sessionsMock, flowMock, subscriptions, ownStreams, resourcesMock } = vi.hoisted(() => ({
  sessionsMock: { get: vi.fn(), state: vi.fn(), requests: vi.fn(), children: vi.fn() },
  resourcesMock: { listCollectionItems: vi.fn(), getResourceManifest: vi.fn() },
  flowMock: { send: vi.fn(), abort: vi.fn() },
  subscriptions: [] as Array<{ topics: readonly WireTopic[]; options: SubscribeOptions; closed: boolean }>,
  // The view's own request streams, read from a send's response.
  ownStreams: [] as Array<Record<string, ((event: unknown) => void) | undefined>>
}));

vi.mock("@flow-state-dev/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/client")>();
  const { fakeClient } = await import("./support/fake-client");
  const noopSSE = () => ({ close() {}, get lastEventId() { return undefined; } });
  return {
    ...actual,
    createSSEClientFromResponse: (options: Record<string, ((event: unknown) => void) | undefined>) => {
      ownStreams.push(options);
      return noopSSE();
    },
    createClient: () =>
      fakeClient({
        sessions: { ...sessionsMock },
        resources: resourcesMock as never,
        flow: flowMock,
        requestStream: () => noopSSE(),
        sessionStream: () => ({ close() {}, lastAt: undefined, stopped: false }),
        subscribe: (topics, options) => {
          const entry = { topics, options, closed: false };
          subscriptions.push(entry);
          return {
            close() {
              entry.closed = true;
            }
          };
        }
      })
  };
});

import { topic } from "@flow-state-dev/client";
import { useSession } from "../src/hooks/useSession";
import { useResourceCollectionList } from "../src/hooks/useResourceCollectionList";

function snapshot(extra: Record<string, unknown> = {}) {
  return {
    sessionId: "sess1",
    flowKind: "demo",
    clientData: { org: { plan: "free" } },
    resources: { org: { licenses: { count: 1 } } },
    items: [],
    pagination: { offset: 0, limit: 100, total: 0, hasMore: false, nextOffset: 0 },
    ...extra
  };
}

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
};

/** The state reads made without items, the ones a notice may cost. */
const stateOnlyReads = () =>
  sessionsMock.state.mock.calls.filter(([, options]) => (options as { includeItems?: boolean } | undefined)?.includeItems === false);

function open() {
  const live = subscriptions.filter((s) => !s.closed);
  expect(live).toHaveLength(1);
  return live[0]!;
}

async function hear(notice: WireNotice | null) {
  await act(async () => {
    open().options.onChange(notice);
  });
  await flush();
}

async function mount(options: Record<string, unknown> = { live: true }) {
  const view = renderHook(() => useSession("sess1", { flowKind: "demo", ...options }));
  await waitFor(() => expect(view.result.current.isLoading).toBe(false));
  await flush();
  return view;
}

/** Mount live, then settle the connect read every subscription makes. */
async function mountLive() {
  const view = await mount();
  await waitFor(() => expect(subscriptions.filter((s) => !s.closed)).toHaveLength(1));
  await hear(null);
  sessionsMock.state.mockClear();
  const base = view.result.current.resourceChanges.length;
  /** The resource paths handed to the hooks since the connect read. */
  const announced = () => view.result.current.resourceChanges.slice(base).map((c) => c.resourcePath);
  return { ...view, announced };
}

describe("useSession live · other sessions' scope changes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    subscriptions.length = 0;
    ownStreams.length = 0;
    sessionsMock.get.mockResolvedValue({ id: "sess1", flowKind: "demo", userId: "devuser", createdAt: 0, updatedAt: 0 });
    sessionsMock.state.mockResolvedValue(snapshot());
    sessionsMock.requests.mockResolvedValue([]);
    sessionsMock.children.mockResolvedValue([]);
    resourcesMock.listCollectionItems.mockResolvedValue({ items: [] });
    resourcesMock.getResourceManifest.mockResolvedValue({
      flowKind: "demo",
      resources: [
        { ref: "roster", kind: "collection", scope: "org", pattern: "workforce/workers/*", hasClientData: false, client: {} },
        { ref: "desks", kind: "collection", scope: "org", pattern: "desks/*", hasClientData: false, client: {} }
      ]
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("subscribes its session, user and org topics once its snapshot is applied", async () => {
    await mount();
    await waitFor(() => expect(subscriptions).toHaveLength(1));
    expect(subscriptions[0]!.topics).toEqual([topic.session("sess1"), topic.user(), topic.org()]);
  });

  it("without `live`, subscribes nothing", async () => {
    await mount({});
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(subscriptions).toHaveLength(0);
  });

  it("reads state without items on another request's state notice", async () => {
    const { result } = await mountLive();
    sessionsMock.state.mockResolvedValue(snapshot({ clientData: { org: { plan: "pro" } } }));
    await hear({ topic: topic.org(), kind: "state", origin: { requestId: "req_elsewhere" } });
    expect(sessionsMock.state).toHaveBeenCalledTimes(1);
    expect(stateOnlyReads()).toHaveLength(1);
    expect(result.current.snapshot?.clientData).toEqual({ org: { plan: "pro" } });
  });

  it("skips a notice its own request made: its own stream already carried the change (D2)", async () => {
    const { result, announced } = await mountLive();
    flowMock.send.mockResolvedValue(
      new Response("", { status: 200, headers: { "content-type": "text/event-stream" } })
    );
    await act(async () => {
      await result.current.sendAction("plan", { plan: "pro" });
    });
    const sent = (flowMock.send.mock.calls[0]![2] as { requestId: string }).requestId;
    sessionsMock.state.mockClear();
    await hear({ topic: topic.org(), kind: "state", origin: { requestId: sent } });
    await hear({ topic: topic.org({ resource: "licenses/ada" }), kind: "resource", origin: { requestId: sent } });
    expect(sessionsMock.state).not.toHaveBeenCalled();
    expect(announced()).toEqual([]);
    // A notice with no origin (a resource route) reaches every view, this one too.
    await hear({ topic: topic.org(), kind: "state" });
    expect(stateOnlyReads()).toHaveLength(1);
  });

  /** Send one action through the view's own stream; returns its request id. */
  async function sendOwn(result: { current: ReturnType<typeof useSession> }): Promise<string> {
    flowMock.send.mockResolvedValue(new Response("", { status: 200, headers: { "content-type": "text/event-stream" } }));
    await act(async () => {
      await result.current.sendAction("plan", { plan: "pro" });
    });
    const calls = flowMock.send.mock.calls;
    return (calls[calls.length - 1]![2] as { requestId: string }).requestId;
  }

  it("hears its own request's notices again once that request's stream drops (it no longer carries them)", async () => {
    const { result } = await mountLive();
    const sent = await sendOwn(result);
    await act(async () => {
      ownStreams[ownStreams.length - 1]!.onError?.(new Error("connection reset"));
    });
    await flush();
    sessionsMock.state.mockClear();
    await hear({ topic: topic.org(), kind: "state", origin: { requestId: sent } });
    expect(stateOnlyReads()).toHaveLength(1);
  });

  it("hears its own request's notices again once another stream replaces that one", async () => {
    const { result } = await mountLive();
    const first = await sendOwn(result);
    await sendOwn(result);
    sessionsMock.state.mockClear();
    await hear({ topic: topic.org(), kind: "state", origin: { requestId: first } });
    expect(stateOnlyReads()).toHaveLength(1);
  });

  it("hears its own request's notices when the send failed and no stream follows it", async () => {
    const { result } = await mountLive();
    flowMock.send.mockRejectedValue(new Error("offline"));
    await act(async () => {
      await result.current.sendAction("plan", { plan: "pro" }).catch(() => undefined);
    });
    const sent = (flowMock.send.mock.calls[0]![2] as { requestId: string }).requestId;
    await flush();
    sessionsMock.state.mockClear();
    await hear({ topic: topic.org(), kind: "state", origin: { requestId: sent } });
    expect(stateOnlyReads()).toHaveLength(1);
  });

  it("hears its own request's notices once its stream has closed at the end (onFinished may still write)", async () => {
    const { result } = await mountLive();
    const sent = await sendOwn(result);
    await act(async () => {
      ownStreams[ownStreams.length - 1]!.onRequestStatus?.({ status: "completed" });
    });
    await flush();
    sessionsMock.state.mockClear();
    await hear({ topic: topic.org(), kind: "state", origin: { requestId: sent } });
    expect(stateOnlyReads()).toHaveLength(1);
  });

  it("passes a resource notice to the resource hooks, and reads state when the snapshot holds it", async () => {
    const { announced } = await mountLive();
    await hear({ topic: topic.org({ resource: "licenses/ada" }), kind: "resource", origin: { requestId: "req_elsewhere" } });
    expect(announced()).toEqual(["licenses/ada"]);
    expect(stateOnlyReads()).toHaveLength(1);
  });

  it("reads state for a resource stored under a path its snapshot key doesn't name", async () => {
    // `roster` is stored under `workforce/workers/*`: the notice's path can't
    // be ruled out of the held collection, so its count may have moved.
    sessionsMock.state.mockResolvedValue(snapshot({ clientData: {}, resources: { org: { roster: { count: 1 } } } }));
    await mountLive();
    await hear({ topic: topic.org({ resource: "workforce/workers/ada" }), kind: "resource" });
    expect(stateOnlyReads()).toHaveLength(1);
  });

  it("reads every resource it holds on a resource notice that names no path (a row only its owner may read)", async () => {
    const { announced } = await mountLive();
    await hear({ topic: topic.org(), kind: "resource", origin: { requestId: "req_elsewhere" } });
    expect(announced()).toEqual(["licenses"]);
    expect(stateOnlyReads()).toHaveLength(1);
  });

  it("reads no state for a resource the scope's state read doesn't carry", async () => {
    const { announced } = await mountLive();
    sessionsMock.state.mockResolvedValue(snapshot({ clientData: {} }));
    await hear({ topic: topic.session("sess1", { resource: "drafts/d1" }), kind: "resource" });
    expect(announced()).toEqual(["drafts/d1"]);
    expect(sessionsMock.state).not.toHaveBeenCalled();
  });

  it("leaves items, requests and runs to the session stream", async () => {
    const { announced } = await mountLive();
    for (const kind of ["items", "request", "run"] as const) {
      await hear({ topic: topic.session("sess1"), kind });
    }
    expect(sessionsMock.state).not.toHaveBeenCalled();
    expect(announced()).toEqual([]);
  });

  it("reads state once, and every resource it holds, on a connect, a reconnect or a tick", async () => {
    const { announced } = await mountLive();
    await hear(null);
    expect(stateOnlyReads()).toHaveLength(1);
    expect(announced()).toEqual(["licenses"]);
  });

  it("folds a burst of notices into one read in flight and one waiting", async () => {
    await mountLive();
    let release: (() => void) | undefined;
    sessionsMock.state.mockImplementation(
      () => new Promise((resolve) => {
        release = () => resolve(snapshot());
      })
    );
    for (let i = 0; i < 5; i += 1) await hear({ topic: topic.org(), kind: "state", origin: { requestId: `r${i}` } });
    expect(sessionsMock.state).toHaveBeenCalledTimes(1);
    await act(async () => release?.());
    await flush();
    await act(async () => release?.());
    await flush();
    expect(sessionsMock.state).toHaveBeenCalledTimes(2);
  });

  it("closes its subscription on unmount", async () => {
    const view = await mountLive();
    view.unmount();
    expect(subscriptions.every((s) => s.closed)).toBe(true);
  });

  it("re-reads a collection list whose storage path its key doesn't name, and not another collection", async () => {
    sessionsMock.state.mockResolvedValue(
      snapshot({ clientData: {}, resources: { org: { roster: { count: 1 }, desks: { count: 0 } } } })
    );
    const view = renderHook(() => {
      const session = useSession("sess1", { flowKind: "demo", live: true });
      const roster = useResourceCollectionList(session, "roster");
      return { session, roster };
    });
    await waitFor(() => expect(view.result.current.session.isLoading).toBe(false));
    await waitFor(() => expect(subscriptions.filter((s) => !s.closed)).toHaveLength(1));
    await hear(null);
    await flush();
    const rosterReads = () => resourcesMock.listCollectionItems.mock.calls.filter(([, ref]) => ref === "roster").length;
    const before = rosterReads();
    await hear({ topic: topic.org({ resource: "desks/d1" }), kind: "resource" });
    await flush();
    expect(rosterReads()).toBe(before);
    await hear({ topic: topic.org({ resource: "workforce/workers/ada" }), kind: "resource" });
    await flush();
    expect(rosterReads()).toBe(before + 1);
  });
});
