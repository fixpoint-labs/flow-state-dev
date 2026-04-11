import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { resolveProvider } from "../../src/crawl/resolver";

describe("crawl resolveProvider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.FIRECRAWL_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("explicit provider selection", () => {
    it("selects firecrawl when key is in config", () => {
      const result = resolveProvider({
        provider: "firecrawl",
        keys: { firecrawl: "test-key" },
      });

      expect(result.adapter.name).toBe("firecrawl");
      expect(result.apiKey).toBe("test-key");
    });

    it("selects firecrawl when key is in env", () => {
      process.env.FIRECRAWL_API_KEY = "env-key";

      const result = resolveProvider({ provider: "firecrawl" });

      expect(result.adapter.name).toBe("firecrawl");
      expect(result.apiKey).toBe("env-key");
    });

    it("throws when firecrawl requested without key", () => {
      expect(() => resolveProvider({ provider: "firecrawl" })).toThrow(
        'Crawl provider "firecrawl" requested but no API key found'
      );
    });

    it("selects builtin without error", () => {
      const result = resolveProvider({ provider: "builtin" });

      expect(result.adapter.name).toBe("builtin");
      expect(result.apiKey).toBeUndefined();
    });
  });

  describe("auto-selection priority", () => {
    it("selects firecrawl when key is available", () => {
      process.env.FIRECRAWL_API_KEY = "fc-key";

      const result = resolveProvider({});

      expect(result.adapter.name).toBe("firecrawl");
      expect(result.apiKey).toBe("fc-key");
    });

    it("falls back to builtin when no keys available", () => {
      const result = resolveProvider({});

      expect(result.adapter.name).toBe("builtin");
      expect(result.apiKey).toBeUndefined();
    });

    it("never throws — builtin is always available", () => {
      expect(() => resolveProvider({})).not.toThrow();
    });
  });
});
