/**
 * `createFlowState({ devtool })` surfaces on the sync `meta` getter so
 * `fsdev dev` can read the DevTool connection config without initializing
 * stores (FIX-894).
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createFlowState, inMemoryStores } from "../../src";

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

const stubModelResolver = (() => undefined) as never;

function build(devtool?: { userId?: string; bearerToken?: string }) {
  return createFlowState({
    flows: { noop: noopFlow },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: stubModelResolver,
    devtool
  });
}

describe("createFlowState — meta.devtool", () => {
  it("exposes the devtool config verbatim on meta (no store init)", () => {
    const fs = build({ userId: "owner", bearerToken: "s3cret" });
    // Reading meta must not require getRuntime()/ready().
    expect(fs.meta.devtool).toEqual({ userId: "owner", bearerToken: "s3cret" });
  });

  it("is undefined when no devtool config is declared", () => {
    const fs = build();
    expect(fs.meta.devtool).toBeUndefined();
  });
});
