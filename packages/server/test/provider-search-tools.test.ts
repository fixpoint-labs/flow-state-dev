import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { createAiSdkModelResolver } from "../src";

describe("provider search tool resolution", () => {
  it("detects provider tools on the resolver function", () => {
    // Create a mock provider: a callable function with .tools
    const mockProvider = Object.assign(
      (modelId: string) => new MockLanguageModelV3({
        provider: "anthropic.chat",
        modelId,
        doGenerate: async () => ({
          content: [{ type: "text", text: "hi" }],
          finishReason: { unified: "stop", raw: undefined },
          usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } },
          warnings: []
        })
      }),
      {
        tools: {
          webSearch_20250305: (opts?: Record<string, unknown>) => ({
            type: "provider-defined",
            id: "web_search",
            args: opts
          })
        }
      }
    );

    const resolver = createAiSdkModelResolver(mockProvider);
    const model = resolver("claude-sonnet-4-20250514", "gen");

    expect(model.resolveSearchTool).toBeDefined();
    const result = model.resolveSearchTool!({});
    expect(result).toBeDefined();
    expect(result!.name).toBe("web_search");
    expect(result!.tool).toEqual({ type: "provider-defined", id: "web_search", args: undefined });
  });

  it("maps normalized config to Anthropic search tool", () => {
    const capturedArgs: unknown[] = [];
    const mockProvider = Object.assign(
      (modelId: string) => new MockLanguageModelV3({
        provider: "anthropic.chat",
        modelId,
        doGenerate: async () => ({
          content: [{ type: "text", text: "hi" }],
          finishReason: { unified: "stop", raw: undefined },
          usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } },
          warnings: []
        })
      }),
      {
        tools: {
          webSearch_20250305: (opts?: Record<string, unknown>) => {
            capturedArgs.push(opts);
            return { type: "provider-defined", ...opts };
          }
        }
      }
    );

    const resolver = createAiSdkModelResolver(mockProvider);
    const model = resolver("claude-sonnet-4-20250514", "gen");

    const result = model.resolveSearchTool!({
      maxUses: 5,
      allowedDomains: ["docs.anthropic.com"],
      blockedDomains: ["evil.com"],
      userLocation: { type: "approximate", city: "SF", country: "US" }
    });

    expect(result).toBeDefined();
    expect(capturedArgs[0]).toEqual({
      maxUses: 5,
      allowedDomains: ["docs.anthropic.com"],
      blockedDomains: ["evil.com"],
      userLocation: { type: "approximate", city: "SF", country: "US" }
    });
  });

  it("maps normalized config to OpenAI search tool", () => {
    const capturedArgs: unknown[] = [];
    const mockProvider = Object.assign(
      (modelId: string) => new MockLanguageModelV3({
        provider: "openai.chat",
        modelId,
        doGenerate: async () => ({
          content: [{ type: "text", text: "hi" }],
          finishReason: { unified: "stop", raw: undefined },
          usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } },
          warnings: []
        })
      }),
      {
        tools: {
          webSearch: (opts?: Record<string, unknown>) => {
            capturedArgs.push(opts);
            return { type: "provider-defined", ...opts };
          }
        }
      }
    );

    const resolver = createAiSdkModelResolver(mockProvider);
    const model = resolver("gpt-4o", "gen");

    model.resolveSearchTool!({ searchDepth: "high", userLocation: { type: "approximate", country: "US" } });

    expect(capturedArgs[0]).toEqual({
      searchContextSize: "high",
      userLocation: { type: "approximate", country: "US" }
    });
  });

  it("returns undefined for unknown providers", () => {
    const mockProvider = Object.assign(
      (modelId: string) => new MockLanguageModelV3({
        provider: "unknown-provider.chat",
        modelId,
        doGenerate: async () => ({
          content: [{ type: "text", text: "hi" }],
          finishReason: { unified: "stop", raw: undefined },
          usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } },
          warnings: []
        })
      }),
      { tools: {} }
    );

    const resolver = createAiSdkModelResolver(mockProvider);
    const model = resolver("some-model", "gen");

    expect(model.resolveSearchTool!({})).toBeUndefined();
  });

  it("returns undefined when resolver has no .tools", () => {
    // Plain function resolver, no .tools property
    const resolver = createAiSdkModelResolver((modelId) =>
      new MockLanguageModelV3({
        provider: "anthropic.chat",
        modelId,
        doGenerate: async () => ({
          content: [{ type: "text", text: "hi" }],
          finishReason: { unified: "stop", raw: undefined },
          usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } },
          warnings: []
        })
      })
    );

    const model = resolver("claude-sonnet-4-20250514", "gen");
    expect(model.resolveSearchTool!({})).toBeUndefined();
  });
});

describe("source normalization in generate results", () => {
  // Note: In real usage, sources are populated on the generateText result
  // by the AI SDK when provider-native search tools are used. The
  // MockLanguageModelV3 doesn't propagate custom fields through generateText,
  // so we test that results without sources normalize to undefined (the
  // positive path is tested via stream events in integration tests).

  it("returns undefined sources when none present in result", async () => {
    const resolver = createAiSdkModelResolver(() => new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: "no sources" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } },
        warnings: []
      })
    }));

    const result = await resolver("model", "gen").generate({
      messages: [{ role: "user", content: "hi" }]
    });

    expect(result.sources).toBeUndefined();
  });
});

describe("provider tools passthrough in buildAiSdkRequest", () => {
  // Note: Full integration tests with generateText require real provider SDK
  // tools (e.g., from @ai-sdk/anthropic) because the AI SDK validates tool
  // types at runtime. These tests verify the resolution path is correct.

  it("resolveSearchTool returns the raw tool object for passthrough", () => {
    const rawTool = { type: "provider-defined", id: "web_search", args: {} };
    const mockProvider = Object.assign(
      (modelId: string) => new MockLanguageModelV3({
        provider: "anthropic.chat",
        modelId,
        doGenerate: async () => ({
          content: [{ type: "text", text: "hi" }],
          finishReason: { unified: "stop", raw: undefined },
          usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } },
          warnings: []
        })
      }),
      {
        tools: {
          webSearch_20250305: () => rawTool
        }
      }
    );

    const resolver = createAiSdkModelResolver(mockProvider);
    const model = resolver("claude-sonnet-4-20250514", "gen");
    const result = model.resolveSearchTool!({});

    // The tool returned is the exact raw object from the provider factory
    expect(result).toBeDefined();
    expect(result!.tool).toBe(rawTool);
    expect(result!.name).toBe("web_search");
  });

  it("calls Anthropic factory with empty config for search: true", () => {
    let factoryCalled = false;
    const mockProvider = Object.assign(
      (modelId: string) => new MockLanguageModelV3({
        provider: "anthropic.chat",
        modelId,
        doGenerate: async () => ({
          content: [{ type: "text", text: "hi" }],
          finishReason: { unified: "stop", raw: undefined },
          usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } },
          warnings: []
        })
      }),
      {
        tools: {
          webSearch_20250305: () => {
            factoryCalled = true;
            return { type: "provider-defined" };
          }
        }
      }
    );

    const resolver = createAiSdkModelResolver(mockProvider);
    const model = resolver("claude-sonnet-4-20250514", "gen");

    // search: true resolves to empty config {}
    model.resolveSearchTool!({});
    expect(factoryCalled).toBe(true);
  });
});
