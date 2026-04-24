import { describe, expect, it } from "vitest";
import { applyCaching, DEFAULT_CACHING_CONFIG } from "../../src/models/caching";

// A minimal stand-in for an AI SDK LanguageModelV2: the adapter only reads
// the `provider` string when deciding which cache flavor to emit.
function makeModel(provider: string): { provider: string } {
  return { provider };
}

function makeLargeSystemContent(): string {
  // ~1100 tokens at the 4-chars-per-token heuristic.
  return "x".repeat(4400);
}

describe("applyCaching", () => {
  describe("config precedence", () => {
    it("uses defaults when config is undefined", () => {
      const request: Record<string, unknown> = {
        messages: [{ role: "system", content: makeLargeSystemContent() }],
      };
      applyCaching(request, undefined, makeModel("anthropic.chat"));

      const system = (request.messages as any[])[0];
      expect(system.providerOptions?.anthropic?.cacheControl).toEqual({
        type: "ephemeral",
        ttl: DEFAULT_CACHING_CONFIG.ttl,
      });
    });

    it("does nothing when disabled", () => {
      const request: Record<string, unknown> = {
        messages: [{ role: "system", content: makeLargeSystemContent() }],
      };
      applyCaching(request, { enabled: false }, makeModel("anthropic.chat"));

      const system = (request.messages as any[])[0];
      expect(system.providerOptions).toBeUndefined();
    });

    it("passes through untouched in manual mode", () => {
      const request: Record<string, unknown> = {
        messages: [
          { role: "system", content: makeLargeSystemContent() },
          { role: "user", content: "hi" },
        ],
      };
      applyCaching(
        request,
        { breakpoints: "manual" },
        makeModel("anthropic.chat")
      );

      const system = (request.messages as any[])[0];
      expect(system.providerOptions).toBeUndefined();
    });

    it("honours a custom ttl", () => {
      const request: Record<string, unknown> = {
        messages: [{ role: "system", content: makeLargeSystemContent() }],
      };
      applyCaching(request, { ttl: "1h" }, makeModel("anthropic.chat"));

      const system = (request.messages as any[])[0];
      expect(system.providerOptions.anthropic.cacheControl.ttl).toBe("1h");
    });
  });

  describe("Anthropic provider", () => {
    it("marks the last system message when prefix is large enough", () => {
      const request: Record<string, unknown> = {
        messages: [
          { role: "system", content: "short preamble" },
          { role: "system", content: makeLargeSystemContent() },
          { role: "user", content: "hi" },
        ],
      };
      applyCaching(request, {}, makeModel("anthropic.messages"));

      const messages = request.messages as any[];
      // Only the last system message is marked.
      expect(messages[0].providerOptions).toBeUndefined();
      expect(messages[1].providerOptions.anthropic.cacheControl).toEqual({
        type: "ephemeral",
        ttl: "5m",
      });
      expect(messages[2].providerOptions).toBeUndefined();
    });

    it("skips when the cacheable prefix is below the 1024-token threshold", () => {
      const request: Record<string, unknown> = {
        messages: [
          { role: "system", content: "tiny prompt" },
          { role: "user", content: "hi" },
        ],
      };
      applyCaching(request, {}, makeModel("anthropic.chat"));

      const system = (request.messages as any[])[0];
      expect(system.providerOptions).toBeUndefined();
    });

    it("counts tool definitions toward the cacheable-prefix size", () => {
      const bigToolDescription = "d".repeat(4100);
      const request: Record<string, unknown> = {
        messages: [{ role: "system", content: "hi" }],
        tools: {
          lookup: {
            description: bigToolDescription,
            inputSchema: { type: "object" },
          },
        },
      };
      applyCaching(request, {}, makeModel("anthropic.chat"));

      const system = (request.messages as any[])[0];
      expect(system.providerOptions?.anthropic?.cacheControl).toBeDefined();
    });

    it("never overwrites a user-supplied cacheControl on the same message", () => {
      const userMarker = { type: "ephemeral", ttl: "1h" };
      const request: Record<string, unknown> = {
        messages: [
          {
            role: "system",
            content: makeLargeSystemContent(),
            providerOptions: { anthropic: { cacheControl: userMarker } },
          },
        ],
      };
      applyCaching(request, { ttl: "5m" }, makeModel("anthropic.chat"));

      const system = (request.messages as any[])[0];
      expect(system.providerOptions.anthropic.cacheControl).toBe(userMarker);
    });

    it("accepts array-shaped system content", () => {
      const request: Record<string, unknown> = {
        messages: [
          {
            role: "system",
            content: [{ type: "text", text: makeLargeSystemContent() }],
          },
          { role: "user", content: "hi" },
        ],
      };
      applyCaching(request, {}, makeModel("anthropic.chat"));

      const system = (request.messages as any[])[0];
      expect(system.providerOptions?.anthropic?.cacheControl).toBeDefined();
    });
  });

  describe("OpenRouter provider", () => {
    it("emits Anthropic-flavored markers (passes through to upstream Anthropic)", () => {
      const request: Record<string, unknown> = {
        messages: [{ role: "system", content: makeLargeSystemContent() }],
      };
      applyCaching(request, {}, makeModel("openrouter.chat"));

      const system = (request.messages as any[])[0];
      expect(system.providerOptions?.anthropic?.cacheControl).toBeDefined();
    });
  });

  describe("Vercel AI Gateway", () => {
    it("opts into gateway caching: 'auto'", () => {
      const request: Record<string, unknown> = {
        messages: [{ role: "system", content: "short" }],
      };
      applyCaching(request, {}, makeModel("gateway.chat"));

      expect(
        (request.providerOptions as any)?.gateway?.caching
      ).toBe("auto");
      // System message left untouched — gateway handles marker placement.
      const system = (request.messages as any[])[0];
      expect(system.providerOptions).toBeUndefined();
    });

    it("does not overwrite an explicit gateway caching value", () => {
      const request: Record<string, unknown> = {
        messages: [{ role: "system", content: "x" }],
        providerOptions: { gateway: { caching: "never" } },
      };
      applyCaching(request, {}, makeModel("gateway.chat"));

      expect(
        (request.providerOptions as any).gateway.caching
      ).toBe("never");
    });

    it("preserves other gateway options", () => {
      const request: Record<string, unknown> = {
        messages: [{ role: "system", content: "x" }],
        providerOptions: { gateway: { routing: "cheapest" } },
      };
      applyCaching(request, {}, makeModel("gateway.chat"));

      const gateway = (request.providerOptions as any).gateway;
      expect(gateway.routing).toBe("cheapest");
      expect(gateway.caching).toBe("auto");
    });
  });

  describe("implicit-cache providers", () => {
    it.each(["openai.chat", "google.generative", "deepseek.chat"])(
      "%s: no-op",
      (provider) => {
        const request: Record<string, unknown> = {
          messages: [{ role: "system", content: makeLargeSystemContent() }],
        };
        applyCaching(request, {}, makeModel(provider));

        const system = (request.messages as any[])[0];
        expect(system.providerOptions).toBeUndefined();
        expect(request.providerOptions).toBeUndefined();
      }
    );

    it("is a no-op when the provider cannot be detected", () => {
      const request: Record<string, unknown> = {
        messages: [{ role: "system", content: makeLargeSystemContent() }],
      };
      applyCaching(request, {}, {}); // no `.provider` field

      const system = (request.messages as any[])[0];
      expect(system.providerOptions).toBeUndefined();
    });
  });
});
