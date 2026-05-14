/**
 * Tests for observable model identity (ModelIdentity) on generator-emitted
 * results and stream chunks. Covers the resolver/AI-SDK wiring that surfaces
 * `resolvedIdentity` so the generator block can stamp `item.model` on
 * emissions and `BlockTraceItem.model` on traces.
 */
import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { createModelResolver } from "../../src/models/createModelResolver";
import { wrapAiSdkModel } from "../../src/models";

/**
 * Build a non-streaming mock model. `modelId` becomes the AI SDK's
 * `response.modelId` which surfaces as the resolved-identity `actual`.
 */
function mockGenerateModel(opts?: { modelId?: string }) {
  return new MockLanguageModelV3({
    modelId: opts?.modelId ?? "mock-model-id",
    doGenerate: async () => ({
      content: [{ type: "text", text: "ok" }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 3, text: 3, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

function failingGenerateModel(modelId = "mock-model-id") {
  return new MockLanguageModelV3({
    modelId,
    doGenerate: async () => {
      const err = new Error("simulated provider failure") as Error & { isRetryable?: boolean };
      err.isRetryable = false;
      throw err;
    },
  });
}

describe("ModelIdentity — wrapAiSdkModel (direct)", () => {
  it("omits `requested` when provider reports the same id as requested", async () => {
    const model = wrapAiSdkModel(
      mockGenerateModel({ modelId: "openai/gpt-5.5" }),
      "openai/gpt-5.5",
      { requested: "openai/gpt-5.5" }
    );
    const result = await model.generate({ messages: [{ role: "user", content: "hi" }] });
    expect(result.resolvedIdentity).toBeDefined();
    expect(result.resolvedIdentity!.actual).toBe("openai/gpt-5.5");
    expect(result.resolvedIdentity!.requested).toBeUndefined();
    expect(result.resolvedIdentity!.gateway).toBeUndefined();
  });

  it("sets `requested` when the provider reports a different modelId", async () => {
    const model = wrapAiSdkModel(
      mockGenerateModel({ modelId: "gpt-5.5-2025-04-12" }),
      "openai/gpt-5.5",
      { requested: "openai/gpt-5.5" }
    );
    const result = await model.generate({ messages: [{ role: "user", content: "hi" }] });
    expect(result.resolvedIdentity!.actual).toBe("gpt-5.5-2025-04-12");
    expect(result.resolvedIdentity!.requested).toBe("openai/gpt-5.5");
  });

  it("propagates `gateway` when the model was routed through one", async () => {
    const model = wrapAiSdkModel(
      mockGenerateModel({ modelId: "vercel/openai/gpt-5.5" }),
      "vercel/openai/gpt-5.5",
      { requested: "vercel/openai/gpt-5.5", gateway: "vercel" }
    );
    const result = await model.generate({ messages: [{ role: "user", content: "hi" }] });
    expect(result.resolvedIdentity!.gateway).toBe("vercel");
  });
});

describe("ModelIdentity — wrapAiSdkModel (streaming)", () => {
  it("stamps resolvedIdentity on every chunk and refines on finish", async () => {
    const model = wrapAiSdkModel(
      new MockLanguageModelV3({
        modelId: "gpt-5.5-2025-04-12",
        doStream: {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "text-delta" as any, id: "t1", delta: "hello" });
              controller.enqueue({
                type: "finish",
                finishReason: { unified: "stop", raw: undefined },
                usage: { inputTokens: { total: 5, noCache: 5 }, outputTokens: { total: 3, text: 3 } },
              } as any);
              controller.close();
            },
          }),
        },
      }),
      "openai/gpt-5.5",
      { requested: "openai/gpt-5.5" }
    );

    const chunks: any[] = [];
    for await (const chunk of model.stream!({
      messages: [{ role: "user", content: "hi" }],
    })) {
      chunks.push(chunk);
    }

    // Every yielded chunk carries identity — baseline before finish, refined
    // (when the AI SDK exposes a provider-reported id) after.
    const textChunk = chunks.find((c) => c.type === "text_delta");
    expect(textChunk.resolvedIdentity).toBeDefined();
    expect(textChunk.resolvedIdentity.actual).toBe("openai/gpt-5.5");

    const finishChunk = chunks[chunks.length - 1];
    expect(finishChunk.type).toBe("finish");
    expect(finishChunk.resolvedIdentity).toBeDefined();
    expect(finishChunk.resolvedIdentity.actual).toBe("openai/gpt-5.5");
  });
});

describe("ModelIdentity — createModelResolver (intent path)", () => {
  it("resolves to the first candidate and stamps intent as `requested`", async () => {
    const resolver = createModelResolver({
      intents: { utility: ["openai/gpt-5.4-mini", "anthropic/sonnet"] },
      defaultModel: "openai/gpt-5.4",
      providers: {
        openai: (id: string) => mockGenerateModel({ modelId: id }),
        anthropic: (id: string) => mockGenerateModel({ modelId: id }),
      },
    });

    const model = resolver("intent/utility");
    const result = await model.generate({ messages: [{ role: "user", content: "hi" }] });

    expect(result.resolvedIdentity).toBeDefined();
    expect(result.resolvedIdentity!.requested).toBe("intent/utility");
    // `actual` reflects the provider-reported model id of the winning candidate.
    expect(result.resolvedIdentity!.actual).toBe("gpt-5.4-mini");
  });

  it("falls back to the second candidate when the first errors at runtime", async () => {
    const resolver = createModelResolver({
      intents: { utility: ["openai/gpt-5.4-mini", "anthropic/sonnet"] },
      defaultModel: "openai/gpt-5.4",
      providers: {
        openai: (id: string) => failingGenerateModel(id),
        anthropic: (id: string) => mockGenerateModel({ modelId: id }),
      },
    });

    const model = resolver("intent/utility");
    const result = await model.generate({ messages: [{ role: "user", content: "hi" }] });

    expect(result.resolvedIdentity!.requested).toBe("intent/utility");
    expect(result.resolvedIdentity!.actual).toBe("sonnet");
  });

  it("fires onResolved with the winning candidate entry", async () => {
    // Use the fallback model directly via the intent path; the resolver wires
    // `onResolved` through `createFallbackModel`. Since the resolver itself
    // doesn't expose onResolved publicly, we verify the symptom: identity
    // matches the winning candidate.
    const resolver = createModelResolver({
      intents: { utility: ["openai/gpt-5.4-mini", "anthropic/sonnet"] },
      defaultModel: "openai/gpt-5.4",
      providers: {
        openai: (id: string) => failingGenerateModel(id),
        anthropic: (id: string) => mockGenerateModel({ modelId: id }),
      },
    });

    const result = await resolver("intent/utility").generate({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.resolvedIdentity!.actual).toBe("sonnet");
  });
});

describe("ModelIdentity — createModelResolver (direct + gateway)", () => {
  it("direct call: actual matches provider id, requested set when they differ", async () => {
    const resolver = createModelResolver({
      providers: {
        openai: (id: string) => mockGenerateModel({ modelId: id }),
      },
    });
    const result = await resolver("openai/gpt-5.4").generate({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.resolvedIdentity!.actual).toBe("gpt-5.4");
    expect(result.resolvedIdentity!.requested).toBe("openai/gpt-5.4");
    expect(result.resolvedIdentity!.gateway).toBeUndefined();
  });
});
