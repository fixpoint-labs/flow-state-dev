/** `FlowState.dispose()` stops the router's sweepers before it closes the stores. */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createFlowState, inMemoryStores, type StoreAdapter } from "../../src";

const SWEEP_INTERVAL_MS = 10;

const noopFlow = defineFlow({
  kind: "noop-flow",
  actions: {
    ping: {
      inputSchema: z.object({}).passthrough(),
      block: handler({
        name: "ping",
        inputSchema: z.object({}).passthrough(),
        execute: () => undefined
      })
    }
  }
})();

/**
 * An in-memory adapter that behaves like a real connection: once disposed,
 * every store call is counted as a read through a closed connection.
 */
function closingAdapter(): StoreAdapter & { callsAfterClose: () => number } {
  const inner = inMemoryStores();
  let closed = false;
  let callsAfterClose = 0;
  const guard = <T extends object>(store: T): T =>
    new Proxy(store, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (closed) callsAfterClose += 1;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
    });
  return {
    capabilities: inner.capabilities,
    resolve: async (slots) => {
      const resolved = await inner.resolve(slots);
      return Object.fromEntries(
        Object.entries(resolved).map(([slot, store]) => [
          slot,
          typeof store === "object" && store !== null ? guard(store) : store
        ])
      );
    },
    dispose: () => {
      closed = true;
    },
    callsAfterClose: () => callsAfterClose
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("FlowState.dispose() — sweeper shutdown ordering", () => {
  it("no sweep reads the stores after they are closed", async () => {
    const adapter = closingAdapter();
    const fs = createFlowState({
      flows: { noop: noopFlow },
      stores: { default: { primary: adapter } },
      detectInterruptedOnStartup: false,
      staleSweepIntervalMs: SWEEP_INTERVAL_MS,
      staleSweepThresholdMs: 60_000
    });
    await fs.ready();
    // Let the sweeper tick at least once so the test proves it was running.
    await wait(SWEEP_INTERVAL_MS * 3);

    await fs.dispose();
    await wait(SWEEP_INTERVAL_MS * 5);

    expect(adapter.callsAfterClose()).toBe(0);
  });
});
