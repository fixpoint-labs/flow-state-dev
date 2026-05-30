import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handler } from "../src";
import type { BlockContext } from "../src/types/block";
import type { SequencerRuntimeState } from "../src/blocks/sequencer-methods";
import { runBackground, runChild } from "../src/blocks/internal/sequencer-kernel";
import { buildBlockInstanceId } from "../src/blocks/internal/block-instance-id";
import { createMockContext } from "./helpers";

const inc = handler({
  name: "inc",
  inputSchema: z.number(),
  outputSchema: z.number(),
  execute: (v) => v + 1
});

function runtimeState(): SequencerRuntimeState {
  return {
    stepHistory: [],
    loopCounts: new Map(),
    workTasks: [],
    stateVersion: 0,
    scopeId: "seq_scope_test",
    lastChildPath: undefined,
    lastChildInputHint: undefined,
    activeLoopGeneration: 0
  };
}

describe("runChild", () => {
  it("runs the block and returns its value", async () => {
    const ctx = createMockContext();
    const result = await runChild(ctx, { block: inc }, "step[0]", 1, { kind: "inline", value: 1 });
    expect(result.value).toBe(2);
  });

  it("applies the connector to the input before running the block", async () => {
    const ctx = createMockContext();
    const connector = (v: number): number => v * 10;
    const result = await runChild(ctx, { block: inc, connector }, "step[0]", 4, {
      kind: "inline",
      value: 4
    });
    expect(result.value).toBe(41); // (4 * 10) + 1
  });

  it("falls back to an inline descriptor with no trace emitter (unit-test ctx)", async () => {
    const ctx = createMockContext();
    const result = await runChild(ctx, { block: inc }, "step[0]", 1, { kind: "inline", value: 1 });
    expect(result.descriptor).toEqual({ kind: "inline" });
  });

  it("resolves a ref descriptor when a matching block_trace was emitted", async () => {
    const path = "step[0]";
    const instanceId = buildBlockInstanceId("req_1", path, 0);
    const traceItem = {
      id: "item_trace_1",
      type: "block_trace",
      provenance: { blockInstanceId: instanceId }
    };
    const ctx = createMockContext({
      response: {
        emit: () => undefined,
        getItems: () => [traceItem],
        subscribeToItems: () => () => undefined
      } as unknown as BlockContext["response"]
    });
    const result = await runChild(ctx, { block: inc }, path, 1, { kind: "inline", value: 1 });
    expect(result.descriptor).toEqual({ kind: "ref", sourceItemId: "item_trace_1" });
  });

  it("does not mutate runtime bookkeeping", async () => {
    const ctx = createMockContext();
    // runChild takes no runtime; assert via the stashed input hint instead:
    // the child sees the hint we passed, untouched by any chain pointer logic.
    let seenHint: unknown;
    const probe = handler({
      name: "probe",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (v, c) => {
        seenHint = (c as { _blockInputHint?: unknown })._blockInputHint;
        return v;
      }
    });
    await runChild(ctx, { block: probe }, "step[0]", 7, { kind: "inline", value: 99 });
    expect(seenHint).toEqual({ kind: "inline", value: 99 });
  });
});

describe("runBackground", () => {
  it("pushes a work task and the promise resolves with the child's output", async () => {
    const ctx = createMockContext();
    const runtime = runtimeState();
    const result = await runBackground(ctx, runtime, { block: inc }, "work[0]", 5, "task-a");
    // Pass-through: the sequencer's running value is unchanged.
    expect(result.value).toBe(5);
    expect(runtime.workTasks).toHaveLength(1);
    const settled = await runtime.workTasks[0].promise;
    expect(settled).toEqual({ name: "task-a", status: "fulfilled", value: 6 });
  });

  it("applies the connector before dispatching the background block", async () => {
    const ctx = createMockContext();
    const runtime = runtimeState();
    const connector = (v: number): number => v + 100;
    await runBackground(ctx, runtime, { block: inc, connector }, "work[0]", 1, "task-b");
    const settled = await runtime.workTasks[0].promise;
    expect(settled).toMatchObject({ status: "fulfilled", value: 102 }); // (1 + 100) + 1
  });
});
