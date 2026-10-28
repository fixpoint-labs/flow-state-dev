// @vitest-environment happy-dom
/**
 * `useSession` applies `item.updated` patches from its own request stream while
 * the item is still in flight, rather than leaving the item as first added
 * until its `item.done` (or a snapshot) replaces it.
 *
 * The request stream is faked at the client seam: the hook resumes a running
 * request on mount, and each case hands its captured callbacks exactly the
 * events the server would send.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import type { OutputItem } from "@flow-state-dev/core/items";
import type { RequestStreamOptions } from "@flow-state-dev/client";

type CreateRequestStream = RequestStreamOptions & { url: string };

const { sessionsMock, requestStreams } = vi.hoisted(() => ({
  sessionsMock: {
    get: vi.fn(),
    state: vi.fn(),
    requests: vi.fn(),
    children: vi.fn()
  },
  requestStreams: [] as CreateRequestStream[]
}));

vi.mock("@flow-state-dev/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/client")>();
  const { fakeClient } = await import("./support/fake-client");
  const captureSSE = (options: CreateRequestStream) => {
    requestStreams.push(options);
    return {
      close() {},
      get lastEventId() {
        return undefined;
      }
    };
  };
  return {
    ...actual,
    createSSEClientFromResponse: captureSSE,
    createClient: () =>
      // A FRESH client per call, like the real factory: the hook memoizes its
      // client on its transport, so a singleton here would hide a backend change.
      fakeClient({ sessions: { ...sessionsMock }, flow: { send: vi.fn(), abort: vi.fn() }, requestStream: captureSSE })
  };
});

import { useSession } from "../src/hooks/useSession";

const REQUEST = "req_mine";

/** A tool call the runtime announces before the tool runs: args known, no output. */
function toolCall(fields: Record<string, unknown> = {}): OutputItem {
  return {
    id: "t1",
    type: "tool_output",
    status: "in_progress",
    requestId: REQUEST,
    itemIndex: 0,
    ts: 2,
    provenance: { blockName: "b", blockInstanceId: "b_1", phase: "main" },
    toolName: "lookup",
    input: { q: "x" },
    ...fields
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

function requestEvent(type: string, fields: Record<string, unknown>) {
  return { stream: "request", requestId: REQUEST, sequence_number: 1, ts: 2, type, ...fields } as never;
}

/** Mount attached to the view's own running request, and return its stream. */
async function mountAttached(options: Record<string, unknown> = {}) {
  const view = renderHook(() => useSession("sess1", { flowKind: "demo", autoResume: true, ...options }));
  await waitFor(() => expect(requestStreams).toHaveLength(1));
  return { ...view, own: requestStreams[0]! };
}

function held(items: readonly OutputItem[]): Record<string, unknown> | undefined {
  return items.find((entry) => entry.id === "t1") as unknown as Record<string, unknown> | undefined;
}

describe("useSession item.updated", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requestStreams.length = 0;
    sessionsMock.get.mockResolvedValue({
      id: "sess1",
      flowKind: "demo",
      userId: "devuser",
      createdAt: 0,
      updatedAt: 0,
      latestRequestId: REQUEST
    });
    sessionsMock.state.mockResolvedValue(snapshot());
    sessionsMock.requests.mockResolvedValue([
      { id: REQUEST, sessionId: "sess1", status: "in_progress", createdAt: 1, updatedAt: 1 }
    ]);
    sessionsMock.children.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  // The tool's result is the point of the row: a view that waits for item.done
  // shows a spinner with no output for as long as the rest of the step runs.
  it("shows a patch to an in-flight item before the item finishes", async () => {
    const { result, own } = await mountAttached();
    act(() => {
      own.onItemAdded?.(requestEvent("item.added", { item: toolCall() }));
    });
    expect(held(result.current.items)?.output).toBeUndefined();

    act(() => {
      own.onItemUpdated?.(
        requestEvent("item.updated", { itemId: "t1", patch: { status: "completed", output: { answer: 42 } } })
      );
    });
    expect(held(result.current.items)).toMatchObject({ status: "completed", output: { answer: 42 } });
  });

  it("never lets a patch change an item's identity", async () => {
    const { result, own } = await mountAttached();
    act(() => {
      own.onItemAdded?.(requestEvent("item.added", { item: toolCall() }));
      own.onItemUpdated?.(
        requestEvent("item.updated", { itemId: "t1", patch: { type: "message", output: { answer: 42 } } })
      );
    });
    expect(held(result.current.items)).toMatchObject({ type: "tool_output", output: { answer: 42 } });
  });

  // A resumed stream replays from the start; its patches are older than a
  // finished copy the view already holds, and would roll it back.
  it("ignores a patch to an item the view already holds finished", async () => {
    sessionsMock.state.mockResolvedValue(
      snapshot([toolCall({ status: "completed", output: { answer: 42 } })])
    );
    const { result, own } = await mountAttached();
    await waitFor(() => expect(held(result.current.items)?.status).toBe("completed"));

    act(() => {
      own.onItemUpdated?.(
        requestEvent("item.updated", { itemId: "t1", patch: { status: "in_progress", output: { partial: true } } })
      );
    });
    expect(held(result.current.items)).toMatchObject({ status: "completed", output: { answer: 42 } });
  });

  it("keeps a patched item through a snapshot read that began before the patch", async () => {
    const { result, own } = await mountAttached();
    act(() => {
      own.onItemAdded?.(requestEvent("item.added", { item: toolCall() }));
    });

    let release: (value: unknown) => void = () => {};
    sessionsMock.state.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    let refreshing: Promise<void> = Promise.resolve();
    act(() => {
      refreshing = result.current.refresh();
    });
    act(() => {
      own.onItemUpdated?.(requestEvent("item.updated", { itemId: "t1", patch: { output: { answer: 42 } } }));
    });

    await act(async () => {
      // Read before the patch was kept.
      release(snapshot([toolCall()]));
      await refreshing;
    });
    expect(held(result.current.items)?.output).toEqual({ answer: 42 });
  });

  it("keeps a filtered-out item out of the view when it is patched", async () => {
    const { result, own } = await mountAttached({ items: { itemTypes: ["message"] } });
    act(() => {
      own.onItemAdded?.(requestEvent("item.added", { item: toolCall() }));
      own.onItemUpdated?.(requestEvent("item.updated", { itemId: "t1", patch: { output: { answer: 42 } } }));
    });
    expect(held(result.current.items)).toBeUndefined();
  });
});
