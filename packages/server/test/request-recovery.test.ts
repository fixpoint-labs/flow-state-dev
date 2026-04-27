import { describe, expect, it, vi, beforeEach } from "vitest";
import { createInMemoryStores } from "../src/stores";
import type { RequestRecord, StoreRegistry } from "../src/stores/types";
import { detectInterruptedRequests } from "../src/execution/request-recovery";

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
    status: "in_progress",
    startedAtMs: ts,
    state: {},
    version: 0,
    createdAt: ts,
    updatedAt: ts,
    ...overrides
  };
}

describe("detectInterruptedRequests", () => {
  let stores: StoreRegistry;

  beforeEach(() => {
    stores = createInMemoryStores();
  });

  it("marks stale in_progress requests as interrupted", async () => {
    // Register a stale active request
    await stores.activeRequests.register({
      requestId: "req_stale",
      flowKind: "chat",
      actionName: "run",
      userId: "user_1",
      startedAt: Date.now() - 60_000,
      lastHeartbeatAt: Date.now() - 60_000
    });

    // Create corresponding request record
    await stores.request.set("req_stale", makeRequestRecord("req_stale"), "any");

    const interrupted = await detectInterruptedRequests({
      stores,
      staleThresholdMs: 30_000
    });

    expect(interrupted).toHaveLength(1);
    expect(interrupted[0].entry.requestId).toBe("req_stale");

    // Request record should be updated
    const record = await stores.request.get("req_stale");
    expect(record!.status).toBe("interrupted");
    expect(record!.interruptedAt).toBeDefined();

    // Entry should be deregistered
    const entry = await stores.activeRequests.get("req_stale");
    expect(entry).toBeUndefined();
  });

  it("does not mark already completed requests", async () => {
    await stores.activeRequests.register({
      requestId: "req_done",
      flowKind: "chat",
      actionName: "run",
      userId: "user_1",
      startedAt: Date.now() - 60_000,
      lastHeartbeatAt: Date.now() - 60_000
    });

    await stores.request.set(
      "req_done",
      makeRequestRecord("req_done", { status: "completed" })
    , "any");

    const interrupted = await detectInterruptedRequests({
      stores,
      staleThresholdMs: 30_000
    });

    // Entry is still deregistered (cleanup), but record status unchanged
    expect(interrupted).toHaveLength(1);
    const record = await stores.request.get("req_done");
    expect(record!.status).toBe("completed");
  });

  it("returns empty array when no stale entries exist", async () => {
    const interrupted = await detectInterruptedRequests({
      stores,
      staleThresholdMs: 30_000
    });

    expect(interrupted).toHaveLength(0);
  });

  it("skips entries with recent heartbeats", async () => {
    await stores.activeRequests.register({
      requestId: "req_fresh",
      flowKind: "chat",
      actionName: "run",
      userId: "user_1",
      startedAt: Date.now(),
      lastHeartbeatAt: Date.now()
    });

    await stores.request.set("req_fresh", makeRequestRecord("req_fresh"), "any");

    const interrupted = await detectInterruptedRequests({
      stores,
      staleThresholdMs: 30_000
    });

    expect(interrupted).toHaveLength(0);

    // Request should still be in_progress
    const record = await stores.request.get("req_fresh");
    expect(record!.status).toBe("in_progress");
  });
});
