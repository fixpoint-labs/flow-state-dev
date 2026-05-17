/**
 * Tests for createModelResolver intent resolution + construction validation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { createModelResolver } from "../../src/models/createModelResolver";
import { __resetDeprecationWarningsForTests } from "../../src/utils/deprecation.js";

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

describe("createModelResolver — construction validation", () => {
  it("throws when intents are configured without defaultModel", () => {
    expect(() =>
      createModelResolver({
        intents: { utility: ["openai/gpt-5.4"] },
      })
    ).toThrow(/defaultModel is required when intents are configured/);
  });

  it("throws when defaultModel is an intent/* string", () => {
    expect(() =>
      createModelResolver({
        intents: { utility: ["openai/gpt-5.4"] },
        defaultModel: "intent/something",
      })
    ).toThrow(/defaultModel must not be an intent\/\* string/);
  });

  it("throws when defaultModel is a preset/* string (via parseModelString)", () => {
    expect(() =>
      createModelResolver({
        intents: { utility: ["openai/gpt-5.4"] },
        defaultModel: "preset/fast",
      })
    ).toThrow(/preset\/\* model strings have been removed/);
  });

  it("throws when an intent candidate is an intent/* string", () => {
    expect(() =>
      createModelResolver({
        intents: { utility: ["intent/other"] },
        defaultModel: "openai/gpt-5.4",
      })
    ).toThrow(/must not be an intent\/\* string/);
  });

  it("throws when an intent candidate is a preset/* string", () => {
    expect(() =>
      createModelResolver({
        intents: { utility: ["preset/fast"] },
        defaultModel: "openai/gpt-5.4",
      })
    ).toThrow(/preset\/\* model strings have been removed/);
  });

  it("throws on malformed candidate", () => {
    expect(() =>
      createModelResolver({
        intents: { utility: ["just-one-segment"] },
        defaultModel: "openai/gpt-5.4",
      })
    ).toThrow(/Invalid model format/);
  });

  it("throws on bad intent name (digits-leading)", () => {
    expect(() =>
      createModelResolver({
        intents: { "1bad": ["openai/gpt-5.4"] },
        defaultModel: "openai/gpt-5.4",
      })
    ).toThrow(/invalid intent name/);
  });

  it("throws on bad intent name with slash", () => {
    expect(() =>
      createModelResolver({
        intents: { "bad/name": ["openai/gpt-5.4"] },
        defaultModel: "openai/gpt-5.4",
      })
    ).toThrow(/invalid intent name/);
  });

  it("throws on bad intent name with dot", () => {
    expect(() =>
      createModelResolver({
        intents: { "bad.name": ["openai/gpt-5.4"] },
        defaultModel: "openai/gpt-5.4",
      })
    ).toThrow(/invalid intent name/);
  });

  it("throws when legacy `presets` option is passed", () => {
    expect(() =>
      createModelResolver({
        // @ts-expect-error — legacy field intentionally tested
        presets: { fast: { models: ["openai/gpt-5.4"] } },
      })
    ).toThrow(/'presets' option has been removed/);
  });

  it("allows empty intents object without defaultModel", () => {
    expect(() =>
      createModelResolver({
        intents: {},
      })
    ).not.toThrow();
  });
});

describe("createModelResolver — intent resolution", () => {
  beforeEach(() => {
    __resetDeprecationWarningsForTests();
  });

  it("intent resolves to first available candidate", async () => {
    const resolver = createModelResolver({
      intents: {
        utility: ["openai/gpt-5.4-mini", "anthropic/sonnet"],
      },
      defaultModel: "openai/gpt-5.4",
      providers: {
        openai: mockProvider(),
        anthropic: mockProvider(),
      },
    });
    const model = resolver("intent/utility");
    const result = await model.generate({ messages: [{ role: "user", content: "hi" }] });
    expect(result.text).toBe("response:gpt-5.4-mini");
  });

  it("all candidates unavailable → falls back to defaultModel", async () => {
    const resolver = createModelResolver({
      intents: {
        utility: ["anthropic/sonnet", "google/gemini-3"],
      },
      defaultModel: "openai/fallback-default",
      providers: {
        // Only openai available — both intent candidates fail
        openai: mockProvider(),
      },
    });
    const model = resolver("intent/utility");
    const result = await model.generate({ messages: [{ role: "user", content: "hi" }] });
    expect(result.text).toBe("response:fallback-default");
  });

  it("unknown intent warns once and falls back to defaultModel", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const resolver = createModelResolver({
        intents: { utility: ["openai/gpt-5.4"] },
        defaultModel: "openai/fallback-default",
        providers: { openai: mockProvider() },
      });
      const m1 = resolver("intent/nonexistent");
      const result1 = await m1.generate({ messages: [{ role: "user", content: "hi" }] });
      expect(result1.text).toBe("response:fallback-default");
      // Second call to same unknown intent — should not warn again
      const m2 = resolver("intent/nonexistent");
      await m2.generate({ messages: [{ role: "user", content: "hi" }] });
      const matching = warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes('Unknown or empty intent "nonexistent"')
      );
      expect(matching.length).toBe(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("per-call preferProvider overrides resolver-level preference", async () => {
    const resolver = createModelResolver({
      intents: {
        large: ["openai/gpt-5.4", "anthropic/opus", "google/gemini-3"],
      },
      defaultModel: "openai/gpt-5.4",
      providerPreference: "anthropic",
      providers: {
        openai: mockProvider(),
        anthropic: mockProvider(),
        google: mockProvider(),
      },
    });
    const defaultModel = resolver("intent/large");
    expect((await defaultModel.generate({ messages: [{ role: "user", content: "hi" }] })).text).toBe(
      "response:opus"
    );
    const overridden = resolver("intent/large", undefined, {
      preferProvider: "google",
    });
    expect((await overridden.generate({ messages: [{ role: "user", content: "hi" }] })).text).toBe(
      "response:gemini-3"
    );
  });

  it("gateway fallback inside an intent: direct candidates resolve via vercel gateway", async () => {
    // Resolver has no direct API keys but a gateway entry — the vercel
    // gateway should still satisfy direct provider/model strings inside an
    // intent's candidate list.
    const gateway = {
      languageModel: (id: string) =>
        new MockLanguageModelV3({
          doGenerate: async () => ({
            content: [{ type: "text", text: `via-gateway:${id}` }],
            finishReason: { unified: "stop", raw: undefined },
            usage: {
              inputTokens: {
                total: 5,
                noCache: 5,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: {
                total: 10,
                text: 10,
                reasoning: undefined,
              },
            },
            warnings: [],
          }),
        }),
    };
    const resolver = createModelResolver({
      intents: {
        utility: ["openai/gpt-5.4-mini"],
      },
      defaultModel: "openai/gpt-5.4-mini",
      gateways: { vercel: gateway },
    });
    const model = resolver("intent/utility");
    const result = await model.generate({ messages: [{ role: "user", content: "hi" }] });
    expect(result.text).toBe("via-gateway:openai/gpt-5.4-mini");
  });

  it("FIX-609: bare provider/model falls back to gateway when direct provider load throws even with a key/provider present", async () => {
    // Repros the deployed-kitchen-sink failure: OPENAI_API_KEY is set (for
    // voice STT/TTS), but @ai-sdk/openai is not loadable in the bundled
    // runtime. A configured gateway must still serve a bare `openai/...`
    // string — without the author having to rewrite it as `vercel/openai/...`.
    // Here we simulate the unloadable direct path by passing an explicit
    // provider factory that throws when invoked.
    const throwingProvider = () => {
      throw new Error("simulated: @ai-sdk/openai not loadable in bundle");
    };
    const gateway = {
      languageModel: (id: string) =>
        new MockLanguageModelV3({
          doGenerate: async () => ({
            content: [{ type: "text", text: `via-gateway:${id}` }],
            finishReason: { unified: "stop", raw: undefined },
            usage: {
              inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 10, text: 10, reasoning: undefined },
            },
            warnings: [],
          }),
        }),
    };
    const resolver = createModelResolver({
      defaultModel: "openai/gpt-5.4-mini",
      providers: { openai: throwingProvider },
      gateways: { vercel: gateway },
    });
    const model = resolver("openai/gpt-5.4-mini");
    const result = await model.generate({ messages: [{ role: "user", content: "hi" }] });
    expect(result.text).toBe("via-gateway:openai/gpt-5.4-mini");
  });

  it("FIX-609: clear error enumerating attempts when neither direct nor gateway is available", () => {
    const resolver = createModelResolver({
      defaultModel: "anthropic/opus",
      providers: { anthropic: () => ({}) }, // satisfies defaultModel validation
    });
    // openai has no direct provider, no key, no gateway → enumerated failure
    expect(() => resolver("openai/gpt-5.4-mini")).toThrow(
      /No provider available for "openai".*Tried:.*gateways/s
    );
  });
});
