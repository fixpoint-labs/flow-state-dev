import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { createModelResolver } from "../../src/models/createModelResolver";

function mockProvider() {
  return (modelId: string) =>
    new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: `response:${modelId}` }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: {
            total: 5,
            noCache: 5,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 10, text: 10, reasoning: undefined },
        },
        warnings: [],
      }),
    });
}

const INTENTS = {
  large: [
    "openai/gpt-5.4",
    "anthropic/opus",
    "google/gemini-3",
    "anthropic/sonnet",
  ],
};

const DEFAULT_MODEL = "openai/gpt-5.4";

describe("createModelResolver — providerPreference", () => {
  it("without providerPreference: uses the intent's natural first model", async () => {
    const resolver = createModelResolver({
      intents: INTENTS,
      defaultModel: DEFAULT_MODEL,
      providers: {
        openai: mockProvider(),
        anthropic: mockProvider(),
        google: mockProvider(),
      },
    });
    const model = resolver("intent/large");
    const result = await model.generate({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.text).toBe("response:gpt-5.4");
  });

  it("with providerPreference: moves preferred provider to the front", async () => {
    const resolver = createModelResolver({
      intents: INTENTS,
      defaultModel: DEFAULT_MODEL,
      providerPreference: "anthropic",
      providers: {
        openai: mockProvider(),
        anthropic: mockProvider(),
        google: mockProvider(),
      },
    });
    const model = resolver("intent/large");
    const result = await model.generate({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.text).toBe("response:opus");
  });

  it("with providerPreference array: honors order", async () => {
    const resolver = createModelResolver({
      intents: INTENTS,
      defaultModel: DEFAULT_MODEL,
      providerPreference: ["google", "anthropic"],
      providers: {
        openai: mockProvider(),
        anthropic: mockProvider(),
        google: mockProvider(),
      },
    });
    const model = resolver("intent/large");
    const result = await model.generate({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.text).toBe("response:gemini-3");
  });

  it("soft preference: falls back when preferred provider is unavailable", async () => {
    const resolver = createModelResolver({
      intents: INTENTS,
      defaultModel: DEFAULT_MODEL,
      providerPreference: "anthropic",
      providers: {
        openai: mockProvider(),
        google: mockProvider(),
        // anthropic missing
      },
    });
    const model = resolver("intent/large");
    const result = await model.generate({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.text).toBe("response:gpt-5.4");
  });

  it("per-call preferProvider on the resolver callable overrides construction-time preference", async () => {
    const resolver = createModelResolver({
      intents: INTENTS,
      defaultModel: DEFAULT_MODEL,
      providerPreference: "anthropic",
      providers: {
        openai: mockProvider(),
        anthropic: mockProvider(),
        google: mockProvider(),
      },
    });
    // No call-site override: anthropic wins
    const defaultModel = resolver("intent/large");
    expect((await defaultModel.generate({ messages: [{ role: "user", content: "hi" }] })).text).toBe(
      "response:opus"
    );
    // Per-call override to google
    const overridden = resolver("intent/large", undefined, {
      preferProvider: "google",
    });
    expect((await overridden.generate({ messages: [{ role: "user", content: "hi" }] })).text).toBe(
      "response:gemini-3"
    );
  });

  it("resolveId respects providerPreference", () => {
    const resolver = createModelResolver({
      intents: INTENTS,
      defaultModel: DEFAULT_MODEL,
      providerPreference: "anthropic",
      providers: {
        openai: mockProvider(),
        anthropic: mockProvider(),
        google: mockProvider(),
      },
    });
    expect(resolver.resolveId("intent/large")).toBe("anthropic/opus");
  });

  it("resolveId falls back when preferred provider not configured", () => {
    const resolver = createModelResolver({
      intents: INTENTS,
      defaultModel: DEFAULT_MODEL,
      providerPreference: "anthropic",
      providers: {
        openai: mockProvider(),
        google: mockProvider(),
      },
    });
    expect(resolver.resolveId("intent/large")).toBe("openai/gpt-5.4");
  });

  it("resolveId per-call preferProvider overrides resolver-level providerPreference", () => {
    const resolver = createModelResolver({
      intents: INTENTS,
      defaultModel: DEFAULT_MODEL,
      providerPreference: "anthropic",
      providers: {
        openai: mockProvider(),
        anthropic: mockProvider(),
        google: mockProvider(),
      },
    });
    expect(resolver.resolveId("intent/large")).toBe("anthropic/opus");
    expect(
      resolver.resolveId("intent/large", { preferProvider: "google" })
    ).toBe("google/gemini-3");
    expect(resolver.resolveId("intent/large", { preferProvider: [] })).toBe(
      "openai/gpt-5.4"
    );
  });
});
