import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { createFSDProvider, defaultGroups } from "../../src/models/createFSDProvider";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockProvider() {
  return (modelId: string) =>
    new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: `response:${modelId}` }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 10, text: 10, reasoning: undefined },
        },
        warnings: [],
      }),
    });
}

// ---------------------------------------------------------------------------
// defaultGroups
// ---------------------------------------------------------------------------

describe("defaultGroups", () => {
  it("has fast, thinking, and balanced groups", () => {
    expect(Object.keys(defaultGroups)).toEqual(["fast", "thinking", "balanced"]);
  });

  it("fast group has correct model order", () => {
    expect(defaultGroups.fast!.models).toEqual([
      "anthropic:claude-sonnet-4.6",
      "openai:gpt-5.4-mini",
      "google:gemini-3-flash",
    ]);
  });

  it("fast group sets maxTokens default", () => {
    expect(defaultGroups.fast!.defaults?.maxTokens).toBe(1024);
  });

  it("thinking group has anthropic providerOptions", () => {
    expect(
      defaultGroups.thinking!.defaults?.providerOptions?.anthropic
    ).toEqual({ thinking: { budgetTokens: 10000 } });
  });

  it("balanced group has no defaults", () => {
    expect(defaultGroups.balanced!.defaults).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// createFSDProvider
// ---------------------------------------------------------------------------

describe("createFSDProvider", () => {
  it("resolves a group to a GeneratorModel", () => {
    const provider = createFSDProvider({
      groups: {
        fast: { models: ["openai:gpt-4o-mini"] },
      },
      providers: { openai: createMockProvider() },
    });

    const model = provider("fast");
    expect(model.modelId).toBe("fsd:fast");
  });

  it("provider.languageModel is the same as calling provider()", () => {
    const provider = createFSDProvider({
      groups: { fast: { models: ["openai:gpt-4o-mini"] } },
      providers: { openai: createMockProvider() },
    });

    const a = provider("fast");
    const b = provider.languageModel("fast");
    expect(a).toBe(b); // same cached instance
  });

  it("throws for unknown group name", () => {
    const provider = createFSDProvider({
      groups: { fast: { models: ["openai:gpt-4o-mini"] } },
      providers: { openai: createMockProvider() },
    });

    expect(() => provider("nonexistent")).toThrow(
      'Unknown model group "nonexistent"'
    );
  });

  it("throws when no models in group are available", () => {
    const provider = createFSDProvider({
      groups: {
        fast: { models: ["anthropic:claude-haiku"] },
      },
      providers: { openai: createMockProvider() }, // no anthropic provider
    });

    expect(() => provider("fast")).toThrow("has no available models");
  });

  it("groups() lists all group names", () => {
    const provider = createFSDProvider({
      groups: {
        fast: { models: ["openai:gpt-4o-mini"] },
        slow: { models: ["openai:gpt-4o"] },
      },
      providers: { openai: createMockProvider() },
    });

    expect(provider.groups()).toEqual(["fast", "slow"]);
  });

  it("available() returns models with matching providers", () => {
    const provider = createFSDProvider({
      groups: {
        fast: {
          models: [
            "anthropic:claude-haiku",
            "openai:gpt-4o-mini",
            "google:gemini-2.0-flash",
          ],
        },
      },
      providers: { openai: createMockProvider() },
    });

    // Only openai is available since that's the only provider passed
    expect(provider.available("fast")).toEqual(["openai:gpt-4o-mini"]);
  });

  it("available() returns empty for unknown group", () => {
    const provider = createFSDProvider({
      groups: { fast: { models: ["openai:gpt-4o-mini"] } },
      providers: { openai: createMockProvider() },
    });

    expect(provider.available("nonexistent")).toEqual([]);
  });

  it("caches group resolution", () => {
    const provider = createFSDProvider({
      groups: { fast: { models: ["openai:gpt-4o-mini"] } },
      providers: { openai: createMockProvider() },
    });

    const a = provider("fast");
    const b = provider("fast");
    expect(a).toBe(b);
  });

  it("generate works end-to-end with mock provider", async () => {
    const provider = createFSDProvider({
      groups: { fast: { models: ["openai:gpt-4o-mini"] } },
      providers: { openai: createMockProvider() },
    });

    const model = provider("fast");
    const result = await model.generate({
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.text).toBe("response:gpt-4o-mini");
    expect(result.finishReason).toBe("stop");
  });

  it("supports provider objects with .languageModel method", () => {
    const providerObj = {
      languageModel: createMockProvider(),
    };

    const provider = createFSDProvider({
      groups: { fast: { models: ["custom:model-a"] } },
      providers: { custom: providerObj },
    });

    const model = provider("fast");
    expect(model.modelId).toBe("fsd:fast");
  });

  it("users can spread and override default groups", () => {
    const provider = createFSDProvider({
      groups: {
        ...defaultGroups,
        fast: {
          models: ["openai:gpt-4o-mini"],
          defaults: { maxTokens: 512 },
        },
        coding: {
          models: ["openai:codex-mini"],
          defaults: { maxTokens: 4096 },
        },
      },
      providers: { openai: createMockProvider() },
    });

    expect(provider.groups()).toContain("fast");
    expect(provider.groups()).toContain("thinking");
    expect(provider.groups()).toContain("balanced");
    expect(provider.groups()).toContain("coding");
  });

  it("skips models whose provider is not configured", async () => {
    const openaiMock = createMockProvider();

    const provider = createFSDProvider({
      groups: {
        fast: {
          models: [
            "anthropic:claude-haiku", // not available
            "openai:gpt-4o-mini",     // available
          ],
        },
      },
      providers: { openai: openaiMock },
    });

    const result = await provider("fast").generate({
      messages: [{ role: "user", content: "test" }],
    });

    // Should have skipped anthropic and used openai
    expect(result.text).toBe("response:gpt-4o-mini");
  });
});
