// @vitest-environment happy-dom
/**
 * `useSession` reports `isLoading` on the first paint when a session id is
 * given, and not when it is missing. A transcript that hides itself until
 * that flag clears must not flash empty (FIX-2218).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";

const { sessionsMock } = vi.hoisted(() => ({
  sessionsMock: {
    get: vi.fn(),
    state: vi.fn(),
    requests: vi.fn()
  }
}));

vi.mock("@flow-state-dev/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flow-state-dev/client")>();
  const { fakeClient } = await import("./support/fake-client");
  const noopSSE = () => ({
    close() {},
    get lastEventId() {
      return undefined;
    }
  });
  return {
    ...actual,
    createSSEClientFromResponse: noopSSE,
    createClient: () =>
      fakeClient({
        sessions: { ...sessionsMock },
        flow: { send: vi.fn(), abort: vi.fn() },
        requestStream: noopSSE
      })
  };
});

import { useSession } from "../src/hooks/useSession";

function snapshot(sessionId: string) {
  return {
    sessionId,
    flowKind: "demo",
    clientData: {},
    items: [],
    pagination: {
      offset: 0,
      limit: 50,
      total: 0,
      hasMore: false,
      nextOffset: 0
    }
  };
}

function detail(id: string) {
  return {
    id,
    flowKind: "demo",
    userId: "devuser",
    createdAt: 0,
    updatedAt: 0
  };
}

describe("useSession isLoading (FIX-2218)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sessionsMock.get.mockImplementation(async (id: string) => detail(id));
    sessionsMock.state.mockImplementation(async (id: string) => snapshot(id));
    sessionsMock.requests.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it("is loading on the first paint when a session id is given", () => {
    sessionsMock.get.mockReturnValue(new Promise(() => {}));
    sessionsMock.state.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useSession("job1", { flowKind: "demo" }));

    expect(result.current.isLoading).toBe(true);
  });

  it("is not loading on the first paint when no session id is given", () => {
    const { result } = renderHook(() =>
      useSession(undefined, { flowKind: "demo" })
    );

    expect(result.current.isLoading).toBe(false);
    expect(sessionsMock.get).not.toHaveBeenCalled();
  });

  it("clears loading once the snapshot lands, and is loading again on the first paint of a new id", async () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useSession(id, { flowKind: "demo" }),
      { initialProps: { id: "job1" } }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.sessionId).toBe("job1");

    rerender({ id: "job2" });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.sessionId).toBe("job2");

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });
});
