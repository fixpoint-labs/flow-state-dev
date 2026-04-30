/**
 * Tests for FIX-480 §3.2 — streaming-text generator emits its `block_output`
 * as a `ref` to the corresponding `message` item rather than an inline copy
 * of the same text.
 *
 * The hint lives on `ctx._blockOutputHint`. Server-side `executeBlock` reads
 * it after `block.run` returns and wraps the BlockValue accordingly. These
 * tests assert the hint write path; end-to-end emission is covered in
 * `packages/server/test/block-value-fix480.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { generator } from "../src";
import type { BlockOutputHint, BlockContext } from "../src/types/block";
import { createMockContext } from "./helpers";

interface CapturingCtx extends BlockContext {
  _blockOutputHint?: BlockOutputHint;
}

function streamingModel(args: {
  textChunks: string[];
  /** Final fullResult.text. If omitted, the joined chunks are used. */
  finalText?: string;
}) {
  return {
    modelId: "mock-stream",
    async generate() {
      return { text: "fallback" };
    },
    async *stream() {
      for (const chunk of args.textChunks) {
        yield { type: "text_delta" as const, textDelta: chunk };
      }
      yield {
        type: "finish" as const,
        fullResult: { text: args.finalText ?? args.textChunks.join("") },
      };
    },
  };
}

describe("FIX-480 generator block_output ref-to-message", () => {
  it("streaming-text generator (sub agent) sets _blockOutputHint to ref the emitted message", async () => {
    const emitted: Array<{ type: string; item?: any }> = [];
    const block = generator({
      name: "ref-streaming",
      agentType: "sub",
      model: "mock-stream",
      prompt: "say hi",
    });

    const ctx = createMockContext({
      resolveModel: () =>
        streamingModel({ textChunks: ["hello", " world"] }) as any,
      response: {
        emit: (event: any) => {
          emitted.push(event);
        },
      },
    }) as CapturingCtx;

    const result = await block.run({}, ctx);
    expect(result).toBe("hello world");

    const messageDone = emitted.find(
      (e) => e.type === "item.done" && e.item?.type === "message",
    );
    expect(messageDone).toBeDefined();

    expect(ctx._blockOutputHint).toEqual({
      kind: "ref",
      sourceItemId: messageDone!.item.id,
    });
  });

  it("does not emit a ref when agentType is undefined (no message emitted)", async () => {
    const block = generator({
      name: "ref-streaming-no-identity",
      // No agentType and no tools — the runtime takes the non-streaming
      // path and skips message emission entirely, so there is nothing to
      // ref. Returns the model.generate() text directly.
      model: "mock-stream",
      prompt: "say hi",
    });

    const ctx = createMockContext({
      resolveModel: () =>
        streamingModel({ textChunks: ["hello"] }) as any,
      response: {
        emit: () => undefined,
      },
    }) as CapturingCtx;

    await block.run({}, ctx);
    expect(ctx._blockOutputHint).toBeUndefined();
  });

  it("does not emit a ref for object-output generators", async () => {
    const block = generator({
      name: "ref-streaming-object",
      agentType: "sub",
      model: "mock-stream",
      outputSchema: z.object({ result: z.string() }),
      prompt: "say hi",
    });

    const ctx = createMockContext({
      resolveModel: () => ({
        modelId: "mock-stream",
        async generate() {
          return { structuredOutput: { result: "ok" } };
        },
        async *stream() {
          yield {
            type: "finish" as const,
            fullResult: { structuredOutput: { result: "ok" } },
          };
        },
      }) as any,
      response: {
        emit: () => undefined,
      },
    }) as CapturingCtx;

    await block.run({}, ctx);
    expect(ctx._blockOutputHint).toBeUndefined();
  });
});
