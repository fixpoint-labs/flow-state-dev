/**
 * FIX-742: a bare action-root block carries its own `.rescue()`. In-flow child
 * blocks are recovered by core's `executeBlock` seam; the root block runs through
 * the server's `executeBlock`, so this verifies the server honors `config.rescue`
 * there (after retries are exhausted) and recovers the action instead of failing.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createInMemoryStores, runAction } from "../src";

describe("FIX-742: action-root block rescue", () => {
  it("recovers a bare root handler via its own .rescue()", async () => {
    let fallbackRan = false;
    const failing = handler({
      name: "root-failing",
      inputSchema: z.object({ n: z.number() }),
      outputSchema: z.object({ value: z.number() }),
      execute: () => {
        throw new Error("root boom");
      }
    });
    const fallback = handler({
      name: "root-fallback",
      inputSchema: z.any(),
      outputSchema: z.object({ value: z.number() }),
      execute: () => {
        fallbackRan = true;
        return { value: -1 };
      }
    });

    const flow = defineFlow({
      kind: "root-rescue-flow",
      actions: {
        run: {
          inputSchema: z.object({ n: z.number() }),
          block: failing.rescue([{ block: fallback }])
        }
      }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: { n: 1 },
      userId: "user_root_rescue",
      sessionId: "sess_root_rescue",
      stores: createInMemoryStores(),
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();
    expect(fallbackRan).toBe(true);
  });

  it("exhausts retries before rescuing a root block", async () => {
    let attempts = 0;
    let fallbackRan = false;
    const flaky = handler({
      name: "root-flaky",
      inputSchema: z.object({ n: z.number() }),
      outputSchema: z.object({ value: z.number() }),
      retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 },
      execute: () => {
        attempts += 1;
        throw new Error(`attempt-${attempts}`);
      }
    });
    const fallback = handler({
      name: "root-flaky-fallback",
      inputSchema: z.any(),
      outputSchema: z.object({ value: z.number() }),
      execute: () => {
        fallbackRan = true;
        return { value: 0 };
      }
    });

    const flow = defineFlow({
      kind: "root-retry-rescue-flow",
      actions: {
        run: {
          inputSchema: z.object({ n: z.number() }),
          block: flaky.rescue([{ block: fallback }])
        }
      }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: { n: 1 },
      userId: "user_retry_rescue",
      sessionId: "sess_retry_rescue",
      stores: createInMemoryStores(),
      runtimeConfig: {}
    });

    // Retries run first (3 attempts), then the rescue fires once.
    expect(attempts).toBe(3);
    expect(fallbackRan).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("rescues a non-retryable error immediately without exhausting retries", async () => {
    class TransientError extends Error {}
    let attempts = 0;
    let fallbackRan = false;
    // maxAttempts: 3 but only TransientError is retryable; a plain Error is
    // non-retryable, so retryWithPolicy aborts after the first attempt. Rescue
    // must still fire (the fix: a non-retryable error counts as "final").
    const flaky = handler({
      name: "nonretryable-flaky",
      inputSchema: z.object({ n: z.number() }),
      outputSchema: z.object({ value: z.number() }),
      retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0, retryableErrors: [TransientError] },
      execute: () => {
        attempts += 1;
        throw new Error("permanent failure");
      }
    });
    const fallback = handler({
      name: "nonretryable-fallback",
      inputSchema: z.any(),
      outputSchema: z.object({ value: z.number() }),
      execute: () => {
        fallbackRan = true;
        return { value: 0 };
      }
    });

    const flow = defineFlow({
      kind: "nonretryable-rescue-flow",
      actions: {
        run: {
          inputSchema: z.object({ n: z.number() }),
          block: flaky.rescue([{ block: fallback }])
        }
      }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: { n: 1 },
      userId: "user_nonretryable",
      sessionId: "sess_nonretryable",
      stores: createInMemoryStores(),
      runtimeConfig: {}
    });

    expect(attempts).toBe(1); // non-retryable: no further attempts
    expect(fallbackRan).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("recovers an in-flow leaf step and the chain continues with wasRescued", async () => {
    // Unlike the action-root cases above, this exercises the core executeBlock
    // in-flow seam: the rescued block is a step inside a sequencer run via
    // runAction (which installs _withExecutionScope), and a downstream step
    // observes ctx.wasRescued — the production path the unit tests can't reach.
    let afterRan = false;
    let sawRescued: boolean | undefined;
    const failing = handler({
      name: "inflow-fail",
      inputSchema: z.object({ n: z.number() }),
      outputSchema: z.object({ value: z.number() }),
      execute: () => {
        throw new Error("inflow boom");
      }
    });
    const fallback = handler({
      name: "inflow-fallback",
      inputSchema: z.any(),
      outputSchema: z.object({ value: z.number() }),
      execute: () => ({ value: -1 })
    });
    const safeFailing = failing.rescue([{ block: fallback }]);
    const after = handler({
      name: "inflow-after",
      inputSchema: z.object({ value: z.number() }),
      outputSchema: z.object({ value: z.number() }),
      execute: (input, ctx) => {
        afterRan = true;
        sawRescued = ctx.wasRescued(safeFailing);
        return { value: input.value + 1 };
      }
    });

    const flow = defineFlow({
      kind: "inflow-rescue-flow",
      actions: {
        run: {
          inputSchema: z.object({ n: z.number() }),
          block: sequencer({ name: "inflow-seq", inputSchema: z.object({ n: z.number() }) })
            .step(safeFailing)
            .step(after)
        }
      }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: { n: 1 },
      userId: "user_inflow",
      sessionId: "sess_inflow",
      stores: createInMemoryStores(),
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();
    expect(afterRan).toBe(true); // chain continued past the rescued step
    expect(sawRescued).toBe(true); // _didRescue stamped through _withExecutionScope
  });
});
