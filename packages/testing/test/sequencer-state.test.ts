import { describe, expect, it } from "vitest";
import { handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { createTestContext, testBlock, testSequencer } from "../src";

describe("sequencer state testing utilities", () => {
  it("basic: testBlock supports seeded sequencer state and captures sequencer mutations", async () => {
    const increment = handler({
      name: "increment",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: async (input, ctx) => {
        await ctx.sequencer?.incState({ count: input });
        return Number(ctx.sequencer?.state.count ?? 0);
      }
    });

    const result = await testBlock(increment, {
      input: 2,
      sequencer: {
        state: { count: 3 }
      }
    });

    expect(result.output).toBe(2);
    expect(result.stateChanges.some((change) => change.scope === "block_instance")).toBe(true);
    expect(
      result.stateChanges.find(
        (change) => change.scope === "block_instance" && change.operation === "incState"
      )
    ).toBeDefined();
  });

  it("nested: inner sequencer state shadows outer sequencer state", async () => {
    const leaf = handler({
      name: "leaf",
      inputSchema: z.number(),
      outputSchema: z.object({ nearest: z.string(), count: z.number() }),
      execute: (input, ctx) => ({
        nearest: String(ctx.sequencer?.name ?? "none"),
        count: Number((ctx.sequencer?.state as Record<string, unknown>)?.count ?? input)
      })
    });

    const inner = sequencer({
      name: "inner",
      inputSchema: z.number(),
      stateSchema: z.object({ count: z.number().default(11) })
    }).then(leaf);

    const outer = sequencer({
      name: "outer",
      inputSchema: z.number(),
      stateSchema: z.object({ count: z.number().default(7) })
    }).then(inner);

    const result = await testSequencer(outer, { input: 1 });
    expect(result.output).toEqual({ nearest: "inner", count: 11 });
  });

  it("tool chain context: createTestContext seeds ctx.sequencer for downstream tool execution paths", async () => {
    const runtime = await createTestContext({
      sequencer: {
        name: "research",
        state: { mode: "active" }
      }
    });

    expect(runtime.ctx.sequencer?.name).toBe("research");
    expect(runtime.ctx.sequencer?.state).toEqual({ mode: "active" });
  });

  it("multiple targets: createTestContext wires getTarget(name) for seeded parent chain mocks", async () => {
    const runtime = await createTestContext({
      targets: {
        outer: {
          state: { mode: "active" }
        }
      }
    });

    expect(runtime.ctx.getTarget("outer")?.name).toBe("outer");
    expect(runtime.ctx.getTarget("outer")?.state).toEqual({ mode: "active" });
  });

  it("emission: sequencer mutations emit state_change items with correct metadata", async () => {
    const mutate = handler({
      name: "mutate",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: async (input, ctx) => {
        await ctx.sequencer?.patchState({ progress: input });
        return input;
      }
    });

    const result = await testBlock(mutate, {
      input: 9,
      sequencer: {
        name: "emit-seq",
        state: { progress: 0 }
      }
    });

    const stateChange = result.stateChanges.find(
      (change) => change.scope === "block_instance" && change.operation === "patchState"
    );

    expect(stateChange).toBeDefined();
    expect(stateChange?.targetName).toBe("emit-seq");
    expect(stateChange?.targetInstanceId).toMatch(/^emit-seq_/);
    expect(result.stateChanges.some((change) => change.scope === "block_instance")).toBe(true);
  });

  it("no sequencer: ctx.sequencer is undefined when block runs standalone", async () => {
    const standalone = handler({
      name: "standalone",
      inputSchema: z.number(),
      outputSchema: z.boolean(),
      execute: (_input, ctx) => ctx.sequencer === undefined
    });

    const result = await testBlock(standalone, { input: 1 });
    expect(result.output).toBe(true);
    expect(result.state.sequencer).toEqual({});
  });
});
