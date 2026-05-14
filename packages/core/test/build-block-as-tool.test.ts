/**
 * Tests for `BlockDefinition.asTool()` (FIX-593). Verifies that wrapping a
 * block with `.asTool()` and executing it from a sequencer step emits the
 * same `tool_output` envelope shape and lifecycle the AI SDK tool-loop
 * wrapper produces inside a generator.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  generator,
  handler,
  router,
  sequencer,
} from "../src";
import type { BlockContext } from "../src/types/block";
import { createMockContext, runForTest } from "./helpers";

type Emitted = { type: string; item?: any; id?: string; patch?: any };

function ctxWithRecorder(extra?: Partial<BlockContext>): {
  ctx: BlockContext;
  emitted: Emitted[];
} {
  const emitted: Emitted[] = [];
  const ctx = createMockContext({
    response: {
      emit: (event: unknown) => {
        emitted.push(event as Emitted);
      },
      // duck-typed getItems used by getEmitterItemCount for itemIndex.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getItems: () =>
        emitted
          .filter((e) => e.type === "item.added")
          .map((e) => e.item as unknown),
    } as any,
    ...extra,
  });
  return { ctx, emitted };
}

const toolOutputsOf = (emitted: Emitted[]) =>
  emitted
    .filter((e) => e.type === "item.added" && e.item?.type === "tool_output")
    .map((e) => e.item);

describe("BlockDefinition.asTool", () => {
  it("emits a single completed tool_output when run inside a sequencer step", async () => {
    const inner = handler({
      name: "lookup",
      inputSchema: z.object({ q: z.string() }),
      outputSchema: z.object({ answer: z.string() }),
      execute: (input) => ({ answer: `result:${input.q}` }),
    });

    const seq = sequencer({
      name: "prefetch",
      inputSchema: z.object({ q: z.string() }),
    }).then(inner.asTool());

    const { ctx, emitted } = ctxWithRecorder();
    const output = await runForTest(seq, { q: "hello" }, ctx);
    expect(output).toEqual({ answer: "result:hello" });

    const items = toolOutputsOf(emitted);
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.blockName).toBe("lookup");
    expect(item.toolCall.name).toBe("lookup");
    expect(item.toolCall.alias).toBe("lookup");
    expect(item.toolCall.callId).toMatch(/^call_/);
    expect(item.toolCall.arguments).toBe(JSON.stringify({ q: "hello" }));
    expect(item.toolCall.generatorBlock).toBeDefined();

    // Lifecycle: item.added, item.updated (completed), item.done.
    const tool_output_events = emitted.filter(
      (e) =>
        (e.type === "item.added" && e.item?.type === "tool_output") ||
        (e.type === "item.updated" && e.id === item.id) ||
        (e.type === "item.done" && e.item?.id === item.id)
    );
    expect(tool_output_events.map((e) => e.type)).toEqual([
      "item.added",
      "item.updated",
      "item.done",
    ]);
    const updatePatch = tool_output_events[1]!.patch;
    expect(updatePatch.status).toBe("completed");
    expect(updatePatch.output).toEqual({ answer: "result:hello" });
  });

  it("sanitises the wrapped block's name into toolCall.alias", async () => {
    const namespaced = handler({
      name: "tf.memory/recall",
      inputSchema: z.object({ q: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    });

    const seq = sequencer({
      name: "ns",
      inputSchema: z.object({ q: z.string() }),
    }).then(namespaced.asTool());

    const { ctx, emitted } = ctxWithRecorder();
    await runForTest(seq, { q: "x" }, ctx);

    const item = toolOutputsOf(emitted)[0];
    expect(item.toolCall.name).toBe("tf.memory/recall");
    expect(item.toolCall.alias).toBe("tf_memory_recall");
    expect(item.toolCall.alias).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  it("flips tool_output to failed and rethrows when the inner block throws", async () => {
    const boom = handler({
      name: "boom",
      inputSchema: z.object({ q: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => {
        throw new Error("kaboom");
      },
    });

    const seq = sequencer({
      name: "fail-prefetch",
      inputSchema: z.object({ q: z.string() }),
    }).then(boom.asTool());

    const { ctx, emitted } = ctxWithRecorder();
    await expect(runForTest(seq, { q: "x" }, ctx)).rejects.toThrow("kaboom");

    const item = toolOutputsOf(emitted)[0];
    expect(item.status).toBe("failed");
    expect(item.error.message).toBe("kaboom");

    // The patch sent on update reflects the failure shape.
    const update = emitted.find(
      (e) => e.type === "item.updated" && e.id === item.id
    );
    expect(update?.patch?.status).toBe("failed");
    expect(update?.patch?.error?.message).toBe("kaboom");
  });

  it("stamps agentType/agentName from opts onto the emitted item", async () => {
    const inner = handler({
      name: "lookup",
      inputSchema: z.object({ q: z.string() }),
      outputSchema: z.object({ a: z.string() }),
      execute: (input) => ({ a: input.q }),
    });

    const seq = sequencer({
      name: "attr",
      inputSchema: z.object({ q: z.string() }),
    }).then(inner.asTool({ agentType: "sub", agentName: "fundamentals" }));

    const { ctx, emitted } = ctxWithRecorder();
    await runForTest(seq, { q: "x" }, ctx);

    const item = toolOutputsOf(emitted)[0];
    expect(item.agentType).toBe("sub");
    expect(item.agentName).toBe("fundamentals");
  });

  it("omits agentType/agentName when neither opts nor ctx supply them", async () => {
    const inner = handler({
      name: "lookup",
      inputSchema: z.object({ q: z.string() }),
      outputSchema: z.object({ a: z.string() }),
      execute: () => ({ a: "ok" }),
    });

    const seq = sequencer({
      name: "no-attr",
      inputSchema: z.object({ q: z.string() }),
    }).then(inner.asTool());

    const { ctx, emitted } = ctxWithRecorder();
    await runForTest(seq, { q: "x" }, ctx);

    const item = toolOutputsOf(emitted)[0];
    expect(item.agentType).toBeUndefined();
    expect(item.agentName).toBeUndefined();
  });

  it("emits one tool_output per branch when used inside .parallel()", async () => {
    const make = (name: string, delta: number) =>
      handler({
        name,
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: (value) => value + delta,
      });

    const a = make("a", 1);
    const b = make("b", 2);
    const c = make("c", 3);

    const seq = sequencer({ name: "p", inputSchema: z.number() }).parallel({
      a: a.asTool(),
      b: b.asTool(),
      c: c.asTool(),
    });

    const { ctx, emitted } = ctxWithRecorder();
    const out = await runForTest(seq, 10, ctx);
    expect(out).toEqual({ a: 11, b: 12, c: 13 });

    const items = toolOutputsOf(emitted);
    expect(items).toHaveLength(3);
    const callIds = items.map((i) => i.toolCall.callId);
    expect(new Set(callIds).size).toBe(3);
    const itemIndexes = items.map((i) => i.itemIndex);
    expect(new Set(itemIndexes).size).toBe(3);
    expect(items.map((i) => i.blockName).sort()).toEqual(["a", "b", "c"]);
  });

  it("sets _blockOutputHint=ref on the inner ctx so its block_trace points at the tool_output", async () => {
    let observedHint: unknown;
    let observedItemId: string | undefined;
    const inner = handler({
      name: "probe",
      inputSchema: z.object({ q: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: (_input, ctx) => {
        observedHint = (ctx as any)._blockOutputHint;
        return { ok: true };
      },
    });

    const seq = sequencer({
      name: "probe-seq",
      inputSchema: z.object({ q: z.string() }),
    }).then(inner.asTool());

    const { ctx, emitted } = ctxWithRecorder();
    await runForTest(seq, { q: "x" }, ctx);
    observedItemId = toolOutputsOf(emitted)[0].id;

    expect(observedHint).toEqual({ kind: "ref", sourceItemId: observedItemId });
  });

  it("exists on every block kind and emits one tool_output when invoked", async () => {
    const h = handler({
      name: "h",
      inputSchema: z.object({ q: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    });
    expect(typeof h.asTool).toBe("function");

    const s = sequencer({
      name: "s",
      inputSchema: z.object({ q: z.string() }),
    }).then(h);
    expect(typeof s.asTool).toBe("function");

    const hitRoute = handler({
      name: "hit",
      inputSchema: z.object({ q: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    });
    const r = router({
      name: "r",
      routes: [hitRoute],
      execute: () => hitRoute,
    });
    expect(typeof r.asTool).toBe("function");

    const g = generator({
      name: "g",
      model: "m",
      prompt: "p",
      outputSchema: z.object({ ok: z.boolean() }),
    });
    expect(typeof g.asTool).toBe("function");

    // Smoke-run the sequencer and router wrappers from a parallel step.
    const parallelSeq = sequencer({
      name: "smoke",
      inputSchema: z.object({ q: z.string() }),
    }).parallel({
      seq: s.asTool(),
      rtr: r.asTool(),
    });

    const { ctx, emitted } = ctxWithRecorder();
    await runForTest(parallelSeq, { q: "x" }, ctx);
    const items = toolOutputsOf(emitted);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.blockName).sort()).toEqual(["r", "s"]);
  });
});
