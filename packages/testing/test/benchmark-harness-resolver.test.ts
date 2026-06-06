import { describe, expect, it } from "vitest";
import { generator, sequencer } from "@flow-state-dev/core";
import type { GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import { z } from "zod";
import { testBlock } from "../src/test-utilities/testBlock";
import { testSequencer } from "../src/test-utilities/testSequencer";

// ---------------------------------------------------------------------------
// Regression guard: an injected real `modelResolver` must route
// generation instead of the default scripted mock resolver. The benchmark
// engine relies on this to drive every subject through a single resolver.
// ---------------------------------------------------------------------------

function makeFakeResolver(text: string): { resolver: ModelResolver; calls: string[] } {
  const calls: string[] = [];
  const resolver = ((modelId: string, blockName?: string): GeneratorModel => {
    calls.push(`${modelId}::${blockName ?? ""}`);
    return {
      modelId,
      async generate() {
        return { text, finishReason: "stop" };
      },
      async *stream() {
        yield { type: "text_delta", textDelta: text };
        yield { type: "finish", finishReason: "stop", fullResult: { text, finishReason: "stop" } };
      }
    };
  }) as ModelResolver;
  resolver.resolveId = (modelId: string) => modelId;
  return { resolver, calls };
}

describe("testBlock modelResolver injection", () => {
  it("routes generation through an injected resolver", async () => {
    const { resolver, calls } = makeFakeResolver("from-injected-resolver");

    const block = generator({
      name: "answerer",
      model: "openai/gpt-5.4-mini",
      inputSchema: z.object({ prompt: z.string() }),
      prompt: (input: { prompt: string }) => input.prompt
    });

    const result = await testBlock(block, {
      input: { prompt: "hello" },
      modelResolver: resolver
    });

    expect(result.error).toBeNull();
    expect(result.output).toBe("from-injected-resolver");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toContain("answerer");
  });

  it("routes a sequencer's generation through an injected resolver", async () => {
    const { resolver } = makeFakeResolver("seq-answer");

    const subject = sequencer({
      name: "seq-subject",
      inputSchema: z.object({ prompt: z.string() }),
      stateSchema: z.record(z.string(), z.unknown())
    }).step(
      generator({
        name: "seq-answerer",
        model: "openai/gpt-5.4-mini",
        inputSchema: z.object({ prompt: z.string() }),
        prompt: (input: { prompt: string }) => input.prompt
      })
    );

    const result = await testSequencer(subject, {
      input: { prompt: "hi" },
      modelResolver: resolver
    });

    expect(result.error).toBeNull();
    expect(result.output).toBe("seq-answer");
  });
});
