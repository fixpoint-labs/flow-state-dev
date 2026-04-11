import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "../src/stores";
import type { RequestRecord } from "../src/stores/types";
import {
  applyRetentionPolicy,
  resolveRetentionPolicy,
  type ResolvedRetentionPolicy,
} from "../src/execution/retention";

/**
 * Helper: create a completed request record with predictable timestamps and item counts.
 */
function makeRequest(
  id: string,
  sessionId: string,
  opts: { startedAtMs: number; completedAtMs: number; itemCount: number; status?: RequestRecord["status"] }
): RequestRecord {
  return {
    id,
    flowKind: "test-flow",
    actionName: "run",
    userId: "user1",
    sessionId,
    status: opts.status ?? "completed",
    startedAtMs: opts.startedAtMs,
    completedAtMs: opts.completedAtMs,
    state: {},
    version: 1,
    createdAt: opts.startedAtMs,
    updatedAt: opts.completedAtMs,
    items: Array.from({ length: opts.itemCount }, (_, i) => ({
      kind: "message" as const,
      role: "assistant" as const,
      content: [{ type: "text" as const, text: `item-${i}` }],
      provenance: { blockName: "test", blockInstanceId: "inst", requestId: id },
    })),
  };
}

describe("resolveRetentionPolicy", () => {
  it("returns undefined for undefined input", () => {
    expect(resolveRetentionPolicy(undefined)).toBeUndefined();
  });

  it("returns undefined when both fields are missing", () => {
    expect(resolveRetentionPolicy({})).toBeUndefined();
  });

  it("resolves maxItems only", () => {
    expect(resolveRetentionPolicy({ maxItems: 100 })).toEqual({
      maxItems: 100,
      maxAgeMs: undefined,
    });
  });

  it("resolves maxAge string to milliseconds", () => {
    expect(resolveRetentionPolicy({ maxAge: "24h" })).toEqual({
      maxItems: undefined,
      maxAgeMs: 86_400_000,
    });
  });

  it("resolves maxAge number as pass-through", () => {
    expect(resolveRetentionPolicy({ maxAge: 5000 })).toEqual({
      maxItems: undefined,
      maxAgeMs: 5000,
    });
  });

  it("resolves both fields together", () => {
    expect(resolveRetentionPolicy({ maxItems: 500, maxAge: "1h" })).toEqual({
      maxItems: 500,
      maxAgeMs: 3_600_000,
    });
  });
});

describe("applyRetentionPolicy", () => {
  const SESSION_ID = "sess_retention";
  const CURRENT_REQ = "req_current";

  async function setupStores(requests: RequestRecord[]) {
    const stores = createInMemoryStores();
    for (const req of requests) {
      await stores.request.set(req.id, req);
    }
    return stores;
  }

  describe("maxItems eviction", () => {
    it("evicts oldest requests when total items exceed maxItems", async () => {
      const stores = await setupStores([
        makeRequest("req_1", SESSION_ID, { startedAtMs: 100, completedAtMs: 200, itemCount: 5 }),
        makeRequest("req_2", SESSION_ID, { startedAtMs: 300, completedAtMs: 400, itemCount: 5 }),
        makeRequest("req_3", SESSION_ID, { startedAtMs: 500, completedAtMs: 600, itemCount: 5 }),
        makeRequest(CURRENT_REQ, SESSION_ID, { startedAtMs: 700, completedAtMs: 800, itemCount: 3 }),
      ]);

      const policy: ResolvedRetentionPolicy = { maxItems: 10 };
      const result = await applyRetentionPolicy(stores, SESSION_ID, CURRENT_REQ, policy, 900);

      // Current has 3 items, budget is 10, so 7 items from history fit.
      // req_3 (5 items) fits: 3+5=8. req_2 (5 items) would be 13, exceeds 10.
      // req_1 and req_2 should be evicted.
      expect(result.deletedRequestIds).toContain("req_1");
      expect(result.deletedRequestIds).toContain("req_2");
      expect(result.deletedRequestIds).not.toContain("req_3");

      // Verify deleted from store
      expect(await stores.request.get("req_1")).toBeUndefined();
      expect(await stores.request.get("req_2")).toBeUndefined();
      expect(await stores.request.get("req_3")).toBeDefined();
    });

    it("does not evict when under the limit", async () => {
      const stores = await setupStores([
        makeRequest("req_1", SESSION_ID, { startedAtMs: 100, completedAtMs: 200, itemCount: 3 }),
        makeRequest(CURRENT_REQ, SESSION_ID, { startedAtMs: 300, completedAtMs: 400, itemCount: 2 }),
      ]);

      const policy: ResolvedRetentionPolicy = { maxItems: 10 };
      const result = await applyRetentionPolicy(stores, SESSION_ID, CURRENT_REQ, policy, 500);

      expect(result.deletedRequestIds).toEqual([]);
      expect(await stores.request.get("req_1")).toBeDefined();
    });

    it("never evicts the current request", async () => {
      const stores = await setupStores([
        makeRequest(CURRENT_REQ, SESSION_ID, { startedAtMs: 100, completedAtMs: 200, itemCount: 20 }),
      ]);

      const policy: ResolvedRetentionPolicy = { maxItems: 5 };
      const result = await applyRetentionPolicy(stores, SESSION_ID, CURRENT_REQ, policy, 300);

      expect(result.deletedRequestIds).toEqual([]);
      expect(await stores.request.get(CURRENT_REQ)).toBeDefined();
    });

    it("evicts all prior requests when maxItems is 0", async () => {
      const stores = await setupStores([
        makeRequest("req_1", SESSION_ID, { startedAtMs: 100, completedAtMs: 200, itemCount: 3 }),
        makeRequest("req_2", SESSION_ID, { startedAtMs: 300, completedAtMs: 400, itemCount: 3 }),
        makeRequest(CURRENT_REQ, SESSION_ID, { startedAtMs: 500, completedAtMs: 600, itemCount: 2 }),
      ]);

      // maxItems: 0 means only current request's items count toward limit,
      // and since current already uses 2 > 0, no old requests can fit
      const policy: ResolvedRetentionPolicy = { maxItems: 0 };
      const result = await applyRetentionPolicy(stores, SESSION_ID, CURRENT_REQ, policy, 700);

      expect(result.deletedRequestIds).toEqual(["req_1", "req_2"]);
    });
  });

  describe("maxAge eviction", () => {
    it("evicts requests older than maxAge", async () => {
      const now = 1000;
      const stores = await setupStores([
        makeRequest("req_old", SESSION_ID, { startedAtMs: 100, completedAtMs: 200, itemCount: 3 }),
        makeRequest("req_recent", SESSION_ID, { startedAtMs: 800, completedAtMs: 900, itemCount: 3 }),
        makeRequest(CURRENT_REQ, SESSION_ID, { startedAtMs: 950, completedAtMs: 990, itemCount: 2 }),
      ]);

      // maxAge: 500ms, so cutoff is now - 500 = 500. req_old completed at 200 < 500, evicted.
      const policy: ResolvedRetentionPolicy = { maxAgeMs: 500 };
      const result = await applyRetentionPolicy(stores, SESSION_ID, CURRENT_REQ, policy, now);

      expect(result.deletedRequestIds).toEqual(["req_old"]);
      expect(await stores.request.get("req_old")).toBeUndefined();
      expect(await stores.request.get("req_recent")).toBeDefined();
    });

    it("evicts all old requests when maxAge is 0", async () => {
      const now = 1000;
      const stores = await setupStores([
        makeRequest("req_1", SESSION_ID, { startedAtMs: 100, completedAtMs: 200, itemCount: 3 }),
        makeRequest("req_2", SESSION_ID, { startedAtMs: 500, completedAtMs: 999, itemCount: 3 }),
        makeRequest(CURRENT_REQ, SESSION_ID, { startedAtMs: 999, completedAtMs: 1000, itemCount: 2 }),
      ]);

      const policy: ResolvedRetentionPolicy = { maxAgeMs: 0 };
      const result = await applyRetentionPolicy(stores, SESSION_ID, CURRENT_REQ, policy, now);

      // Both prior requests completed before now (cutoff = 1000 - 0 = 1000)
      expect(result.deletedRequestIds).toEqual(["req_1", "req_2"]);
    });

    it("does not evict when all requests are within age limit", async () => {
      const now = 1000;
      const stores = await setupStores([
        makeRequest("req_1", SESSION_ID, { startedAtMs: 800, completedAtMs: 900, itemCount: 3 }),
        makeRequest(CURRENT_REQ, SESSION_ID, { startedAtMs: 950, completedAtMs: 990, itemCount: 2 }),
      ]);

      const policy: ResolvedRetentionPolicy = { maxAgeMs: 500 };
      const result = await applyRetentionPolicy(stores, SESSION_ID, CURRENT_REQ, policy, now);

      expect(result.deletedRequestIds).toEqual([]);
    });
  });

  describe("combined policies", () => {
    it("applies both maxAge and maxItems (age evicts first, then items)", async () => {
      const now = 1000;
      const stores = await setupStores([
        makeRequest("req_expired", SESSION_ID, { startedAtMs: 100, completedAtMs: 200, itemCount: 5 }),
        makeRequest("req_old", SESSION_ID, { startedAtMs: 400, completedAtMs: 600, itemCount: 5 }),
        makeRequest("req_recent", SESSION_ID, { startedAtMs: 800, completedAtMs: 900, itemCount: 5 }),
        makeRequest(CURRENT_REQ, SESSION_ID, { startedAtMs: 950, completedAtMs: 990, itemCount: 3 }),
      ]);

      // maxAge: 500ms removes req_expired (completed at 200 < 500 cutoff).
      // maxItems: 7 means current (3) + req_recent (5) = 8 > 7, so req_old also evicted.
      // Wait, 3 + 5 = 8 > 7. But we keep newest first. req_recent doesn't fit either?
      // Actually: current has 3. Budget is 7. Available: 7-3=4.
      // req_recent has 5 items > 4 available. So req_recent doesn't fit.
      // Let's adjust: maxItems: 10.
      // current: 3. Available: 7. req_recent (5) fits: total 8. req_old (5) would be 13 > 10.
      const policy: ResolvedRetentionPolicy = { maxAgeMs: 500, maxItems: 10 };
      const result = await applyRetentionPolicy(stores, SESSION_ID, CURRENT_REQ, policy, now);

      // req_expired: evicted by age
      // req_old: evicted by items (would push total to 3+5+5=13 > 10)
      // req_recent: kept
      expect(result.deletedRequestIds).toContain("req_expired");
      expect(result.deletedRequestIds).toContain("req_old");
      expect(result.deletedRequestIds).not.toContain("req_recent");
    });
  });

  describe("edge cases", () => {
    it("handles empty session (no prior requests)", async () => {
      const stores = await setupStores([
        makeRequest(CURRENT_REQ, SESSION_ID, { startedAtMs: 100, completedAtMs: 200, itemCount: 3 }),
      ]);

      const policy: ResolvedRetentionPolicy = { maxItems: 5 };
      const result = await applyRetentionPolicy(stores, SESSION_ID, CURRENT_REQ, policy, 300);

      expect(result.deletedRequestIds).toEqual([]);
    });

    it("ignores failed requests (not eviction candidates)", async () => {
      const stores = await setupStores([
        makeRequest("req_failed", SESSION_ID, {
          startedAtMs: 100, completedAtMs: 200, itemCount: 10, status: "failed"
        }),
        makeRequest("req_ok", SESSION_ID, { startedAtMs: 300, completedAtMs: 400, itemCount: 3 }),
        makeRequest(CURRENT_REQ, SESSION_ID, { startedAtMs: 500, completedAtMs: 600, itemCount: 2 }),
      ]);

      // The list query filters by status: "completed", so req_failed won't appear.
      const policy: ResolvedRetentionPolicy = { maxItems: 5 };
      const result = await applyRetentionPolicy(stores, SESSION_ID, CURRENT_REQ, policy, 700);

      expect(result.deletedRequestIds).toEqual([]);
      expect(await stores.request.get("req_failed")).toBeDefined();
    });

    it("handles requests with zero items", async () => {
      const stores = await setupStores([
        makeRequest("req_empty", SESSION_ID, { startedAtMs: 100, completedAtMs: 200, itemCount: 0 }),
        makeRequest("req_full", SESSION_ID, { startedAtMs: 300, completedAtMs: 400, itemCount: 5 }),
        makeRequest(CURRENT_REQ, SESSION_ID, { startedAtMs: 500, completedAtMs: 600, itemCount: 3 }),
      ]);

      const policy: ResolvedRetentionPolicy = { maxItems: 8 };
      const result = await applyRetentionPolicy(stores, SESSION_ID, CURRENT_REQ, policy, 700);

      // current (3) + req_full (5) = 8. req_empty (0) also fits: 8+0=8.
      expect(result.deletedRequestIds).toEqual([]);
    });

    it("uses startedAtMs when completedAtMs is missing", async () => {
      const now = 1000;
      const stores = await setupStores([
        makeRequest("req_no_complete", SESSION_ID, { startedAtMs: 100, completedAtMs: 200, itemCount: 3 }),
        makeRequest(CURRENT_REQ, SESSION_ID, { startedAtMs: 950, completedAtMs: 990, itemCount: 2 }),
      ]);

      // Remove completedAtMs to test fallback
      const record = await stores.request.get("req_no_complete");
      if (record) {
        delete record.completedAtMs;
        await stores.request.set(record.id, record);
      }

      // startedAtMs=100, cutoff=1000-500=500. 100 < 500 → evicted.
      const policy: ResolvedRetentionPolicy = { maxAgeMs: 500 };
      const result = await applyRetentionPolicy(stores, SESSION_ID, CURRENT_REQ, policy, now);

      expect(result.deletedRequestIds).toEqual(["req_no_complete"]);
    });
  });
});
