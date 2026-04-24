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
      "anthropic/claude-sonnet-4-6",
      "openai/gpt-5.4-mini",
      "google/gemini-3-flash",
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
        fast: { models: ["openai/gpt-4o-mini"] },
      },
      providers: { openai: createMockProvider() },
    });

    const model = provider("fast");
    expect(model.modelId).toBe("fsd:fast");
  });

  it("provider.languageModel is the same as calling provider()", () => {
    const provider = createFSDProvider({
      groups: { fast: { models: ["openai/gpt-4o-mini"] } },
      providers: { openai: createMockProvider() },
    });

    const a = provider("fast");
    const b = provider.languageModel("fast");
    expect(a).toBe(b); // same cached instance
  });

  it("throws for unknown group name", () => {
    const provider = createFSDProvider({
      groups: { fast: { models: ["openai/gpt-4o-mini"] } },
      providers: { openai: createMockProvider() },
    });

    expect(() => provider("nonexistent")).toThrow(
      'Unknown model group "nonexistent"'
    );
  });

  it("throws when no models in group are available", () => {
    const provider = createFSDProvider({
      groups: {
        fast: { models: ["anthropic/claude-haiku"] },
      },
      providers: { openai: createMockProvider() }, // no anthropic provider
    });

    expect(() => provider("fast")).toThrow("has no available models");
  });

  it("groups() lists all group names", () => {
    const provider = createFSDProvider({
      groups: {
        fast: { models: ["openai/gpt-4o-mini"] },
        slow: { models: ["openai/gpt-4o"] },
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
            "anthropic/claude-haiku",
            "openai/gpt-4o-mini",
            "google/gemini-2.0-flash",
          ],
        },
      },
      providers: { openai: createMockProvider() },
    });

    // Only openai is available since that's the only provider passed
    expect(provider.available("fast")).toEqual(["openai/gpt-4o-mini"]);
  });

  it("available() returns empty for unknown group", () => {
    const provider = createFSDProvider({
      groups: { fast: { models: ["openai/gpt-4o-mini"] } },
      providers: { openai: createMockProvider() },
    });

    expect(provider.available("nonexistent")).toEqual([]);
  });

  it("caches group resolution", () => {
    const provider = createFSDProvider({
      groups: { fast: { models: ["openai/gpt-4o-mini"] } },
      providers: { openai: createMockProvider() },
    });

    const a = provider("fast");
    const b = provider("fast");
    expect(a).toBe(b);
  });

  it("generate works end-to-end with mock provider", async () => {
    const provider = createFSDProvider({
      groups: { fast: { models: ["openai/gpt-4o-mini"] } },
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
      groups: { fast: { models: ["custom/model-a"] } },
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
          models: ["openai/gpt-4o-mini"],
          defaults: { maxTokens: 512 },
        },
        coding: {
          models: ["openai/codex-mini"],
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
            "anthropic/claude-haiku", // not available
            "openai/gpt-4o-mini",     // available
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

// ---------------------------------------------------------------------------
// Provider preference (FIX-425)
// ---------------------------------------------------------------------------

describe("createFSDProvider — provider preference", () => {
  const fourProviderConfig = {
    groups: {
      large: {
        models: [
          "openai/gpt-5.4",
          "anthropic/opus",
          "google/gemini-3",
          "anthropic/sonnet",
        ],
      },
    },
    providers: {
      openai: createMockProvider(),
      anthropic: createMockProvider(),
      google: createMockProvider(),
    },
  };

  it("without prefer: uses the preset's natural first model", async () => {
    const provider = createFSDProvider(fourProviderConfig);
    const result = await provider("large").generate({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.text).toBe("response:gpt-5.4");
  });

  it("single-provider prefer: moves preferred provider to the front", async () => {
    const provider = createFSDProvider(fourProviderConfig);
    const result = await provider("large", { prefer: "anthropic" }).generate({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.text).toBe("response:opus");
  });

  it("multi-provider prefer: uses the first in the prefer list that is available", async () => {
    const provider = createFSDProvider(fourProviderConfig);
    const result = await provider("large", {
      prefer: ["google", "anthropic"],
    }).generate({ messages: [{ role: "user", content: "hi" }] });
    expect(result.text).toBe("response:gemini-3");
  });

  it("prefer is an array, within-bucket order preserved (opus before sonnet)", () => {
    const provider = createFSDProvider(fourProviderConfig);
    expect(provider.available("large", { prefer: "anthropic" })).toEqual([
      "anthropic/opus",
      "anthropic/sonnet",
      "openai/gpt-5.4",
      "google/gemini-3",
    ]);
  });

  it("soft prefer (default): falls back when preferred provider unavailable", async () => {
    const provider = createFSDProvider({
      groups: fourProviderConfig.groups,
      providers: {
        openai: createMockProvider(),
        google: createMockProvider(),
        // anthropic deliberately omitted
      },
    });
    const result = await provider("large", { prefer: "anthropic" }).generate({
      messages: [{ role: "user", content: "hi" }],
    });
    // falls back to the natural order of the remaining models
    expect(result.text).toBe("response:gpt-5.4");
  });

  it("strict: throws when preferred provider has no matching models in preset", () => {
    const provider = createFSDProvider(fourProviderConfig);
    expect(() =>
      provider("large", { prefer: "grok", strict: true })
    ).toThrow(/contains no models from preferred provider\(s\) \[grok\]/);
  });

  it("strict: throws when preferred provider is in preset but unavailable", () => {
    const provider = createFSDProvider({
      groups: fourProviderConfig.groups,
      providers: {
        openai: createMockProvider(),
        google: createMockProvider(),
        // anthropic omitted
      },
    });
    expect(() =>
      provider("large", { prefer: "anthropic", strict: true })
    ).toThrow(/no available models from preferred provider\(s\) \[anthropic\]/);
  });

  it("config-level providerPreference is the default when call omits prefer", async () => {
    const provider = createFSDProvider({
      ...fourProviderConfig,
      providerPreference: "anthropic",
    });
    const result = await provider("large").generate({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.text).toBe("response:opus");
  });

  it("call-site prefer overrides config-level providerPreference", async () => {
    const provider = createFSDProvider({
      ...fourProviderConfig,
      providerPreference: "anthropic",
    });
    const result = await provider("large", { prefer: "google" }).generate({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.text).toBe("response:gemini-3");
  });

  it("empty prefer array is treated as no preference (no-op)", async () => {
    const provider = createFSDProvider({
      ...fourProviderConfig,
      providerPreference: "anthropic",
    });
    const result = await provider("large", { prefer: [] }).generate({
      messages: [{ role: "user", content: "hi" }],
    });
    // Empty array doesn't fall back to the config-level default — it means
    // "no preference", so natural order wins.
    expect(result.text).toBe("response:gpt-5.4");
  });

  it("caches per (group, prefer, strict) triple", () => {
    const provider = createFSDProvider(fourProviderConfig);
    const a = provider("large", { prefer: "anthropic" });
    const b = provider("large", { prefer: "anthropic" });
    const c = provider("large", { prefer: "google" });
    const d = provider("large");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });

  it("unknown provider in prefer silently no-ops (non-strict)", async () => {
    const provider = createFSDProvider(fourProviderConfig);
    const result = await provider("large", { prefer: "foobar" }).generate({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.text).toBe("response:gpt-5.4");
  });
});

// ---------------------------------------------------------------------------
// provider.explain (FIX-425)
// ---------------------------------------------------------------------------

describe("createFSDProvider.explain", () => {
  const cfg = {
    groups: {
      medium: {
        models: [
          "openai/gpt-5.4-mini",
          "anthropic/sonnet",
          "google/gemini-3",
        ],
      },
    },
    providers: {
      openai: createMockProvider(),
      anthropic: createMockProvider(),
      // google intentionally absent
    },
  };

  it("returns the candidate list in preference-reordered order", () => {
    const provider = createFSDProvider(cfg);
    const result = provider.explain("medium", { prefer: "anthropic" });
    expect(result.preset).toBe("medium");
    expect(result.prefer).toEqual(["anthropic"]);
    expect(result.candidates.map((c) => c.modelId)).toEqual([
      "anthropic/sonnet",
      "openai/gpt-5.4-mini",
      "google/gemini-3",
    ]);
  });

  it("tags unavailable candidates with a reason", () => {
    const provider = createFSDProvider(cfg);
    const result = provider.explain("medium");
    const google = result.candidates.find((c) => c.providerName === "google");
    expect(google?.available).toBe(false);
    expect(google?.reason).toBeTruthy();
  });

  it("willUse points at the first available candidate after reorder", () => {
    const provider = createFSDProvider(cfg);
    expect(provider.explain("medium").willUse).toBe("openai/gpt-5.4-mini");
    expect(provider.explain("medium", { prefer: "anthropic" }).willUse).toBe(
      "anthropic/sonnet"
    );
  });

  it("willUse is null when no candidate is available", () => {
    const provider = createFSDProvider({
      groups: { only: { models: ["google/gemini-3"] } },
      providers: { openai: createMockProvider() },
    });
    const result = provider.explain("only");
    expect(result.willUse).toBeNull();
    expect(result.candidates[0]!.available).toBe(false);
  });

  it("unknown group returns an empty result", () => {
    const provider = createFSDProvider(cfg);
    const result = provider.explain("nope");
    expect(result).toEqual({
      preset: "nope",
      prefer: [],
      candidates: [],
      willUse: null,
    });
  });
});
