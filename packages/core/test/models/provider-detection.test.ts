import { describe, expect, it } from "vitest";
import {
  detectAvailableProviders,
  parseModelId,
  toGatewayModelId,
} from "../../src/models/providerDetection";

describe("parseModelId", () => {
  it("parses provider:model format", () => {
    expect(parseModelId("anthropic:claude-haiku")).toEqual({
      provider: "anthropic",
      modelId: "claude-haiku",
    });
  });

  it("handles model IDs with multiple colons", () => {
    expect(parseModelId("openai:gpt-4o:latest")).toEqual({
      provider: "openai",
      modelId: "gpt-4o:latest",
    });
  });

  it("throws for missing colon", () => {
    expect(() => parseModelId("gpt-4o")).toThrow(
      'Invalid model format: "gpt-4o"'
    );
  });
});

describe("toGatewayModelId", () => {
  it("converts to provider/model format", () => {
    expect(toGatewayModelId("anthropic", "claude-haiku")).toBe(
      "anthropic/claude-haiku"
    );
  });
});

describe("detectAvailableProviders", () => {
  it("detects direct API key from env vars", () => {
    const result = detectAvailableProviders({
      env: { ANTHROPIC_API_KEY: "sk-ant-123" },
    });

    expect(result.size).toBe(1);
    expect(result.get("anthropic")).toEqual({
      provider: "anthropic",
      source: "key",
      apiKey: "sk-ant-123",
    });
  });

  it("detects multiple providers from env vars", () => {
    const result = detectAvailableProviders({
      env: {
        ANTHROPIC_API_KEY: "sk-ant-123",
        OPENAI_API_KEY: "sk-oai-456",
        GOOGLE_GENERATIVE_AI_API_KEY: "goog-789",
      },
    });

    expect(result.size).toBe(3);
    expect(result.get("anthropic")?.source).toBe("key");
    expect(result.get("openai")?.source).toBe("key");
    expect(result.get("google")?.source).toBe("key");
  });

  it("explicit keys override env vars", () => {
    const result = detectAvailableProviders({
      keys: { anthropic: "explicit-key" },
      env: { ANTHROPIC_API_KEY: "env-key" },
    });

    expect(result.get("anthropic")?.apiKey).toBe("explicit-key");
  });

  it("detects Vercel AI Gateway from explicit config", () => {
    const result = detectAvailableProviders({
      gateways: { vercel: { type: "vercel", apiKey: "gw-key" } },
      env: {},
    });

    // Gateway makes all providers available
    expect(result.size).toBe(3);
    expect(result.get("anthropic")?.source).toBe("gateway");
    expect(result.get("anthropic")?.gatewayType).toBe("vercel");
    expect(result.get("anthropic")?.gatewayName).toBe("vercel");
    expect(result.get("openai")?.source).toBe("gateway");
    expect(result.get("google")?.source).toBe("gateway");
  });

  it("detects OpenRouter from explicit config", () => {
    const result = detectAvailableProviders({
      gateways: { or: { type: "openrouter", apiKey: "or-key" } },
      env: {},
    });

    expect(result.size).toBe(3);
    expect(result.get("anthropic")?.gatewayType).toBe("openrouter");
    expect(result.get("anthropic")?.gatewayName).toBe("or");
  });

  it("auto-detects gateway from env vars (zero-config)", () => {
    const result = detectAvailableProviders({
      env: { AI_GATEWAY_API_KEY: "auto-gw-key" },
    });

    expect(result.size).toBe(3);
    expect(result.get("anthropic")?.source).toBe("gateway");
    expect(result.get("anthropic")?.gatewayType).toBe("vercel");
    expect(result.get("anthropic")?.gatewayName).toBe("auto-vercel");
  });

  it("auto-detects OpenRouter from env vars", () => {
    const result = detectAvailableProviders({
      env: { OPENROUTER_API_KEY: "or-auto-key" },
    });

    expect(result.size).toBe(3);
    expect(result.get("openai")?.gatewayType).toBe("openrouter");
    expect(result.get("openai")?.gatewayName).toBe("auto-openrouter");
  });

  it("direct key takes priority over gateway", () => {
    const result = detectAvailableProviders({
      keys: { anthropic: "direct-key" },
      gateways: { vercel: { type: "vercel", apiKey: "gw-key" } },
      env: {},
    });

    // anthropic has direct key, others via gateway
    expect(result.get("anthropic")?.source).toBe("key");
    expect(result.get("anthropic")?.apiKey).toBe("direct-key");
    expect(result.get("openai")?.source).toBe("gateway");
    expect(result.get("google")?.source).toBe("gateway");
  });

  it("gateway from config takes priority over auto-detected gateway", () => {
    const result = detectAvailableProviders({
      gateways: { vercel: { type: "vercel", apiKey: "explicit-gw" } },
      env: { OPENROUTER_API_KEY: "auto-or-key" },
    });

    // Vercel gateway configured explicitly → gets priority
    expect(result.get("anthropic")?.gatewayType).toBe("vercel");
    expect(result.get("anthropic")?.apiKey).toBe("explicit-gw");
  });

  it("returns empty map when no keys or gateways found", () => {
    const result = detectAvailableProviders({ env: {} });
    expect(result.size).toBe(0);
  });

  it("gateway env var fills config without explicit apiKey", () => {
    const result = detectAvailableProviders({
      gateways: { vercel: { type: "vercel" } },
      env: { AI_GATEWAY_API_KEY: "env-gw-key" },
    });

    expect(result.get("anthropic")?.source).toBe("gateway");
    expect(result.get("anthropic")?.apiKey).toBe("env-gw-key");
  });
});
