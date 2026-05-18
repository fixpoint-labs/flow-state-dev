/**
 * Tests for createModelResolver `intentDefaults` (FIX-633).
 *
 * Covers per-intent `providerOptions` defaults: construction validation,
 * provider-filtered application, deep-merge with call-site options, and
 * the `defaultModel` fallback no-op.
 *
 * Also covers the `createFSDProvider` tombstone — calling it must throw
 * with a migration message pointing at the new API.
 */
import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { createModelResolver } from "../../src/models/createModelResolver";
import type { IntentDefaults } from "../../src/models/types";
import { createFSDProvider } from "../../src/models/createFSDProvider";

/**
 * Build a mock AI SDK provider whose generated language model captures the
 * `providerOptions` it received. Inspect `lastCall.providerOptions` after
 * `model.generate()` to assert what reached the underlying call.
 */
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

describe("createModelResolver — intentDefaults construction validation", () => {
  it("throws when intentDefaults references an intent that isn't defined (intents empty)", () => {
    expect(() =>
      createModelResolver({
        intents: {},
        intentDefaults: { plan: { providerOptions: { anthropic: {} } } },
      })
    ).toThrow(/intentDefaults key "plan" is not a defined intent/);
  });

  it("throws when intentDefaults references an intent that isn't defined (intents non-empty)", () => {
    expect(() =>
      createModelResolver({
        intents: { utility: ["openai/gpt-5.4"] },
        defaultModel: "openai/gpt-5.4",
        intentDefaults: { plan: { providerOptions: { anthropic: {} } } },
      })
    ).toThrow(/intentDefaults key "plan" is not a defined intent/);
  });

  it("succeeds when every intentDefaults key is also a defined intent", () => {
    const { factory } = capturingProvider();
    expect(() =>
      createModelResolver({
        intents: {
          plan: ["anthropic/claude-opus-4.7"],
          utility: ["openai/gpt-5.4"],
        },
        defaultModel: "openai/gpt-5.4",
        intentDefaults: {
          plan: { providerOptions: { anthropic: { thinking: { type: "enabled" } } } },
        },
        providers: { anthropic: factory, openai: factory },
      })
    ).not.toThrow();
  });
});

describe("createModelResolver — intentDefaults resolution", () => {
  it("applies the intent's providerOptions when the resolved provider matches", async () => {
    const { factory, captured } = capturingProvider();
    const resolver = createModelResolver({
      intents: { plan: ["anthropic/claude-opus-4.7"] },
      defaultModel: "openai/gpt-5.4",
      intentDefaults: {
        plan: {
          providerOptions: {
            anthropic: { thinking: { type: "enabled", budgetTokens: 16000 } },
          },
        },
      },
      providers: { anthropic: factory, openai: factory },
    });

    const model = resolver("intent/plan");
    await model.generate({ messages: [{ role: "user", content: "hi" }] });

    expect(captured[0]?.providerOptions).toEqual({
      anthropic: { thinking: { type: "enabled", budgetTokens: 16000 } },
    });
  });

  it("drops mismatched-provider keys silently", async () => {
    const { factory, captured } = capturingProvider();
    // Anthropic candidate is unavailable (no anthropic provider); OpenAI wins.
    const resolver = createModelResolver({
      intents: { plan: ["anthropic/claude-opus-4.7", "openai/gpt-5.5"] },
      defaultModel: "openai/gpt-5.4",
      intentDefaults: {
        plan: {
          providerOptions: {
            anthropic: { thinking: { type: "enabled", budgetTokens: 16000 } },
          },
        },
      },
      providers: { openai: factory },
    });

    const model = resolver("intent/plan");
    await model.generate({ messages: [{ role: "user", content: "hi" }] });

    const opts = (captured[0]?.providerOptions ?? {}) as Record<string, unknown>;
    expect(opts.anthropic).toBeUndefined();
  });

  it("call-site providerOptions wins on key collisions", async () => {
    const { factory, captured } = capturingProvider();
    const resolver = createModelResolver({
      intents: { plan: ["anthropic/claude-opus-4.7"] },
      defaultModel: "openai/gpt-5.4",
      intentDefaults: {
        plan: {
          providerOptions: {
            anthropic: { thinking: { type: "enabled", budgetTokens: 16000 } },
          },
        },
      },
      providers: { anthropic: factory, openai: factory },
    });

    const model = resolver("intent/plan");
    await model.generate({
      messages: [{ role: "user", content: "hi" }],
      providerOptions: {
        anthropic: { thinking: { budgetTokens: 8000 } },
      },
    });

    expect(captured[0]?.providerOptions).toEqual({
      // Intent default supplied `type: "enabled"`; call-site overrides budgetTokens
      // and the deep-merge keeps both keys under `thinking`.
      anthropic: { thinking: { type: "enabled", budgetTokens: 8000 } },
    });
  });

  it("deep-merges non-conflicting nested keys", async () => {
    const { factory, captured } = capturingProvider();
    const resolver = createModelResolver({
      intents: { plan: ["anthropic/claude-opus-4.7"] },
      defaultModel: "openai/gpt-5.4",
      intentDefaults: {
        plan: {
          providerOptions: {
            anthropic: { thinking: { type: "enabled", budgetTokens: 16000 } },
          },
        },
      },
      providers: { anthropic: factory, openai: factory },
    });

    const model = resolver("intent/plan");
    await model.generate({
      messages: [{ role: "user", content: "hi" }],
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
      },
    });

    expect(captured[0]?.providerOptions).toEqual({
      anthropic: {
        thinking: { type: "enabled", budgetTokens: 16000 },
        cacheControl: { type: "ephemeral" },
      },
    });
  });

  it("does not apply intent defaults when the intent falls through to defaultModel", async () => {
    const { factory, captured } = capturingProvider();
    // Anthropic intent has only an anthropic candidate; only OpenAI is available
    // → falls through to defaultModel (openai/gpt-5.4). Intent defaults must
    // NOT apply because the defaultModel has no associated intent context.
    const resolver = createModelResolver({
      intents: { plan: ["anthropic/claude-opus-4.7"] },
      defaultModel: "openai/gpt-5.4",
      intentDefaults: {
        plan: {
          providerOptions: {
            openai: { reasoning: { effort: "high" } },
          },
        },
      },
      providers: { openai: factory },
    });

    const model = resolver("intent/plan");
    await model.generate({ messages: [{ role: "user", content: "hi" }] });

    // No defaults piped through → providerOptions is whatever the call site
    // passed (nothing, here), not the intent default.
    expect(captured[0]?.providerOptions).toBeUndefined();
  });

  it("filters multi-provider intent defaults to the resolved provider only", async () => {
    const { factory, captured } = capturingProvider();
    const resolver = createModelResolver({
      intents: { plan: ["anthropic/claude-opus-4.7", "openai/gpt-5.5"] },
      defaultModel: "openai/gpt-5.4",
      intentDefaults: {
        plan: {
          providerOptions: {
            anthropic: { thinking: { type: "enabled" } },
            openai: { reasoning: { effort: "high" } },
          },
        },
      },
      // Anthropic candidate wins resolution.
      providers: { anthropic: factory, openai: factory },
    });

    const model = resolver("intent/plan");
    await model.generate({ messages: [{ role: "user", content: "hi" }] });

    const opts = (captured[0]?.providerOptions ?? {}) as Record<string, unknown>;
    expect(opts.anthropic).toEqual({ thinking: { type: "enabled" } });
    expect(opts.openai).toBeUndefined();
  });

  it("IntentDefaults is exported and consumable as a type", () => {
    // Type-level smoke check: assignability of the imported type from the
    // public surface. The runtime expression is intentionally trivial.
    const _x: IntentDefaults = { providerOptions: { anthropic: { thinking: {} } } };
    expect(_x.providerOptions?.anthropic).toBeDefined();
  });
});

describe("createFSDProvider — removed (FIX-633 tombstone)", () => {
  it("throws with a migration message pointing at createModelResolver/intentDefaults", () => {
    expect(() => createFSDProvider({})).toThrow(
      /createFSDProvider has been removed.*createModelResolver.*intentDefaults/s
    );
  });
});
