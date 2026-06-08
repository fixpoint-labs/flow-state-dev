/**
 * Unit tests for the durability retention sweeper (FIX-141 PR 2).
 *
 * Drives a single deterministic sweep via the exported `runTick` against
 * real in-memory stores + the real checkpoint durability provider — no mocks
 * for the store layer, so the tests exercise the actual prune/expiry paths.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryStores } from "../src/stores";
import type { RequestRecord, StoreRegistry } from "../src/stores/types";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import type { DurabilityProvider } from "../src/durability/types";
import {
  createDurabilitySweeper,
  runTick
} from "../src/durability/durability-sweeper";
import type { SuspensionRecord } from "@flow-state-dev/core/types";

const DAY = 86_400_000;
const WEEK = 604_800_000;

function makeSuspension(
  id: string,
  overrides?: Partial<SuspensionRecord>
): SuspensionRecord {
  return {
    suspensionId: id,
    requestId: `req_${id}`,
    flowKind: "chat",
    actionName: "run",
    userId: "user_1",
    reason: "human_approval",
    message: "approve?",
    status: "pending",
    blockInstanceId: "seq_1",
    stepIndex: 0,
    createdAt: Date.now(),
    ...overrides
  };
}

function makeRequest(
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
    status: "completed",
    startedAtMs: ts,
    state: {},
    version: 0,
    createdAt: ts,
    updatedAt: ts,
    ...overrides
  };
}

async function writeCheckpoint(
  stores: StoreRegistry,
  requestId: string
): Promise<void> {
  await stores.checkpoints.write({
    requestId,
    blockInstanceId: "seq_1",
    parentBlockInstanceId: null,
    stepIndex: 0,
    state: {},
    version: 1,
    createdAt: Date.now()
  });
}

function baseRetention() {
  return {
    sweepIntervalMs: 600_000,
    checkpointMaxAgeMs: DAY,
    suspensionTerminalMaxAgeMs: WEEK,
    orphanCheckpointThresholdMs: DAY,
    batchLimit: 1000
  };
}

function tickArgs(
  provider: DurabilityProvider,
  stores: StoreRegistry,
  overrides?: Partial<ReturnType<typeof baseRetention>> & { holder?: string }
) {
  const r = { ...baseRetention(), ...overrides };
  return {
    provider,
    stores,
    logger: undefined as never, // falls through to DEFAULT_RUNTIME_LOGGER via factory only; runTick needs a logger
    holder: overrides?.holder ?? "test-holder",
    sweepIntervalMs: r.sweepIntervalMs,
    checkpointMaxAgeMs: r.checkpointMaxAgeMs,
    suspensionTerminalMaxAgeMs: r.suspensionTerminalMaxAgeMs,
    orphanCheckpointThresholdMs: r.orphanCheckpointThresholdMs,
    batchLimit: r.batchLimit
  };
}

describe("durability sweeper", () => {
  let stores: StoreRegistry;
  let provider: DurabilityProvider;

  beforeEach(() => {
    stores = createInMemoryStores();
    provider = createCheckpointDurabilityProvider(stores);
  });

  describe("suspension expiry enforcement", () => {
    it("expires a pending suspension past expiresAt", async () => {
      const now = Date.now();
      await provider.suspend(
        makeSuspension("s_expired", { expiresAt: now - 1000 })
      );

      await runTick(tickArgs(provider, stores));

      const after = await provider.loadSuspension("req_s_expired", "s_expired");
      expect(after?.status).toBe("expired");
      expect(after?.resolvedAt).toBeGreaterThan(0);
    });

    it("leaves a pending suspension without expiresAt untouched", async () => {
      await provider.suspend(makeSuspension("s_noexp"));

      await runTick(tickArgs(provider, stores));

      const after = await provider.loadSuspension("req_s_noexp", "s_noexp");
      expect(after?.status).toBe("pending");
    });

    it("leaves a not-yet-expired pending suspension untouched", async () => {
      const now = Date.now();
      await provider.suspend(
        makeSuspension("s_future", { expiresAt: now + 1_000_000 })
      );

      await runTick(tickArgs(provider, stores));

      const after = await provider.loadSuspension("req_s_future", "s_future");
      expect(after?.status).toBe("pending");
    });
  });

  describe("terminal suspension pruning", () => {
    it("prunes resolved suspensions older than the retention window", async () => {
      const now = Date.now();
      await provider.suspend(
        makeSuspension("s_old", {
          status: "approved",
          resolvedAt: now - WEEK - 1000
        })
      );

      await runTick(tickArgs(provider, stores));

      const after = await provider.loadSuspension("req_s_old", "s_old");
      expect(after).toBeNull();
    });

    it("keeps resolved suspensions newer than the retention window", async () => {
      const now = Date.now();
      await provider.suspend(
        makeSuspension("s_recent", {
          status: "approved",
          resolvedAt: now - 1000
        })
      );

      await runTick(tickArgs(provider, stores));

      const after = await provider.loadSuspension("req_s_recent", "s_recent");
      expect(after?.status).toBe("approved");
    });
  });

  describe("lease pruning", () => {
    it("invokes leases.pruneExpired each tick (expired lease is gone)", async () => {
      // Acquire a lease that expires immediately for a non-sentinel request.
      await stores.leases.acquire("req_lease", {
        holder: "worker_1",
        durationMs: -1
      });

      await runTick(tickArgs(provider, stores));

      const lease = await stores.leases.get("req_lease");
      expect(lease).toBeNull();
    });
  });

  describe("orphan checkpoint pruning", () => {
    it("prunes checkpoints of a completed request older than checkpointMaxAge", async () => {
      const now = Date.now();
      await stores.request.set(
        "req_done",
        makeRequest("req_done", {
          status: "completed",
          completedAtMs: now - DAY - 1000
        }),
        "any"
      );
      await writeCheckpoint(stores, "req_done");

      await runTick(tickArgs(provider, stores));

      expect(await stores.checkpoints.latest("req_done", "seq_1")).toBeNull();
    });

    it("prunes ALL eligible requests across multiple pages (batchLimit < count)", async () => {
      // Regression: the orphan sweep must page through every record, not just
      // the first page. `request.list` returns newest-first while eligible
      // (aged-out) records sort last, so a single-page scan would leave most
      // orphaned checkpoints behind once the table exceeds one page.
      const now = Date.now();
      const ids = ["a", "b", "c", "d", "e"].map((s) => `req_pg_${s}`);
      for (const id of ids) {
        await stores.request.set(
          id,
          makeRequest(id, {
            status: "completed",
            completedAtMs: now - DAY - 1000
          }),
          "any"
        );
        await writeCheckpoint(stores, id);
      }

      // batchLimit 2 forces three pages over five records.
      await runTick(tickArgs(provider, stores, { batchLimit: 2 }));

      for (const id of ids) {
        expect(await stores.checkpoints.latest(id, "seq_1")).toBeNull();
      }
    });

    it("does NOT prune checkpoints of a suspended request", async () => {
      const now = Date.now();
      await stores.request.set(
        "req_susp",
        makeRequest("req_susp", {
          status: "suspended",
          startedAtMs: now - DAY * 10
        }),
        "any"
      );
      await writeCheckpoint(stores, "req_susp");

      await runTick(tickArgs(provider, stores));

      expect(await stores.checkpoints.latest("req_susp", "seq_1")).not.toBeNull();
    });

    it("does NOT prune checkpoints of an in_progress request", async () => {
      const now = Date.now();
      await stores.request.set(
        "req_live",
        makeRequest("req_live", {
          status: "in_progress",
          startedAtMs: now - DAY * 10
        }),
        "any"
      );
      await writeCheckpoint(stores, "req_live");

      await runTick(tickArgs(provider, stores));

      expect(await stores.checkpoints.latest("req_live", "seq_1")).not.toBeNull();
    });

    it("prunes checkpoints of an interrupted request past the orphan threshold", async () => {
      const now = Date.now();
      await stores.request.set(
        "req_int",
        makeRequest("req_int", {
          status: "interrupted",
          interruptedAt: now - DAY - 1000
        }),
        "any"
      );
      await writeCheckpoint(stores, "req_int");

      await runTick(tickArgs(provider, stores));

      expect(await stores.checkpoints.latest("req_int", "seq_1")).toBeNull();
    });

    it("keeps checkpoints of a recently interrupted request", async () => {
      const now = Date.now();
      await stores.request.set(
        "req_int_recent",
        makeRequest("req_int_recent", {
          status: "interrupted",
          interruptedAt: now - 1000
        }),
        "any"
      );
      await writeCheckpoint(stores, "req_int_recent");

      await runTick(tickArgs(provider, stores));

      expect(
        await stores.checkpoints.latest("req_int_recent", "seq_1")
      ).not.toBeNull();
    });
  });

  describe("sweeper lease contention", () => {
    it("is a no-op when another holder holds the sweeper lease", async () => {
      const now = Date.now();
      // Pre-hold the sentinel lease under a different holder.
      const held = await stores.leases.acquire("__durability_sweeper__", {
        holder: "other-host",
        durationMs: 600_000
      });
      expect(held).not.toBeNull();

      // Set up something the sweeper WOULD prune if it ran.
      await provider.suspend(
        makeSuspension("s_old", {
          status: "approved",
          resolvedAt: now - WEEK - 1000
        })
      );

      await runTick(tickArgs(provider, stores, { holder: "this-host" }));

      // Untouched — the tick bailed because the lease was held.
      const after = await provider.loadSuspension("req_s_old", "s_old");
      expect(after?.status).toBe("approved");
    });
  });

  describe("disabled sweeper", () => {
    it("returns a no-op handle when sweepIntervalMs <= 0", () => {
      const sweeper = createDurabilitySweeper({
        provider,
        stores,
        retention: { sweepIntervalMs: 0 }
      });
      expect(typeof sweeper.dispose).toBe("function");
      sweeper.dispose();
      sweeper.dispose();
    });

    it("dispose is idempotent for an active sweeper", async () => {
      vi.useFakeTimers();
      const sweeper = createDurabilitySweeper({
        provider,
        stores,
        retention: { sweepIntervalMs: 1000 }
      });
      sweeper.dispose();
      sweeper.dispose();
      vi.useRealTimers();
    });
  });

  describe("integration: complete then sweep", () => {
    it("removes terminal artifacts while a suspended request's checkpoints survive", async () => {
      const now = Date.now();

      // A completed request whose checkpoints aged out.
      await stores.request.set(
        "req_done",
        makeRequest("req_done", {
          status: "completed",
          completedAtMs: now - DAY - 1000
        }),
        "any"
      );
      await writeCheckpoint(stores, "req_done");

      // A suspended request mid-flight.
      await stores.request.set(
        "req_susp",
        makeRequest("req_susp", { status: "suspended" }),
        "any"
      );
      await writeCheckpoint(stores, "req_susp");

      // An old resolved suspension.
      await provider.suspend(
        makeSuspension("s_old", {
          status: "rejected",
          resolvedAt: now - WEEK - 1000
        })
      );

      await runTick(tickArgs(provider, stores));

      expect(await stores.checkpoints.latest("req_done", "seq_1")).toBeNull();
      expect(
        await stores.checkpoints.latest("req_susp", "seq_1")
      ).not.toBeNull();
      expect(await provider.loadSuspension("req_s_old", "s_old")).toBeNull();
    });
  });
});
