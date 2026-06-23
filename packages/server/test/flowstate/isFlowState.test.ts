import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createFlowState, isFlowState, inMemoryStores } from "../../src";

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

describe("isFlowState", () => {
  it("accepts a real createFlowState handle", () => {
    const fs = createFlowState({
      flows: { noop: noopFlow },
      stores: { default: { primary: inMemoryStores() } }
    });
    expect(isFlowState(fs)).toBe(true);
  });

  it("rejects the old getRouter-only shape", () => {
    // The previous private guard (packages/node) checked only getRouter; a raw
    // FlowApiRouter or a partial mock must not pass the stricter contract.
    expect(isFlowState({ getRouter: () => {} })).toBe(false);
  });

  it("rejects partial shapes missing a lifecycle method", () => {
    const partial = {
      getRuntime: () => {},
      getRouter: () => {},
      ready: () => {}
      // no dispose
    };
    expect(isFlowState(partial)).toBe(false);
  });

  it("rejects null, undefined, and primitives", () => {
    expect(isFlowState(null)).toBe(false);
    expect(isFlowState(undefined)).toBe(false);
    expect(isFlowState(42)).toBe(false);
    expect(isFlowState("flowstate")).toBe(false);
  });

  it("rejects a plain object and a bare function", () => {
    expect(isFlowState({})).toBe(false);
    expect(isFlowState(() => {})).toBe(false);
  });
});
