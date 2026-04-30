import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryStores } from "../src/stores";
import type { RequestRecord, StoreRegistry } from "../src/stores/types";
import { createStaleRequestSweeper } from "../src/execution/stale-request-sweeper";

function makeRequestRecord(
  id: string,
  overrides?: Partial<RequestRecord>
): RequestRecord {
  const ts = Date.now();
  return {
    id,
    flowKind: "chat",
    actionName: "run",
    userId: "user_1",
    source: "http",
    status: "in_progress",
    startedAtMs: ts,
    state: {},
    version: 0,
    createdAt: ts,
    updatedAt: ts,
    ...overrides
  };
}

describe("createStaleRequestSweeper", () => {
  let stores: StoreRegistry;

  beforeEach(() => {
    stores = createInMemoryStores();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a no-op handle when intervalMs <= 0", () => {
    const sweeper = createStaleRequestSweeper({ stores, intervalMs: 0 });
    expect(typeof sweeper.dispose).toBe("function");
    sweeper.dispose();
    sweeper.dispose();
  });

  it("marks stale in_progress requests as interrupted on tick", async () => {
    vi.useFakeTimers();

    const startedAt = Date.now() - 120_000;
    await stores.activeRequests.register({
      requestId: "req_stuck",
      flowKind: "chat",
      actionName: "run",
      userId: "user_1",
      source: "http",
      startedAt,
      lastHeartbeatAt: startedAt
    });
    await stores.request.set(
      "req_stuck",
      makeRequestRecord("req_stuck", { startedAtMs: startedAt }),
      "any"
    );

    const sweeper = createStaleRequestSweeper({
      stores,
      intervalMs: 1000,
      staleThresholdMs: 30_000
    });

    // Advance one interval and let microtasks settle.
    await vi.advanceTimersByTimeAsync(1100);

    const record = await stores.request.get("req_stuck");
    expect(record?.status).toBe("interrupted");
    const entry = await stores.activeRequests.get("req_stuck");
    expect(entry).toBeUndefined();

    sweeper.dispose();
  });

  it("does not overwrite already-terminal requests", async () => {
    vi.useFakeTimers();

    await stores.activeRequests.register({
      requestId: "req_done",
      flowKind: "chat",
      actionName: "run",
      userId: "user_1",
      source: "http",
      startedAt: Date.now() - 120_000,
      lastHeartbeatAt: Date.now() - 120_000
    });
    await stores.request.set(
      "req_done",
      makeRequestRecord("req_done", { status: "completed" }),
      "any"
    );

    const sweeper = createStaleRequestSweeper({
      stores,
      intervalMs: 1000,
      staleThresholdMs: 30_000
    });

    await vi.advanceTimersByTimeAsync(1100);

    const record = await stores.request.get("req_done");
    expect(record?.status).toBe("completed");

    sweeper.dispose();
  });

  it("dispose stops further ticks", async () => {
    vi.useFakeTimers();

    const sweeper = createStaleRequestSweeper({
      stores,
      intervalMs: 1000,
      staleThresholdMs: 30_000
    });

    sweeper.dispose();

    // Add stale entry AFTER dispose; sweeper must not act on it.
    await stores.activeRequests.register({
      requestId: "req_after_dispose",
      flowKind: "chat",
      actionName: "run",
      userId: "user_1",
      source: "http",
      startedAt: Date.now() - 120_000,
      lastHeartbeatAt: Date.now() - 120_000
    });
    await stores.request.set(
      "req_after_dispose",
      makeRequestRecord("req_after_dispose"),
      "any"
    );

    await vi.advanceTimersByTimeAsync(5000);

    const record = await stores.request.get("req_after_dispose");
    expect(record?.status).toBe("in_progress");
  });
});
