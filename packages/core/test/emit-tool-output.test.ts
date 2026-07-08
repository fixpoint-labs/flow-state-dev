/**
 * `tool_output` envelope stamping for FIX-814:
 *  - a suspending tool's FAILED output carries `error.code === "SUSPENSION"`;
 *  - a successful call records the adapter's disambiguated `alias` and the
 *    settle-time `modelOutput` (mapper applied once, never recomputed).
 */
import { describe, it, expect } from "vitest";
import type { BlockContext, BlockDefinition } from "../src/types/block";
import { emitToolOutputAround } from "../src/blocks/internal/emit-tool-output";
import { SuspensionError } from "../src/errors/suspension-error";

type Emitted = { type: string; item?: any; patch?: any };

function makeCtx(): { ctx: BlockContext; emitted: Emitted[] } {
  const emitted: Emitted[] = [];
  const ctx = {
    request: { identity: { id: "req1" } },
    _blockIdentity: { blockName: "gen", blockInstanceId: "req1:root:0", phase: "main" },
    response: {
      emit: (e: unknown) => {
        emitted.push(e as Emitted);
      },
      getItems: () => emitted.filter((e) => e.item).map((e) => e.item),
    },
  } as unknown as BlockContext;
  return { ctx, emitted };
}

const block = { name: "tf.memory/recall" } as BlockDefinition<any, any>;

describe("emitToolOutputAround (FIX-814)", () => {
  it("records the disambiguated alias and settle-time modelOutput on success", async () => {
    const { ctx, emitted } = makeCtx();
    const out = await emitToolOutputAround(
      block,
      ctx,
      { q: "x" },
      {
        callId: "c1",
        generatorBlock: "gen",
        alias: "tf_memory_recall_2",
        mapModelOutput: (o) => `mapped:${JSON.stringify(o)}`,
      },
      async () => ({ hits: 3 }),
    );

    expect(out).toEqual({ hits: 3 });
    const done = emitted.find((e) => e.type === "item.done")!;
    expect(done.item.status).toBe("completed");
    expect(done.item.toolCall.alias).toBe("tf_memory_recall_2");
    // Raw structured output preserved on `output`; the model-facing mapped
    // value persisted on `modelOutput`.
    expect(done.item.output).toEqual({ hits: 3 });
    expect(done.item.modelOutput).toBe('mapped:{"hits":3}');
  });

  it("modelOutput falls back to raw output when no mapper is declared", async () => {
    const { ctx, emitted } = makeCtx();
    await emitToolOutputAround(
      block,
      ctx,
      {},
      { callId: "c1", generatorBlock: "gen", alias: "tf_memory_recall" },
      async () => "plain",
    );
    const done = emitted.find((e) => e.type === "item.done")!;
    expect(done.item.modelOutput).toBe("plain");
  });

  it("stamps error.code SUSPENSION when the tool throws a SuspensionError", async () => {
    const { ctx, emitted } = makeCtx();
    await expect(
      emitToolOutputAround(
        block,
        ctx,
        {},
        { callId: "c1", generatorBlock: "gen", alias: "tf_memory_recall" },
        async () => {
          throw new SuspensionError({ suspensionId: "s1", reason: "approval" });
        },
      ),
    ).rejects.toBeInstanceOf(SuspensionError);

    const done = emitted.find((e) => e.type === "item.done")!;
    expect(done.item.status).toBe("failed");
    expect(done.item.error.code).toBe("SUSPENSION");
  });

  it("does NOT stamp SUSPENSION for an ordinary tool error", async () => {
    const { ctx, emitted } = makeCtx();
    await expect(
      emitToolOutputAround(
        block,
        ctx,
        {},
        { callId: "c1", generatorBlock: "gen", alias: "tf_memory_recall" },
        async () => {
          throw new Error("boom");
        },
      ),
    ).rejects.toThrow("boom");

    const done = emitted.find((e) => e.type === "item.done")!;
    expect(done.item.status).toBe("failed");
    expect(done.item.error.code).toBeUndefined();
  });

  it("legacy path (no alias supplied) falls back to sanitized block name", async () => {
    const { ctx, emitted } = makeCtx();
    await emitToolOutputAround(
      block,
      ctx,
      {},
      { callId: "c1", generatorBlock: "gen" },
      async () => "ok",
    );
    const done = emitted.find((e) => e.type === "item.done")!;
    // sanitizeToolName("tf.memory/recall") — the pre-FIX-814 behavior.
    expect(done.item.toolCall.alias).toBe("tf_memory_recall");
  });
});
