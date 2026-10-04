/**
 * Shared conformance for `LeaseStore` backends. Every adapter (memory,
 * filesystem, SQLite, Postgres) runs it via `@flow-state-dev/engine/testing`.
 *
 * A lease exists so that only one worker resumes a request at a time. The
 * cases pin the two properties that make that true across processes:
 *
 * - acquire is exclusive: concurrent acquirers for the same request, from
 *   different holders, produce exactly one lease;
 * - lease ids are globally unique (UUIDs), so a holder whose lease expired
 *   cannot `release` the lease someone else took over since.
 */
import { describe, expect, it } from "vitest";
import type { LeaseStore } from "../types";

export type CreateLeaseStoreConformanceTestsOptions = {
  /** Display name surfaced in the `describe` block, e.g. `"SQLite"`. */
  name: string;
  /** Build a fresh, empty lease store. Called per test. */
  createStore: () => LeaseStore | Promise<LeaseStore>;
  /** Optional teardown hook for backends with external resources. */
  cleanup?: (store: LeaseStore) => Promise<void> | void;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_MS = 60_000;
const SHORT_MS = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Register the lease-store conformance cases against a backend. Call inside a
 * test file's top-level scope.
 */
export function createLeaseStoreConformanceTests(
  options: CreateLeaseStoreConformanceTestsOptions
): void {
  const { name, createStore, cleanup } = options;

  async function withStore(fn: (store: LeaseStore) => Promise<void>): Promise<void> {
    const store = await createStore();
    try {
      await fn(store);
    } finally {
      if (cleanup !== undefined) await cleanup(store);
    }
  }

  describe(`${name} (lease store conformance)`, () => {
    it("concurrent first acquires from different holders grant exactly one lease", async () => {
      await withStore(async (store) => {
        const holders = ["w1", "w2", "w3", "w4", "w5"];
        const results = await Promise.all(
          holders.map((holder) => store.acquire("req_race", { holder, durationMs: LONG_MS }))
        );
        const winners = results.filter((lease) => lease !== null);
        expect(winners).toHaveLength(1);
        // The stored lease is the winner's, not a later loser's overwrite.
        const current = await store.get("req_race");
        expect(current?.leaseId).toBe(winners[0]!.leaseId);
        expect(current?.holder).toBe(winners[0]!.holder);
      });
    });

    it("an active lease held by another holder blocks acquire", async () => {
      await withStore(async (store) => {
        const first = await store.acquire("req_block", { holder: "w1", durationMs: LONG_MS });
        expect(first).not.toBeNull();
        expect(await store.acquire("req_block", { holder: "w2", durationMs: LONG_MS })).toBeNull();
        expect((await store.get("req_block"))?.leaseId).toBe(first!.leaseId);
      });
    });

    it("lease ids are UUIDs, unique per acquisition", async () => {
      await withStore(async (store) => {
        const a = await store.acquire("req_ids_a", { holder: "w1", durationMs: LONG_MS });
        const b = await store.acquire("req_ids_b", { holder: "w1", durationMs: LONG_MS });
        const again = await store.acquire("req_ids_a", { holder: "w1", durationMs: LONG_MS });
        expect(a?.leaseId).toMatch(UUID_RE);
        expect(b?.leaseId).toMatch(UUID_RE);
        expect(again?.leaseId).toMatch(UUID_RE);
        expect(new Set([a!.leaseId, b!.leaseId, again!.leaseId]).size).toBe(3);
      });
    });

    it("an expired lease can be taken over by another holder", async () => {
      await withStore(async (store) => {
        const stale = await store.acquire("req_takeover", { holder: "w1", durationMs: SHORT_MS });
        expect(stale).not.toBeNull();
        await sleep(SHORT_MS * 2);
        const fresh = await store.acquire("req_takeover", { holder: "w2", durationMs: LONG_MS });
        expect(fresh).not.toBeNull();
        expect(fresh!.holder).toBe("w2");
        expect(fresh!.leaseId).not.toBe(stale!.leaseId);
      });
    });

    it("a stale holder's release does not free the newer holder's lease", async () => {
      await withStore(async (store) => {
        const stale = await store.acquire("req_stale", { holder: "w1", durationMs: SHORT_MS });
        expect(stale).not.toBeNull();
        await sleep(SHORT_MS * 2);
        const fresh = await store.acquire("req_stale", { holder: "w2", durationMs: LONG_MS });
        expect(fresh).not.toBeNull();

        await store.release("req_stale", stale!.leaseId);

        const current = await store.get("req_stale");
        expect(current?.leaseId).toBe(fresh!.leaseId);
        expect(await store.acquire("req_stale", { holder: "w3", durationMs: LONG_MS })).toBeNull();
      });
    });

    it("release by the current holder frees the lease for another holder", async () => {
      await withStore(async (store) => {
        const lease = await store.acquire("req_release", { holder: "w1", durationMs: LONG_MS });
        expect(lease).not.toBeNull();
        await store.release("req_release", lease!.leaseId);
        expect(await store.get("req_release")).toBeNull();
        expect(await store.acquire("req_release", { holder: "w2", durationMs: LONG_MS })).not.toBeNull();
      });
    });
  });
}
