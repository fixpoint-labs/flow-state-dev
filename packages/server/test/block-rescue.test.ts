/**
 * FIX-742: a bare action-root block carries its own `.rescue()`. In-flow child
 * blocks are recovered by core's `executeBlock` seam; the root block runs through
 * the server's `executeBlock`, so this verifies the server honors `config.rescue`
 * there (after retries are exhausted) and recovers the action instead of failing.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
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
});
