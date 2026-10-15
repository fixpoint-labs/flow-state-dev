import { describe, expect, it } from "vitest";
import {
  detectAvailableProviders,
  parseModelString,
} from "../../src/models/providerDetection";

describe("parseModelString", () => {
  it("parses provider/model format", () => {
    expect(parseModelString("anthropic/claude-haiku")).toEqual({
      type: "direct",
      provider: "anthropic",
      modelId: "claude-haiku",
    });
  });

  // The colon names a route (D1/D2). The parser sees only the string, so it
  // returns the name and the model id; the resolver decides whether the name
  // is a gateway or a provider.
  it("parses gateway:provider/model as an alias, keeping the slash in the model id", () => {
    expect(parseModelString("vercel:openai/gpt-5.4")).toEqual({
      type: "alias",
      alias: "vercel",
      modelId: "openai/gpt-5.4",
    });
  });

  it("parses provider:model and a registered name:model as an alias", () => {
    expect(parseModelString("openai:gpt-5.4")).toEqual({ type: "alias", alias: "openai", modelId: "gpt-5.4" });
    expect(parseModelString("triage:native")).toEqual({ type: "alias", alias: "triage", modelId: "native" });
  });

  it("splits at the first colon only, so a model id may carry its own colon", () => {
    expect(parseModelString("openrouter:openai/gpt-oss-20b:free")).toEqual({
      type: "alias",
      alias: "openrouter",
      modelId: "openai/gpt-oss-20b:free",
    });
  });

  it("keeps a slash id whose colon comes after the first slash in the provider-model lane", () => {
    expect(parseModelString("openai/gpt-oss:free")).toEqual({
      type: "direct",
      provider: "openai",
      modelId: "gpt-oss:free",
    });
  });

  it("rejects an alias with an empty name or model id", () => {
    expect(() => parseModelString(":gpt-5.4")).toThrow(/Invalid model format/);
    expect(() => parseModelString("openai:")).toThrow(/Invalid model format/);
  });

  it("parses intent/name format", () => {
    expect(parseModelString("intent/utility")).toEqual({
      type: "intent",
      intentName: "utility",
    });
  });

  it("parses intent/multi-word-name format", () => {
    expect(parseModelString("intent/multi-word_name")).toEqual({
      type: "intent",
      intentName: "multi-word_name",
    });
  });

  it("rejects intent/foo/bar (3-part intent)", () => {
    expect(() => parseModelString("intent/foo/bar")).toThrow(
      /intent\/\* model strings must be 2 parts/
    );
  });

  it("rejects malformed intent name (digits-leading)", () => {
    expect(() => parseModelString("intent/1abc")).toThrow(/Invalid intent name/);
  });

  it("throws for single segment (no provider)", () => {
    expect(() => parseModelString("gpt-5.4")).toThrow(
      'Invalid model format: "gpt-5.4"'
    );
  });

  it("throws for empty string", () => {
    expect(() => parseModelString("")).toThrow("Model string cannot be empty");
  });

  it("trims whitespace", () => {
    expect(parseModelString("  openai/gpt-5.4  ")).toEqual({
      type: "direct",
      provider: "openai",
      modelId: "gpt-5.4",
    });
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
