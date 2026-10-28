import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "../src/stores";
import type { RequestListOptions, RequestRecord } from "../src/stores/types";
import type { MessageItem } from "@flow-state-dev/core/items";
import {
  applyRetentionPolicy,
  resolveRetentionPolicy,
  type ResolvedRetentionPolicy,
} from "../src/execution/retention";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";

/**
 * Helper: create a completed request record with predictable timestamps and item counts.
 */
function makeRequest(
  id: string,
  sessionId: string,
  opts: {
    startedAtMs: number;
    completedAtMs: number;
    itemCount: number;
    status?: RequestRecord["status"];
    finalizedAtMs?: number | null;
  }
): RequestRecord {
  return {
    id,
    flowKind: "test-flow",
    actionName: "run",
    userId: "user1",
    sessionId,
    source: "http",
    status: opts.status ?? "completed",
    startedAtMs: opts.startedAtMs,
    completedAtMs: opts.completedAtMs,
    ...(opts.finalizedAtMs !== undefined ? { finalizedAtMs: opts.finalizedAtMs } : {}),
    state: {},
    version: 1,
    createdAt: opts.startedAtMs,
    updatedAt: opts.completedAtMs,
    items: Array.from({ length: opts.itemCount }, (_, i): MessageItem => ({
      id: `${id}_item_${i}`,
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: `item-${i}` }],
      status: "completed",
      requestId: id,
      itemIndex: i,
      provenance: { blockName: "test", blockInstanceId: "inst", phase: "main" },
      ts: opts.startedAtMs + i,
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
      terminalGraceMs: 60_000,
      legacyGraceMs: 120_000,
    });
  });

  it("resolves maxAge string to milliseconds", () => {
    expect(resolveRetentionPolicy({ maxAge: "24h" })).toEqual({
      maxItems: undefined,
      maxAgeMs: 86_400_000,
      terminalGraceMs: 60_000,
      legacyGraceMs: 86_460_000,
    });
  });

  it("resolves maxAge number as pass-through", () => {
    expect(resolveRetentionPolicy({ maxAge: 5000 })).toEqual({
      maxItems: undefined,
      maxAgeMs: 5000,
      terminalGraceMs: 60_000,
      legacyGraceMs: 120_000,
    });
  });

  it("resolves both fields together", () => {
    expect(resolveRetentionPolicy({ maxItems: 500, maxAge: "1h" })).toEqual({
      maxItems: 500,
      maxAgeMs: 3_600_000,
      terminalGraceMs: 60_000,
      legacyGraceMs: 3_660_000,
    });
  });

  // A record from a version that never stamps is held for the stale-request
  // threshold the host actually uses, when it is longer than the default.
  it("takes the host's stale threshold into the rollout-safety bound when it is longer", () => {
    expect(
      resolveRetentionPolicy({ maxItems: 1 }, { staleThresholdMs: 300_000 })?.legacyGraceMs
    ).toBe(360_000);
    expect(
      resolveRetentionPolicy({ maxItems: 1 }, { staleThresholdMs: 1_000 })?.legacyGraceMs
    ).toBe(120_000);
  });

  // The grace window must outlast any live-tail stream still following a
  // request that has just finished, whatever the host set its timeout to.
  it("derives the terminal grace window from the live-tail liveness timeout", () => {
    const previous = process.env.LIVE_TAIL_LIVENESS_MS;
    process.env.LIVE_TAIL_LIVENESS_MS = "45000";
    try {
      expect(resolveRetentionPolicy({ maxItems: 1 })?.terminalGraceMs).toBe(90_000);
    } finally {
      if (previous === undefined) delete process.env.LIVE_TAIL_LIVENESS_MS;
      else process.env.LIVE_TAIL_LIVENESS_MS = previous;
    }
  });
});

describe("applyRetentionPolicy", () => {
  const SESSION_ID = "sess_retention";
  const CURRENT_REQ = "req_current";

  async function setupStores(requests: RequestRecord[]) {
    const stores = createInMemoryStores();
    for (const req of requests) {
      await stores.request.set(req.id, req, "any");
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

  describe("item over-fetch regression (FIX-685)", () => {
    it("never asks list() for items and still evicts correctly when list returns none", async () => {
      const stores = await setupStores([
        makeRequest("req_1", SESSION_ID, { startedAtMs: 100, completedAtMs: 200, itemCount: 5 }),
        makeRequest("req_2", SESSION_ID, { startedAtMs: 300, completedAtMs: 400, itemCount: 5 }),
        makeRequest("req_3", SESSION_ID, { startedAtMs: 500, completedAtMs: 600, itemCount: 5 }),
        makeRequest(CURRENT_REQ, SESSION_ID, { startedAtMs: 700, completedAtMs: 800, itemCount: 3 }),
      ]);

      // Simulate a persistent adapter's lean list: capture the options and
      // strip items from every result. Counting must go through countItems,
      // not the list payload.
      const listCalls: Array<RequestListOptions | undefined> = [];
      const origList = stores.request.list.bind(stores.request);
      stores.request.list = async (options?: RequestListOptions) => {
        listCalls.push(options);
        const records = await origList(options);
        return records.map((r: RequestRecord) => ({ ...r, items: undefined }));
      };

      const policy: ResolvedRetentionPolicy = { maxItems: 10 };
      const result = await applyRetentionPolicy(stores, SESSION_ID, CURRENT_REQ, policy, 900);

      expect(listCalls.length).toBeGreaterThan(0);
      expect(listCalls.some((o) => o?.withItems === true)).toBe(false);
      // Same eviction math as the maxItems case above: current (3) + req_3 (5)
      // fit in 10; req_1 and req_2 are evicted.
      expect(result.deletedRequestIds).toContain("req_1");
      expect(result.deletedRequestIds).toContain("req_2");
      expect(result.deletedRequestIds).not.toContain("req_3");
    });

    it("bounds concurrent item counts for large session histories", async () => {
      const priorRequests = Array.from({ length: 40 }, (_, i) =>
        makeRequest(`req_${i}`, SESSION_ID, {
          startedAtMs: i * 2,
          completedAtMs: i * 2 + 1,
          itemCount: 0,
        })
      );
      const stores = await setupStores([
        ...priorRequests,
        makeRequest(CURRENT_REQ, SESSION_ID, {
          startedAtMs: 100,
          completedAtMs: 101,
          itemCount: 0,
        }),
      ]);

      const countItems = stores.request.countItems.bind(stores.request);
      let activeCounts = 0;
      let maxActiveCounts = 0;
      stores.request.countItems = async (requestId: string) => {
        activeCounts += 1;
        maxActiveCounts = Math.max(maxActiveCounts, activeCounts);
        await new Promise((resolve) => setTimeout(resolve, 1));
        const count = await countItems(requestId);
        activeCounts -= 1;
        return count;
      };

      const result = await applyRetentionPolicy(
        stores,
        SESSION_ID,
        CURRENT_REQ,
        { maxItems: 1 },
        200
      );

      expect(result.deletedRequestIds).toEqual([]);
      expect(maxActiveCounts).toBeLessThanOrEqual(16);
      expect(maxActiveCounts).toBeGreaterThan(1);
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

      // The list query reads past turns only (completed or interrupted), so req_failed won't appear.
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
        await stores.request.set(record.id, record, "any");
      }

      // startedAtMs=100, cutoff=1000-500=500. 100 < 500 → evicted.
      const policy: ResolvedRetentionPolicy = { maxAgeMs: 500 };
      const result = await applyRetentionPolicy(stores, SESSION_ID, CURRENT_REQ, policy, now);

      expect(result.deletedRequestIds).toEqual(["req_no_complete"]);
    });
  });

  // A request's record turns `completed` before its run has persisted the
  // terminal event and left the active registry. A sibling's retention pass in
  // that window must not free the id: the run's last event would then land
  // under it, and the id's next owner would replay it.
  describe("a request whose run has not finished", () => {
    it("is not evicted, so its last event cannot land under a freed id", async () => {
      const stores = await setupStores([
        makeRequest("req_finishing", SESSION_ID, { startedAtMs: 100, completedAtMs: 200, itemCount: 5 }),
        makeRequest(CURRENT_REQ, SESSION_ID, { startedAtMs: 300, completedAtMs: 400, itemCount: 5 }),
      ]);
      // Still running: record says completed, terminal event not yet written.
      await stores.activeRequests.register({
        requestId: "req_finishing",
        flowKind: "test-flow",
        actionName: "run",
        source: "http",
        sessionId: SESSION_ID,
        userId: "user1",
        startedAt: 100,
        lastHeartbeatAt: 200
      });

      const result = await applyRetentionPolicy(
        stores, SESSION_ID, CURRENT_REQ, { maxItems: 5 }, 500
      );

      // The run then writes its terminal event.
      stores.request.persistEvents("req_finishing", [
        { stream: "request", type: "request.completed", requestId: "req_finishing", sequence_number: 9, status: "completed", ts: 210 }
      ]);
      await stores.request.flushEvents("req_finishing");

      expect(result.deletedRequestIds).toEqual([]);
      // The event belongs to a request that still exists, not to a freed id.
      expect(await stores.request.get("req_finishing")).toBeDefined();
    });

    // The active registry cannot be relied on for this: a process-local one
    // does not see a run finishing in another process. The grace window
    // covers that run's tail, and outlasts any stream still tailing it.
    it("is not evicted inside the terminal grace window, even when no registry shows it running", async () => {
      const stores = await setupStores([
        makeRequest("req_just_done", SESSION_ID, { startedAtMs: 100, completedAtMs: 1_000, itemCount: 5 }),
        makeRequest(CURRENT_REQ, SESSION_ID, { startedAtMs: 1_100, completedAtMs: 1_200, itemCount: 5 }),
      ]);

      const inside = await applyRetentionPolicy(
        stores, SESSION_ID, CURRENT_REQ, { maxItems: 5, terminalGraceMs: 60_000 }, 1_000 + 59_999
      );
      expect(inside.deletedRequestIds).toEqual([]);

      const after = await applyRetentionPolicy(
        stores, SESSION_ID, CURRENT_REQ, { maxItems: 5, terminalGraceMs: 60_000 }, 1_000 + 60_000
      );
      expect(after.deletedRequestIds).toEqual(["req_just_done"]);
    });

    it("is evicted by the next pass once its run has left the active registry", async () => {
      const stores = await setupStores([
        makeRequest("req_finishing", SESSION_ID, { startedAtMs: 100, completedAtMs: 200, itemCount: 5 }),
        makeRequest(CURRENT_REQ, SESSION_ID, { startedAtMs: 300, completedAtMs: 400, itemCount: 5 }),
      ]);

      const result = await applyRetentionPolicy(
        stores, SESSION_ID, CURRENT_REQ, { maxItems: 5 }, 500
      );

      expect(result.deletedRequestIds).toEqual(["req_finishing"]);
    });

    // A record written by this version carries `finalizedAtMs: null` until
    // its run has finished, `onFinished` included. Only the run can say that,
    // so no amount of elapsed time makes such a record evictable.
    it("is not evicted while its record says the run has not finished, however old", async () => {
      const stores = await setupStores([
        makeRequest("req_unfinished", SESSION_ID, {
          startedAtMs: 100, completedAtMs: 200, itemCount: 5, finalizedAtMs: null
        }),
        makeRequest(CURRENT_REQ, SESSION_ID, { startedAtMs: 300, completedAtMs: 400, itemCount: 5 }),
      ]);

      const result = await applyRetentionPolicy(
        stores, SESSION_ID, CURRENT_REQ, { maxItems: 5, terminalGraceMs: 60_000 }, 365 * 86_400_000
      );

      expect(result.deletedRequestIds).toEqual([]);
    });

    // The rollout-safety rule. A record with no `finalizedAtMs` at all was
    // written by a version that never stamps, so during a rolling deploy its
    // run may still be in `onFinished` on an old instance, invisible to this
    // one's registry. The short grace window is not enough: it is held until
    // a run with no heartbeat would count as dead (or `maxAge`, if larger).
    it("holds a record from a version that never stamps for the rollout-safety bound, not the grace window", async () => {
      const policy = resolveRetentionPolicy({ maxItems: 5 })!;
      const stores = await setupStores([
        makeRequest("req_old_version", SESSION_ID, { startedAtMs: 100, completedAtMs: 1_000, itemCount: 5 }),
        makeRequest(CURRENT_REQ, SESSION_ID, { startedAtMs: 1_100, completedAtMs: 1_200, itemCount: 5 }),
      ]);

      const pastGrace = await applyRetentionPolicy(
        stores, SESSION_ID, CURRENT_REQ, policy, 1_000 + policy.terminalGraceMs! + 1
      );
      expect(pastGrace.deletedRequestIds).toEqual([]);

      const justInside = await applyRetentionPolicy(
        stores, SESSION_ID, CURRENT_REQ, policy, 1_000 + policy.legacyGraceMs! - 1
      );
      expect(justInside.deletedRequestIds).toEqual([]);

      const atBound = await applyRetentionPolicy(
        stores, SESSION_ID, CURRENT_REQ, policy, 1_000 + policy.legacyGraceMs!
      );
      expect(atBound.deletedRequestIds).toEqual(["req_old_version"]);
    });

    // Only deleting a protected request waits. Its items are still history
    // the session holds, so they count toward `maxItems`, and older history
    // is evicted to make room for them.
    it("still counts toward maxItems, so older evictable history makes room for it", async () => {
      const stores = await setupStores([
        makeRequest("req_old", SESSION_ID, {
          startedAtMs: 100, completedAtMs: 200, itemCount: 5, finalizedAtMs: 300
        }),
        makeRequest("req_protected", SESSION_ID, {
          startedAtMs: 1_000, completedAtMs: 1_100, itemCount: 8, finalizedAtMs: null
        }),
        makeRequest(CURRENT_REQ, SESSION_ID, { startedAtMs: 2_000, completedAtMs: 2_100, itemCount: 3 }),
      ]);

      const result = await applyRetentionPolicy(
        stores, SESSION_ID, CURRENT_REQ, { maxItems: 10, terminalGraceMs: 60_000 }, 1_000_000
      );

      expect(result.deletedRequestIds).toEqual(["req_old"]);
      expect(await stores.request.get("req_protected")).toBeDefined();
    });

    it("is evicted once the grace window has passed since its run finished", async () => {
      const stores = await setupStores([
        makeRequest("req_finalized", SESSION_ID, {
          startedAtMs: 100, completedAtMs: 1_000, itemCount: 5, finalizedAtMs: 5_000
        }),
        makeRequest(CURRENT_REQ, SESSION_ID, { startedAtMs: 6_000, completedAtMs: 6_100, itemCount: 5 }),
      ]);

      const inside = await applyRetentionPolicy(
        stores, SESSION_ID, CURRENT_REQ, { maxItems: 5, terminalGraceMs: 60_000 }, 5_000 + 59_999
      );
      expect(inside.deletedRequestIds).toEqual([]);

      const after = await applyRetentionPolicy(
        stores, SESSION_ID, CURRENT_REQ, { maxItems: 5, terminalGraceMs: 60_000 }, 5_000 + 60_000
      );
      expect(after.deletedRequestIds).toEqual(["req_finalized"]);
    });
  });

  // History shows an interrupted turn, so retention bounds it the same way: a
  // turn past the window stops reaching prompts. One still parked on a pending
  // gate is a run a resume will drive again, and is never deleted.
  describe("interrupted requests", () => {
    // The stale sweep writes `interrupted` over a run that died: no
    // `completedAtMs`, `finalizedAtMs` still null, and `interruptedAt` set.
    const interrupted = (
      id: string,
      startedAtMs: number,
      interruptedAt: number | undefined,
      opts: { itemCount?: number; gate?: string } = {}
    ): RequestRecord => {
      const base = makeRequest(id, SESSION_ID, {
        startedAtMs, completedAtMs: startedAtMs, itemCount: opts.itemCount ?? 2, status: "interrupted", finalizedAtMs: null
      });
      return {
        ...base,
        completedAtMs: undefined,
        ...(interruptedAt !== undefined ? { interruptedAt } : {}),
        // A parked run's log names the gate it is parked on.
        items: [...(base.items ?? []), ...(opts.gate !== undefined ? [{ type: "suspension", suspensionId: opts.gate } as never] : [])]
      };
    };
    const gate = (requestId: string, suspensionId: string, status: "pending" | "approved") => ({
      suspensionId,
      requestId,
      flowKind: "test-flow",
      actionName: "run",
      sessionId: SESSION_ID,
      userId: "user1",
      reason: "human_approval" as const,
      message: "Approve?",
      status,
      blockInstanceId: "inst",
      stepIndex: 0,
      createdAt: 350,
      ...(status === "pending" ? {} : { resolvedAt: 360, resolvedBy: "user1" })
    });
    const policy = resolveRetentionPolicy({ maxAge: 1_000 })!;

    it("evicts one past maxAge, and keeps one that still holds a pending gate", async () => {
      const stores = await setupStores([
        interrupted("req_dead", 100, 200),
        interrupted("req_parked", 300, 400, { gate: "susp_1" }),
        makeRequest(CURRENT_REQ, SESSION_ID, { startedAtMs: 9_000_000, completedAtMs: 9_000_100, itemCount: 2 }),
      ]);
      await stores.suspensions.set(gate("req_parked", "susp_1", "pending"));

      const result = await applyRetentionPolicy(
        stores, SESSION_ID, CURRENT_REQ, policy, 9_000_200, undefined, createCheckpointDurabilityProvider(stores)
      );

      expect(result.deletedRequestIds).toEqual(["req_dead"]);
      expect(await stores.request.get("req_dead")).toBeUndefined();
      expect(await stores.request.get("req_parked")).toBeDefined();
    });

    // A person resolved the gate, and the sweep's re-drive has not yet run
    // the turn on: the record is what that re-drive continues.
    it("keeps one whose gate is resolved and still owes a re-drive", async () => {
      const stores = await setupStores([
        interrupted("req_owed", 300, 400, { gate: "susp_1" }),
        makeRequest(CURRENT_REQ, SESSION_ID, { startedAtMs: 9_000_000, completedAtMs: 9_000_100, itemCount: 2 }),
      ]);
      await stores.suspensions.set(gate("req_owed", "susp_1", "approved"));

      const result = await applyRetentionPolicy(
        stores, SESSION_ID, CURRENT_REQ, policy, 9_000_200, undefined, createCheckpointDurabilityProvider(stores)
      );

      expect(result.deletedRequestIds).toEqual([]);
      expect(await stores.request.get("req_owed")).toBeDefined();
    });

    // The sweep wrote it and no run is left to stamp `finalizedAtMs`: it is
    // held for the rollout-safety bound after `interruptedAt`, even past maxAge.
    it("holds one the sweep wrote for the rollout-safety bound after it was found interrupted", async () => {
      const stores = await setupStores([
        interrupted("req_swept", 100, 1_000),
        makeRequest(CURRENT_REQ, SESSION_ID, { startedAtMs: 500_000, completedAtMs: 500_100, itemCount: 2 }),
      ]);

      const inside = await applyRetentionPolicy(stores, SESSION_ID, CURRENT_REQ, policy, 1_000 + policy.legacyGraceMs! - 1);
      expect(inside.deletedRequestIds).toEqual([]);

      const atBound = await applyRetentionPolicy(stores, SESSION_ID, CURRENT_REQ, policy, 1_000 + policy.legacyGraceMs!);
      expect(atBound.deletedRequestIds).toEqual(["req_swept"]);
    });

    // The parked turn is the oldest, so were it evictable it would go first;
    // kept, its items (7 and its gate) and the current request's fill the
    // budget, and the newer completed turn is evicted in its place.
    it("counts a parked one toward maxItems, so other history is evicted in its place", async () => {
      const stores = await setupStores([
        interrupted("req_parked", 100, 150, { itemCount: 7, gate: "susp_1" }),
        makeRequest("req_old", SESSION_ID, { startedAtMs: 1_000, completedAtMs: 1_100, itemCount: 5, finalizedAtMs: 1_200 }),
        makeRequest(CURRENT_REQ, SESSION_ID, { startedAtMs: 2_000, completedAtMs: 2_100, itemCount: 2 }),
      ]);
      await stores.suspensions.set(gate("req_parked", "susp_1", "pending"));

      const result = await applyRetentionPolicy(
        stores, SESSION_ID, CURRENT_REQ, { maxItems: 10, terminalGraceMs: 60_000 }, 1_000_000, undefined,
        createCheckpointDurabilityProvider(stores)
      );

      expect(result.deletedRequestIds).toEqual(["req_old"]);
      expect(await stores.request.get("req_parked")).toBeDefined();
    });

    // The gate is stored but its log append never landed: a crash between
    // `provider.suspend` and the append, or a re-suspension. Still parked.
    it("keeps one whose pending gate is stored but not yet on its log", async () => {
      const stores = await setupStores([
        interrupted("req_dead", 100, 200),
        interrupted("req_parked", 300, 400),
        makeRequest(CURRENT_REQ, SESSION_ID, { startedAtMs: 9_000_000, completedAtMs: 9_000_100, itemCount: 2 }),
      ]);
      await stores.suspensions.set(gate("req_parked", "susp_1", "pending"));

      const result = await applyRetentionPolicy(
        stores, SESSION_ID, CURRENT_REQ, policy, 9_000_200, undefined, createCheckpointDurabilityProvider(stores)
      );

      expect(result.deletedRequestIds).toEqual(["req_dead"]);
      expect(await stores.request.get("req_parked")).toBeDefined();
    });

    // Not knowing whether a record is parked must never read as "not parked":
    // the pass rejects and deletes nothing.
    it("deletes nothing when a gate cannot be read", async () => {
      const stores = await setupStores([
        interrupted("req_parked", 300, 400, { gate: "susp_1" }),
        makeRequest(CURRENT_REQ, SESSION_ID, { startedAtMs: 9_000_000, completedAtMs: 9_000_100, itemCount: 2 }),
      ]);
      const broken = {
        ...createCheckpointDurabilityProvider(stores),
        loadSuspension: async () => {
          throw new Error("the gate store is down");
        }
      };

      await expect(
        applyRetentionPolicy(stores, SESSION_ID, CURRENT_REQ, policy, 9_000_200, undefined, broken)
      ).rejects.toThrow("the gate store is down");
      expect(await stores.request.get("req_parked")).toBeDefined();
    });

    // The durability sweep can re-drive an interrupted turn after this pass
    // judged it evictable and before it deletes it. The record is then a
    // running request again, and deleting it would pull a live run's record
    // out from under it: the delete holds only while the status it was judged
    // in still holds.
    it("keeps one a re-drive started running between the read and the delete", async () => {
      const stores = await setupStores([
        interrupted("req_redriven", 100, 200),
        makeRequest(CURRENT_REQ, SESSION_ID, { startedAtMs: 9_000_000, completedAtMs: 9_000_100, itemCount: 2 }),
      ]);
      const get = stores.request.get.bind(stores.request);
      stores.request.get = async (id) => {
        const record = await get(id);
        if (id === "req_redriven") {
          // The re-drive lands right after retention's read.
          await stores.request.setFieldsIfStatus(
            id,
            { status: "in_progress", result: undefined },
            ["interrupted"],
            9_000_150
          );
        }
        return record;
      };

      const result = await applyRetentionPolicy(
        stores, SESSION_ID, CURRENT_REQ, policy, 9_000_200, undefined, createCheckpointDurabilityProvider(stores)
      );

      expect(result.deletedRequestIds).toEqual([]);
      expect((await stores.request.get("req_redriven"))?.status).toBe("in_progress");
    });

    // A record without `interruptedAt` (BP-030) ages from when it started.
    it("ages one with no interruptedAt from its start", async () => {
      const stores = await setupStores([
        interrupted("req_legacy", 100, undefined),
        makeRequest(CURRENT_REQ, SESSION_ID, { startedAtMs: 500_000, completedAtMs: 500_100, itemCount: 2 }),
      ]);

      const inside = await applyRetentionPolicy(stores, SESSION_ID, CURRENT_REQ, policy, 100 + policy.legacyGraceMs! - 1);
      expect(inside.deletedRequestIds).toEqual([]);

      const atBound = await applyRetentionPolicy(stores, SESSION_ID, CURRENT_REQ, policy, 100 + policy.legacyGraceMs!);
      expect(atBound.deletedRequestIds).toEqual(["req_legacy"]);
    });
  });
});
