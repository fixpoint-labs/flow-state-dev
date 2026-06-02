/**
 * FIX-140: CheckpointDurabilityProvider delegation tests.
 *
 * Verifies that the provider is a thin pass-through to the underlying
 * CheckpointStore, SuspensionStore, and LeaseStore — no business logic
 * of its own beyond wiring.
 */
import { describe, it, expect, vi } from "vitest";
import type { SequencerCheckpoint, SuspensionRecord } from "@flow-state-dev/core/types";
import type { CheckpointStore, SuspensionStore, LeaseStore } from "../src/stores/types";
import type { Lease } from "../src/durability/types";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function mockCheckpointStore(): CheckpointStore {
  return {
    write: vi.fn<CheckpointStore["write"]>().mockResolvedValue(undefined),
    latest: vi.fn<CheckpointStore["latest"]>().mockResolvedValue(null),
    delete: vi.fn<CheckpointStore["delete"]>().mockResolvedValue(undefined),
  };
}

function mockSuspensionStore(): SuspensionStore {
  return {
    set: vi.fn<SuspensionStore["set"]>().mockResolvedValue(undefined),
    get: vi.fn<SuspensionStore["get"]>().mockResolvedValue(null),
    list: vi.fn<SuspensionStore["list"]>().mockResolvedValue([]),
    deleteForRequest: vi.fn<SuspensionStore["deleteForRequest"]>().mockResolvedValue(undefined),
  };
}

function mockLeaseStore(): LeaseStore {
  return {
    acquire: vi.fn<LeaseStore["acquire"]>().mockResolvedValue(null),
    release: vi.fn<LeaseStore["release"]>().mockResolvedValue(undefined),
    get: vi.fn<LeaseStore["get"]>().mockResolvedValue(null),
    pruneExpired: vi.fn<LeaseStore["pruneExpired"]>().mockResolvedValue(undefined),
  };
}

function makeCheckpoint(overrides?: Partial<SequencerCheckpoint>): SequencerCheckpoint {
  return {
    requestId: "req_1",
    blockInstanceId: "block_1",
    parentBlockInstanceId: null,
    stepIndex: 0,
    state: { count: 1 },
    version: 1,
    createdAt: Date.now(),
    ...overrides,
  };
}

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
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CheckpointDurabilityProvider", () => {
  function setup() {
    const checkpoints = mockCheckpointStore();
    const suspensions = mockSuspensionStore();
    const leases = mockLeaseStore();
    const provider = createCheckpointDurabilityProvider({
      checkpoints,
      suspensions,
      leases,
    });
    return { provider, checkpoints, suspensions, leases };
  }

  // -- Checkpoint delegation ------------------------------------------------

  describe("checkpoint delegation", () => {
    it("saveCheckpoint delegates to CheckpointStore.write", async () => {
      const { provider, checkpoints } = setup();
      const cp = makeCheckpoint();

      await provider.saveCheckpoint(cp);

      expect(checkpoints.write).toHaveBeenCalledWith(cp);
      expect(checkpoints.write).toHaveBeenCalledTimes(1);
    });

    it("loadCheckpoint delegates to CheckpointStore.latest", async () => {
      const { provider, checkpoints } = setup();
      const cp = makeCheckpoint();
      vi.mocked(checkpoints.latest).mockResolvedValue(cp);

      const result = await provider.loadCheckpoint("req_1", "block_1");

      expect(checkpoints.latest).toHaveBeenCalledWith("req_1", "block_1");
      expect(result).toEqual(cp);
    });

    it("loadCheckpoint returns null when no checkpoint exists", async () => {
      const { provider } = setup();

      const result = await provider.loadCheckpoint("req_x", "block_x");

      expect(result).toBeNull();
    });
  });

  // -- Suspension delegation ------------------------------------------------

  describe("suspension delegation", () => {
    it("suspend delegates to SuspensionStore.set", async () => {
      const { provider, suspensions } = setup();
      const record = makeRecord();

      await provider.suspend(record);

      expect(suspensions.set).toHaveBeenCalledWith(record);
      expect(suspensions.set).toHaveBeenCalledTimes(1);
    });

    it("loadSuspension delegates to SuspensionStore.get", async () => {
      const { provider, suspensions } = setup();
      const record = makeRecord();
      vi.mocked(suspensions.get).mockResolvedValue(record);

      const result = await provider.loadSuspension("req_1", "sus_1");

      expect(suspensions.get).toHaveBeenCalledWith("req_1", "sus_1");
      expect(result).toEqual(record);
    });

    it("loadSuspension returns null when not found", async () => {
      const { provider } = setup();

      const result = await provider.loadSuspension("req_x", "sus_x");

      expect(result).toBeNull();
    });

    it("listSuspended delegates to SuspensionStore.list", async () => {
      const { provider, suspensions } = setup();
      const records = [makeRecord({ suspensionId: "s1" }), makeRecord({ suspensionId: "s2" })];
      vi.mocked(suspensions.list).mockResolvedValue(records);

      const filter = { flowKind: "chat", status: "pending" as const };
      const result = await provider.listSuspended(filter);

      expect(suspensions.list).toHaveBeenCalledWith(filter);
      expect(result).toEqual(records);
    });

    it("listSuspended passes undefined filter through", async () => {
      const { provider, suspensions } = setup();
      vi.mocked(suspensions.list).mockResolvedValue([]);

      await provider.listSuspended();

      expect(suspensions.list).toHaveBeenCalledWith(undefined);
    });
  });

  // -- Lease delegation -----------------------------------------------------

  describe("lease delegation", () => {
    it("acquireLease delegates to LeaseStore.acquire", async () => {
      const { provider, leases } = setup();
      const lease: Lease = {
        requestId: "req_1",
        leaseId: "lease_1",
        holder: "w1",
        acquiredAt: Date.now(),
        expiresAt: Date.now() + 10_000,
      };
      vi.mocked(leases.acquire).mockResolvedValue(lease);

      const opts = { holder: "w1", durationMs: 10_000 };
      const result = await provider.acquireLease("req_1", opts);

      expect(leases.acquire).toHaveBeenCalledWith("req_1", opts);
      expect(result).toEqual(lease);
    });

    it("acquireLease returns null on contention", async () => {
      const { provider } = setup();

      const result = await provider.acquireLease("req_1", { holder: "w2", durationMs: 5_000 });

      expect(result).toBeNull();
    });

    it("releaseLease delegates to LeaseStore.release", async () => {
      const { provider, leases } = setup();

      await provider.releaseLease("req_1", "lease_42");

      expect(leases.release).toHaveBeenCalledWith("req_1", "lease_42");
      expect(leases.release).toHaveBeenCalledTimes(1);
    });
  });

  // -- Cleanup --------------------------------------------------------------

  describe("cleanup", () => {
    it("calls deleteForRequest on SuspensionStore", async () => {
      const { provider, suspensions } = setup();

      await provider.cleanup("req_1");

      expect(suspensions.deleteForRequest).toHaveBeenCalledWith("req_1");
      expect(suspensions.deleteForRequest).toHaveBeenCalledTimes(1);
    });

    it("does not touch CheckpointStore", async () => {
      const { provider, checkpoints } = setup();

      await provider.cleanup("req_1");

      expect(checkpoints.write).not.toHaveBeenCalled();
      expect(checkpoints.latest).not.toHaveBeenCalled();
      expect(checkpoints.delete).not.toHaveBeenCalled();
    });

    it("releases an active lease during cleanup", async () => {
      const { provider, leases } = setup();
      const lease: Lease = {
        requestId: "req_1",
        leaseId: "lease_99",
        holder: "w1",
        acquiredAt: Date.now(),
        expiresAt: Date.now() + 30_000,
      };
      vi.mocked(leases.get).mockResolvedValue(lease);

      await provider.cleanup("req_1");

      expect(leases.get).toHaveBeenCalledWith("req_1");
      expect(leases.release).toHaveBeenCalledWith("req_1", "lease_99");
    });

    it("skips lease release when no active lease exists", async () => {
      const { provider, leases } = setup();

      await provider.cleanup("req_1");

      expect(leases.get).toHaveBeenCalledWith("req_1");
      expect(leases.release).not.toHaveBeenCalled();
    });
  });
});
