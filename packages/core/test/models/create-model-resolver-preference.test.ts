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

const PRESETS = {
  large: {
    models: [
      "openai/gpt-5.4",
      "anthropic/opus",
      "google/gemini-3",
      "anthropic/sonnet",
    ],
  },
};

describe("createModelResolver — providerPreference", () => {
  it("without providerPreference: uses the preset's natural first model", async () => {
    const resolver = createModelResolver({
      presets: PRESETS,
      providers: {
        openai: mockProvider(),
        anthropic: mockProvider(),
        google: mockProvider(),
      },
    });
    const model = resolver("preset/large");
    const result = await model.generate({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.text).toBe("response:gpt-5.4");
  });

  it("with providerPreference: moves preferred provider to the front", async () => {
    const resolver = createModelResolver({
      presets: PRESETS,
      providerPreference: "anthropic",
      providers: {
        openai: mockProvider(),
        anthropic: mockProvider(),
        google: mockProvider(),
      },
    });
    const model = resolver("preset/large");
    const result = await model.generate({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.text).toBe("response:opus");
  });

  it("with providerPreference array: honors order", async () => {
    const resolver = createModelResolver({
      presets: PRESETS,
      providerPreference: ["google", "anthropic"],
      providers: {
        openai: mockProvider(),
        anthropic: mockProvider(),
        google: mockProvider(),
      },
    });
    const model = resolver("preset/large");
    const result = await model.generate({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.text).toBe("response:gemini-3");
  });

  it("soft preference: falls back when preferred provider is unavailable", async () => {
    const resolver = createModelResolver({
      presets: PRESETS,
      providerPreference: "anthropic",
      providers: {
        openai: mockProvider(),
        google: mockProvider(),
        // anthropic missing
      },
    });
    const model = resolver("preset/large");
    const result = await model.generate({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.text).toBe("response:gpt-5.4");
  });

  it("resolveId respects providerPreference", () => {
    const resolver = createModelResolver({
      presets: PRESETS,
      providerPreference: "anthropic",
      providers: {
        openai: mockProvider(),
        anthropic: mockProvider(),
        google: mockProvider(),
      },
    });
    expect(resolver.resolveId("preset/large")).toBe("anthropic/opus");
  });

  it("resolveId falls back when preferred provider not configured", () => {
    const resolver = createModelResolver({
      presets: PRESETS,
      providerPreference: "anthropic",
      providers: {
        openai: mockProvider(),
        google: mockProvider(),
      },
    });
    expect(resolver.resolveId("preset/large")).toBe("openai/gpt-5.4");
  });

  it("resolveId per-call prefer overrides resolver-level providerPreference", () => {
    const resolver = createModelResolver({
      presets: PRESETS,
      providerPreference: "anthropic",
      providers: {
        openai: mockProvider(),
        anthropic: mockProvider(),
        google: mockProvider(),
      },
    });
    // Default uses provider-level "anthropic"
    expect(resolver.resolveId("preset/large")).toBe("anthropic/opus");
    // Call-site override to "google"
    expect(resolver.resolveId("preset/large", { prefer: "google" })).toBe(
      "google/gemini-3",
    );
    // Explicit empty array → no preference, natural order wins
    expect(resolver.resolveId("preset/large", { prefer: [] })).toBe(
      "openai/gpt-5.4",
    );
  });
});
