/**
 * Test fixture: a config whose store adapter rejects when its pool is resolved,
 * so `getRuntime()` fails. The adapter records dispose() calls on globalThis so
 * a test can assert the CLI disposes the FlowState on the init-failure path.
 */
import { createFlowState, type StoreAdapter } from "@flow-state-dev/server";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

const g = globalThis as unknown as { __fsdevDisposeCalls: number };
g.__fsdevDisposeCalls = 0;

function rejectingStores(): StoreAdapter {
  return {
    capabilities: ["primary"],
    resolve() {
      return Promise.reject(new Error("store init failed: unreachable DB"));
    },
    dispose() {
      g.__fsdevDisposeCalls = (g.__fsdevDisposeCalls ?? 0) + 1;
    },
  };
}

const flow = defineFlow({
  kind: "x",
  actions: {
    go: {
      inputSchema: z.object({}).passthrough(),
      block: handler({
        name: "x",
        inputSchema: z.object({}).passthrough(),
        execute: () => undefined,
      }),
    },
  },
})({ id: "default" });

export default createFlowState({
  flows: { x: flow },
  stores: { default: { primary: rejectingStores() } },
});
