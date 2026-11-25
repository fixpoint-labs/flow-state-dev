import { describe, expect, it } from "vitest";
import { handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { createTestContext, testBlock } from "../src";

describe("sequencer state testing utilities", () => {
  it("combines a parent sequencer seed with the block's defaults and returns its updated state", async () => {
    const increment = handler({
      name: "increment",
      inputSchema: z.number(),
      outputSchema: z.number(),
      sequencerStateSchema: z.object({ count: z.number().default(0), mode: z.string().default("ready") }),
      execute: async (input, ctx) => {
        await ctx.sequencer!.incState({ count: input });
        return ctx.sequencer!.state.count;
      }
    });

    const result = await testBlock(increment, {
      input: 2,
      sequencer: {
        state: { count: 3, legacy: true }
      }
    });

    expect(result.error).toBeNull();
    expect(result.output).toBe(5);
    expect(result.state.sequencer).toEqual({ count: 5, mode: "ready", legacy: true });
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
      sequencerStateSchema: z.object({ count: z.number() }),
      outputSchema: z.object({ nearest: z.string(), count: z.number() }),
      execute: (_input, ctx) => ({
        nearest: ctx.sequencer!.name,
        count: ctx.sequencer!.state.count
      })
    });

    const inner = sequencer({
      name: "inner",
      inputSchema: z.number(),
      stateSchema: z.object({ count: z.number().default(11) })
    }).step(leaf);

    const outer = sequencer({
      name: "outer",
      inputSchema: z.number(),
      stateSchema: z.object({ count: z.number().default(7) })
    }).step(inner).sideChain(handler({
      name: "audit",
      inputSchema: z.unknown(),
      execute: () => "recorded"
    }));

    const unseeded = await testBlock(outer, { input: 1 });
    const result = await testBlock(outer, { input: 1, sequencer: { state: { count: 3 } } });
    expect(result.output).toEqual({ nearest: "inner", count: 11 });
    expect(result.state.sequencer).toEqual({ count: 3 });
    expect(result.steps.map(({ blockName, stepName, phase }) => ({ blockName, stepName, phase })))
      .toEqual(unseeded.steps.map(({ blockName, stepName, phase }) => ({ blockName, stepName, phase })));
    expect(result.loopIterations).toBe(unseeded.loopIterations);
    expect(result.sideChainResults.map(({ blockName, output }) => ({ blockName, output })))
      .toEqual(unseeded.sideChainResults.map(({ blockName, output }) => ({ blockName, output })));
    expect(result.sideChainResults.some((trace) => trace.blockName === "audit")).toBe(true);
  });

  it("isolates nested seed data from the caller", async () => {
    const increment = handler({
      name: "increment-nested",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (input, ctx) => {
        const counters = ctx.sequencer?.state.counters as { value: number }[];
        counters[0]!.value += input;
        return counters[0]!.value;
      }
    });
    const seed = { state: { counters: [{ value: 3 }] } };

    const first = await testBlock(increment, { input: 2, sequencer: seed });
    const second = await testBlock(increment, { input: 1, sequencer: seed });

    expect(first.output).toBe(5);
    expect(second.output).toBe(4);
    expect(seed.state.counters).toEqual([{ value: 3 }]);
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
    // Deterministic IDs have the shape `${requestId}:${path}:${attempt}`.
    expect(stateChange?.targetInstanceId).toMatch(/^[^:]+:[^:]+:\d+$/);
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
