import { describe, it, expect } from "vitest";
import type { ActiveRequestEntry, ActiveRequestRegistry } from "@flow-state-dev/server";
import { findScheduledRequest } from "../src";

const baseEntry = {
  actionName: "doThing",
  userId: "u_1",
  startedAt: 0,
  lastHeartbeatAt: 0
};

function createInMemoryActiveRequestRegistry(): ActiveRequestRegistry {
  const entries = new Map<string, ActiveRequestEntry>();
  return {
    async register(entry) {
      entries.set(entry.requestId, entry);
    },
    async heartbeat(requestId) {
      const entry = entries.get(requestId);
      if (entry) entries.set(requestId, { ...entry, lastHeartbeatAt: Date.now() });
    },
    async deregister(requestId) {
      entries.delete(requestId);
    },
    async listStale() {
      return [];
    },
    async listAll() {
      return Array.from(entries.values());
    },
    async get(requestId) {
      return entries.get(requestId);
    }
  };
}

describe("findScheduledRequest", () => {
  it("returns null when nothing is in flight", async () => {
    const registry = createInMemoryActiveRequestRegistry();
    const result = await findScheduledRequest(registry, "demo", "weekly-digest");
    expect(result).toBeNull();
  });

  it("finds an in-flight scheduled request matching (flowKind, scheduleId)", async () => {
    const registry = createInMemoryActiveRequestRegistry();
    await registry.register({
      ...baseEntry,
      requestId: "req-1",
      flowKind: "demo",
      source: "scheduled",
      metadata: { schedule: { scheduleId: "weekly-digest" } }
    });
    const result = await findScheduledRequest(registry, "demo", "weekly-digest");
    expect(result?.requestId).toBe("req-1");
  });

  it("ignores requests from a different flow", async () => {
    const registry = createInMemoryActiveRequestRegistry();
    await registry.register({
      ...baseEntry,
      requestId: "req-1",
      flowKind: "other",
      source: "scheduled",
      metadata: { schedule: { scheduleId: "weekly-digest" } }
    });
    const result = await findScheduledRequest(registry, "demo", "weekly-digest");
    expect(result).toBeNull();
  });

  it("ignores requests with a different schedule id", async () => {
    const registry = createInMemoryActiveRequestRegistry();
    await registry.register({
      ...baseEntry,
      requestId: "req-1",
      flowKind: "demo",
      source: "scheduled",
      metadata: { schedule: { scheduleId: "daily-cleanup" } }
    });
    const result = await findScheduledRequest(registry, "demo", "weekly-digest");
    expect(result).toBeNull();
  });

  it("ignores HTTP-source requests with the same metadata shape", async () => {
    const registry = createInMemoryActiveRequestRegistry();
    await registry.register({
      ...baseEntry,
      requestId: "req-1",
      flowKind: "demo",
      source: "http",
      metadata: { schedule: { scheduleId: "weekly-digest" } }
    });
    const result = await findScheduledRequest(registry, "demo", "weekly-digest");
    expect(result).toBeNull();
  });

  it("ignores entries without a metadata.scheduleId", async () => {
    const registry = createInMemoryActiveRequestRegistry();
    await registry.register({
      ...baseEntry,
      requestId: "req-1",
      flowKind: "demo",
      source: "scheduled"
    });
    const result = await findScheduledRequest(registry, "demo", "weekly-digest");
    expect(result).toBeNull();
  });
});
