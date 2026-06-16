/**
 * FIX-140: In-memory SuspensionStore and LeaseStore tests.
 *
 * Validates CRUD, filtering, expiry semantics, and concurrent-acquire
 * behavior for the durable execution store interfaces.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SuspensionRecord } from "@flow-state-dev/core/types";
import { createInMemorySuspensionStore } from "../src/stores/memory/suspension-store";
import { createInMemoryLeaseStore } from "../src/stores/memory/lease-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides?: Partial<SuspensionRecord>): SuspensionRecord {
  return {
    suspensionId: "sus_1",
    requestId: "req_1",
    flowKind: "chat",
    actionName: "ask",
    userId: "user_1",
    reason: "human_approval",
    message: "Approve?",
    status: "pending",
    blockInstanceId: "block_1",
    stepIndex: 0,
    createdAt: Date.now(),
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// SuspensionStore
// ---------------------------------------------------------------------------

describe("InMemorySuspensionStore", () => {
  it("set then get round-trips a suspension record", async () => {
    const store = createInMemorySuspensionStore();
    const record = makeRecord();

    await store.set(record);
    const result = await store.get("req_1", "sus_1");

    expect(result).toEqual(record);
  });

  it("get returns null for non-existent record", async () => {
    const store = createInMemorySuspensionStore();

    expect(await store.get("req_x", "sus_x")).toBeNull();
  });

  it("set overwrites an existing record", async () => {
    const store = createInMemorySuspensionStore();
    const original = makeRecord({ status: "pending" });
    await store.set(original);

    const updated = { ...original, status: "approved" as const, resolvedAt: Date.now() };
    await store.set(updated);

    const result = await store.get("req_1", "sus_1");
    expect(result?.status).toBe("approved");
  });

  describe("list with filter", () => {
    async function seedStore() {
      const store = createInMemorySuspensionStore();
      await store.set(makeRecord({ suspensionId: "s1", requestId: "r1", flowKind: "chat", userId: "u1", status: "pending" }));
      await store.set(makeRecord({ suspensionId: "s2", requestId: "r2", flowKind: "chat", userId: "u2", status: "approved" }));
      await store.set(makeRecord({ suspensionId: "s3", requestId: "r3", flowKind: "agent", userId: "u1", status: "pending", sessionId: "sess_1" }));
      return store;
    }

    it("returns all records when no filter", async () => {
      const store = await seedStore();
      const results = await store.list();
      expect(results).toHaveLength(3);
    });

    it("filters by flowKind", async () => {
      const store = await seedStore();
      const results = await store.list({ flowKind: "agent" });
      expect(results).toHaveLength(1);
      expect(results[0]!.suspensionId).toBe("s3");
    });

    it("filters by userId", async () => {
      const store = await seedStore();
      const results = await store.list({ userId: "u1" });
      expect(results).toHaveLength(2);
    });

    it("filters by status", async () => {
      const store = await seedStore();
      const results = await store.list({ status: "pending" });
      expect(results).toHaveLength(2);
    });

    it("filters by sessionId", async () => {
      const store = await seedStore();
      const results = await store.list({ sessionId: "sess_1" });
      expect(results).toHaveLength(1);
      expect(results[0]!.suspensionId).toBe("s3");
    });

    it("combines filters", async () => {
      const store = await seedStore();
      const results = await store.list({ userId: "u1", status: "pending" });
      expect(results).toHaveLength(2);
    });

    it("respects limit", async () => {
      const store = await seedStore();
      const results = await store.list({ limit: 1 });
      expect(results).toHaveLength(1);
    });

    it("returns empty when no matches", async () => {
      const store = await seedStore();
      const results = await store.list({ flowKind: "nonexistent" });
      expect(results).toHaveLength(0);
    });
  });

  it("deleteForRequest removes all records for a requestId", async () => {
    const store = createInMemorySuspensionStore();
    await store.set(makeRecord({ suspensionId: "s1", requestId: "r1" }));
    await store.set(makeRecord({ suspensionId: "s2", requestId: "r1" }));
    await store.set(makeRecord({ suspensionId: "s3", requestId: "r2" }));

    await store.deleteForRequest("r1");

    expect(await store.get("r1", "s1")).toBeNull();
    expect(await store.get("r1", "s2")).toBeNull();
    expect(await store.get("r2", "s3")).not.toBeNull();
  });

  it("deleteForRequest is a no-op for unknown requestId", async () => {
    const store = createInMemorySuspensionStore();
    await store.set(makeRecord());

    await store.deleteForRequest("unknown");

    expect(await store.list()).toHaveLength(1);
  });

  describe("retention filters (FIX-141)", () => {
    it("list({ createdBefore }) returns only records created before the cutoff", async () => {
      const store = createInMemorySuspensionStore();
      await store.set(makeRecord({ suspensionId: "old", requestId: "r1", createdAt: 100 }));
      await store.set(makeRecord({ suspensionId: "new", requestId: "r2", createdAt: 300 }));

      const results = await store.list({ createdBefore: 200 });
      expect(results.map((r) => r.suspensionId)).toEqual(["old"]);
    });

    it("list({ resolvedBefore }) matches only records with resolvedAt < cutoff, never unresolved", async () => {
      const store = createInMemorySuspensionStore();
      await store.set(makeRecord({ suspensionId: "pending", requestId: "r1", status: "pending" }));
      await store.set(
        makeRecord({ suspensionId: "early", requestId: "r2", status: "approved", resolvedAt: 100 })
      );
      await store.set(
        makeRecord({ suspensionId: "late", requestId: "r3", status: "approved", resolvedAt: 300 })
      );

      const results = await store.list({ resolvedBefore: 200 });
      expect(results.map((r) => r.suspensionId)).toEqual(["early"]);
    });

    it("list combines resolvedBefore with status", async () => {
      const store = createInMemorySuspensionStore();
      await store.set(
        makeRecord({ suspensionId: "rejected", requestId: "r1", status: "rejected", resolvedAt: 100 })
      );
      await store.set(
        makeRecord({ suspensionId: "approved", requestId: "r2", status: "approved", resolvedAt: 100 })
      );

      const results = await store.list({ resolvedBefore: 200, status: "rejected" });
      expect(results.map((r) => r.suspensionId)).toEqual(["rejected"]);
    });
  });

  describe("pruneTerminalBefore (FIX-141)", () => {
    async function seed() {
      const store = createInMemorySuspensionStore();
      // terminal, resolved before cutoff — eligible
      await store.set(
        makeRecord({ suspensionId: "t1", requestId: "r1", status: "approved", resolvedAt: 100 })
      );
      await store.set(
        makeRecord({ suspensionId: "t2", requestId: "r2", status: "rejected", resolvedAt: 150 })
      );
      // terminal but resolved AFTER cutoff — not eligible
      await store.set(
        makeRecord({ suspensionId: "t3", requestId: "r3", status: "expired", resolvedAt: 500 })
      );
      // pending — never eligible even with an (impossible) early resolvedAt
      await store.set(
        makeRecord({ suspensionId: "p1", requestId: "r4", status: "pending", resolvedAt: 50 })
      );
      return store;
    }

    it("deletes only terminal records resolved before the cutoff and returns the count", async () => {
      const store = await seed();

      const deleted = await store.pruneTerminalBefore(200, 100);

      expect(deleted).toBe(2);
      expect(await store.get("r1", "t1")).toBeNull();
      expect(await store.get("r2", "t2")).toBeNull();
      // resolved after cutoff survives
      expect(await store.get("r3", "t3")).not.toBeNull();
      // pending survives
      expect(await store.get("r4", "p1")).not.toBeNull();
    });

    it("respects limit and returns the number actually deleted", async () => {
      const store = await seed();

      const deleted = await store.pruneTerminalBefore(200, 1);

      expect(deleted).toBe(1);
      // one of the two eligible records remains
      const remaining = await store.list({ status: "approved" });
      const stillRejected = await store.list({ status: "rejected" });
      expect(remaining.length + stillRejected.length).toBe(1);
    });

    it("returns 0 when nothing matches", async () => {
      const store = createInMemorySuspensionStore();
      await store.set(makeRecord({ status: "pending" }));

      expect(await store.pruneTerminalBefore(Date.now() + 1000, 100)).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// LeaseStore
// ---------------------------------------------------------------------------

describe("InMemoryLeaseStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("acquire returns a lease on first call", async () => {
    const store = createInMemoryLeaseStore();
    const lease = await store.acquire("req_1", { holder: "w1", durationMs: 10_000 });

    expect(lease).not.toBeNull();
    expect(lease!.requestId).toBe("req_1");
    expect(lease!.holder).toBe("w1");
    expect(lease!.leaseId).toBeTruthy();
    expect(lease!.expiresAt).toBeGreaterThan(lease!.acquiredAt);
  });

  it("acquire returns null when a different holder has an active lease", async () => {
    const store = createInMemoryLeaseStore();
    await store.acquire("req_1", { holder: "w1", durationMs: 10_000 });

    const second = await store.acquire("req_1", { holder: "w2", durationMs: 10_000 });

    expect(second).toBeNull();
  });

  it("same holder can re-acquire their own lease", async () => {
    const store = createInMemoryLeaseStore();
    const first = await store.acquire("req_1", { holder: "w1", durationMs: 10_000 });
    const second = await store.acquire("req_1", { holder: "w1", durationMs: 10_000 });

    expect(second).not.toBeNull();
    expect(second!.leaseId).not.toBe(first!.leaseId);
  });

  it("acquire succeeds after prior lease expires", async () => {
    const store = createInMemoryLeaseStore();
    await store.acquire("req_1", { holder: "w1", durationMs: 5_000 });

    // Advance past expiry
    vi.advanceTimersByTime(6_000);

    const lease = await store.acquire("req_1", { holder: "w2", durationMs: 10_000 });

    expect(lease).not.toBeNull();
    expect(lease!.holder).toBe("w2");
  });

  it("release allows re-acquisition by a different holder", async () => {
    const store = createInMemoryLeaseStore();
    const lease = await store.acquire("req_1", { holder: "w1", durationMs: 10_000 });
    expect(lease).not.toBeNull();

    await store.release("req_1", lease!.leaseId);

    const second = await store.acquire("req_1", { holder: "w2", durationMs: 10_000 });
    expect(second).not.toBeNull();
    expect(second!.holder).toBe("w2");
  });

  it("release is a no-op for mismatched leaseId", async () => {
    const store = createInMemoryLeaseStore();
    await store.acquire("req_1", { holder: "w1", durationMs: 10_000 });

    // Releasing with a wrong leaseId should not clear the lease
    await store.release("req_1", "wrong_id");

    const second = await store.acquire("req_1", { holder: "w2", durationMs: 10_000 });
    expect(second).toBeNull();
  });

  it("get returns null for expired lease", async () => {
    const store = createInMemoryLeaseStore();
    await store.acquire("req_1", { holder: "w1", durationMs: 5_000 });

    vi.advanceTimersByTime(6_000);

    const result = await store.get("req_1");
    expect(result).toBeNull();
  });

  it("get returns the lease when still active", async () => {
    const store = createInMemoryLeaseStore();
    const lease = await store.acquire("req_1", { holder: "w1", durationMs: 10_000 });

    const result = await store.get("req_1");
    expect(result).toEqual(lease);
  });

  it("pruneExpired removes expired leases", async () => {
    const store = createInMemoryLeaseStore();
    await store.acquire("req_1", { holder: "w1", durationMs: 3_000 });
    await store.acquire("req_2", { holder: "w1", durationMs: 30_000 });

    vi.advanceTimersByTime(5_000);

    await store.pruneExpired();

    // req_1 expired and was pruned
    expect(await store.get("req_1")).toBeNull();
    // req_2 still active
    expect(await store.get("req_2")).not.toBeNull();
  });

  it("pruneExpired is safe when store is empty", async () => {
    const store = createInMemoryLeaseStore();
    await store.pruneExpired();
    // No throw
  });
});
