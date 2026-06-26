/**
 * Tests for createModelResolver env-var overrides (FIX-639).
 *
 * Covers the `FSDEV_INTENT_*` / `FSDEV_DEFAULT_MODEL` override mechanism:
 * the intent-name collision rule in validateOptions, construction-time
 * validation of override values, the effective options the resolver runs
 * against once overrides are applied, and the one-time dev-only logging
 * that confirms an override took effect.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { createModelResolver } from "../../src/models/createModelResolver";
import { __resetDeprecationWarningsForTests } from "../../src/helpers/deprecation.js";

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

function capturingProvider() {
  const captured: { providerOptions?: unknown }[] = [];
  const factory = (modelId: string) =>
    new MockLanguageModelV3({
      doGenerate: async (opts: any) => {
        captured.push({ providerOptions: opts.providerOptions });
        return {
          content: [{ type: "text", text: `response:${modelId}` }],
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 10, text: 10, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });
  return { factory, captured };
}

describe("createModelResolver — intent-name canonical collision", () => {
  it("throws when two intent names collide under canonicalization", () => {
    expect(() =>
      createModelResolver({
        intents: {
          "my-custom": ["openai/gpt-5.4"],
          my_custom: ["openai/gpt-5.4"],
        },
        defaultModel: "openai/gpt-5.4",
      })
    ).toThrow(
      /intent names "(my-custom|my_custom)" and "(my-custom|my_custom)" both map to environment variable FSDEV_INTENT_MY_CUSTOM/
    );
  });

  it("accepts a single hyphenated intent name", () => {
    expect(() =>
      createModelResolver({
        intents: { "my-custom": ["openai/gpt-5.4"] },
        defaultModel: "openai/gpt-5.4",
        providers: { openai: mockProvider() },
      })
    ).not.toThrow();
  });
});

describe("createModelResolver — env override validation", () => {
  it("throws when FSDEV_INTENT_CHAT is intent/foo", () => {
    expect(() =>
      createModelResolver({
        intents: { chat: ["openai/gpt-5.4"] },
        defaultModel: "openai/gpt-5.4",
        env: { FSDEV_INTENT_CHAT: "intent/foo" },
      })
    ).toThrow(
      /FSDEV_INTENT_CHAT must be a 'provider\/model' or 'gateway\/provider\/model' string; received "intent\/foo"/
    );
  });

  it("throws when FSDEV_INTENT_CHAT is a preset/* string", () => {
    expect(() =>
      createModelResolver({
        intents: { chat: ["openai/gpt-5.4"] },
        defaultModel: "openai/gpt-5.4",
        env: { FSDEV_INTENT_CHAT: "preset/fast" },
      })
    ).toThrow(/FSDEV_INTENT_CHAT.*preset\/\* model strings have been removed/);
  });

  it("throws when FSDEV_INTENT_CHAT is empty", () => {
    expect(() =>
      createModelResolver({
        intents: { chat: ["openai/gpt-5.4"] },
        defaultModel: "openai/gpt-5.4",
        env: { FSDEV_INTENT_CHAT: "" },
      })
    ).toThrow(/FSDEV_INTENT_CHAT must be a non-empty string/);
  });

  it("throws when FSDEV_INTENT_CHAT is whitespace only", () => {
    expect(() =>
      createModelResolver({
        intents: { chat: ["openai/gpt-5.4"] },
        defaultModel: "openai/gpt-5.4",
        env: { FSDEV_INTENT_CHAT: "   " },
      })
    ).toThrow(/FSDEV_INTENT_CHAT must be a non-empty string/);
  });

  it("throws when FSDEV_INTENT_CHAT is garbage", () => {
    expect(() =>
      createModelResolver({
        intents: { chat: ["openai/gpt-5.4"] },
        defaultModel: "openai/gpt-5.4",
        env: { FSDEV_INTENT_CHAT: "garbage" },
      })
    ).toThrow(/FSDEV_INTENT_CHAT.*Invalid model format/);
  });

  it("throws when FSDEV_DEFAULT_MODEL is intent/foo", () => {
    expect(() =>
      createModelResolver({
        intents: { chat: ["openai/gpt-5.4"] },
        defaultModel: "openai/gpt-5.4",
        env: { FSDEV_DEFAULT_MODEL: "intent/foo" },
      })
    ).toThrow(
      /FSDEV_DEFAULT_MODEL must be a 'provider\/model' or 'gateway\/provider\/model' string/
    );
  });

  it("warns and ignores FSDEV_INTENT_NOSUCH (a non-declared intent) instead of throwing", () => {
    // Env vars are ambient/inherited — an app must not crash because its
    // environment names an intent it doesn't declare. The stray override is
    // skipped; the declared intents are unaffected.
    const resolver = createModelResolver({
      intents: {
        chat: ["openai/gpt-5.4"],
        plan: ["openai/gpt-5.4"],
        utility: ["openai/gpt-5.4"],
      },
      defaultModel: "openai/gpt-5.4",
      env: { FSDEV_INTENT_NOSUCH: "openai/gpt-5" },
      providers: { openai: mockProvider() },
    });
    expect(resolver.resolveId("intent/chat")).toBe("openai/gpt-5.4");
  });

  it("warns and ignores FSDEV_INTENT_* when no intents are declared", () => {
    expect(() =>
      createModelResolver({
        env: { FSDEV_INTENT_CHAT: "openai/gpt-5" },
      })
    ).not.toThrow();
  });

  it("throws when FSDEV_DEFAULT_MODEL is set with no declared intents", () => {
    expect(() =>
      createModelResolver({
        env: { FSDEV_DEFAULT_MODEL: "openai/gpt-5" },
      })
    ).toThrow(/FSDEV_DEFAULT_MODEL was set, but no intents are declared/);
  });

  it("ignores unrelated env vars", () => {
    expect(() =>
      createModelResolver({
        intents: { chat: ["openai/gpt-5.4"] },
        defaultModel: "openai/gpt-5.4",
        env: { FSDEV_DATA_DIR: "/tmp/foo", HOME: "/root" },
        providers: { openai: mockProvider() },
      })
    ).not.toThrow();
  });
});

describe("createModelResolver — effective options after override", () => {
  beforeEach(() => {
    __resetDeprecationWarningsForTests();
  });

  it("FSDEV_INTENT_CHAT replaces the candidate list for intent/chat", async () => {
    const resolver = createModelResolver({
      intents: { chat: ["anthropic/claude-sonnet-4.6"] },
      defaultModel: "openai/gpt-5.4",
      env: { FSDEV_INTENT_CHAT: "openai/gpt-5-nano" },
      // Only openai is wired — if the override didn't take effect we'd fall
      // through to defaultModel instead of resolving to gpt-5-nano.
      providers: { openai: mockProvider() },
    });
    const model = resolver("intent/chat");
    const result = await model.generate({ messages: [{ role: "user", content: "hi" }] });
    expect(result.text).toBe("response:gpt-5-nano");
  });

  it("resolver.resolveId reflects the env-var override", () => {
    const resolver = createModelResolver({
      intents: { chat: ["anthropic/claude-sonnet-4.6"] },
      defaultModel: "openai/gpt-5.4",
      env: { FSDEV_INTENT_CHAT: "openai/gpt-5-nano" },
      providers: { openai: mockProvider() },
    });
    expect(resolver.resolveId("intent/chat")).toBe("openai/gpt-5-nano");
  });

  it("FSDEV_DEFAULT_MODEL replaces defaultModel for missing intents", async () => {
    const resolver = createModelResolver({
      intents: { chat: ["openai/gpt-5.4"] },
      defaultModel: "openai/gpt-5.4",
      env: { FSDEV_DEFAULT_MODEL: "openai/gpt-5-nano" },
      providers: { openai: mockProvider() },
    });
    const model = resolver("intent/missing");
    const result = await model.generate({ messages: [{ role: "user", content: "hi" }] });
    expect(result.text).toBe("response:gpt-5-nano");
  });

  it("resolver.resolveId returns the FSDEV_DEFAULT_MODEL value for missing intents", () => {
    const resolver = createModelResolver({
      intents: { chat: ["openai/gpt-5.4"] },
      defaultModel: "openai/gpt-5.4",
      env: { FSDEV_DEFAULT_MODEL: "openai/gpt-5-nano" },
      providers: { openai: mockProvider() },
    });
    expect(resolver.resolveId("intent/missing")).toBe("openai/gpt-5-nano");
  });

  it("hyphenated intent name matches FSDEV_INTENT_MY_CUSTOM", async () => {
    const resolver = createModelResolver({
      intents: { "my-custom": ["anthropic/claude"] },
      defaultModel: "openai/gpt-5.4",
      env: { FSDEV_INTENT_MY_CUSTOM: "openai/gpt-5-nano" },
      providers: { openai: mockProvider() },
    });
    const model = resolver("intent/my-custom");
    const result = await model.generate({ messages: [{ role: "user", content: "hi" }] });
    expect(result.text).toBe("response:gpt-5-nano");
  });

  it("explicit options.env shadows process.env entirely", async () => {
    const originalFsdev = process.env.FSDEV_INTENT_CHAT;
    process.env.FSDEV_INTENT_CHAT = "openai/gpt-5-from-process";
    try {
      // Explicit empty env object: process.env should be ignored, no override.
      const resolver = createModelResolver({
        intents: { chat: ["openai/gpt-5-from-options"] },
        defaultModel: "openai/gpt-5.4",
        env: {},
        providers: { openai: mockProvider() },
      });
      const model = resolver("intent/chat");
      const result = await model.generate({ messages: [{ role: "user", content: "hi" }] });
      expect(result.text).toBe("response:gpt-5-from-options");
    } finally {
      if (originalFsdev === undefined) {
        delete process.env.FSDEV_INTENT_CHAT;
      } else {
        process.env.FSDEV_INTENT_CHAT = originalFsdev;
      }
    }
  });

  it("override composes with intentDefaults — mismatched provider keys drop silently", async () => {
    const { factory, captured } = capturingProvider();
    const resolver = createModelResolver({
      intents: { chat: ["anthropic/claude-sonnet-4.6"] },
      defaultModel: "openai/gpt-5.4",
      intentDefaults: {
        chat: {
          providerOptions: {
            anthropic: { thinking: { type: "enabled", budgetTokens: 100 } },
          },
        },
      },
      env: { FSDEV_INTENT_CHAT: "openai/gpt-5-nano" },
      providers: { openai: factory },
    });

    const model = resolver("intent/chat");
    await model.generate({ messages: [{ role: "user", content: "hi" }] });

    const opts = (captured[0]?.providerOptions ?? {}) as Record<string, unknown>;
    // Anthropic's thinking config is dropped (override moved the winning
    // provider to openai); no openai-specific defaults were configured.
    expect(opts.anthropic).toBeUndefined();
    expect(opts.openai).toBeUndefined();
  });
});

describe("createModelResolver — override logging", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalQuiet = process.env.FSD_QUIET_WARNINGS;

  beforeEach(() => {
    __resetDeprecationWarningsForTests();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalQuiet === undefined) {
      delete process.env.FSD_QUIET_WARNINGS;
    } else {
      process.env.FSD_QUIET_WARNINGS = originalQuiet;
    }
  });

  it("emits exactly one warning per intent override", () => {
    createModelResolver({
      intents: { chat: ["anthropic/claude"] },
      defaultModel: "openai/gpt-5.4",
      env: { FSDEV_INTENT_CHAT: "openai/gpt-5-nano" },
      providers: { openai: mockProvider() },
    });
    const messages = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(
      messages.some((m) =>
        /\[flow-state-dev\] Intent "chat" overridden by FSDEV_INTENT_CHAT; resolves to "openai\/gpt-5-nano"/.test(
          m
        )
      )
    ).toBe(true);
    expect(
      messages.filter((m) => m.includes("FSDEV_INTENT_CHAT")).length
    ).toBe(1);
  });

  it("warns once when an undeclared FSDEV_INTENT_* override is ignored", () => {
    createModelResolver({
      intents: { chat: ["openai/gpt-5.4"] },
      defaultModel: "openai/gpt-5.4",
      env: { FSDEV_INTENT_NOSUCH: "openai/gpt-5" },
      providers: { openai: mockProvider() },
    });
    const messages = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(
      messages.some((m) =>
        /\[flow-state-dev\] FSDEV_INTENT_NOSUCH does not match any declared intent.*ignoring/i.test(
          m
        )
      )
    ).toBe(true);
    expect(
      messages.filter((m) => m.includes("FSDEV_INTENT_NOSUCH")).length
    ).toBe(1);
  });

  it("emits a warning for FSDEV_DEFAULT_MODEL", () => {
    createModelResolver({
      intents: { chat: ["openai/gpt-5.4"] },
      defaultModel: "openai/gpt-5.4",
      env: { FSDEV_DEFAULT_MODEL: "openai/gpt-5-nano" },
      providers: { openai: mockProvider() },
    });
    const messages = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(
      messages.some((m) =>
        /\[flow-state-dev\] defaultModel overridden by FSDEV_DEFAULT_MODEL; resolves to "openai\/gpt-5-nano"/.test(
          m
        )
      )
    ).toBe(true);
  });

  it("dedupes warnings across two resolver constructions", () => {
    const opts = {
      intents: { chat: ["anthropic/claude"] },
      defaultModel: "openai/gpt-5.4",
      env: { FSDEV_INTENT_CHAT: "openai/gpt-5-nano" },
      providers: { openai: mockProvider() },
    };
    createModelResolver(opts);
    createModelResolver(opts);
    const messages = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(
      messages.filter((m) => m.includes("FSDEV_INTENT_CHAT")).length
    ).toBe(1);
  });

  it("suppresses warnings under NODE_ENV=production but still applies the override", async () => {
    process.env.NODE_ENV = "production";
    const resolver = createModelResolver({
      intents: { chat: ["anthropic/claude"] },
      defaultModel: "openai/gpt-5.4",
      env: { FSDEV_INTENT_CHAT: "openai/gpt-5-nano" },
      providers: { openai: mockProvider() },
    });
    expect(warnSpy.mock.calls.length).toBe(0);
    const model = resolver("intent/chat");
    const result = await model.generate({ messages: [{ role: "user", content: "hi" }] });
    expect(result.text).toBe("response:gpt-5-nano");
  });

  it("suppresses warnings under FSD_QUIET_WARNINGS=1 but still applies the override", async () => {
    process.env.FSD_QUIET_WARNINGS = "1";
    const resolver = createModelResolver({
      intents: { chat: ["anthropic/claude"] },
      defaultModel: "openai/gpt-5.4",
      env: { FSDEV_INTENT_CHAT: "openai/gpt-5-nano" },
      providers: { openai: mockProvider() },
    });
    expect(warnSpy.mock.calls.length).toBe(0);
    const model = resolver("intent/chat");
    const result = await model.generate({ messages: [{ role: "user", content: "hi" }] });
    expect(result.text).toBe("response:gpt-5-nano");
  });
});
