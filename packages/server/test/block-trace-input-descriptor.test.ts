/**
 * Tests for FIX-573 §3.3 / §5: per-call-site input descriptors on
 * block_trace items. Verifies that the sequencer wires the correct
 * `input.source` for sequential, fan-in, and forEach element sites.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { BlockTraceItem } from "@flow-state-dev/core/items";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  createInMemoryStores,
  createResponseEmitter,
  runAction
} from "../src";

function getTraces(items: ReadonlyArray<{ type: string }>): BlockTraceItem[] {
  return items.filter((i) => i.type === "block_trace") as BlockTraceItem[];
}

describe("block_trace input descriptor wiring", () => {
  it("sequential .step: child input.source is a ref to the prior step's trace", async () => {
    const stepA = handler({
      name: "step-a",
      inputSchema: z.object({ x: z.number() }),
      outputSchema: z.object({ y: z.number() }),
      execute: (input) => ({ y: input.x + 1 })
    });
    const stepB = handler({
      name: "step-b",
      inputSchema: z.object({ y: z.number() }),
      outputSchema: z.object({ z: z.number() }),
      execute: (input) => ({ z: input.y + 1 })
    });

    const pipeline = sequencer({
      name: "seq-then",
      inputSchema: z.object({ x: z.number() })
    })
      .step(stepA)
      .step(stepB);

    const flow = defineFlow({
      kind: "input-desc-then-flow",
      actions: {
        run: {
          inputSchema: z.object({ x: z.number() }),
          block: pipeline
        }
      }
    })();

    const stores = createInMemoryStores();
    const response = createResponseEmitter({ requestId: "req_1", now: () => Date.now() });
    await runAction({
      flow,
      actionName: "run",
      input: { x: 1 },
      userId: "u",
      sessionId: "s",
      stores,
      responseEmitter: response
    });

    const traces = getTraces(response.getItems());
    const traceA = traces.find((t) => t.blockName === "step-a");
    const traceB = traces.find((t) => t.blockName === "step-b");
    expect(traceA).toBeDefined();
    expect(traceB).toBeDefined();
    // Step A is the sequencer head — input is inline with the raw input value.
    expect(traceA!.input?.source.kind).toBe("inline");
    // Step B follows step A — its input source is a ref to step A's trace.
    expect(traceB!.input?.source.kind).toBe("ref");
    if (traceB!.input?.source.kind === "ref") {
      expect(traceB!.input.source.sourceItemId).toBe(traceA!.id);
    }
  });

  it("fan-in .stepAll: branch inputs share the upstream ref; downstream sees a structure", async () => {
    const head = handler({
      name: "head",
      inputSchema: z.object({ x: z.number() }),
      outputSchema: z.object({ x: z.number() }),
      execute: (input) => input
    });
    const left = handler({
      name: "branch-left",
      inputSchema: z.object({ x: z.number() }),
      outputSchema: z.object({ l: z.number() }),
      execute: (input) => ({ l: input.x })
    });
    const right = handler({
      name: "branch-right",
      inputSchema: z.object({ x: z.number() }),
      outputSchema: z.object({ r: z.number() }),
      execute: (input) => ({ r: input.x })
    });
    const after = handler({
      name: "after",
      inputSchema: z.any(),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true })
    });

    const pipeline = sequencer({
      name: "seq-thenall",
      inputSchema: z.object({ x: z.number() })
    })
      .step(head)
      .stepAll([left, right])
      .step(after);

    const flow = defineFlow({
      kind: "input-desc-thenall-flow",
      actions: {
        run: {
          inputSchema: z.object({ x: z.number() }),
          block: pipeline
        }
      }
    })();

    const stores = createInMemoryStores();
    const response = createResponseEmitter({ requestId: "req_2", now: () => Date.now() });
    await runAction({
      flow,
      actionName: "run",
      input: { x: 7 },
      userId: "u",
      sessionId: "s",
      stores,
      responseEmitter: response
    });

    const traces = getTraces(response.getItems());
    const headT = traces.find((t) => t.blockName === "head");
    const leftT = traces.find((t) => t.blockName === "branch-left");
    const rightT = traces.find((t) => t.blockName === "branch-right");
    const afterT = traces.find((t) => t.blockName === "after");
    expect(headT).toBeDefined();
    expect(leftT).toBeDefined();
    expect(rightT).toBeDefined();
    expect(afterT).toBeDefined();

    // Both branches see the same upstream ref (head's trace).
    expect(leftT!.input?.source.kind).toBe("ref");
    expect(rightT!.input?.source.kind).toBe("ref");
    if (leftT!.input?.source.kind === "ref" && rightT!.input?.source.kind === "ref") {
      expect(leftT!.input.source.sourceItemId).toBe(headT!.id);
      expect(rightT!.input.source.sourceItemId).toBe(headT!.id);
    }

    // Downstream `after` sees a structure aggregating both branch refs.
    expect(afterT!.input?.source.kind).toBe("structure");
    if (afterT!.input?.source.kind === "structure") {
      expect(afterT!.input.source.shape.container).toBe("array");
      const entries = afterT!.input.source.shape.entries;
      expect(Array.isArray(entries)).toBe(true);
      const refIds = (entries as Array<{ kind: string; sourceItemId?: string }>).map(
        (e) => e.sourceItemId
      );
      expect(refIds).toContain(leftT!.id);
      expect(refIds).toContain(rightT!.id);
    }
  });

  it("forEach: each iteration's child input.source is inline with the element value", async () => {
    const square = handler({
      name: "square",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (n) => n * n
    });

    const pipeline = sequencer({
      name: "seq-foreach",
      inputSchema: z.array(z.number())
    }).forEach(square);

    const flow = defineFlow({
      kind: "input-desc-foreach-flow",
      actions: {
        run: {
          inputSchema: z.array(z.number()),
          block: pipeline
        }
      }
    })();

    const stores = createInMemoryStores();
    const response = createResponseEmitter({ requestId: "req_3", now: () => Date.now() });
    await runAction({
      flow,
      actionName: "run",
      input: [2, 3],
      userId: "u",
      sessionId: "s",
      stores,
      responseEmitter: response
    });

    const traces = getTraces(response.getItems());
    const squareTraces = traces.filter((t) => t.blockName === "square");
    expect(squareTraces.length).toBe(2);
    // Each iteration's input.source is inline with the element value.
    const inlineValues = squareTraces.map((t) =>
      t.input?.source.kind === "inline" ? (t.input.source as { kind: "inline"; value: unknown }).value : undefined
    );
    expect(inlineValues).toEqual(expect.arrayContaining([2, 3]));
  });
});
