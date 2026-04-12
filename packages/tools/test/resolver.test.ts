import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { resolveProvider, ENV_VAR_MAP } from "../src/search/resolver";

describe("resolveProvider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all search-related env vars
    for (const envVar of Object.values(ENV_VAR_MAP)) {
      delete process.env[envVar];
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("explicit provider selection", () => {
    it("selects the requested provider when key is in config", () => {
      const result = resolveProvider({
        provider: "tavily",
        keys: { tavily: "test-key" },
      });

      expect(result.adapter.name).toBe("tavily");
      expect(result.apiKey).toBe("test-key");
    });

    it("selects the requested provider when key is in env", () => {
      process.env.EXA_API_KEY = "env-key";

      const result = resolveProvider({ provider: "exa" });

      expect(result.adapter.name).toBe("exa");
      expect(result.apiKey).toBe("env-key");
    });

    it("throws when requested provider has no key", () => {
      expect(() => resolveProvider({ provider: "serper" })).toThrow(
        'Search provider "serper" requested but no API key found'
      );
      expect(() => resolveProvider({ provider: "serper" })).toThrow(
        "SERPER_API_KEY"
      );
    });

    it("prefers config key over env var", () => {
      process.env.TAVILY_API_KEY = "env-key";

      const result = resolveProvider({
        provider: "tavily",
        keys: { tavily: "config-key" },
      });

      expect(result.apiKey).toBe("config-key");
    });

    it("selects perplexity when explicitly requested", () => {
      process.env.PERPLEXITY_API_KEY = "pplx-key";

      const result = resolveProvider({ provider: "perplexity" });

      expect(result.adapter.name).toBe("perplexity");
      expect(result.apiKey).toBe("pplx-key");
    });

    it("selects perplexity-sonar when explicitly requested", () => {
      process.env.PERPLEXITY_API_KEY = "pplx-key";

      const result = resolveProvider({ provider: "perplexity-sonar" });

      expect(result.adapter.name).toBe("perplexity-sonar");
      expect(result.apiKey).toBe("pplx-key");
    });
  });

  describe("auto-selection priority", () => {
    it("selects tavily first when multiple keys are available", () => {
      process.env.TAVILY_API_KEY = "tavily-key";
      process.env.EXA_API_KEY = "exa-key";

      const result = resolveProvider({});

      expect(result.adapter.name).toBe("tavily");
      expect(result.apiKey).toBe("tavily-key");
    });

    it("selects exa when tavily is not available", () => {
      process.env.EXA_API_KEY = "exa-key";

      const result = resolveProvider({});

      expect(result.adapter.name).toBe("exa");
      expect(result.apiKey).toBe("exa-key");
    });

    it("selects perplexity when tavily and exa are not available", () => {
      process.env.PERPLEXITY_API_KEY = "perplexity-key";

      const result = resolveProvider({});

      expect(result.adapter.name).toBe("perplexity");
      expect(result.apiKey).toBe("perplexity-key");
    });

    it("selects serper when tavily, exa, and perplexity are not available", () => {
      process.env.SERPER_API_KEY = "serper-key";

      const result = resolveProvider({});

      expect(result.adapter.name).toBe("serper");
      expect(result.apiKey).toBe("serper-key");
    });

    it("selects brave when only brave key is available", () => {
      process.env.BRAVE_SEARCH_API_KEY = "brave-key";

      const result = resolveProvider({});

      expect(result.adapter.name).toBe("brave");
      expect(result.apiKey).toBe("brave-key");
    });

    it("uses config keys for auto-selection", () => {
      const result = resolveProvider({
        keys: { exa: "config-exa-key" },
      });

      expect(result.adapter.name).toBe("exa");
      expect(result.apiKey).toBe("config-exa-key");
    });
  });

  describe("no provider available", () => {
    it("throws with helpful error when no keys are configured", () => {
      expect(() => resolveProvider({})).toThrow(
        "No search provider available"
      );
      expect(() => resolveProvider({})).toThrow("TAVILY_API_KEY");
      expect(() => resolveProvider({})).toThrow("EXA_API_KEY");
      expect(() => resolveProvider({})).toThrow("PERPLEXITY_API_KEY");
      expect(() => resolveProvider({})).toThrow("SERPER_API_KEY");
      expect(() => resolveProvider({})).toThrow("BRAVE_SEARCH_API_KEY");
    });
  });
});
