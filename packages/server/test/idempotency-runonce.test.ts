/**
 * Tests for FIX-402: idempotency key propagation + ctx.runOnce(key, fn).
 *
 * Coverage:
 * - Retry de-dup: a runOnce-wrapped counter increments exactly once across
 *   block-level retries within the same request.
 * - Key isolation: two distinct runOnce keys in the same handler execute
 *   independently.
 * - Cross-attempt stability: ctx.idempotencyKey is identical across retry
 *   attempts of the same logical block step.
 * - Cross-request scope: a fresh requestId starts with an empty runOnce
 *   namespace (documents the spec's intentional non-guarantee for
 *   retryRequest-style recovery).
 * - Store adapter coverage: memory + filesystem here; SQLite contract
 *   lives in packages/store-sqlite/test/stores.test.ts (the server package
 *   cannot depend on adapter packages).
 */
import { handler, defineFlow } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { NetworkError } from "../src/errors/flow-error";
import {
  createInMemoryStores,
  createFilesystemStores,
  createResponseEmitter,
  runAction,
  type StoreRegistry
} from "../src";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type AdapterFactory = () => Promise<{
  stores: StoreRegistry;
  cleanup: () => Promise<void>;
}>;

const adapters: Array<{ name: string; factory: AdapterFactory }> = [
  {
    name: "memory",
    factory: async () => ({
      stores: createInMemoryStores(),
      cleanup: async () => undefined
    })
  },
  {
    name: "filesystem",
    factory: async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "fsd-runonce-"));
      return {
        stores: createFilesystemStores({ rootDir: dir }),
        cleanup: () => rm(dir, { recursive: true, force: true })
      };
    }
  },
];

describe("FIX-402: idempotency key + runOnce", () => {
  describe.each(adapters)("$name adapter", ({ factory }) => {
    let stores: StoreRegistry;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      ({ stores, cleanup } = await factory());
    });

    afterEach(async () => {
      await cleanup();
    });

    it("retry de-dup: runOnce-wrapped side effect runs exactly once across 5 retries", async () => {
      let sideEffectInvocations = 0;
      let attemptCount = 0;

      const flaky = handler({
        name: "flaky",
        inputSchema: z.number(),
        outputSchema: z.number(),
        retry: { maxAttempts: 5, baseDelayMs: 0, maxDelayMs: 0 },
        execute: async (value, ctx) => {
          attemptCount += 1;
          const stored = await ctx.runOnce!("counter", async () => {
            sideEffectInvocations += 1;
            return sideEffectInvocations;
          });
          // Throw on the first 3 attempts so retry kicks in but the
          // runOnce-wrapped side effect should have already been persisted
          // on the first attempt.
          if (attemptCount < 4) {
            throw new NetworkError(`retry-${attemptCount}`);
          }
          return stored + value;
        }
      });

      const flow = defineFlow({
        kind: "runonce-retry-flow",
        actions: {
          run: { inputSchema: z.number(), block: flaky }
        }
      })();

      const requestId = "req_runonce_retry";
      const response = createResponseEmitter({ requestId, now: () => Date.now() });
      const result = await runAction({
        flow,
        actionName: "run",
        input: 10,
        userId: "user",
        sessionId: "sess",
        requestId,
        stores,
        responseEmitter: response,
        runtimeConfig: {}
      });

      expect(result.error).toBeUndefined();
      expect(sideEffectInvocations).toBe(1);
      expect(attemptCount).toBe(4);

      const stored = await stores.request.getRunOnceResult(requestId, "counter");
      expect(stored.found).toBe(true);
      expect(stored.value).toBe(1);
    });

    it("key isolation: distinct keys execute independently", async () => {
      const log: string[] = [];

      const twoKeys = handler({
        name: "two-keys",
        inputSchema: z.number(),
        outputSchema: z.object({ a: z.string(), b: z.string() }),
        execute: async (_input, ctx) => {
          const a = await ctx.runOnce!("alpha", async () => {
            log.push("alpha-fn");
            return "A";
          });
          const b = await ctx.runOnce!("beta", async () => {
            log.push("beta-fn");
            return "B";
          });
          return { a, b };
        }
      });

      const flow = defineFlow({
        kind: "runonce-keys-flow",
        actions: {
          run: { inputSchema: z.number(), block: twoKeys }
        }
      })();

      const requestId = "req_runonce_keys";
      const response = createResponseEmitter({ requestId, now: () => Date.now() });
      const result = await runAction({
        flow,
        actionName: "run",
        input: 0,
        userId: "user",
        sessionId: "sess",
        requestId,
        stores,
        responseEmitter: response,
        runtimeConfig: {}
      });

      expect(result.error).toBeUndefined();
      expect(log).toEqual(["alpha-fn", "beta-fn"]);

      const alpha = await stores.request.getRunOnceResult(requestId, "alpha");
      const beta = await stores.request.getRunOnceResult(requestId, "beta");
      expect(alpha).toEqual({ found: true, value: "A" });
      expect(beta).toEqual({ found: true, value: "B" });
    });

    it("cross-attempt stability: idempotencyKey is identical across retry attempts", async () => {
      const observedKeys: string[] = [];
      let attemptCount = 0;

      const flakyHandler = handler({
        name: "flaky-key",
        inputSchema: z.number(),
        outputSchema: z.number(),
        retry: { maxAttempts: 4, baseDelayMs: 0, maxDelayMs: 0 },
        execute: async (value, ctx) => {
          attemptCount += 1;
          observedKeys.push(ctx.idempotencyKey ?? "<missing>");
          if (attemptCount < 3) throw new NetworkError(`retry-${attemptCount}`);
          return value;
        }
      });

      const flow = defineFlow({
        kind: "idempkey-flow",
        actions: { run: { inputSchema: z.number(), block: flakyHandler } }
      })();

      const requestId = "req_idempkey";
      const response = createResponseEmitter({ requestId, now: () => Date.now() });
      const result = await runAction({
        flow,
        actionName: "run",
        input: 1,
        userId: "user",
        sessionId: "sess",
        requestId,
        stores,
        responseEmitter: response,
        runtimeConfig: {}
      });

      expect(result.error).toBeUndefined();
      expect(observedKeys.length).toBe(3);
      const first = observedKeys[0];
      expect(first).toBe(`${requestId}:root`);
      expect(observedKeys.every((k) => k === first)).toBe(true);
    });

    it("cross-request scope: a fresh requestId observes an empty runOnce namespace", async () => {
      // This test documents the spec's intentional non-guarantee for
      // retryRequest-style recovery: a new requestId means a new scope.
      const log: string[] = [];

      const recordingHandler = handler({
        name: "record",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: async (_input, ctx) => {
          await ctx.runOnce!("once", async () => {
            log.push("ran");
            return 1;
          });
          return 1;
        }
      });

      const flow = defineFlow({
        kind: "cross-request-flow",
        actions: { run: { inputSchema: z.number(), block: recordingHandler } }
      })();

      const firstReq = "req_first";
      const r1 = createResponseEmitter({ requestId: firstReq, now: () => Date.now() });
      await runAction({
        flow,
        actionName: "run",
        input: 0,
        userId: "user",
        sessionId: "sess",
        requestId: firstReq,
        stores,
        responseEmitter: r1,
        runtimeConfig: {}
      });

      const secondReq = "req_second";
      const r2 = createResponseEmitter({ requestId: secondReq, now: () => Date.now() });
      await runAction({
        flow,
        actionName: "run",
        input: 0,
        userId: "user",
        sessionId: "sess",
        requestId: secondReq,
        stores,
        responseEmitter: r2,
        runtimeConfig: {}
      });

      expect(log).toEqual(["ran", "ran"]);
      const firstStored = await stores.request.getRunOnceResult(firstReq, "once");
      const secondStored = await stores.request.getRunOnceResult(secondReq, "once");
      expect(firstStored.found).toBe(true);
      expect(secondStored.found).toBe(true);
    });
  });

  it("store persistence failure does not cause fn to re-execute on retry", async () => {
    // Greptile P1: if setRunOnceResult throws, the in-process memo must
    // still prevent re-execution. Wrap the in-memory store and force
    // setRunOnceResult to throw so we can prove fn() runs exactly once.
    const stores = createInMemoryStores();
    const realSet = stores.request.setRunOnceResult.bind(stores.request);
    let failNext = true;
    stores.request.setRunOnceResult = async (rid, key, value) => {
      if (failNext) {
        failNext = false;
        throw new Error("simulated transient store failure");
      }
      return realSet(rid, key, value);
    };

    let sideEffectInvocations = 0;
    let attemptCount = 0;
    const flaky = handler({
      name: "flaky-persist",
      inputSchema: z.number(),
      outputSchema: z.number(),
      retry: { maxAttempts: 5, baseDelayMs: 0, maxDelayMs: 0 },
      execute: async (value, ctx) => {
        attemptCount += 1;
        const result = await ctx.runOnce!("once", async () => {
          sideEffectInvocations += 1;
          return sideEffectInvocations;
        });
        if (attemptCount < 3) throw new NetworkError(`retry-${attemptCount}`);
        return result + value;
      }
    });

    const flow = defineFlow({
      kind: "runonce-persist-fail",
      actions: { run: { inputSchema: z.number(), block: flaky } }
    })();

    const requestId = "req_persist_fail";
    const response = createResponseEmitter({ requestId, now: () => Date.now() });
    const result = await runAction({
      flow,
      actionName: "run",
      input: 0,
      userId: "user",
      sessionId: "sess",
      requestId,
      stores,
      responseEmitter: response,
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();
    // fn must fire exactly once even though the first setRunOnceResult
    // threw — the in-process memo absorbed the failure.
    expect(sideEffectInvocations).toBe(1);
  });

  it("concurrent same-key calls share a single inflight execution", async () => {
    const stores = createInMemoryStores();
    let invocations = 0;

    const concurrent = handler({
      name: "concurrent",
      inputSchema: z.number(),
      outputSchema: z.array(z.number()),
      execute: async (_input, ctx: BlockContext) => {
        // Fire 5 parallel runOnce calls with the same key. The wrapped fn
        // must only execute once even though all five are racing.
        const results = await Promise.all(
          [0, 1, 2, 3, 4].map(() =>
            ctx.runOnce!("shared", async () => {
              invocations += 1;
              await new Promise((r) => setTimeout(r, 10));
              return invocations;
            })
          )
        );
        return results;
      }
    });

    const flow = defineFlow({
      kind: "runonce-concurrent-flow",
      actions: { run: { inputSchema: z.number(), block: concurrent } }
    })();

    const requestId = "req_runonce_concurrent";
    const response = createResponseEmitter({ requestId, now: () => Date.now() });
    const result = await runAction({
      flow,
      actionName: "run",
      input: 0,
      userId: "user",
      sessionId: "sess",
      requestId,
      stores,
      responseEmitter: response,
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();
    expect(invocations).toBe(1);
  });
});
