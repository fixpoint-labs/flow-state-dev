import { defineFlow, handler } from "@flow-state-dev/core";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it, onTestFinished } from "vitest";
import { createInMemoryStores, runAction } from "../src";
import { createInMemoryActiveRequestRegistry } from "../src/stores";

describe("retention policy integration", () => {
  it("evicts old requests after action completes when maxItems is exceeded", async () => {
    const stores = createInMemoryStores();

    const flow = defineFlow({
      kind: "retention-flow",
      actions: {
        run: {
          inputSchema: z.object({ value: z.number() }),
          block: handler({
            name: "echo",
            inputSchema: z.object({ value: z.number() }),
            outputSchema: z.object({ value: z.number() }),
            execute: (input) => input,
          }),
        },
      },
      session: {
        retention: { maxItems: 3 },
      },
    })();

    const sessionId = "sess_retention_int";

    // Run 4 actions — each produces 1 item (the handler output).
    // With maxItems: 3, the oldest requests should be evicted.
    // Retention spares a request for twice the live-tail liveness timeout
    // after it finishes; shorten that and space the runs past it.
    const previousLiveness = process.env.LIVE_TAIL_LIVENESS_MS;
    process.env.LIVE_TAIL_LIVENESS_MS = "10";
    onTestFinished(() => {
      if (previousLiveness === undefined) delete process.env.LIVE_TAIL_LIVENESS_MS;
      else process.env.LIVE_TAIL_LIVENESS_MS = previousLiveness;
    });
    for (let i = 0; i < 4; i++) {
      if (i > 0) await new Promise((resolve) => setTimeout(resolve, 30));
      await runAction({
    orgId: DEFAULT_ORG_ID,
        flow,
        actionName: "run",
        input: { value: i },
        requestId: `req_${i}`,
        userId: "user1",
        sessionId,
        stores,
        runtimeConfig: {}
      });
    }

    // After 4 runs with maxItems: 3:
    // req_3 (current on last run) is always kept.
    // req_2 (1 item) fits: 1+1=2.
    // req_1 (1 item) fits: 2+1=3.
    // req_0 (1 item) would be 4 > 3, evicted.
    //
    // But note: eviction runs after each completed request.
    // After req_1 completes: total = req_0(1) + req_1(1) = 2 ≤ 3. No eviction.
    // After req_2 completes: total = req_0(1) + req_1(1) + req_2(1) = 3 ≤ 3. No eviction.
    // After req_3 completes: req_0(1) + req_1(1) + req_2(1) + req_3(1) = 4 > 3.
    //   Current = req_3 (1 item). Budget = 3 - 1 = 2.
    //   Newest first: req_2 (1) fits (total=2). req_1 (1) fits (total=3). req_0 (1) exceeds.
    //   req_0 evicted.
    expect(await stores.request.get("req_0")).toBeUndefined();
    expect(await stores.request.get("req_1")).toBeDefined();
    expect(await stores.request.get("req_2")).toBeDefined();
    expect(await stores.request.get("req_3")).toBeDefined();
  });

  it("does not evict when under the limit", async () => {
    const stores = createInMemoryStores();

    const flow = defineFlow({
      kind: "retention-flow",
      actions: {
        run: {
          inputSchema: z.object({ value: z.number() }),
          block: handler({
            name: "echo",
            inputSchema: z.object({ value: z.number() }),
            outputSchema: z.object({ value: z.number() }),
            execute: (input) => input,
          }),
        },
      },
      session: {
        retention: { maxItems: 100 },
      },
    })();

    const sessionId = "sess_retention_under";

    for (let i = 0; i < 3; i++) {
      await runAction({
    orgId: DEFAULT_ORG_ID,
        flow,
        actionName: "run",
        input: { value: i },
        requestId: `req_${i}`,
        userId: "user1",
        sessionId,
        stores,
        runtimeConfig: {}
      });
    }

    // All should be present
    expect(await stores.request.get("req_0")).toBeDefined();
    expect(await stores.request.get("req_1")).toBeDefined();
    expect(await stores.request.get("req_2")).toBeDefined();
  });

  it("does not run eviction when no retention policy is configured", async () => {
    const stores = createInMemoryStores();

    const flow = defineFlow({
      kind: "no-retention-flow",
      actions: {
        run: {
          inputSchema: z.object({ value: z.number() }),
          block: handler({
            name: "echo",
            inputSchema: z.object({ value: z.number() }),
            outputSchema: z.object({ value: z.number() }),
            execute: (input) => input,
          }),
        },
      },
    })();

    const sessionId = "sess_no_retention";

    for (let i = 0; i < 5; i++) {
      await runAction({
    orgId: DEFAULT_ORG_ID,
        flow,
        actionName: "run",
        input: { value: i },
        requestId: `req_${i}`,
        userId: "user1",
        sessionId,
        stores,
        runtimeConfig: {}
      });
    }

    // All requests should be present
    for (let i = 0; i < 5; i++) {
      expect(await stores.request.get(`req_${i}`)).toBeDefined();
    }
  });

  it("does not evict failed requests", async () => {
    const stores = createInMemoryStores();

    const flow = defineFlow({
      kind: "retention-fail-flow",
      actions: {
        run: {
          inputSchema: z.object({ value: z.number() }),
          block: handler({
            name: "maybe-fail",
            inputSchema: z.object({ value: z.number() }),
            outputSchema: z.object({ value: z.number() }),
            execute: (input) => {
              if (input.value === -1) throw new Error("deliberate failure");
              return input;
            },
          }),
        },
      },
      session: {
        retention: { maxItems: 1 },
      },
    })();

    const sessionId = "sess_retention_fail";

    // First: a successful request
    await runAction({
    orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: { value: 1 },
      requestId: "req_ok",
      userId: "user1",
      sessionId,
      stores,
      runtimeConfig: {}
    });

    // Second: a failed request
    await runAction({
    orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: { value: -1 },
      requestId: "req_fail",
      userId: "user1",
      sessionId,
      stores,
      runtimeConfig: {}
    });

    // Third: another successful request. This triggers eviction.
    await runAction({
    orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: { value: 2 },
      requestId: "req_ok2",
      userId: "user1",
      sessionId,
      stores,
      runtimeConfig: {}
    });

    // Failed request should still be present (not an eviction candidate)
    const failedReq = await stores.request.get("req_fail");
    expect(failedReq).toBeDefined();
    expect(failedReq?.status).toBe("failed");
  });
});

// A request's record turns `completed` before its run is done: `onFinished`
// still runs, and it may write. Time alone cannot say when that is over, and a
// process-local registry cannot see a run in another process. Retention may
// free the id only once the run has recorded that it finished.
describe("retention against a run still in onFinished in another process", () => {
  it("keeps the request until its run has finished, however long that takes", async () => {
    const previousLiveness = process.env.LIVE_TAIL_LIVENESS_MS;
    process.env.LIVE_TAIL_LIVENESS_MS = "5";
    onTestFinished(() => {
      if (previousLiveness === undefined) delete process.env.LIVE_TAIL_LIVENESS_MS;
      else process.env.LIVE_TAIL_LIVENESS_MS = previousLiveness;
    });

    let releaseOnFinished!: () => void;
    const onFinishedHeld = new Promise<void>((resolve) => {
      releaseOnFinished = resolve;
    });
    let onFinishedEntered!: () => void;
    const onFinishedStarted = new Promise<void>((resolve) => {
      onFinishedEntered = resolve;
    });

    const flow = defineFlow({
      kind: "retention-tail-flow",
      actions: {
        run: {
          inputSchema: z.object({ value: z.number() }),
          block: handler({
            name: "echo",
            inputSchema: z.object({ value: z.number() }),
            outputSchema: z.object({ value: z.number() }),
            execute: (input) => input,
          }),
        },
      },
      request: {
        onFinished: handler({
          name: "slow-finish",
          inputSchema: z.any(),
          outputSchema: z.any(),
          execute: async (input: { requestId: string }) => {
            if (input.requestId === "req_slow") {
              onFinishedEntered();
              await onFinishedHeld;
            }
            return null;
          },
        }),
      },
      session: {
        retention: { maxItems: 1 },
      },
    })();

    // Two processes sharing one request store, each with its own registry.
    const processA = createInMemoryStores();
    const processB = { ...processA, activeRequests: createInMemoryActiveRequestRegistry() };
    const sessionId = "sess_retention_tail";
    const run = (stores: typeof processA, requestId: string) =>
      runAction({
        orgId: DEFAULT_ORG_ID,
        flow,
        actionName: "run",
        input: { value: 1 },
        requestId,
        userId: "user1",
        sessionId,
        stores,
        runtimeConfig: {},
      });

    const slow = run(processA, "req_slow");
    await onFinishedStarted;
    expect((await processA.request.get("req_slow"))?.status).toBe("completed");
    // Well past the grace window (twice the 5ms liveness timeout).
    await new Promise((resolve) => setTimeout(resolve, 50));

    await run(processB, "req_sibling");
    expect(await processA.request.get("req_slow")).toBeDefined();

    releaseOnFinished();
    await slow;
    await new Promise((resolve) => setTimeout(resolve, 50));

    await run(processB, "req_next");
    expect(await processA.request.get("req_slow")).toBeUndefined();
  });
});
