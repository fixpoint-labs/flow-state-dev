import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createInMemoryStores, runAction } from "../src";

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
    for (let i = 0; i < 4; i++) {
      await runAction({
        flow,
        actionName: "run",
        input: { value: i },
        requestId: `req_${i}`,
        userId: "user1",
        sessionId,
        stores,
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
        flow,
        actionName: "run",
        input: { value: i },
        requestId: `req_${i}`,
        userId: "user1",
        sessionId,
        stores,
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
        flow,
        actionName: "run",
        input: { value: i },
        requestId: `req_${i}`,
        userId: "user1",
        sessionId,
        stores,
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
      flow,
      actionName: "run",
      input: { value: 1 },
      requestId: "req_ok",
      userId: "user1",
      sessionId,
      stores,
    });

    // Second: a failed request
    await runAction({
      flow,
      actionName: "run",
      input: { value: -1 },
      requestId: "req_fail",
      userId: "user1",
      sessionId,
      stores,
    });

    // Third: another successful request. This triggers eviction.
    await runAction({
      flow,
      actionName: "run",
      input: { value: 2 },
      requestId: "req_ok2",
      userId: "user1",
      sessionId,
      stores,
    });

    // Failed request should still be present (not an eviction candidate)
    const failedReq = await stores.request.get("req_fail");
    expect(failedReq).toBeDefined();
    expect(failedReq?.status).toBe("failed");
  });
});
