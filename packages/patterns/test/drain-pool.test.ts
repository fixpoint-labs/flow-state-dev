/**
 * drain-pool pattern tests.
 *
 * Covers: basic drain, mid-drain enqueue, concurrent dispatch correctness,
 * lease / retry semantics, error isolation vs propagation, handle surface,
 * and termination invariant under concurrent workers.
 *
 * Note: `testBlock` only surfaces root-level ctx state, so assertions on
 * counter values go through the items log's `drain-pool-stats` components
 * (last-wins) rather than `result.state.sequencer`.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import type { OutputItem } from "@flow-state-dev/core/items";
import { z } from "zod";
import {
  drainPool,
  createDrainPoolItemSchema,
  drainPoolProjectionSchema,
} from "../src/drain-pool";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Job = { id: string; value?: number };
const jobSchema = z.object({ id: z.string(), value: z.number().optional() });

function makeFlow(poolHandle: { queue: unknown; queueKey: string }) {
  return defineFlow({
    kind: "drain-pool-test",
    actions: {
      run: {
        inputSchema: z.any(),
        block: handler({
          name: "noop",
          inputSchema: z.any(),
          outputSchema: z.any(),
          execute: () => "ok",
        }),
      },
    },
    session: {
      resources: { [poolHandle.queueKey]: poolHandle.queue as any },
    },
  })();
}

function latestStats(items: OutputItem[]): {
  queuePending: number;
  inFlight: number;
  completed: number;
  failed: number;
} {
  const stats = items
    .filter((item) => item.type === "component" && (item as any).component === "drain-pool-stats")
    .map((item) => (item as any).data as {
      queuePending: number;
      inFlight: number;
      completed: number;
      failed: number;
    });
  return stats[stats.length - 1] ?? { queuePending: 0, inFlight: 0, completed: 0, failed: 0 };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("drain-pool", () => {
  describe("block structure", () => {
    it("returns block + queue + queueKey + enqueue", () => {
      const pool = drainPool<Job>({
        name: "structure",
        item: jobSchema,
        block: handler({
          name: "body",
          inputSchema: z.any(),
          outputSchema: z.any(),
          execute: () => null,
        }),
      });
      expect(pool.block.kind).toBe("sequencer");
      expect(pool.queueKey).toBe("structure-queue");
      expect(pool.queue).toBeDefined();
      expect(typeof pool.enqueue).toBe("function");
    });

    it("throws when concurrency is < 1", () => {
      expect(() =>
        drainPool<Job>({
          name: "bad-concurrency",
          item: jobSchema,
          concurrency: 0,
          block: handler({
            name: "body",
            inputSchema: z.any(),
            outputSchema: z.any(),
            execute: () => null,
          }),
        })
      ).toThrow(/concurrency/);
    });

    it("throws when maxAttempts is < 1", () => {
      expect(() =>
        drainPool<Job>({
          name: "bad-attempts",
          item: jobSchema,
          maxAttempts: 0,
          block: handler({
            name: "body",
            inputSchema: z.any(),
            outputSchema: z.any(),
            execute: () => null,
          }),
        })
      ).toThrow(/maxAttempts/);
    });
  });

  describe("basic drain", () => {
    it("processes all initial items and exits cleanly", async () => {
      const processed: string[] = [];
      const body = handler({
        name: "body-basic",
        inputSchema: jobSchema,
        outputSchema: z.any(),
        execute: (job: Job) => {
          processed.push(job.id);
          return null;
        },
      });

      const pool = drainPool<Job>({
        name: "basic",
        item: jobSchema,
        concurrency: 2,
        initialItems: [
          { id: "a" },
          { id: "b" },
          { id: "c" },
          { id: "d" },
        ],
        block: body,
      });

      const result = await testBlock(pool.block, {
        input: undefined,
        flow: makeFlow(pool),
      });

      expect(result.error).toBeNull();
      expect(processed.sort()).toEqual(["a", "b", "c", "d"]);
      const stats = latestStats(result.items);
      expect(stats.completed).toBe(4);
      expect(stats.failed).toBe(0);
      expect(stats.inFlight).toBe(0);
      expect(stats.queuePending).toBe(0);
    });

    it("exits cleanly with empty initialItems", async () => {
      const body = handler({
        name: "body-empty",
        inputSchema: jobSchema,
        outputSchema: z.any(),
        execute: () => {
          throw new Error("should not run");
        },
      });

      const pool = drainPool<Job>({
        name: "empty",
        item: jobSchema,
        concurrency: 3,
        block: body,
      });

      const result = await testBlock(pool.block, {
        input: undefined,
        flow: makeFlow(pool),
      });
      expect(result.error).toBeNull();
    });

    it("processes a single item with concurrency=1", async () => {
      const processed: string[] = [];
      const body = handler({
        name: "body-single",
        inputSchema: jobSchema,
        outputSchema: z.any(),
        execute: (job: Job) => {
          processed.push(job.id);
          return null;
        },
      });

      const pool = drainPool<Job>({
        name: "single",
        item: jobSchema,
        concurrency: 1,
        initialItems: [{ id: "only" }],
        block: body,
      });

      const result = await testBlock(pool.block, {
        input: undefined,
        flow: makeFlow(pool),
      });
      expect(result.error).toBeNull();
      expect(processed).toEqual(["only"]);
    });
  });

  describe("concurrency correctness", () => {
    it("no two workers process the same item (8 workers, 100 items)", async () => {
      const seen = new Map<string, number>();
      const duplicates: string[] = [];

      const body = handler({
        name: "body-race",
        inputSchema: jobSchema,
        outputSchema: z.any(),
        execute: (job: Job) => {
          const count = (seen.get(job.id) ?? 0) + 1;
          seen.set(job.id, count);
          if (count > 1) duplicates.push(job.id);
          return null;
        },
      });

      const items = Array.from({ length: 100 }, (_, i) => ({
        id: `item-${i}`,
      }));

      const pool = drainPool<Job>({
        name: "race",
        item: jobSchema,
        concurrency: 8,
        initialItems: items,
        block: body,
      });

      const result = await testBlock(pool.block, {
        input: undefined,
        flow: makeFlow(pool),
      });

      expect(result.error).toBeNull();
      expect(duplicates).toEqual([]);
      expect(seen.size).toBe(100);
      const stats = latestStats(result.items);
      expect(stats.completed).toBe(100);
    });
  });

  describe("mid-drain enqueue via factory", () => {
    it("body factory can tap enqueue to fan out follow-up items", async () => {
      const processed: string[] = [];

      const pool = drainPool<Job>({
        name: "fan",
        item: jobSchema,
        concurrency: 2,
        initialItems: [{ id: "seed" }],
        block: ({ enqueue }) =>
          sequencer({ name: "fan-body" })
            .then(
              handler({
                name: "fan-work",
                inputSchema: jobSchema,
                outputSchema: jobSchema,
                execute: (job: Job) => {
                  processed.push(job.id);
                  return job;
                },
              })
            )
            .tap(
              enqueue((job: Job) =>
                job.id === "seed"
                  ? [{ id: "child-a" }, { id: "child-b" }]
                  : []
              )
            ),
      });

      const result = await testBlock(pool.block, {
        input: undefined,
        flow: makeFlow(pool),
      });

      expect(result.error).toBeNull();
      expect(processed.sort()).toEqual(["child-a", "child-b", "seed"]);
      const stats = latestStats(result.items);
      expect(stats.completed).toBe(3);
    });

    it("cascading enqueues: level 1 → level 2 → level 3", async () => {
      const processed: string[] = [];

      const pool = drainPool<Job>({
        name: "cascade",
        item: jobSchema,
        concurrency: 3,
        initialItems: [{ id: "L0" }],
        block: ({ enqueue }) =>
          sequencer({ name: "cascade-body" })
            .then(
              handler({
                name: "cascade-work",
                inputSchema: jobSchema,
                outputSchema: jobSchema,
                execute: (job: Job) => {
                  processed.push(job.id);
                  return job;
                },
              })
            )
            .tap(
              enqueue((job: Job) => {
                if (job.id === "L0") return [{ id: "L1-a" }, { id: "L1-b" }];
                if (job.id === "L1-a") return [{ id: "L2" }];
                return [];
              })
            ),
      });

      const result = await testBlock(pool.block, {
        input: undefined,
        flow: makeFlow(pool),
      });
      expect(result.error).toBeNull();
      expect(processed.sort()).toEqual(["L0", "L1-a", "L1-b", "L2"]);
    });
  });

  describe("error handling", () => {
    it('onError: "skip" isolates failures; siblings continue', async () => {
      const processed: string[] = [];
      const body = handler({
        name: "body-skip",
        inputSchema: jobSchema,
        outputSchema: z.any(),
        execute: (job: Job) => {
          if (job.id === "bad") {
            throw new Error("intentional");
          }
          processed.push(job.id);
          return null;
        },
      });

      const pool = drainPool<Job>({
        name: "skip",
        item: jobSchema,
        concurrency: 2,
        initialItems: [
          { id: "good-1" },
          { id: "bad" },
          { id: "good-2" },
        ],
        block: body,
        onError: "skip",
      });

      const result = await testBlock(pool.block, {
        input: undefined,
        flow: makeFlow(pool),
      });

      expect(result.error).toBeNull();
      expect(processed.sort()).toEqual(["good-1", "good-2"]);
      const stats = latestStats(result.items);
      expect(stats.completed).toBe(2);
      expect(stats.failed).toBe(1);
    });

    it('onError: "fail" propagates the error to the parent', async () => {
      const body = handler({
        name: "body-fail",
        inputSchema: jobSchema,
        outputSchema: z.any(),
        execute: (job: Job) => {
          if (job.id === "boom") {
            throw new Error("boom-err");
          }
          return null;
        },
      });

      const pool = drainPool<Job>({
        name: "fail-prop",
        item: jobSchema,
        concurrency: 1,
        initialItems: [{ id: "boom" }],
        block: body,
        onError: "fail",
      });

      const result = await testBlock(pool.block, {
        input: undefined,
        flow: makeFlow(pool),
      });

      expect(result.error).not.toBeNull();
      expect(result.error?.message).toContain("boom-err");
    });

    it("maxAttempts > 1 retries before terminal failure", async () => {
      const attempts = new Map<string, number>();
      const body = handler({
        name: "body-retry",
        inputSchema: jobSchema,
        outputSchema: z.any(),
        execute: (job: Job) => {
          attempts.set(job.id, (attempts.get(job.id) ?? 0) + 1);
          throw new Error("always fail");
        },
      });

      const pool = drainPool<Job>({
        name: "retry",
        item: jobSchema,
        concurrency: 1,
        maxAttempts: 3,
        initialItems: [{ id: "victim" }],
        block: body,
        onError: "skip",
      });

      const result = await testBlock(pool.block, {
        input: undefined,
        flow: makeFlow(pool),
      });

      expect(result.error).toBeNull();
      expect(attempts.get("victim")).toBe(3);
      const stats = latestStats(result.items);
      expect(stats.failed).toBe(1);
      expect(stats.completed).toBe(0);
    });
  });

  describe("termination invariant", () => {
    it("sibling waits for in-flight worker to finish + enqueue before exiting", async () => {
      // This test exercises the critical correctness argument: while worker A
      // is processing an item (inFlight >= 1), no sibling can observe
      // shouldContinue=false. So a mid-block enqueue from A is always picked
      // up — even if it happens right before A's markDone decrements inFlight.
      const processed: string[] = [];

      const pool = drainPool<Job>({
        name: "invariant",
        item: jobSchema,
        concurrency: 2,
        initialItems: [{ id: "seed" }],
        block: ({ enqueue }) =>
          sequencer({ name: "invariant-body" })
            .then(
              handler({
                name: "invariant-work",
                inputSchema: jobSchema,
                outputSchema: jobSchema,
                execute: async (job: Job) => {
                  processed.push(job.id);
                  // Yield — gives the sibling worker a chance to poll before
                  // we finish our enqueue + markDone.
                  await new Promise((r) => setTimeout(r, 1));
                  return job;
                },
              })
            )
            .tap(
              enqueue((job: Job) =>
                job.id === "seed" ? [{ id: "child" }] : []
              )
            ),
      });

      const result = await testBlock(pool.block, {
        input: undefined,
        flow: makeFlow(pool),
      });
      expect(result.error).toBeNull();
      expect(processed.sort()).toEqual(["child", "seed"]);
    });
  });

  describe("schemas surface", () => {
    it("createDrainPoolItemSchema parameterises the payload", () => {
      const schema = createDrainPoolItemSchema(jobSchema);
      const parsed = schema.safeParse({
        id: "x",
        payload: { id: "x", value: 1 },
        status: "pending",
        attempts: 0,
        enqueuedAt: 1,
      });
      expect(parsed.success).toBe(true);
    });

    it("drainPoolProjectionSchema has sane defaults", () => {
      const parsed = drainPoolProjectionSchema.safeParse({});
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data).toEqual({
          queuePending: 0,
          inFlight: 0,
          completed: 0,
          failed: 0,
          items: {},
        });
      }
    });
  });
});
